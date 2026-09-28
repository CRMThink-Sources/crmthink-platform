import type { Credential, Installation } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import {
  BitrixOAuthRejectedError,
  type BitrixOAuth,
} from '@/shared/bitrix/bitrix-oauth.client'
import { BitrixUnavailableError } from '@/shared/bitrix/bitrix-errors'
import { conflict, gone, HttpError } from '@/shared/http/errors'
import {
  LockTimeoutError,
  SingleFlight,
  withLock,
  type LockStore,
} from '@/shared/infra/redis'
import { logger, scrubSecrets } from '@/shared/observability/logger'
import { metrics } from '@/shared/observability/metrics'
import { raiseAlert } from '@/shared/observability/alert'
import { runWithLogContext } from '@/shared/observability/log-context'
import { appendEvent } from '@/modules/events/outbox'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { InstallationQueries } from './installation-queries'

/**
 * Cofre de tokens (D4). Os apps pedem o token e chamam o Bitrix direto; **só a
 * plataforma renova**, porque o Bitrix rotaciona o refresh token a cada troca e duas
 * renovações concorrentes derrubam a credencial (o bug do
 * `resolve-bitrix-client-for-app.ts` do hub-core).
 *
 * Toda renovação — sob demanda ou pelo job — passa por `withLock` na mesma chave por
 * instalação, e dentro do lock relê a credencial: quem esperou o lock encontra o
 * token já renovado e devolve o novo (single-flight entre processos). No mesmo
 * processo, `SingleFlight` junta as chamadas antes mesmo de ir ao Redis.
 */

export const MAX_REFRESH_FAILURES = 5
export const REFRESH_AHEAD_MS = 10 * 60_000
const LOCK_TTL_MS = 20_000
const LOCK_WAIT_MS = 15_000
/** Token que vence em menos disto é renovado antes de ser entregue. */
const DELIVERY_MIN_VALIDITY_MS = 60_000

export type TokenResponse = {
  accessToken: string
  expiresAt: string
  domain: string
  clientEndpoint: string | null
}

type Trigger = 'on-demand' | 'job' | 'delivery'

export class TokenVault {
  private readonly singleFlight = new SingleFlight<Credential>()

  constructor(
    private readonly db: Db,
    private readonly registry: AppRegistry,
    private readonly queries: InstallationQueries,
    private readonly oauth: BitrixOAuth,
    private readonly cipher: TokenCipher,
    private readonly locks: LockStore,
    private readonly clock: Clock,
  ) {}

  private lockKey(installationId: number): string {
    return `token-refresh:${installationId}`
  }

  private assertUsable(installation: Installation): void {
    if (installation.status === 'UNINSTALLED') {
      throw gone('INSTALLATION_UNINSTALLED', 'Instalação removida do portal')
    }
    if (installation.status === 'AUTH_ERROR') {
      throw conflict(
        'AUTH_ERROR',
        'Credencial do Bitrix inválida; é preciso reinstalar o app',
      )
    }
  }

  private toResponse(
    installation: Installation,
    credential: Credential,
  ): TokenResponse {
    return {
      accessToken: this.cipher.decrypt(credential.accessTokenEnc),
      expiresAt: credential.expiresAt.toISOString(),
      domain: installation.domain,
      clientEndpoint: credential.clientEndpoint,
    }
  }

  private async credentialOf(installationId: number): Promise<Credential> {
    const credential = await this.db.credential.findUnique({
      where: { installationId },
    })
    if (!credential)
      throw gone('INSTALLATION_UNINSTALLED', 'Instalação sem credencial')
    return credential
  }

  /** `GET /v1/installations/{id}/token`. Entregue também em `INSTALLING`/`INSTALL_PENDING`. */
  async getToken(
    appCode: string,
    installationId: number,
  ): Promise<TokenResponse> {
    const installation = await this.queries.owned(appCode, installationId)
    this.assertUsable(installation)
    let credential = await this.credentialOf(installationId)
    if (
      credential.expiresAt.getTime() - this.clock.now().getTime() <
      DELIVERY_MIN_VALIDITY_MS
    ) {
      credential = await this.refreshIfStale(
        installation,
        credential.accessTokenEnc,
        'delivery',
      )
    }
    return this.toResponse(installation, credential)
  }

  /**
   * `POST /v1/installations/{id}/token/refresh` com o token que o Bitrix recusou.
   * Se o guardado já é outro, devolve o guardado sem ir ao Bitrix.
   */
  async refreshOnDemand(
    appCode: string,
    installationId: number,
    staleAccessToken: string,
  ): Promise<TokenResponse> {
    const installation = await this.queries.owned(appCode, installationId)
    this.assertUsable(installation)
    const current = await this.credentialOf(installationId)
    if (this.cipher.decrypt(current.accessTokenEnc) !== staleAccessToken) {
      return this.toResponse(installation, current)
    }
    const credential = await this.refreshIfStale(
      installation,
      current.accessTokenEnc,
      'on-demand',
    )
    return this.toResponse(installation, credential)
  }

