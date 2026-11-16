import { describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import { installedGptMaker } from '@/test/billing-helpers'
import { createHarness, outbox, type Harness } from '@/test/harness'

const WHO = { actor: 'operator:1', reason: 'contrato 123 com o financeiro' }
const URL = '/webhooks/payments'
const SUBSCRIPTION_TYPE = 1142

async function boot(env: Record<string, string> = {}) {
  const h = createHarness({
    env: { PLATFORM_ENVIRONMENT: 'production', ...env },
  })
  const { installationId, apiKey: appKey } = await installedGptMaker(h, {
    trialOnInstall: false,
  })
  const { integration, apiKey } =
    await h.container.paymentIntegrations.create('Banco X')
  const subscribe = (periodEnd = '2026-10-01') =>
    h.container.manualSubscriptions.create(
      installationId,
      { planId: 501, kind: 'manual', periodEnd },
      WHO,
    )
  const post = (body: unknown, key: string | null = apiKey) => {
    const request = http(h).post(URL).set('Content-Type', 'application/json')
    if (key !== null) request.set('Authorization', `Bearer ${key}`)
    return request.send(typeof body === 'string' ? body : JSON.stringify(body))
  }
  return { h, installationId, appKey, integration, apiKey, subscribe, post }
}

const renewed = (h: Harness) =>
  outbox(h).filter(e => e.type === 'subscription.renewed')

describe('POST /webhooks/payments', () => {
  it('200 com o corpo do contrato; repetir devolve duplicate true; registra o último uso', async () => {
    const { h, subscribe, post, integration } = await boot()
    const sub = await subscribe()

    const first = await post({
      externalId: 'boleto-1',
      subscriptionId: sub.id,
      paidAt: '2026-09-28',
    })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({
      subscriptionId: sub.id,
      status: 'active',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T23:59:59.999Z',
      duplicate: false,
    })

    const second = await post({
      externalId: 'boleto-1',
      subscriptionId: sub.id,
    })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ ...first.body, duplicate: true })
    expect(renewed(h)).toHaveLength(1)

    const used = (await h.container.paymentIntegrations.list()).find(
      item => item.id === integration.id,
    )!
    expect(used.lastUsedAt).toEqual(h.clock.now())
  })

  it('por installationId renova a assinatura vigente', async () => {
    const { subscribe, post, installationId } = await boot()
    const sub = await subscribe()
    const response = await post({ externalId: 'boleto-9', installationId })
    expect(response.status).toBe(200)
    expect(response.body.subscriptionId).toBe(sub.id)
  })
})

describe('autenticação', () => {
  it('sem chave, chave desconhecida, chave de app ou de operador: 401 sem renovar', async () => {
    const { h, subscribe, post, appKey, apiKey } = await boot()
    const sub = await subscribe()
    const body = { externalId: 'boleto-1', subscriptionId: sub.id }

    for (const key of [null, 'pay_desconhecida', appKey, 'admin-token']) {
      const response = await post(body, key)
      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('UNAUTHORIZED')
      expect(JSON.stringify(response.body)).not.toContain(apiKey)
    }
    expect(renewed(h)).toHaveLength(0)
    expect(h.db.rows('paymentNotice')).toHaveLength(0)
  })

  it('integração desativada: 403 INTEGRATION_INACTIVE', async () => {
    const { h, subscribe, post, integration } = await boot()
    const sub = await subscribe()
    await h.container.paymentIntegrations.update(integration.id, {
      active: false,
    })
    const response = await post({ externalId: 'b', subscriptionId: sub.id })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('INTEGRATION_INACTIVE')
    expect(renewed(h)).toHaveLength(0)
  })

  it('a chave de integração não autentica nenhuma outra rota', async () => {
    const { h, apiKey, installationId } = await boot()
    const attempts = [
      http(h)
        .post(`/v1/installations/${installationId}/trial`)
        .set('Authorization', `Bearer ${apiKey}`),
      http(h)
        .get('/admin/payment-integrations')
        .set('Authorization', `Bearer ${apiKey}`),
      http(h)
        .post(`/admin/installations/${installationId}/subscriptions`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({}),
    ]
    for (const attempt of attempts) expect((await attempt).status).toBe(401)
  })
})

describe('corpo inválido', () => {
  it('campo desconhecido, os dois ids, nenhum id ou externalId ausente: 400 VALIDATION_ERROR', async () => {
    const { post } = await boot()
    for (const body of [
      { externalId: 'b', subscriptionId: 1, amount: 10 },
      { externalId: 'b', subscriptionId: 1, installationId: 2 },
      { externalId: 'b' },
      { subscriptionId: 1 },
      {},
    ]) {
      const response = await post(body)
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('JSON malformado: 400 INVALID_JSON; corpo maior que 16 KB: 413 PAYLOAD_TOO_LARGE', async () => {
    const { post } = await boot()
    const broken = await post('{"externalId":')
    expect(broken.status).toBe(400)
    expect(broken.body.error.code).toBe('INVALID_JSON')

    const large = await post({
      externalId: 'b',
      subscriptionId: 1,
      note: 'x'.repeat(20_000),
    })
    expect(large.status).toBe(413)
    expect(large.body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })
})

describe('regras do aviso', () => {
  it('assinatura inexistente: 404 SUBSCRIPTION_NOT_FOUND', async () => {
    const { post } = await boot()
    const response = await post({ externalId: 'b', subscriptionId: 987654 })
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND')
  })

  it('assinatura Stripe: 422 NOT_MANUAL_SUBSCRIPTION', async () => {
    const { h, subscribe, post } = await boot()
    const sub = await subscribe()
    h.crm.items.get(SUBSCRIPTION_TYPE)!.get(sub.id)![
      h.config.subscription.modality
    ] = 'stripe'
    const response = await post({ externalId: 'b', subscriptionId: sub.id })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('NOT_MANUAL_SUBSCRIPTION')
  })

  it('assinatura cancelada: 409 SUBSCRIPTION_NOT_RENEWABLE com details', async () => {
    const { h, subscribe, post } = await boot()
    const sub = await subscribe()
    const cancelled = Object.entries(h.config.subscription.statusEnum).find(
      ([, value]) => value === 'cancelled',
    )![0]
    h.crm.items.get(SUBSCRIPTION_TYPE)!.get(sub.id)![
      h.config.subscription.status
    ] = cancelled
    const response = await post({ externalId: 'b', subscriptionId: sub.id })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('SUBSCRIPTION_NOT_RENEWABLE')
    expect(response.body.error.details).toEqual({
      subscriptionId: sub.id,
      status: 'cancelled',
    })
  })

  it('externalId reaproveitado para outra assinatura: 409 EXTERNAL_ID_REUSED', async () => {
    const { subscribe, post } = await boot()
    const sub = await subscribe()
    await post({ externalId: 'boleto-1', subscriptionId: sub.id }).expect(200)
    const response = await post({
      externalId: 'boleto-1',
      subscriptionId: sub.id + 1000,
    })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('EXTERNAL_ID_REUSED')
  })

  it('período inválido: 422 INVALID_PERIOD', async () => {
    const { subscribe, post } = await boot()
    const sub = await subscribe()
    const response = await post({
      externalId: 'b',
      subscriptionId: sub.id,
      periodEnd: '2026-10-01',
    })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('INVALID_PERIOD')
  })

  it('homologação: 409 SUBSCRIPTIONS_READ_ONLY', async () => {
    const { post } = await boot({ PLATFORM_ENVIRONMENT: 'homolog' })
    const response = await post({ externalId: 'b', subscriptionId: 1 })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('SUBSCRIPTIONS_READ_ONLY')
  })
})
