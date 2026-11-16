import { describe, expect, it } from 'vitest'
import { appendEvent } from '@/modules/events/outbox'
import { http } from '@/test/app'
import { GPTMAKER, seedGptMaker } from '@/test/harness'
import { audit, login, operator, ORIGIN, setup } from './test-support'

const REASON = 'integracao do erp combinada com o financeiro'
const BASE = '/admin/webhook-endpoints'

const body = {
  name: 'ERP',
  url: 'https://erp.example.com/hooks',
  eventTypes: ['subscription.renewed', 'subscription.past_due'],
}

async function boot() {
  const h = setup({ PLATFORM_ENVIRONMENT: 'production' })
  await seedGptMaker(h)
  const dev = await login(h, await operator(h, 'dev@x.test', 'operator'))
  const viewer = await login(h, await operator(h, 'ver@x.test', 'viewer'))
  const as = (cookie: string) => ({
    get: (path: string) => http(h).get(path).set('Cookie', cookie),
    post: (path: string) =>
      http(h).post(path).set('Cookie', cookie).set('Origin', ORIGIN),
    patch: (path: string) =>
      http(h).patch(path).set('Cookie', cookie).set('Origin', ORIGIN),
  })
  const emit = (installationId = 7) =>
    h.db.asDb().$transaction(tx =>
      appendEvent(tx, {
        appCode: GPTMAKER,
        type: 'subscription.renewed',
        installationId,
        memberId: 'member-abc',
        subscription: null,
      }),
    )
  return { h, dev: as(dev), viewer: as(viewer), emit }
}

type Dev = Awaited<ReturnType<typeof boot>>['dev']

async function create(dev: Dev, overrides: Record<string, unknown> = {}) {
  const response = await dev
    .post(BASE)
    .set('X-Admin-Reason', REASON)
    .send({ ...body, ...overrides })
  expect(response.status).toBe(201)
  return response.body as {
    endpoint: { id: number }
    secret: string
    notice: string
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('POST /admin/webhook-endpoints', () => {
  it('operator cria; o segredo vem uma vez, sem cache; a auditoria tem alvo, motivo e não tem o segredo', async () => {
    const { h, dev } = await boot()
    const response = await dev
      .post(BASE)
      .set('X-Admin-Reason', REASON)
      .send(body)

    expect(response.status).toBe(201)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.body.secret).toMatch(/^whsec_/)
    expect(response.body.endpoint).toMatchObject({
      name: 'ERP',
      url: body.url,
      eventTypes: body.eventTypes,
      appCodes: [],
      active: true,
    })
    expect(JSON.stringify(response.body.endpoint)).not.toContain(
      response.body.secret,
    )

    await flush()
    const row = audit(h).find(r => r.action === `POST ${BASE}`)!
    expect(row).toMatchObject({
      targetType: 'webhook_endpoint',
      targetId: String(response.body.endpoint.id),
      statusCode: 201,
    })
    expect(row.summary.reason).toBe(REASON)
    expect(JSON.stringify(audit(h))).not.toContain(response.body.secret)
  })

  it('sem motivo: 400 REASON_REQUIRED', async () => {
    const { dev } = await boot()
    const response = await dev.post(BASE).send(body)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('REASON_REQUIRED')
  })

  it('corpo inválido: tipo desconhecido, sem tipos, campo extra ⇒ 400; URL sem HTTPS ⇒ 422; app desconhecido ⇒ 400', async () => {
    const { dev } = await boot()
    const post = (overrides: Record<string, unknown>) =>
      dev
        .post(BASE)
        .set('X-Admin-Reason', REASON)
        .send({ ...body, ...overrides })

    for (const bad of [
      { eventTypes: ['subscription.renovada'] },
      { eventTypes: [] },
      { secret: 'x' },
    ]) {
      const response = await post(bad)
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }
    const url = await post({ url: 'http://erp.example.com/hooks' })
    expect(url.status).toBe(422)
    expect(url.body.error.code).toBe('WEBHOOK_URL_NOT_ALLOWED')
    const app = await post({ appCodes: ['nao.existe'] })
    expect(app.status).toBe(400)
    expect(app.body.error.code).toBe('WEBHOOK_APP_UNKNOWN')
  })
})

describe('GET /admin/webhook-endpoints', () => {
  it('viewer lê a lista com as contagens, sem segredo', async () => {
    const { h, dev, viewer, emit } = await boot()
    const { endpoint, secret } = await create(dev)
    await emit()
    await emit()
    h.db.rows('webhookDelivery')[0]!.status = 'dead'

    const response = await viewer.get(BASE)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0]).toMatchObject({
      id: endpoint.id,
      name: 'ERP',
      pendingDeliveries: 1,
      deadDeliveries: 1,
    })
    expect(JSON.stringify(response.body)).not.toContain(secret)
    expect(JSON.stringify(response.body)).not.toContain('secretEnc')
  })
})

