import type { Subscription } from '../domain/entities'
import type { BillingContext } from './billing-context'
import {
  sameSnapshot,
  snapshotOf,
  type PlannedEvent,
  type SubscriptionWriter,
} from './subscription-writer'

/**
 * Assinaturas `manual` (boleto, Pix, contratos): humanos ou automações externas
 * escrevem no SPA 1142 e a plataforma traduz a mudança no evento do ciclo de vida.
 *
 * A comparação é com o último estado que a plataforma registrou (`last_snapshot`), o
 * que dá o anti-loop de graça: um evento do SPA provocado por escrita própria traz o
 * mesmo estado e não gera nada.
 *
 * Assinaturas `stripe` alteradas no SPA não geram evento aqui: o Stripe é quem manda
 * nelas, e a varredura corrige o SPA.
 */
export class ManualLifecycle {
  constructor(
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
  ) {}

  async apply(subscriptionId: number): Promise<void> {
    const found = await this.context.subscriptions.get(subscriptionId)
    if (!found) return
    const installation = await this.context.installationOf(found)
    if (!installation) return

    await this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const current =
          (await this.context.subscriptions.get(subscriptionId)) ?? found
        const { snapshot: previous } = await this.writer.lastSnapshot(
          current.id,
        )
        const now = snapshotOf(current)
        if (sameSnapshot(previous, now)) return
        if (current.modality !== 'manual') {
          await this.writer.observe(current)
          return
        }
        const events = this.decide(current, previous)
        if (events.length === 0) {
          await this.writer.observe(current)
          return
        }
        await this.writer.update(installation, current, {}, events)
      },
    )
  }

  private decide(
    current: Subscription,
    previous: ReturnType<typeof snapshotOf> | null,
  ): PlannedEvent[] {
    const now = snapshotOf(current)
    const events: PlannedEvent[] = []
    const id = current.id

    if (!previous) {
      if (now.status === 'active') {
        events.push({
          type: 'subscription.activated',
          data: { previousSubscriptionId: null },
          dedupeKey: `activated:${id}`,
        })
      }
      return events
    }

    const extended = now.periodEnd > previous.periodEnd
    const previousPeriodEnd = new Date(
      previous.periodEnd + 'T23:59:59.999Z',
    ).toISOString()

    if (now.status !== previous.status) {
      switch (now.status) {
        case 'active':
          if (previous.status === 'trialing') {
            events.push({
              type: 'subscription.activated',
              data: { previousSubscriptionId: null },
              dedupeKey: `activated:${id}`,
            })
          } else if (extended) {
            events.push({
              type: 'subscription.renewed',
              data: { invoiceId: null, previousPeriodEnd },
              dedupeKey: `renewed:${id}:${now.periodStart}:${now.periodEnd}`,
            })
          } else if (previous.status === 'past_due') {
            events.push({
              type: 'subscription.recovered',
              data: {},
              dedupeKey: `recovered:${id}:${now.periodEnd}`,
            })
          } else {
            events.push({
              type: 'subscription.activated',
              data: { previousSubscriptionId: null },
              dedupeKey: `activated:${id}`,
            })
          }
          break
        case 'past_due':
          events.push({
            type: 'subscription.past_due',
            data: { invoiceId: null, hostedInvoiceUrl: null },
            dedupeKey: `past_due:${id}:${now.periodEnd}`,
          })
          break
        case 'cancelled':
          events.push({
            type: 'subscription.ended',
            data: { reason: 'cancelled' },
            dedupeKey: `ended:${id}`,
          })
          break
        case 'trial_expired':
          events.push({
            type: 'subscription.ended',
            data: { reason: 'trial_expired' },
            dedupeKey: `ended:${id}`,
          })
          break
        case 'trialing':
          break
      }
    } else if (now.status === 'active' && extended) {
      events.push({
        type: 'subscription.renewed',
        data: { invoiceId: null, previousPeriodEnd },
        dedupeKey: `renewed:${id}:${now.periodStart}:${now.periodEnd}`,
      })
    }

    if (now.planId !== previous.planId && now.status !== 'cancelled') {
      events.push({
        type: 'subscription.plan_changed',
        data: {
          previousPlanId: previous.planId,
          planId: now.planId,
          effective: 'immediate',
        },
        dedupeKey: `plan_changed:${id}:${now.planId}:${now.periodStart}`,
      })
    }
    return events
  }

  /** Item `manual` removido do SPA ⇒ `subscription.ended` com `reason = deleted`. */
  async deleted(subscriptionId: number): Promise<void> {
    const { snapshot } = await this.writer.lastSnapshot(subscriptionId)
    if (!snapshot || snapshot.modality !== 'manual') return
    if (snapshot.status === 'cancelled' || snapshot.status === 'trial_expired')
      return
    const installation = await this.context.installations.findBySpaItemId(
      snapshot.installationSpaItemId,
    )
    if (!installation) return
    const ghost: Subscription = {
      id: subscriptionId,
      title: '',
      installationSpaItemId: snapshot.installationSpaItemId,
      planId: snapshot.planId,
      status: 'cancelled',
      modality: 'manual',
      periodStart: new Date(snapshot.periodStart + 'T00:00:00.000Z'),
      periodEnd: new Date(snapshot.periodEnd + 'T23:59:59.999Z'),
      canceledAt: null,
      gatewaySubscriptionId: null,
      cancelAtPeriodEnd: false,
      environment: 'production',
      versionMarker: null,
    }
    await this.context.withInstallationLock(
      installation.installationId,
      async () => {
        // Sem SPA a escrever (o item não existe mais): só versão, snapshot e evento.
        await this.writer.update(installation, ghost, {}, [
          {
            type: 'subscription.ended',
            data: { reason: 'deleted' },
            dedupeKey: `ended:${subscriptionId}`,
          },
        ])
      },
    )
  }
}
