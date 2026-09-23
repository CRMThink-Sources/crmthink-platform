import { beforeEach, describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import {
  installedGptMaker,
  spaSubscriptions,
  stripeEvent,
  stripeSubscription,
} from '@/test/billing-helpers'
import { createHarness, GPTMAKER, outbox, type Harness } from '@/test/harness'

const s = (h: Harness) => h.config.subscription

describe('catálogo de planos', () => {
  let h: Harness
  let apiKey: string

  beforeEach(async () => {
    h = createHarness()
    ;({ apiKey } = await installedGptMaker(h))
  })

  it('GET /v1/plans: só planos ativos dos produtos do app, com tipo e trial', async () => {
    const res = await http(h)
      .get('/v1/plans')
      .set('Authorization', `Bearer ${apiKey}`)
    expect(res.status).toBe(200)
    const byId = Object.fromEntries(res.body.items.map((p: any) => [p.id, p]))
    expect(Object.keys(byId).map(Number).sort()).toEqual([500, 501, 502, 510])
    expect(byId[510]).toMatchObject({
      type: 'one_time',
      interval: null,
      productName: 'Créditos GPTMaker',
    })
    expect(byId[501]).toMatchObject({
      type: 'subscription',
      interval: 'monthly',
      trial: false,
    })
    expect(byId[500].trial).toBe(true)
  })

  it('plano sem preço no ambiente atual não é oferecido', async () => {
    h.crm.seed(1138, {
      id: 503,
      title: 'Só produção',
      ufCrm89Product: 10,
      ufCrm89Value: 1,
      ufCrm89Interval: '13609',
      ufCrm89Active: 'Y',
      ufCrm89GatewayId: 'price_live_only',
    })
    await h.container.catalog.invalidatePlan(503)
    const res = await http(h)
      .get('/v1/plans')
      .set('Authorization', `Bearer ${apiKey}`)
    expect(res.body.items.map((p: any) => p.id)).not.toContain(503)
  })

  it('plano de assinatura sem intervalo não é retornado', async () => {
    h.crm.seed(1138, {
      id: 504,
      title: 'Sem intervalo',
      ufCrm89Product: 10,
      ufCrm89Value: 1,
      ufCrm89Active: 'Y',
      ufCrm89GatewayIdHomolog: 'price_x',
    })
    await h.container.catalog.invalidatePlan(504)
    const res = await http(h)
      .get('/v1/plans')
      .set('Authorization', `Bearer ${apiKey}`)
    expect(res.body.items.map((p: any) => p.id)).not.toContain(504)
  })

  it('plano alterado no CRM: evento do SPA invalida o cache', async () => {
    await http(h).get('/v1/plans').set('Authorization', `Bearer ${apiKey}`)
    const plan = await h.crm.getItem(1138, 501)
    await h.crm.updateItem(1138, 501, { ...plan, title: 'Básico Plus' })
    const stale = await http(h)
      .get('/v1/plans')
      .set('Authorization', `Bearer ${apiKey}`)
    expect(stale.body.items.find((p: any) => p.id === 501).name).toBe('Básico')

    const event = await http(h).post('/bitrix/spa-events').type('form').send({
      event: 'ONCRMDYNAMICITEMUPDATE',
      'data[FIELDS][ID]': '501',
      'data[FIELDS][ENTITY_TYPE_ID]': '1138',
      'auth[application_token]': 'crm-app-token',
    })
    expect(event.status).toBe(200)
    const job = h.queue.jobs.at(-1)!
    await h.container.spaProcessor.process(job.data as any)
    const fresh = await http(h)
      .get('/v1/plans')
      .set('Authorization', `Bearer ${apiKey}`)
    expect(fresh.body.items.find((p: any) => p.id === 501).name).toBe(
      'Básico Plus',
    )
  })

  it('evento de SPA com token inválido: 401', async () => {
    const res = await http(h).post('/bitrix/spa-events').type('form').send({
      event: 'ONCRMDYNAMICITEMUPDATE',
      'auth[application_token]': 'errado',
    })
    expect(res.status).toBe(401)
  })
})

describe('checkout e ciclo de vida Stripe', () => {
  let h: Harness
  let apiKey: string
  let installationId: number

  beforeEach(async () => {
    h = createHarness()
    ;({ apiKey, installationId } = await installedGptMaker(h))
  })

  const auth = () => ({ Authorization: `Bearer ${apiKey}` })

  async function activate(subscriptionId = 'sub_1') {
    stripeSubscription(h, { id: subscriptionId, installationId })
    await stripeEvent(h, {
      type: 'checkout.completed',
      sessionId: 'cs_1',
      mode: 'subscription',
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 501,
        intent: 'subscribe',
      },
      gatewaySubscriptionId: subscriptionId,
      paymentIntentId: null,
      amountTotal: 9900,
    })
  }

  it('checkout subscribe embutido com metadados; plano avulso recusado com PLAN_TYPE_MISMATCH', async () => {
    const res = await http(h)
      .post('/v1/checkout-sessions')
      .set(auth())
      .send({ installationId, planId: 501, intent: 'subscribe' })
    expect(res.status).toBe(201)
    expect(res.body.clientSecret).toMatch(/^cs_secret_/)
    expect(h.gateway.checkouts[0]).toMatchObject({
      mode: 'subscription',
      priceId: 'price_basic',
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 501,
        intent: 'subscribe',
      },
    })

    const mismatch = await http(h)
      .post('/v1/checkout-sessions')
      .set(auth())
      .send({ installationId, planId: 510, intent: 'subscribe' })
    expect(mismatch.status).toBe(400)
    expect(mismatch.body.error.code).toBe('PLAN_TYPE_MISMATCH')
  })

  it('ativação durante o trial: active com período do Stripe, trial encerrado, activated uma vez', async () => {
    await activate()
    const subs = spaSubscriptions(h)
    const trial = subs.find(x => x[s(h).status] === '13623')
    const active = subs.find(x => x[s(h).gatewayId] === 'sub_1')!
    expect(trial).toBeTruthy()
    expect(active).toMatchObject({
      [s(h).status]: '13617',
      [s(h).modality]: 'stripe',
      parentId1060: installationId,
      [s(h).environment]: 'homolog',
    })

    // Mesmo evento reentregue e invoice.paid de criação: nada novo.
    await stripeEvent(h, {
      type: 'invoice.paid',
      invoiceId: 'in_1',
      gatewaySubscriptionId: 'sub_1',
      billingReason: 'subscription_create',
      periodStart: null,
      periodEnd: null,
      amountPaid: 9900,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 501,
        intent: 'subscribe',
      },
    })
    const activated = outbox(h).filter(e => e.type === 'subscription.activated')
    expect(activated).toHaveLength(1)
    expect(activated[0]!.payload.data.previousSubscriptionId).toBe(trial!.id)
    expect(outbox(h).some(e => e.type === 'subscription.ended')).toBe(false)

    const current = await http(h)
      .get(`/v1/installations/${installationId}/subscription`)
      .set(auth())
    expect(current.body).toMatchObject({
      status: 'active',
      modality: 'stripe',
      plan: { id: 501 },
      cancelAtPeriodEnd: false,
      trial: { used: true, endsAt: null },
    })
    expect(current.body.version).toBeGreaterThan(0)

    const again = await http(h)
      .post('/v1/checkout-sessions')
      .set(auth())
      .send({ installationId, planId: 502, intent: 'subscribe' })
    expect(again.body.error.code).toBe('SUBSCRIPTION_ALREADY_EXISTS')
  })

  it('evento repetido do Stripe: 200 sem efeitos adicionais', async () => {
    stripeSubscription(h, { id: 'sub_1', installationId })
    const event = {
      type: 'checkout.completed' as const,
      sessionId: 'cs_1',
      mode: 'subscription' as const,
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 501,
        intent: 'subscribe' as const,
      },
      gatewaySubscriptionId: 'sub_1',
      paymentIntentId: null,
      amountTotal: 9900,
    }
    await stripeEvent(h, event, 'evt_dup')
    const writes = h.crm.calls.length
    const second = await stripeEvent(h, event, 'evt_dup')
    expect(second.res.status).toBe(200)
    expect(second.res.body.outcome).toBe('duplicate')
    expect(h.crm.calls.length).toBe(writes)
  })

  it('assinatura inválida: 400', async () => {
    const res = await http(h)
      .post('/webhooks/stripe')
      .set('Stripe-Signature', 'invalid')
      .send('{}')
    expect(res.status).toBe(400)
  })

  it('renovação por invoice.paid de ciclo: novo período + renewed com invoiceId e previousPeriodEnd', async () => {
    await activate()
    const state = h.gateway.subscriptions.get('sub_1')!
    const previousEnd = state.periodEnd
    state.periodStart = previousEnd
    state.periodEnd = new Date(previousEnd.getTime() + 30 * 86_400_000)
    await stripeEvent(h, {
      type: 'invoice.paid',
      invoiceId: 'in_2',
      gatewaySubscriptionId: 'sub_1',
      billingReason: 'subscription_cycle',
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      amountPaid: 9900,
      metadata: state.metadata,
    })
    const renewed = outbox(h).filter(e => e.type === 'subscription.renewed')
    expect(renewed).toHaveLength(1)
    expect(renewed[0]!.payload.data.invoiceId).toBe('in_2')
    expect(renewed[0]!.payload.data.previousPeriodEnd.slice(0, 10)).toBe(
      previousEnd.toISOString().slice(0, 10),
    )
    expect(renewed[0]!.payload.subscription.periodEnd.slice(0, 10)).toBe(
      state.periodEnd.toISOString().slice(0, 10),
    )
  })

  it('pagamento falhou → past_due com link; regularizado no mesmo período → recovered; versões crescentes', async () => {
    await activate()
    await stripeEvent(h, {
      type: 'invoice.payment_failed',
      invoiceId: 'in_3',
      gatewaySubscriptionId: 'sub_1',
      hostedInvoiceUrl: 'https://invoice.stripe/in_3',
      attemptCount: 1,
      metadata: null,
    })
    const pastDue = outbox(h).find(e => e.type === 'subscription.past_due')!
    expect(pastDue.payload.data.hostedInvoiceUrl).toBe(
      'https://invoice.stripe/in_3',
    )
    expect(pastDue.payload.subscription.status).toBe('past_due')
    expect(
      spaSubscriptions(h).find(x => x[s(h).gatewayId] === 'sub_1')![
        s(h).status
      ],
    ).toBe('13621')

    const state = h.gateway.subscriptions.get('sub_1')!
    state.status = 'active'
    await stripeEvent(h, { type: 'subscription.updated', subscription: state })
    const recovered = outbox(h).find(e => e.type === 'subscription.recovered')!
    expect(recovered.payload.subscription.version).toBeGreaterThan(
      pastDue.payload.subscription.version,
    )
    expect(
      outbox(h).filter(e => e.type === 'subscription.renewed'),
    ).toHaveLength(0)
  })

  it('cancelamento no Customer Portal: cancel_scheduled com effectiveAt e, no fim, ended reason=cancelled', async () => {
    await activate()
    const state = h.gateway.subscriptions.get('sub_1')!
    state.cancelAtPeriodEnd = true
    await stripeEvent(h, { type: 'subscription.updated', subscription: state })
    const scheduled = outbox(h).find(
      e => e.type === 'subscription.cancel_scheduled',
    )!
    expect(scheduled.payload.data.effectiveAt).toBe(
      state.periodEnd.toISOString(),
    )

    await stripeEvent(h, {
      type: 'subscription.deleted',
      subscription: { ...state, status: 'cancelled', rawStatus: 'canceled' },
    })
    const ended = outbox(h).filter(e => e.type === 'subscription.ended')
    expect(ended).toHaveLength(1)
    expect(ended[0]!.payload.data.reason).toBe('cancelled')
    expect(
      spaSubscriptions(h).find(x => x[s(h).gatewayId] === 'sub_1')![
        s(h).status
      ],
    ).toBe('13623')
  })

  it('Customer Portal: URL para Stripe; NO_GATEWAY_SUBSCRIPTION sem assinatura Stripe', async () => {
    const none = await http(h)
      .post('/v1/billing-portal-sessions')
      .set(auth())
      .send({ installationId, returnUrl: 'https://gptmaker.app/billing' })
    expect(none.body.error.code).toBe('NO_GATEWAY_SUBSCRIPTION')
    await activate()
    const ok = await http(h)
      .post('/v1/billing-portal-sessions')
      .set(auth())
      .send({ installationId, returnUrl: 'https://gptmaker.app/billing' })
    expect(ok.status).toBe(201)
    expect(ok.body.url).toContain('sub_1')
  })

  it('upgrade: always_invoice imediato; plan_changed immediate com fração após o pagamento', async () => {
    await activate()
    const sub = spaSubscriptions(h).find(x => x[s(h).gatewayId] === 'sub_1')!
    h.clock.advance(15 * 86_400_000)
    const res = await http(h)
      .post(`/v1/subscriptions/${sub.id}/change-plan`)
      .set(auth())
      .send({ planId: 502 })
    expect(res.body).toMatchObject({ effective: 'immediate', planId: 502 })
    expect(h.gateway.upgrades[0]).toMatchObject({
      id: 'sub_1',
      priceId: 'price_pro',
    })
    expect(outbox(h).some(e => e.type === 'subscription.plan_changed')).toBe(
      false,
    )

    // Fatura proporcional paga: o Stripe aplica o item novo e manda subscription.updated.
    const state = h.gateway.subscriptions.get('sub_1')!
    state.items = [{ itemId: 'si_1', priceId: 'price_pro', quantity: 1 }]
    state.metadata = {
      ...state.metadata!,
      planChange: h.gateway.upgrades[0]!.planChange,
    }
    await stripeEvent(h, { type: 'subscription.updated', subscription: state })
    const changed = outbox(h).find(e => e.type === 'subscription.plan_changed')!
    expect(changed.payload.data).toMatchObject({
      effective: 'immediate',
      planId: 502,
      previousPlanId: 501,
    })
    expect(changed.payload.data.remainingFraction).toBeCloseTo(0.5, 1)
    expect(spaSubscriptions(h).find(x => x.id === sub.id)![s(h).plan]).toBe(502)
  })

  it('downgrade agendado: plan_changed next_period quando efetivado; manual recusado', async () => {
    await activate()
    const sub = spaSubscriptions(h).find(x => x[s(h).gatewayId] === 'sub_1')!
    await h.crm.updateItem(1142, sub.id as number, { [s(h).plan]: 502 })
    // reflete o SPA como se o plano atual fosse Pro
    const res = await http(h)
      .post(`/v1/subscriptions/${sub.id}/change-plan`)
      .set(auth())
      .send({ planId: 501 })
    expect(res.body.effective).toBe('next_period')
    expect(h.gateway.downgrades).toHaveLength(1)

    const trial = spaSubscriptions(h).find(x => x[s(h).modality] === 'manual')!
    await h.crm.updateItem(1142, trial.id as number, { [s(h).status]: '13617' })
    const manual = await http(h)
      .post(`/v1/subscriptions/${trial.id}/change-plan`)
      .set(auth())
      .send({ planId: 502 })
    expect(manual.body.error.code).toBe('MANUAL_SUBSCRIPTION')
  })

  it('evento de app não migrado (ThinkZap no hub-core): 200 sem efeitos', async () => {
    const writes = h.crm.calls.length
    const { res } = await stripeEvent(h, {
      type: 'subscription.updated',
      subscription: {
        ...stripeSubscription(h, { id: 'sub_tz', installationId }),
        metadata: null,
      },
    })
    expect(res.status).toBe(200)
    await h.container.stripeProcessor.process('x')
    expect(h.crm.calls.length).toBe(writes)
    expect(h.db.rows('stripeEvent').at(-1)!.status).toBe('ignored')
  })

  it('falha parcial na ativação: retry do evento cria o item e emite activated uma vez', async () => {
    stripeSubscription(h, { id: 'sub_1', installationId })
    const original = h.crm.addItem.bind(h.crm)
    let failures = 1
    h.crm.addItem = async (entityTypeId, fields) => {
      if (entityTypeId === 1142 && failures-- > 0) throw new Error('Bitrix 503')
      return original(entityTypeId, fields)
    }
    const event = {
      type: 'checkout.completed' as const,
      sessionId: 'cs_1',
      mode: 'subscription' as const,
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 501,
        intent: 'subscribe' as const,
      },
      gatewaySubscriptionId: 'sub_1',
      paymentIntentId: null,
      amountTotal: 9900,
    }
    await expect(stripeEvent(h, event, 'evt_retry')).rejects.toThrow(
      'Bitrix 503',
    )
    await h.container.stripeProcessor.process('evt_retry')
    expect(
      outbox(h).filter(e => e.type === 'subscription.activated'),
    ).toHaveLength(1)
  })
})