describe('PATCH e rotate-secret', () => {
  it('renomear, mudar filtros e reativar não exigem motivo; desativar exige', async () => {
    const { dev } = await boot()
    const { endpoint } = await create(dev)
    const url = `${BASE}/${endpoint.id}`

    const edit = await dev.patch(url).send({
      name: 'ERP novo',
      eventTypes: ['charge.refunded'],
      appCodes: [GPTMAKER],
    })
    expect(edit.status).toBe(200)
    expect(edit.body).toMatchObject({
      name: 'ERP novo',
      eventTypes: ['charge.refunded'],
      appCodes: [GPTMAKER],
    })

    const noReason = await dev.patch(url).send({ active: false })
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.code).toBe('REASON_REQUIRED')

    const off = await dev
      .patch(url)
      .set('X-Admin-Reason', REASON)
      .send({ active: false })
    expect(off.body.active).toBe(false)
    const on = await dev.patch(url).send({ active: true })
    expect(on.body.active).toBe(true)
  })

  it('corpo vazio ou com campo desconhecido: 400; URL nova sem HTTPS: 422', async () => {
    const { dev } = await boot()
    const { endpoint } = await create(dev)
    for (const bad of [{}, { secretEnc: 'x' }]) {
      const response = await dev.patch(`${BASE}/${endpoint.id}`).send(bad)
      expect(response.status).toBe(400)
    }
    const url = await dev
      .patch(`${BASE}/${endpoint.id}`)
      .send({ url: 'http://x.example.com' })
    expect(url.status).toBe(422)
  })

  it('rotacionar exige motivo e devolve outro segredo uma vez, sem cache', async () => {
    const { h, dev } = await boot()
    const { endpoint, secret: old } = await create(dev)
    const url = `${BASE}/${endpoint.id}/rotate-secret`

    const noReason = await dev.post(url)
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.code).toBe('REASON_REQUIRED')

    const rotated = await dev.post(url).set('X-Admin-Reason', REASON)
    expect(rotated.status).toBe(200)
    expect(rotated.headers['cache-control']).toContain('no-store')
    expect(rotated.body.secret).toMatch(/^whsec_/)
    expect(rotated.body.secret).not.toBe(old)
    expect(rotated.body.previousValidUntil).toEqual(expect.any(String))
    expect(await h.container.webhookEndpoints.secrets(endpoint.id)).toEqual([
      rotated.body.secret,
      old,
    ])

    await flush()
    expect(JSON.stringify(audit(h))).not.toContain(rotated.body.secret)
  })

  it('inexistente ou id não numérico: 404 WEBHOOK_ENDPOINT_NOT_FOUND', async () => {
    const { dev, viewer } = await boot()
    for (const id of ['999', 'abc']) {
      const patch = await dev.patch(`${BASE}/${id}`).send({ name: 'X' })
      expect(patch.status).toBe(404)
      expect(patch.body.error.code).toBe('WEBHOOK_ENDPOINT_NOT_FOUND')
      const rotate = await dev
        .post(`${BASE}/${id}/rotate-secret`)
        .set('X-Admin-Reason', REASON)
      expect(rotate.status).toBe(404)
      const deliveries = await viewer.get(`${BASE}/${id}/deliveries`)
      expect(deliveries.status).toBe(404)
      expect(deliveries.body.error.code).toBe('WEBHOOK_ENDPOINT_NOT_FOUND')
    }
  })
})

