import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import { notFound } from '@/shared/http/errors'
import {
  decodeCursor,
  pageQuerySchema,
  periodQuerySchema,
  periodWhere,
  toPage,
} from './pagination'

/**
 * Listagens de eventos do backoffice: o outbox (eventos enviados aos apps) e os
 * eventos recebidos do Stripe. Paginadas por cursor; a do Stripe nunca traz o payload
 * — só o detalhe, e só para `operator` (ver `policy.ts`).
 */

export const outboxQuerySchema = pageQuerySchema
  .extend(periodQuerySchema.shape)
  .extend({
    appCode: z.string().max(100).optional(),
    status: z.enum(['pending', 'delivered', 'dead']).optional(),
    type: z.string().max(60).optional(),
    installationId: z.coerce.number().int().positive().optional(),
  })

export const stripeQuerySchema = pageQuerySchema
  .extend(periodQuerySchema.shape)
  .extend({
    appCode: z.string().max(100).optional(),
    status: z.string().max(20).optional(),
    type: z.string().max(100).optional(),
  })

export async function listOutboxEvents(db: Db, query: unknown) {
  const q = outboxQuerySchema.parse(query)
  const before = decodeCursor(q.cursor, z.number().int().positive())
  const createdAt = periodWhere(q)
  const rows = await db.outboxEvent.findMany({
    where: {
      ...(before ? { seq: { lt: before } } : {}),
      ...(q.appCode ? { appCode: q.appCode } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.installationId ? { installationId: q.installationId } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { seq: 'desc' },
    take: q.limit + 1,
    include: { deliveries: { orderBy: { attempt: 'desc' }, take: 3 } },
  })
  return toPage(
    rows,
    q.limit,
    row => row.seq,
    row => row,
  )
}

const stripeCursorSchema = z.tuple([z.iso.datetime(), z.string().min(1)])

export async function listStripeEvents(db: Db, query: unknown) {
  const q = stripeQuerySchema.parse(query)
  const before = decodeCursor(q.cursor, stripeCursorSchema)
  const receivedAt = periodWhere(q)
  const at = before ? new Date(before[0]) : null
  const rows = await db.stripeEvent.findMany({
    where: {
      ...(before && at
        ? {
            OR: [
              { receivedAt: { lt: at } },
              { receivedAt: at, eventId: { lt: before[1] } },
            ],
          }
        : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.appCode ? { appCode: q.appCode } : {}),
      ...(receivedAt ? { receivedAt } : {}),
    },
    orderBy: [{ receivedAt: 'desc' }, { eventId: 'desc' }],
    take: q.limit + 1,
    select: {
      eventId: true,
      type: true,
      appCode: true,
      status: true,
      attempts: true,
      error: true,
      receivedAt: true,
      processedAt: true,
    },
  })
  return toPage(
    rows,
    q.limit,
    row => [row.receivedAt.toISOString(), row.eventId],
    ({
      eventId,
      type,
      appCode,
      status,
      attempts,
      error,
      receivedAt,
      processedAt,
    }) => ({
      eventId,
      type,
      appCode,
      status,
      attempts,
      error,
      receivedAt,
      processedAt,
    }),
  )
}

/** Um evento Stripe com o payload cru (só `operator`). */
export async function getStripeEvent(db: Db, eventId: string) {
  const row = await db.stripeEvent.findUnique({ where: { eventId } })
  if (!row) throw notFound('NOT_FOUND', 'Evento Stripe não encontrado')
  return row
}
