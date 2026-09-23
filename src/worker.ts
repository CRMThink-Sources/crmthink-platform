import { createServer } from 'node:http'
import { Worker, type Job } from 'bullmq'
import {
  metrics,
  registry as metricsRegistry,
} from '@/shared/observability/metrics'
import { QUEUES } from '@/shared/infra/queue'
import type { SpaEventJob } from '@/modules/billing/application/spa-events'
import { bootstrap } from './bootstrap'

/**
 * Processo `worker`: filas (webhooks Stripe, eventos dos SPAs) e agendamentos
 * (renovação de tokens, entrega de eventos, trials, avisos, varreduras).
 *
 * Os agendamentos são *job schedulers* do BullMQ: com várias instâncias do worker,
 * cada disparo roda em uma só.
 */

const SCHEDULES: Array<{
  id: string
  every?: number
  pattern?: string
  tz?: string
}> = [
  { id: 'deliver-events', every: 5_000 },
  { id: 'refresh-tokens', every: 60_000 },
  { id: 'expire-trials', every: 15 * 60_000 },
  { id: 'period-ending', pattern: '0 9 * * *', tz: 'America/Sao_Paulo' },
  { id: 'sweep-stripe', every: 60 * 60_000 },
  { id: 'sweep-spa', every: 15 * 60_000 },
  { id: 'gauges', every: 60_000 },
]

async function main(): Promise<void> {
  const boot = await bootstrap('crmthink-platform-worker')
  const { container, log, redis, config } = boot
  const connection = redis
  const prefix = config.queuePrefix

  const stripeWorker = new Worker(
    QUEUES.stripeEvents,
    async (job: Job<{ eventId: string }>) =>
      container.stripeProcessor.process(job.data.eventId),
    { connection, prefix, concurrency: 5 },
  )
  stripeWorker.on('failed', (job, error) => {
    if (!job) return
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1)
    const action = exhausted
      ? container.stripeProcessor.markDead(job.data.eventId, error.message)
      : container.stripeProcessor.markFailedAttempt(
          job.data.eventId,
          error.message,
        )
    void action.catch(err =>
      log.error({ err }, 'falha ao registrar erro do evento Stripe'),
    )
    log.warn(
      { eventId: job.data.eventId, attempt: job.attemptsMade, err: error },
      'processamento de evento Stripe falhou',
    )
  })

  const spaWorker = new Worker(
    QUEUES.spaEvents,
    async (job: Job<SpaEventJob>) => container.spaProcessor.process(job.data),
    { connection, prefix, concurrency: 5 },
  )
  spaWorker.on('failed', (job, error) => {
    log.warn(
      { job: job?.data, attempt: job?.attemptsMade, err: error },
      'processamento de evento do SPA falhou',
    )
  })

  const handlers: Record<string, () => Promise<unknown>> = {
    'deliver-events': () => container.delivery.dispatchDue(),
    'refresh-tokens': () => container.vault.refreshDue(),
    'expire-trials': () => container.trials.expireDue(),
    'period-ending': () => container.periodEnding.run(),
    'sweep-stripe': () => container.sweeps.stripeSweep(),
    'sweep-spa': () => container.sweeps.spaSweep(),
    gauges: async () => {
      const [pending, authError] = await Promise.all([
        boot.db.installation.count({ where: { status: 'INSTALL_PENDING' } }),
        boot.db.installation.count({ where: { status: 'AUTH_ERROR' } }),
      ])
      metrics.installationsPending.set(pending)
      metrics.installationsAuthError.set(authError)
      await container.delivery.refreshGauges()
    },
  }

  const scheduledWorker = new Worker(
    QUEUES.scheduled,
    async (job: Job) => {
      const handler = handlers[job.name]
      if (!handler) return null
      return handler()
    },
    // Um disparo por vez de cada tipo basta; a varredura longa não trava a entrega.
    { connection, prefix, concurrency: 4 },
  )
  scheduledWorker.on('failed', (job, error) => {
    if (job?.name?.startsWith('sweep-'))
      metrics.sweepFailures.inc({ kind: job.name.replace('sweep-', '') })
    log.error({ job: job?.name, err: error }, 'job agendado falhou')
  })

  if (!config.workerDisableSchedules) {
    const queue = boot.queue.queue(QUEUES.scheduled)
    for (const schedule of SCHEDULES) {
      await queue.upsertJobScheduler(
        schedule.id,
        schedule.every
          ? { every: schedule.every }
          : { pattern: schedule.pattern, tz: schedule.tz },
        {
          name: schedule.id,
          opts: { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
        },
      )
    }
  }

  log.info('worker no ar')

  // Métricas do worker (gauges de pendências, dead-letter, varreduras) para o Prometheus.
  const metricsServer = createServer((req, res) => {
    if (req.url === '/metrics') {
      void metricsRegistry.metrics().then(body => {
        res.writeHead(200, { 'Content-Type': metricsRegistry.contentType })
        res.end(body)
      })
      return
    }
    res.writeHead(req.url === '/health' ? 200 : 404, {
      'Content-Type': 'application/json',
    })
    res.end(
      JSON.stringify({ status: req.url === '/health' ? 'ok' : 'not found' }),
    )
  }).listen(config.port)

  const stop = () => {
    log.info('encerrando worker')
    metricsServer.close()
    void Promise.all([
      stripeWorker.close(),
      spaWorker.close(),
      scheduledWorker.close(),
    ])
      .then(() => boot.shutdown())
      .finally(() => process.exit(0))
    setTimeout(() => process.exit(1), 30_000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch(error => {
  console.error(
    '[crmthink-platform-worker] falha no boot:',
    error instanceof Error ? error.message : error,
  )
  process.exit(1)
})
