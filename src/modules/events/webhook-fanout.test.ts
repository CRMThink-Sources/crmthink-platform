import { describe, expect, it } from 'vitest'
import { createHarness, GPTMAKER, seedGptMaker } from '@/test/harness'
import type { EventType } from './domain/event'
import { appendEvent, type AppendEventInput } from './outbox'
import type { CreateWebhookEndpoint } from './webhook-endpoints'

const endpoint = (overrides: Partial<CreateWebhookEndpoint> = {}) =>
  ({
    name: 'ERP',
    url: 'https://erp.example.com/hooks',
    eventTypes: ['subscription.renewed'] as EventType[],
    appCodes: [],
    ...overrides,
  }) satisfies CreateWebhookEndpoint

async function setup() {
  const h = createHarness()
  await seedGptMaker(h)
  const emit = (input: Partial<AppendEventInput> = {}) =>
    h.db.asDb().$transaction(tx =>
      appendEvent(tx, {
        appCode: GPTMAKER,
        type: 'subscription.renewed',
        installationId: 7,
        memberId: 'member-abc',
        subscription: null,
        ...input,
      }),
    )
  const deliveries = () => h.db.rows('webhookDelivery')
  return { h, emit, deliveries, endpoints: h.container.webhookEndpoints }
}

describe('fan-out do outbox para destinatários', () => {
  it('cria uma entrega pendente por destinatário ativo interessado, com as colunas do evento', async () => {
    const { h, emit, deliveries, endpoints } = await setup()
    const erp = (await endpoints.create(endpoint())).endpoint
    const fin = (await endpoints.create(endpoint({ name: 'Financeiro' })))
      .endpoint

    const envelope = (await emit())!

    const rows = deliveries()
    expect(rows.map(r => r.endpointId).sort()).toEqual([erp.id, fin.id].sort())
    const event = h.db.rows('outboxEvent')[0]!
    for (const row of rows) {
      expect(row).toMatchObject({
        eventId: envelope.eventId,
        eventSeq: event.seq,
        installationId: 7,
        appCode: GPTMAKER,
        eventType: 'subscription.renewed',
        status: 'pending',
        attempts: 0,
      })
    }
  })

  it('filtra por tipo de evento', async () => {
    const { emit, deliveries, endpoints } = await setup()
    await endpoints.create(
      endpoint({ name: 'Só estornos', eventTypes: ['charge.refunded'] }),
    )
    const both = (
      await endpoints.create(
        endpoint({ eventTypes: ['charge.refunded', 'subscription.renewed'] }),
      )
    ).endpoint

    await emit()

    expect(deliveries().map(r => r.endpointId)).toEqual([both.id])
  })

  it('filtra por app; apps vazios valem todos', async () => {
    const { h, emit, deliveries, endpoints } = await setup()
    const all = (await endpoints.create(endpoint())).endpoint
    const mine = (
      await endpoints.create(endpoint({ name: 'GPT', appCodes: [GPTMAKER] }))
    ).endpoint
    // Outro app só para o filtro: o destinatário o cita, o evento é do GPTMaker.
    await h.container.registry.create({
      appCode: 'crmthink.outro',
      name: 'Outro',
      bitrixClientId: 'local.outro',
      bitrixClientSecret: 'secret-outro',
      scopes: ['crm'],
      installerUrl: 'https://outro.app/installer',
      webhookUrl: 'https://outro.app/events',
      productSpaIds: [10],
      trialDays: 0,
      trialOnInstall: false,
      active: true,
    })
    const other = (
      await endpoints.create(
        endpoint({ name: 'Outro', appCodes: ['crmthink.outro'] }),
      )
    ).endpoint

    await emit()

    const ids = deliveries().map(r => r.endpointId)
    expect(ids).toContain(all.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(other.id)
  })

  it('destinatário inativo não recebe entregas novas', async () => {
    const { emit, deliveries, endpoints } = await setup()
    const { endpoint: off } = await endpoints.create(endpoint())
    await endpoints.update(off.id, { active: false })
    await emit()
    expect(deliveries()).toHaveLength(0)
  })

  it('destinatário criado depois do evento não recebe o passado, só o que vier depois', async () => {
    const { emit, deliveries, endpoints } = await setup()
    await emit()
    const { endpoint: late } = await endpoints.create(endpoint())
    expect(deliveries()).toHaveLength(0)

    await emit({ dedupeKey: 'outra-decisao' })
    expect(deliveries().map(r => r.endpointId)).toEqual([late.id])
  })

  it('decisão repetida (mesma dedupeKey) não gera segunda entrega', async () => {
    const { h, emit, deliveries, endpoints } = await setup()
    await endpoints.create(endpoint())
    expect(await emit({ dedupeKey: 'renewed:1:2026-10-01' })).not.toBeNull()
    expect(await emit({ dedupeKey: 'renewed:1:2026-10-01' })).toBeNull()
    expect(deliveries()).toHaveLength(1)
    expect(h.db.rows('outboxEvent')).toHaveLength(1)
  })

  it('app inativo não gera evento nem entrega', async () => {
    const { h, emit, deliveries, endpoints } = await setup()
    await endpoints.create(endpoint())
    await h.container.registry.update(GPTMAKER, { active: false })
    expect(await emit()).toBeNull()
    expect(deliveries()).toHaveLength(0)
  })

  it('a entrega nasce na mesma transação do evento: se ela desfaz, nada fica', async () => {
    const { h, deliveries, endpoints } = await setup()
    await endpoints.create(endpoint())
    await expect(
      h.db.asDb().$transaction(async tx => {
        await appendEvent(tx, {
          appCode: GPTMAKER,
          type: 'subscription.renewed',
          installationId: 7,
          memberId: 'member-abc',
          subscription: null,
        })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(h.db.rows('outboxEvent')).toHaveLength(0)
    expect(deliveries()).toHaveLength(0)
  })

  it('o evento do app segue gravado normalmente, com ou sem destinatários', async () => {
    const { h, emit, endpoints } = await setup()
    await emit({ dedupeKey: 'sem-destinatario' })
    await endpoints.create(endpoint())
    await emit({ dedupeKey: 'com-destinatario' })
    expect(h.db.rows('outboxEvent').map(e => [e.dedupeKey, e.status])).toEqual([
      ['sem-destinatario', 'pending'],
      ['com-destinatario', 'pending'],
    ])
  })
})
