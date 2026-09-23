import type { Db } from '@/shared/infra/prisma'
import { logger } from '@/shared/observability/logger'
import type { GatewayMetadata, PaymentGateway } from '../ports/payment-gateway'
import type { BillingContext } from './billing-context'
import type { SubscriptionWriter } from './subscription-writer'

/**
 * Compras avulsas (Stripe Checkout `mode=payment`). O registro nasce `pending` na
 * criação da sessão e fica `paid` uma única vez, pela sessão (`checkout_session_id`
 * é único e a transição só sai de `pending`).
 */
export class PurchaseService {
  constructor(
    private readonly db: Db,
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly gateway: PaymentGateway,
  ) {}

  async registerPending(input: {
    appCode: string
    installationId: number
    planId: number
    quantity: number
    checkoutSessionId: string
  }): Promise<number> {
    const row = await this.db.purchase.create({
      data: { ...input, status: 'pending' },
    })
    return row.id
  }

  async confirm(input: {
    sessionId: string
    paid: boolean
    paymentIntentId: string | null
    amountTotal: number | null
    metadata: GatewayMetadata | null
  }): Promise<void> {
    if (!input.paid) return
    let purchase = await this.db.purchase.findUnique({
      where: { checkoutSessionId: input.sessionId },
    })
    if (!purchase && input.metadata) {
      // Sessão criada, registro local perdido: recria a partir dos metadados.
      purchase = await this.db.purchase.create({
        data: {
          appCode: input.metadata.appCode,
          installationId: input.metadata.installationId,
          planId: input.metadata.planId,
          quantity: 1,
          checkoutSessionId: input.sessionId,
          status: 'pending',
        },
      })
    }
    if (!purchase || purchase.status !== 'pending') return

    const installation = await this.context.installations.get(
      purchase.installationId,
    )
    if (!installation) {
      logger().warn(
        { purchaseId: purchase.id },
        'compra de instalação inexistente',
      )
      return
    }

    const charge = input.paymentIntentId
      ? await this.gateway.paymentCharge(input.paymentIntentId)
      : { chargeId: null, amount: input.amountTotal ?? 0 }

    const updated = await this.db.purchase.updateMany({
      where: { id: purchase.id, status: 'pending' },
      data: {
        status: 'paid',
        chargeId: charge.chargeId,
        paymentIntentId: input.paymentIntentId,
        amount: input.amountTotal ?? charge.amount,
      },
    })
    if (updated.count === 0) return

    const subscription = installation.spaItemId
      ? await this.context.subscriptions.currentOf(installation.spaItemId)
      : null
    await this.writer.emitWithoutChange(installation, subscription, {
      type: 'purchase.paid',
      data: {
        purchaseId: purchase.id,
        planId: purchase.planId,
        quantity: purchase.quantity,
        chargeId: charge.chargeId,
        amount: input.amountTotal ?? charge.amount,
      },
      dedupeKey: `purchase.paid:${purchase.id}`,
    })
  }

  /** Sessão expirou sem pagamento: `expired`, sem evento. */
  async expire(sessionId: string): Promise<void> {
    await this.db.purchase.updateMany({
      where: { checkoutSessionId: sessionId, status: 'pending' },
      data: { status: 'expired' },
    })
  }
}
