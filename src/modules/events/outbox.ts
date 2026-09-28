import { randomUUID } from 'node:crypto'
import type { Tx } from '@/shared/infra/prisma'
import { logger } from '@/shared/observability/logger'
import type { EventEnvelope, EventType, SubscriptionRef } from './domain/event'

export type AppendEventInput = {
  appCode: string
  type: EventType
  installationId: number
  memberId: string
  subscription: SubscriptionRef | null
  data?: Record<string, unknown>
  /**
   * Identidade da decisão (ex.: `renewed:<sub>:<periodStart>`). Uma decisão
   * reprocessada — webhook repetido, varredura — não gera segundo evento.
   */
  dedupeKey?: string
  occurredAt?: Date
}

/**
 * Grava o evento no outbox **dentro da transação da decisão**. A entrega é do
 * worker (`EventDelivery`), depois do commit: se o processo cair entre os dois, o
 * evento continua `pending` e sai no próximo ciclo.
 *
 * Devolve `null` quando o evento não é gravado: decisão já registrada (mesma
 * `dedupeKey`) ou aplicação desativada — app inativo não recebe eventos novos.
 */
export async function appendEvent(
  tx: Tx,
  input: AppendEventInput,
): Promise<EventEnvelope | null> {
  if (input.dedupeKey) {
    const existing = await tx.outboxEvent.findUnique({
      where: { dedupeKey: input.dedupeKey },
    })
    if (existing) return null
  }

  const app = await tx.app.findUnique({
    where: { appCode: input.appCode },
    select: { active: true },
  })
  if (!app?.active) {
    logger().info(
      { appCode: input.appCode, type: input.type },
      'evento não gravado: aplicação inexistente ou inativa',
    )
    return null
  }

  const envelope: EventEnvelope = {
    eventId: randomUUID(),
    type: input.type,
    appCode: input.appCode,
    installationId: input.installationId,
    memberId: input.memberId,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    subscription: input.subscription,
    data: input.data ?? {},
  }

  await tx.outboxEvent.create({
    data: {
      eventId: envelope.eventId,
      appCode: envelope.appCode,
      type: envelope.type,
      installationId: envelope.installationId,
      subscriptionId: envelope.subscription?.id ?? null,
      version: envelope.subscription?.version ?? null,
      payload: JSON.parse(JSON.stringify(envelope)) as object,
      dedupeKey: input.dedupeKey ?? null,
    },
  })

  return envelope
}
