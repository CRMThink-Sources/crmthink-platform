import type { Clock } from '@/shared/clock'
import { logger } from '@/shared/observability/logger'
import { raiseAlert } from '@/shared/observability/alert'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { RegisteredApp } from '@/modules/registry/domain/app'
import type { InstallationView } from '@/modules/installations/ports'
import type { Subscription } from '../domain/entities'
import type {
  GatewayMetadata,
  GatewaySubscriptionState,
  PaymentGateway,
} from '../ports/payment-gateway'
import { formatCalendarDate } from '../infra/spa/spa-calendar-date'
import type { BillingContext } from './billing-context'
import type { PlanCatalog } from './plan-catalog'
import {
  snapshotOf,
  type PlannedEvent,
  type Snapshot,
  type SubscriptionWriter,
} from './subscription-writer'

/**
 * Ciclo de vida das assinaturas `stripe` a partir do gateway.
 *
 * Toda transição é decidida contra o **último estado registrado pela plataforma**
 * (`subscription_version.last_snapshot`), não contra o SPA: se o processo caiu depois
 * de escrever no SPA e antes de gravar o evento, o SPA já mostra o estado novo, mas o
 * snapshot não — e o evento sai no reprocessamento. As `dedupeKey`s impedem o
 * segundo evento da mesma decisão (webhook repetido, varredura).
 */

type Source = { kind: 'webhook'; stripeEventId: string } | { kind: 'sweep' }

export class StripeLifecycle {
  constructor(
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly gateway: PaymentGateway,
    private readonly registry: AppRegistry,
    private readonly plans: PlanCatalog,
    private readonly clock: Clock,
  ) {}

  /** App e instalação dos metadados, se o app é atendido por esta plataforma. */
  async resolve(
    metadata: GatewayMetadata | null,
  ): Promise<{ app: RegisteredApp; installation: InstallationView } | null> {
    if (!metadata) return null
    const app = await this.registry.get(metadata.appCode)
    if (!app?.active) return null
    const installation = await this.context.installations.get(
      metadata.installationId,
    )
    if (
      !installation ||
      installation.appCode !== app.appCode ||
      installation.spaItemId === null
    ) {
      raiseAlert(
        'stripe.event_unrouted',
        { metadata },
        'metadados do Stripe apontam para instalação inexistente',
      )
      return null
    }
    return { app, installation }
  }

  /**
   * Roteamento sem metadados (fatura antiga, assinatura criada fora do checkout): pela
   * assinatura do SPA com este id Stripe e a instalação dona dela. Assinatura de app
   * não atendido aqui (ex.: ThinkZap no hub-core) não tem instalação na plataforma.
   */
  async resolveByGateway(
    gatewaySubscriptionId: string,
    metadata: GatewayMetadata | null,
  ): Promise<{ app: RegisteredApp; installation: InstallationView } | null> {
    if (metadata) return this.resolve(metadata)
    const subscription = await this.context.subscriptions.findByGatewayId(
      gatewaySubscriptionId,
    )
    if (!subscription) return null
    const installation = await this.context.installationOf(subscription)
    if (!installation) return null
    const app = await this.registry.get(installation.appCode)
    return app?.active ? { app, installation } : null
  }

  private async previous(subscription: Subscription): Promise<Snapshot> {
    const last = await this.writer.lastSnapshot(subscription.id)
    return last.snapshot ?? snapshotOf(subscription)
  }

