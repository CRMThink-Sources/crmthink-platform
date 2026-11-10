import { describe, expect, it, vi } from 'vitest'
import { createHarness, seedGptMaker, type Harness } from '@/test/harness'

const production = () =>
  createHarness({ env: { PLATFORM_ENVIRONMENT: 'production' } })

async function setup() {
  const h = production()
  await seedGptMaker(h)
  return { h, admin: h.container.catalogAdmin, c: h.config }
}

/** Assinatura de qualquer ambiente (o uso conta todos). */
function subscribe(h: Harness, plan: number, environment = 'production') {
  const c = h.config
  return h.crm.seed(c.entityTypes.subscription, {
    title: 's',
    [c.subscription.plan]: plan,
    parentId1060: 1,
    [c.subscription.status]: '13619',
    [c.subscription.periodStart]: '2026-08-01T00:00:00+03:00',
    [c.subscription.periodEnd]: '2026-08-31T00:00:00+03:00',
    [c.subscription.environment]: environment,
  })
}

const rejectsWith = (promise: Promise<unknown>, status: number, code: string) =>
  expect(promise).rejects.toMatchObject({ status, code })

const lastWrite = (h: Harness) => h.crm.calls[h.crm.calls.length - 1]!

const paid = {
  name: 'Plus',
  amount: 14900,
  interval: 'quarterly' as const,
  priceHomolog: 'price_plus',
  priceProduction: 'price_plus_live',
  active: true,
  trial: false,
}

