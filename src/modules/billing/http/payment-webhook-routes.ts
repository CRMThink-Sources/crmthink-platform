import express, {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import { ZodError } from 'zod'
import {
  asyncHandler,
  badRequest,
  HttpError,
  unauthorized,
} from '@/shared/http/errors'
import { metrics } from '@/shared/observability/metrics'
import { bearer } from '@/modules/registry/http/auth'
import type { PaymentIntegrations } from '../application/payment-integrations'
import {
  paymentNoticeSchema,
  type PaymentNoticeService,
} from '../application/payment-notice-service'

export type PaymentWebhookRoutesDeps = {
  integrations: PaymentIntegrations
  notices: PaymentNoticeService
}

/** Avisos de pagamento são pequenos: o limite barra corpo gigante antes de qualquer trabalho. */
const BODY_LIMIT = '16kb'

/** `Authorization: Bearer <chave de integração>`; a chave de app ou de operador não vale aqui. */
function paymentAuth(integrations: PaymentIntegrations): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const key = bearer(req.headers.authorization)
    if (!key) throw unauthorized('Chave de integração ausente')
    res.locals.paymentIntegration = await integrations.authenticate(key)
    next()
  })
}

/**
 * JSON de até 16 KB. Corpo malformado ou grande demais vira erro de cliente (400/413):
 * como 500, o remetente repetiria o mesmo aviso para sempre.
 */
function jsonBody(req: Request, res: Response, next: NextFunction): void {
  express.json({ limit: BODY_LIMIT })(req, res, (error?: unknown) => {
    if (!error) return next()
    const type = (error as { type?: string }).type
    if (type === 'entity.parse.failed')
      return next(badRequest('INVALID_JSON', 'O corpo não é um JSON válido'))
    if (type === 'entity.too.large')
      return next(
        new HttpError(
          413,
          'PAYLOAD_TOO_LARGE',
          `O corpo passa de ${BODY_LIMIT}`,
        ),
      )
    next(error)
  })
}

/**
 * `POST /webhooks/payments`: aviso de pagamento de uma integração. Fica fora do
 * `adminGate` e do `appAuth`; a única credencial aceita é a chave de uma integração.
 */
export function paymentWebhookRoutes(deps: PaymentWebhookRoutesDeps): Router {
  const router = Router()

  router.post(
    '/webhooks/payments',
    paymentAuth(deps.integrations),
    jsonBody,
    asyncHandler(async (req, res) => {
      const integration = res.locals.paymentIntegration as Parameters<
        PaymentNoticeService['receive']
      >[0]
      try {
        const result = await deps.notices.receive(
          integration,
          paymentNoticeSchema.parse(req.body),
        )
        metrics.paymentNotices.inc({
          outcome: result.duplicate ? 'duplicate' : 'applied',
        })
        res.json({
          subscriptionId: result.subscriptionId,
          status: result.status,
          periodStart: result.periodStart.toISOString(),
          periodEnd: result.periodEnd.toISOString(),
          duplicate: result.duplicate,
        })
      } catch (error) {
        // Recusa do aviso (corpo ou regra) × falha nossa (Bitrix, banco).
        const rejected =
          error instanceof ZodError ||
          (error instanceof HttpError && error.status < 500)
        metrics.paymentNotices.inc({
          outcome: rejected ? 'rejected' : 'failed',
        })
        throw error
      }
    }),
  )

  return router
}
