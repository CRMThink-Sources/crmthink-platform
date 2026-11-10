import { describe, expect, it } from 'vitest'
import {
  audit,
  login,
  operator,
  ORIGIN,
  setup,
} from '@/modules/backoffice/test-support'
import { http } from '@/test/app'
import { seedGptMaker } from '@/test/harness'

const REASON = 'ajuste de catalogo pedido pelo comercial'

async function boot(env: Record<string, string> = {}) {
  const h = setup({ PLATFORM_ENVIRONMENT: 'production', ...env })
  await seedGptMaker(h)
  const dev = await login(h, await operator(h, 'dev@x.test', 'operator'))
  const viewer = await login(h, await operator(h, 'ver@x.test', 'viewer'))
  const as = (cookie: string) => ({
    get: (path: string) => http(h).get(path).set('Cookie', cookie),
    post: (path: string) =>
      http(h).post(path).set('Cookie', cookie).set('Origin', ORIGIN),
    patch: (path: string) =>
      http(h).patch(path).set('Cookie', cookie).set('Origin', ORIGIN),
    del: (path: string) =>
      http(h).delete(path).set('Cookie', cookie).set('Origin', ORIGIN),
  })
  return { h, dev: as(dev), viewer: as(viewer) }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const paid = {
  name: 'Plus',
  amount: 14900,
  interval: 'quarterly',
  priceHomolog: 'price_plus',
  priceProduction: 'price_pluslive',
  trial: false,
  active: true,
}

describe('rotas do catálogo: leitura', () => {
  it('viewer lê a lista e o uso', async () => {
    const { viewer } = await boot()
    const list = await viewer.get('/admin/catalog/products')
    expect(list.status).toBe(200)
    expect(list.body.writable).toBe(true)
    expect(list.body.products.map((p: any) => p.id).sort()).toEqual([10, 11])
    expect(list.body.orphanPlans).toEqual([])

    const product = await viewer.get('/admin/catalog/products/10/usage')
    expect(product.status).toBe(200)
    expect(product.body).toEqual({ apps: ['crmthink.gptmaker'], plans: 3 })

    const plan = await viewer.get('/admin/catalog/plans/500/usage')
    expect(plan.status).toBe(200)
    expect(plan.body.trialOfApps).toEqual(['crmthink.gptmaker'])
  })

  it('fora da produção lê com writable:false e escrever é CATALOG_READ_ONLY', async () => {
    const { dev } = await boot({ PLATFORM_ENVIRONMENT: 'homolog' })
    const list = await dev.get('/admin/catalog/products')
    expect(list.status).toBe(200)
    expect(list.body.writable).toBe(false)
    const create = await dev
      .post('/admin/catalog/products')
      .send({ name: 'Novo', billingModel: 'standard', active: true })
    expect(create.status).toBe(409)
    expect(create.body.error.code).toBe('CATALOG_READ_ONLY')
  })

  it('id inexistente: 404', async () => {
    const { dev } = await boot()
    const response = await dev.get('/admin/catalog/plans/abc/usage')
    expect(response.status).toBe(404)
    const missing = await dev
      .del('/admin/catalog/products/999')
      .set('X-Admin-Reason', REASON)
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND')
  })
})

describe('rotas do catálogo: papéis', () => {
  it('viewer não escreve: 403 FORBIDDEN_ROLE', async () => {
    const { viewer } = await boot()
    const attempts = [
      viewer
        .post('/admin/catalog/products')
        .send({ name: 'X', billingModel: 'standard', active: true }),
      viewer.patch('/admin/catalog/products/10').send({ name: 'X' }),
      viewer.del('/admin/catalog/products/10').set('X-Admin-Reason', REASON),
      viewer.post('/admin/catalog/products/10/plans').send(paid),
      viewer.patch('/admin/catalog/plans/501').send({ name: 'X' }),
      viewer.del('/admin/catalog/plans/502').set('X-Admin-Reason', REASON),
    ]
    for (const attempt of attempts) {
      const response = await attempt
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN_ROLE')
    }
  })
})

describe('rotas do catálogo: escrita', () => {
  it('operator cria, edita, desativa e exclui produto', async () => {
    const { dev } = await boot()
    const created = await dev
      .post('/admin/catalog/products')
      .send({ name: '  Novo produto ', billingModel: 'standard', active: true })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      name: 'Novo produto',
      billingModel: '13605',
      billingModelKey: 'standard',
      active: true,
      plans: [],
    })
    const id = created.body.id

    const edited = await dev
      .patch(`/admin/catalog/products/${id}`)
      .send({ name: 'Renomeado' })
    expect(edited.status).toBe(200)
    expect(edited.body.name).toBe('Renomeado')

    const off = await dev
      .patch(`/admin/catalog/products/${id}`)
      .set('X-Admin-Reason', REASON)
      .send({ active: false })
    expect(off.status).toBe(200)
    expect(off.body.active).toBe(false)

    const removed = await dev
      .del(`/admin/catalog/products/${id}`)
      .set('X-Admin-Reason', REASON)
    expect(removed.status).toBe(204)
  })

  it('operator cria, edita, desativa e exclui plano', async () => {
    const { dev } = await boot()
    const created = await dev.post('/admin/catalog/products/10/plans').send({
      ...paid,
      priceHomolog: ' price_plus ',
      priceProduction: '',
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      productId: 10,
      amount: 14900,
      priceHomolog: 'price_plus',
      priceProduction: null,
      interval: 'quarterly',
    })
    const id = created.body.id

    const edited = await dev
      .patch(`/admin/catalog/plans/${id}`)
      .send({ name: 'Plus 2', amount: 15900 })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ name: 'Plus 2', amount: 15900 })

    const off = await dev
      .patch(`/admin/catalog/plans/${id}`)
      .set('X-Admin-Reason', REASON)
      .send({ active: false })
    expect(off.status).toBe(200)
    expect(off.body.active).toBe(false)

    const removed = await dev
      .del(`/admin/catalog/plans/${id}`)
      .set('X-Admin-Reason', REASON)
    expect(removed.status).toBe(204)
  })

  it('desativar e excluir exigem motivo: 400 REASON_REQUIRED', async () => {
    const { dev } = await boot()
    const cases = [
      dev.patch('/admin/catalog/products/10').send({ active: false }),
      dev.patch('/admin/catalog/plans/501').send({ active: false }),
      dev.del('/admin/catalog/products/11'),
      dev.del('/admin/catalog/plans/502'),
    ]
    for (const attempt of cases) {
      const response = await attempt
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('REASON_REQUIRED')
    }
    // Editar sem desativar não pede motivo.
    const ok = await dev
      .patch('/admin/catalog/plans/501')
      .send({ name: 'Básico 2' })
    expect(ok.status).toBe(200)
  })

  it('corpo inválido: 400 de validação', async () => {
    const { dev } = await boot()
    const bad = [
      dev
        .post('/admin/catalog/products')
        .send({ name: '', billingModel: 'standard', active: true }),
      dev
        .post('/admin/catalog/products')
        .send({ name: 'X', billingModel: 'nope', active: true }),
      dev
        .post('/admin/catalog/products/10/plans')
        .send({ ...paid, amount: -1 }),
      dev
        .post('/admin/catalog/products/10/plans')
        .send({ ...paid, amount: 1.5 }),
      dev
        .post('/admin/catalog/products/10/plans')
        .send({ ...paid, priceHomolog: 'prod_x' }),
      dev
        .post('/admin/catalog/products/10/plans')
        .send({ ...paid, interval: 'weekly' }),
      dev.patch('/admin/catalog/plans/501').send({ amount: 'muito' }),
    ]
    for (const attempt of bad) {
      const response = await attempt
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('regra do plano: 422 PLAN_INVALID_FOR_PRODUCT', async () => {
    const { dev } = await boot()
    const response = await dev
      .post('/admin/catalog/products/10/plans')
      .send({ ...paid, interval: null })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('PLAN_INVALID_FOR_PRODUCT')
  })

  it('PLAN_IN_USE e PRODUCT_IN_USE chegam como 409 com o uso', async () => {
    const { dev } = await boot()
    const plan = await dev
      .del('/admin/catalog/plans/500')
      .set('X-Admin-Reason', REASON)
    expect(plan.status).toBe(409)
    expect(plan.body.error.code).toBe('PLAN_IN_USE')
    expect(plan.body.error.details).toEqual({
      subscriptions: { total: 0, active: 0 },
      trialOfApps: ['crmthink.gptmaker'],
    })
    const product = await dev
      .del('/admin/catalog/products/10')
      .set('X-Admin-Reason', REASON)
    expect(product.status).toBe(409)
    expect(product.body.error.code).toBe('PRODUCT_IN_USE')
    expect(product.body.error.details).toEqual({
      apps: ['crmthink.gptmaker'],
      plans: 3,
    })
  })
})

describe('rotas do catálogo: auditoria', () => {
  it('grava product/plan, id e motivo, sem preço no resumo cru', async () => {
    const { h, dev } = await boot()
    await dev
      .patch('/admin/catalog/plans/502')
      .set('X-Admin-Reason', REASON)
      .send({ active: false })
      .expect(200)
    await dev
      .del('/admin/catalog/plans/502')
      .set('X-Admin-Reason', REASON)
      .expect(204)
    await dev
      .patch('/admin/catalog/products/11')
      .send({ name: 'Créditos 2' })
      .expect(200)
    await flush()
    const rows = audit(h)
    const patchPlan = rows.find(
      r => r.action === 'PATCH /admin/catalog/plans/:id',
    )!
    expect(patchPlan).toMatchObject({
      targetType: 'plan',
      targetId: '502',
      statusCode: 200,
    })
    expect(patchPlan.summary.reason).toBe(REASON)
    expect(
      rows.find(r => r.action === 'DELETE /admin/catalog/plans/:id'),
    ).toMatchObject({ targetType: 'plan', targetId: '502', statusCode: 204 })
    expect(
      rows.find(r => r.action === 'PATCH /admin/catalog/products/:id'),
    ).toMatchObject({ targetType: 'product', targetId: '11' })
  })

  it('criar plano audita o plano criado (targetType plan, id novo)', async () => {
    const { h, dev } = await boot()
    const created = await dev
      .post('/admin/catalog/products/10/plans')
      .send(paid)
    expect(created.status).toBe(201)
    await flush()
    const row = audit(h).find(
      r => r.action === 'POST /admin/catalog/products/:id/plans',
    )!
    expect(row).toMatchObject({
      targetType: 'plan',
      targetId: String(created.body.id),
      statusCode: 201,
    })
  })
})
