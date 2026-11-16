import { describe, expect, it } from 'vitest'
import { createHarness, GPTMAKER, seedGptMaker } from '@/test/harness'
import type { EventType } from './domain/event'
import {
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
} from './webhook-endpoints'

const base = {
  name: 'ERP',
  url: 'https://erp.example.com/hooks',
  eventTypes: ['subscription.renewed', 'subscription.past_due'] as EventType[],
  appCodes: [] as string[],
}

async function setup() {
  const h = createHarness()
  await seedGptMaker(h)
  return { h, service: h.container.webhookEndpoints }
}

const rejectsWith = (
  promise: Promise<unknown>,
  status: number,
  code?: string,
) => expect(promise).rejects.toMatchObject(code ? { status, code } : { status })

describe('WebhookEndpoints: criação e listagem', () => {
  it('criar devolve o segredo uma vez e o guarda cifrado', async () => {
    const { h, service } = await setup()
    const { endpoint, secret } = await service.create(base)

    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    expect(endpoint).toMatchObject({
      name: 'ERP',
      url: base.url,
      eventTypes: base.eventTypes,
      appCodes: [],
      active: true,
    })
    const row = h.db.rows('webhookEndpoint')[0]!
    expect(row.secretEnc).not.toBe(secret)
    expect(h.container.cipher.decrypt(row.secretEnc)).toBe(secret)
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(JSON.stringify(endpoint)).not.toContain(secret)
  })

  it('listar nunca mostra segredo, em ordem de criação', async () => {
    const { service } = await setup()
    const first = await service.create(base)
    const second = await service.create({ ...base, name: 'Financeiro' })

    const list = await service.list()
    expect(list.map(item => item.name)).toEqual(['ERP', 'Financeiro'])
    const text = JSON.stringify(list)
    expect(text).not.toContain(first.secret)
    expect(text).not.toContain(second.secret)
    expect(text).not.toContain('secretEnc')
  })

  it('app inexistente: 400 WEBHOOK_APP_UNKNOWN; app existente passa', async () => {
    const { service } = await setup()
    await rejectsWith(
      service.create({ ...base, appCodes: ['nao.existe'] }),
      400,
      'WEBHOOK_APP_UNKNOWN',
    )
    await expect(
      service.create({ ...base, appCodes: [GPTMAKER] }),
    ).resolves.toMatchObject({ endpoint: { appCodes: [GPTMAKER] } })
  })
})

describe('WebhookEndpoints: URL permitida', () => {
  it.each([
    ['sem HTTPS', 'http://erp.example.com/hook'],
    ['localhost', 'https://localhost/hook'],
    ['loopback IPv4', 'https://127.0.0.1/hook'],
    ['rede 10/8', 'https://10.0.0.5/hook'],
    ['rede 172.16/12 (início)', 'https://172.16.0.1/hook'],
    ['rede 172.16/12 (fim)', 'https://172.31.255.1/hook'],
    ['rede 192.168/16', 'https://192.168.1.1/hook'],
    ['link-local (metadados da nuvem)', 'https://169.254.169.254/latest'],
    ['0.0.0.0', 'https://0.0.0.0/hook'],
    ['loopback IPv6', 'https://[::1]/hook'],
    ['IPv6 privado (fc00::/7)', 'https://[fc00::1]/hook'],
    ['IPv6 link-local', 'https://[fe80::1]/hook'],
    ['com usuário e senha', 'https://user:senha@erp.example.com/hook'],
    ['não é URL', 'isto nao e uma url'],
    ['mais de 500 caracteres', `https://erp.example.com/${'a'.repeat(500)}`],
  ])('recusa %s: 422 WEBHOOK_URL_NOT_ALLOWED', async (_name, url) => {
    const { h, service } = await setup()
    await rejectsWith(
      service.create({ ...base, url }),
      422,
      'WEBHOOK_URL_NOT_ALLOWED',
    )
    expect(h.db.rows('webhookEndpoint')).toHaveLength(0)
  })

  it.each([
    'https://erp.example.com/hooks',
    'https://8.8.8.8/hook',
    'https://172.32.0.1/hook',
    'https://erp.example.com:8443/a?b=1',
  ])('aceita %s', async url => {
    const { service } = await setup()
    await expect(service.create({ ...base, url })).resolves.toBeDefined()
  })
})

