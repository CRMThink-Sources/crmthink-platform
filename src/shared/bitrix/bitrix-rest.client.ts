import { BitrixApiError, BitrixUnavailableError } from './bitrix-errors'
import { normalizeBitrixDomain } from './normalize'

/**
 * Único cliente REST do Bitrix24 da plataforma.
 *
 * Substitui `BitrixClient`, `BitrixRestClient` e as fábricas `makeBitrixClient*` do
 * hub-core. Duas formas de autenticar, mesma API:
 *
 * - `forOAuth(domain, accessToken)`: portal do cliente, com o token da instalação.
 * - `forWebhook(url)`: portal CRMThink (SPAs), com o webhook de entrada.
 *
 * Usa o `fetch` nativo (a mesma pilha TLS que funciona em produção no hub-core).
 */

export type BitrixParams = Record<string, unknown>

export type Fetch = typeof fetch

export type BitrixClientOptions = {
  timeoutMs?: number
  fetch?: Fetch
}

type BitrixResponse = {
  result?: unknown
  next?: number
  total?: number
  error?: string
  error_description?: string
}

export interface BitrixCaller {
  call<T = unknown>(method: string, params?: BitrixParams): Promise<T>
}

export class BitrixRestClient implements BitrixCaller {
  private readonly timeoutMs: number
  private readonly fetchImpl: Fetch

  private constructor(
    private readonly baseUrl: string,
    private readonly auth: string | null,
    options: BitrixClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.fetchImpl = options.fetch ?? fetch
  }

  static forOAuth(
    domain: string,
    accessToken: string,
    options?: BitrixClientOptions,
  ): BitrixRestClient {
    return new BitrixRestClient(
      `https://${normalizeBitrixDomain(domain)}/rest/`,
      accessToken,
      options,
    )
  }

  /** `https://portal/rest/<user>/<code>/` (com ou sem barra final). */
  static forWebhook(
    webhookUrl: string,
    options?: BitrixClientOptions,
  ): BitrixRestClient {
    if (!webhookUrl) throw new Error('Webhook do Bitrix não configurado')
    return new BitrixRestClient(
      webhookUrl.replace(/\/+$/, '') + '/',
      null,
      options,
    )
  }

  /** Resposta crua (`result`, `next`, `total`), para quem precisa paginar. */
  async callRaw(
    method: string,
    params: BitrixParams = {},
  ): Promise<BitrixResponse> {
    const body = this.auth ? { ...params, auth: this.auth } : params
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${method}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new BitrixUnavailableError(
        method,
        error instanceof Error ? error.message : String(error),
      )
    }

    const text = await response.text()
    let data: BitrixResponse | null = null
    try {
      data = text ? (JSON.parse(text) as BitrixResponse) : null
    } catch {
      data = null
    }

    if (data?.error) {
      throw new BitrixApiError(
        method,
        data.error,
        data.error_description,
        response.status,
      )
    }
    if (response.status >= 500 || !data) {
      throw new BitrixUnavailableError(method, `HTTP ${response.status}`)
    }
    if (!response.ok) {
      throw new BitrixApiError(
        method,
        `HTTP_${response.status}`,
        undefined,
        response.status,
      )
    }
    return data
  }

  async call<T = unknown>(
    method: string,
    params: BitrixParams = {},
  ): Promise<T> {
    const data = await this.callRaw(method, params)
    return data.result as T
  }

  /**
   * `batch` (máx. 50 comandos). Parâmetros só escalares, como no hub-core.
   * Devolve `chave → result`; erros por comando ficam em `result_error`.
   */
  async batch(
    commands: Record<
      string,
      { method: string; params: Record<string, string | number | boolean> }
    >,
  ): Promise<{
    result: Record<string, unknown>
    errors: Record<string, unknown>
  }> {
    const cmd: Record<string, string> = {}
    for (const [key, { method, params }] of Object.entries(commands)) {
      const query = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) query.append(k, String(v))
      const qs = query.toString()
      cmd[key] = qs ? `${method}?${qs}` : method
    }
    const result = await this.call<{
      result?: Record<string, unknown>
      result_error?: Record<string, unknown>
    }>('batch', { halt: 0, cmd })
    return { result: result?.result ?? {}, errors: result?.result_error ?? {} }
  }

  // ─── CRM (SPAs) ───

  async getItem(
    entityTypeId: number,
    id: number | string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.call<{ item?: Record<string, unknown> }>(
        'crm.item.get',
        { entityTypeId, id, useOriginalUfNames: 'N' },
      )
      return result?.item ?? null
    } catch (error) {
      if (error instanceof BitrixApiError && error.code === 'NOT_FOUND')
        return null
      throw error
    }
  }

  /** Lista todas as páginas (50 por página) do filtro. */
  async listItems(
    entityTypeId: number,
    filter: Record<string, unknown>,
    options: {
      select?: string[]
      order?: Record<string, 'ASC' | 'DESC'>
      limit?: number
    } = {},
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = []
    let start: number | undefined = 0
    const limit = options.limit ?? Infinity
    while (start !== undefined && items.length < limit) {
      const page = await this.callRaw('crm.item.list', {
        entityTypeId,
        filter,
        select: options.select ?? ['*', 'ufCrm*'],
        order: options.order ?? { id: 'ASC' },
        start,
      })
      const result = page.result as
        { items?: Record<string, unknown>[] } | undefined
      items.push(...(result?.items ?? []))
      start = page.next
    }
    return items.slice(0, limit === Infinity ? undefined : limit)
  }

  async addItem(
    entityTypeId: number,
    fields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await this.call<{ item: Record<string, unknown> }>(
      'crm.item.add',
      {
        entityTypeId,
        fields,
        useOriginalUfNames: 'N',
      },
    )
    return result.item
  }

  async updateItem(
    entityTypeId: number,
    id: number | string,
    fields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await this.call<{ item: Record<string, unknown> }>(
      'crm.item.update',
      {
        entityTypeId,
        id,
        fields,
        useOriginalUfNames: 'N',
      },
    )
    return result.item
  }

  async deleteItem(entityTypeId: number, id: number | string): Promise<void> {
    await this.call('crm.item.delete', { entityTypeId, id })
  }

  async itemFields(
    entityTypeId: number,
  ): Promise<
    Record<string, { type?: string; items?: { ID: string; VALUE: string }[] }>
  > {
    const result = await this.call<{
      fields?: Record<
        string,
        { type?: string; items?: { ID: string; VALUE: string }[] }
      >
    }>('crm.item.fields', { entityTypeId, useOriginalUfNames: 'N' })
    return result?.fields ?? {}
  }

  async addTimelineComment(
    entityTypeId: number,
    id: number | string,
    comment: string,
  ): Promise<void> {
    await this.call('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: id,
        ENTITY_TYPE: `DYNAMIC_${entityTypeId}`,
        COMMENT: comment,
      },
    })
  }
}
