import type { Fetch } from '@/shared/bitrix/bitrix-rest.client'
import type { Clock } from '@/shared/clock'
import {
  buildSignatureHeader,
  SIGNATURE_HEADER,
} from '@/shared/crypto/hmac-signature'
import { HttpError, notFound } from '@/shared/http/errors'
import type { Db } from '@/shared/infra/prisma'
import { withLock, type LockStore } from '@/shared/infra/redis'
import { raiseAlert } from '@/shared/observability/alert'
import { runWithLogContext } from '@/shared/observability/log-context'
import { logger, scrubSecrets } from '@/shared/observability/logger'
import { metrics } from '@/shared/observability/metrics'
import {
  nextBackoffMs,
  RESEND_LIMIT,
  type DeliveryOptions,
} from './event-delivery'
import type { WebhookEndpoints } from './webhook-endpoints'

/**
 * Entrega dos eventos do outbox aos destinatários cadastrados (`POST <url>` assinado).
 *
 * Espelha o relay dos apps (`EventDelivery`), mas com estado próprio por entrega
 * (`webhook_delivery`): um destinatário fora do ar não atrasa nem mata a entrega ao app
 * nem a outro destinatário. A ordem vale por par (destinatário, instalação): só a
 * entrega pendente mais antiga de cada par sai, e `dead` não bloqueia as seguintes.
 *
 * Mesmo envelope e cabeçalhos dos apps, assinados com o segredo do destinatário (um
 * `v1` por segredo vigente, durante a rotação). Não segue redirecionamento: `3xx`
 * conta como falha, para a URL cadastrada não virar um salto para dentro da rede.
 */
