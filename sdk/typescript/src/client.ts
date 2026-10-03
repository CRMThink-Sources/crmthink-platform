import type { operations, paths } from './generated/openapi.js'
import type { PlatformErrorBody, PlatformToken } from './types.js'

/** A plataforma respondeu com erro: decida pelo `code`, nunca pela mensagem. */
export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}

/** A requisição não chegou a ter resposta HTTP (tempo esgotado ou falha de rede). */
export class PlatformRequestError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'PlatformRequestError'
  }
}

type Method = 'get' | 'post' | 'patch' | 'delete'

/** Par método + caminho que existe no contrato. */
type ContractOperation = {
  [P in keyof paths]: {
    [M in Method]: [NonNullable<paths[P][M]>] extends [never]
      ? never
      : { method: Uppercase<M>; path: P }
  }[Method]
}[keyof paths]

/**
 * Operações com chave de app do contrato público, pelo `operationId` (o mesmo nome em
 * `/docs`). Caminho ou método fora do contrato não compila; o teste de deriva confere
 * que a tabela cobre exatamente as operações `appApiKey` de `docs/api/openapi.json`.
 */
export const OPERATIONS = {
  listInstallations: { method: 'GET', path: '/v1/installations' },
  getInstallation: { method: 'GET', path: '/v1/installations/{id}' },
  getInstallationToken: { method: 'GET', path: '/v1/installations/{id}/token' },
  refreshInstallationToken: {
    method: 'POST',
    path: '/v1/installations/{id}/token/refresh',
  },
  getSubscription: {
    method: 'GET',
    path: '/v1/installations/{id}/subscription',
  },
  requestTrial: { method: 'POST', path: '/v1/installations/{id}/trial' },
  listPlans: { method: 'GET', path: '/v1/plans' },
  createCheckoutSession: { method: 'POST', path: '/v1/checkout-sessions' },
  createBillingPortalSession: {
    method: 'POST',
    path: '/v1/billing-portal-sessions',
  },
  changePlan: { method: 'POST', path: '/v1/subscriptions/{id}/change-plan' },
  listItems: { method: 'GET', path: '/v1/subscriptions/{id}/items' },
  createItem: { method: 'POST', path: '/v1/subscriptions/{id}/items' },
  updateItem: {
    method: 'PATCH',
    path: '/v1/subscriptions/{id}/items/{itemId}',
  },
  removeItem: {
    method: 'DELETE',
    path: '/v1/subscriptions/{id}/items/{itemId}',
  },
} as const satisfies Partial<Record<keyof operations, ContractOperation>>

export type OperationId = keyof typeof OPERATIONS

type JsonOf<T> = T extends { content: { 'application/json': infer Body } }
  ? Body
  : never

/** Corpo de sucesso (2xx) da operação. */
export type OperationResult<K extends OperationId> = JsonOf<
  operations[K]['responses'][Extract<
    keyof operations[K]['responses'],
    200 | 201 | 204
  >]
>

/** Corpo JSON de requisição da operação. */
export type OperationBody<K extends OperationId> = JsonOf<
  NonNullable<operations[K]['requestBody']>
>

export type TrialRequestResult = OperationResult<'requestTrial'> & {
  /** `true` com 201 (trial criado agora); `false` com 200 (trial já vigente). */
  created: boolean
}

type CallInput = {
  path?: Record<string, string | number>
  query?: Record<string, string>
  body?: unknown
}

export type PlatformClientOptions = {
  platformUrl: string
  apiKey: string
  fetch?: typeof fetch
  /** Relógio em ms, para o cache de tokens. */
  now?: () => number
  /** Tempo máximo por requisição; padrão 10 s. */
  timeoutMs?: number
}

const TOKEN_MARGIN_MS = 5 * 60_000

/**
 * Cliente das rotas servidor-a-servidor (Bearer = chave de API do app).
 *
 * Tokens do Bitrix ficam em cache até `expiresAt - 5 min`. Quando o Bitrix responder
 * `expired_token`, chame `refreshInstallationToken(id, tokenRecusado)`: a plataforma faz
 * uma renovação só, mesmo com vários processos pedindo ao mesmo tempo. **Nunca** renove
 * direto no `oauth.bitrix.info` — o refresh token é rotacionado e só a plataforma o tem.
 */
export class PlatformClient {
  private readonly base: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly tokens = new Map<number, PlatformToken>()
  private readonly pendingTokens = new Map<number, Promise<PlatformToken>>()

