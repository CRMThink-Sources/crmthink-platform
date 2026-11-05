import { beforeEach, describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import {
  installedGptMaker,
  spaSubscriptions,
  stripeEvent,
  stripeSubscription,
} from '@/test/billing-helpers'
import { createHarness, GPTMAKER, outbox, type Harness } from '@/test/harness'
import { validateSpaConfig } from './infra/spa/spa-field-guards'
import {
  formatCalendarDate,
  toSpaCalendarDateValue,
} from './infra/spa/spa-calendar-date'

const day = 86_400_000

async function spaEvent(
  h: Harness,
  verb: 'ADD' | 'UPDATE' | 'DELETE',
  entityTypeId: number,
  id: number,
) {
  const res = await http(h)
    .post('/bitrix/spa-events')
    .type('form')
    .send({
      event: `ONCRMDYNAMICITEM${verb}`,
      'data[FIELDS][ID]': String(id),
      'data[FIELDS][ENTITY_TYPE_ID]': String(entityTypeId),
      'auth[application_token]': 'crm-app-token',
    })
  expect(res.status).toBe(200)
  await h.container.spaProcessor.process(h.queue.jobs.at(-1)!.data as any)
}

describe('itens de assinatura (SPA 1146)', () => {
  let h: Harness
  let apiKey: string
  let installationId: number
  let subscriptionId: number

  beforeEach(async () => {
    h = createHarness()
    ;({ apiKey, installationId } = await installedGptMaker(h))
    stripeSubscription(h, {
      id: 'sub_1',
      installationId,
      items: [{ itemId: 'si_1', priceId: 'price_basic', quantity: 0 }],
    })
    await stripeEvent(h, {
      type: 'checkout.completed',
      sessionId: 'cs',
      mode: 'subscription',
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 501,
        intent: 'subscribe',
      },
      gatewaySubscriptionId: 'sub_1',
      paymentIntentId: null,
      amountTotal: 0,
    })
    subscriptionId = spaSubscriptions(h).find(
      x => x[h.config.subscription.gatewayId] === 'sub_1',
    )!.id as number
  })

  const auth = () => ({ Authorization: `Bearer ${apiKey}` })
  const items = (h: Harness) => [...(h.crm.items.get(1146)?.values() ?? [])]

  it('item não cobrável: criado active, idempotente por externalRef, sem mexer no Stripe', async () => {
    const first = await http(h)
      .post(`/v1/subscriptions/${subscriptionId}/items`)
      .set(auth())
      .send({ externalRef: 'agent-1', title: 'Agente 1' })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      externalRef: 'agent-1',
      status: 'active',
      billable: false,
    })
    const again = await http(h)
      .post(`/v1/subscriptions/${subscriptionId}/items`)
      .set(auth())
      .send({ externalRef: 'agent-1', title: 'Agente 1' })
    expect(again.status).toBe(200)
    expect(again.body.itemId).toBe(first.body.itemId)
    expect(items(h)).toHaveLength(1)
    expect(items(h)[0]!.parentId1142).toBe(subscriptionId)
    expect(items(h)[0]![h.config.subscriptionItem.environment]).toBe('homolog')
    expect(h.gateway.quantities).toHaveLength(0)
  })

  it('remoção lógica: cancelled com data e autor', async () => {
    const created = await http(h)
      .post(`/v1/subscriptions/${subscriptionId}/items`)
      .set(auth())
      .send({ externalRef: 'agent-1', title: 'Agente 1' })
    const removed = await http(h)
      .delete(
        `/v1/subscriptions/${subscriptionId}/items/${created.body.itemId}`,
      )
      .set(auth())
    expect(removed.body.status).toBe('cancelled')
    expect(removed.body.deletedAt).toBeTruthy()
    expect(items(h)[0]![h.config.subscriptionItem.deletedBy]).toBe(
      `app:${GPTMAKER}`,
    )
  })

  it('itens cobráveis sincronizam a quantidade do Stripe', async () => {
    await http(h)
      .post(`/v1/subscriptions/${subscriptionId}/items`)
      .set(auth())
      .send({ externalRef: 'seat-1', title: 'Seat 1', billable: true })
    await http(h)
      .post(`/v1/subscriptions/${subscriptionId}/items`)
      .set(auth())
      .send({ externalRef: 'seat-2', title: 'Seat 2', billable: true })
    expect(h.gateway.quantities.map(q => q.quantity)).toEqual([1, 2])
    const seat = items(h).find(
      i => i[h.config.subscriptionItem.externalRef] === 'seat-1',
    )!
    await http(h)
      .patch(`/v1/subscriptions/${subscriptionId}/items/${seat.id}`)
      .set(auth())
      .send({ status: 'cancelled' })
    expect(h.gateway.quantities.at(-1)).toMatchObject({
      id: 'sub_1',
      priceId: 'price_basic',
      quantity: 1,
    })
  })

  it('suporte cancela item cobrável no CRM: evento ao app e quantidade reaplicada; eco da própria escrita ignorado', async () => {
    const created = await http(h)
      .post(`/v1/subscriptions/${subscriptionId}/items`)
      .set(auth())
      .send({ externalRef: 'seat-1', title: 'Seat 1', billable: true })
    // Eco da criação feita pela plataforma: nada.
    await spaEvent(h, 'ADD', 1146, created.body.itemId)
    expect(outbox(h).some(e => e.type === 'subscription.item_changed')).toBe(
      false,
    )

    await h.crm.updateItem(1146, created.body.itemId, {
      [h.config.subscriptionItem.status]: '13627',
    })
    await spaEvent(h, 'UPDATE', 1146, created.body.itemId)
    const changed = outbox(h).find(e => e.type === 'subscription.item_changed')!
    expect(changed.payload.data).toMatchObject({
      change: 'removed',
      item: { externalRef: 'seat-1', status: 'cancelled' },
    })
    expect(h.gateway.quantities.at(-1)!.quantity).toBe(0)
  })

  it('varredura: quantidade Stripe divergente reaplicada a partir do SPA', async () => {
    await http(h)
      .post(`/v1/subscriptions/${subscriptionId}/items`)
      .set(auth())
      .send({ externalRef: 'seat-1', title: 'Seat 1', billable: true })
    h.gateway.subscriptions.get('sub_1')!.items[0]!.quantity = 5 // editado no portal de faturamento
    const result = await h.container.sweeps.stripeSweep()
    expect(result.fixed).toBeGreaterThanOrEqual(1)
    expect(h.gateway.quantities.at(-1)!.quantity).toBe(1)
  })
})

