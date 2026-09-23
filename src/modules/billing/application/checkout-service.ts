import z from 'zod'
import { conflict, HttpError, unprocessable } from '@/shared/http/errors'
import type { RegisteredApp } from '@/modules/registry/domain/app'
import type { PaymentGateway } from '../ports/payment-gateway'
import type { BillingContext } from './billing-context'
import type { PlanCatalog } from './plan-catalog'
import type { PurchaseService } from './purchase-service'

export const checkoutRequestSchema = z.object({
  installationId: z.number().int().positive(),
  planId: z.number().int().positive(),
  intent: z.enum(['subscribe', 'purchase']),
  quantity: z.number().int().positive().max(1000).optional(),
})

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

/**
 * `POST /v1/checkout-sessions`: Checkout embutido (o app renderiza com o
 * `clientSecret`). Metadados `{appCode, installationId, planId, intent}` na sessão e
 * na assinatura/pagamento, para os webhooks voltarem à instalação.
 */
export class CheckoutService {
  constructor(
    private readonly context: BillingContext,
    private readonly plans: PlanCatalog,
    private readonly gateway: PaymentGateway,
    private readonly purchases: PurchaseService,
  ) {}

  async create(
    app: RegisteredApp,
    request: CheckoutRequest,
  ): Promise<{ clientSecret: string; sessionId: string; purchaseId?: number }> {
    const installation = await this.context.ownedInstallation(
      app.appCode,
      request.installationId,
    )
    if (installation.status !== 'ACTIVE') {
      throw conflict(
        'INSTALLATION_NOT_ACTIVE',
        `Instalação em ${installation.status}`,
      )
    }
    const plan = await this.plans.planForCheckout(
      app,
      request.planId,
      request.intent,
    )
    const current = await this.context.subscriptions.currentOf(
      installation.spaItemId as number,
    )
    const metadata = {
      appCode: app.appCode,
      installationId: installation.installationId,
      planId: plan.id,
      intent: request.intent,
    }
    const quantity = request.quantity ?? 1

    try {
      if (request.intent === 'subscribe') {
        if (
          current &&
          (current.status === 'active' || current.status === 'past_due')
        ) {
          throw conflict(
            'SUBSCRIPTION_ALREADY_EXISTS',
            'A instalação já tem assinatura paga',
          )
        }
        return await this.gateway.createSubscriptionCheckout({
          priceId: plan.gatewayPriceId,
          quantity,
          metadata,
          customerEmail: installation.contact?.email,
        })
      }

      if (
        !current ||
        (current.status !== 'active' && current.status !== 'trialing')
      ) {
        throw unprocessable(
          'NO_ACTIVE_SUBSCRIPTION',
          'Compra avulsa exige assinatura ativa ou em trial',
        )
      }
      const session = await this.gateway.createPaymentCheckout({
        priceId: plan.gatewayPriceId,
        quantity,
        metadata,
        customerEmail: installation.contact?.email,
      })
      const purchaseId = await this.purchases.registerPending({
        appCode: app.appCode,
        installationId: installation.installationId,
        planId: plan.id,
        quantity,
        checkoutSessionId: session.sessionId,
      })
      return { ...session, purchaseId }
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (
        error instanceof Error &&
        error.name === 'GatewayNotConfiguredError'
      ) {
        throw new HttpError(
          503,
          'PAYMENTS_UNAVAILABLE',
          'Pagamentos indisponíveis neste ambiente',
        )
      }
      throw new HttpError(
        502,
        'GATEWAY_ERROR',
        error instanceof Error ? error.message : 'Falha no gateway',
      )
    }
  }
}
