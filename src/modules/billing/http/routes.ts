import express, { Router } from 'express'
import { asyncHandler, intParam } from '@/shared/http/errors'
import { currentApp } from '@/modules/registry/http/auth'
import type { AppRegistry } from '@/modules/registry/app-registry'
import {
  checkoutRequestSchema,
  type CheckoutService,
} from '../application/checkout-service'
import {
  createItemSchema,
  updateItemSchema,
  type ItemsService,
} from '../application/items-service'
import type { PlanCatalog } from '../application/plan-catalog'
import type { SpaEventsIngest } from '../application/spa-events'
import type { StripeWebhookIngest } from '../application/stripe-webhooks'
import {
  changePlanSchema,
  portalRequestSchema,
  type SubscriptionQueries,
} from '../application/subscription-queries'

export type BillingRoutesDeps = {
  registry: AppRegistry
  plans: PlanCatalog
  checkout: CheckoutService
  subscriptions: SubscriptionQueries
  items: ItemsService
  stripeIngest: StripeWebhookIngest
  spaIngest: SpaEventsIngest
}

/** Webhook Stripe (corpo cru — a assinatura é HMAC sobre os bytes) e eventos dos SPAs. */
export function billingWebhookRoutes(deps: BillingRoutesDeps): Router {
  const router = Router()

  router.post(
    '/webhooks/stripe',
    express.raw({ type: '*/*', limit: '1mb' }),
    asyncHandler(async (req, res) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      const signature = req.headers['stripe-signature']
      const result = await deps.stripeIngest.receive(
        body,
        typeof signature === 'string' ? signature : undefined,
      )
      if (result.status === 400) {
        res
          .status(400)
          .json({ error: { code: 'INVALID_SIGNATURE', message: result.error } })
        return
      }
      res.json({ received: true, outcome: result.outcome })
    }),
  )

  router.post(
    '/bitrix/spa-events',
    express.urlencoded({ extended: true, limit: '64kb' }),
    express.json({ limit: '64kb' }),
    asyncHandler(async (req, res) => {
      const result = await deps.spaIngest.receive(req.body)
      res.status(result.status).json({ handled: result.handled ?? false })
    }),
  )

  return router
}

/** Rotas de cobrança dos apps. Montadas atrás de `appAuth` (ver `app.ts`). */
export function appBillingRoutes(deps: BillingRoutesDeps): Router {
  const router = Router()
  router.use(express.json({ limit: '64kb' }))

  router.get(
    '/v1/plans',
    asyncHandler(async (_req, res) => {
      res.json({ items: await deps.plans.listForApp(currentApp(res)) })
    }),
  )

  router.get(
    '/v1/installations/:id/subscription',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.subscriptions.current(
          currentApp(res),
          intParam(req.params.id, 'INSTALLATION_NOT_FOUND'),
        ),
      )
    }),
  )

  router.post(
    '/v1/checkout-sessions',
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await deps.checkout.create(
            currentApp(res),
            checkoutRequestSchema.parse(req.body),
          ),
        )
    }),
  )

  router.post(
    '/v1/billing-portal-sessions',
    asyncHandler(async (req, res) => {
      const body = portalRequestSchema.parse(req.body)
      res
        .status(201)
        .json(
          await deps.subscriptions.billingPortal(
            currentApp(res),
            body.installationId,
            body.returnUrl,
          ),
        )
    }),
  )

  router.post(
    '/v1/subscriptions/:id/change-plan',
    asyncHandler(async (req, res) => {
      const { planId } = changePlanSchema.parse(req.body)
      res.json(
        await deps.subscriptions.changePlan(
          currentApp(res),
          intParam(req.params.id, 'SUBSCRIPTION_NOT_FOUND'),
          planId,
        ),
      )
    }),
  )

  router.get(
    '/v1/subscriptions/:id/items',
    asyncHandler(async (req, res) => {
      res.json({
        items: await deps.items.list(
          currentApp(res),
          intParam(req.params.id, 'SUBSCRIPTION_NOT_FOUND'),
        ),
      })
    }),
  )

  router.post(
    '/v1/subscriptions/:id/items',
    asyncHandler(async (req, res) => {
      const result = await deps.items.create(
        currentApp(res),
        intParam(req.params.id, 'SUBSCRIPTION_NOT_FOUND'),
        createItemSchema.parse(req.body),
      )
      res.status(result.created ? 201 : 200).json(result.item)
    }),
  )

  router.patch(
    '/v1/subscriptions/:id/items/:itemId',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.items.update(
          currentApp(res),
          intParam(req.params.id, 'SUBSCRIPTION_NOT_FOUND'),
          intParam(req.params.itemId, 'ITEM_NOT_FOUND'),
          updateItemSchema.parse(req.body),
        ),
      )
    }),
  )

  router.delete(
    '/v1/subscriptions/:id/items/:itemId',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.items.remove(
          currentApp(res),
          intParam(req.params.id, 'SUBSCRIPTION_NOT_FOUND'),
          intParam(req.params.itemId, 'ITEM_NOT_FOUND'),
        ),
      )
    }),
  )

  return router
}
