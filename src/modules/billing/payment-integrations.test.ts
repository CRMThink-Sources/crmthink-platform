import { describe, expect, it } from 'vitest'
import { hashApiKey } from '@/shared/crypto/api-key'
import { createHarness } from '@/test/harness'

function setup() {
  const h = createHarness()
  return { h, service: h.container.paymentIntegrations }
}

const rejectsWith = (
  promise: Promise<unknown>,
  status: number,
  code?: string,
) => expect(promise).rejects.toMatchObject(code ? { status, code } : { status })

describe('PaymentIntegrations: criação e listagem', () => {
  it('criar devolve a chave uma vez e guarda só o hash', async () => {
    const { h, service } = setup()
    const { integration, apiKey } = await service.create('Banco X')

    expect(apiKey).toMatch(/^pay_[A-Za-z0-9_-]{43}$/)
    expect(integration).toMatchObject({
      name: 'Banco X',
      keyPrefix: apiKey.slice(0, 8),
      active: true,
      lastUsedAt: null,
    })
    const row = h.db.rows('paymentIntegration')[0]!
    expect(row.keyHash).toBe(hashApiKey(apiKey))
    expect(JSON.stringify(row)).not.toContain(apiKey)
    expect(JSON.stringify(integration)).not.toContain(apiKey)
    expect(integration).not.toHaveProperty('keyHash')
  })

  it('listar mostra só o prefixo, em ordem de criação', async () => {
    const { service } = setup()
    const first = await service.create('Banco X')
    const second = await service.create('  Cobrança Y  ')

    const list = await service.list()
    expect(list.map(item => item.name)).toEqual(['Banco X', 'Cobrança Y'])
    expect(list[0]!.keyPrefix).toBe(first.apiKey.slice(0, 8))
    expect(list[1]!.keyPrefix).toBe(second.apiKey.slice(0, 8))
    const text = JSON.stringify(list)
    expect(text).not.toContain(first.apiKey)
    expect(text).not.toContain(second.apiKey)
    expect(text).not.toContain('keyHash')
  })
})

describe('PaymentIntegrations: autenticação', () => {
  it('chave válida identifica a integração e registra o último uso', async () => {
    const { h, service } = setup()
    const { integration, apiKey } = await service.create('Banco X')
    h.clock.advance(5 * 60_000)

    const found = await service.authenticate(apiKey)
    expect(found.id).toBe(integration.id)
    expect(found.lastUsedAt).toEqual(h.clock.now())
    expect((await service.list())[0]!.lastUsedAt).toEqual(h.clock.now())
  })

  it('chave desconhecida ou vazia: 401', async () => {
    const { service } = setup()
    await service.create('Banco X')
    await rejectsWith(service.authenticate('pay_desconhecida'), 401)
    await rejectsWith(service.authenticate(''), 401)
  })

  it('a chave de um app não autentica uma integração', async () => {
    const { service } = setup()
    await service.create('Banco X')
    await rejectsWith(service.authenticate('cp_' + 'a'.repeat(43)), 401)
  })

  it('integração desativada: 403 INTEGRATION_INACTIVE; reativada volta a valer', async () => {
    const { service } = setup()
    const { integration, apiKey } = await service.create('Banco X')

    await service.update(integration.id, { active: false })
    await rejectsWith(service.authenticate(apiKey), 403, 'INTEGRATION_INACTIVE')

    await service.update(integration.id, { active: true })
    await expect(service.authenticate(apiKey)).resolves.toMatchObject({
      id: integration.id,
    })
  })
})

describe('PaymentIntegrations: alterações', () => {
  it('renomear não mexe na chave nem no estado', async () => {
    const { service } = setup()
    const { integration, apiKey } = await service.create('Banco X')
    const renamed = await service.update(integration.id, { name: 'Banco Z' })
    expect(renamed).toMatchObject({
      name: 'Banco Z',
      active: true,
      keyPrefix: integration.keyPrefix,
    })
    await expect(service.authenticate(apiKey)).resolves.toBeDefined()
  })

  it('rotacionar devolve outra chave uma vez e invalida a antiga na hora', async () => {
    const { h, service } = setup()
    const { integration, apiKey: old } = await service.create('Banco X')

    const rotated = await service.rotateKey(integration.id)
    expect(rotated.apiKey).not.toBe(old)
    expect(rotated.apiKey).toMatch(/^pay_/)
    expect(rotated.integration.keyPrefix).toBe(rotated.apiKey.slice(0, 8))
    expect(h.db.rows('paymentIntegration')[0]!.keyHash).toBe(
      hashApiKey(rotated.apiKey),
    )
    expect(JSON.stringify(h.db.rows('paymentIntegration'))).not.toContain(
      rotated.apiKey,
    )

    await rejectsWith(service.authenticate(old), 401)
    await expect(service.authenticate(rotated.apiKey)).resolves.toMatchObject({
      id: integration.id,
    })
  })

  it('integração inexistente: 404 PAYMENT_INTEGRATION_NOT_FOUND', async () => {
    const { service } = setup()
    await rejectsWith(
      service.update(999, { active: false }),
      404,
      'PAYMENT_INTEGRATION_NOT_FOUND',
    )
    await rejectsWith(
      service.rotateKey(999),
      404,
      'PAYMENT_INTEGRATION_NOT_FOUND',
    )
  })
})
