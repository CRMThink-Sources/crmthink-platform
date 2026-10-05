import type { BitrixCaller } from '@/shared/bitrix/bitrix-rest.client'
import {
  BitrixApiError,
  BitrixUnavailableError,
} from '@/shared/bitrix/bitrix-errors'
import {
  BitrixOAuthRejectedError,
  type BitrixOAuth,
  type OAuthTokens,
} from '@/shared/bitrix/bitrix-oauth.client'
import { normalizeBitrixDomain } from '@/shared/bitrix/normalize'
import { forbidden, HttpError } from '@/shared/http/errors'
import type { RegisteredApp } from '@/modules/registry/domain/app'

/** Cliente REST autenticado com um access token num domínio. */
export type BitrixClientFactory = (
  domain: string,
  accessToken: string,
) => BitrixCaller

type AppInfo = { CODE?: string; CLIENT_ID?: string; client_id?: string }
type Profile = { ID?: string | number; ADMIN?: boolean | string }
type CurrentUser = {
  ID?: string | number
  NAME?: string
  LAST_NAME?: string
  UF_DEPARTMENT?: Array<string | number> | string | number | null
}

export const bitrixUnavailable = (detail: string) =>
  new HttpError(
    503,
    'BITRIX_UNAVAILABLE',
    `Bitrix indisponível: ${detail}. Tente novamente.`,
  )

/** Traduz erro do Bitrix numa resposta: indisponível ⇒ 503 recuperável; token recusado ⇒ 403. */
function translate(error: unknown): never {
  if (error instanceof HttpError) throw error
  if (error instanceof BitrixUnavailableError)
    throw bitrixUnavailable(error.message)
  if (error instanceof BitrixApiError) {
    throw forbidden(
      'BITRIX_TOKEN_REJECTED',
      `Token recusado pelo Bitrix: ${error.code}`,
    )
  }
  throw error
}

export type VerifiedInstall = {
  memberId: string
  domain: string
  tokens: OAuthTokens
}

export type VerifiedUser = {
  userId: string
  name: string
  isAdmin: boolean
  departmentIds: number[]
}

/**
 * Nada que venha do navegador é aceito como identidade: tudo é conferido no Bitrix.
 *
 * - `app.info` com o token ⇒ o token é do app Bitrix cadastrado. O Bitrix devolve só o
 *   `CODE`: em app local é o próprio client_id; em app de parceiro (client_id `app.…`) é
 *   o código do app (`crmthink.x`), cadastrado em `bitrixAppCode`.
 * - `profile` ⇒ quem instala é admin do portal.
 * - troca do refresh token no `oauth.bitrix.info` com o `client_secret` do app ⇒ prova
 *   definitiva de que o token é deste `client_id` (só nós temos o segredo) e devolve o
 *   `member_id` e o domínio **segundo o Bitrix** — `app.info`/`profile` não trazem
 *   `member_id`. Os tokens renovados são os que a plataforma guarda.
 */
export class BitrixAuthVerifier {
  constructor(
    private readonly clientFor: BitrixClientFactory,
    private readonly oauth: BitrixOAuth,
  ) {}

  /** O token pertence ao app Bitrix do cadastro? */
  async assertTokenBelongsToApp(
    app: RegisteredApp,
    domain: string,
    accessToken: string,
  ): Promise<BitrixCaller> {
    const client = this.clientFor(domain, accessToken)
    let info: AppInfo
    try {
      info = await client.call<AppInfo>('app.info')
    } catch (error) {
      translate(error)
    }
    const code = info.CLIENT_ID ?? info.client_id ?? info.CODE
    if (code && code !== app.bitrixClientId && code !== app.bitrixAppCode) {
      throw forbidden(
        'TOKEN_APP_MISMATCH',
        'O token pertence a outro aplicativo Bitrix',
      )
    }
    return client
  }

  async verifyInstall(
    app: RegisteredApp,
    clientSecret: string,
    auth: {
      accessToken: string
      refreshToken: string
      memberId: string
      domain: string
    },
  ): Promise<VerifiedInstall> {
    const domain = normalizeBitrixDomain(auth.domain)
    const client = await this.assertTokenBelongsToApp(
      app,
      domain,
      auth.accessToken,
    )

    let profile: Profile
    try {
      profile = await client.call<Profile>('profile')
    } catch (error) {
      translate(error)
    }
    if (profile.ADMIN !== true && profile.ADMIN !== 'Y') {
      throw forbidden(
        'NOT_PORTAL_ADMIN',
        'A instalação exige um administrador do portal',
      )
    }

    let tokens: OAuthTokens
    try {
      tokens = await this.oauth.refresh({
        clientId: app.bitrixClientId,
        clientSecret,
        refreshToken: auth.refreshToken,
      })
    } catch (error) {
      if (error instanceof BitrixOAuthRejectedError) {
        throw forbidden(
          'TOKEN_APP_MISMATCH',
          'O token não pertence a este aplicativo',
        )
      }
      translate(error)
    }

    if (!tokens.memberId || tokens.memberId !== auth.memberId) {
      throw forbidden(
        'MEMBER_ID_MISMATCH',
        'member_id divergente do portal autenticado',
      )
    }
    if (tokens.domain && tokens.domain !== domain) {
      throw forbidden(
        'DOMAIN_MISMATCH',
        'Domínio divergente do portal autenticado',
      )
    }

    return { memberId: tokens.memberId, domain, tokens }
  }

  /** Usuário e admin do Bitrix, para a sessão do iframe (`user.current` + `user.admin`). */
  async verifyUser(
    app: RegisteredApp,
    domain: string,
    accessToken: string,
  ): Promise<VerifiedUser> {
    const client = await this.assertTokenBelongsToApp(app, domain, accessToken)
    try {
      const [user, admin] = await Promise.all([
        client.call<CurrentUser>('user.current'),
        client.call<boolean | string>('user.admin'),
      ])
      if (user?.ID === undefined) {
        throw forbidden(
          'BITRIX_USER_UNKNOWN',
          'Usuário do Bitrix não identificado',
        )
      }
      const departments = Array.isArray(user.UF_DEPARTMENT)
        ? user.UF_DEPARTMENT
        : user.UF_DEPARTMENT == null
          ? []
          : [user.UF_DEPARTMENT]
      return {
        userId: String(user.ID),
        name: [user.NAME, user.LAST_NAME].filter(Boolean).join(' ').trim(),
        isAdmin: admin === true || admin === 'Y' || admin === 'true',
        departmentIds: departments.map(Number).filter(Number.isFinite),
      }
    } catch (error) {
      translate(error)
    }
  }

  /** Admin do portal com token deste app (nova tentativa do instalador). */
  async verifyAdmin(
    app: RegisteredApp,
    domain: string,
    accessToken: string,
  ): Promise<void> {
    const client = await this.assertTokenBelongsToApp(app, domain, accessToken)
    let profile: Profile
    try {
      profile = await client.call<Profile>('profile')
    } catch (error) {
      translate(error)
    }
    if (profile.ADMIN !== true && profile.ADMIN !== 'Y') {
      throw forbidden(
        'NOT_PORTAL_ADMIN',
        'A ação exige um administrador do portal',
      )
    }
  }
}
