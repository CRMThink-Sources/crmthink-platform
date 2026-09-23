import z from 'zod'
import type { Installation } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { callBitrixIdempotent } from '@/shared/bitrix/call-bitrix-idempotent'
import { BitrixUnavailableError } from '@/shared/bitrix/bitrix-errors'
import { normalizeBitrixDomain } from '@/shared/bitrix/normalize'
import { conflict, forbidden, HttpError, notFound } from '@/shared/http/errors'
import { logger } from '@/shared/observability/logger'
import { raiseAlert } from '@/shared/observability/alert'
import { runWithLogContext } from '@/shared/observability/log-context'
import { appendEvent } from '@/modules/events/outbox'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { RegisteredApp } from '@/modules/registry/domain/app'
import type {
  BitrixAuthVerifier,
  BitrixClientFactory,
} from './bitrix-auth-verifier'
import type { InstallationSpa } from '../infra/installation-spa'
import type { InstallerClient } from '../infra/installer-client'
import type { PendingApplicationTokens } from '../infra/pending-application-tokens'
import type { InstallationContact, TrialStarter } from '../ports'

/**
 * Orquestrador da instalação (D3). Generalizado de `install-app.ts` do hub-core:
 * passos lineares, idempotentes, sem rollback — reenviar o mesmo pedido retoma do
 * início sem duplicar nada. Cada passo relevante vai para `install_attempt`, que é
 * como o suporte sabe onde a instalação parou.
 */

export const installRequestSchema = z.object({
  appCode: z.string().min(1),
  auth: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.coerce.number().optional(),
    memberId: z.string().min(1),
    domain: z.string().min(1),
  }),
  acceptedTerms: z.literal(true, {
    error: 'É preciso aceitar os termos de uso',
  }),
})

export const retryRequestSchema = z.object({
  appCode: z.string().min(1),
  auth: z.object({
    accessToken: z.string().min(1),
    memberId: z.string().min(1),
    domain: z.string().min(1),
  }),
})

export type InstallRequest = z.infer<typeof installRequestSchema>
export type RetryRequest = z.infer<typeof retryRequestSchema>

export type InstallOutcome = {
  installationId: number
  status: 'ACTIVE' | 'INSTALL_PENDING'
  error?: string
}

export type InstallServiceDeps = {
  db: Db
  registry: AppRegistry
  verifier: BitrixAuthVerifier
  spa: InstallationSpa
  installer: InstallerClient
  clientFor: BitrixClientFactory
  cipher: TokenCipher
  pendingTokens: PendingApplicationTokens
  trial: TrialStarter
  clock: Clock
  publicBaseUrl: string
}

export class InstallService {
  constructor(private readonly deps: InstallServiceDeps) {}

  eventsHandlerUrl(appCode: string): string {
    return `${this.deps.publicBaseUrl}/bitrix/events/${encodeURIComponent(appCode)}`
  }

  private async activeApp(appCode: string): Promise<RegisteredApp> {
    const app = await this.deps.registry.get(appCode)
    if (!app || !app.active)
      throw notFound('APP_NOT_FOUND', 'Aplicativo não encontrado ou inativo')
    return app
  }

