import type { Db } from '@/shared/infra/prisma'
import { QUEUES, type JobQueue } from '@/shared/infra/queue'
import { logger } from '@/shared/observability/logger'
import { metrics } from '@/shared/observability/metrics'
import { raiseAlert } from '@/shared/observability/alert'
import { runWithLogContext } from '@/shared/observability/log-context'
import {
  GatewaySignatureError,
  type GatewayEvent,
  type PaymentGateway,
} from '../ports/payment-gateway'
import type { PurchaseService } from './purchase-service'
import type { RefundService } from './refund-service'
import type { StripeLifecycle } from './stripe-lifecycle'

/**
 * Webhook Stripe único da plataforma.
 *
 * A API só verifica a assinatura sobre o corpo cru, registra o `event.id` em
 * `stripe_event` e enfileira — responde 200 rápido. O worker processa cada evento uma
 * vez (retry com backoff; esgotado, dead-letter + alerta).
 */

export type ReceiveResult =
  | { status: 200; outcome: 'queued' | 'duplicate' | 'ignored' }
  | { status: 400; error: string }

export class StripeWebhookIngest {
  constructor(
    private readonly db: Db,
    private readonly gateway: PaymentGateway,
    private readonly queue: JobQueue,
  ) {}

  async receive(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<ReceiveResult> {
    let verified
    try {
      verified = await this.gateway.verifyWebhookEvent(rawBody, signature)
    } catch (error) {
      if (error instanceof GatewaySignatureError) {
        metrics.stripeWebhookFailures.inc({ reason: 'signature' })
        logger().warn({ err: error }, 'webhook Stripe com assinatura inválida')
        return { status: 400, error: 'invalid signature' }
      }
      throw error
    }

    const existing = await this.db.stripeEvent.findUnique({
      where: { eventId: verified.id },
    })
    if (
      existing &&
      existing.status !== 'received' &&
      existing.status !== 'failed'
    ) {
      return { status: 200, outcome: 'duplicate' }
    }

    if (verified.event.type === 'ignored') {
      if (!existing) {
        await this.db.stripeEvent.create({
          data: {
            eventId: verified.id,
            type: verified.name,
            status: 'ignored',
            processedAt: new Date(),
          },
        })
      }
      return { status: 200, outcome: 'ignored' }
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as object
    if (!existing) {
      await this.db.stripeEvent.create({
        data: {
          eventId: verified.id,
          type: verified.name,
          status: 'received',
          payload,
        },
      })
    }
    await this.queue.add(
      QUEUES.stripeEvents,
      verified.name,
      { eventId: verified.id },
      { jobId: verified.id },
    )
    return { status: 200, outcome: existing ? 'duplicate' : 'queued' }
  }
}

export class StripeEventProcessor {
  constructor(
    private readonly db: Db,
    private readonly gateway: PaymentGateway,
    private readonly lifecycle: StripeLifecycle,
    private readonly purchases: PurchaseService,
    private readonly refunds: RefundService,
    private readonly onSubscriptionChanged: (
      id: string,
    ) => Promise<void> = async () => {},
  ) {}

  async process(eventId: string): Promise<'processed' | 'ignored' | 'skipped'> {
    const row = await this.db.stripeEvent.findUnique({ where: { eventId } })
    if (
      !row ||
      row.status === 'processed' ||
      row.status === 'ignored' ||
      !row.payload
    )
      return 'skipped'

    return runWithLogContext({ eventId }, async () => {
      const event = this.gateway.normalize(row.payload)
      await this.db.stripeEvent.update({
        where: { eventId },
        data: { attempts: { increment: 1 } },
      })
      const outcome = await this.dispatch(eventId, event)
      await this.db.stripeEvent.update({
        where: { eventId },
        data: {
          status: outcome.handled ? 'processed' : 'ignored',
          appCode: outcome.appCode,
          processedAt: new Date(),
          error: null,
        },
      })
      return outcome.handled ? 'processed' : 'ignored'
    })
  }

  /** Esgotadas as tentativas do job. */
  async markDead(eventId: string, error: string): Promise<void> {
    await this.db.stripeEvent.updateMany({
      where: { eventId },
      data: { status: 'dead', error },
    })
    metrics.stripeWebhookFailures.inc({ reason: 'dead_letter' })
    raiseAlert(
      'stripe.dead_letter',
      { eventId, error },
      'evento Stripe esgotou as tentativas de processamento',
    )
  }

  async markFailedAttempt(eventId: string, error: string): Promise<void> {
    await this.db.stripeEvent.updateMany({
      where: { eventId },
      data: { status: 'failed', error },
    })
  }

  private async dispatch(
    stripeEventId: string,
    event: GatewayEvent,
  ): Promise<{ handled: boolean; appCode: string | null }> {
    const source = { kind: 'webhook' as const, stripeEventId }
    switch (event.type) {
      case 'checkout.completed': {
        const target = await this.lifecycle.resolve(event.metadata)
        if (!target)
          return { handled: false, appCode: event.metadata?.appCode ?? null }
        if (event.mode === 'payment') {
          await this.purchases.confirm(event)
        } else if (event.paid && event.gatewaySubscriptionId) {
          await this.lifecycle.activate(
            event.gatewaySubscriptionId,
            event.metadata,
          )
        }
        return { handled: true, appCode: target.app.appCode }
      }
      case 'checkout.expired': {
        const target = await this.lifecycle.resolve(event.metadata)
        if (!target)
          return { handled: false, appCode: event.metadata?.appCode ?? null }
        if (event.mode === 'payment')
          await this.purchases.expire(event.sessionId)
        return { handled: true, appCode: target.app.appCode }
      }
      case 'invoice.paid': {
        const target = await this.lifecycle.resolveByGateway(
          event.gatewaySubscriptionId,
          event.metadata,
        )
        if (!target)
          return { handled: false, appCode: event.metadata?.appCode ?? null }
        await this.onSubscriptionChanged(event.gatewaySubscriptionId)
        if (event.billingReason === 'subscription_create') {
          await this.lifecycle.activate(
            event.gatewaySubscriptionId,
            event.metadata,
          )
        } else {
          await this.lifecycle.renew(
            event.gatewaySubscriptionId,
            event.invoiceId,
            source,
          )
        }
        return { handled: true, appCode: target.app.appCode }
      }
      case 'invoice.payment_failed': {
        const target = await this.lifecycle.resolveByGateway(
          event.gatewaySubscriptionId,
          event.metadata,
        )
        if (!target)
          return { handled: false, appCode: event.metadata?.appCode ?? null }
        await this.onSubscriptionChanged(event.gatewaySubscriptionId)
        await this.lifecycle.pastDue(
          event.gatewaySubscriptionId,
          event.invoiceId,
          event.hostedInvoiceUrl,
        )
        return { handled: true, appCode: target.app.appCode }
      }
      case 'subscription.updated':
      case 'subscription.deleted': {
        const target = await this.lifecycle.resolveByGateway(
          event.subscription.id,
          event.subscription.metadata,
        )
        if (!target)
          return {
            handled: false,
            appCode: event.subscription.metadata?.appCode ?? null,
          }
        await this.onSubscriptionChanged(event.subscription.id)
        // O estado do evento pode estar velho (eventos fora de ordem): relê o atual.
        const state =
          event.type === 'subscription.deleted'
            ? { ...event.subscription, status: 'cancelled' as const }
            : await this.gateway.readSubscription(event.subscription.id)
        await this.lifecycle.sync(state, source)
        return { handled: true, appCode: target.app.appCode }
      }
      case 'charge.refunded':
        await this.refunds.refunded({ stripeEventId, ...event })
        return { handled: true, appCode: null }
      case 'charge.disputed':
        await this.refunds.disputed(event)
        return { handled: true, appCode: null }
      case 'ignored':
        return { handled: false, appCode: null }
    }
  }
}