describe('CatalogAdmin: escrita só na produção', () => {
  it('fora da produção toda escrita é CATALOG_READ_ONLY e nada vai ao Bitrix', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    h.crm.calls = []
    const get = vi.spyOn(h.crm, 'getItem')
    const list = vi.spyOn(h.crm, 'listItems')
    const admin = h.container.catalogAdmin
    const attempts = [
      admin.createProduct({
        name: 'X',
        billingModel: 'standard',
        active: true,
      }),
      admin.updateProduct(10, { name: 'X' }),
      admin.deleteProduct(10),
      admin.createPlan(10, paid),
      admin.updatePlan(501, { name: 'X' }),
      admin.deletePlan(502),
    ]
    for (const attempt of attempts)
      await rejectsWith(attempt, 409, 'CATALOG_READ_ONLY')
    expect(h.crm.calls).toEqual([])
    expect(get).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})

describe('CatalogAdmin: criar', () => {
  it('cria produto com os códigos e enums da config e opened Y', async () => {
    const { h, admin, c } = await setup()
    const view = await admin.createProduct({
      name: 'Extrator',
      billingModel: 'per_unit',
      active: true,
    })
    expect(lastWrite(h)).toMatchObject({
      op: 'add',
      entityTypeId: c.entityTypes.product,
      fields: {
        title: 'Extrator',
        [c.product.billingModel]: '13607',
        [c.product.active]: 'Y',
        opened: 'Y',
      },
    })
    expect(view).toMatchObject({
      name: 'Extrator',
      billingModel: '13607',
      kind: 'subscription',
      active: true,
      valid: true,
      apps: [],
      plans: [],
    })
    expect(await h.crm.getItem(c.entityTypes.product, view.id)).not.toBeNull()
  })

  it('cria plano no produto e o catálogo público já o enxerga', async () => {
    const { h, admin, c } = await setup()
    const before = await h.container.catalog.plansOfProduct(10)
    const view = await admin.createPlan(10, paid)
    expect(lastWrite(h)).toMatchObject({
      op: 'add',
      entityTypeId: c.entityTypes.plan,
      fields: {
        title: 'Plus',
        [c.plan.product]: 10,
        [c.plan.value]: 14900,
        [c.plan.interval]: '13611',
        [c.plan.gatewayIdHomolog]: 'price_plus',
        [c.plan.gatewayIdProduction]: 'price_plus_live',
        [c.plan.active]: 'Y',
        opened: 'Y',
      },
    })
    expect(view).toMatchObject({
      productId: 10,
      amount: 14900,
      interval: 'quarterly',
      isTrial: false,
      valid: true,
    })
    const after = await h.container.catalog.plansOfProduct(10)
    expect(after.length).toBe(before.length + 1)
    expect(after.map(p => p.id)).toContain(view.id)
  })

  it('produto inexistente: PRODUCT_NOT_FOUND', async () => {
    const { admin } = await setup()
    await rejectsWith(admin.createPlan(999, paid), 404, 'PRODUCT_NOT_FOUND')
  })

  it('plano de trial grava sem preços; trial com preço é recusado', async () => {
    const { h, admin, c } = await setup()
    const view = await admin.createPlan(10, {
      ...paid,
      trial: true,
      priceHomolog: null,
      priceProduction: null,
    })
    expect(lastWrite(h).fields).toMatchObject({
      [c.plan.gatewayIdHomolog]: '',
      [c.plan.gatewayIdProduction]: '',
    })
    expect(view.isTrial).toBe(true)
    h.crm.calls = []
    await rejectsWith(
      admin.createPlan(10, { ...paid, trial: true, priceProduction: null }),
      422,
      'PLAN_INVALID_FOR_PRODUCT',
    )
    expect(h.crm.calls).toEqual([])
  })

  it('plano pago sem nenhum preço é recusado (seria lido como trial)', async () => {
    const { admin } = await setup()
    await rejectsWith(
      admin.createPlan(10, {
        ...paid,
        priceHomolog: null,
        priceProduction: null,
      }),
      422,
      'PLAN_INVALID_FOR_PRODUCT',
    )
  })

  it('compra única recusa intervalo; assinatura exige intervalo', async () => {
    const { h, admin, c } = await setup()
    await rejectsWith(
      admin.createPlan(11, paid),
      422,
      'PLAN_INVALID_FOR_PRODUCT',
    )
    await rejectsWith(
      admin.createPlan(10, { ...paid, interval: null }),
      422,
      'PLAN_INVALID_FOR_PRODUCT',
    )
    const pack = await admin.createPlan(11, { ...paid, interval: null })
    expect(lastWrite(h).fields).toMatchObject({ [c.plan.interval]: '' })
    expect(pack).toMatchObject({ interval: null, valid: true })
  })
})

describe('CatalogAdmin: plano em uso, edições bloqueadas', () => {
  it('trocar ou apagar preço de plano com assinatura (de outro ambiente)', async () => {
    const { h, admin } = await setup()
    subscribe(h, 501, 'homolog')
    await rejectsWith(
      admin.updatePlan(501, { priceProduction: 'price_other' }),
      409,
      'PLAN_IN_USE',
    )
    await rejectsWith(
      admin.updatePlan(501, { priceHomolog: null }),
      409,
      'PLAN_IN_USE',
    )
    expect(h.crm.calls).toEqual([])
  })

  it('trocar preço de plano sem uso é livre', async () => {
    const { admin } = await setup()
    const view = await admin.updatePlan(501, { priceProduction: 'price_new' })
    expect(view.priceProduction).toBe('price_new')
  })

  it('o 409 traz o uso nos details e a orientação', async () => {
    const { h, admin } = await setup()
    subscribe(h, 501)
    const error = await admin
      .updatePlan(501, { priceProduction: 'price_other' })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({
      details: {
        subscriptions: { total: 1, active: 1 },
        trialOfApps: [],
      },
    })
    expect((error as Error).message).toMatch(/crie um plano novo/i)
  })

  it('ligar/desligar trial de plano em uso (assinatura ou trial de app)', async () => {
    const { h, admin } = await setup()
    // 500 é o plano de trial do GPTMaker.
    await rejectsWith(
      admin.updatePlan(500, {
        trial: false,
        priceHomolog: 'price_t',
        priceProduction: 'price_t_live',
      }),
      409,
      'PLAN_IN_USE',
    )
    subscribe(h, 501)
    await rejectsWith(
      admin.updatePlan(501, {
        trial: true,
        priceHomolog: null,
        priceProduction: null,
      }),
      409,
      'PLAN_IN_USE',
    )
  })

  it('ligar trial de plano sem uso é livre', async () => {
    const { admin } = await setup()
    const view = await admin.updatePlan(502, {
      trial: true,
      priceHomolog: null,
      priceProduction: null,
    })
    expect(view.isTrial).toBe(true)
  })

  it('trial ligado com preço é recusado na edição', async () => {
    const { admin } = await setup()
    await rejectsWith(
      admin.updatePlan(502, { trial: true }),
      422,
      'PLAN_INVALID_FOR_PRODUCT',
    )
  })

  it('trocar intervalo de plano com assinatura; sem uso é livre', async () => {
    const { h, admin } = await setup()
    subscribe(h, 501)
    await rejectsWith(
      admin.updatePlan(501, { interval: 'yearly' }),
      409,
      'PLAN_IN_USE',
    )
    const view = await admin.updatePlan(502, { interval: 'yearly' })
    expect(view.interval).toBe('yearly')
  })

  it('preencher intervalo vazio de plano com assinatura é livre', async () => {
    const { h, admin, c } = await setup()
    h.crm.seed(c.entityTypes.plan, {
      id: 503,
      title: 'Sem intervalo',
      [c.plan.product]: 10,
      [c.plan.value]: 9900,
      [c.plan.interval]: '',
      [c.plan.gatewayIdProduction]: 'price_noint_live',
      [c.plan.active]: 'Y',
    })
    subscribe(h, 503)
    const view = await admin.updatePlan(503, { interval: 'monthly' })
    expect(lastWrite(h).fields).toEqual({ [c.plan.interval]: '13609' })
    expect(view).toMatchObject({ interval: 'monthly', valid: true })
    // Já preenchido, trocar continua bloqueado.
    await rejectsWith(
      admin.updatePlan(503, { interval: 'yearly' }),
      409,
      'PLAN_IN_USE',
    )
  })

  it('intervalo em compra única é recusado na edição', async () => {
    const { admin } = await setup()
    await rejectsWith(
      admin.updatePlan(510, { interval: 'monthly' }),
      422,
      'PLAN_INVALID_FOR_PRODUCT',
    )
  })

  it('plano inexistente: PLAN_NOT_FOUND', async () => {
    const { admin } = await setup()
    await rejectsWith(
      admin.updatePlan(999, { name: 'X' }),
      404,
      'PLAN_NOT_FOUND',
    )
    await rejectsWith(admin.deletePlan(999), 404, 'PLAN_NOT_FOUND')
  })
})

describe('CatalogAdmin: plano em uso, edições livres', () => {
  it('renomear, mudar valor e desativar gravam só o que mudou', async () => {
    const { h, admin, c } = await setup()
    subscribe(h, 501)
    const view = await admin.updatePlan(501, {
      name: 'Básico 2026',
      amount: 10900,
      active: false,
    })
    expect(lastWrite(h)).toEqual({
      op: 'update',
      entityTypeId: c.entityTypes.plan,
      id: 501,
      fields: {
        title: 'Básico 2026',
        [c.plan.value]: 10900,
        [c.plan.active]: 'N',
      },
    })
    expect(view).toMatchObject({
      name: 'Básico 2026',
      amount: 10900,
      active: false,
      priceProduction: 'price_basic_live',
    })
  })

  it('preencher preço vazio é livre mesmo em uso', async () => {
    const { h, admin } = await setup()
    subscribe(h, 510)
    const view = await admin.updatePlan(510, {
      priceProduction: 'price_pack_live',
    })
    expect(view.priceProduction).toBe('price_pack_live')
  })

  it('editar plano invalida o cache do catálogo público', async () => {
    const { h, admin } = await setup()
    expect((await h.container.catalog.getPlan(502))!.name).toBe('Pro')
    await admin.updatePlan(502, { name: 'Pro+' })
    expect((await h.container.catalog.getPlan(502))!.name).toBe('Pro+')
  })
})

describe('CatalogAdmin: id de preço não se repete', () => {
  it('criar com preço de outro plano no mesmo ambiente: 422 com o plano e o campo', async () => {
    const { h, admin } = await setup()
    h.crm.calls = []
    const error = await admin
      .createPlan(10, { ...paid, priceHomolog: 'price_basic' })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 422,
      code: 'PRICE_ALREADY_USED',
      details: { planId: 501, field: 'priceHomolog' },
    })
    expect(h.crm.calls).toEqual([])
  })

  it('criar com o mesmo id na homologação e na produção: 422', async () => {
    const { h, admin } = await setup()
    h.crm.calls = []
    const error = await admin
      .createPlan(10, {
        ...paid,
        priceHomolog: 'price_same',
        priceProduction: 'price_same',
      })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 422,
      code: 'PRICE_ALREADY_USED',
      details: { planId: null, field: 'priceProduction' },
    })
    expect(h.crm.calls).toEqual([])
  })

  it('editar para o preço de outro plano ou para o do outro ambiente: 422', async () => {
    const { h, admin } = await setup()
    h.crm.calls = []
    await expect(
      admin.updatePlan(502, { priceProduction: 'price_basic_live' }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PRICE_ALREADY_USED',
      details: { planId: 501, field: 'priceProduction' },
    })
    await expect(
      admin.updatePlan(502, { priceHomolog: 'price_pro_live' }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PRICE_ALREADY_USED',
      details: { planId: 502, field: 'priceHomolog' },
    })
    expect(h.crm.calls).toEqual([])
  })

  it('reenviar o próprio preço sem mudança não conflita', async () => {
    const { admin } = await setup()
    const view = await admin.updatePlan(501, {
      name: 'Básico 2',
      priceHomolog: 'price_basic',
      priceProduction: 'price_basic_live',
    })
    expect(view).toMatchObject({
      name: 'Básico 2',
      priceHomolog: 'price_basic',
    })
  })
})

