import { env } from '@/config/env'
import { createPrismaClient } from '@/shared/infra/prisma'
import { createRedis } from '@/shared/infra/redis'
import { BullJobQueue } from '@/shared/infra/queue'
import {
  configureLogger,
  type LoggerOptions,
} from '@/shared/observability/logger'
import { validateSpaConfig } from '@/modules/billing/infra/spa/spa-field-guards'
import { buildContainer } from './container'
import { HealthState } from './health'

/**
 * Boot comum de `api` e `worker`. Falha (e o processo não sobe) sem configuração
 * válida, sem chave de cifragem ou sem chave de assinatura do JWT ativa.
 */
export async function bootstrap(service: LoggerOptions['service']) {
  const config = env()
  const log = configureLogger({
    service,
    level: config.logLevel,
    lokiUrl: config.lokiUrl || undefined,
    environment: config.platformEnvironment,
  })

  if (!config.bitrixTlsRejectUnauthorized) {
    if (config.nodeEnv === 'production') {
      throw new Error(
        'BITRIX_TLS_REJECT_UNAUTHORIZED=false não é permitido em produção',
      )
    }
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    log.warn('verificação TLS desligada (somente desenvolvimento)')
  }

  const db = createPrismaClient(config.databaseUrl)
  const redis = createRedis(config.redisUrl)
  const queue = new BullJobQueue(redis, config.queuePrefix)
  const container = buildContainer({
    env: config,
    db,
    redis,
    locks: redis,
    queue,
  })

  await container.signingKeys.ensureActive(config.jwt.bootstrapPrivateKey)

  const health = new HealthState(db, redis)
  const checkSpa = async () => {
    if (!config.crmthink.webhookUrl) {
      health.setSpaProblems([
        {
          entityTypeId: 0,
          field: '*',
          problem: 'CRMTHINK_WEBHOOK_URL não configurado',
        },
      ])
      return
    }
    health.setSpaProblems(
      await validateSpaConfig(container.crm, container.spaConfig),
    )
  }

  const shutdown = async () => {
    await queue.close().catch(() => undefined)
    await db.$disconnect().catch(() => undefined)
    redis.disconnect()
  }

  return {
    config,
    log,
    db,
    redis,
    queue,
    container,
    health,
    checkSpa,
    shutdown,
  }
}