describe('assinaturas manuais pelo SPA', () => {
  let h: Harness
  let installationId: number

  beforeEach(async () => {
    h = createHarness()
    ;({ installationId } = await installedGptMaker(h, {
      trialOnInstall: false,
    }))
  })

  const f = (h: Harness) => h.config.subscription

  function seedManual(overrides: Record<string, unknown> = {}) {
    const now = h.clock.now()
    return h.crm.seed(1142, {
      title: 'Contrato boleto',
      parentId1060: installationId,
      [f(h).plan]: 501,
      [f(h).status]: '13617',
      [f(h).modality]: 'manual',
      [f(h).periodStart]: toSpaCalendarDateValue(now),
      [f(h).periodEnd]: toSpaCalendarDateValue(
        new Date(now.getTime() + 30 * day),
      ),
      ...overrides,
    })
  }

  it('comercial cria assinatura manual sem Ambiente: produção processa... e homologação ignora', async () => {
    const item = seedManual()
    await spaEvent(h, 'ADD', 1142, item.id as number)
    // Esta instância é homolog: item sem ambiente = production ⇒ ignorado.
    expect(outbox(h)).toHaveLength(1) // só installation.created
  })

  describe('com Ambiente homolog', () => {
    it('ativação, renovação por extensão do período, inadimplência, recuperação e encerramento', async () => {
      const item = seedManual({ [f(h).environment]: 'homolog' })
      const id = item.id as number
      await spaEvent(h, 'ADD', 1142, id)
      expect(outbox(h).at(-1)!.type).toBe('subscription.activated')

      // Eco: mesmo estado ⇒ nada.
      await spaEvent(h, 'UPDATE', 1142, id)
      expect(
        outbox(h).filter(e => e.type.startsWith('subscription.')),
      ).toHaveLength(1)

      const extended = toSpaCalendarDateValue(
        new Date(h.clock.now().getTime() + 60 * day),
      )
      await h.crm.updateItem(1142, id, { [f(h).periodEnd]: extended })
      await spaEvent(h, 'UPDATE', 1142, id)
      expect(outbox(h).at(-1)!.type).toBe('subscription.renewed')

      await h.crm.updateItem(1142, id, { [f(h).status]: '13621' })
      await spaEvent(h, 'UPDATE', 1142, id)
      expect(outbox(h).at(-1)!.type).toBe('subscription.past_due')

      await h.crm.updateItem(1142, id, { [f(h).status]: '13617' })
      await spaEvent(h, 'UPDATE', 1142, id)
      expect(outbox(h).at(-1)!.type).toBe('subscription.recovered')

      const versions = outbox(h)
        .filter(e => e.payload.subscription)
        .map(e => e.payload.subscription.version)
      expect(versions).toEqual([...versions].sort((a, b) => a - b))
      expect(new Set(versions).size).toBe(versions.length)

      await h.crm.deleteItem(1142, id)
      await spaEvent(h, 'DELETE', 1142, id)
      const ended = outbox(h).at(-1)!
      expect(ended.type).toBe('subscription.ended')
      expect(ended.payload.data.reason).toBe('deleted')
    })

    it('aviso de fim de período (3/2/1) uma vez por marco; período estendido cancela o aviso seguinte; Stripe nunca avisa', async () => {
      const item = seedManual({
        [f(h).environment]: 'homolog',
        [f(h).periodEnd]: toSpaCalendarDateValue(
          new Date(h.clock.now().getTime() + 3 * day),
        ),
      })
      await spaEvent(h, 'ADD', 1142, item.id as number)

      expect(await h.container.periodEnding.run()).toBe(1)
      expect(await h.container.periodEnding.run()).toBe(0)
      expect(outbox(h).at(-1)!.payload.data.daysLeft).toBe(3)

      h.clock.advance(day)
      expect(await h.container.periodEnding.run()).toBe(1)
      expect(outbox(h).at(-1)!.payload.data.daysLeft).toBe(2)

      // Estendido antes do marco de 1 dia.
      await h.crm.updateItem(1142, item.id as number, {
        [f(h).periodEnd]: toSpaCalendarDateValue(
          new Date(h.clock.now().getTime() + 40 * day),
        ),
      })
      h.clock.advance(day)
      expect(await h.container.periodEnding.run()).toBe(0)

      const stripe = seedManual({
        [f(h).environment]: 'homolog',
        [f(h).modality]: 'stripe',
        [f(h).gatewayId]: 'sub_x',
        [f(h).periodEnd]: toSpaCalendarDateValue(
          new Date(h.clock.now().getTime() + 2 * day),
        ),
      })
      expect(stripe).toBeTruthy()
      expect(await h.container.periodEnding.run()).toBe(0)
    })

    it('varredura dos SPAs recupera evento perdido de extensão manual', async () => {
      const item = seedManual({ [f(h).environment]: 'homolog' })
      await spaEvent(h, 'ADD', 1142, item.id as number)
      await h.crm.updateItem(1142, item.id as number, {
        [f(h).periodEnd]: toSpaCalendarDateValue(
          new Date(h.clock.now().getTime() + 90 * day),
        ),
      })
      // Evento do SPA perdido; a varredura encontra.
      const result = await h.container.sweeps.spaSweep()
      expect(result.fixed).toBe(1)
      expect(outbox(h).at(-1)!.type).toBe('subscription.renewed')
      expect((await h.container.sweeps.spaSweep()).fixed).toBe(0)
    })
  })

  it('assinatura de homologação no serviço de produção é ignorada', async () => {
    const prod = createHarness({ env: { PLATFORM_ENVIRONMENT: 'production' } })
    const { installationId: id } = await installedGptMaker(prod, {
      trialOnInstall: false,
    })
    const c = prod.config.subscription
    const now = prod.clock.now()
    const item = prod.crm.seed(1142, {
      title: 'teste',
      parentId1060: id,
      [c.plan]: 501,
      [c.status]: '13617',
      [c.modality]: 'manual',
      [c.environment]: 'homolog',
      [c.periodStart]: toSpaCalendarDateValue(now),
      [c.periodEnd]: toSpaCalendarDateValue(new Date(now.getTime() + 30 * day)),
    })
    await spaEvent(prod, 'ADD', 1142, item.id as number)
    expect(outbox(prod).map(e => e.type)).toEqual(['installation.created'])
    // e o item 1060 criado pela produção leva Ambiente production
    expect(
      (await prod.crm.getItem(1060, id))![prod.config.installation.environment],
    ).toBe('production')
  })
})