describe('CatalogAdmin: excluir plano', () => {
  it('plano com assinatura ou trial de app não se exclui; sem uso, sim', async () => {
    const { h, admin, c } = await setup()
    subscribe(h, 501, 'homolog')
    await rejectsWith(admin.deletePlan(501), 409, 'PLAN_IN_USE')
    const trial = await admin.deletePlan(500).catch((e: unknown) => e)
    expect(trial).toMatchObject({
      code: 'PLAN_IN_USE',
      details: { trialOfApps: ['crmthink.gptmaker'] },
    })
    expect(await h.crm.getItem(c.entityTypes.plan, 501)).not.toBeNull()
    expect(await h.crm.getItem(c.entityTypes.plan, 500)).not.toBeNull()
    await h.container.catalog.plansOfProduct(10)
    await admin.deletePlan(502)
    expect(await h.crm.getItem(c.entityTypes.plan, 502)).toBeNull()
    const plans = await h.container.catalog.plansOfProduct(10)
    expect(plans.map(p => p.id)).not.toContain(502)
  })

  it('o uso é conferido de novo imediatamente antes de excluir', async () => {
    const { h, admin, c } = await setup()
    // Primeira checagem (a tela consulta o uso antes de oferecer excluir): livre.
    expect((await admin.planUsage(502)).subscriptions.total).toBe(0)
    // A assinatura nasce durante a exclusão, depois da leitura do plano.
    const get = h.crm.getItem.bind(h.crm)
    h.crm.getItem = async (entityTypeId, id) => {
      const row = await get(entityTypeId, id)
      if (entityTypeId === c.entityTypes.plan) subscribe(h, 502)
      return row
    }
    const remove = vi.spyOn(h.crm, 'deleteItem')
    await rejectsWith(admin.deletePlan(502), 409, 'PLAN_IN_USE')
    expect(remove).not.toHaveBeenCalled()
    expect(await get(c.entityTypes.plan, 502)).not.toBeNull()
  })
})

