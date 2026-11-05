import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { Fetch } from '@/shared/bitrix/bitrix-rest.client'
import {
  buildSignatureHeader,
  SIGNATURE_HEADER,
} from '@/shared/crypto/hmac-signature'
import { withLock, type LockStore } from '@/shared/infra/redis'
import { logger, scrubSecrets } from '@/shared/observability/logger'
import { metrics } from '@/shared/observability/metrics'
import { raiseAlert } from '@/shared/observability/alert'
import { runWithLogContext } from '@/shared/observability/log-context'
import { HttpError } from '@/shared/http/errors'
import type { AppRegistry } from '@/modules/registry/app-registry'

/**
 * Entrega dos eventos do outbox às aplicações (`POST <webhook_url>` assinado).
 *
 * Relay por polling do outbox, e não um job de fila por evento: o outbox **é** a fila
 * durável (nada se perde entre o commit e o enfileiramento), e o polling permite
 * ordenar por instalação — só o evento pendente mais antigo de cada instalação sai,
 * então `installation.created` nunca chega depois de `subscription.trial_started`.
 *
 * Falha (não 2xx ou timeout) reagenda com backoff exponencial; passada a janela
 * (24h desde a criação ou do último reenvio manual), dead-letter + alerta.
 */

/** Proteção do reenvio em lote: acima disso o operador reduz o período ou o filtro. */
export const RESEND_LIMIT = 5000

export type ResendSelector =
  | { eventId: string; dryRun?: boolean }
  | {
      appCode?: string
      installationId?: number
      from: Date
      to: Date
      onlyDead?: boolean
      type?: string
      dryRun?: boolean
    }

export type ResendPreview = { matched: number; sample: string[] }

export const BACKOFF_BASE_MS = 30_000
export const BACKOFF_MAX_MS = 60 * 60_000

export function nextBackoffMs(attempt: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
    BACKOFF_MAX_MS,
  )
}

export type DeliveryOptions = {
  timeoutMs: number
  retryWindowMs: number
  batchSize?: number
}

