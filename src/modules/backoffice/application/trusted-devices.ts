import { randomBytes } from 'node:crypto'
import type { Clock } from '@/shared/clock'
import type { Db } from '@/shared/infra/prisma'
import { hashSessionToken } from './sessions'

const DAY_MS = 86_400_000

/**
 * Navegador lembrado: depois de um código válido o operador pode pedir para não
 * digitar o código de novo naquele navegador por `trustedDeviceDays`. O valor do
 * cookie (256 bits) só existe no navegador; o banco guarda o SHA-256. A validade é
 * fixa (não renova a cada uso) e a senha continua obrigatória em todo login.
 */
export class TrustedDevices {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: { trustedDeviceDays: number },
  ) {}

  /** `ADMIN_TRUSTED_DEVICE_DAYS=0` desliga o recurso. */
  get enabled(): boolean {
    return this.config.trustedDeviceDays > 0
  }

  async trust(
    operatorId: number,
    meta: { userAgent?: string | null } = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    const now = this.clock.now()
    const expiresAt = new Date(
      now.getTime() + this.config.trustedDeviceDays * DAY_MS,
    )
    if (!this.enabled) return { token, expiresAt }
    await this.db.adminTrustedDevice.create({
      data: {
        idHash: hashSessionToken(token),
        operatorId,
        createdAt: now,
        lastUsedAt: now,
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    })
    return { token, expiresAt }
  }

  /** O cookie vale, é desta conta, não foi revogado e está dentro da validade. */
  async isTrusted(token: string | null, operatorId: number): Promise<boolean> {
    if (!token || !this.enabled) return false
    const row = await this.db.adminTrustedDevice.findUnique({
      where: { idHash: hashSessionToken(token) },
    })
    const now = this.clock.now()
    if (
      !row ||
      row.operatorId !== operatorId ||
      row.revokedAt ||
      row.expiresAt <= now
    ) {
      return false
    }
    await this.db.adminTrustedDevice.update({
      where: { id: row.id },
      data: { lastUsedAt: now },
    })
    return true
  }

  /** Esquece todos os navegadores lembrados da conta. */
  async revokeAll(operatorId: number): Promise<void> {
    await this.db.adminTrustedDevice.updateMany({
      where: { operatorId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    })
  }
}