describe('CatalogAdmin: produto', () => {
  const seedProduct = (h: Harness, id: number, model = '13605') =>
    h.crm.seed(h.config.entityTypes.product, {
      id,
      title: `Produto ${id}`,
      [h.config.product.billingModel]: model,
      [h.config.product.active]: 'Y',
    })

  it('mudar modelo de cobrança de produto com planos é bloqueado', async () => {
    const { h, admin } = await setup()
    const error = await admin
      .updateProduct(10, { billingModel: 'per_unit' })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 409,
      code: 'PRODUCT_IN_USE',
      details: { plans: 3, apps: ['crmthink.gptmaker'] },
    })
    expect(h.crm.calls).toEqual([])
  })

  it('modelo de cobrança livre sem planos; mesmo modelo com planos também', async () => {
    const { h, admin, c } = await setup()
    seedProduct(h, 12)
    const view = await admin.updateProduct(12, { billingModel: 'per_unit' })
    expect(view.billingModel).toBe('13607')
    await admin.updateProduct(10, { billingModel: 'standard' })
    expect(lastWrite(h).fields).toEqual({ [c.product.billingModel]: '13605' })
  })

  it('preencher modelo vazio de produto com planos é livre', async () => {
    const { h, admin, c } = await setup()
    seedProduct(h, 12, '')
    h.crm.seed(c.entityTypes.plan, {
      id: 520,
      title: 'Plano do 12',
      [c.plan.product]: 12,
      [c.plan.value]: 100,
      [c.plan.interval]: '13609',
      [c.plan.gatewayIdProduction]: 'price_twelve_live',
      [c.plan.active]: 'Y',
    })
    const view = await admin.updateProduct(12, { billingModel: 'standard' })
    expect(lastWrite(h).fields).toEqual({ [c.product.billingModel]: '13605' })
    expect(view).toMatchObject({ billingModelKey: 'standard', valid: true })
    // Já preenchido, trocar continua bloqueado.
    await rejectsWith(
      admin.updateProduct(12, { billingModel: 'per_unit' }),
      409,
      'PRODUCT_IN_USE',
    )
  })

  it('modelo desconhecido com planos: fixar um do mesmo tipo é livre; mudar o tipo, não', async () => {
    const { h, admin, c } = await setup()
    // 11 é compra única pelo id 99001, que não é nenhum dos três modelos conhecidos.
    await rejectsWith(
      admin.updateProduct(11, { billingModel: 'standard' }),
      409,
      'PRODUCT_IN_USE',
    )
    expect(h.crm.calls).toEqual([])
    const view = await admin.updateProduct(11, { billingModel: 'one_time' })
    expect(lastWrite(h).fields).toEqual({ [c.product.billingModel]: '14455' })
    expect(view.billingModelKey).toBe('one_time')
  })

  it('renomear e desativar produto com planos é livre e invalida o cache', async () => {
    const { h, admin, c } = await setup()
    expect((await h.container.catalog.getProduct(10))!.name).toBe('GPTMaker')
    const view = await admin.updateProduct(10, {
      name: 'GPTMaker 2',
      active: false,
    })
    expect(lastWrite(h).fields).toEqual({
      title: 'GPTMaker 2',
      [c.product.active]: 'N',
    })
    expect(view).toMatchObject({
      name: 'GPTMaker 2',
      active: false,
      apps: ['crmthink.gptmaker'],
    })
    expect(view.plans).toHaveLength(3)
    expect((await h.container.catalog.getProduct(10))!.name).toBe('GPTMaker 2')
  })

  it('produto inexistente: PRODUCT_NOT_FOUND', async () => {
    const { admin } = await setup()
    await rejectsWith(
      admin.updateProduct(999, { name: 'X' }),
      404,
      'PRODUCT_NOT_FOUND',
    )
    await rejectsWith(admin.deleteProduct(999), 404, 'PRODUCT_NOT_FOUND')
  })

  it('produto com planos ou com app vinculado não se exclui; sem uso, sim', async () => {
    const { h, admin, c } = await setup()
    await rejectsWith(admin.deleteProduct(10), 409, 'PRODUCT_IN_USE')
    seedProduct(h, 12)
    h.db.rows('appProduct').push({
      appCode: 'crmthink.gptmaker',
      productSpaId: 12,
    })
    const linked = await admin.deleteProduct(12).catch((e: unknown) => e)
    expect(linked).toMatchObject({
      code: 'PRODUCT_IN_USE',
      details: { apps: ['crmthink.gptmaker'], plans: 0 },
    })
    seedProduct(h, 13)
    await admin.deleteProduct(13)
    expect(await h.crm.getItem(c.entityTypes.product, 13)).toBeNull()
    expect(await h.crm.getItem(c.entityTypes.product, 12)).not.toBeNull()
    expect(await h.crm.getItem(c.entityTypes.product, 10)).not.toBeNull()
  })
})

