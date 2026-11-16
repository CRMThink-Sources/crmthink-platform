import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import { decodeCursor, pageQuerySchema, toPage } from './pagination'

/**
 * Entregas de um destinatário de eventos para o backoffice, da mais recente para a mais
 * antiga, paginadas por cursor. Mostram estado e tentativas (status HTTP e erro), nunca o
 * corpo do evento.
 */

/** Tentativas mostradas por entrega (as mais recentes). */
const ATTEMPTS_SHOWN = 3

export const webhookDeliveriesQuerySchema = pageQuerySchema.extend({
  status: z.enum(['pending', 'delivered', 'dead']).optional(),
})

export async function listWebhookDeliveries(
  db: Db,
  endpointId: number,
  query: unknown,
) {
  const q = webhookDeliveriesQuerySchema.parse(query)
  const before = decodeCursor(q.cursor, z.number().int().positive())
  const rows = await db.webhookDelivery.findMany({
    where: {
      endpointId,
      ...(before ? { id: { lt: before } } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    orderBy: { id: 'desc' },
    take: q.limit + 1,
  })
  const shown = rows.slice(0, q.limit)
  const attempts = shown.length
    ? await db.webhookDeliveryAttempt.findMany({
        where: { deliveryId: { in: shown.map(row => row.id) } },
        orderBy: { attempt: 'desc' },
      })
    : []
  const byDelivery = new Map<number, typeof attempts>()
  for (const attempt of attempts) {
    const list = byDelivery.get(attempt.deliveryId) ?? []
    if (list.length < ATTEMPTS_SHOWN) list.push(attempt)
    byDelivery.set(attempt.deliveryId, list)
  }

  return toPage(
    rows,
    q.limit,
    row => row.id,
    row => ({
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      installationId: row.installationId,
      appCode: row.appCode,
      status: row.status as 'pending' | 'delivered' | 'dead',
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      deliveredAt: row.deliveredAt,
      deadAt: row.deadAt,
      createdAt: row.createdAt,
      attemptLog: (byDelivery.get(row.id) ?? []).map(attempt => ({
        attempt: attempt.attempt,
        statusCode: attempt.statusCode,
        error: attempt.error,
        nextAttemptAt: attempt.nextAttemptAt,
        deliveredAt: attempt.deliveredAt,
        createdAt: attempt.createdAt,
      })),
    }),
  )
}