export class EventDelivery {
  constructor(
    private readonly db: Db,
    private readonly registry: AppRegistry,
    private readonly locks: LockStore,
    private readonly clock: Clock,
    private readonly options: DeliveryOptions,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  /**
   * Um ciclo do relay: entrega o evento mais antigo pendente de cada instalação cujo
   * horário de tentativa já chegou. Devolve quantos foram tentados.
   */
  async dispatchDue(): Promise<number> {
    const now = this.clock.now()
    const due = await this.db.outboxEvent.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now } },
      orderBy: { seq: 'asc' },
      take: this.options.batchSize ?? 100,
      select: { eventId: true, appCode: true, installationId: true, seq: true },
    })

    const heads = new Map<string, (typeof due)[number]>()
    for (const event of due) {
      const key = `${event.appCode}:${event.installationId}`
      if (!heads.has(key)) heads.set(key, event)
    }

    let attempted = 0
    await Promise.all(
      [...heads.values()].map(async head => {
        // Um evento mais antigo da mesma instalação, ainda em backoff, segura a fila.
        const older = await this.db.outboxEvent.count({
          where: {
            appCode: head.appCode,
            installationId: head.installationId,
            status: 'pending',
            seq: { lt: head.seq },
          },
        })
        if (older > 0) return
        try {
          await withLock(
            this.locks,
            `delivery:${head.appCode}:${head.installationId}`,
            { ttlMs: this.options.timeoutMs + 5_000 },
            () => this.deliver(head.eventId),
          )
          attempted++
        } catch (error) {
          // Outro worker com o lock: ele entrega.
          logger().debug(
            { err: error, eventId: head.eventId },
            'delivery skipped',
          )
        }
      }),
    )

    await this.refreshGauges()
    return attempted
  }

  /** Uma tentativa de entrega. Idempotente para evento já entregue ou morto. */
  async deliver(
    eventId: string,
  ): Promise<'delivered' | 'retry' | 'dead' | 'skipped'> {
    const event = await this.db.outboxEvent.findUnique({ where: { eventId } })
    if (!event || event.status !== 'pending') return 'skipped'

    return runWithLogContext(
      {
        appCode: event.appCode,
        installationId: event.installationId,
        subscriptionId: event.subscriptionId ?? undefined,
        eventId,
      },
      async () => {
        const attempt = event.attempts + 1
        const now = this.clock.now()
        const app = await this.registry.get(event.appCode)

        let statusCode: number | null = null
        let error: string | null = null

        if (!app?.active) {
          error = 'aplicação inativa'
        } else if (!app.webhookUrl) {
          error = 'aplicação sem webhook_url'
        } else {
          const body = JSON.stringify(event.payload)
          try {
            const { webhookSecrets } = await this.registry.secrets(app.appCode)
            const response = await this.fetchImpl(app.webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [SIGNATURE_HEADER]: buildSignatureHeader(
                  webhookSecrets,
                  body,
                  now,
                ),
                'X-Platform-Event-Id': event.eventId,
                'X-Platform-Event-Type': event.type,
              },
              body,
              signal: AbortSignal.timeout(this.options.timeoutMs),
            })
            statusCode = response.status
            if (!response.ok) error = `HTTP ${response.status}`
          } catch (err) {
            error = scrubSecrets(
              err instanceof Error ? err.message : String(err),
            )
          }
        }

        if (!error) {
          await this.db.$transaction([
            this.db.eventDelivery.create({
              data: { eventId, attempt, statusCode, deliveredAt: now },
            }),
            this.db.outboxEvent.update({
              where: { eventId },
              data: {
                status: 'delivered',
                attempts: attempt,
                deliveredAt: now,
              },
            }),
          ])
          metrics.eventDeliveries.inc({
            appCode: event.appCode,
            outcome: 'delivered',
          })
          logger().info({ type: event.type, attempt }, 'event delivered')
          return 'delivered'
        }

        const nextAttemptAt = new Date(now.getTime() + nextBackoffMs(attempt))
        const windowEnd =
          event.windowStartedAt.getTime() + this.options.retryWindowMs
        const dead = nextAttemptAt.getTime() > windowEnd

        await this.db.$transaction([
          this.db.eventDelivery.create({
            data: {
              eventId,
              attempt,
              statusCode,
              error,
              nextAttemptAt: dead ? null : nextAttemptAt,
            },
          }),
          this.db.outboxEvent.update({
            where: { eventId },
            data: dead
              ? { status: 'dead', attempts: attempt, deadAt: now }
              : { attempts: attempt, nextAttemptAt },
          }),
        ])

        metrics.eventDeliveries.inc({
          appCode: event.appCode,
          outcome: dead ? 'dead' : 'failed',
        })
        if (dead) {
          raiseAlert(
            'event.dead_letter',
            { type: event.type, attempts: attempt, lastError: error },
            'evento esgotou a janela de reenvio e foi para dead-letter',
          )
          return 'dead'
        }
        logger().warn(
          { type: event.type, attempt, statusCode, error },
          'event delivery failed',
        )
        return 'retry'
      },
    )
  }

  /**
   * Reenvio manual: volta eventos a `pending` com janela nova. Por `eventId`, ou por
   * intervalo de criação de um app e/ou de uma instalação (opcionalmente só os mortos).
   *
   * Com `dryRun` só conta (`matched` e até 5 `eventId` de amostra) e não altera nada.
   * Um seletor por filtro com mais de `RESEND_LIMIT` eventos é recusado (422).
   */
  async resend(
    selector: ResendSelector & { dryRun: true },
  ): Promise<ResendPreview>
  async resend(selector: ResendSelector): Promise<number | ResendPreview>
  async resend(selector: ResendSelector): Promise<number | ResendPreview> {
    const now = this.clock.now()
    const where =
      'eventId' in selector
        ? { eventId: selector.eventId }
        : {
            ...(selector.appCode ? { appCode: selector.appCode } : {}),
            ...(selector.installationId
              ? { installationId: selector.installationId }
              : {}),
            createdAt: { gte: selector.from, lte: selector.to },
            ...(selector.onlyDead ? { status: 'dead' } : {}),
            ...(selector.type ? { type: selector.type } : {}),
          }

    if (selector.dryRun) {
      const [matched, sample] = await Promise.all([
        this.db.outboxEvent.count({ where }),
        this.db.outboxEvent.findMany({
          where,
          orderBy: { seq: 'asc' },
          take: 5,
          select: { eventId: true },
        }),
      ])
      return { matched, sample: sample.map(row => row.eventId) }
    }

    if (!('eventId' in selector)) {
      const matched = await this.db.outboxEvent.count({ where })
      if (matched > RESEND_LIMIT) {
        throw new HttpError(
          422,
          'RESEND_TOO_LARGE',
          `O filtro encontrou ${matched} eventos; o limite por reenvio é ${RESEND_LIMIT}. Reduza o período.`,
          { matched, limit: RESEND_LIMIT },
        )
      }
    }

    const result = await this.db.outboxEvent.updateMany({
      where,
      data: {
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        windowStartedAt: now,
        deadAt: null,
      },
    })
    return result.count
  }

  async refreshGauges(): Promise<void> {
    const [pending, dead] = await Promise.all([
      this.db.outboxEvent.count({ where: { status: 'pending' } }),
      this.db.outboxEvent.count({ where: { status: 'dead' } }),
    ])
    metrics.eventsPending.set(pending)
    metrics.eventsDead.set(dead)
  }
}
