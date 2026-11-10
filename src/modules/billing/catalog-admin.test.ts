import { describe, expect, it } from 'vitest'
import { SpaEnvironment } from '@/shared/spa/environment'
import { createHarness, seedGptMaker } from '@/test/harness'
import { SpaMappers } from './infra/spa/spa-mappers'
import { SubscriptionRepository } from './infra/spa/subscription-repository'

const production = () =>
  createHarness({ env: { PLATFORM_ENVIRONMENT: 'production' } })

describe('CatalogAdmin: leitura', () => {
  it('lista produtos e planos inativos, com apps e preços crus', async () => {
    const h = production()
    await seedGptMaker(h)
    const c = h.config
    h.crm.seed(c.entityTypes.plan, {
      id: 503,
      title: 'Legado',
      [c.plan.product]: 10,
      [c.plan.value]: 100,
      [c.plan.interval]: '13615',
      [c.plan.active]: 'N',
    })
    const view = await h.container.catalogAdmin.list()
    expect(view.writable).toBe(true)
    expect(view.products.map(p => p.id).sort()).toEqual([10, 11])
    const gpt = view.products.find(p => p.id === 10)!
    expect(gpt).toMatchObject({
      name: 'GPTMaker',
      kind: 'subscription',
      active: true,
      valid: true,
      apps: ['crmthink.gptmaker'],
    })
    const legacy = gpt.plans.find(p => p.id === 503)!
    expect(legacy).toMatchObject({
      active: false,
      valid: true,
      interval: 'yearly',
    })
    expect(gpt.plans.find(p => p.id === 500)!.isTrial).toBe(true)
    expect(gpt.plans.find(p => p.id === 501)).toMatchObject({
      priceHomolog: 'price_basic',
      priceProduction: 'price_basic_live',
      amount: 9900,
    })
    const pack = view.products.find(p => p.id === 11)!
    expect(pack.kind).toBe('one_time')
    expect(pack.plans[0]).toMatchObject({
      interval: null,
      priceHomolog: 'price_pack',
      priceProduction: null,
    })
  })

  it('writable é falso fora de produção', async () => {
    const h = createHarness()
    expect((await h.container.catalogAdmin.list()).writable).toBe(false)
  })

  it('item mal cadastrado aparece com valid:false e problemas em pt-BR', async () => {
    const h = production()
    await seedGptMaker(h)
    const c = h.config
    h.crm.seed(c.entityTypes.plan, {
      id: 504,
      title: 'Sem intervalo',
      [c.plan.product]: 10,
      [c.plan.value]: 100,
      [c.plan.active]: 'Y',
    })
    h.crm.seed(c.entityTypes.product, {
      id: 12,
      title: 'Sem modelo',
      [c.product.active]: 'Y',
    })
    const view = await h.container.catalogAdmin.list()
    const bad = view.products
      .find(p => p.id === 10)!
      .plans.find(p => p.id === 504)!
    expect(bad.valid).toBe(false)
    expect(bad.problems.join(' ')).toMatch(/intervalo/i)
    const noModel = view.products.find(p => p.id === 12)!
    expect(noModel.valid).toBe(false)
    expect(noModel.kind).toBeNull()
    expect(noModel.problems.join(' ')).toMatch(/modelo de cobrança/i)
  })

  it('productUsage e planUsage', async () => {
    const h = production()
    await seedGptMaker(h)
    const c = h.config
    const sub = (id: number, plan: number, status: string) =>
      h.crm.seed(c.entityTypes.subscription, {
        id,
        title: 's',
        [c.subscription.plan]: plan,
        parentId1060: 1,
        [c.subscription.status]: status,
        [c.subscription.periodStart]: '2026-08-01T00:00:00+03:00',
        [c.subscription.periodEnd]: '2026-08-31T00:00:00+03:00',
        [c.subscription.environment]: 'production',
      })
    sub(1, 500, '13619')
    sub(2, 500, '13623')
    sub(3, 500, '14353')
    expect(await h.container.catalogAdmin.productUsage(10)).toEqual({
      apps: ['crmthink.gptmaker'],
      plans: 3,
    })
    expect(await h.container.catalogAdmin.planUsage(500)).toEqual({
      subscriptions: { total: 3, active: 1 },
      trialOfApps: ['crmthink.gptmaker'],
    })
    expect(await h.container.catalogAdmin.planUsage(501)).toEqual({
      subscriptions: { total: 0, active: 0 },
      trialOfApps: [],
    })
  })

  it('expõe planos órfãos (produto inexistente) como inválidos', async () => {
    const h = production()
    await seedGptMaker(h)
    const c = h.config
    h.crm.seed(c.entityTypes.plan, {
      id: 505,
      title: 'Órfão',
      [c.plan.product]: 777,
      [c.plan.value]: 100,
      [c.plan.interval]: '13609',
      [c.plan.active]: 'Y',
    })
    const view = await h.container.catalogAdmin.list()
    expect(view.orphanPlans).toHaveLength(1)
    expect(view.orphanPlans[0]).toMatchObject({
      id: 505,
      productId: 777,
      valid: false,
      problems: ['Produto inexistente (#777)'],
    })
    expect(view.products.flatMap(p => p.plans).map(p => p.id)).not.toContain(
      505,
    )
  })

  it('countByPlan conta assinaturas de todos os ambientes', async () => {
    const h = production()
    await seedGptMaker(h)
    const c = h.config
    h.crm.seed(c.entityTypes.subscription, {
      id: 20,
      title: 's',
      [c.subscription.plan]: 501,
      parentId1060: 1,
      [c.subscription.status]: '13617',
      [c.subscription.periodStart]: '2026-08-01T00:00:00+03:00',
      [c.subscription.periodEnd]: '2026-08-31T00:00:00+03:00',
      [c.subscription.environment]: 'homolog',
    })
    expect(await h.container.catalogAdmin.planUsage(501)).toMatchObject({
      subscriptions: { total: 1, active: 1 },
    })
  })

  it('countByPlan conta bruto e ativas', async () => {
    const h = production()
    await seedGptMaker(h)
    h.crm.seed(h.config.entityTypes.subscription, {
      id: 9,
      [h.config.subscription.plan]: 501,
      [h.config.subscription.status]: 'lixo',
    })
    const environment = new SpaEnvironment(
      'production',
      h.config.environmentValues,
    )
    const repo = new SubscriptionRepository(
      h.crm.asClient(),
      h.config,
      new SpaMappers(h.config, environment, 'production'),
      environment,
    )
    expect(await repo.countByPlan(501)).toEqual({
      total: 1,
      active: 0,
    })
  })
})
