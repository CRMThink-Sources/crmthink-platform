import { Router } from 'express'
import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import { asyncHandler, intParam } from '@/shared/http/errors'
import type { EventDelivery } from '@/modules/events/event-delivery'
import type { TokenVault } from '@/modules/installations/application/token-vault'
import { tokenHealth } from '@/modules/backoffice/application/installation-reads'
import type { SigningKeys } from '@/modules/installations/application/signing-keys'
import {
  trialRequestSchema,
  type TrialService,
} from '@/modules/billing/application/trial-service'
import type { Sweeps } from '@/modules/billing/application/sweeps'
import {
  createAppSchema,
  updateAppSchema,
  type AppRegistry,
} from '../app-registry'

export type AdminRoutesDeps = {
  db: Db
  registry: AppRegistry
  delivery: EventDelivery
  signingKeys: SigningKeys
  trials: TrialService
  sweeps: Sweeps
  vault: TokenVault
}

export const resendSchema = z.union([
  z.object({ eventId: z.string().uuid(), dryRun: z.boolean().optional() }),
  z
    .object({
      appCode: z.string().min(1).optional(),
      installationId: z.number().int().positive().optional(),
      from: z.coerce.date(),
      to: z.coerce.date(),
      onlyDead: z.boolean().optional(),
      type: z.string().optional(),
      dryRun: z.boolean().optional(),
    })
    .refine(body => body.appCode || body.installationId, {
      message: 'Informe appCode e/ou installationId',
      path: ['appCode'],
    }),
])

export const rotateSigningKeySchema = z.object({
  leadMinutes: z.number().int().min(0).max(1440).default(10),
})

/**
 * Rotas de operador. Montadas atrás de `adminGate` (`backoffice/http/gate.ts`): sessão
 * de operador ou token de `ADMIN_API_TOKENS`, nunca a chave de um app. Segredos
 * gerados aparecem **só** na resposta da criação/rotação.
 */
export function adminRoutes(deps: AdminRoutesDeps): Router {
  const router = Router()

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
      res.locals.auditTargetId = app.appCode
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

  // Consulta do segredo de webhook já cadastrado (o operador perdeu o valor). É POST de
  // propósito: entra na auditoria como qualquer mutação e exige o motivo (alto impacto),
  // e a resposta nunca fica em cache. A chave de API não tem equivalente: só existe o hash.
  router.post(
    '/admin/apps/:appCode/reveal-webhook-secret',
    asyncHandler(async (req, res) => {
      const webhookSecret = await deps.registry.revealWebhookSecret(
        req.params.appCode ?? '',
      )
      res.setHeader('Cache-Control', 'no-store')
      res.json({ webhookSecret })
    }),
  )

  // Trial manual por instalação (casos excepcionais); o contato é opcional.
  router.post(
    '/admin/installations/:id/trial',
    asyncHandler(async (req, res) => {
      const body: unknown = req.body
      const hasBody =
        typeof body === 'object' &&
        body !== null &&
        Object.keys(body).length > 0
      const { subscription } = await deps.trials.request(
        { kind: 'operator' },
        intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
        hasBody ? trialRequestSchema.parse(body) : undefined,
      )
      res.status(201).json({
        subscriptionId: subscription.id,
        trialEndsAt: subscription.periodEnd.toISOString(),
      })
    }),
  )

  // Renovação forçada do token do Bitrix. Nunca devolve o token, só expiração e saúde.
  router.post(
    '/admin/installations/:id/token/refresh',
    asyncHandler(async (req, res) => {
      const credential = await deps.vault.forceRefresh(
        intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
      )
      res.json({
        expiresAt: credential.expiresAt.toISOString(),
        health: tokenHealth(credential),
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

  router.post(
    '/admin/events/resend',
    asyncHandler(async (req, res) => {
      const selector = resendSchema.parse(req.body)
      const result = await deps.delivery.resend(selector)
      // Com `dryRun` só a prévia (`{ matched, sample }`); sem ele, a contagem.
      res.json(typeof result === 'number' ? { requeued: result } : result)
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
