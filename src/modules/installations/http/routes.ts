import express, { Router, type RequestHandler } from 'express'
import z from 'zod'
import { asyncHandler, forbidden, intParam } from '@/shared/http/errors'
import { metrics } from '@/shared/observability/metrics'
import { currentApp } from '@/modules/registry/http/auth'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { BitrixAppEvents } from '../application/bitrix-app-events'
import type { InstallationQueries } from '../application/installation-queries'
import {
  installRequestSchema,
  retryRequestSchema,
  type InstallService,
} from '../application/install-service'
import {
  sessionRequestSchema,
  type SessionService,
} from '../application/session-service'
import type { SigningKeys } from '../application/signing-keys'
import type { TokenVault } from '../application/token-vault'
import { renderErrorPage, renderInstallPage } from './install-page'

export type InstallationRoutesDeps = {
  registry: AppRegistry
  install: InstallService
  appEvents: BitrixAppEvents
  queries: InstallationQueries
  vault: TokenVault
  sessions: SessionService
  signingKeys: SigningKeys
  sessionCorsOrigins: Map<string, Set<string>>
}

/** Rotas públicas da instalação: página, `POST /v1/install`, retry e eventos do Bitrix. */
export function publicInstallRoutes(deps: InstallationRoutesDeps): Router {
  const router = Router()

  router.get(
    '/install/:appCode',
    asyncHandler(async (req, res) => {
      const app = await deps.registry.get(req.params.appCode ?? '')
      res.setHeader('Cache-Control', 'no-store')
      if (!app?.active) {
        res
          .status(404)
          .type('html')
          .send(renderErrorPage('Aplicativo não encontrado ou inativo.'))
        return
      }
      res.type('html').send(renderInstallPage(app))
    }),
  )

  router.post(
    '/v1/install',
    express.json({ limit: '32kb' }),
    asyncHandler(async (req, res) => {
      const outcome = await deps.install.install(
        installRequestSchema.parse(req.body),
      )
      res.json(outcome)
    }),
  )

  router.post(
    '/v1/install/retry',
    express.json({ limit: '16kb' }),
    asyncHandler(async (req, res) => {
      const outcome = await deps.install.retry(
        retryRequestSchema.parse(req.body),
      )
      res.json(outcome)
    }),
  )

  // Eventos de instalação do app Bitrix (form-urlencoded).
  router.post(
    '/bitrix/events/:appCode',
    express.urlencoded({ extended: true, limit: '64kb' }),
    express.json({ limit: '64kb' }),
    asyncHandler(async (req, res) => {
      const result = await deps.appEvents.handle(
        req.params.appCode ?? '',
        req.body,
      )
      if (result.status === 401) {
        res
          .status(401)
          .json({ error: { code: 'UNAUTHORIZED', message: result.reason } })
        return
      }
      res.json({ handled: result.handled })
    }),
  )

  router.get(
    '/.well-known/jwks.json',
    asyncHandler(async (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=300')
      res.json(await deps.signingKeys.jwks())
    }),
  )

  return router
}

/**
 * CORS de `POST /v1/sessions`: só as origens de `SESSION_CORS_ORIGINS`, e cada app só
 * com as dele. O preflight aceita qualquer origem configurada (o corpo ainda não é
 * conhecido); a resposta real só leva `Access-Control-Allow-Origin` se a origem for
 * do `appCode` pedido — senão o navegador bloqueia e nada é emitido.
 */
export function sessionCors(origins: Map<string, Set<string>>): {
  preflight: RequestHandler
  enforce: (appCode: string, origin: string | undefined) => boolean
} {
  const all = new Set([...origins.values()].flatMap(set => [...set]))
  return {
    preflight: (req, res) => {
      const origin = req.headers.origin
      res.setHeader('Vary', 'Origin')
      if (origin && all.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Methods', 'POST')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        res.setHeader('Access-Control-Max-Age', '600')
      }
      res.status(204).end()
    },
    enforce: (appCode, origin) =>
      Boolean(origin && origins.get(appCode)?.has(origin)),
  }
}

export function sessionRoutes(deps: InstallationRoutesDeps): Router {
  const router = Router()
  const cors = sessionCors(deps.sessionCorsOrigins)

  router.options('/v1/sessions', cors.preflight)
  router.post(
    '/v1/sessions',
    express.json({ limit: '16kb' }),
    asyncHandler(async (req, res) => {
      const request = sessionRequestSchema.parse(req.body)
      const origin = req.headers.origin
      res.setHeader('Vary', 'Origin')
      if (!cors.enforce(request.appCode, origin)) {
        throw forbidden(
          'ORIGIN_NOT_ALLOWED',
          'Origem não autorizada para este aplicativo',
        )
      }
      res.setHeader('Access-Control-Allow-Origin', origin as string)
      res.json(await deps.sessions.create(request))
    }),
  )
  return router
}

const refreshSchema = z.object({ staleAccessToken: z.string().min(1) })

/** Rotas servidor-a-servidor dos apps. Montadas atrás de `appAuth` (ver `app.ts`). */
export function appInstallationRoutes(deps: InstallationRoutesDeps): Router {
  const router = Router()
  router.use(express.json({ limit: '32kb' }))

  router.get(
    '/v1/installations',
    asyncHandler(async (req, res) => {
      const memberId =
        typeof req.query.memberId === 'string' ? req.query.memberId : ''
      if (!memberId) {
        res.status(400).json({
          error: { code: 'MEMBER_ID_REQUIRED', message: 'Informe memberId' },
        })
        return
      }
      res.json({
        items: await deps.queries.findByMemberId(
          currentApp(res).appCode,
          memberId,
        ),
      })
    }),
  )

  router.get(
    '/v1/installations/:id',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.queries.get(
          currentApp(res).appCode,
          intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
        ),
      )
    }),
  )

  router.get(
    '/v1/installations/:id/token',
    asyncHandler(async (req, res) => {
      const end = metrics.tokenApiLatency.startTimer({ route: 'get' })
      try {
        res.setHeader('Cache-Control', 'no-store')
        res.json(
          await deps.vault.getToken(
            currentApp(res).appCode,
            intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
          ),
        )
      } finally {
        end()
      }
    }),
  )

  router.post(
    '/v1/installations/:id/token/refresh',
    asyncHandler(async (req, res) => {
      const end = metrics.tokenApiLatency.startTimer({ route: 'refresh' })
      try {
        const { staleAccessToken } = refreshSchema.parse(req.body)
        res.setHeader('Cache-Control', 'no-store')
        res.json(
          await deps.vault.refreshOnDemand(
            currentApp(res).appCode,
            intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
            staleAccessToken,
          ),
        )
      } finally {
        end()
      }
    }),
  )

  return router
}
