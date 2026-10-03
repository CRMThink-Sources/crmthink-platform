import type { Installation } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type {
  InstallationContact,
  InstallationDirectory,
  InstallationView,
} from '../ports'

export function toInstallationView(row: Installation): InstallationView {
  return {
    installationId: row.id,
    appCode: row.appCode,
    memberId: row.memberId,
    domain: row.domain,
    status: row.status,
    spaItemId: row.spaItemId,
    trialUsed: row.trialUsed,
    contact: (row.contact as InstallationContact | null) ?? null,
  }
}

export class PrismaInstallationDirectory implements InstallationDirectory {
  constructor(private readonly db: Db) {}

  async get(installationId: number): Promise<InstallationView | null> {
    const row = await this.db.installation.findUnique({
      where: { id: installationId },
    })
    return row ? toInstallationView(row) : null
  }

  async findBySpaItemId(spaItemId: number): Promise<InstallationView | null> {
    const row = await this.db.installation.findUnique({ where: { spaItemId } })
    return row ? toInstallationView(row) : null
  }

  async markTrialUsed(installationId: number): Promise<void> {
    await this.db.installation.update({
      where: { id: installationId },
      data: { trialUsed: true },
    })
  }

  async saveContact(
    installationId: number,
    contact: InstallationContact,
  ): Promise<void> {
    await this.db.installation.update({
      where: { id: installationId },
      data: { contact },
    })
  }
}
