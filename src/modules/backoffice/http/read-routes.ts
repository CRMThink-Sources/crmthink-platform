import { Router } from 'express'
import type { Db } from '@/shared/infra/prisma'
import { asyncHandler, intParam } from '@/shared/http/errors'
import { listAudit } from '../application/audit-queries'
import {
  getStripeEvent,
  listOutboxEvents,
  listStripeEvents,
} from '../application/event-reads'
import {
  listInstallations,
  type InstallationReads,
} from '../application/installation-reads'
import type { OverviewQuery } from '../application/overview'

export type ReadRoutesDeps = {
  db: Db
  installations: InstallationReads
  overview: OverviewQuery
}

/** Leituras do backoffice. Montadas atrás de `adminGate` (papéis em `policy.ts`). */
export function backofficeReadRoutes(deps: ReadRoutesDeps): Router {
  const router = Router()

  router.get(
    '/admin/overview',
    asyncHandler(async (_req, res) => {
      res.json(await deps.overview.get())
    }),
  )

  router.get(
    '/admin/installations',
    asyncHandler(async (req, res) => {
      res.json(await listInstallations(deps.db, req.query))
    }),
  )

  router.get(
    '/admin/installations/:id',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.installations.detail(
          intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
        ),
      )
    }),
  )

  router.get(
    '/admin/installations/:id/timeline',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.installations.timeline(
          intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
          req.query,
        ),
      )
    }),
  )

  router.get(
    '/admin/events',
    asyncHandler(async (req, res) => {
      res.json(await listOutboxEvents(deps.db, req.query))
    }),
  )

  // Eventos Stripe recebidos (sem o payload): status, app roteado, tentativas e erro.
  router.get(
    '/admin/stripe-events',
    asyncHandler(async (req, res) => {
      res.json(await listStripeEvents(deps.db, req.query))
    }),
  )

  router.get(
    '/admin/stripe-events/:eventId',
    asyncHandler(async (req, res) => {
      res.json(await getStripeEvent(deps.db, req.params.eventId ?? ''))
    }),
  )

  router.get(
    '/admin/audit',
    asyncHandler(async (req, res) => {
      res.json(await listAudit(deps.db, req.query))
    }),
  )

  return router
}
