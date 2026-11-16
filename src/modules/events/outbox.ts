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

  const row = await tx.outboxEvent.create({
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

  await fanOutToEndpoints(tx, envelope, row.seq)

  return envelope
}

/**
 * Uma entrega pendente por destinatário ativo cujo filtro de tipos e de apps inclui o
 * evento, na mesma transação do evento. Cada entrega tem estado e retentativa próprios,
 * independentes da entrega ao app. A tabela de destinatários é pequena, então o filtro
 * roda aqui em vez de em coluna JSON. Destinatário criado depois não recebe o passado.
 */
async function fanOutToEndpoints(
  tx: Tx,
  envelope: EventEnvelope,
  eventSeq: number,
): Promise<void> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { active: true },
  })
  for (const endpoint of endpoints) {
    const types = endpoint.eventTypes as string[]
    const apps = endpoint.appCodes as string[]
    if (!types.includes(envelope.type)) continue
    if (apps.length > 0 && !apps.includes(envelope.appCode)) continue
    await tx.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventId: envelope.eventId,
        eventSeq,
        installationId: envelope.installationId,
        appCode: envelope.appCode,
        eventType: envelope.type,
      },
    })
  }
}
