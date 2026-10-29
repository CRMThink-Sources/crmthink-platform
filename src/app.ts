import { randomUUID } from 'node:crypto'
import express, { Router, type Express } from 'express'
import { docsRoutes } from '@/docs/docs-routes'
import { backofficeWeb, defaultBackofficeDist } from './backoffice-web'
import { errorMiddleware } from '@/shared/http/errors'
import { runWithLogContext } from '@/shared/observability/log-context'
import { logger } from '@/shared/observability/logger'
import { registry as metricsRegistry } from '@/shared/observability/metrics'
import { adminRoutes } from '@/modules/registry/http/admin-routes'
import { adminGate } from '@/modules/backoffice/http/gate'
import { backofficeRoutes } from '@/modules/backoffice/http/routes'
import { backofficeReadRoutes } from '@/modules/backoffice/http/read-routes'
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
export function createApp(
  container: Container,
  health: HealthState,
  options: { backofficeDist?: string } = {},
): Express {
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

  app.use(docsRoutes(container.env.publicBaseUrl))
  app.use(backofficeWeb(options.backofficeDist ?? defaultBackofficeDist()))

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
    trials: container.trials,
  }

  app.use(billingWebhookRoutes(billingDeps))
  app.use(publicInstallRoutes(installationDeps))
  app.use(sessionRoutes(installationDeps))
  // Operador: sessão do backoffice ou token de script, papel por rota e auditoria
  // das mutações (`adminGate`). O parser JSON vem antes para a auditoria ver o corpo.
  const admin = Router()
  admin.use(
    '/admin',
    express.json({ limit: '64kb' }),
    adminGate({
      tokens: container.env.adminApiTokens,
      sessions: container.adminSessions,
      audit: container.audit,
      origins: container.env.backoffice.origins,
    }),
  )
  admin.use(
    backofficeRoutes({
      login: container.login,
      sessions: container.adminSessions,
      operators: container.operators,
      audit: container.audit,
      cookieSecure: container.env.backoffice.cookieSecure,
      origins: container.env.backoffice.origins,
    }),
  )
  admin.use(
    backofficeReadRoutes({
      db: container.db,
      installations: container.installationReads,
      overview: container.overview,
    }),
  )
  admin.use(
    adminRoutes({
      db: container.db,
      registry: container.registry,
      delivery: container.delivery,
      signingKeys: container.signingKeys,
      trials: container.trials,
      sweeps: container.sweeps,
    }),
  )
  app.use(admin)
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
