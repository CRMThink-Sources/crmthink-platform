import { Router } from 'express'
import z from 'zod'
import { asyncHandler, intParam } from '@/shared/http/errors'
import type { PaymentIntegrations } from '../application/payment-integrations'

export type AdminPaymentIntegrationRoutesDeps = {
  integrations: PaymentIntegrations
}

const name = z.string().trim().min(1).max(200)

export const createPaymentIntegrationSchema = z.strictObject({ name })

export const updatePaymentIntegrationSchema = z
  .strictObject({
    name: name.optional(),
    active: z.boolean().optional(),
  })
  .refine(body => Object.keys(body).length > 0, {
    message: 'Informe name ou active',
  })

const KEY_NOTICE =
  'Guarde a chave agora: ela não será exibida de novo (só o hash fica guardado).'

/**
 * Integrações de pagamento (chaves de `POST /webhooks/payments`) para o backoffice.
 * Montadas atrás de `adminGate`: papel, motivo das ações de alto impacto e auditoria
 * ficam lá. A chave aparece só na criação e na rotação, nunca em cache.
 */
export function adminPaymentIntegrationRoutes(
  deps: AdminPaymentIntegrationRoutesDeps,
): Router {
  const router = Router()
  const integrationId = (value: string | undefined) =>
    intParam(value, 'PAYMENT_INTEGRATION_NOT_FOUND')

  router.get(
    '/admin/payment-integrations',
    asyncHandler(async (_req, res) => {
      res.json({ items: await deps.integrations.list() })
    }),
  )

  router.post(
    '/admin/payment-integrations',
    asyncHandler(async (req, res) => {
      const { integration, apiKey } = await deps.integrations.create(
        createPaymentIntegrationSchema.parse(req.body).name,
      )
      res.locals.auditTargetId = String(integration.id)
      res.setHeader('Cache-Control', 'no-store')
      res.status(201).json({ integration, apiKey, notice: KEY_NOTICE })
    }),
  )

  router.patch(
    '/admin/payment-integrations/:id',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.integrations.update(
          integrationId(req.params.id),
          updatePaymentIntegrationSchema.parse(req.body),
        ),
      )
    }),
  )

  router.post(
    '/admin/payment-integrations/:id/rotate-key',
    asyncHandler(async (req, res) => {
      const { integration, apiKey } = await deps.integrations.rotateKey(
        integrationId(req.params.id),
      )
      res.setHeader('Cache-Control', 'no-store')
      res.json({ integration, apiKey, notice: KEY_NOTICE })
    }),
  )

  return router
}
