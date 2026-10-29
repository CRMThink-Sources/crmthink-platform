import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'

/**
 * Sessões do backoffice. O valor do cookie (256 bits aleatórios) só existe no
 * navegador; o banco guarda o SHA-256. Revogar por conta é um `UPDATE` e a sessão
 * deixa rastro depois de expirar — por isso MySQL e não Redis.
 *
 * Expira por inatividade (`sessionIdleMs`) e por tempo máximo desde o login
 * (`sessionMaxMs`). `lastSeenAt` só é regravado a cada minuto, para não escrever no
 * banco a cada requisição.
 */

const TOUCH_INTERVAL_MS = 60_000

export type SessionConfig = { sessionIdleMs: number; sessionMaxMs: number }

type SessionRow = Prisma.AdminSessionGetPayload<{
  include: { operator: true }
}>

export type ResolvedSession =
  | { status: 'ok'; session: SessionRow }
  | { status: 'expired'; session: SessionRow }
  | { status: 'invalid' }

export const hashSessionToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export class AdminSessions {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: SessionConfig,
  ) {}

  async create(
    operatorId: number,
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<{ token: string; sessionId: number; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    const now = this.clock.now()
    const expiresAt = new Date(now.getTime() + this.config.sessionMaxMs)
    const row = await this.db.adminSession.create({
      data: {
        idHash: hashSessionToken(token),
        operatorId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    })
    return { token, sessionId: row.id, expiresAt }
  }

  /**
   * Sessão do cookie. `expired` distingue a sessão que existia e venceu (para a
   * auditoria) de um valor desconhecido ou revogado (`invalid`).
   */
  async resolve(token: string): Promise<ResolvedSession> {
    const session = await this.db.adminSession.findUnique({
      where: { idHash: hashSessionToken(token) },
      include: { operator: true },
    })
    if (!session || session.revokedAt || !session.operator?.active) {
      return { status: 'invalid' }
    }
    const now = this.clock.now()
    const idleDeadline =
      session.lastSeenAt.getTime() + this.config.sessionIdleMs
    if (now >= session.expiresAt || now.getTime() >= idleDeadline) {
      await this.db.adminSession.update({
        where: { id: session.id },
        data: { revokedAt: now },
      })
      return { status: 'expired', session }
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await this.db.adminSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      })
    }
    return { status: 'ok', session }
  }

  async revoke(sessionId: number): Promise<void> {
    await this.db.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    })
  }

  /** Todas as sessões abertas da conta, menos `exceptSessionId` (a da própria troca de senha). */
  async revokeAll(operatorId: number, exceptSessionId?: number): Promise<void> {
    await this.db.adminSession.updateMany({
      where: {
        operatorId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: this.clock.now() },
    })
  }
}
