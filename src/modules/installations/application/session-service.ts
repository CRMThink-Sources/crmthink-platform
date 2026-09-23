import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import { normalizeBitrixDomain } from '@/shared/bitrix/normalize'
import { forbidden } from '@/shared/http/errors'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { BitrixAuthVerifier } from './bitrix-auth-verifier'
import type { SigningKeys } from './signing-keys'

/**
 * `POST /v1/sessions` (D5). Só `{appCode, accessToken, domain, memberId}` são lidos do
 * corpo; qualquer campo extra (ex.: `isAdmin`) é descartado pelo schema. Identidade e
 * admin vêm de `user.current`/`user.admin` com o próprio token.
 */
export const sessionRequestSchema = z.object({
  appCode: z.string().min(1),
  accessToken: z.string().min(1),
  domain: z.string().min(1),
  memberId: z.string().min(1),
})

export type SessionRequest = z.infer<typeof sessionRequestSchema>

export type SessionResponse = {
  token: string
  expiresAt: string
  installationId: number
  user: { id: string; name: string; isAdmin: boolean }
}

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly registry: AppRegistry,
    private readonly verifier: BitrixAuthVerifier,
    private readonly keys: SigningKeys,
  ) {}

  async create(request: SessionRequest): Promise<SessionResponse> {
    const app = await this.registry.get(request.appCode)
    if (!app?.active)
      throw forbidden('APP_INACTIVE', 'Aplicativo não encontrado ou inativo')

    const domain = normalizeBitrixDomain(request.domain)
    const installation = await this.db.installation.findUnique({
      where: {
        appCode_memberId: { appCode: app.appCode, memberId: request.memberId },
      },
    })
    if (
      !installation ||
      installation.status !== 'ACTIVE' ||
      installation.domain !== domain ||
      installation.spaItemId === null
    ) {
      throw forbidden(
        'INSTALLATION_NOT_ACTIVE',
        'Não há instalação ativa deste app no portal',
      )
    }

    const user = await this.verifier.verifyUser(
      app,
      domain,
      request.accessToken,
    )
    const { token, expiresAt } = await this.keys.sign({
      sub: user.userId,
      aud: app.appCode,
      installationId: installation.id,
      memberId: installation.memberId,
      domain: installation.domain,
      isAdmin: user.isAdmin,
      name: user.name,
      departmentIds: user.departmentIds,
    })

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      installationId: installation.id,
      user: { id: user.userId, name: user.name, isAdmin: user.isAdmin },
    }
  }
}
