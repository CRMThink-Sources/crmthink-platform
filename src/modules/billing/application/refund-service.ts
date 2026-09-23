import type { Db } from '@/shared/infra/prisma'
import { raiseAlert } from '@/shared/observability/alert'
import type { InstallationView } from '@/modules/installations/ports'
import type { Subscription } from '../domain/entities'
import type { PaymentGateway } from '../ports/payment-gateway'
import type { BillingContext } from './billing-context'
import type { SubscriptionWriter } from './subscription-writer'

/**
 * Estornos e contestações. A plataforma só informa: o efeito sobre créditos ou acesso
 * é decisão de cada app.
 */

type Origin =
  | {
      source: 'purchase'
      purchaseId: number
      installation: InstallationView
      subscription: Subscription | null
    }
  | {
      source: 'invoice'
      invoiceId: string
      installation: InstallationView
      subscription: Subscription | null
    }

export class RefundService {
  constructor(
    private readonly db: Db,
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly gateway: PaymentGateway,
  ) {}

  /** Compra avulsa (pelo registro local) ou fatura de assinatura (pelo Stripe). */
  private async origin(
    chargeId: string,
    paymentIntentId: string | null,
  ): Promise<Origin | null> {
    const purchase = await this.db.purchase.findFirst({
      where: {
        OR: [{ chargeId }, ...(paymentIntentId ? [{ paymentIntentId }] : [])],
      },
    })
    if (purchase) {
      const installation = await this.context.installations.get(
        purchase.installationId,
      )
      if (!installation) return null
      const subscription = installation.spaItemId
        ? await this.context.subscriptions.currentOf(installation.spaItemId)
        : null
      return {
        source: 'purchase',
        purchaseId: purchase.id,
        installation,
        subscription,
      }
    }

    if (!paymentIntentId) return null
    const invoice = await this.gateway.resolveChargeOrigin(paymentIntentId)
    if (!invoice?.gatewaySubscriptionId) return null
    const subscription = await this.context.subscriptions.findByGatewayId(
      invoice.gatewaySubscriptionId,
    )
    const installation = subscription
      ? await this.context.installationOf(subscription)
      : invoice.metadata
        ? await this.context.installations.get(invoice.metadata.installationId)
        : null
    if (!installation) return null
    return {
      source: 'invoice',
      invoiceId: invoice.invoiceId,
      installation,
      subscription,
    }
  }

  private originData(origin: Origin): Record<string, unknown> {
    return origin.source === 'purchase'
      ? { source: 'purchase', purchaseId: origin.purchaseId }
      : { source: 'invoice', invoiceId: origin.invoiceId }
  }

  async refunded(input: {
    stripeEventId: string
    chargeId: string
    paymentIntentId: string | null
    amount: number
    amountRefunded: number
  }): Promise<void> {
    const origin = await this.origin(input.chargeId, input.paymentIntentId)
    if (!origin) {
      raiseAlert(
        'charge.unknown_origin',
        { chargeId: input.chargeId, kind: 'refund' },
        'estorno de cobrança sem origem conhecida',
      )
      return
    }
    if (origin.source === 'purchase') {
      await this.db.purchase.update({
        where: { id: origin.purchaseId },
        data: {
          amountRefunded: input.amountRefunded,
          status:
            input.amountRefunded >= input.amount
              ? 'refunded'
              : 'partially_refunded',
        },
      })
    }
    await this.writer.emitWithoutChange(
      origin.installation,
      origin.subscription,
      {
        type: 'charge.refunded',
        data: {
          chargeId: input.chargeId,
          ...this.originData(origin),
          amountRefunded: input.amountRefunded,
          amount: input.amount,
        },
        dedupeKey: `charge.refunded:${input.stripeEventId}`,
      },
    )
  }

  async disputed(input: {
    disputeId: string
    chargeId: string
    paymentIntentId: string | null
    amount: number
    reason: string | null
  }): Promise<void> {
    const origin = await this.origin(input.chargeId, input.paymentIntentId)
    if (!origin) {
      raiseAlert(
        'charge.unknown_origin',
        { chargeId: input.chargeId, kind: 'dispute' },
        'contestação de cobrança sem origem conhecida',
      )
      return
    }
    if (origin.source === 'purchase') {
      await this.db.purchase.update({
        where: { id: origin.purchaseId },
        data: { status: 'disputed' },
      })
    }
    raiseAlert(
      'charge.disputed',
      {
        chargeId: input.chargeId,
        disputeId: input.disputeId,
        appCode: origin.installation.appCode,
        reason: input.reason,
      },
      'cobrança contestada no emissor do cartão',
    )
    await this.writer.emitWithoutChange(
      origin.installation,
      origin.subscription,
      {
        type: 'charge.disputed',
        data: {
          chargeId: input.chargeId,
          disputeId: input.disputeId,
          ...this.originData(origin),
          amount: input.amount,
          reason: input.reason,
        },
        dedupeKey: `charge.disputed:${input.disputeId}`,
      },
    )
  }
}
