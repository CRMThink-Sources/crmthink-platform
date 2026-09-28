import { badRequest, notFound, unprocessable } from '@/shared/http/errors'
import { raiseAlert } from '@/shared/observability/alert'
import type { RegisteredApp } from '@/modules/registry/domain/app'
import type { Plan } from '../domain/entities'
import type { CheckoutIntent } from '../ports/payment-gateway'
import type { CatalogRepository } from '../infra/spa/catalog-repository'

export type PlanResponse = {
  id: number
  productId: number
  productName: string
  name: string
  amount: number
  interval: Plan['interval']
  type: Plan['type']
  trial: boolean
}

/**
 * Catálogo por app (`GET /v1/plans`): planos ativos dos produtos vinculados ao app.
 *
 * Plano pago sem price no ambiente atual não é oferecido (alerta de configuração): o
 * price do outro ambiente nunca serve de fallback — seria cobrar na conta errada.
 */
export class PlanCatalog {
  constructor(private readonly catalog: CatalogRepository) {}

  async listForApp(app: RegisteredApp): Promise<PlanResponse[]> {
    const result: PlanResponse[] = []
    for (const productId of app.productSpaIds) {
      const product = await this.catalog.getProduct(productId)
      if (!product?.active) continue
      for (const plan of await this.catalog.plansOfProduct(productId)) {
        if (!plan.active) continue
        if (!plan.isTrial && !plan.gatewayPriceId) {
          raiseAlert(
            'plan.misconfigured',
            { planId: plan.id, appCode: app.appCode },
            'plano sem preço Stripe no ambiente atual — não será oferecido',
          )
          continue
        }
        result.push({
          id: plan.id,
          productId: product.id,
          productName: product.name,
          name: plan.name,
          amount: plan.amount,
          interval: plan.interval,
          type: plan.type,
          trial: plan.isTrial,
        })
      }
    }
    return result
  }

  /** Plano do app, ativo, com preço, e do tipo que o fluxo aceita. */
  async planForCheckout(
    app: RegisteredApp,
    planId: number,
    intent: CheckoutIntent,
  ): Promise<Plan & { gatewayPriceId: string }> {
    const plan = await this.catalog.getPlan(planId)
    if (!plan || !app.productSpaIds.includes(plan.productId))
      throw notFound('PLAN_NOT_FOUND')
    const product = await this.catalog.getProduct(plan.productId)
    if (!plan.active || !product?.active) throw unprocessable('PLAN_INACTIVE')
    const expected = intent === 'subscribe' ? 'subscription' : 'one_time'
    if (plan.type !== expected) {
      throw badRequest(
        'PLAN_TYPE_MISMATCH',
        `Plano ${plan.type} não pode ser usado com intent=${intent}`,
      )
    }
    if (!plan.gatewayPriceId) {
      raiseAlert(
        'plan.misconfigured',
        { planId, appCode: app.appCode },
        'plano sem preço no ambiente atual',
      )
      throw unprocessable(
        'PLAN_NOT_PURCHASABLE',
        'Plano sem preço configurado neste ambiente',
      )
    }
    return plan as Plan & { gatewayPriceId: string }
  }

  /** Plano do app cujo price (no ambiente atual) é este. */
  async planByPrice(app: RegisteredApp, priceId: string): Promise<Plan | null> {
    for (const productId of app.productSpaIds) {
      const plan = (await this.catalog.plansOfProduct(productId)).find(
        p => p.gatewayPriceId === priceId,
      )
      if (plan) return plan
    }
    return null
  }
}
