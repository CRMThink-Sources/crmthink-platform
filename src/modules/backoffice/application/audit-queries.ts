import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import {
  decodeCursor,
  pageQuerySchema,
  periodQuerySchema,
  periodWhere,
  toPage,
  type Page,
} from './pagination'

export const auditQuerySchema = pageQuerySchema
  .extend(periodQuerySchema.shape)
  .extend({
    actor: z.string().max(100).optional(),
    action: z.string().max(200).optional(),
    targetType: z.string().max(50).optional(),
    targetId: z.string().max(200).optional(),
    result: z.enum(['success', 'failure']).optional(),
  })

export type AuditItem = {
  id: number
  actor: string
  actorRole: string | null
  action: string
  targetType: string | null
  targetId: string | null
  statusCode: number | null
  errorCode: string | null
  summary: unknown
  ip: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string
}

const cursorSchema = z.number().int().positive()

/** `GET /admin/audit`: do mais recente para o mais antigo (o `id` cresce com o tempo). */
export async function listAudit(
  db: Db,
  query: unknown,
): Promise<Page<AuditItem>> {
  const q = auditQuerySchema.parse(query)
  const before = decodeCursor(q.cursor, cursorSchema)
  const createdAt = periodWhere(q)
  const failure = {
    OR: [{ statusCode: { gte: 400 } }, { errorCode: { not: null } }],
  }
  const rows = await db.adminAuditLog.findMany({
    where: {
      ...(before ? { id: { lt: before } } : {}),
      ...(q.actor ? { actor: q.actor } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.targetId ? { targetId: q.targetId } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(q.result === 'failure' ? failure : {}),
      ...(q.result === 'success'
        ? { errorCode: null, statusCode: { lt: 400 } }
        : {}),
    },
    orderBy: { id: 'desc' },
    take: q.limit + 1,
  })
  return toPage(
    rows,
    q.limit,
    row => row.id,
    row => ({
      id: row.id,
      actor: row.actor,
      actorRole: row.actorRole,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      statusCode: row.statusCode,
      errorCode: row.errorCode,
      summary: row.summary ?? null,
      ip: row.ip,
      userAgent: row.userAgent,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    }),
  )
}
