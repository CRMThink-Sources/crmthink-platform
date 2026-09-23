import type { JsonCache } from '@/shared/infra/cache'
import type {
  ChargeOrigin,
  GatewayMetadata,
  GatewaySubscriptionState,
  PaymentGateway,
  VerifiedGatewayEvent,
} from '../../ports/payment-gateway'

/**
 * Leitura de assinatura do gateway em cache curto, descartada depois de toda escrita
 * que muda a assinatura. Decorator, e não invalidação em cada caso de uso, pelo mesmo
 * motivo do `cache-invalidating-payment.gateway.ts` do hub-core: um chamador novo não
 * tem como esquecer.
 *
 * O cache guarda o estado serializado; datas voltam como `Date` na leitura.
 */
const TTL_SECONDS = 60
const key = (id: string) => `billing:gateway-subscription:v1:${id}`

type Serialized = Omit<
  GatewaySubscriptionState,
  'periodStart' | 'periodEnd'
> & {
  periodStart: string
  periodEnd: string
}

export class CacheInvalidatingPaymentGateway implements PaymentGateway {
  constructor(
    private readonly inner: PaymentGateway,
    private readonly cache: JsonCache,
  ) {}

  private async invalidate(id: string): Promise<void> {
    await this.cache.del(key(id))
  }

  verifyWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<VerifiedGatewayEvent> {
    return this.inner.verifyWebhookEvent(rawBody, signature)
  }

  createSubscriptionCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
    customerEmail?: string
  }): Promise<{ clientSecret: string; sessionId: string }> {
    return this.inner.createSubscriptionCheckout(input)
  }

  createPaymentCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
    customerEmail?: string
  }): Promise<{ clientSecret: string; sessionId: string }> {
    return this.inner.createPaymentCheckout(input)
  }

  createBillingPortalSession(
    id: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    return this.inner.createBillingPortalSession(id, returnUrl)
  }

  async readSubscription(
    id: string,
    options?: { fresh?: boolean },
  ): Promise<GatewaySubscriptionState> {
    const cached = options?.fresh
      ? null
      : await this.cache.get<Serialized>(key(id))
    if (cached) {
      return {
        ...cached,
        periodStart: new Date(cached.periodStart),
        periodEnd: new Date(cached.periodEnd),
      }
    }
    const state = await this.inner.readSubscription(id)
    await this.cache.set(key(id), state, TTL_SECONDS)
    return state
  }

  listSubscriptions(): AsyncIterable<GatewaySubscriptionState> {
    return this.inner.listSubscriptions()
  }

  async setItemQuantity(
    id: string,
    priceId: string,
    quantity: number,
  ): Promise<void> {
    await this.inner.setItemQuantity(id, priceId, quantity)
    await this.invalidate(id)
  }

  async upgrade(
    id: string,
    newPriceId: string,
    planChange: string,
  ): Promise<void> {
    await this.inner.upgrade(id, newPriceId, planChange)
    await this.invalidate(id)
  }

  async scheduleDowngrade(
    id: string,
    newPriceId: string,
    planChange: string,
  ): Promise<void> {
    await this.inner.scheduleDowngrade(id, newPriceId, planChange)
    await this.invalidate(id)
  }

  resolveChargeOrigin(paymentIntentId: string): Promise<ChargeOrigin> {
    return this.inner.resolveChargeOrigin(paymentIntentId)
  }

  paymentCharge(
    paymentIntentId: string,
  ): Promise<{ chargeId: string | null; amount: number }> {
    return this.inner.paymentCharge(paymentIntentId)
  }

  normalize(rawEvent: unknown) {
    return this.inner.normalize(rawEvent)
  }

  priceKind(priceId: string): Promise<'recurring' | 'one_time'> {
    return this.inner.priceKind(priceId)
  }

  /** Webhook de assinatura chegou: a leitura em cache está velha. */
  async onSubscriptionChanged(id: string): Promise<void> {
    await this.invalidate(id)
  }
}
