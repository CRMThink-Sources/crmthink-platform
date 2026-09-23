import { randomUUID } from 'node:crypto'
import express, { Router, type Express } from 'express'
import { errorMiddleware } from '@/shared/http/errors'
import { runWithLogContext } from '@/shared/observability/log-context'
import { logger } from '@/shared/observability/logger'
import { registry as metricsRegistry } from '@/shared/observability/metrics'
import { adminRoutes } from '@/modules/registry/http/admin-routes'
import { appAuth } from '@/modules/registry/http/auth'
import {
  appInstallationRoutes,
  publicInstallRoutes,
  sessionRoutes,
  type InstallationRoutesDeps,
} from '@/modules/installations/http/routes'
import {
  appBillingRoutes,
  billingWebhookRoutes,
} from '@/modules/billing/http/routes'
import type { Container } from './container'
import type { HealthState } from './health'

/**
 * App HTTP. A ordem importa: rotas com parser próprio (corpo cru do Stripe,
 * form-urlencoded do Bitrix) vêm antes de qualquer `express.json()` global — não há
 * parser global de propósito.
 */
export function createApp(container: Container, health: HealthState): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)

  app.use((req, res, next) => {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID()
    res.setHeader('X-Request-Id', requestId)
    const startedAt = Date.now()
    res.on('finish', () => {
      logger().info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          requestId,
        },
        'request',
      )
    })
    runWithLogContext({ requestId }, next)
  })

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.get('/health/ready', (_req, res, next) => {
    health
      .check()
      .then(result => res.status(result.ok ? 200 : 503).json(result))
      .catch(next)
  })
  app.get('/metrics', (_req, res, next) => {
    metricsRegistry
      .metrics()
      .then(body => res.type(metricsRegistry.contentType).send(body))
      .catch(next)
  })

  const installationDeps: InstallationRoutesDeps = {
    registry: container.registry,
    install: container.install,
    appEvents: container.appEvents,
    queries: container.queries,
    vault: container.vault,
    sessions: container.sessions,
    signingKeys: container.signingKeys,
    sessionCorsOrigins: container.env.sessionCorsOrigins,
  }
  const billingDeps = {
    registry: container.registry,
    plans: container.plans,
    checkout: container.checkout,
    subscriptions: container.subscriptionQueries,
    items: container.items,
    stripeIngest: container.stripeIngest,
    spaIngest: container.spaIngest,
  }

  app.use(billingWebhookRoutes(billingDeps))
  app.use(publicInstallRoutes(installationDeps))
  app.use(sessionRoutes(installationDeps))
  app.use(
    adminRoutes({
      db: container.db,
      adminTokens: container.env.adminApiTokens,
      registry: container.registry,
      delivery: container.delivery,
      signingKeys: container.signingKeys,
      trials: container.trials,
      sweeps: container.sweeps,
    }),
  )
  // Tudo daqui em diante é servidor-a-servidor: uma autenticação por chave de API.
  const appApi = Router()
  appApi.use(appAuth(container.registry))
  appApi.use(appInstallationRoutes(installationDeps))
  appApi.use(appBillingRoutes(billingDeps))
  app.use(appApi)

  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } })
  })
  app.use(errorMiddleware())
  return app
}
