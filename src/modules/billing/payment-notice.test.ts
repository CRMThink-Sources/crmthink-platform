import { describe, expect, it } from 'vitest'
import { installedGptMaker } from '@/test/billing-helpers'
import { createHarness, outbox, type Harness } from '@/test/harness'
import {
  paymentNoticeSchema,
  type PaymentNoticeInput,
} from './application/payment-notice-service'

const WHO = { actor: 'operator:1', reason: 'contrato 123 com o financeiro' }
const SUBSCRIPTION_TYPE = 1142

async function setup(
  options: { env?: Record<string, string>; app?: Record<string, unknown> } = {},
) {
  const h = createHarness({
    env: { PLATFORM_ENVIRONMENT: 'production', ...options.env },
  })
  const { installationId } = await installedGptMaker(h, {
    trialOnInstall: false,
    ...options.app,
  })
  const { integration } =
    await h.container.paymentIntegrations.create('Banco X')
  const c = h.config

  const seedPlan = (id: number, intervalEnumId: string) =>
    h.crm.seed(c.entityTypes.plan, {
      id,
      title: `Plano ${id}`,
      [c.plan.product]: 10,
      [c.plan.value]: 10000,
      [c.plan.interval]: intervalEnumId,
      [c.plan.active]: 'Y',
      [c.plan.gatewayIdHomolog]: `price_${id}`,
      [c.plan.gatewayIdProduction]: `price_${id}_live`,
    })
  seedPlan(520, '13611') // trimestral
  seedPlan(521, '13613') // semestral
  seedPlan(522, '13615') // anual

  /** Assinatura manual ativa (início = hoje, 2026-09-01) com fim em `periodEnd`. */
  const subscribe = (periodEnd = '2026-10-01', planId = 501) =>
    h.container.manualSubscriptions.create(
      installationId,
      { planId, kind: 'manual', periodEnd },
      WHO,
    )
  const receive = (
    input: Partial<PaymentNoticeInput> & { subscriptionId?: number },
    who = integration,
  ) =>
    h.container.paymentNotices.receive(who, {
      externalId: 'boleto-1',
      ...input,
    })
  return { h, installationId, integration, subscribe, receive, c }
}

const item = (h: Harness, id: number) =>
  h.crm.items.get(SUBSCRIPTION_TYPE)!.get(id)!

const statusId = (h: Harness, name: string) =>
  Object.entries(h.config.subscription.statusEnum).find(
    ([, value]) => value === name,
  )![0]

const renewed = (h: Harness) =>
  outbox(h).filter(e => e.type === 'subscription.renewed')

const rejectsWith = (promise: Promise<unknown>, status: number, code: string) =>
  expect(promise).rejects.toMatchObject({ status, code })

const day = (iso: string) => iso.slice(0, 10)

