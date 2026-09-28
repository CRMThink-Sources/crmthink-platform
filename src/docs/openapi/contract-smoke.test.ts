import { describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import { installedGptMaker } from '@/test/billing-helpers'
import { createHarness, GPTMAKER } from '@/test/harness'

/**
 * Exercita as rotas que os testes de domínio não chamam, para que toda resposta
 * documentada passe pela conferência de contrato de `http(h)` ao menos uma vez.
 */

const ADMIN = { Authorization: 'Bearer admin-token' }

describe('contrato: rotas sem teste de domínio', () => {
  it('infraestrutura e página de instalação', async () => {
    const h = createHarness()
    await http(h).get('/health').expect(200)
    const ready = await http(h).get('/health/ready')
    expect([200, 503]).toContain(ready.status)
    const metrics = await http(h).get('/metrics').expect(200)
    expect(metrics.text).toContain('platform_')

    await installedGptMaker(h)
    const page = await http(h).get(`/install/${GPTMAKER}`).expect(200)
    expect(page.type).toBe('text/html')
    await http(h).post(`/install/${GPTMAKER}`).expect(200)
    await http(h).get('/install/nao.existe').expect(404)
  })

  it('assinatura e itens', async () => {
    const h = createHarness()
    const { apiKey, installationId } = await installedGptMaker(h)
    const auth = { Authorization: `Bearer ${apiKey}` }
    const subscription = await http(h)
      .get(`/v1/installations/${installationId}/subscription`)
      .set(auth)
      .expect(200)
    const id = subscription.body.subscriptionId as number
    await http(h).get(`/v1/subscriptions/${id}/items`).set(auth).expect(200)
    await http(h).get('/v1/subscriptions/999999/items').set(auth).expect(404)
  })

  it('rotas de operador', async () => {
    const h = createHarness()
    const { installationId } = await installedGptMaker(h, {
      trialOnInstall: false,
    })

    await http(h).get(`/admin/apps/${GPTMAKER}`).set(ADMIN).expect(200)
    await http(h).get('/admin/apps/nao.existe').set(ADMIN).expect(404)
    await http(h).get('/admin/apps').expect(401)

    await http(h)
      .post(`/v1/installations/${installationId}/trial`)
      .set(ADMIN)
      .expect(201)
    await http(h)
      .get(`/admin/installations/${installationId}/attempts`)
      .set(ADMIN)
      .expect(200)
    await http(h).get('/admin/events?status=pending').set(ADMIN).expect(200)
    await http(h).get('/admin/stripe-events').set(ADMIN).expect(200)
    await http(h)
      .post('/admin/signing-keys/rotate')
      .set(ADMIN)
      .send({ leadMinutes: 0 })
      .expect(201)
    await http(h).post('/admin/sweeps/stripe').set(ADMIN).expect(200)
    await http(h).post('/admin/sweeps/spa').set(ADMIN).expect(200)
    await http(h).post('/admin/sweeps/outro').set(ADMIN).expect(404)
    // Por último: o PATCH parcial hoje aplica os defaults do cadastro (zera trial e
    // produtos) — ver updateAppSchema em registry/app-registry.ts.
    await http(h)
      .patch(`/admin/apps/${GPTMAKER}`)
      .set(ADMIN)
      .send({ name: 'GPTMaker 2' })
      .expect(200)
  })
})
