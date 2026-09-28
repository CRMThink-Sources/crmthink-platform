import type { SubscriptionStatus } from '../domain/entities'

/**
 * Contrato neutro com o gateway de pagamento, portado de
 * `thinkzap/domain/ports/payment-gateway.port.ts` do hub-core **sem** os tipos do
 * ThinkZap (linhas, providers, `domainId`). O caso de uso recebe eventos já
 * normalizados; o vocabulário do Stripe fica no adapter.
 */

export type CheckoutIntent = 'subscribe' | 'purchase'

/** Metadados em toda sessão, assinatura e pagamento (D8). */
export type GatewayMetadata = {
  appCode: string
  installationId: number
  planId: number
  intent: CheckoutIntent
  /** Troca de plano pedida (`immediate:<planId>:<fraction>` ou `next_period:<planId>`). */
  planChange?: string
}

export type GatewaySubscriptionItemState = {
  itemId: string
  priceId: string
  quantity: number
}

export type GatewaySubscriptionState = {
  id: string
  customerId: string
  /** Status já no vocabulário da SPA; `null` = status do gateway sem mapeamento. */
  status: SubscriptionStatus | null
  rawStatus: string
  periodStart: Date
  periodEnd: Date
  cancelAtPeriodEnd: boolean
  items: GatewaySubscriptionItemState[]
  metadata: GatewayMetadata | null
}

export type GatewayEvent =
  | {
      type: 'checkout.completed'
      sessionId: string
      mode: 'subscription' | 'payment'
      paid: boolean
      metadata: GatewayMetadata | null
      gatewaySubscriptionId: string | null
      paymentIntentId: string | null
      amountTotal: number | null
    }
  | {
      type: 'checkout.expired'
      sessionId: string
      mode: 'subscription' | 'payment'
      metadata: GatewayMetadata | null
    }
  | {
      type: 'invoice.paid'
      invoiceId: string
      gatewaySubscriptionId: string
      billingReason: string | null
      periodStart: Date | null
      periodEnd: Date | null
      amountPaid: number
      metadata: GatewayMetadata | null
    }
  | {
      type: 'invoice.payment_failed'
      invoiceId: string
      gatewaySubscriptionId: string
      hostedInvoiceUrl: string | null
      attemptCount: number
      metadata: GatewayMetadata | null
    }
  | { type: 'subscription.updated'; subscription: GatewaySubscriptionState }
  | { type: 'subscription.deleted'; subscription: GatewaySubscriptionState }
  | {
      type: 'charge.refunded'
      chargeId: string
      paymentIntentId: string | null
      amount: number
      amountRefunded: number
      metadata: GatewayMetadata | null
    }
  | {
      type: 'charge.disputed'
      disputeId: string
      chargeId: string
      paymentIntentId: string | null
      amount: number
      reason: string | null
      metadata: GatewayMetadata | null
    }
  | { type: 'ignored'; name: string }

export type VerifiedGatewayEvent = {
  id: string
  name: string
  event: GatewayEvent
}

export type ChargeOrigin = {
  source: 'invoice'
  invoiceId: string
  gatewaySubscriptionId: string | null
  metadata: GatewayMetadata | null
} | null

export class GatewaySignatureError extends Error {
  constructor(detail: string) {
    super(`Assinatura do evento do gateway inválida: ${detail}`)
    this.name = 'GatewaySignatureError'
  }
}

export class GatewayNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`Stripe não configurado: ${missing} vazio`)
    this.name = 'GatewayNotConfiguredError'
  }
}

export interface PaymentGateway {
  /** Valida `Stripe-Signature` sobre o corpo **cru** e normaliza. */
  verifyWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<VerifiedGatewayEvent>

  createSubscriptionCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
    customerEmail?: string
  }): Promise<{ clientSecret: string; sessionId: string }>

  createPaymentCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
    customerEmail?: string
  }): Promise<{ clientSecret: string; sessionId: string }>

  createBillingPortalSession(
    gatewaySubscriptionId: string,
    returnUrl: string,
  ): Promise<{ url: string }>

  /** `fresh`: ignora o cache de leitura (decisão sob lock que não pode usar estado velho). */
  readSubscription(
    gatewaySubscriptionId: string,
    options?: { fresh?: boolean },
  ): Promise<GatewaySubscriptionState>

  /** Todas as assinaturas (para a varredura), paginadas pelo adapter. */
  listSubscriptions(): AsyncIterable<GatewaySubscriptionState>

  /** Leva a quantidade do item do preço ao valor desejado (estado desejado, idempotente). */
  setItemQuantity(
    gatewaySubscriptionId: string,
    priceId: string,
    quantity: number,
  ): Promise<void>

  /** Upgrade imediato com fatura proporcional; só aplica quando a fatura é paga. */
  upgrade(
    gatewaySubscriptionId: string,
    newPriceId: string,
    planChange: string,
  ): Promise<void>

  /** Downgrade no próximo ciclo (subscription schedule). */
  scheduleDowngrade(
    gatewaySubscriptionId: string,
    newPriceId: string,
    planChange: string,
  ): Promise<void>

  /** Origem de uma cobrança que não é compra avulsa (fatura de assinatura). */
  resolveChargeOrigin(paymentIntentId: string): Promise<ChargeOrigin>

  /** Cobrança de um pagamento avulso (id da charge e valor). */
  paymentCharge(
    paymentIntentId: string,
  ): Promise<{ chargeId: string | null; amount: number }>

  /** Normaliza um evento cru (o worker processa o evento guardado pela API). */
  normalize(rawEvent: unknown): GatewayEvent

  /** Tipo do price: recorrente ou pagamento único (para conferir o cadastro). */
  priceKind(priceId: string): Promise<'recurring' | 'one_time'>
}