describe('PaymentNoticeService: renovação', () => {
  it('mensal: o período avança um mês, o status continua active e o app recebe um subscription.renewed', async () => {
    const { h, subscribe, receive, c } = await setup()
    const sub = await subscribe('2026-10-01')

    const result = await receive({
      subscriptionId: sub.id,
      paidAt: '2026-09-28',
    })

    expect(result).toMatchObject({
      subscriptionId: sub.id,
      status: 'active',
      duplicate: false,
    })
    expect(result.periodStart.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(result.periodEnd.toISOString()).toBe('2026-11-01T23:59:59.999Z')
    expect(String(item(h, sub.id)[c.subscription.periodEnd])).toContain(
      '2026-11-01',
    )
    expect(item(h, sub.id)[c.subscription.status]).toBe(statusId(h, 'active'))

    const events = renewed(h)
    expect(events).toHaveLength(1)
    expect(events[0]!.dedupeKey).toBe(`renewed:${sub.id}:2026-10-01:2026-11-01`)
    expect(events[0]!.payload.data.previousPeriodEnd).toBe(
      '2026-10-01T23:59:59.999Z',
    )

    const notice = h.db.rows('paymentNotice')[0]!
    expect(notice).toMatchObject({
      externalId: 'boleto-1',
      subscriptionSpaId: sub.id,
      status: 'applied',
    })
    expect(notice.appliedAt).toBeInstanceOf(Date)
    expect(day(notice.paidAt.toISOString())).toBe('2026-09-28')
  })

  it.each([
    ['trimestral', 520, '2026-11-15', '2027-02-15'],
    ['semestral', 521, '2026-11-15', '2027-05-15'],
    ['anual', 522, '2026-11-15', '2027-11-15'],
    ['mensal em fim de mês', 501, '2027-01-31', '2027-02-28'],
  ])(
    '%s: o fim avança pelo intervalo do plano',
    async (_name, planId, from, to) => {
      const { subscribe, receive } = await setup()
      const sub = await subscribe(from, planId)
      const result = await receive({ subscriptionId: sub.id })
      expect(day(result.periodEnd.toISOString())).toBe(to)
    },
  )

  it('periodEnd informado vale no lugar do cálculo pelo plano', async () => {
    const { subscribe, receive } = await setup()
    const sub = await subscribe('2026-10-01')
    const result = await receive({
      subscriptionId: sub.id,
      periodEnd: '2027-03-15',
    })
    expect(day(result.periodEnd.toISOString())).toBe('2027-03-15')
    expect(day(result.periodStart.toISOString())).toBe('2026-10-01')
  })

  it('past_due volta a active com o período estendido e um subscription.renewed', async () => {
    const { h, subscribe, receive, c } = await setup()
    const sub = await subscribe('2026-10-01')
    item(h, sub.id)[c.subscription.status] = statusId(h, 'past_due')

    const result = await receive({ subscriptionId: sub.id })

    expect(result.status).toBe('active')
    expect(item(h, sub.id)[c.subscription.status]).toBe(statusId(h, 'active'))
    expect(renewed(h)).toHaveLength(1)
  })

  it('por installationId renova a assinatura vigente da instalação', async () => {
    const { subscribe, receive, installationId } = await setup()
    const sub = await subscribe('2026-10-01')
    const result = await receive({ installationId })
    expect(result.subscriptionId).toBe(sub.id)
    expect(day(result.periodEnd.toISOString())).toBe('2026-11-01')
  })

  it('anti-loop: depois do aviso, ManualLifecycle.apply não emite mais nada', async () => {
    const { h, subscribe, receive } = await setup()
    const sub = await subscribe('2026-10-01')
    await receive({ subscriptionId: sub.id })
    const before = outbox(h).length
    await h.container.manual.apply(sub.id)
    expect(outbox(h)).toHaveLength(before)
  })

  it('o comentário da assinatura traz a integração, o externalId e o período; falha dele não desfaz', async () => {
    const { h, subscribe, receive } = await setup()
    const sub = await subscribe('2026-10-01')
    await receive({ subscriptionId: sub.id })
    const comment = h.crm.comments
      .filter(x => x.entityTypeId === SUBSCRIPTION_TYPE && x.id === sub.id)
      .at(-1)!
    expect(comment.comment).toContain('Banco X')
    expect(comment.comment).toContain('boleto-1')
    expect(comment.comment).toContain('01/11/2026')

    h.crm.addTimelineComment = async () => {
      throw new Error('bitrix fora do ar')
    }
    await expect(
      receive({ externalId: 'boleto-2', subscriptionId: sub.id }),
    ).resolves.toMatchObject({ duplicate: false })
  })
})

describe('PaymentNoticeService: idempotência', () => {
  it('aviso repetido: duplicate true, mesmo período, sem nova escrita e sem novo evento', async () => {
    const { h, subscribe, receive } = await setup()
    const sub = await subscribe('2026-10-01')
    const first = await receive({ subscriptionId: sub.id })
    const writes = h.crm.calls.length

    const second = await receive({ subscriptionId: sub.id })

    expect(second.duplicate).toBe(true)
    expect(second.periodEnd).toEqual(first.periodEnd)
    expect(second.periodStart).toEqual(first.periodStart)
    expect(h.crm.calls.length).toBe(writes)
    expect(renewed(h)).toHaveLength(1)
    expect(h.db.rows('paymentNotice')).toHaveLength(1)
  })

  it('o repetido continua respondendo depois que a assinatura foi cancelada', async () => {
    const { h, subscribe, receive, c, installationId } = await setup()
    const sub = await subscribe('2026-10-01')
    await receive({ installationId })
    item(h, sub.id)[c.subscription.status] = statusId(h, 'cancelled')

    await expect(receive({ installationId })).resolves.toMatchObject({
      duplicate: true,
      subscriptionId: sub.id,
    })
  })

  it('externalId reaproveitado com outra assinatura ou instalação: 409 EXTERNAL_ID_REUSED', async () => {
    const { h, subscribe, receive } = await setup()
    const sub = await subscribe('2026-10-01')
    await receive({ subscriptionId: sub.id })

    await rejectsWith(
      receive({ subscriptionId: sub.id + 1000 }),
      409,
      'EXTERNAL_ID_REUSED',
    )
    await rejectsWith(
      receive({ installationId: 987654 }),
      409,
      'EXTERNAL_ID_REUSED',
    )
    expect(renewed(h)).toHaveLength(1)
  })

  it('o mesmo externalId em integrações diferentes é independente', async () => {
    const { h, subscribe, receive, integration } = await setup()
    const sub = await subscribe('2026-10-01')
    const other = (await h.container.paymentIntegrations.create('Cobrança Y'))
      .integration

    await receive({ subscriptionId: sub.id })
    const second = await receive({ subscriptionId: sub.id }, other)

    expect(integration.id).not.toBe(other.id)
    expect(second.duplicate).toBe(false)
    expect(day(second.periodEnd.toISOString())).toBe('2026-12-01')
    expect(renewed(h)).toHaveLength(2)
  })

  it('avisos simultâneos com o mesmo externalId: só um renova', async () => {
    const { h, subscribe, receive } = await setup()
    const sub = await subscribe('2026-10-01')
    const results = await Promise.all([
      receive({ subscriptionId: sub.id }),
      receive({ subscriptionId: sub.id }),
    ])
    expect(results.filter(r => r.duplicate)).toHaveLength(1)
    expect(renewed(h)).toHaveLength(1)
    expect(day(results[0].periodEnd.toISOString())).toBe('2026-11-01')
  })

  it('queda depois de escrever no SPA e antes de concluir: o reenvio conclui o período já decidido, nunca um a mais', async () => {
    const { h, subscribe, receive, c } = await setup()
    const sub = await subscribe('2026-10-01')

    // Cai ao gravar versão e evento: o SPA já foi estendido, o aviso fica pending.
    const transaction = h.db.$transaction.bind(h.db)
    h.db.$transaction = async () => {
      throw new Error('queda do processo')
    }
    await expect(receive({ subscriptionId: sub.id })).rejects.toThrow(
      'queda do processo',
    )
    h.db.$transaction = transaction
    expect(String(item(h, sub.id)[c.subscription.periodEnd])).toContain(
      '2026-11-01',
    )
    expect(h.db.rows('paymentNotice')[0]!.status).toBe('pending')
    expect(renewed(h)).toHaveLength(0)

    const result = await receive({ subscriptionId: sub.id })

    expect(day(result.periodEnd.toISOString())).toBe('2026-11-01')
    expect(String(item(h, sub.id)[c.subscription.periodEnd])).toContain(
      '2026-11-01',
    )
    expect(h.db.rows('paymentNotice')[0]!.status).toBe('applied')
    const events = renewed(h)
    expect(events).toHaveLength(1)
    expect(events[0]!.payload.data.previousPeriodEnd).toBe(
      '2026-10-01T23:59:59.999Z',
    )
  })

  it('queda antes de escrever no SPA: o reenvio aplica o período decidido', async () => {
    const { h, subscribe, receive, c } = await setup()
    const sub = await subscribe('2026-10-01')

    const update = h.crm.updateItem.bind(h.crm)
    h.crm.updateItem = async () => {
      throw new Error('bitrix fora do ar')
    }
    await expect(receive({ subscriptionId: sub.id })).rejects.toThrow()
    h.crm.updateItem = update
    expect(String(item(h, sub.id)[c.subscription.periodEnd])).toContain(
      '2026-10-01',
    )

    const result = await receive({ subscriptionId: sub.id })

    expect(day(result.periodEnd.toISOString())).toBe('2026-11-01')
    expect(renewed(h)).toHaveLength(1)
  })
})

describe('PaymentNoticeService: validação', () => {
  it('assinatura ou instalação inexistente: 404', async () => {
    const { h, receive } = await setup()
    await rejectsWith(
      receive({ subscriptionId: 987654 }),
      404,
      'SUBSCRIPTION_NOT_FOUND',
    )
    await rejectsWith(
      receive({ installationId: 987654 }),
      404,
      'INSTALLATION_NOT_FOUND',
    )
    expect(h.db.rows('paymentNotice')).toHaveLength(0)
  })

  it('instalação sem assinatura vigente: 404 SUBSCRIPTION_NOT_FOUND', async () => {
    const { receive, installationId } = await setup()
    await rejectsWith(
      receive({ installationId }),
      404,
      'SUBSCRIPTION_NOT_FOUND',
    )
  })

  it('assinatura Stripe: 422 NOT_MANUAL_SUBSCRIPTION e nada muda', async () => {
    const { h, subscribe, receive, c } = await setup()
    const sub = await subscribe('2026-10-01')
    item(h, sub.id)[c.subscription.modality] = 'stripe'
    await rejectsWith(
      receive({ subscriptionId: sub.id }),
      422,
      'NOT_MANUAL_SUBSCRIPTION',
    )
    expect(renewed(h)).toHaveLength(0)
    expect(h.db.rows('paymentNotice')).toHaveLength(0)
  })

  it.each(['cancelled', 'trialing', 'trial_expired'])(
    'status %s: 409 SUBSCRIPTION_NOT_RENEWABLE e nada muda',
    async status => {
      const { h, subscribe, receive, c } = await setup()
      const sub = await subscribe('2026-10-01')
      item(h, sub.id)[c.subscription.status] = statusId(h, status)
      await rejectsWith(
        receive({ subscriptionId: sub.id }),
        409,
        'SUBSCRIPTION_NOT_RENEWABLE',
      )
      expect(renewed(h)).toHaveLength(0)
      expect(h.db.rows('paymentNotice')).toHaveLength(0)
    },
  )

  it('período: periodEnd não posterior, mais de 24 meses, avanço calculado além do limite e plano sem intervalo', async () => {
    const { h, subscribe, receive, c } = await setup()
    const sub = await subscribe('2026-10-01')
    await rejectsWith(
      receive({ subscriptionId: sub.id, periodEnd: '2026-10-01' }),
      422,
      'INVALID_PERIOD',
    )
    await rejectsWith(
      receive({ subscriptionId: sub.id, periodEnd: '2028-09-02' }),
      422,
      'INVALID_PERIOD',
    )

    // Plano sem intervalo (compra única) e sem periodEnd: não há como calcular.
    item(h, sub.id)[c.subscription.plan] = 510
    await rejectsWith(
      receive({ subscriptionId: sub.id }),
      422,
      'INVALID_PERIOD',
    )
    expect(renewed(h)).toHaveLength(0)
    expect(h.db.rows('paymentNotice')).toHaveLength(0)
  })

  it('avanço calculado que passaria de 24 meses a partir de hoje: 422 INVALID_PERIOD', async () => {
    const { subscribe, receive } = await setup()
    const sub = await subscribe('2028-08-15')
    await rejectsWith(
      receive({ subscriptionId: sub.id }),
      422,
      'INVALID_PERIOD',
    )
  })

  it('fora da produção: 409 SUBSCRIPTIONS_READ_ONLY', async () => {
    const { h, receive } = await setup({
      env: { PLATFORM_ENVIRONMENT: 'homolog' },
    })
    const before = h.crm.calls.length
    await rejectsWith(
      receive({ subscriptionId: 1 }),
      409,
      'SUBSCRIPTIONS_READ_ONLY',
    )
    expect(h.crm.calls.length).toBe(before)
  })
})

describe('paymentNoticeSchema', () => {
  const base = { externalId: 'boleto-1' }

  it('exige exatamente um entre subscriptionId e installationId', () => {
    expect(paymentNoticeSchema.safeParse(base).success).toBe(false)
    expect(
      paymentNoticeSchema.safeParse({
        ...base,
        subscriptionId: 1,
        installationId: 2,
      }).success,
    ).toBe(false)
    expect(
      paymentNoticeSchema.safeParse({ ...base, subscriptionId: 1 }).success,
    ).toBe(true)
    expect(
      paymentNoticeSchema.safeParse({ ...base, installationId: 2 }).success,
    ).toBe(true)
  })

  it('valida externalId, datas e campos desconhecidos', () => {
    const ok = { ...base, subscriptionId: 1 }
    expect(
      paymentNoticeSchema.safeParse({ ...ok, externalId: '  ' }).success,
    ).toBe(false)
    expect(
      paymentNoticeSchema.safeParse({ ...ok, externalId: 'x'.repeat(201) })
        .success,
    ).toBe(false)
    expect(
      paymentNoticeSchema.safeParse({ ...ok, paidAt: '28/09/2026' }).success,
    ).toBe(false)
    expect(
      paymentNoticeSchema.safeParse({ ...ok, periodEnd: '2026-02-31' }).success,
    ).toBe(false)
    expect(paymentNoticeSchema.safeParse({ ...ok, amount: 10 }).success).toBe(
      false,
    )
    expect(
      paymentNoticeSchema.safeParse({
        ...ok,
        paidAt: '2026-09-28',
        periodEnd: '2026-11-01',
      }).success,
    ).toBe(true)
  })
})
