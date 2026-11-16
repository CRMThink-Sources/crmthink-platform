import { Router } from 'express'
import { asyncHandler, intParam } from '@/shared/http/errors'
import { currentActor } from '@/modules/backoffice/http/actor'
import {
  createManualSubscriptionSchema,
  type ManualSubscriptionService,
} from '../application/manual-subscription-service'

export type AdminSubscriptionRoutesDeps = {
  manualSubscriptions: ManualSubscriptionService
}

/**
 * Criação de assinatura manual e bonificação pelo operador. Montada atrás de
 * `adminGate`: papel, motivo obrigatório (`X-Admin-Reason`) e auditoria ficam lá.
 */
export function adminSubscriptionRoutes(
  deps: AdminSubscriptionRoutesDeps,
): Router {
  const router = Router()

  router.post(
    '/admin/installations/:id/subscriptions',
    asyncHandler(async (req, res) => {
      const installationId = intParam(req.params.id, 'INSTALLATION_NOT_FOUND')
      const body = createManualSubscriptionSchema.parse(req.body)
      const subscription = await deps.manualSubscriptions.create(
        installationId,
        body,
        {
          actor: currentActor(res).id,
          // O gate exige o motivo (ação de alto impacto) e o guarda aqui.
          reason: String(res.locals.auditReason ?? ''),
        },
      )
      res.status(201).json({
        subscriptionId: subscription.id,
        status: subscription.status,
        modality: subscription.modality,
        planId: subscription.planId,
        periodStart: subscription.periodStart.toISOString(),
        periodEnd: subscription.periodEnd.toISOString(),
      })
    }),
  )

  return router
}
