import { describe, expect, it } from 'vitest'
import { installedGptMaker, spaSubscriptions } from '@/test/billing-helpers'
import { createHarness, outbox, type Harness } from '@/test/harness'
import {
  createManualSubscriptionSchema,
  type CreateManualSubscription,
} from './application/manual-subscription-service'

const WHO = { actor: 'operator:1', reason: 'contrato 123 com o financeiro' }
const SUBSCRIPTION_TYPE = 1142

async function setup(
  options: {
    env?: Record<string, string>
    app?: Record<string, unknown>
  } = {},
) {
  const h = createHarness({
    env: { PLATFORM_ENVIRONMENT: 'production', ...options.env },
  })
  const { installationId } = await installedGptMaker(h, options.app)
  const service = h.container.manualSubscriptions
  const create = (
    input: Partial<CreateManualSubscription> = {},
    id = installationId,
  ) =>
    service.create(
      id,
      {
        planId: 501,
        kind: 'manual',
        periodEnd: '2027-09-01',
        ...input,
      },
      WHO,
    )
  return { h, installationId, service, create, c: h.config }
}

const rejectsWith = (promise: Promise<unknown>, status: number, code: string) =>
  expect(promise).rejects.toMatchObject({ status, code })

/** Id do enum de status do SPA para o nome do status. */
const statusId = (h: Harness, name: string) =>
  Object.entries(h.config.subscription.statusEnum).find(
    ([, value]) => value === name,
  )![0]

const setStatus = (h: Harness, id: number, name: string) => {
  h.crm.items.get(SUBSCRIPTION_TYPE)!.get(id)![h.config.subscription.status] =
    statusId(h, name)
}

const activated = (h: Harness) =>
  outbox(h).filter(e => e.type === 'subscription.activated')

describe('ManualSubscriptionService: criação', () => {
  it('cria cobrança manual: item active/manual no SPA, título "GPTMaker — cliente.bitrix24.com.br", um subscription.activated', async () => {
    const { h, create, c } = await setup()
    const trial = spaSubscriptions(h)[0]!
    const created = await create()

    const item = h.crm.items.get(SUBSCRIPTION_TYPE)!.get(created.id)!
    expect(item.title).toBe('GPTMaker — cliente.bitrix24.com.br')
    expect(item[c.subscription.plan]).toBe(501)
    expect(item[c.subscription.status]).toBe(statusId(h, 'active'))
    expect(item[c.subscription.modality]).toBe('manual')
    expect(String(item[c.subscription.periodStart])).toContain('2026-09-01')
    expect(String(item[c.subscription.periodEnd])).toContain('2027-09-01')

    const events = activated(h)
    expect(events).toHaveLength(1)
    expect(events[0]!.dedupeKey).toBe(`activated:${created.id}`)
    expect(events[0]!.payload.data.previousSubscriptionId).toBe(trial.id)
    expect(events[0]!.payload.subscription.modality).toBe('manual')
  })

  it('bonificação: título "Bonificação — Básico — cliente.bitrix24.com.br" e comentário com motivo e responsável', async () => {
    const { h, create } = await setup()
    const created = await create({
      kind: 'bonus',
      approvedBy: 'Maria (financeiro)',
    })

    expect(created.title).toBe('Bonificação — Básico — cliente.bitrix24.com.br')
    const comment = h.crm.comments.find(
      x => x.entityTypeId === SUBSCRIPTION_TYPE && x.id === created.id,
    )!
    expect(comment.comment).toContain('contrato 123 com o financeiro')
    expect(comment.comment).toContain('Maria (financeiro)')
    expect(comment.comment).toContain('operator:1')
  })

  it('schema: bonificação sem approvedBy é recusada; cobrança manual sem approvedBy passa', () => {
    const base = { planId: 501, periodEnd: '2027-09-01' }
    expect(
      createManualSubscriptionSchema.safeParse({ ...base, kind: 'bonus' })
        .success,
    ).toBe(false)
    expect(
      createManualSubscriptionSchema.safeParse({
        ...base,
        kind: 'bonus',
        approvedBy: '  ',
      }).success,
    ).toBe(false)
    expect(
      createManualSubscriptionSchema.safeParse({ ...base, kind: 'manual' })
        .success,
    ).toBe(true)
    expect(
      createManualSubscriptionSchema.safeParse({
        ...base,
        kind: 'manual',
        extra: 1,
      }).success,
    ).toBe(false)
  })

  it('instalação em trial: o trial vira cancelled e não gera evento próprio', async () => {
    const { h, create } = await setup()
    const trial = spaSubscriptions(h)[0]!
    await create()

    expect(
      h.crm.items.get(SUBSCRIPTION_TYPE)!.get(Number(trial.id)),
    ).toMatchObject({
      [h.config.subscription.status]: statusId(h, 'cancelled'),
    })
    expect(outbox(h).some(e => e.type === 'subscription.ended')).toBe(false)
    expect(activated(h)).toHaveLength(1)
  })

  it('instalação sem trial (trialOnInstall: false): previousSubscriptionId é null', async () => {
    const { h, create } = await setup({ app: { trialOnInstall: false } })
    expect(spaSubscriptions(h)).toHaveLength(0)
    await create()
    expect(activated(h)[0]!.payload.data.previousSubscriptionId).toBeNull()
  })
})

