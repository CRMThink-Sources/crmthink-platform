import { BitrixUnavailableError } from './bitrix-errors'
import { normalizeBitrixDomain, resolveBitrixTokenExpiresAt } from './normalize'
import type { Fetch } from './bitrix-rest.client'

/**
 * Cliente de `oauth.bitrix.info`. Portado de `bitrix-oauth.client.ts` do hub-core,
 * com a resposta completa: além dos tokens, o OAuth devolve `member_id`, `domain`,
 * `client_endpoint` e `scope` — é o que a verificação da instalação usa como prova de
 * que o refresh token pertence ao nosso `client_id` (só quem tem o `client_secret`
 * consegue trocá-lo).
 */

export type OAuthTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  memberId: string
  domain: string | null
  clientEndpoint: string | null
  scope: string[]
}

/** O Bitrix recusou o refresh token (revogado, rotacionado ou de outro app). Não adianta repetir. */
export class BitrixOAuthRejectedError extends Error {
  constructor(
    readonly code: string,
    description?: string,
  ) {
    super(`Bitrix OAuth recusou o refresh token: ${description ?? code}`)
    this.name = 'BitrixOAuthRejectedError'
  }
}

type OAuthResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires?: number
  member_id?: string
  domain?: string
  client_endpoint?: string
  scope?: string
  error?: string
  error_description?: string
}

export interface BitrixOAuth {
  refresh(params: {
    clientId: string
    clientSecret: string
    refreshToken: string
  }): Promise<OAuthTokens>
}

export class BitrixOAuthClient implements BitrixOAuth {
  static readonly OAUTH_URL = 'https://oauth.bitrix.info/oauth/token/'

  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async refresh(params: {
    clientId: string
    clientSecret: string
    refreshToken: string
  }): Promise<OAuthTokens> {
    const query = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    })

    let response: Response
    try {
      response = await this.fetchImpl(
        `${BitrixOAuthClient.OAUTH_URL}?${query.toString()}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      )
    } catch (error) {
      throw new BitrixUnavailableError(
        'oauth.refresh',
        error instanceof Error ? error.message : String(error),
      )
    }

    let data: OAuthResponse = {}
    try {
      data = (await response.json()) as OAuthResponse
    } catch {
      data = {}
    }

    if (data.error) {
      if (response.status >= 500) {
        throw new BitrixUnavailableError('oauth.refresh', data.error)
      }
      throw new BitrixOAuthRejectedError(data.error, data.error_description)
    }
    if (!response.ok || !data.access_token || !data.refresh_token) {
      if (response.status >= 500 || response.ok) {
        throw new BitrixUnavailableError(
          'oauth.refresh',
          `HTTP ${response.status}`,
        )
      }
      throw new BitrixOAuthRejectedError(`HTTP_${response.status}`)
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: resolveBitrixTokenExpiresAt(
        data.expires_in ?? data.expires ?? 3600,
      ),
      memberId: data.member_id ?? '',
      domain: data.domain ? normalizeBitrixDomain(data.domain) : null,
      clientEndpoint: data.client_endpoint ?? null,
      scope: (data.scope ?? '')
        .split(',')
        .map(scope => scope.trim())
        .filter(Boolean),
    }
  }
}