describe('varredura Stripe ↔ SPA', () => {
  let h: Harness
  let installationId: number

  beforeEach(async () => {
    h = createHarness()
    ;({ installationId } = await installedGptMaker(h))
  })

  it('webhook de renovação perdido: SPA corrigido e subscription.renewed emitido', async () => {
    const state = stripeSubscription(h, { id: 'sub_1', installationId })
    await stripeEvent(h, {
      type: 'checkout.completed',
      sessionId: 'cs',
      mode: 'subscription',
      paid: true,
      metadata: state.metadata,
      gatewaySubscriptionId: 'sub_1',
      paymentIntentId: null,
      amountTotal: 9900,
    })
    state.periodStart = state.periodEnd
    state.periodEnd = new Date(state.periodEnd.getTime() + 30 * day)
    const result = await h.container.sweeps.stripeSweep()
    expect(result.fixed).toBe(1)
    const renewed = outbox(h).filter(e => e.type === 'subscription.renewed')
    expect(renewed).toHaveLength(1)
    const spa = spaSubscriptions(h).find(
      x => x[h.config.subscription.gatewayId] === 'sub_1',
    )!
    expect(String(spa[h.config.subscription.periodEnd]).slice(0, 10)).toBe(
      formatCalendarDate(state.periodEnd),
    )
    expect((await h.container.sweeps.stripeSweep()).fixed).toBe(0)
  })

  it('assinatura Stripe sem item no SPA: item criado e caso registrado', async () => {
    stripeSubscription(h, { id: 'sub_orphan', installationId })
    const result = await h.container.sweeps.stripeSweep()
    expect(result.fixed).toBe(1)
    expect(
      spaSubscriptions(h).some(
        x => x[h.config.subscription.gatewayId] === 'sub_orphan',
      ),
    ).toBe(true)
    expect(h.db.rows('sweepRun').at(-1)).toMatchObject({
      kind: 'stripe',
      fixed: 1,
    })
  })
})