describe('ManualSubscriptionService: uma assinatura vigente', () => {
  it('assinatura vigente (active ou past_due) bloqueia: 409 SUBSCRIPTION_ALREADY_EXISTS com details {subscriptionId, modality, status}', async () => {
    const { h, create } = await setup()
    const first = await create()

    const error = await create().catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 409,
      code: 'SUBSCRIPTION_ALREADY_EXISTS',
      details: {
        subscriptionId: first.id,
        modality: 'manual',
        status: 'active',
      },
    })

    setStatus(h, first.id, 'past_due')
    await expect(create()).rejects.toMatchObject({
      code: 'SUBSCRIPTION_ALREADY_EXISTS',
      details: { status: 'past_due' },
    })
    expect(activated(h)).toHaveLength(1)
  })

  it('assinatura cancelada ou trial_expired não bloqueia', async () => {
    const { h, create } = await setup()
    const first = await create()
    setStatus(h, first.id, 'cancelled')
    const second = await create({ planId: 502 })
    expect(second.id).not.toBe(first.id)

    setStatus(h, second.id, 'trial_expired')
    await expect(create()).resolves.toMatchObject({ status: 'active' })
  })

  it('criações simultâneas na mesma instalação: só uma vence', async () => {
    const { create } = await setup()
    const results = await Promise.allSettled([create(), create()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected')
    expect(['SUBSCRIPTION_ALREADY_EXISTS', 'BILLING_BUSY']).toContain(
      (rejected?.reason as { code: string }).code,
    )
  })
})

