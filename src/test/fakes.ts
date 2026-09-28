import { buildEnv, type Env } from '@/config/env'
import { BitrixApiError } from '@/shared/bitrix/bitrix-errors'
import type {
  BitrixCaller,
  BitrixParams,
  BitrixRestClient,
} from '@/shared/bitrix/bitrix-rest.client'
import type {
  BitrixOAuth,
  OAuthTokens,
} from '@/shared/bitrix/bitrix-oauth.client'
import type { Clock } from '@/shared/clock'
import type { LockStore } from '@/shared/infra/redis'
import type {
  ChargeOrigin,
  GatewayEvent,
  GatewayMetadata,
  GatewaySubscriptionState,
  PaymentGateway,
  VerifiedGatewayEvent,
} from '@/modules/billing/ports/payment-gateway'

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

export function testEnv(overrides: Record<string, string> = {}): Env {
  return buildEnv({
    PUBLIC_BASE_URL: 'https://platform.test',
    PLATFORM_ENVIRONMENT: 'homolog',
    REDIS_URL: 'redis://localhost:6379',
    TOKEN_ENCRYPTION_KEY: TEST_KEY,
    STRIPE_SECRET_KEY: '',
    CRMTHINK_WEBHOOK_URL: 'https://crmthink.bitrix24.com.br/rest/1/abc/',
    CRMTHINK_APPLICATION_TOKEN: 'crm-app-token',
    ADMIN_API_TOKENS: 'admin-token',
    SESSION_CORS_ORIGINS: 'crmthink.gptmaker=https://gptmaker.app',
    ...overrides,
  })
}

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-09-01T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current)
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

export class FakeLocks implements LockStore {
  readonly held = new Map<string, string>()
  async set(key: string, value: string): Promise<'OK' | null> {
    if (this.held.has(key)) return null
    this.held.set(key, value)
    return 'OK'
  }
  async eval(
    _script: string,
    _n: number,
    key: string,
    owner: string,
  ): Promise<number> {
    if (this.held.get(key) === owner) {
      this.held.delete(key)
      return 1
    }
    return 0
  }
}

/** Portal CRMThink em memória: `crm.item.*` sobre um mapa por SPA. */
export class FakeCrm {
  items = new Map<number, Map<number, Record<string, unknown>>>()
  fields = new Map<
    number,
    Record<string, { type?: string; items?: { ID: string; VALUE: string }[] }>
  >()
  comments: Array<{ entityTypeId: number; id: number; comment: string }> = []
  private nextId = 1000
  calls: Array<{
    op: string
    entityTypeId: number
    id?: number
    fields?: Record<string, unknown>
  }> = []

  private spa(entityTypeId: number) {
    let spa = this.items.get(entityTypeId)
    if (!spa) {
      spa = new Map()
      this.items.set(entityTypeId, spa)
    }
    return spa
  }

  seed(
    entityTypeId: number,
    item: Record<string, unknown>,
  ): Record<string, unknown> {
    const id = Number(item.id ?? ++this.nextId)
    const row = { updatedTime: new Date().toISOString(), ...item, id }
    this.spa(entityTypeId).set(id, row)
    return row
  }

  async getItem(entityTypeId: number, id: number | string) {
    const item = this.spa(entityTypeId).get(Number(id))
    return item ? structuredClone(item) : null
  }

  async listItems(entityTypeId: number, filter: Record<string, unknown>) {
    return [...this.spa(entityTypeId).values()]
      .filter(item =>
        Object.entries(filter).every(([key, value]) => {
          if (key === '>=updatedTime')
            return String(item.updatedTime) >= String(value)
          return String(item[key]) === String(value)
        }),
      )
      .map(item => structuredClone(item))
  }

  async addItem(entityTypeId: number, fields: Record<string, unknown>) {
    this.calls.push({ op: 'add', entityTypeId, fields })
    return structuredClone(this.seed(entityTypeId, fields))
  }