describe('CatalogAdmin: releitura depois de gravar', () => {
  it('campo descartado em silêncio no update vira CATALOG_WRITE_FAILED', async () => {
    const { h, admin, c } = await setup()
    const update = h.crm.updateItem.bind(h.crm)
    h.crm.updateItem = async (entityTypeId, id, fields) => {
      const { [c.plan.gatewayIdProduction]: _dropped, ...kept } = fields
      return update(entityTypeId, id, kept)
    }
    const error = await admin
      .updatePlan(502, { priceProduction: 'price_pro_new' })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 502,
      code: 'CATALOG_WRITE_FAILED',
      details: { id: 502, created: false, lost: [c.plan.gatewayIdProduction] },
    })
  })

  it('campo descartado na criação: o erro traz o id criado', async () => {
    const { h, admin, c } = await setup()
    const add = h.crm.addItem.bind(h.crm)
    let created = 0
    h.crm.addItem = async (entityTypeId, fields) => {
      const { [c.plan.gatewayIdHomolog]: _dropped, ...kept } = fields
      const item = await add(entityTypeId, kept)
      created = Number(item.id)
      return item
    }
    const error = await admin.createPlan(10, paid).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 502, code: 'CATALOG_WRITE_FAILED' })
    expect(created).toBeGreaterThan(0)
    expect((error as Error).message).toContain(`#${created}`)
    expect(error).toMatchObject({
      details: { id: created, created: true, lost: [c.plan.gatewayIdHomolog] },
    })
  })

  /** Depois da primeira escrita, toda leitura de item falha (timeout, 5xx). */
  function failReadsAfterWrite(h: Harness) {
    const add = h.crm.addItem.bind(h.crm)
    const update = h.crm.updateItem.bind(h.crm)
    const get = h.crm.getItem.bind(h.crm)
    const state = { wrote: false, created: 0 }
    h.crm.addItem = async (entityTypeId, fields) => {
      const item = await add(entityTypeId, fields)
      state.wrote = true
      state.created = Number(item.id)
      return item
    }
    h.crm.updateItem = async (entityTypeId, id, fields) => {
      const item = await update(entityTypeId, id, fields)
      state.wrote = true
      return item
    }
    h.crm.getItem = async (entityTypeId, id) => {
      if (state.wrote) throw new Error('Bitrix indisponível')
      return get(entityTypeId, id)
    }
    return state
  }

  it('releitura que falha depois de criar produto: 502 com o id criado', async () => {
    const { h, admin } = await setup()
    const state = failReadsAfterWrite(h)
    const error = await admin
      .createProduct({ name: 'X', billingModel: 'standard', active: true })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 502, code: 'CATALOG_WRITE_FAILED' })
    expect(state.created).toBeGreaterThan(0)
    expect((error as Error).message).toContain(`#${state.created}`)
    expect(error).toMatchObject({
      details: { id: state.created, created: true, lost: [] },
    })
  })

  it('releitura que falha depois de criar plano: 502 com o id criado', async () => {
    const { h, admin } = await setup()
    const state = failReadsAfterWrite(h)
    const error = await admin.createPlan(10, paid).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 502, code: 'CATALOG_WRITE_FAILED' })
    expect(state.created).toBeGreaterThan(0)
    expect((error as Error).message).toContain(`#${state.created}`)
    expect(error).toMatchObject({
      details: { id: state.created, created: true, lost: [] },
    })
  })

  it('releitura que falha depois de editar: 502, não 500', async () => {
    const { h, admin } = await setup()
    failReadsAfterWrite(h)
    const error = await admin
      .updatePlan(502, { name: 'Pro+' })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 502,
      code: 'CATALOG_WRITE_FAILED',
      details: { id: 502, created: false, lost: [] },
    })
    expect((error as Error).message).toContain('#502')
  })
})