  constructor(private readonly options: PlatformClientOptions) {
    this.base = options.platformUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.now = options.now ?? (() => Date.now())
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  // ─── Instalações e tokens ───

  listInstallations(memberId: string) {
    return this.call('listInstallations', { query: { memberId } })
  }

  getInstallation(installationId: number) {
    return this.call('getInstallation', { path: { id: installationId } })
  }

  async getInstallationToken(installationId: number): Promise<PlatformToken> {
    const cached = this.tokens.get(installationId)
    if (
      cached &&
      new Date(cached.expiresAt).getTime() - TOKEN_MARGIN_MS > this.now()
    )
      return cached
    const pending = this.pendingTokens.get(installationId)
    if (pending) return pending
    const request = this.call('getInstallationToken', {
      path: { id: installationId },
    })
      .then(token => {
        this.tokens.set(installationId, token)
        return token
      })
      .finally(() => this.pendingTokens.delete(installationId))
    this.pendingTokens.set(installationId, request)
    return request
  }

  async refreshInstallationToken(
    installationId: number,
    staleAccessToken: string,
  ): Promise<PlatformToken> {
    const token = await this.call('refreshInstallationToken', {
      path: { id: installationId },
      body: { staleAccessToken },
    })
    this.tokens.set(installationId, token)
    return token
  }

  forgetInstallationToken(installationId: number): void {
    this.tokens.delete(installationId)
  }

  // ─── Cobrança ───

  listPlans() {
    return this.call('listPlans', {})
  }

  getSubscription(installationId: number) {
    return this.call('getSubscription', { path: { id: installationId } })
  }

  /**
   * Solicita o trial com o contato do cliente. `created: false` quando já havia trial
   * vigente (ex.: criado na instalação): o contato foi gravado e o trial é o atual. Em
   * `TRIAL_ALREADY_USED`/`SUBSCRIPTION_ALREADY_EXISTS` o contato também fica gravado.
   */
  async requestTrial(
    installationId: number,
    contact: OperationBody<'requestTrial'>,
  ): Promise<TrialRequestResult> {
    const { status, body } = await this.send('requestTrial', {
      path: { id: installationId },
      body: contact,
    })
    return { ...body, created: status === 201 }
  }

  createCheckoutSession(body: OperationBody<'createCheckoutSession'>) {
    return this.call('createCheckoutSession', { body })
  }

  createBillingPortalSession(
    body: OperationBody<'createBillingPortalSession'>,
  ) {
    return this.call('createBillingPortalSession', { body })
  }

  changePlan(subscriptionId: number, body: OperationBody<'changePlan'>) {
    return this.call('changePlan', { path: { id: subscriptionId }, body })
  }

  listItems(subscriptionId: number) {
    return this.call('listItems', { path: { id: subscriptionId } })
  }

  createItem(subscriptionId: number, body: OperationBody<'createItem'>) {
    return this.call('createItem', { path: { id: subscriptionId }, body })
  }

  updateItem(
    subscriptionId: number,
    itemId: number,
    body: OperationBody<'updateItem'>,
  ) {
    return this.call('updateItem', {
      path: { id: subscriptionId, itemId },
      body,
    })
  }

  removeItem(subscriptionId: number, itemId: number) {
    return this.call('removeItem', { path: { id: subscriptionId, itemId } })
  }

  // ─── Transporte ───

  private async call<K extends OperationId>(
    operationId: K,
    input: CallInput,
  ): Promise<OperationResult<K>> {
    return (await this.send(operationId, input)).body
  }

  private async send<K extends OperationId>(
    operationId: K,
    input: CallInput,
  ): Promise<{ status: number; body: OperationResult<K> }> {
    const { method, path } = OPERATIONS[operationId]
    const resolved = path.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = input.path?.[name]
      if (value === undefined) throw new TypeError(`parâmetro ${name} ausente`)
      return encodeURIComponent(String(value))
    })
    const query = input.query
      ? `?${new URLSearchParams(input.query).toString()}`
      : ''
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      Accept: 'application/json',
    }
    if (input.body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await this.fetchImpl(`${this.base}${resolved}${query}`, {
        method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new PlatformRequestError(
        timedOut ? 'timeout' : 'network',
        timedOut
          ? `${operationId}: sem resposta em ${this.timeoutMs} ms`
          : `${operationId}: falha de rede`,
        { cause: error },
      )
    }

    if (response.status === 204)
      return { status: 204, body: undefined as OperationResult<K> }
    const text = await response.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const error = (body as Partial<PlatformErrorBody> | undefined)?.error
      throw new PlatformError(
        response.status,
        error?.code ?? `HTTP_${response.status}`,
        error?.message ?? 'erro da plataforma',
        error?.details,
      )
    }
    return { status: response.status, body: body as OperationResult<K> }
  }
}

/**
 * API anterior, mantida para quem já usa: delega ao `PlatformClient`.
 * @deprecated Use `PlatformClient` (`getInstallationToken`/`refreshInstallationToken`).
 */
export class PlatformTokenClient {
  private readonly client: PlatformClient

  constructor(
    platformUrl: string,
    apiKey: string,
    fetchImpl?: typeof fetch,
    now?: () => number,
  ) {
    this.client = new PlatformClient({
      platformUrl,
      apiKey,
      fetch: fetchImpl,
      now,
    })
  }

  get(installationId: number): Promise<PlatformToken> {
    return this.client.getInstallationToken(installationId)
  }

  refresh(
    installationId: number,
    staleAccessToken: string,
  ): Promise<PlatformToken> {
    return this.client.refreshInstallationToken(
      installationId,
      staleAccessToken,
    )
  }

  forget(installationId: number): void {
    this.client.forgetInstallationToken(installationId)
  }
}