  async updateItem(
    entityTypeId: number,
    id: number | string,
    fields: Record<string, unknown>,
  ) {
    this.calls.push({ op: 'update', entityTypeId, id: Number(id), fields })
    const item = this.spa(entityTypeId).get(Number(id))
    if (!item)
      throw new BitrixApiError('crm.item.update', 'NOT_FOUND', 'not found')
    Object.assign(item, fields, { updatedTime: new Date().toISOString() })
    return structuredClone(item)
  }

  async deleteItem(entityTypeId: number, id: number | string) {
    this.spa(entityTypeId).delete(Number(id))
  }

  async itemFields(entityTypeId: number) {
    return this.fields.get(entityTypeId) ?? {}
  }

  async addTimelineComment(
    entityTypeId: number,
    id: number | string,
    comment: string,
  ) {
    this.comments.push({ entityTypeId, id: Number(id), comment })
  }

  asClient(): BitrixRestClient {
    return this as unknown as BitrixRestClient
  }
}

/** Portal do cliente: responde `app.info`, `profile`, `user.*`, `event.bind`. */
export class FakeBitrixPortal {
  clientIdByToken = new Map<string, string>()
  admins = new Set<string>()
  userByToken = new Map<
    string,
    { ID: string; NAME: string; LAST_NAME: string; UF_DEPARTMENT: number[] }
  >()
  calls: Array<{ domain: string; method: string; params: BitrixParams }> = []
  unavailable = false
  failMethod: string | null = null

  factory = (domain: string, accessToken: string): BitrixCaller => ({
    call: async <T>(method: string, params: BitrixParams = {}): Promise<T> => {
      this.calls.push({ domain, method, params })
      if (this.unavailable) {
        const { BitrixUnavailableError } =
          await import('@/shared/bitrix/bitrix-errors')
        throw new BitrixUnavailableError(method, 'down')
      }
      if (this.failMethod === method)
        throw new BitrixApiError(method, 'ERROR_CORE', 'falhou')
      const clientId = this.clientIdByToken.get(accessToken)
      if (!clientId)
        throw new BitrixApiError(method, 'invalid_token', 'invalid')
      switch (method) {
        case 'app.info':
          return { CODE: clientId } as T
        case 'profile':
          return { ID: '1', ADMIN: this.admins.has(accessToken) } as T
        case 'user.current':
          return (this.userByToken.get(accessToken) ?? {
            ID: '7',
            NAME: 'Ana',
            LAST_NAME: 'Silva',
            UF_DEPARTMENT: [1],
          }) as T
        case 'user.admin':
          return this.admins.has(accessToken) as T
        case 'event.bind':
          return true as T
        default:
          return {} as T
      }
    },
  })
}

export class FakeOAuth implements BitrixOAuth {
  calls = 0
  delayMs = 0
  failWith: Error | null = null
  now: () => Date = () => new Date()
  /** refresh token → dono (client_id, member_id, domain). */
  owners = new Map<
    string,
    { clientId: string; memberId: string; domain: string }
  >()
  /** Avisado a cada token emitido (o portal passa a aceitá-lo). */
  onIssue: (accessToken: string, owner: { clientId: string }) => void = () => {}
  private seq = 0

  async refresh(params: {
    clientId: string
    clientSecret: string
    refreshToken: string
  }): Promise<OAuthTokens> {
    this.calls++
    if (this.delayMs)
      await new Promise(resolve => setTimeout(resolve, this.delayMs))
    if (this.failWith) throw this.failWith
    const owner = this.owners.get(params.refreshToken)
    const { BitrixOAuthRejectedError } =
      await import('@/shared/bitrix/bitrix-oauth.client')
    if (!owner || owner.clientId !== params.clientId)
      throw new BitrixOAuthRejectedError('invalid_grant')
    this.owners.delete(params.refreshToken)
    this.seq++
    const refreshToken = `refresh-${this.seq}`
    this.owners.set(refreshToken, owner)
    this.onIssue(`access-${this.seq}`, owner)
    return {
      accessToken: `access-${this.seq}`,
      refreshToken,
      expiresAt: new Date(this.now().getTime() + 3600_000),
      memberId: owner.memberId,
      domain: owner.domain,
      clientEndpoint: `https://${owner.domain}/rest/`,
      scope: ['crm', 'imbot'],
    }
  }
}

