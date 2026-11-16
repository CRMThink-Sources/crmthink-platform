import { describe, expect, it } from 'vitest'
import {
  audit,
  login,
  operator,
  ORIGIN,
  setup,
} from '@/modules/backoffice/test-support'
import { http } from '@/test/app'
import { installedGptMaker, spaSubscriptions } from '@/test/billing-helpers'
import { outbox } from '@/test/harness'

const REASON = 'boleto trimestral combinado com o financeiro'

const body = {
  planId: 501,
  kind: 'manual',
  periodEnd: '2027-09-01',
}

async function boot(env: Record<string, string> = {}) {
  const h = setup({ PLATFORM_ENVIRONMENT: 'production', ...env })
  const { installationId } = await installedGptMaker(h)
  const dev = await login(h, await operator(h, 'dev@x.test', 'operator'))
  const viewer = await login(h, await operator(h, 'ver@x.test', 'viewer'))
  const as = (cookie: string) => ({
    get: (path: string) => http(h).get(path).set('Cookie', cookie),
    post: (path: string) =>
      http(h).post(path).set('Cookie', cookie).set('Origin', ORIGIN),
  })
  const url = (id = installationId) =>
    `/admin/installations/${id}/subscriptions`
  return { h, installationId, url, dev: as(dev), viewer: as(viewer) }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('POST /admin/installations/:id/subscriptions', () => {
  it('operator cria e recebe 201 com o corpo do contrato; a auditoria registra a rota, o alvo installation, o motivo e o corpo', async () => {
    const { h, dev, url, installationId } = await boot()
    const response = await dev
      .post(url())
      .set('X-Admin-Reason', REASON)
      .send(body)

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      subscriptionId: expect.any(Number),
      status: 'active',
      modality: 'manual',
      planId: 501,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2027-09-01T23:59:59.999Z',
    })
    expect(
      spaSubscriptions(h).some(s => s.id === response.body.subscriptionId),
    ).toBe(true)
    expect(
      outbox(h).filter(e => e.type === 'subscription.activated'),
    ).toHaveLength(1)

    await flush()
    const row = audit(h).find(
      r => r.action === 'POST /admin/installations/:id/subscriptions',
    )!
    expect(row).toMatchObject({
      targetType: 'installation',
      targetId: String(installationId),
      statusCode: 201,
    })
    expect(row.summary.reason).toBe(REASON)
    expect(row.summary.body).toMatchObject({ planId: 501, kind: 'manual' })
  })

  it('viewer: 403 FORBIDDEN_ROLE', async () => {
    const { h, viewer, url } = await boot()
    const before = spaSubscriptions(h).length
    const response = await viewer
      .post(url())
      .set('X-Admin-Reason', REASON)
      .send(body)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN_ROLE')
    expect(spaSubscriptions(h)).toHaveLength(before)
  })

  it('sem X-Admin-Reason: 400 REASON_REQUIRED e nada é escrito', async () => {
    const { h, dev, url } = await boot()
    const before = spaSubscriptions(h).length
    const response = await dev.post(url()).send(body)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('REASON_REQUIRED')
    expect(spaSubscriptions(h)).toHaveLength(before)
  })

  it('bonificação sem approvedBy: 400 de validação; campo desconhecido: 400', async () => {
    const { dev, url } = await boot()
    const noApprover = await dev
      .post(url())
      .set('X-Admin-Reason', REASON)
      .send({ ...body, kind: 'bonus' })
    expect(noApprover.status).toBe(400)
    expect(noApprover.body.error.code).toBe('VALIDATION_ERROR')

    const extra = await dev
      .post(url())
      .set('X-Admin-Reason', REASON)
      .send({ ...body, status: 'active' })
    expect(extra.status).toBe(400)
    expect(extra.body.error.code).toBe('VALIDATION_ERROR')

    const bonus = await dev
      .post(url())
      .set('X-Admin-Reason', REASON)
      .send({ ...body, kind: 'bonus', approvedBy: 'Maria (financeiro)' })
    expect(bonus.status).toBe(201)
  })

  it('segunda criação na mesma instalação: 409 SUBSCRIPTION_ALREADY_EXISTS com details', async () => {
    const { dev, url } = await boot()
    const first = await dev.post(url()).set('X-Admin-Reason', REASON).send(body)
    const second = await dev
      .post(url())
      .set('X-Admin-Reason', REASON)
      .send(body)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('SUBSCRIPTION_ALREADY_EXISTS')
    expect(second.body.error.details).toEqual({
      subscriptionId: first.body.subscriptionId,
      modality: 'manual',
      status: 'active',
    })
  })

  it('homologação: 409 SUBSCRIPTIONS_READ_ONLY', async () => {
    const { dev, url } = await boot({ PLATFORM_ENVIRONMENT: 'homolog' })
    const response = await dev
      .post(url())
      .set('X-Admin-Reason', REASON)
      .send(body)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('SUBSCRIPTIONS_READ_ONLY')
  })

  it('instalação inexistente ou id não numérico: 404 INSTALLATION_NOT_FOUND', async () => {
    const { dev, url } = await boot()
    for (const id of ['987654', 'abc']) {
      const response = await dev
        .post(`/admin/installations/${id}/subscriptions`)
        .set('X-Admin-Reason', REASON)
        .send(body)
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('INSTALLATION_NOT_FOUND')
    }
    expect(url()).toContain('/subscriptions')
  })

  it('a linha do tempo da instalação mostra a ação', async () => {
    const { dev, url, installationId } = await boot()
    await dev.post(url()).set('X-Admin-Reason', REASON).send(body).expect(201)
    await flush()
    const timeline = await dev
      .get(`/admin/installations/${installationId}/timeline?kind=admin_action`)
      .expect(200)
    expect(
      timeline.body.items.map(
        (item: { data: { action: string } }) => item.data.action,
      ),
    ).toContain('POST /admin/installations/:id/subscriptions')
  })
})