describe('validação da configuração dos SPAs (health)', () => {
  it('campo UF ausente indica SPA e campo', async () => {
    const h = createHarness()
    h.crm.fields.set(1142, {
      ufCrm91Status: {
        type: 'enumeration',
        items: [{ ID: '13617', VALUE: 'Ativo' }],
      },
    })
    const problems = await validateSpaConfig(h.crm.asClient(), h.config)
    expect(problems).toContainEqual({
      entityTypeId: 1142,
      field: 'ufCrm91Modality',
      problem: 'campo não existe',
    })
    expect(
      problems.some(
        p =>
          p.entityTypeId === 1142 &&
          p.field === 'ufCrm91Status' &&
          p.problem.includes('13619'),
      ),
    ).toBe(true)
  })

  it('cargo do contato no SPA 1060 é conferido', async () => {
    const h = createHarness()
    h.crm.fields.set(1060, { ufCrm55Role: { type: 'enumeration' } })
    expect(
      (await validateSpaConfig(h.crm.asClient(), h.config)).find(
        p => p.entityTypeId === 1060 && p.field === 'ufCrm55Role',
      )!.problem,
    ).toContain('lista')

    h.crm.fields.set(1060, {})
    expect(await validateSpaConfig(h.crm.asClient(), h.config)).toContainEqual({
      entityTypeId: 1060,
      field: 'ufCrm55Role',
      problem: 'campo não existe',
    })
  })

  it('campo de texto criado como lista é reprovado', async () => {
    const h = createHarness()
    h.crm.fields.set(1142, { ufCrm91Modality: { type: 'enumeration' } })
    const problems = await validateSpaConfig(h.crm.asClient(), h.config)
    expect(
      problems.find(p => p.field === 'ufCrm91Modality')!.problem,
    ).toContain('lista')
  })

  it('health/ready falha com a lista de problemas', async () => {
    const h = createHarness()
    await h.container.signingKeys.rotate(0)
    const { createApp } = await import('@/app')
    const { HealthState } = await import('@/health')
    const health = new HealthState(h.container.db, null)
    health.setSpaProblems([
      {
        entityTypeId: 1142,
        field: 'ufCrm91Version',
        problem: 'campo não existe',
      },
    ])
    const request = (await import('supertest')).default
    const res = await request(createApp(h.container, health)).get(
      '/health/ready',
    )
    expect(res.status).toBe(503)
    expect(res.body.checks.spaConfig.problems[0]).toMatchObject({
      entityTypeId: 1142,
      field: 'ufCrm91Version',
    })
    health.setSpaProblems([])
    expect(
      (await request(createApp(h.container, health)).get('/health/ready'))
        .status,
    ).toBe(200)
  })
})
