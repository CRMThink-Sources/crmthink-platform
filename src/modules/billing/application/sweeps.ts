import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import { logger } from '@/shared/observability/logger'
import { metrics } from '@/shared/observability/metrics'
import { raiseAlert } from '@/shared/observability/alert'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { PaymentGateway } from '../ports/payment-gateway'
import type { BillingContext } from './billing-context'
import type { ItemsService } from './items-service'
import type { ManualLifecycle } from './manual-lifecycle'
import type { StripeLifecycle } from './stripe-lifecycle'
import type { SubscriptionWriter } from './subscription-writer'

/**
 * Consistência garantida por varredura, não só por webhooks (D6):
 *
 * - `stripe`: toda assinatura Stripe com metadados de app cadastrado é comparada ao
 *   SPA 1142 (status, período, plano, cancelamento agendado, quantidade cobrável).
 *   Divergência é corrigida pelo mesmo caminho do webhook — que emite o evento que
 *   faltou (ex.: `subscription.renewed` de webhook perdido).
 * - `spa`: itens de 1142/1146 alterados desde a última varredura passam pelas regras
 *   de mudança humana (eventos perdidos do SPA).
 */
export class Sweeps {
  constructor(
    private readonly db: Db,
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly gateway: PaymentGateway,
    private readonly registry: AppRegistry,
    private readonly stripe: StripeLifecycle,
    private readonly manual: ManualLifecycle,
    private readonly items: ItemsService,
    private readonly clock: Clock,
  ) {}

  private async record<
    T extends { fixed: number; errors: number; detail?: unknown },
  >(kind: 'stripe' | 'spa', run: (startedAt: Date) => Promise<T>): Promise<T> {
    const startedAt = this.clock.now()
    const row = await this.db.sweepRun.create({ data: { kind, startedAt } })
    try {
      const result = await run(startedAt)
      await this.db.sweepRun.update({
        where: { id: row.id },
        data: {
          finishedAt: this.clock.now(),
          fixed: result.fixed,
          errors: result.errors,
          detail: (result.detail ?? null) as object,
        },
      })
      if (result.fixed > 0) metrics.sweepDivergences.inc({ kind }, result.fixed)
      return result
    } catch (error) {
      metrics.sweepFailures.inc({ kind })
      raiseAlert(
        'sweep.failed',
        { kind, error: error instanceof Error ? error.message : String(error) },
        'varredura falhou',
      )
      await this.db.sweepRun.update({
        where: { id: row.id },
        data: { finishedAt: this.clock.now(), errors: 1 },
      })
      throw error
    }
  }

  async stripeSweep(): Promise<{
    fixed: number
    errors: number
    checked: number
  }> {
    return this.record('stripe', async () => {
      let fixed = 0
      let errors = 0
      let checked = 0
      for await (const state of this.gateway.listSubscriptions()) {
        if (!state.metadata) continue
        const app = await this.registry.get(state.metadata.appCode)
        if (!app?.active) continue
        checked++
        try {
          const before = await this.context.subscriptions.findByGatewayId(
            state.id,
          )
          const versionBefore = before
            ? await this.writer.currentVersion(before.id)
            : -1
          await this.stripe.sync(state, { kind: 'sweep' })
          const after = await this.context.subscriptions.findByGatewayId(
            state.id,
          )
          const versionAfter = after
            ? await this.writer.currentVersion(after.id)
            : -1
          if (versionAfter !== versionBefore) {
            fixed++
            raiseAlert(
              'sweep.divergence',
              { gatewaySubscriptionId: state.id, subscriptionId: after?.id },
              'SPA divergente do Stripe corrigido',
            )
          }
          if (after && state.status !== 'cancelled') {
            const quantity = state.items.reduce(
              (total, item) => total + item.quantity,
              0,
            )
            if (await this.items.reconcileQuantity(after, quantity)) {
              fixed++
              raiseAlert(
                'sweep.divergence',
                { subscriptionId: after.id, gatewayQuantity: quantity },
                'quantidade Stripe divergente reaplicada a partir do SPA',
              )
            }
          }
        } catch (error) {
          errors++
          logger().error(
            { err: error, gatewaySubscriptionId: state.id },
            'varredura Stripe: falha numa assinatura',
          )
        }
      }
      return { fixed, errors, checked, detail: { checked } }
    })
  }

  async spaSweep(): Promise<{ fixed: number; errors: number }> {
    const last = await this.db.sweepRun.findFirst({
      where: { kind: 'spa', finishedAt: { not: null }, errors: 0 },
      orderBy: { startedAt: 'desc' },
    })
    // Margem de 5 min: relógio do portal e da plataforma não batem ao segundo.
    const since = new Date(
      (
        last?.startedAt ?? new Date(this.clock.now().getTime() - 86_400_000)
      ).getTime() -
        5 * 60_000,
    )

    return this.record('spa', async () => {
      let fixed = 0
      let errors = 0
      for (const subscription of await this.context.subscriptions.listModifiedSince(
        since,
      )) {
        try {
          const before = await this.writer.currentVersion(subscription.id)
          await this.manual.apply(subscription.id)
          if ((await this.writer.currentVersion(subscription.id)) !== before)
            fixed++
        } catch (error) {
          errors++
          logger().error(
            { err: error, subscriptionId: subscription.id },
            'varredura SPA: falha numa assinatura',
          )
        }
      }
      for (const item of await this.context.subscriptions.listItemsModifiedSince(
        since,
      )) {
        try {
          await this.items.onSpaItemChanged(item.id, 'UPDATE')
        } catch (error) {
          errors++
          logger().error(
            { err: error, itemId: item.id },
            'varredura SPA: falha num item',
          )
        }
      }
      return { fixed, errors, detail: { since: since.toISOString() } }
    })
  }
}
