import type { PlatformEnvironment } from '@/config/env'

/**
 * Chaves do cache do catálogo, num lugar só (como `infra/cache/keys.ts` do hub-core).
 *
 * Plano carrega price id, que difere por ambiente do Stripe, e dois ambientes podem
 * dividir o mesmo Redis: por isso o ambiente entra na chave de plano. A versão sobe
 * com qualquer mudança de shape, para entradas de um deploy anterior serem ignoradas.
 */
export const PRODUCT_CACHE_VERSION = 'v1'
export const PLAN_CACHE_VERSION = 'v1'
export const CATALOG_TTL_SECONDS = 300

export const cacheKeys = {
  product: (id: number) => `billing:product:${PRODUCT_CACHE_VERSION}:${id}`,
  productPrefix: () => `billing:product:`,
  plan: (env: PlatformEnvironment, id: number) =>
    `billing:plan:${PLAN_CACHE_VERSION}:${env}:${id}`,
  plansOfProduct: (env: PlatformEnvironment, productId: number) =>
    `billing:plans-of-product:${PLAN_CACHE_VERSION}:${env}:${productId}`,
  planPrefix: () => `billing:plan:`,
  plansOfProductPrefix: () => `billing:plans-of-product:`,
}
