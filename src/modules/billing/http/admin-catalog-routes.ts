import { Router } from 'express'
import z from 'zod'
import { HttpError, asyncHandler, intParam } from '@/shared/http/errors'
import type {
  CatalogAdmin,
  CatalogWriteFailure,
} from '../application/catalog-admin'

export type CatalogAdminRoutesDeps = { catalog: CatalogAdmin }

const name = z.string().trim().min(1).max(200)

/** Id de preço do Stripe; vazio vira `null` (sem preço naquele ambiente). */
const price = z
  .string()
  .trim()
  .regex(/^(price_[A-Za-z0-9]+)?$/, 'Use um id de preço do Stripe (price_...)')
  .nullable()
  .transform(value => value || null)

/**
 * Criação que o Bitrix aceitou e a releitura reprovou (502): a auditoria registra o
 * id do item criado, que só existe nos `details` do erro.
 */
async function auditCreated<T extends { id: number }>(
  res: { locals: Record<string, unknown> },
  create: () => Promise<T>,
): Promise<T> {
  try {
    const created = await create()
    res.locals.auditTargetId = String(created.id)
    return created
  } catch (error) {
    if (error instanceof HttpError && error.code === 'CATALOG_WRITE_FAILED') {
      const details = (error.details ?? {}) as Partial<CatalogWriteFailure>
      if (details.created && typeof details.id === 'number')
        res.locals.auditTargetId = String(details.id)
    }
    throw error
  }
}

export const productSchema = z.strictObject({
  name,
  billingModel: z.enum(['standard', 'per_unit', 'one_time']),
  active: z.boolean(),
})

export const productPatchSchema = productSchema.partial()

export const planSchema = z.strictObject({
  name,
  amount: z.number().int().min(0).describe('Centavos'),
  interval: z
    .enum(['monthly', 'quarterly', 'semiannual', 'yearly'])
    .nullable()
    .describe('`null` em produto de compra única'),
  trial: z
    .boolean()
    .describe(
      '`true` exige os dois ids de preço vazios: o trial é plano sem preço',
    ),
  priceHomolog: price,
  priceProduction: price,
  active: z.boolean(),
})

export const planPatchSchema = planSchema.partial()

/**
 * Catálogo de produtos e planos (SPAs 1134 e 1138) para o backoffice. Montado atrás de
 * `adminGate`: papel, motivo das ações de alto impacto e auditoria ficam lá.
 */
export function catalogAdminRoutes(deps: CatalogAdminRoutesDeps): Router {
  const router = Router()
  const productId = (value: string | undefined) =>
    intParam(value, 'PRODUCT_NOT_FOUND')
  const planId = (value: string | undefined) =>
    intParam(value, 'PLAN_NOT_FOUND')

  router.get(
    '/admin/catalog/products',
    asyncHandler(async (_req, res) => {
      res.json(await deps.catalog.list())
    }),
  )

  router.post(
    '/admin/catalog/products',
    asyncHandler(async (req, res) => {
      const body = productSchema.parse(req.body)
      const created = await auditCreated(res, () =>
        deps.catalog.createProduct(body),
      )
      res.status(201).json(created)
    }),
  )

  router.get(
    '/admin/catalog/products/:id/usage',
    asyncHandler(async (req, res) => {
      res.json(await deps.catalog.productUsage(productId(req.params.id)))
    }),
  )

  router.patch(
    '/admin/catalog/products/:id',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.catalog.updateProduct(
          productId(req.params.id),
          productPatchSchema.parse(req.body),
        ),
      )
    }),
  )

  router.delete(
    '/admin/catalog/products/:id',
    asyncHandler(async (req, res) => {
      await deps.catalog.deleteProduct(productId(req.params.id))
      res.status(204).end()
    }),
  )

  router.post(
    '/admin/catalog/products/:id/plans',
    asyncHandler(async (req, res) => {
      const id = productId(req.params.id)
      const body = planSchema.parse(req.body)
      const created = await auditCreated(res, () =>
        deps.catalog.createPlan(id, body),
      )
      res.status(201).json(created)
    }),
  )

  router.get(
    '/admin/catalog/plans/:id/usage',
    asyncHandler(async (req, res) => {
      res.json(await deps.catalog.planUsage(planId(req.params.id)))
    }),
  )

  router.patch(
    '/admin/catalog/plans/:id',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.catalog.updatePlan(
          planId(req.params.id),
          planPatchSchema.parse(req.body),
        ),
      )
    }),
  )

  router.delete(
    '/admin/catalog/plans/:id',
    asyncHandler(async (req, res) => {
      await deps.catalog.deletePlan(planId(req.params.id))
      res.status(204).end()
    }),
  )

  return router
}