  /**
   * Ativação: checkout concluído e primeira fatura paga. Cria ou atualiza o item do
   * SPA 1142 pelo id da assinatura Stripe e encerra o trial corrente (sem evento
   * próprio: o app recebe `subscription.activated` com `previousSubscriptionId`).
   */
  async activate(
    gatewaySubscriptionId: string,
    metadata: GatewayMetadata | null,
  ): Promise<Subscription | null> {
    const state = await this.gateway.readSubscription(gatewaySubscriptionId)
    const target = await this.resolve(metadata ?? state.metadata)
    if (!target) return null
    const { app, installation } = target
    if (state.status !== 'active') {
      logger().info(
        { gatewaySubscriptionId, status: state.rawStatus },
        'assinatura ainda não paga — ativação aguarda',
      )
      return null
    }

    return this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const planId = await this.planIdFor(
          app,
          state,
          (metadata ?? state.metadata)?.planId,
        )
        const existing = await this.context.subscriptions.findByGatewayId(
          gatewaySubscriptionId,
        )
        const others = (
          await this.context.subscriptions.listByInstallation(
            installation.spaItemId as number,
          )
        ).filter(s => s.id !== existing?.id && s.status === 'trialing')
        const previousSubscriptionId = others[0]?.id ?? null
        const patch = {
          planId,
          status: 'active' as const,
          modality: 'stripe' as const,
          periodStart: state.periodStart,
          periodEnd: state.periodEnd,
          gatewaySubscriptionId,
          cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        }

        let subscription: Subscription
        if (existing) {
          subscription = await this.writer.update(
            installation,
            existing,
            patch,
            [
              {
                type: 'subscription.activated',
                data: { previousSubscriptionId },
                dedupeKey: `activated:${existing.id}`,
              },
            ],
          )
        } else {
          const created = await this.writer.create(
            installation,
            {
              title: `${app.name} — ${installation.domain}`,
              installationSpaItemId: installation.spaItemId as number,
              ...patch,
            },
            [],
          )
          // O evento precisa do id do item; segundo passo com a dedupe da ativação.
          subscription = await this.writer.update(installation, created, {}, [
            {
              type: 'subscription.activated',
              data: { previousSubscriptionId },
              dedupeKey: `activated:${created.id}`,
            },
          ])
        }

        for (const trial of others) {
          await this.writer.update(
            installation,
            trial,
            { status: 'cancelled', canceledAt: this.clock.now() },
            [],
          )
        }
        return subscription
      },
    )
  }

  private async planIdFor(
    app: RegisteredApp,
    state: GatewaySubscriptionState,
    fallback?: number,
  ): Promise<number> {
    const priceId = state.items[0]?.priceId
    if (priceId) {
      const plan = await this.plans.planByPrice(app, priceId)
      if (plan) return plan.id
    }
    if (fallback) return fallback
    throw new Error(`Assinatura ${state.id} sem plano identificável`)
  }

  /** `invoice.paid` de ciclo: novo período + `subscription.renewed`. */
  async renew(
    gatewaySubscriptionId: string,
    invoiceId: string | null,
    source: Source,
  ): Promise<void> {
    const state = await this.gateway.readSubscription(gatewaySubscriptionId)
    const existing = await this.context.subscriptions.findByGatewayId(
      gatewaySubscriptionId,
    )
    if (!existing) {
      await this.activate(gatewaySubscriptionId, state.metadata)
      return
    }
    await this.syncExisting(existing, state, source, { invoiceId })
  }

  /** `invoice.payment_failed`: `past_due` + `subscription.past_due` com o link da fatura. */
  async pastDue(
    gatewaySubscriptionId: string,
    invoiceId: string,
    hostedInvoiceUrl: string | null,
  ): Promise<void> {
    const existing = await this.context.subscriptions.findByGatewayId(
      gatewaySubscriptionId,
    )
    if (!existing) return
    const installation = await this.context.installationOf(existing)
    if (!installation) return
    await this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const current =
          (await this.context.subscriptions.get(existing.id)) ?? existing
        const previous = await this.previous(current)
        if (previous.status === 'cancelled') return
        await this.writer.update(
          installation,
          current,
          { status: 'past_due' },
          [
            {
              type: 'subscription.past_due',
              data: { invoiceId, hostedInvoiceUrl },
              dedupeKey: `past_due:${current.id}:${invoiceId}`,
            },
          ],
        )
      },
    )
  }

  /** `customer.subscription.updated`/varredura: reflete status, período, plano e cancelamento agendado. */
  async sync(state: GatewaySubscriptionState, source: Source): Promise<void> {
    const existing = await this.context.subscriptions.findByGatewayId(state.id)
    if (!existing) {
      if (state.status === 'active') {
        const created = await this.activate(state.id, state.metadata)
        if (created && source.kind === 'sweep') {
          raiseAlert(
            'subscription.orphan_created',
            { gatewaySubscriptionId: state.id, subscriptionId: created.id },
            'assinatura Stripe sem item no SPA — item criado',
          )
        }
      }
      return
    }
    await this.syncExisting(existing, state, source, {})
  }

  private async syncExisting(
    existing: Subscription,
    state: GatewaySubscriptionState,
    source: Source,
    context: { invoiceId?: string | null },
  ): Promise<void> {
    const installation = await this.context.installationOf(existing)
    if (!installation) return
    const app = await this.registry.get(installation.appCode)
    if (!app?.active) return

    await this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const current =
          (await this.context.subscriptions.get(existing.id)) ?? existing
        const previous = await this.previous(current)
        const events: PlannedEvent[] = []
        const patch: Parameters<SubscriptionWriter['update']>[2] = {
          periodStart: state.periodStart,
          periodEnd: state.periodEnd,
          cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        }

        const newStart = formatCalendarDate(state.periodStart)
        const periodChanged =
          newStart !== previous.periodStart &&
          state.periodStart > new Date(previous.periodStart)
        const status = state.status

        if (status) patch.status = status

        // Plano mudou no Stripe (upgrade pago ou downgrade efetivado).
        const priceId = state.items[0]?.priceId
        const plan = priceId ? await this.plans.planByPrice(app, priceId) : null
        if (plan && plan.id !== previous.planId) {
          patch.planId = plan.id
          const change = parsePlanChange(state.metadata?.planChange)
          const immediate =
            change?.planId === plan.id && change.effective === 'immediate'
          events.push({
            type: 'subscription.plan_changed',
            data: {
              previousPlanId: previous.planId,
              planId: plan.id,
              effective: immediate ? 'immediate' : 'next_period',
              ...(immediate
                ? { remainingFraction: change.remainingFraction }
                : {}),
            },
            dedupeKey: `plan_changed:${current.id}:${plan.id}:${newStart}`,
          })
        }

        if (status === 'cancelled') {
          patch.canceledAt = this.clock.now()
          if (previous.status !== 'cancelled') {
            events.push({
              type: 'subscription.ended',
              data: { reason: 'cancelled' },
              dedupeKey: `ended:${current.id}`,
            })
          }
        } else if (periodChanged && status === 'active') {
          events.push({
            type: 'subscription.renewed',
            data: {
              invoiceId: context.invoiceId ?? null,
              previousPeriodEnd: new Date(
                previous.periodEnd + 'T23:59:59.999Z',
              ).toISOString(),
            },
            dedupeKey: `renewed:${current.id}:${newStart}`,
          })
        } else if (status === 'active' && previous.status === 'past_due') {
          events.push({
            type: 'subscription.recovered',
            data: {},
            dedupeKey: `recovered:${current.id}:${newStart}:${await this.writer.currentVersion(current.id)}`,
          })
        } else if (
          status === 'past_due' &&
          previous.status === 'active' &&
          source.kind === 'sweep'
        ) {
          // Webhook de falha perdido: a varredura emite o que faltou.
          events.push({
            type: 'subscription.past_due',
            data: { invoiceId: null, hostedInvoiceUrl: null },
            dedupeKey: `past_due:${current.id}:${newStart}:sweep`,
          })
        }

        if (
          state.cancelAtPeriodEnd &&
          !previous.cancelAtPeriodEnd &&
          status !== 'cancelled'
        ) {
          events.push({
            type: 'subscription.cancel_scheduled',
            data: { effectiveAt: state.periodEnd.toISOString() },
            dedupeKey: `cancel_scheduled:${current.id}:${formatCalendarDate(state.periodEnd)}`,
          })
        }

        await this.writer.update(installation, current, patch, events)
      },
    )
  }

  /** `customer.subscription.deleted`: encerramento efetivo. */
  async ended(state: GatewaySubscriptionState): Promise<void> {
    await this.sync(
      { ...state, status: 'cancelled' },
      { kind: 'webhook', stripeEventId: 'deleted' },
    )
  }
}

export type PlanChange = {
  effective: 'immediate' | 'next_period'
  planId: number
  remainingFraction?: number
}

export function parsePlanChange(raw: string | undefined): PlanChange | null {
  if (!raw) return null
  const [effective, planId, fraction] = raw.split(':')
  if (
    (effective !== 'immediate' && effective !== 'next_period') ||
    !Number(planId)
  )
    return null
  return {
    effective,
    planId: Number(planId),
    ...(fraction !== undefined ? { remainingFraction: Number(fraction) } : {}),
  }
}