describe('trial', () => {
  let h: Harness
  let installationId: number

  beforeEach(async () => {
    h = createHarness()
    ;({ installationId } = await installedGptMaker(h))
  })

  it('rota administrativa: TRIAL_ALREADY_USED', async () => {
    const res = await http(h)
      .post(`/v1/installations/${installationId}/trial`)
      .set('Authorization', 'Bearer admin-token')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TRIAL_ALREADY_USED')
    expect(
      (await http(h).post(`/v1/installations/${installationId}/trial`)).status,
    ).toBe(401)
  })

  it('trial vencido sem assinatura paga: trial_expired + ended reason=trial_expired', async () => {
    h.clock.advance(13 * 86_400_000)
    expect(await h.container.trials.expireDue()).toBe(0)
    h.clock.advance(2 * 86_400_000)
    expect(await h.container.trials.expireDue()).toBe(1)
    const ended = outbox(h).find(e => e.type === 'subscription.ended')!
    expect(ended.payload.data.reason).toBe('trial_expired')
    expect(ended.payload.subscription.status).toBe('trial_expired')
    expect(await h.container.trials.expireDue()).toBe(0)
  })
})

describe('compras avulsas e estornos', () => {
  let h: Harness
  let apiKey: string
  let installationId: number

  beforeEach(async () => {
    h = createHarness()
    ;({ apiKey, installationId } = await installedGptMaker(h))
  })

  const auth = () => ({ Authorization: `Bearer ${apiKey}` })

  async function buy() {
    const res = await http(h)
      .post('/v1/checkout-sessions')
      .set(auth())
      .send({ installationId, planId: 510, intent: 'purchase', quantity: 2 })
    return res
  }

  it('checkout purchase registra compra pendente; paga emite purchase.paid uma vez', async () => {
    const res = await buy()
    expect(res.status).toBe(201)
    expect(h.gateway.checkouts.at(-1)).toMatchObject({
      mode: 'payment',
      priceId: 'price_pack',
      quantity: 2,
    })
    const purchase = h.db.rows('purchase')[0]!
    expect(purchase).toMatchObject({
      status: 'pending',
      quantity: 2,
      planId: 510,
    })

    const completed = {
      type: 'checkout.completed' as const,
      sessionId: res.body.sessionId,
      mode: 'payment' as const,
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 510,
        intent: 'purchase' as const,
      },
      gatewaySubscriptionId: null,
      paymentIntentId: 'pi_1',
      amountTotal: 9800,
    }
    await stripeEvent(h, completed)
    await stripeEvent(h, completed)
    const paid = outbox(h).filter(e => e.type === 'purchase.paid')
    expect(paid).toHaveLength(1)
    expect(paid[0]!.payload.data).toMatchObject({
      purchaseId: purchase.id,
      planId: 510,
      quantity: 2,
      chargeId: 'ch_pi_1',
      amount: 9800,
    })
    expect(h.db.rows('purchase')[0]!.status).toBe('paid')
  })

  it('sessão expirada: expired sem evento', async () => {
    const res = await buy()
    await stripeEvent(h, {
      type: 'checkout.expired',
      sessionId: res.body.sessionId,
      mode: 'payment',
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 510,
        intent: 'purchase',
      },
    })
    expect(h.db.rows('purchase')[0]!.status).toBe('expired')
    expect(outbox(h).some(e => e.type === 'purchase.paid')).toBe(false)
  })

  it('sem assinatura ativa/trial: NO_ACTIVE_SUBSCRIPTION', async () => {
    h.clock.advance(15 * 86_400_000)
    await h.container.trials.expireDue()
    const res = await buy()
    expect(res.body.error.code).toBe('NO_ACTIVE_SUBSCRIPTION')
  })

  it('estorno total de pacote: refunded + charge.refunded source=purchase', async () => {
    const res = await buy()
    await stripeEvent(h, {
      type: 'checkout.completed',
      sessionId: res.body.sessionId,
      mode: 'payment',
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 510,
        intent: 'purchase',
      },
      gatewaySubscriptionId: null,
      paymentIntentId: 'pi_1',
      amountTotal: 9800,
    })
    await stripeEvent(h, {
      type: 'charge.refunded',
      chargeId: 'ch_pi_1',
      paymentIntentId: 'pi_1',
      amount: 9800,
      amountRefunded: 9800,
      metadata: null,
    })
    const refunded = outbox(h).find(e => e.type === 'charge.refunded')!
    expect(refunded.payload.data).toMatchObject({
      source: 'purchase',
      chargeId: 'ch_pi_1',
      amountRefunded: 9800,
      amount: 9800,
    })
    expect(h.db.rows('purchase')[0]!.status).toBe('refunded')
  })

  it('estorno parcial de fatura: source=invoice com amountRefunded < amount', async () => {
    stripeSubscription(h, { id: 'sub_1', installationId })
    await stripeEvent(h, {
      type: 'checkout.completed',
      sessionId: 'cs_s',
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
      amountTotal: 9900,
    })
    h.gateway.chargeOrigins.set('pi_inv', {
      source: 'invoice',
      invoiceId: 'in_9',
      gatewaySubscriptionId: 'sub_1',
      metadata: null,
    })
    await stripeEvent(h, {
      type: 'charge.refunded',
      chargeId: 'ch_inv',
      paymentIntentId: 'pi_inv',
      amount: 9900,
      amountRefunded: 3000,
      metadata: null,
    })
    const refunded = outbox(h).find(e => e.type === 'charge.refunded')!
    expect(refunded.payload.data).toMatchObject({
      source: 'invoice',
      invoiceId: 'in_9',
      amountRefunded: 3000,
      amount: 9900,
    })
  })

  it('contestação de pacote: charge.disputed ao app dono; cobrança desconhecida não emite', async () => {
    const res = await buy()
    await stripeEvent(h, {
      type: 'checkout.completed',
      sessionId: res.body.sessionId,
      mode: 'payment',
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 510,
        intent: 'purchase',
      },
      gatewaySubscriptionId: null,
      paymentIntentId: 'pi_1',
      amountTotal: 9800,
    })
    await stripeEvent(h, {
      type: 'charge.disputed',
      disputeId: 'dp_1',
      chargeId: 'ch_pi_1',
      paymentIntentId: 'pi_1',
      amount: 9800,
      reason: 'fraudulent',
      metadata: null,
    })
    expect(
      outbox(h).find(e => e.type === 'charge.disputed')!.payload.data,
    ).toMatchObject({ source: 'purchase', disputeId: 'dp_1' })

    const before = outbox(h).length
    await stripeEvent(h, {
      type: 'charge.disputed',
      disputeId: 'dp_2',
      chargeId: 'ch_x',
      paymentIntentId: 'pi_x',
      amount: 100,
      reason: null,
      metadata: null,
    })
    expect(outbox(h).length).toBe(before)
  })
})