describe('schemas', () => {
  it('criação: tipo desconhecido, sem tipos, nome vazio e campo extra são recusados', () => {
    const ok = createWebhookEndpointSchema.safeParse(base)
    expect(ok.success).toBe(true)
    for (const bad of [
      { ...base, eventTypes: ['subscription.renovada'] },
      { ...base, eventTypes: [] },
      { ...base, name: '  ' },
      { ...base, extra: 1 },
    ]) {
      expect(createWebhookEndpointSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('criação: apps ausentes valem "todos"; tipos repetidos são deduplicados', () => {
    const parsed = createWebhookEndpointSchema.parse({
      name: 'ERP',
      url: base.url,
      eventTypes: ['subscription.renewed', 'subscription.renewed'],
    })
    expect(parsed.appCodes).toEqual([])
    expect(parsed.eventTypes).toEqual(['subscription.renewed'])
  })

  it('edição: exige ao menos um campo e recusa campo desconhecido', () => {
    expect(updateWebhookEndpointSchema.safeParse({}).success).toBe(false)
    expect(
      updateWebhookEndpointSchema.safeParse({ active: false }).success,
    ).toBe(true)
    expect(updateWebhookEndpointSchema.safeParse({ secret: 'x' }).success).toBe(
      false,
    )
  })
})

describe('WebhookEndpoints: alterações', () => {
  it('editar nome, filtros e URL; a URL nova também é validada', async () => {
    const { service } = await setup()
    const { endpoint } = await service.create(base)

    const updated = await service.update(endpoint.id, {
      name: 'ERP novo',
      eventTypes: ['charge.refunded'],
      appCodes: [GPTMAKER],
      url: 'https://erp2.example.com/h',
    })
    expect(updated).toMatchObject({
      name: 'ERP novo',
      eventTypes: ['charge.refunded'],
      appCodes: [GPTMAKER],
      url: 'https://erp2.example.com/h',
    })
    await rejectsWith(
      service.update(endpoint.id, { url: 'http://erp.example.com' }),
      422,
      'WEBHOOK_URL_NOT_ALLOWED',
    )
    await rejectsWith(
      service.update(endpoint.id, { appCodes: ['nao.existe'] }),
      400,
      'WEBHOOK_APP_UNKNOWN',
    )
  })

  it('desativar e reativar', async () => {
    const { service } = await setup()
    const { endpoint } = await service.create(base)
    expect((await service.update(endpoint.id, { active: false })).active).toBe(
      false,
    )
    expect((await service.update(endpoint.id, { active: true })).active).toBe(
      true,
    )
  })

  it('inexistente: 404 WEBHOOK_ENDPOINT_NOT_FOUND', async () => {
    const { service } = await setup()
    for (const call of [
      service.get(999),
      service.update(999, { active: false }),
      service.rotateSecret(999),
    ])
      await rejectsWith(call, 404, 'WEBHOOK_ENDPOINT_NOT_FOUND')
  })
})

describe('WebhookEndpoints: segredo e rotação', () => {
  it('secrets() devolve só o atual quando não houve rotação', async () => {
    const { service } = await setup()
    const { endpoint, secret } = await service.create(base)
    expect(await service.secrets(endpoint.id)).toEqual([secret])
  })

  it('rotacionar devolve outro segredo uma vez e mantém o anterior até o fim da convivência', async () => {
    const { h, service } = await setup()
    const { endpoint, secret: old } = await service.create(base)

    const rotated = await service.rotateSecret(endpoint.id)

    expect(rotated.secret).toMatch(/^whsec_/)
    expect(rotated.secret).not.toBe(old)
    expect(rotated.previousValidUntil.getTime()).toBeGreaterThan(
      h.clock.now().getTime(),
    )
    expect(await service.secrets(endpoint.id)).toEqual([rotated.secret, old])
    expect(JSON.stringify(h.db.rows('webhookEndpoint'))).not.toContain(
      rotated.secret,
    )

    h.clock.advance(
      rotated.previousValidUntil.getTime() - h.clock.now().getTime() + 1,
    )
    expect(await service.secrets(endpoint.id)).toEqual([rotated.secret])
  })
})
