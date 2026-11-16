import { describe, expect, it } from 'vitest'
import {
  audit,
  login,
  operator,
  ORIGIN,
  setup,
} from '@/modules/backoffice/test-support'
import { http } from '@/test/app'

const REASON = 'integracao com o banco combinada com o financeiro'
const BASE = '/admin/payment-integrations'

async function boot() {
  const h = setup({ PLATFORM_ENVIRONMENT: 'production' })
  const dev = await login(h, await operator(h, 'dev@x.test', 'operator'))
  const viewer = await login(h, await operator(h, 'ver@x.test', 'viewer'))
  const as = (cookie: string) => ({
    get: (path: string) => http(h).get(path).set('Cookie', cookie),
    post: (path: string) =>
      http(h).post(path).set('Cookie', cookie).set('Origin', ORIGIN),
    patch: (path: string) =>
      http(h).patch(path).set('Cookie', cookie).set('Origin', ORIGIN),
  })
  return { h, dev: as(dev), viewer: as(viewer) }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

async function create(
  dev: Awaited<ReturnType<typeof boot>>['dev'],
  name = 'Banco X',
) {
  const response = await dev
    .post(BASE)
    .set('X-Admin-Reason', REASON)
    .send({ name })
  expect(response.status).toBe(201)
  return response.body as {
    integration: {
      id: number
      name: string
      keyPrefix: string
      active: boolean
    }
    apiKey: string
  }
}

describe('POST /admin/payment-integrations', () => {
  it('operator cria e recebe a chave uma vez; a auditoria tem alvo payment_integration, motivo e não tem a chave', async () => {
    const { h, dev } = await boot()
    const response = await dev
      .post(BASE)
      .set('X-Admin-Reason', REASON)
      .send({ name: 'Banco X' })

    expect(response.status).toBe(201)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.body.apiKey).toMatch(/^pay_/)
    expect(response.body.integration).toMatchObject({
      name: 'Banco X',
      active: true,
      keyPrefix: response.body.apiKey.slice(0, 8),
      lastUsedAt: null,
    })
    expect(response.body.integration.createdAt).toEqual(expect.any(String))
    expect(JSON.stringify(response.body.integration)).not.toContain(
      response.body.apiKey,
    )

    await flush()
    const row = audit(h).find(r => r.action === `POST ${BASE}`)!
    expect(row).toMatchObject({
      targetType: 'payment_integration',
      targetId: String(response.body.integration.id),
      statusCode: 201,
    })
    expect(row.summary.reason).toBe(REASON)
    expect(JSON.stringify(audit(h))).not.toContain(response.body.apiKey)
  })

  it('sem motivo: 400 REASON_REQUIRED; nome vazio, longo ou campo desconhecido: 400', async () => {
    const { dev } = await boot()
    const noReason = await dev.post(BASE).send({ name: 'Banco X' })
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.code).toBe('REASON_REQUIRED')

    for (const body of [
      { name: '  ' },
      { name: 'x'.repeat(201) },
      { name: 'Banco X', active: false },
      {},
    ]) {
      const response = await dev
        .post(BASE)
        .set('X-Admin-Reason', REASON)
        .send(body)
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }
  })
})

describe('GET /admin/payment-integrations', () => {
  it('viewer lê a lista só com o prefixo da chave', async () => {
    const { dev, viewer } = await boot()
    const first = await create(dev, 'Banco X')
    const second = await create(dev, 'Cobrança Y')

    const response = await viewer.get(BASE)
    expect(response.status).toBe(200)
    expect(
      response.body.items.map((item: { name: string }) => item.name),
    ).toEqual(['Banco X', 'Cobrança Y'])
    const text = JSON.stringify(response.body)
    expect(text).not.toContain(first.apiKey)
    expect(text).not.toContain(second.apiKey)
    expect(text).not.toContain('keyHash')
    expect(response.body.items[0].keyPrefix).toBe(first.apiKey.slice(0, 8))
  })
})

