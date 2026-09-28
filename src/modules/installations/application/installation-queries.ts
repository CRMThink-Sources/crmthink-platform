import type { Installation } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { notFound } from '@/shared/http/errors'
import { logger } from '@/shared/observability/logger'

export type InstallationResponse = {
  installationId: number
  appCode: string
  memberId: string
  domain: string
  status: Installation['status']
  applicationToken: string | null
}

/**
 * Consultas dos apps às próprias instalações. Instalação de outro app, ou
 * desvinculada do SPA 1060 (item removido à mão), responde 404 — a mesma resposta
 * de "não existe", para não revelar instalações alheias.
 */
export class InstallationQueries {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
  ) {}

  /** A instalação do app, ou 404. Base de todas as rotas por `installationId`. */
  async owned(appCode: string, installationId: number): Promise<Installation> {
    const row = await this.db.installation.findUnique({
      where: { id: installationId },
    })
    if (!row || row.appCode !== appCode || row.spaItemId === null) {
      throw notFound('INSTALLATION_NOT_FOUND')
    }
    return row
  }

  private async toResponse(row: Installation): Promise<InstallationResponse> {
    const token = await this.db.applicationToken.findUnique({
      where: { installationId: row.id },
    })
    return {
      installationId: row.id,
      appCode: row.appCode,
      memberId: row.memberId,
      domain: row.domain,
      status: row.status,
      applicationToken: token ? this.cipher.decrypt(token.tokenEnc) : null,
    }
  }

  async get(
    appCode: string,
    installationId: number,
  ): Promise<InstallationResponse> {
    return this.toResponse(await this.owned(appCode, installationId))
  }

  async findByMemberId(
    appCode: string,
    memberId: string,
  ): Promise<InstallationResponse[]> {
    const row = await this.db.installation.findUnique({
      where: { appCode_memberId: { appCode, memberId } },
    })
    if (!row || row.spaItemId === null) return []
    return [await this.toResponse(row)]
  }

  /**
   * Item do SPA 1060 removido à mão: a instalação é desvinculada (apps passam a
   * receber 404) e o vínculo é recriado na próxima reinstalação.
   */
  async unlinkSpaItem(spaItemId: number): Promise<boolean> {
    const result = await this.db.installation.updateMany({
      where: { spaItemId },
      data: { spaItemId: null },
    })
    if (result.count > 0) {
      logger().warn(
        { spaItemId },
        'item do SPA 1060 removido — instalação desvinculada',
      )
    }
    return result.count > 0
  }
}
