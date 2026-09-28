import express, { Router } from 'express'
import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import { asyncHandler, intParam } from '@/shared/http/errors'
import type { EventDelivery } from '@/modules/events/event-delivery'
import type { SigningKeys } from '@/modules/installations/application/signing-keys'
import type { TrialService } from '@/modules/billing/application/trial-service'
import type { Sweeps } from '@/modules/billing/application/sweeps'
import {
  createAppSchema,
  updateAppSchema,
  type AppRegistry,
} from '../app-registry'
import { adminAuth } from './auth'

export type AdminRoutesDeps = {
  db: Db
  adminTokens: string[]
  registry: AppRegistry
  delivery: EventDelivery
  signingKeys: SigningKeys
  trials: TrialService
  sweeps: Sweeps
}

export const resendSchema = z.union([
  z.object({ eventId: z.string().uuid() }),
  z.object({
    appCode: z.string().min(1),
    from: z.coerce.date(),
    to: z.coerce.date(),
    onlyDead: z.boolean().optional(),
    type: z.string().optional(),
  }),
])

export const rotateSigningKeySchema = z.object({
  leadMinutes: z.number().int().min(0).max(1440).default(10),
})

/**
 * Rotas de operador, com credencial própria (`ADMIN_API_TOKENS`), nunca a chave de um
 * app. Segredos gerados aparecem **só** na resposta da criação/rotação.
 */
export function adminRoutes(deps: AdminRoutesDeps): Router {
  const router = Router()
  router.use(
    '/admin',
    adminAuth(deps.adminTokens),
    express.json({ limit: '64kb' }),
  )
  // Rota administrativa do contrato: trial manual por instalação.
  router.use(
    '/v1/installations/:id/trial',
    adminAuth(deps.adminTokens),
    express.json({ limit: '4kb' }),
  )

  router.get(
    '/admin/apps',
    asyncHandler(async (_req, res) => {
      res.json({ items: await deps.registry.list() })
    }),
  )

  router.post(
    '/admin/apps',
    asyncHandler(async (req, res) => {
      const { app, credentials } = await deps.registry.create(
        createAppSchema.parse(req.body),
      )
      res.status(201).json({
        app,
        credentials,
        notice:
          'Guarde apiKey e webhookSecret agora: eles não serão exibidos de novo.',
      })
    }),
  )

  router.get(
    '/admin/apps/:appCode',
    asyncHandler(async (req, res) => {
      res.json(await deps.registry.getOrThrow(req.params.appCode ?? ''))
    }),
  )

  router.patch(
    '/admin/apps/:appCode',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.registry.update(
          req.params.appCode ?? '',
          updateAppSchema.parse(req.body),
        ),
      )
    }),
  )

  router.post(
    '/admin/apps/:appCode/rotate-api-key',
    asyncHandler(async (req, res) => {
      res.json(await deps.registry.rotateApiKey(req.params.appCode ?? ''))
    }),
  )

  router.post(
    '/admin/apps/:appCode/rotate-webhook-secret',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.registry.rotateWebhookSecret(req.params.appCode ?? ''),
      )
    }),
  )

  router.post(
    '/v1/installations/:id/trial',
    asyncHandler(async (req, res) => {
      const subscription = await deps.trials.start(
        intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
      )
      res.status(201).json({
        subscriptionId: subscription.id,
        trialEndsAt: subscription.periodEnd.toISOString(),
      })
    }),
  )

  router.get(
    '/admin/installations/:id/attempts',
    asyncHandler(async (req, res) => {
      const items = await deps.db.installAttempt.findMany({
        where: { installationId: intParam(req.params.id) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      res.json({ items })
    }),
  )

  router.get(
    '/admin/events',
    asyncHandler(async (req, res) => {
      const status =
        typeof req.query.status === 'string' ? req.query.status : undefined
      const appCode =
        typeof req.query.appCode === 'string' ? req.query.appCode : undefined
      const items = await deps.db.outboxEvent.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(appCode ? { appCode } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { deliveries: { orderBy: { attempt: 'desc' }, take: 3 } },
      })
      res.json({ items })
    }),
  )

  // Eventos Stripe recebidos (sem o payload): status, app roteado, tentativas e erro.
  router.get(
    '/admin/stripe-events',
    asyncHandler(async (req, res) => {
      const status =
        typeof req.query.status === 'string' ? req.query.status : undefined
      const items = await deps.db.stripeEvent.findMany({
        where: status ? { status } : {},
        orderBy: { receivedAt: 'desc' },
        take: 100,
        select: {
          eventId: true,
          type: true,
          appCode: true,
          status: true,
          attempts: true,
          error: true,
          receivedAt: true,
          processedAt: true,
        },
      })
      res.json({ items })
    }),
  )

  router.post(
    '/admin/events/resend',
    asyncHandler(async (req, res) => {
      res.json({
        requeued: await deps.delivery.resend(resendSchema.parse(req.body)),
      })
    }),
  )

  router.post(
    '/admin/signing-keys/rotate',
    asyncHandler(async (req, res) => {
      const lead = rotateSigningKeySchema.parse(req.body ?? {})
      res
        .status(201)
        .json(await deps.signingKeys.rotate(lead.leadMinutes * 60_000))
    }),
  )

  router.post(
    '/admin/sweeps/:kind',
    asyncHandler(async (req, res) => {
      const kind = req.params.kind
      if (kind === 'stripe') res.json(await deps.sweeps.stripeSweep())
      else if (kind === 'spa') res.json(await deps.sweeps.spaSweep())
      else res.status(404).json({ error: { code: 'NOT_FOUND' } })
    }),
  )

  return router
}