describe('PATCH e rotate-key', () => {
  it('renomear e reativar não exigem motivo; desativar exige', async () => {
    const { dev } = await boot()
    const { integration } = await create(dev)
    const url = `${BASE}/${integration.id}`

    const rename = await dev.patch(url).send({ name: 'Banco Z' })
    expect(rename.status).toBe(200)
    expect(rename.body).toMatchObject({ name: 'Banco Z', active: true })

    const noReason = await dev.patch(url).send({ active: false })
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.code).toBe('REASON_REQUIRED')

    const off = await dev
      .patch(url)
      .set('X-Admin-Reason', REASON)
      .send({ active: false })
    expect(off.status).toBe(200)
    expect(off.body.active).toBe(false)

    const on = await dev.patch(url).send({ active: true })
    expect(on.status).toBe(200)
    expect(on.body.active).toBe(true)
  })

  it('corpo vazio ou com campo desconhecido: 400', async () => {
    const { dev } = await boot()
    const { integration } = await create(dev)
    for (const body of [{}, { keyHash: 'x' }, { name: '' }]) {
      const response = await dev.patch(`${BASE}/${integration.id}`).send(body)
      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rotacionar exige motivo, devolve outra chave uma vez e invalida a antiga', async () => {
    const { h, dev } = await boot()
    const { integration, apiKey: old } = await create(dev)
    const url = `${BASE}/${integration.id}/rotate-key`

    const noReason = await dev.post(url)
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.code).toBe('REASON_REQUIRED')

    const rotated = await dev.post(url).set('X-Admin-Reason', REASON)
    expect(rotated.status).toBe(200)
    expect(rotated.headers['cache-control']).toContain('no-store')
    expect(rotated.body.apiKey).toMatch(/^pay_/)
    expect(rotated.body.apiKey).not.toBe(old)

    const service = h.container.paymentIntegrations
    await expect(service.authenticate(old)).rejects.toMatchObject({
      status: 401,
    })
    await expect(
      service.authenticate(rotated.body.apiKey),
    ).resolves.toMatchObject({ id: integration.id })

    await flush()
    const row = audit(h).find(
      r => r.action === `POST ${BASE}/:id/rotate-key` && r.statusCode === 200,
    )!
    expect(row).toMatchObject({
      targetType: 'payment_integration',
      targetId: String(integration.id),
      statusCode: 200,
    })
    expect(JSON.stringify(audit(h))).not.toContain(rotated.body.apiKey)
  })

  it('integração inexistente ou id não numérico: 404 PAYMENT_INTEGRATION_NOT_FOUND', async () => {
    const { dev } = await boot()
    for (const id of ['999', 'abc']) {
      const patch = await dev.patch(`${BASE}/${id}`).send({ name: 'Novo' })
      expect(patch.status).toBe(404)
      expect(patch.body.error.code).toBe('PAYMENT_INTEGRATION_NOT_FOUND')

      const rotate = await dev
        .post(`${BASE}/${id}/rotate-key`)
        .set('X-Admin-Reason', REASON)
      expect(rotate.status).toBe(404)
      expect(rotate.body.error.code).toBe('PAYMENT_INTEGRATION_NOT_FOUND')
    }
  })
})

describe('papéis', () => {
  it('viewer não escreve: 403 FORBIDDEN_ROLE', async () => {
    const { dev, viewer } = await boot()
    const { integration } = await create(dev)
    const attempts = [
      viewer.post(BASE).set('X-Admin-Reason', REASON).send({ name: 'Y' }),
      viewer.patch(`${BASE}/${integration.id}`).send({ name: 'Y' }),
      viewer
        .post(`${BASE}/${integration.id}/rotate-key`)
        .set('X-Admin-Reason', REASON),
    ]
    for (const attempt of attempts) {
      const response = await attempt
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN_ROLE')
    }
  })
})
