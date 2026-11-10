import type { PlatformEnvironment } from '@/config/env'
import type { SpaConfig } from '@/config/spa-config'
import type { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'
import type { Db } from '@/shared/infra/prisma'
import type { PlanInterval, Product } from '../domain/entities'
import type { CatalogRepository } from '../infra/spa/catalog-repository'
import { InvalidSpaItemError, type SpaMappers } from '../infra/spa/spa-mappers'
import type { SubscriptionRepository } from '../infra/spa/subscription-repository'

export type CatalogPlanView = {
  id: number
  productId: number
  name: string
  /** Centavos. */
  amount: number
  interval: PlanInterval | null
  isTrial: boolean
  active: boolean
  priceHomolog: string | null
  priceProduction: string | null
  valid: boolean
  problems: string[]
}

export type CatalogProductView = {
  id: number
  name: string
  billingModel: string
  kind: 'subscription' | 'one_time' | null
  active: boolean
  valid: boolean
  problems: string[]
  apps: string[]
  plans: CatalogPlanView[]
}

export type CatalogView = {
  writable: boolean
  products: CatalogProductView[]
  /** Planos cujo produto não existe no SPA 1134: sempre `valid:false`. */
  orphanPlans: CatalogPlanView[]
}
export type ProductUsage = { apps: string[]; plans: number }
export type PlanUsage = {
  subscriptions: { total: number; active: number }
  trialOfApps: string[]
}

export type CatalogAdminDeps = {
  crm: BitrixRestClient
  config: SpaConfig
  mappers: SpaMappers
  catalog: CatalogRepository
  subscriptions: SubscriptionRepository
  db: Db
  environment: PlatformEnvironment
}

type Raw = Record<string, unknown>

const isBlank = (value: unknown) =>
  value === undefined || value === null || value === ''

const isYes = (value: unknown) =>
  value === true || value === 'Y' || value === '1' || value === 1

/**
 * Catálogo para o backoffice: leituras frescas do portal (sem cache), com itens
 * inativos e inválidos incluídos e sinalizados. Só o ambiente de produção grava.
 */
export class CatalogAdmin {
  constructor(private readonly deps: CatalogAdminDeps) {}

  async list(): Promise<CatalogView> {
    const { crm, config } = this.deps
    const [products, plans, appsByProduct] = await Promise.all([
      crm.listItems(config.entityTypes.product, {}),
      crm.listItems(config.entityTypes.plan, {}),
      this.appsByProduct(),
    ])
    const views = products.map(raw => {
      const id = Number(raw.id)
      const { view, product } = this.productView(raw)
      const own = plans.filter(p => Number(p[config.plan.product]) === id)
      return {
        ...view,
        apps: appsByProduct.get(id) ?? [],
        plans: own.map(p => this.planView(p, product)),
      }
    })
    const known = new Set(products.map(raw => Number(raw.id)))
    const orphanPlans = plans
      .filter(p => !known.has(Number(p[config.plan.product])))
      .map(p => {
        const view = this.planView(p, null)
        return {
          ...view,
          problems: [`Produto inexistente (#${view.productId})`],
        }
      })
    return {
      writable: this.deps.environment === 'production',
      products: views,
      orphanPlans,
    }
  }

  async productUsage(id: number): Promise<ProductUsage> {
    const { crm, config } = this.deps
    const [apps, plans] = await Promise.all([
      this.deps.db.appProduct.findMany({ where: { productSpaId: id } }),
      crm.listItems(config.entityTypes.plan, { [config.plan.product]: id }),
    ])
    return { apps: apps.map(a => a.appCode).sort(), plans: plans.length }
  }

  async planUsage(id: number): Promise<PlanUsage> {
    const [subscriptions, apps] = await Promise.all([
      this.deps.subscriptions.countByPlan(id),
      this.deps.db.app.findMany({ where: { trialPlanId: id } }),
    ])
    return { subscriptions, trialOfApps: apps.map(a => a.appCode).sort() }
  }

  private async appsByProduct(): Promise<Map<number, string[]>> {
    const rows = await this.deps.db.appProduct.findMany({})
    const map = new Map<number, string[]>()
    for (const row of rows) {
      const list = map.get(row.productSpaId) ?? []
      list.push(row.appCode)
      map.set(row.productSpaId, list)
    }
    for (const list of map.values()) list.sort()
    return map
  }

  private productView(raw: Raw): {
    view: Omit<CatalogProductView, 'apps' | 'plans'>
    product: Product | null
  } {
    const f = this.deps.config.product
    const base = {
      id: Number(raw.id),
      name: typeof raw.title === 'string' ? raw.title : '',
      billingModel: isBlank(raw[f.billingModel])
        ? ''
        : String(raw[f.billingModel]),
      active: isYes(raw[f.active]),
    }
    try {
      const product = this.deps.mappers.product(raw)
      return {
        product,
        view: {
          ...base,
          name: product.name,
          billingModel: product.billingModel,
          kind: product.kind,
          active: product.active,
          valid: true,
          problems: [],
        },
      }
    } catch (error) {
      if (!(error instanceof InvalidSpaItemError)) throw error
      const problems = isBlank(raw[f.billingModel])
        ? ['Produto sem modelo de cobrança']
        : error.issues.map(i => i.message)
      return {
        product: null,
        view: { ...base, kind: null, valid: false, problems },
      }
    }
  }

  private planView(raw: Raw, product: Product | null): CatalogPlanView {
    const f = this.deps.config.plan
    const priceHomolog = isBlank(raw[f.gatewayIdHomolog])
      ? null
      : String(raw[f.gatewayIdHomolog])
    const priceProduction = isBlank(raw[f.gatewayIdProduction])
      ? null
      : String(raw[f.gatewayIdProduction])
    const amount = Number(raw[f.value])
    const base = {
      id: Number(raw.id),
      productId: Number(raw[f.product]),
      name: typeof raw.title === 'string' ? raw.title : '',
      amount: Number.isFinite(amount) ? amount : 0,
      interval: (f.intervalEnum[String(raw[f.interval])] ??
        null) as PlanInterval | null,
      isTrial: !priceHomolog && !priceProduction,
      active: isYes(raw[f.active]),
      priceHomolog,
      priceProduction,
    }
    if (!product)
      return {
        ...base,
        valid: false,
        problems: ['Produto do plano ausente ou inválido'],
      }
    try {
      const plan = this.deps.mappers.plan(raw, product)
      return {
        ...base,
        name: plan.name,
        amount: plan.amount,
        interval: plan.interval,
        isTrial: plan.isTrial,
        active: plan.active,
        valid: true,
        problems: [],
      }
    } catch (error) {
      if (!(error instanceof InvalidSpaItemError)) throw error
      const problems = error.issues.map(issue =>
        issue.path.includes(f.value)
          ? 'Valor ausente ou inválido'
          : issue.message,
      )
      return { ...base, valid: false, problems }
    }
  }
}
