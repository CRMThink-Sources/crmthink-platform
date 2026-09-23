import Stripe from 'stripe'
import type { SubscriptionStatus } from '../../domain/entities'
import {
  GatewayNotConfiguredError,
  GatewaySignatureError,
  type ChargeOrigin,
  type GatewayEvent,
  type GatewayMetadata,
  type GatewaySubscriptionState,
  type PaymentGateway,
  type VerifiedGatewayEvent,
} from '../../ports/payment-gateway'

/**
 * Adapter do Stripe, portado de `stripe-payment.gateway.ts` do hub-core e ampliado
 * para os eventos da plataforma (faturas, compras avulsas, estornos, contestações).
 *
 * Status Stripe → SPA (D10, como `handle-gateway-webhook-event.ts`):
 * `active`/`trialing` → `active`; `past_due`/`unpaid`/`incomplete`/
 * `incomplete_expired`/`paused` → `past_due`; `canceled` → `cancelled`. Status fora
 * do mapa não entra num default (assumir `active` destravaria acesso).
 */
export const STATUS_BY_STRIPE_STATUS: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'past_due',
  incomplete_expired: 'past_due',
  paused: 'past_due',
  canceled: 'cancelled',
}

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
])

export class StripeWrongKeyTypeError extends Error {
  constructor(prefix: string) {
    super(
      `STRIPE_SECRET_KEY começa com "${prefix}" (chave publicável); use sk_ ou rk_`,
    )
    this.name = 'StripeWrongKeyTypeError'
  }
}

const idOf = (
  value: string | { id: string } | null | undefined,
): string | null =>
  value == null ? null : typeof value === 'string' ? value : value.id

/** Metadados da plataforma, ou `null` se incompletos (três campos juntos ou nada). */
export function readMetadata(
  metadata: Stripe.Metadata | null | undefined,
): GatewayMetadata | null {
  const appCode = metadata?.appCode
  const installationId = Number(metadata?.installationId)
  const planId = Number(metadata?.planId)
  const intent = metadata?.intent
  if (
    !appCode ||
    !Number.isInteger(installationId) ||
    !Number.isInteger(planId)
  )
    return null
  if (intent !== 'subscribe' && intent !== 'purchase') return null
  return {
    appCode,
    installationId,
    planId,
    intent,
    ...(metadata?.planChange ? { planChange: metadata.planChange } : {}),
  }
}

function toMetadataParam(metadata: GatewayMetadata): Stripe.MetadataParam {
  return {
    appCode: metadata.appCode,
    installationId: String(metadata.installationId),
    planId: String(metadata.planId),
    intent: metadata.intent,
  }
}

/** Período tolerante a onde a API o coloca (assinatura ou item), como `read-subscription-period.ts`. */
function readPeriod(subscription: Stripe.Subscription): {
  start: Date
  end: Date
} {
  const raw = subscription as unknown as {
    current_period_start?: number
    current_period_end?: number
  }
  const item = subscription.items?.data?.[0]
  const start = raw.current_period_start ?? item?.current_period_start
  const end = raw.current_period_end ?? item?.current_period_end
  if (!start || !end) {
    throw new Error(
      `Assinatura ${subscription.id} do gateway sem período de cobrança`,
    )
  }
  return { start: new Date(start * 1000), end: new Date(end * 1000) }
}

export function toSubscriptionState(
  subscription: Stripe.Subscription,
): GatewaySubscriptionState {
  const period = readPeriod(subscription)
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer) ?? '',
    status: STATUS_BY_STRIPE_STATUS[subscription.status] ?? null,
    rawStatus: subscription.status,
    periodStart: period.start,
    periodEnd: period.end,
    cancelAtPeriodEnd: Boolean(
      subscription.cancel_at_period_end || subscription.cancel_at,
    ),
    items: subscription.items.data.map(item => ({
      itemId: item.id,
      priceId: item.price.id,
      quantity: item.quantity ?? 0,
    })),
    metadata: readMetadata(subscription.metadata),
  }
}

function invoiceSubscription(invoice: Stripe.Invoice): {
  id: string | null
  metadata: GatewayMetadata | null
} {
  const details = invoice.parent?.subscription_details
  return {
    id: idOf(details?.subscription),
    metadata: readMetadata(details?.metadata ?? null),
  }
}

