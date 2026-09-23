import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { safeEqual } from '@/shared/crypto/timing-safe'
import { normalizeBitrixDomain } from '@/shared/bitrix/normalize'
import { HttpError } from '@/shared/http/errors'
import { logger } from '@/shared/observability/logger'
import { runWithLogContext } from '@/shared/observability/log-context'
import { appendEvent } from '@/modules/events/outbox'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { BitrixAuthVerifier } from './bitrix-auth-verifier'
import type { PendingApplicationTokens } from '../infra/pending-application-tokens'

/**
 * `POST /bitrix/events/{appCode}` — eventos de instalação do app Bitrix.
 *
 * - `ONAPPINSTALL`: traz o `application_token`. Guardado cifrado **só** depois de
 *   provar que o evento veio do portal (o `access_token` do próprio evento precisa ser
 *   deste app naquele domínio) — senão um terceiro plantaria um token e depois
 *   forjaria a desinstalação.
 * - `ONAPPUNINSTALL`: comparado ao token guardado em tempo constante. Divergente ⇒ 401
 *   sem mexer na instalação. Sem token guardado (instalação importada, ou
 *   `ONAPPINSTALL` perdido), só é aceito se o portal já recusa o token da instalação.
 */

const payloadSchema = z.object({
  event: z.string().optional(),
  auth: z
    .object({
      application_token: z.string().optional(),
      member_id: z.string().optional(),
      domain: z.string().optional(),
      access_token: z.string().optional(),
    })
    .optional(),
})

export type AppEventResult =
  { status: 200; handled: string } | { status: 401; reason: string }

export class BitrixAppEvents {
  constructor(
    private readonly db: Db,
    private readonly registry: AppRegistry,
    private readonly verifier: BitrixAuthVerifier,
    private readonly cipher: TokenCipher,
    private readonly pendingTokens: PendingApplicationTokens,
    private readonly clock: Clock,
  ) {}

  async handle(appCode: string, body: unknown): Promise<AppEventResult> {
    const parsed = payloadSchema.safeParse(body)
    const payload = parsed.success ? parsed.data : {}
    const event = payload.event?.toUpperCase()
    const auth = payload.auth ?? {}

    return runWithLogContext({ appCode }, async () => {
      if (!auth.application_token || !auth.member_id) {
        return {
          status: 401,
          reason: 'evento sem application_token/member_id',
        } as const
      }
      if (event === 'ONAPPINSTALL') {
        return this.onInstall(appCode, {
          applicationToken: auth.application_token,
          memberId: auth.member_id,
          domain: auth.domain,
          accessToken: auth.access_token,
        })
      }
      if (event === 'ONAPPUNINSTALL') {
        return this.onUninstall(appCode, auth.application_token, auth.member_id)
      }
      logger().info({ event }, 'evento do Bitrix ignorado')
      return { status: 200, handled: 'ignored' } as const
    })
  }

  private async onInstall(
    appCode: string,
    input: {
      applicationToken: string
      memberId: string
      domain?: string
      accessToken?: string
    },
  ): Promise<AppEventResult> {
    const app = await this.registry.get(appCode)
    if (!app?.active) return { status: 200, handled: 'app-inactive' }
    if (!input.accessToken || !input.domain) {
      return {
        status: 401,
        reason: 'ONAPPINSTALL sem access_token para verificação',
      }
    }

    const domain = normalizeBitrixDomain(input.domain)
    try {
      await this.verifier.assertTokenBelongsToApp(
        app,
        domain,
        input.accessToken,
      )
    } catch (error) {
      logger().warn(
        { err: error },
        'ONAPPINSTALL não verificado — token não guardado',
      )
      return { status: 401, reason: 'ONAPPINSTALL não verificado' }
    }

    const tokenEnc = this.cipher.encrypt(input.applicationToken)
    const installation = await this.db.installation.findUnique({
      where: { appCode_memberId: { appCode, memberId: input.memberId } },
    })

    // Instalação ainda não gravada (evento chegou antes do POST /v1/install), ou em outro domínio.
    if (!installation || installation.domain !== domain) {
      await this.pendingTokens.put(appCode, input.memberId, tokenEnc)
      return { status: 200, handled: 'application-token-pending' }
    }

    await this.db.applicationToken.upsert({
      where: { installationId: installation.id },
      create: { installationId: installation.id, tokenEnc },
      update: { tokenEnc, receivedAt: this.clock.now() },
    })
    return { status: 200, handled: 'application-token-stored' }
  }

  private async onUninstall(
    appCode: string,
    applicationToken: string,
    memberId: string,
  ): Promise<AppEventResult> {
    const installation = await this.db.installation.findUnique({
      where: { appCode_memberId: { appCode, memberId } },
      include: { applicationToken: true, credential: true },
    })
    if (!installation) {
      return { status: 401, reason: 'instalação desconhecida' }
    }
    if (installation.applicationToken) {
      const expected = this.cipher.decrypt(
        installation.applicationToken.tokenEnc,
      )
      if (!safeEqual(applicationToken, expected)) {
        logger().warn(
          { installationId: installation.id },
          'ONAPPUNINSTALL com application_token inválido',
        )
        return { status: 401, reason: 'application_token inválido' }
      }
    } else if (installation.status !== 'UNINSTALLED') {
      // Sem token guardado (instalação importada do hub-core, ou ONAPPINSTALL perdido):
      // só aceita se o portal já não aceita o token da instalação — o Bitrix revoga os
      // tokens do app na desinstalação. Token ainda válido ⇒ evento forjado.
      const stillInstalled = await this.tokenStillWorks(installation)
      if (stillInstalled !== false) {
        logger().warn(
          { installationId: installation.id, stillInstalled },
          'ONAPPUNINSTALL sem application_token e app ainda instalado — recusado',
        )
        return {
          status: 401,
          reason: 'instalação sem application_token e app ainda instalado',
        }
      }
    }
    if (installation.status === 'UNINSTALLED') {
      return { status: 200, handled: 'already-uninstalled' }
    }

    await this.db.$transaction(async tx => {
      await tx.installation.update({
        where: { id: installation.id },
        data: { status: 'UNINSTALLED', uninstalledAt: this.clock.now() },
      })
      // Tokens apagados. A assinatura (Stripe/SPA) fica como está.
      await tx.credential.deleteMany({
        where: { installationId: installation.id },
      })
      await tx.applicationToken.deleteMany({
        where: { installationId: installation.id },
      })
      await appendEvent(tx, {
        appCode,
        type: 'installation.removed',
        installationId: installation.id,
        memberId,
        subscription: null,
      })
    })
    logger().info({ installationId: installation.id }, 'instalação removida')
    return { status: 200, handled: 'uninstalled' }
  }

  /**
   * `true`: o token da instalação ainda é aceito pelo portal (app instalado).
   * `false`: o portal recusou o token (revogado). `null`: não deu para saber
   * (sem credencial ou Bitrix indisponível) — tratado como "não confirmado".
   */
  private async tokenStillWorks(installation: {
    appCode: string
    domain: string
    credential: { accessTokenEnc: string } | null
  }): Promise<boolean | null> {
    if (!installation.credential) return null
    const app = await this.registry.get(installation.appCode)
    if (!app) return null
    try {
      await this.verifier.assertTokenBelongsToApp(
        app,
        installation.domain,
        this.cipher.decrypt(installation.credential.accessTokenEnc),
      )
      return true
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.code === 'BITRIX_TOKEN_REJECTED'
      ) {
        return false
      }
      return null
    }
  }
}