export class FakeGateway implements PaymentGateway {
  subscriptions = new Map<string, GatewaySubscriptionState>()
  checkouts: Array<{
    mode: 'subscription' | 'payment'
    priceId: string
    quantity: number
    metadata: GatewayMetadata
  }> = []
  quantities: Array<{ id: string; priceId: string; quantity: number }> = []
  upgrades: Array<{ id: string; priceId: string; planChange: string }> = []
  downgrades: Array<{ id: string; priceId: string; planChange: string }> = []
  chargeOrigins = new Map<string, ChargeOrigin>()
  charges = new Map<string, { chargeId: string | null; amount: number }>()
  nextEvent: VerifiedGatewayEvent | null = null
  private seq = 0

  async verifyWebhookEvent(
    _raw: Buffer,
    signature: string | undefined,
  ): Promise<VerifiedGatewayEvent> {
    const { GatewaySignatureError } =
      await import('@/modules/billing/ports/payment-gateway')
    if (signature !== 'valid' || !this.nextEvent)
      throw new GatewaySignatureError('invalid')
    return this.nextEvent
  }

  /** Eventos normalizados por id (o corpo cru guardado só carrega o id). */
  normalized = new Map<string, GatewayEvent>()

  normalize(raw: unknown): GatewayEvent {
    const event = this.normalized.get((raw as { id: string }).id)
    if (!event) throw new Error('evento desconhecido no FakeGateway')
    return event
  }

  async createSubscriptionCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
  }) {
    this.checkouts.push({ mode: 'subscription', ...input })
    return {
      clientSecret: `cs_secret_${++this.seq}`,
      sessionId: `cs_${this.seq}`,
    }
  }

  async createPaymentCheckout(input: {
    priceId: string
    quantity: number
    metadata: GatewayMetadata
  }) {
    this.checkouts.push({ mode: 'payment', ...input })
    return {
      clientSecret: `cs_secret_${++this.seq}`,
      sessionId: `cs_${this.seq}`,
    }
  }

  async createBillingPortalSession(id: string) {
    return { url: `https://billing.stripe.test/${id}` }
  }

  async readSubscription(id: string): Promise<GatewaySubscriptionState> {
    const state = this.subscriptions.get(id)
    if (!state) throw new Error(`no subscription ${id}`)
    return structuredClone(state)
  }

  async *listSubscriptions(): AsyncIterable<GatewaySubscriptionState> {
    for (const state of this.subscriptions.values())
      yield structuredClone(state)
  }

  async setItemQuantity(id: string, priceId: string, quantity: number) {
    this.quantities.push({ id, priceId, quantity })
    const state = this.subscriptions.get(id)
    const item = state?.items.find(i => i.priceId === priceId)
    if (item) item.quantity = quantity
  }

  async upgrade(id: string, priceId: string, planChange: string) {
    this.upgrades.push({ id, priceId, planChange })
  }

  async scheduleDowngrade(id: string, priceId: string, planChange: string) {
    this.downgrades.push({ id, priceId, planChange })
  }

  async resolveChargeOrigin(paymentIntentId: string): Promise<ChargeOrigin> {
    return this.chargeOrigins.get(paymentIntentId) ?? null
  }

  async paymentCharge(paymentIntentId: string) {
    return (
      this.charges.get(paymentIntentId) ?? {
        chargeId: `ch_${paymentIntentId}`,
        amount: 1000,
      }
    )
  }

  async priceKind(): Promise<'recurring' | 'one_time'> {
    return 'recurring'
  }
}

/** `fetch` programável: registra chamadas e responde pelo handler. */
export function fakeFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
  return { impl, calls }
}