  /**
   * Renova se o token guardado ainda for `staleEnc` (comparado pelo texto decifrado).
   * Chamadas concorrentes esperam o lock e recebem o token que a primeira gravou.
   */
  private refreshIfStale(
    installation: Installation,
    staleEnc: string,
    trigger: Trigger,
  ): Promise<Credential> {
    const stale = this.cipher.decrypt(staleEnc)
    return this.singleFlight.run(`${installation.id}`, async () => {
      try {
        return await withLock(
          this.locks,
          this.lockKey(installation.id),
          { ttlMs: LOCK_TTL_MS, waitMs: LOCK_WAIT_MS },
          async () => {
            const current = await this.credentialOf(installation.id)
            if (this.cipher.decrypt(current.accessTokenEnc) !== stale)
              return current
            return this.refreshLocked(installation, current, trigger)
          },
        )
      } catch (error) {
        if (error instanceof LockTimeoutError) {
          throw new HttpError(
            503,
            'TOKEN_REFRESH_BUSY',
            'Renovação em andamento; tente novamente',
          )
        }
        if (error instanceof BitrixUnavailableError) {
          throw new HttpError(
            503,
            'BITRIX_UNAVAILABLE',
            'Bitrix indisponível para renovar o token',
          )
        }
        if (error instanceof BitrixOAuthRejectedError) {
          const fresh = await this.db.installation.findUnique({
            where: { id: installation.id },
          })
          if (fresh?.status === 'AUTH_ERROR') {
            throw conflict(
              'AUTH_ERROR',
              'Credencial do Bitrix inválida; é preciso reinstalar o app',
            )
          }
          throw new HttpError(
            502,
            'TOKEN_REFRESH_FAILED',
            'O Bitrix recusou a renovação do token',
          )
        }
        throw error
      }
    })
  }

  /** Troca o refresh token. Chamado **só** com o lock da instalação em mãos. */
  private async refreshLocked(
    installation: Installation,
    credential: Credential,
    trigger: Trigger,
  ): Promise<Credential> {
    const { bitrixClientSecret } = await this.registry.secrets(
      installation.appCode,
    )
    const app = await this.registry.getOrThrow(installation.appCode)
    try {
      const tokens = await this.oauth.refresh({
        clientId: app.bitrixClientId,
        clientSecret: bitrixClientSecret,
        refreshToken: this.cipher.decrypt(credential.refreshTokenEnc),
      })
      const updated = await this.db.credential.update({
        where: { installationId: installation.id },
        data: {
          accessTokenEnc: this.cipher.encrypt(tokens.accessToken),
          refreshTokenEnc: this.cipher.encrypt(tokens.refreshToken),
          expiresAt: tokens.expiresAt,
          clientEndpoint: tokens.clientEndpoint ?? credential.clientEndpoint,
          refreshFailures: 0,
          lastRefreshError: null,
        },
      })
      metrics.tokenRefreshes.inc({ appCode: installation.appCode, trigger })
      return updated
    } catch (error) {
      await this.recordFailure(installation, error)
      throw error
    }
  }

  /**
   * Falha de renovação. Só recusa do Bitrix conta para o `AUTH_ERROR` (indisponibilidade
   * não prova credencial inválida); na 5ª seguida a instalação vira `AUTH_ERROR`.
   */
  private async recordFailure(
    installation: Installation,
    error: unknown,
  ): Promise<void> {
    const message = scrubSecrets(
      error instanceof Error ? error.message : String(error),
    )
    metrics.tokenRefreshFailures.inc({ appCode: installation.appCode })
    if (!(error instanceof BitrixOAuthRejectedError)) {
      await this.db.credential.update({
        where: { installationId: installation.id },
        data: { lastRefreshError: message },
      })
      return
    }

    await this.db.$transaction(async tx => {
      const updated = await tx.credential.update({
        where: { installationId: installation.id },
        data: { refreshFailures: { increment: 1 }, lastRefreshError: message },
      })
      if (updated.refreshFailures < MAX_REFRESH_FAILURES) return
      const current = await tx.installation.findUnique({
        where: { id: installation.id },
      })
      if (
        !current ||
        current.status === 'AUTH_ERROR' ||
        current.status === 'UNINSTALLED'
      )
        return
      await tx.installation.update({
        where: { id: installation.id },
        data: { status: 'AUTH_ERROR' },
      })
      await appendEvent(tx, {
        appCode: installation.appCode,
        type: 'installation.auth_error',
        installationId: installation.id,
        memberId: installation.memberId,
        subscription: null,
        data: { lastError: message, failures: updated.refreshFailures },
      })
      raiseAlert(
        'token.auth_error',
        {
          installationId: installation.id,
          appCode: installation.appCode,
          lastError: message,
        },
        'instalação em AUTH_ERROR após falhas seguidas de renovação',
      )
    })
  }

  /**
   * Job: renova, sob o mesmo lock, os tokens que vencem em menos de 10 minutos.
   * Instalação com lock ocupado é pulada (o outro processo está renovando).
   */
  async refreshDue(): Promise<{
    refreshed: number
    failed: number
    skipped: number
  }> {
    const threshold = new Date(this.clock.now().getTime() + REFRESH_AHEAD_MS)
    const due = await this.db.credential.findMany({
      where: {
        expiresAt: { lt: threshold },
        refreshFailures: { lt: MAX_REFRESH_FAILURES },
        installation: {
          status: { in: ['ACTIVE', 'INSTALLING', 'INSTALL_PENDING'] },
        },
      },
      include: { installation: true },
      take: 200,
    })

    const stats = { refreshed: 0, failed: 0, skipped: 0 }
    for (const row of due) {
      await runWithLogContext(
        {
          appCode: row.installation.appCode,
          installationId: row.installationId,
        },
        async () => {
          try {
            const ran = await withLock(
              this.locks,
              this.lockKey(row.installationId),
              { ttlMs: LOCK_TTL_MS },
              async () => {
                const current = await this.credentialOf(row.installationId)
                if (current.expiresAt >= threshold) return false
                await this.refreshLocked(row.installation, current, 'job')
                return true
              },
            )
            if (ran) stats.refreshed++
            else stats.skipped++
          } catch (error) {
            if (error instanceof LockTimeoutError) {
              stats.skipped++
              return
            }
            stats.failed++
            logger().warn({ err: error }, 'renovação antecipada falhou')
          }
        },
      )
    }
    return stats
  }
}
