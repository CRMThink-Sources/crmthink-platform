import { Router } from 'express'
import z from 'zod'
import { asyncHandler, intParam } from '@/shared/http/errors'
import type { Db } from '@/shared/infra/prisma'
import type { WebhookDelivery } from '@/modules/events/webhook-delivery'
import {
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
  type WebhookEndpoints,
} from '@/modules/events/webhook-endpoints'
import { listWebhookDeliveries } from '../application/webhook-reads'

export type WebhookEndpointRoutesDeps = {
  db: Db
  endpoints: WebhookEndpoints
  delivery: WebhookDelivery
}

export const resendDeadSchema = z.strictObject({
  dryRun: z
    .boolean()
    .optional()
    .describe('`true` só conta as entregas mortas, sem reenviar'),
})

const SECRET_NOTICE =
  'Guarde o segredo agora: ele não será exibido de novo (só fica guardado cifrado). Use-o para verificar X-Platform-Signature.'

/**
 * Destinatários de eventos (URLs que recebem os eventos do outbox) para o backoffice:
 * cadastro, segredo, entregas e reenvio. Montadas atrás de `adminGate`: papel, motivo das
 * ações de alto impacto e auditoria ficam lá. O segredo aparece só na criação e na
 * rotação, nunca em cache.
 */
export function webhookEndpointRoutes(deps: WebhookEndpointRoutesDeps): Router {
  const router = Router()
  const endpointId = (value: string | undefined) =>
    intParam(value, 'WEBHOOK_ENDPOINT_NOT_FOUND')
  const deliveryId = (value: string | undefined) =>
    intParam(value, 'WEBHOOK_DELIVERY_NOT_FOUND')

  router.get(
    '/admin/webhook-endpoints',
    asyncHandler(async (_req, res) => {
      const endpoints = await deps.endpoints.list()
      const items = await Promise.all(
        endpoints.map(async endpoint => {
          const counts = await deps.delivery.counts(endpoint.id)
          return {
            ...endpoint,
            pendingDeliveries: counts.pending,
            deadDeliveries: counts.dead,
          }
        }),
      )
      res.json({ items })
    }),
  )

  router.post(
    '/admin/webhook-endpoints',
    asyncHandler(async (req, res) => {
      const { endpoint, secret } = await deps.endpoints.create(
        createWebhookEndpointSchema.parse(req.body),
      )
      res.locals.auditTargetId = String(endpoint.id)
      res.setHeader('Cache-Control', 'no-store')
      res.status(201).json({ endpoint, secret, notice: SECRET_NOTICE })
    }),
  )

  router.patch(
    '/admin/webhook-endpoints/:id',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.endpoints.update(
          endpointId(req.params.id),
          updateWebhookEndpointSchema.parse(req.body),
        ),
      )
    }),
  )

  router.post(
    '/admin/webhook-endpoints/:id/rotate-secret',
    asyncHandler(async (req, res) => {
      const rotated = await deps.endpoints.rotateSecret(
        endpointId(req.params.id),
      )
      res.setHeader('Cache-Control', 'no-store')
      res.json({ ...rotated, notice: SECRET_NOTICE })
    }),
  )

  router.get(
    '/admin/webhook-endpoints/:id/deliveries',
    asyncHandler(async (req, res) => {
      const id = endpointId(req.params.id)
      await deps.endpoints.get(id)
      res.json(await listWebhookDeliveries(deps.db, id, req.query))
    }),
  )

  router.post(
    '/admin/webhook-endpoints/:id/resend-dead',
    asyncHandler(async (req, res) => {
      const body = resendDeadSchema.parse(req.body ?? {})
      res.json(await deps.delivery.resendDead(endpointId(req.params.id), body))
    }),
  )

  router.post(
    '/admin/webhook-deliveries/:id/resend',
    asyncHandler(async (req, res) => {
      const id = deliveryId(req.params.id)
      await deps.delivery.resend(id)
      res.json({ id, status: 'pending' })
    }),
  )

  return router
}
