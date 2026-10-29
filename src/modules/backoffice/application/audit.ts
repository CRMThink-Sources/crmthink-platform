import type { Prisma } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import { logger } from '@/shared/observability/logger'
import { metrics } from '@/shared/observability/metrics'

/**
 * Trilha de auditoria do backoffice: só inserção. Toda mutação em `/admin/*` e todo
 * evento de acesso passa por aqui. Nunca recebe senha, código TOTP, segredo gerado,
 * chave de API nem corpo cru — o resumo passa por `maskSummary`.
 *
 * Falha de gravação não derruba a ação (a operação não pode travar por causa da
 * auditoria): vai para log `error` e para `admin_audit_write_failures_total`.
 */

export type AuditEntry = {
  actor: string
  actorRole?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  statusCode?: number | null
  errorCode?: string | null
  summary?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

const SENSITIVE_KEY =
  /^(code|totpCode)$|secret|password|token|apikey|api_key|totp/i
const MAX_STRING = 200
const MAX_SUMMARY_BYTES = 2000

/** Copia o objeto mascarando chaves sensíveis e encurtando textos longos. */
export function maskSummary(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  if (typeof value !== 'object') return value
  if (depth >= 3) return '…'
  if (Array.isArray(value))
    return value.slice(0, 20).map(item => maskSummary(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '***' : maskSummary(item, depth + 1)
  }
  return out
}

function boundedSummary(
  summary: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!summary) return null
  const masked = maskSummary(summary) as Record<string, unknown>
  return JSON.stringify(masked).length > MAX_SUMMARY_BYTES
    ? { truncated: true, fields: Object.keys(masked) }
    : masked
}

export class AdminAudit {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** `ADMIN_AUDIT_RETENTION_DAYS` (mínimo 365, validado na env). */
    private readonly retentionDays: number,
  ) {}

  /** Rotina diária do worker: apaga só o que passou do prazo de retenção. */
  async purgeExpired(): Promise<{ deleted: number }> {
    const cutoff = new Date(
      this.clock.now().getTime() - this.retentionDays * 86_400_000,
    )
    const { count } = await this.db.adminAuditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
    return { deleted: count }
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.adminAuditLog.create({
        data: {
          actor: entry.actor,
          actorRole: entry.actorRole ?? null,
          action: entry.action.slice(0, 200),
          targetType: entry.targetType ?? null,
          targetId: entry.targetId?.slice(0, 200) ?? null,
          statusCode: entry.statusCode ?? null,
          errorCode: entry.errorCode ?? null,
          summary: (boundedSummary(entry.summary) ?? undefined) as
            Prisma.InputJsonValue | undefined,
          ip: entry.ip?.slice(0, 64) ?? null,
          userAgent: entry.userAgent?.slice(0, 500) ?? null,
          requestId: entry.requestId?.slice(0, 100) ?? null,
          createdAt: this.clock.now(),
        },
      })
    } catch (error) {
      metrics.adminAuditWriteFailures.inc()
      logger().error(
        { err: error, action: entry.action, actor: entry.actor },
        'falha ao gravar auditoria do backoffice',
      )
    }
  }
}