describe('ManualSubscriptionService: validação', () => {
  it('período: fim <= início, fim > início + 24 meses e data inexistente são INVALID_PERIOD sem escrita; início omitido vale hoje', async () => {
    const { h, create } = await setup()
    const before = h.crm.calls.length
    await rejectsWith(
      create({ periodEnd: '2026-09-01' }),
      422,
      'INVALID_PERIOD',
    )
    await rejectsWith(
      create({ periodEnd: '2026-08-31' }),
      422,
      'INVALID_PERIOD',
    )
    await rejectsWith(
      create({ periodEnd: '2028-09-02' }),
      422,
      'INVALID_PERIOD',
    )
    await rejectsWith(
      create({ periodEnd: '2026-02-31' }),
      422,
      'INVALID_PERIOD',
    )
    await rejectsWith(
      create({ periodStart: '2027-01-10', periodEnd: '2027-01-09' }),
      422,
      'INVALID_PERIOD',
    )
    expect(h.crm.calls.length).toBe(before)

    const ok = await create({ periodEnd: '2028-09-01' })
    expect(ok.periodStart.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('plano inválido: de outro app ⇒ 404 PLAN_NOT_FOUND; inativo ⇒ 422 PLAN_INACTIVE; trial (500) e compra única (510) ⇒ 400 PLAN_TYPE_MISMATCH', async () => {
    const { h, create, c } = await setup()
    h.crm.seed(c.entityTypes.product, {
      id: 12,
      title: 'Outro app',
      [c.product.billingModel]: '13605',
      [c.product.active]: 'Y',
    })
    const plan = (id: number, productId: number, active: 'Y' | 'N') =>
      h.crm.seed(c.entityTypes.plan, {
        id,
        title: `Plano ${id}`,
        [c.plan.product]: productId,
        [c.plan.value]: 1000,
        [c.plan.interval]: '13609',
        [c.plan.active]: active,
        [c.plan.gatewayIdHomolog]: `price_${id}`,
        [c.plan.gatewayIdProduction]: `price_${id}_live`,
      })
    plan(600, 12, 'Y')
    plan(601, 10, 'N')

    await rejectsWith(create({ planId: 600 }), 404, 'PLAN_NOT_FOUND')
    await rejectsWith(create({ planId: 999 }), 404, 'PLAN_NOT_FOUND')
    await rejectsWith(create({ planId: 601 }), 422, 'PLAN_INACTIVE')
    await rejectsWith(create({ planId: 500 }), 400, 'PLAN_TYPE_MISMATCH')
    await rejectsWith(create({ planId: 510 }), 400, 'PLAN_TYPE_MISMATCH')
    expect(activated(h)).toHaveLength(0)
  })

  it('fora da produção: 409 SUBSCRIPTIONS_READ_ONLY', async () => {
    const { h, create } = await setup({
      env: { PLATFORM_ENVIRONMENT: 'homolog' },
    })
    const before = h.crm.calls.length
    await rejectsWith(create(), 409, 'SUBSCRIPTIONS_READ_ONLY')
    expect(h.crm.calls.length).toBe(before)
  })

  it('instalação inexistente ⇒ 404 INSTALLATION_NOT_FOUND; não ACTIVE ⇒ 409 INSTALLATION_NOT_ACTIVE', async () => {
    const { h, create } = await setup()
    await rejectsWith(create({}, 987654), 404, 'INSTALLATION_NOT_FOUND')
    h.db.rows('installation')[0]!.status = 'UNINSTALLED'
    await rejectsWith(create(), 409, 'INSTALLATION_NOT_ACTIVE')
  })
})

describe('ManualSubscriptionService: gravação e evento', () => {
  it('releitura diverge: 502 SUBSCRIPTION_WRITE_FAILED com details {id, created: true} e nenhum evento', async () => {
    const { h, create, c } = await setup()
    const add = h.crm.addItem.bind(h.crm)
    let createdId = 0
    h.crm.addItem = async (entityTypeId, fields) => {
      if (entityTypeId !== SUBSCRIPTION_TYPE) return add(entityTypeId, fields)
      const item = await add(entityTypeId, {
        ...fields,
        [c.subscription.periodEnd]: '2027-10-01T12:00:00.000Z',
      })
      createdId = Number(item.id)
      return item
    }

    const error = await create().catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 502,
      code: 'SUBSCRIPTION_WRITE_FAILED',
      details: { id: createdId, created: true },
    })
    expect(createdId).toBeGreaterThan(0)
    expect(activated(h)).toHaveLength(0)
  })

  it('falha no comentário não derruba a criação', async () => {
    const { h, create } = await setup()
    h.crm.addTimelineComment = async () => {
      throw new Error('bitrix fora do ar')
    }
    const created = await create({ kind: 'bonus', approvedBy: 'Maria' })
    expect(created.status).toBe('active')
    expect(activated(h)).toHaveLength(1)
  })

  it('anti-loop: depois de criar, ManualLifecycle.apply(id) não emite mais nada', async () => {
    const { h, create } = await setup()
    const created = await create()
    const before = outbox(h).length
    await h.container.manual.apply(created.id)
    expect(outbox(h)).toHaveLength(before)
  })
})