describe('GET /admin/webhook-endpoints/:id/deliveries', () => {
  it('lista da mais recente para a mais antiga, com cursor, filtro por estado e as tentativas, sem o corpo do evento', async () => {
    const { h, dev, viewer, emit } = await boot()
    const { endpoint } = await create(dev)
    for (let i = 0; i < 3; i++) await emit()
    const rows = h.db.rows('webhookDelivery')
    rows[0]!.status = 'dead'
    rows[0]!.attempts = 2
    h.db.rows('webhookDeliveryAttempt').push(
      {
        id: 1,
        deliveryId: rows[0]!.id,
        attempt: 1,
        statusCode: 503,
        error: 'HTTP 503',
        nextAttemptAt: null,
        deliveredAt: null,
        createdAt: h.clock.now(),
      },
      {
        id: 2,
        deliveryId: rows[0]!.id,
        attempt: 2,
        statusCode: null,
        error: 'timeout',
        nextAttemptAt: null,
        deliveredAt: null,
        createdAt: h.clock.now(),
      },
    )
    const url = `${BASE}/${endpoint.id}/deliveries`

    const first = await viewer.get(`${url}?limit=2`)
    expect(first.status).toBe(200)
    expect(first.body.items.map((i: { id: number }) => i.id)).toEqual([
      rows[2]!.id,
      rows[1]!.id,
    ])
    expect(first.body.nextCursor).toEqual(expect.any(String))
    const second = await viewer.get(
      `${url}?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )
    expect(second.body.items.map((i: { id: number }) => i.id)).toEqual([
      rows[0]!.id,
    ])
    expect(second.body.nextCursor).toBeNull()

    const dead = await viewer.get(`${url}?status=dead`)
    expect(dead.body.items).toHaveLength(1)
    expect(dead.body.items[0]).toMatchObject({
      eventType: 'subscription.renewed',
      installationId: 7,
      appCode: GPTMAKER,
      status: 'dead',
      attempts: 2,
    })
    expect(
      dead.body.items[0].attemptLog.map(
        (a: { attempt: number; error: string }) => [a.attempt, a.error],
      ),
    ).toEqual([
      [2, 'timeout'],
      [1, 'HTTP 503'],
    ])
    expect(JSON.stringify(dead.body)).not.toContain('member-abc')

    const bad = await viewer.get(`${url}?status=xyz`)
    expect(bad.status).toBe(400)
  })
})

describe('reenvio', () => {
  it('uma entrega: sem motivo, volta a pending; inexistente: 404 WEBHOOK_DELIVERY_NOT_FOUND', async () => {
    const { h, dev, emit } = await boot()
    await create(dev)
    await emit()
    const delivery = h.db.rows('webhookDelivery')[0]!
    delivery.status = 'dead'

    const response = await dev.post(
      `/admin/webhook-deliveries/${delivery.id}/resend`,
    )
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: delivery.id, status: 'pending' })
    expect(delivery.status).toBe('pending')

    const missing = await dev.post('/admin/webhook-deliveries/999/resend')
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('WEBHOOK_DELIVERY_NOT_FOUND')
  })

  it('mortas do destinatário: dryRun conta sem motivo; de verdade exige motivo', async () => {
    const { h, dev, emit } = await boot()
    const { endpoint } = await create(dev)
    for (let i = 0; i < 2; i++) await emit()
    for (const row of h.db.rows('webhookDelivery')) row.status = 'dead'
    const url = `${BASE}/${endpoint.id}/resend-dead`

    const preview = await dev.post(url).send({ dryRun: true })
    expect(preview.status).toBe(200)
    expect(preview.body).toEqual({ matched: 2, requeued: 0 })

    const noReason = await dev.post(url).send({})
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.code).toBe('REASON_REQUIRED')

    const real = await dev.post(url).set('X-Admin-Reason', REASON).send({})
    expect(real.status).toBe(200)
    expect(real.body).toEqual({ matched: 2, requeued: 2 })
    expect(
      h.db.rows('webhookDelivery').every(r => r.status === 'pending'),
    ).toBe(true)

    const missing = await dev
      .post(`${BASE}/999/resend-dead`)
      .set('X-Admin-Reason', REASON)
      .send({})
    expect(missing.status).toBe(404)
  })
})

describe('papéis e auditoria', () => {
  it('viewer não escreve: 403 FORBIDDEN_ROLE', async () => {
    const { h, dev, viewer, emit } = await boot()
    const { endpoint } = await create(dev)
    await emit()
    const deliveryId = h.db.rows('webhookDelivery')[0]!.id
    const attempts = [
      viewer.post(BASE).set('X-Admin-Reason', REASON).send(body),
      viewer.patch(`${BASE}/${endpoint.id}`).send({ name: 'Y' }),
      viewer
        .post(`${BASE}/${endpoint.id}/rotate-secret`)
        .set('X-Admin-Reason', REASON),
      viewer.post(`${BASE}/${endpoint.id}/resend-dead`).send({ dryRun: true }),
      viewer.post(`/admin/webhook-deliveries/${deliveryId}/resend`),
    ]
    for (const attempt of attempts) {
      const response = await attempt
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN_ROLE')
    }
  })

  it('o reenvio é auditado com alvo webhook_delivery e o do lote com alvo webhook_endpoint', async () => {
    const { h, dev, emit } = await boot()
    const { endpoint } = await create(dev)
    await emit()
    const deliveryId = h.db.rows('webhookDelivery')[0]!.id
    await dev.post(`/admin/webhook-deliveries/${deliveryId}/resend`).expect(200)
    await dev
      .post(`${BASE}/${endpoint.id}/resend-dead`)
      .set('X-Admin-Reason', REASON)
      .send({})
      .expect(200)

    await flush()
    expect(
      audit(h).find(
        r => r.action === 'POST /admin/webhook-deliveries/:id/resend',
      ),
    ).toMatchObject({
      targetType: 'webhook_delivery',
      targetId: String(deliveryId),
    })
    expect(
      audit(h).find(r => r.action === `POST ${BASE}/:id/resend-dead`),
    ).toMatchObject({
      targetType: 'webhook_endpoint',
      targetId: String(endpoint.id),
    })
  })
})
