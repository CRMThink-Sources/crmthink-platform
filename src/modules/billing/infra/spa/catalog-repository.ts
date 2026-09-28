import type { PlatformEnvironment } from '@/config/env'
import type { SpaConfig } from '@/config/spa-config'
import type { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'
import type { JsonCache } from '@/shared/infra/cache'
import { raiseAlert } from '@/shared/observability/alert'
import type { Plan, Product } from '../../domain/entities'
import { CATALOG_TTL_SECONDS, cacheKeys } from './cache-keys'
import { InvalidSpaItemError, type SpaMappers } from './spa-mappers'

/**
 * Produtos (1134) e planos (1138), somente leitura, com cache invalidado pelos
 * eventos dos SPAs (`invalidateProduct`/`invalidatePlan`) e TTL como rede.
 */
export class CatalogRepository {
  constructor(
    private readonly crm: BitrixRestClient,
    private readonly config: SpaConfig,
    private readonly mappers: SpaMappers,
    private readonly cache: JsonCache,
    private readonly stripeEnvironment: PlatformEnvironment,
  ) {}

  async getProduct(id: number): Promise<Product | null> {
    const key = cacheKeys.product(id)
    const cached = await this.cache.get<Product>(key)
    if (cached) return cached
    const raw = await this.crm.getItem(this.config.entityTypes.product, id)
    if (!raw) return null
    const product = this.mappers.product(raw)
    await this.cache.set(key, product, CATALOG_TTL_SECONDS)
    return product
  }

  /** Plano hidratado com o tipo do produto. `null` se não existe ou é inválido (com alerta). */
  async getPlan(id: number): Promise<Plan | null> {
    const key = cacheKeys.plan(this.stripeEnvironment, id)
    const cached = await this.cache.get<Plan>(key)
    if (cached) return cached
    const raw = await this.crm.getItem(this.config.entityTypes.plan, id)
    if (!raw) return null
    const plan = await this.mapPlan(raw)
    if (plan) await this.cache.set(key, plan, CATALOG_TTL_SECONDS)
    return plan
  }

  private async mapPlan(raw: Record<string, unknown>): Promise<Plan | null> {
    const productId = Number(raw[this.config.plan.product])
    const product = Number.isInteger(productId)
      ? await this.getProduct(productId)
      : null
    if (!product) {
      raiseAlert(
        'plan.misconfigured',
        { planId: raw.id },
        'plano sem produto válido no SPA 1134',
      )
      return null
    }
    try {
      return this.mappers.plan(raw, product)
    } catch (error) {
      if (error instanceof InvalidSpaItemError) {
        raiseAlert(
          'plan.misconfigured',
          { planId: raw.id, issues: error.issues.map(i => i.message) },
          'plano inválido no SPA 1138 — não será oferecido',
        )
        return null
      }
      throw error
    }
  }

  /** Planos de um produto (ativos e inativos), pulando os mal cadastrados. */
  async plansOfProduct(productId: number): Promise<Plan[]> {
    const key = cacheKeys.plansOfProduct(this.stripeEnvironment, productId)
    const cached = await this.cache.get<Plan[]>(key)
    if (cached) return cached
    const raws = await this.crm.listItems(this.config.entityTypes.plan, {
      [this.config.plan.product]: productId,
    })
    const plans: Plan[] = []
    for (const raw of raws) {
      const plan = await this.mapPlan(raw)
      if (plan) plans.push(plan)
    }
    await this.cache.set(key, plans, CATALOG_TTL_SECONDS)
    return plans
  }

  async invalidateProduct(productId: number): Promise<void> {
    await this.cache.del(cacheKeys.product(productId))
    // Plano embute o tipo do produto: descarta todos.
    await this.cache.delPrefix(cacheKeys.planPrefix())
    await this.cache.delPrefix(cacheKeys.plansOfProductPrefix())
  }

  async invalidatePlan(_planId: number): Promise<void> {
    await this.cache.delPrefix(cacheKeys.planPrefix())
    await this.cache.delPrefix(cacheKeys.plansOfProductPrefix())
  }
}