  async install(request: InstallRequest): Promise<InstallOutcome> {
    const { db, cipher } = this.deps
    const app = await this.activeApp(request.appCode)
    const { bitrixClientSecret } = await this.deps.registry.secrets(app.appCode)

    return runWithLogContext({ appCode: app.appCode }, async () => {
      let verified
      try {
        verified = await this.deps.verifier.verifyInstall(
          app,
          bitrixClientSecret,
          request.auth,
        )
      } catch (error) {
        if (error instanceof HttpError && error.status === 403) {
          raiseAlert(
            'install.token_mismatch',
            {
              memberId: request.auth.memberId,
              domain: request.auth.domain,
              code: error.code,
            },
            'instalação recusada na verificação no servidor',
          )
        }
        throw error
      }

      const { memberId, domain, tokens, contact } = verified
      this.checkScopes(app, tokens.scope)

      const existing = await db.installation.findUnique({
        where: { appCode_memberId: { appCode: app.appCode, memberId } },
      })

      const spaItemId = await this.resolveSpaItem(app, existing, {
        domain,
        memberId,
        contact,
      })

      const previousStatus = existing?.status ?? null
      const pendingAppToken = await this.deps.pendingTokens.take(
        app.appCode,
        memberId,
      )

      const installation = await db.$transaction(async tx => {
        const data = {
          domain,
          status: 'INSTALLING' as const,
          spaItemId,
          contact,
          uninstalledAt: null,
          pendingReinstall: existing?.everActivated ?? false,
        }
        const row = existing
          ? await tx.installation.update({ where: { id: existing.id }, data })
          : await tx.installation.create({
              data: { id: spaItemId, appCode: app.appCode, memberId, ...data },
            })

        const credential = {
          accessTokenEnc: cipher.encrypt(tokens.accessToken),
          refreshTokenEnc: cipher.encrypt(tokens.refreshToken),
          expiresAt: tokens.expiresAt,
          clientEndpoint: tokens.clientEndpoint,
          refreshFailures: 0,
          lastRefreshError: null,
        }
        await tx.credential.upsert({
          where: { installationId: row.id },
          create: { installationId: row.id, ...credential },
          update: credential,
        })

        if (pendingAppToken) {
          await tx.applicationToken.upsert({
            where: { installationId: row.id },
            create: { installationId: row.id, tokenEnc: pendingAppToken },
            update: {
              tokenEnc: pendingAppToken,
              receivedAt: this.deps.clock.now(),
            },
          })
        }

        await tx.installAttempt.create({
          data: { installationId: row.id, step: 'register', status: 'ok' },
        })

        // Tokens voltaram a funcionar numa instalação em AUTH_ERROR.
        if (previousStatus === 'AUTH_ERROR') {
          await appendEvent(tx, {
            appCode: app.appCode,
            type: 'installation.auth_restored',
            installationId: row.id,
            memberId,
            subscription: null,
          })
        }
        return row
      })

      return runWithLogContext(
        { installationId: installation.id },
        async () => {
          await this.bindUninstall(app, installation, tokens.accessToken)
          return this.runInstaller(app, installation)
        },
      )
    })
  }

  private checkScopes(app: RegisteredApp, granted: string[]): void {
    if (!app.scopes.length || !granted.length) return
    const grantedSet = new Set(granted)
    const missing = app.scopes.filter(scope => !grantedSet.has(scope))
    const extra = granted.filter(scope => !app.scopes.includes(scope))
    if (missing.length || extra.length) {
      raiseAlert(
        'install.scopes_missing',
        { expected: app.scopes, granted, missing, extra },
        'escopos do app Bitrix diferentes do cadastro — instalação prossegue',
      )
    }
  }

  /**
   * Item do SPA 1060: o vinculado, ou o existente para (app, portal) neste ambiente,
   * ou um novo. Item removido à mão ⇒ recria e revincula.
   */
  private async resolveSpaItem(
    app: RegisteredApp,
    existing: Installation | null,
    input: { domain: string; memberId: string; contact: InstallationContact },
  ): Promise<number> {
    const { spa } = this.deps
    try {
      if (existing?.spaItemId && (await spa.exists(existing.spaItemId))) {
        await spa.update(existing.spaItemId, input)
        return existing.spaItemId
      }
      const found = await spa.find(app.appCode, input.memberId)
      if (found) {
        await spa.update(found, input)
        return found
      }
      return await spa.create({
        appCode: app.appCode,
        appName: app.name,
        domain: input.domain,
        memberId: input.memberId,
        contact: input.contact,
      })
    } catch (error) {
      logger().error({ err: error }, 'install step failed: spa-1060')
      throw new HttpError(
        503,
        'CRMTHINK_UNAVAILABLE',
        'Não foi possível registrar a instalação agora. Tente novamente.',
      )
    }
  }

