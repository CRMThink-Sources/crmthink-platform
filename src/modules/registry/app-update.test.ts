import { describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import { createHarness, GPTMAKER, seedGptMaker } from '@/test/harness'

const ADMIN = { Authorization: 'Bearer admin-token' }

describe('edição parcial de app (PATCH)', () => {
  it('só muda o que veio no corpo: não reativa, não zera trial, escopos nem produtos', async () => {
    const h = createHarness()
    await seedGptMaker(h, {
      scopes: ['crm', 'imbot'],
      trialDays: 14,
      trialPlanId: 500,
      trialOnInstall: true,
    })
    await h.container.registry.update(GPTMAKER, { active: false })
    const before = await h.container.registry.getOrThrow(GPTMAKER)
    expect(before.active).toBe(false)

    const res = await http(h)
      .patch(`/admin/apps/${GPTMAKER}`)
      .set(ADMIN)
      .send({ name: 'GPTMaker 2' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      name: 'GPTMaker 2',
      active: false,
      scopes: ['crm', 'imbot'],
      trialDays: 14,
      trialOnInstall: true,
      trialPlanId: 500,
      productSpaIds: before.productSpaIds,
    })
    expect(before.productSpaIds.length).toBeGreaterThan(0)
  })

  it('o cadastro continua aplicando os padrões', async () => {
    const h = createHarness()
    const res = await http(h).post('/admin/apps').set(ADMIN).send({
      appCode: 'crmthink.novo',
      name: 'Novo',
      bitrixClientId: 'local.novo',
      bitrixClientSecret: 'segredo',
    })
    expect(res.status).toBe(201)
    expect(res.body.app).toMatchObject({
      scopes: [],
      productSpaIds: [],
      trialDays: 0,
      trialOnInstall: false,
      active: true,
    })
  })
})