export class StripePaymentGateway implements PaymentGateway {
  private readonly stripe: Stripe | null

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    stripe?: Stripe,
  ) {
    if (stripe) {
      this.stripe = stripe
    } else if (secretKey) {
      if (!secretKey.startsWith('sk_') && !secretKey.startsWith('rk_')) {
        throw new StripeWrongKeyTypeError(secretKey.slice(0, 3))
      }
      this.stripe = new Stripe(secretKey)
    } else {
      this.stripe = null
    }
  }

  private client(): Stripe {
    if (!this.stripe) throw new GatewayNotConfiguredError('STRIPE_SECRET_KEY')
    return this.stripe
  }

  async verifyWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<VerifiedGatewayEvent> {
    if (!this.webhookSecret)
      throw new GatewaySignatureError('STRIPE_WEBHOOK_SECRET não configurado')
    if (!signature)
      throw new GatewaySignatureError('cabeçalho stripe-signature ausente')
    let event: Stripe.Event
    try {
      event = this.client().webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      )
    } catch (error) {
      throw new GatewaySignatureError(
        error instanceof Error ? error.message : 'falha na validação',
      )
    }
    return { id: event.id, name: event.type, event: this.normalize(event) }
  }

  /** Normalização pura do evento (sem chamadas de rede): o processamento é assíncrono. */
  normalize(rawEvent: unknown): GatewayEvent {
    const event = rawEvent as Stripe.Event
    if (!HANDLED_EVENTS.has(event.type))
      return { type: 'ignored', name: event.type }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.expired': {
        const session = event.data.object
        const mode = session.mode === 'payment' ? 'payment' : 'subscription'
        if (event.type === 'checkout.session.expired') {
          return {
            type: 'checkout.expired',
            sessionId: session.id,
            mode,
            metadata: readMetadata(session.metadata),
          }
        }
        return {
          type: 'checkout.completed',
          sessionId: session.id,
          mode,
          paid:
            session.payment_status === 'paid' ||
            session.payment_status === 'no_payment_required',
          metadata: readMetadata(session.metadata),
          gatewaySubscriptionId: idOf(session.subscription),
          paymentIntentId: idOf(session.payment_intent),
          amountTotal: session.amount_total ?? null,
        }
      }
      case 'invoice.paid': {
        const invoice = event.data.object
        const subscription = invoiceSubscription(invoice)
        if (!subscription.id) return { type: 'ignored', name: event.type }
        const line =
          invoice.lines?.data?.find(l => l.period) ?? invoice.lines?.data?.[0]
        return {
          type: 'invoice.paid',
          invoiceId: invoice.id ?? '',
          gatewaySubscriptionId: subscription.id,
          billingReason: invoice.billing_reason ?? null,
          periodStart: line?.period ? new Date(line.period.start * 1000) : null,
          periodEnd: line?.period ? new Date(line.period.end * 1000) : null,
          amountPaid: invoice.amount_paid,
          metadata: subscription.metadata,
        }
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object
        const subscription = invoiceSubscription(invoice)
        if (!subscription.id) return { type: 'ignored', name: event.type }
        return {
          type: 'invoice.payment_failed',
          invoiceId: invoice.id ?? '',
          gatewaySubscriptionId: subscription.id,
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
          attemptCount: invoice.attempt_count ?? 0,
          metadata: subscription.metadata,
        }
      }
      case 'customer.subscription.updated':
        return {
          type: 'subscription.updated',
          subscription: toSubscriptionState(event.data.object),
        }
      case 'customer.subscription.deleted':
        return {
          type: 'subscription.deleted',
          subscription: toSubscriptionState(event.data.object),
        }
      case 'charge.refunded': {
        const charge = event.data.object
        return {
          type: 'charge.refunded',
          chargeId: charge.id,
          paymentIntentId: idOf(charge.payment_intent),
          amount: charge.amount,
          amountRefunded: charge.amount_refunded,
          metadata: readMetadata(charge.metadata),
        }
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object
        return {
          type: 'charge.disputed',
          disputeId: dispute.id,
          chargeId: idOf(dispute.charge) ?? '',
          paymentIntentId: idOf(dispute.payment_intent),
          amount: dispute.amount,
          reason: dispute.reason ?? null,
          metadata: readMetadata(dispute.metadata),
        }
      }
      default:
        return { type: 'ignored', name: event.type }
    }
  }

  private async createCheckout(
    mode: 'subscription' | 'payment',
    input: {
      priceId: string
      quantity: number
      metadata: GatewayMetadata
      customerEmail?: string
    },
  ): Promise<{ clientSecret: string; sessionId: string }> {
    const metadata = toMetadataParam(input.metadata)
    const session = await this.client().checkout.sessions.create({
      mode,
      // Embutido: o app vive no iframe do Bitrix, onde a página hospedada não monta.
      ui_mode: 'embedded_page',
      redirect_on_completion: 'never',
      payment_method_types: ['card'],
      currency: 'brl',
      line_items: [{ price: input.priceId, quantity: input.quantity }],
      metadata,
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      ...(mode === 'subscription'
        ? { subscription_data: { metadata } }
        : {
            payment_intent_data: { metadata },
            customer_creation: 'always' as const,
          }),
    })
    if (!session.client_secret)
      throw new Error('Stripe não devolveu o client_secret da sessão embutida')
    return { clientSecret: session.client_secret, sessionId: session.id }
  }

  createSubscriptionCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
    customerEmail?: string
  }): Promise<{ clientSecret: string; sessionId: string }> {
    return this.createCheckout('subscription', input)
  }

  createPaymentCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
    customerEmail?: string
  }): Promise<{ clientSecret: string; sessionId: string }> {
    return this.createCheckout('payment', input)
  }

  async createBillingPortalSession(
    gatewaySubscriptionId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    // Cliente resolvido pela assinatura no servidor; a tela nunca manda id de cliente.
    const subscription = await this.client().subscriptions.retrieve(
      gatewaySubscriptionId,
    )
    const session = await this.client().billingPortal.sessions.create({
      customer: idOf(subscription.customer) ?? '',
      return_url: returnUrl,
    })
    return { url: session.url }
  }

  async readSubscription(
    gatewaySubscriptionId: string,
  ): Promise<GatewaySubscriptionState> {
    return toSubscriptionState(
      await this.client().subscriptions.retrieve(gatewaySubscriptionId),
    )
  }

  async *listSubscriptions(): AsyncIterable<GatewaySubscriptionState> {
    for await (const subscription of this.client().subscriptions.list({
      status: 'all',
      limit: 100,
    })) {
      yield toSubscriptionState(subscription)
    }
  }

  async setItemQuantity(
    gatewaySubscriptionId: string,
    priceId: string,
    quantity: number,
  ): Promise<void> {
    const subscription = await this.client().subscriptions.retrieve(
      gatewaySubscriptionId,
    )
    const item = subscription.items.data.find(i => i.price.id === priceId)
    if (item && item.quantity === quantity) return
    await this.client().subscriptions.update(gatewaySubscriptionId, {
      items: [item ? { id: item.id, quantity } : { price: priceId, quantity }],
    })
  }

  async upgrade(
    gatewaySubscriptionId: string,
    newPriceId: string,
    planChange: string,
  ): Promise<void> {
    const client = this.client()
    const subscription = await client.subscriptions.retrieve(
      gatewaySubscriptionId,
    )
    const item = subscription.items.data[0]
    if (!item) throw new Error(`Assinatura ${gatewaySubscriptionId} sem itens`)
    // Metadados antes: com `pending_if_incomplete` o update só aceita itens/proration.
    await client.subscriptions.update(gatewaySubscriptionId, {
      metadata: { ...subscription.metadata, planChange },
    })
    await client.subscriptions.update(gatewaySubscriptionId, {
      items: [{ id: item.id, price: newPriceId, quantity: item.quantity ?? 1 }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    })
  }

  async scheduleDowngrade(
    gatewaySubscriptionId: string,
    newPriceId: string,
    planChange: string,
  ): Promise<void> {
    const client = this.client()
    const subscription = await client.subscriptions.retrieve(
      gatewaySubscriptionId,
    )
    const item = subscription.items.data[0]
    if (!item) throw new Error(`Assinatura ${gatewaySubscriptionId} sem itens`)
    const period = readPeriod(subscription)
    await client.subscriptions.update(gatewaySubscriptionId, {
      metadata: { ...subscription.metadata, planChange },
    })
    const newPrice = await client.prices.retrieve(newPriceId)
    if (!newPrice.recurring)
      throw new Error(`Price ${newPriceId} não é recorrente`)
    const scheduleId =
      idOf(subscription.schedule) ??
      (
        await client.subscriptionSchedules.create({
          from_subscription: gatewaySubscriptionId,
        })
      ).id
    await client.subscriptionSchedules.update(scheduleId, {
      end_behavior: 'release',
      phases: [
        {
          items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
          start_date: Math.floor(period.start.getTime() / 1000),
          end_date: Math.floor(period.end.getTime() / 1000),
        },
        {
          items: [{ price: newPriceId, quantity: item.quantity ?? 1 }],
          // Um ciclo do preço novo; com `release`, a assinatura segue nele depois.
          duration: {
            interval: newPrice.recurring.interval,
            interval_count: newPrice.recurring.interval_count,
          },
        },
      ],
    })
  }

  async resolveChargeOrigin(paymentIntentId: string): Promise<ChargeOrigin> {
    const client = this.client()
    const payments = await client.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: paymentIntentId },
      limit: 1,
    })
    const invoiceId = idOf(payments.data[0]?.invoice)
    if (!invoiceId) return null
    const invoice = await client.invoices.retrieve(invoiceId)
    const subscription = invoiceSubscription(invoice)
    return {
      source: 'invoice',
      invoiceId,
      gatewaySubscriptionId: subscription.id,
      metadata: subscription.metadata,
    }
  }

  async paymentCharge(
    paymentIntentId: string,
  ): Promise<{ chargeId: string | null; amount: number }> {
    const intent = await this.client().paymentIntents.retrieve(paymentIntentId)
    return {
      chargeId: idOf(intent.latest_charge),
      amount: intent.amount_received || intent.amount,
    }
  }

  async priceKind(priceId: string): Promise<'recurring' | 'one_time'> {
    const price = await this.client().prices.retrieve(priceId)
    return price.recurring ? 'recurring' : 'one_time'
  }
}