  private async bindUninstall(
    app: RegisteredApp,
    installation: Installation,
    accessToken: string,
  ): Promise<void> {
    const client = this.deps.clientFor(installation.domain, accessToken)
    try {
      await callBitrixIdempotent(client, 'event.bind', {
        event: 'ONAPPUNINSTALL',
        handler: this.eventsHandlerUrl(app.appCode),
      })
      await this.recordAttempt(installation.id, 'event-bind', 'ok')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.recordAttempt(installation.id, 'event-bind', 'error', message)
      throw new HttpError(
        error instanceof BitrixUnavailableError ? 503 : 502,
        'EVENT_BIND_FAILED',
        'Não foi possível registrar o evento de desinstalação no portal. Tente novamente.',
      )
    }
  }

  private async recordAttempt(
    installationId: number,
    step: string,
    status: 'ok' | 'error',
    error?: string,
  ): Promise<void> {
    await this.deps.db.installAttempt.create({
      data: {
        installationId,
        step,
        status,
        error: error?.slice(0, 2000) ?? null,
      },
    })
  }

  /** Chama o instalador do app e conclui (2xx) ou deixa `INSTALL_PENDING`. */
  async runInstaller(
    app: RegisteredApp,
    installation: Installation,
  ): Promise<InstallOutcome> {
    if (app.installerUrl) {
      const { webhookSecrets } = await this.deps.registry.secrets(app.appCode)
      const result = await this.deps.installer.call(
        app.installerUrl,
        webhookSecrets,
        {
          installationId: installation.id,
          memberId: installation.memberId,
          domain: installation.domain,
          appCode: app.appCode,
          isReinstall: installation.pendingReinstall,
        },
      )
      if (!result.ok) {
        await this.recordAttempt(
          installation.id,
          'installer',
          'error',
          result.error,
        )
        await this.deps.db.installation.update({
          where: { id: installation.id },
          data: { status: 'INSTALL_PENDING' },
        })
        logger().warn(
          { error: result.error },
          'instalador do app falhou — INSTALL_PENDING',
        )
        return {
          installationId: installation.id,
          status: 'INSTALL_PENDING',
          error: result.error,
        }
      }
      await this.recordAttempt(installation.id, 'installer', 'ok')
    }
    await this.complete(app, installation)
    return { installationId: installation.id, status: 'ACTIVE' }
  }

  private async complete(
    app: RegisteredApp,
    installation: Installation,
  ): Promise<void> {
    const { db, clock } = this.deps
    await db.$transaction(async tx => {
      await tx.installation.update({
        where: { id: installation.id },
        data: {
          status: 'ACTIVE',
          activatedAt: clock.now(),
          everActivated: true,
          pendingReinstall: false,
        },
      })
      await appendEvent(tx, {
        appCode: app.appCode,
        type: installation.pendingReinstall
          ? 'installation.reinstalled'
          : 'installation.created',
        installationId: installation.id,
        memberId: installation.memberId,
        subscription: null,
      })
    })

    if (app.trialOnInstall && !installation.trialUsed) {
      try {
        await this.deps.trial.startTrialOnInstall(installation.id)
      } catch (error) {
        // O trial não pode impedir o `installFinish`: o operador tem a rota administrativa.
        logger().error(
          { err: error },
          'não foi possível criar o trial na instalação',
        )
      }
    }
  }

  /** "Tentar novamente": reexecuta só o instalador de uma instalação `INSTALL_PENDING`. */
  async retry(request: RetryRequest): Promise<InstallOutcome> {
    const app = await this.activeApp(request.appCode)
    const domain = normalizeBitrixDomain(request.auth.domain)
    await this.deps.verifier.verifyAdmin(app, domain, request.auth.accessToken)

    const installation = await this.deps.db.installation.findUnique({
      where: {
        appCode_memberId: {
          appCode: app.appCode,
          memberId: request.auth.memberId,
        },
      },
    })
    if (!installation || installation.domain !== domain) {
      throw forbidden(
        'INSTALLATION_MISMATCH',
        'Instalação não encontrada para este portal',
      )
    }
    if (installation.status === 'ACTIVE') {
      return { installationId: installation.id, status: 'ACTIVE' }
    }
    if (installation.status !== 'INSTALL_PENDING') {
      throw conflict(
        'INSTALLATION_NOT_PENDING',
        `Instalação em ${installation.status}`,
      )
    }
    return runWithLogContext(
      { appCode: app.appCode, installationId: installation.id },
      () => this.runInstaller(app, installation),
    )
  }
}