export class WebhookDelivery {
  constructor(
    private readonly db: Db,
    private readonly endpoints: WebhookEndpoints,
    private readonly locks: LockStore,
    private readonly clock: Clock,
    private readonly options: DeliveryOptions,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  /** Um ciclo: tenta a entrega pendente mais antiga de cada par vencida e de destinatário ativo. */
  async dispatchDue(): Promise<number> {
    const now = this.clock.now()
    const due = await this.db.webhookDelivery.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: now },
        endpoint: { active: true },
      },
      orderBy: { eventSeq: 'asc' },
      take: this.options.batchSize ?? 100,
      select: {
        id: true,
        endpointId: true,
        installationId: true,
        eventSeq: true,
      },
    })

    const heads = new Map<string, (typeof due)[number]>()
    for (const delivery of due) {
      const key = `${delivery.endpointId}:${delivery.installationId}`
      if (!heads.has(key)) heads.set(key, delivery)
    }

    let attempted = 0
    await Promise.all(
      [...heads.values()].map(async head => {
        // Uma entrega mais antiga do mesmo par, ainda em backoff, segura a fila.
        const older = await this.db.webhookDelivery.count({
          where: {
            endpointId: head.endpointId,
            installationId: head.installationId,
            status: 'pending',
            eventSeq: { lt: head.eventSeq },
          },
        })
        if (older > 0) return
        try {
          await withLock(
            this.locks,
            `webhook:${head.endpointId}:${head.installationId}`,
            { ttlMs: this.options.timeoutMs + 5_000 },
            () => this.deliver(head.id),
          )
          attempted++
        } catch (error) {
          // Outro worker com o lock: ele entrega.
          logger().debug(
            { err: error, deliveryId: head.id },
            'webhook delivery skipped',
          )
        }
      }),
    )

    await this.refreshGauges()
    return attempted
  }

  /** Uma tentativa. Idempotente para entrega já concluída; não tenta se o destinatário foi desativado. */
  async deliver(
    deliveryId: number,
  ): Promise<'delivered' | 'retry' | 'dead' | 'skipped'> {
    const delivery = await this.db.webhookDelivery.findUnique({
      where: { id: deliveryId },
    })
    if (!delivery || delivery.status !== 'pending') return 'skipped'
    const [endpoint, event] = await Promise.all([
      this.db.webhookEndpoint.findUnique({
        where: { id: delivery.endpointId },
      }),
      this.db.outboxEvent.findUnique({ where: { eventId: delivery.eventId } }),
    ])
    if (!endpoint?.active || !event) return 'skipped'

    return runWithLogContext(
      {
        appCode: delivery.appCode,
        installationId: delivery.installationId,
        eventId: delivery.eventId,
      },
      async () => {
        const attempt = delivery.attempts + 1
        const now = this.clock.now()
        const body = JSON.stringify(event.payload)

        let statusCode: number | null = null
        let error: string | null = null
        try {
          const secrets = await this.endpoints.secrets(endpoint.id)
          const response = await this.fetchImpl(endpoint.url, {
            method: 'POST',
            redirect: 'manual',
            headers: {
              'Content-Type': 'application/json',
              [SIGNATURE_HEADER]: buildSignatureHeader(secrets, body, now),
              'X-Platform-Event-Id': event.eventId,
              'X-Platform-Event-Type': event.type,
            },
            body,
            signal: AbortSignal.timeout(this.options.timeoutMs),
          })
          statusCode = response.status
          if (!response.ok) error = `HTTP ${response.status}`
        } catch (err) {
          error = scrubSecrets(err instanceof Error ? err.message : String(err))
        }

        if (!error) {
          await this.db.$transaction([
            this.db.webhookDeliveryAttempt.create({
              data: { deliveryId, attempt, statusCode, deliveredAt: now },
            }),
            this.db.webhookDelivery.update({
              where: { id: deliveryId },
              data: {
                status: 'delivered',
                attempts: attempt,
                deliveredAt: now,
              },
            }),
          ])
          metrics.webhookDeliveries.inc({ outcome: 'delivered' })
          logger().info(
            { type: event.type, endpointId: endpoint.id, attempt },
            'webhook delivered',
          )
          return 'delivered'
        }

        const nextAttemptAt = new Date(now.getTime() + nextBackoffMs(attempt))
        const windowEnd =
          delivery.windowStartedAt.getTime() + this.options.retryWindowMs
        const dead = nextAttemptAt.getTime() > windowEnd

        await this.db.$transaction([
          this.db.webhookDeliveryAttempt.create({
            data: {
              deliveryId,
              attempt,
              statusCode,
              error,
              nextAttemptAt: dead ? null : nextAttemptAt,
            },
          }),
          this.db.webhookDelivery.update({
            where: { id: deliveryId },
            data: dead
              ? { status: 'dead', attempts: attempt, deadAt: now }
              : { attempts: attempt, nextAttemptAt },
          }),
        ])

        metrics.webhookDeliveries.inc({ outcome: dead ? 'dead' : 'failed' })
        if (dead) {
          raiseAlert(
            'webhook.dead_letter',
            {
              type: event.type,
              endpointId: endpoint.id,
              attempts: attempt,
              lastError: error,
            },
            'entrega a destinatário esgotou a janela de reenvio e foi para dead-letter',
          )
          return 'dead'
        }
        logger().warn(
          {
            type: event.type,
            endpointId: endpoint.id,
            attempt,
            statusCode,
            error,
          },
          'webhook delivery failed',
        )
        return 'retry'
      },
    )
  }

  /** Devolve uma entrega (em qualquer estado) a `pending`, com janela nova. */
  async resend(deliveryId: number): Promise<void> {
    const delivery = await this.db.webhookDelivery.findUnique({
      where: { id: deliveryId },
    })
    if (!delivery)
      throw notFound('WEBHOOK_DELIVERY_NOT_FOUND', 'Entrega não encontrada')
    await this.db.webhookDelivery.update({
      where: { id: deliveryId },
      data: this.requeue(),
    })
  }

  /**
   * Reenvia todas as entregas mortas do destinatário. Com `dryRun` só conta. Acima de
   * `RESEND_LIMIT` o operador reduz o conjunto (422).
   */
  async resendDead(
    endpointId: number,
    options: { dryRun?: boolean },
  ): Promise<{ matched: number; requeued: number }> {
    await this.endpoints.get(endpointId)
    const where = { endpointId, status: 'dead' }
    const matched = await this.db.webhookDelivery.count({ where })
    if (options.dryRun) return { matched, requeued: 0 }
    if (matched > RESEND_LIMIT) {
      throw new HttpError(
        422,
        'RESEND_TOO_LARGE',
        `O destinatário tem ${matched} entregas mortas; o limite por reenvio é ${RESEND_LIMIT}.`,
        { matched, limit: RESEND_LIMIT },
      )
    }
    const result = await this.db.webhookDelivery.updateMany({
      where,
      data: this.requeue(),
    })
    return { matched, requeued: result.count }
  }

  async counts(endpointId: number): Promise<{ pending: number; dead: number }> {
    const [pending, dead] = await Promise.all([
      this.db.webhookDelivery.count({
        where: { endpointId, status: 'pending' },
      }),
      this.db.webhookDelivery.count({ where: { endpointId, status: 'dead' } }),
    ])
    return { pending, dead }
  }

  async refreshGauges(): Promise<void> {
    const [pending, dead] = await Promise.all([
      this.db.webhookDelivery.count({ where: { status: 'pending' } }),
      this.db.webhookDelivery.count({ where: { status: 'dead' } }),
    ])
    metrics.webhookDeliveriesPending.set(pending)
    metrics.webhookDeliveriesDead.set(dead)
  }

  private requeue() {
    const now = this.clock.now()
    return {
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      windowStartedAt: now,
      deliveredAt: null,
      deadAt: null,
    }
  }
}
