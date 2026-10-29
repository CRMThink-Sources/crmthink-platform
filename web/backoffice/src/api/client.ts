import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

/**
 * Cliente tipado da API de operador (`docs/api/openapi-admin.json`). Mesma origem: o
 * cookie de sessão (`Path=/admin`, `SameSite=Strict`) vai sozinho e o navegador manda
 * `Origin` nas mutações, como o `adminGate` exige.
 */
export const api = createClient<paths>({
  // Absoluto: `Request` não aceita caminho relativo fora do navegador (testes).
  baseUrl: window.location.origin,
  credentials: 'same-origin',
  // `fetch` resolvido a cada chamada (o MSW dos testes troca o global depois do import).
  fetch: request => globalThis.fetch(request),
})

export type Schemas = components['schemas']

type ErrorBody = {
  error?: { code?: string; message?: string; details?: unknown }
}

/** Erro da API como os componentes o veem: decida pelo `code`, nunca pela mensagem. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Headers,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** `details` de `VALIDATION_ERROR`: `[{ path, message }]`. */
  get fieldErrors(): Array<{ path: string; message: string }> {
    return Array.isArray(this.details)
      ? (this.details as Array<{ path: string; message: string }>)
      : []
  }
}

export function toApiError(response: Response, body: unknown): ApiError {
  const error = (body as ErrorBody | undefined)?.error
  return new ApiError(
    response.status,
    error?.code ?? (response.status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN'),
    error?.message ?? `Erro ${response.status}`,
    error?.details,
    response.headers,
  )
}

/** Resultado do `openapi-fetch` → dados, ou lança `ApiError`. */
export async function call<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await request
  if (!response.ok) throw toApiError(response, error)
  return data as T
}

/**
 * Reações globais a respostas de autenticação. Registradas pela árvore de rotas
 * (`AuthEventsBridge`), que tem acesso à navegação e ao cache.
 */
export type AuthEvents = {
  /** 401 fora do login: sessão ausente, expirada ou revogada. */
  onUnauthorized(): void
  /** 403 `PASSWORD_CHANGE_REQUIRED`: senha provisória. */
  onPasswordChangeRequired(): void
}

let authEvents: AuthEvents | null = null

export function setAuthEvents(events: AuthEvents | null): void {
  authEvents = events
}

api.use({
  async onResponse({ request, response }) {
    const path = new URL(request.url, window.location.origin).pathname
    if (response.status === 401 && path !== '/admin/auth/login') {
      authEvents?.onUnauthorized()
    } else if (response.status === 403) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as ErrorBody | null
      if (body?.error?.code === 'PASSWORD_CHANGE_REQUIRED')
        authEvents?.onPasswordChangeRequired()
    }
    return undefined
  },
})
