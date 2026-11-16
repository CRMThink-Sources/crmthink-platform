import { describe, expect, it } from 'vitest'
import { computeSignature } from '@/shared/crypto/hmac-signature'
import { metrics } from '@/shared/observability/metrics'
import {
  createHarness,
  GPTMAKER,
  seedGptMaker,
  type Harness,
} from '@/test/harness'
import type { EventType } from './domain/event'
import { RESEND_LIMIT } from './event-delivery'
import { appendEvent, type AppendEventInput } from './outbox'

const ERP = 'https://erp.example.com/hooks'
const OTHER = 'https://financeiro.example.com/hooks'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
const ok = () => new Response('{}', { status: 200 })

async function setup(handler: Handler = ok) {
  const h = createHarness({ webhookHandler: handler })
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
  const endpoint = (url = ERP, types: EventType[] = ['subscription.renewed']) =>
    h.container.webhookEndpoints.create({
      name: url,
      url,
      eventTypes: types,
      appCodes: [],
    })
  const calls = (url: string) => h.http.calls.filter(call => call.url === url)
  const delivery = (id: number) =>
    h.db.rows('webhookDelivery').find(row => row.id === id)!
  return {
    h,
    emit,
    endpoint,
    calls,
    delivery,
    relay: h.container.webhookDelivery,
  }
}

const header = (init: RequestInit, name: string) =>
  (init.headers as Record<string, string>)[name]

/** Roda o relay (avançando o relógio) até a entrega sair de `pending`. */
async function runUntilSettled(
  h: Harness,
  relay: Awaited<ReturnType<typeof setup>>['relay'],
  id: number,
) {
  for (let i = 0; i < 80; i++) {
    await relay.dispatchDue()
    const row = h.db.rows('webhookDelivery').find(r => r.id === id)!
    if (row.status !== 'pending') return row
    h.clock.advance(61 * 60_000)
  }
  throw new Error('entrega não saiu de pending')
}

describe('relay de destinatários: entrega', () => {
  it('entrega o envelope do evento, assinado com o segredo do destinatário', async () => {
    const { h, emit, endpoint, calls, delivery, relay } = await setup()
    const { endpoint: erp, secret } = await endpoint()
    await emit()
    const event = h.db.rows('outboxEvent')[0]!
    const id = h.db.rows('webhookDelivery')[0]!.id

    expect(await relay.dispatchDue()).toBe(1)

    const [call] = calls(ERP)
    const body = call!.init.body as string
    expect(body).toBe(JSON.stringify(event.payload))
    expect(call!.init.method).toBe('POST')
    expect(call!.init.redirect).toBe('manual')
    expect(header(call!.init, 'X-Platform-Event-Id')).toBe(event.eventId)
    expect(header(call!.init, 'X-Platform-Event-Type')).toBe(
      'subscription.renewed',
    )
    const signature = header(call!.init, 'X-Platform-Signature')!
    const t = Number(/t=(\d+)/.exec(signature)![1])
    expect(signature).toContain(`v1=${computeSignature(secret, t, body)}`)
    expect(body).not.toContain('whsec_')

    expect(delivery(id)).toMatchObject({
      status: 'delivered',
      attempts: 1,
      endpointId: erp.id,
    })
    expect(delivery(id).deliveredAt).toBeInstanceOf(Date)
    const attempt = h.db.rows('webhookDeliveryAttempt')[0]!
    expect(attempt).toMatchObject({
      deliveryId: id,
      attempt: 1,
      statusCode: 200,
    })
  })

  it('durante a rotação a assinatura leva um v1 por segredo vigente', async () => {
    const { h, emit, endpoint, calls, relay } = await setup()
    const { endpoint: erp, secret: old } = await endpoint()
    const rotated = await h.container.webhookEndpoints.rotateSecret(erp.id)
    await emit()

    await relay.dispatchDue()

    const init = calls(ERP)[0]!.init
    const signature = header(init, 'X-Platform-Signature')!
    const t = Number(/t=(\d+)/.exec(signature)![1])
    const body = init.body as string
    expect(signature).toContain(
      `v1=${computeSignature(rotated.secret, t, body)}`,
    )
    expect(signature).toContain(`v1=${computeSignature(old, t, body)}`)
  })
})

describe('relay de destinatários: falha e dead-letter', () => {
  it('5xx reagenda com o backoff exponencial (30 s, depois 60 s)', async () => {
    const { h, emit, endpoint, delivery, relay } = await setup(
      () => new Response('erro', { status: 500 }),
    )
    await endpoint()
    await emit()
    const id = h.db.rows('webhookDelivery')[0]!.id
    const start = h.clock.now().getTime()

    await relay.dispatchDue()
    expect(delivery(id)).toMatchObject({ status: 'pending', attempts: 1 })
    expect(delivery(id).nextAttemptAt.getTime()).toBe(start + 30_000)
    expect(h.db.rows('webhookDeliveryAttempt')[0]).toMatchObject({
      statusCode: 500,
      error: 'HTTP 500',
    })

    expect(await relay.dispatchDue()).toBe(0) // ainda em backoff
    h.clock.advance(30_000)
    await relay.dispatchDue()
    expect(delivery(id).attempts).toBe(2)
    expect(delivery(id).nextAttemptAt.getTime()).toBe(
      h.clock.now().getTime() + 60_000,
    )
  })

  it('erro de rede é registrado sem status e reagenda', async () => {
    const { h, emit, endpoint, delivery, relay } = await setup(() => {
      throw new Error('connect ECONNREFUSED')
    })
    await endpoint()
    await emit()
    const id = h.db.rows('webhookDelivery')[0]!.id
    await relay.dispatchDue()
    expect(delivery(id).status).toBe('pending')
    expect(h.db.rows('webhookDeliveryAttempt')[0]).toMatchObject({
      statusCode: null,
      error: 'connect ECONNREFUSED',
    })
  })

  it('3xx conta como falha e o redirecionamento não é seguido', async () => {
    const { h, emit, endpoint, calls, delivery, relay } = await setup(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://interno.local/segredo' },
        }),
    )
    await endpoint()
    await emit()
    const id = h.db.rows('webhookDelivery')[0]!.id

    await relay.dispatchDue()

    expect(delivery(id).status).toBe('pending')
    expect(h.db.rows('webhookDeliveryAttempt')[0]).toMatchObject({
      statusCode: 302,
      error: 'HTTP 302',
    })
    expect(h.http.calls.map(call => call.url)).toEqual([ERP])
    expect(calls('https://interno.local/segredo')).toHaveLength(0)
  })

  it('passada a janela, a entrega vira dead com alerta', async () => {
    const { h, emit, endpoint, relay } = await setup(
      () => new Response('fora', { status: 503 }),
    )
    await endpoint()
    await emit()
    const id = h.db.rows('webhookDelivery')[0]!.id
    const alerts = () =>
      metrics.operationalAlerts
        .get()
        .then(
          metric =>
            metric.values.find(v => v.labels.kind === 'webhook.dead_letter')
              ?.value ?? 0,
        )
    const before = await alerts()

    const row = await runUntilSettled(h, relay, id)

    expect(row.status).toBe('dead')
    expect(row.deadAt).toBeInstanceOf(Date)
    expect(await alerts()).toBe(before + 1)
  })
})

describe('relay de destinatários: independência', () => {
  it('destinatário fora do ar não atrasa a entrega ao app nem a outro destinatário', async () => {
    const { h, emit, endpoint, calls, relay } = await setup(url =>
      url === ERP ? new Response('fora', { status: 503 }) : ok(),
    )
    await endpoint(ERP)
    await endpoint(OTHER)
    await emit()

    await h.container.delivery.dispatchDue() // o app
    await relay.dispatchDue() // os destinatários

    expect(h.db.rows('outboxEvent')[0]).toMatchObject({ status: 'delivered' })
    const byEndpoint = h.db
      .rows('webhookDelivery')
      .map(row => [row.endpointId, row.status])
    expect(byEndpoint).toEqual([
      [1, 'pending'],
      [2, 'delivered'],
    ])
    expect(calls(ERP)).toHaveLength(1)
    expect(calls(OTHER)).toHaveLength(1)
  })

  it('o relay dos apps continua entregando só ao app (sem tocar nas entregas dos destinatários)', async () => {
    const { h, emit, endpoint } = await setup()
    await endpoint()
    await emit()
    await h.container.delivery.dispatchDue()
    expect(h.db.rows('webhookDelivery')[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
    })
    expect(h.db.rows('eventDelivery')).toHaveLength(1)
  })
})

describe('relay de destinatários: ordem', () => {
  it('uma entrega antiga em retentativa segura as seguintes do mesmo par; outras instalações seguem', async () => {
    let first = true
    const { h, emit, endpoint, calls, relay } = await setup(url => {
      if (url === ERP && first) {
        first = false
        return new Response('erro', { status: 500 })
      }
      return ok()
    })
    await endpoint()
    await emit({ installationId: 7 })
    await emit({ installationId: 7 })
    await emit({ installationId: 8 })
    const rows = h.db.rows('webhookDelivery')

    await relay.dispatchDue()
    // inst. 7: a primeira falhou e a segunda espera; inst. 8: entregue.
    expect(rows.map(r => [r.installationId, r.status, r.attempts])).toEqual([
      [7, 'pending', 1],
      [7, 'pending', 0],
      [8, 'delivered', 1],
    ])

    await relay.dispatchDue()
    expect(calls(ERP)).toHaveLength(2) // nada novo: segue em backoff

    h.clock.advance(30_000)
    await relay.dispatchDue() // a primeira da inst. 7 sai
    await relay.dispatchDue() // só agora a segunda
    expect(rows.map(r => r.status)).toEqual([
      'delivered',
      'delivered',
      'delivered',
    ])
    expect(rows[0]!.deliveredAt!.getTime()).toBeLessThanOrEqual(
      rows[1]!.deliveredAt!.getTime(),
    )
  })

  it('entrega dead não bloqueia as seguintes', async () => {
    let down = true
    const { h, emit, endpoint, relay } = await setup(url =>
      url === ERP && down ? new Response('fora', { status: 503 }) : ok(),
    )
    await endpoint()
    await emit()
    const firstId = h.db.rows('webhookDelivery')[0]!.id
    await runUntilSettled(h, relay, firstId) // vira dead

    down = false
    await emit()
    await relay.dispatchDue()

    const rows = h.db.rows('webhookDelivery')
    expect(rows.map(r => r.status)).toEqual(['dead', 'delivered'])
  })

  it('destinatário desativado não recebe tentativas e retoma ao reativar', async () => {
    const { h, emit, endpoint, calls, delivery, relay } = await setup()
    const { endpoint: erp } = await endpoint()
    await emit()
    const id = h.db.rows('webhookDelivery')[0]!.id

    await h.container.webhookEndpoints.update(erp.id, { active: false })
    await relay.dispatchDue()
    expect(calls(ERP)).toHaveLength(0)
    expect(delivery(id)).toMatchObject({ status: 'pending', attempts: 0 })

    await h.container.webhookEndpoints.update(erp.id, { active: true })
    await relay.dispatchDue()
    expect(delivery(id).status).toBe('delivered')
  })
})

describe('relay de destinatários: reenvio e contagens', () => {
  it('reenviar uma entrega morta a devolve a pending com janela nova e ela sai', async () => {
    let down = true
    const { h, emit, endpoint, delivery, relay } = await setup(url =>
      url === ERP && down ? new Response('fora', { status: 503 }) : ok(),
    )
    await endpoint()
    await emit()
    const id = h.db.rows('webhookDelivery')[0]!.id
    await runUntilSettled(h, relay, id)
    expect(delivery(id).status).toBe('dead')

    down = false
    await relay.resend(id)
    expect(delivery(id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      deadAt: null,
    })
    expect(delivery(id).windowStartedAt).toEqual(h.clock.now())

    await relay.dispatchDue()
    expect(delivery(id).status).toBe('delivered')
  })

  it('reenviar entrega inexistente: 404 WEBHOOK_DELIVERY_NOT_FOUND', async () => {
    const { relay } = await setup()
    await expect(relay.resend(999)).rejects.toMatchObject({
      status: 404,
      code: 'WEBHOOK_DELIVERY_NOT_FOUND',
    })
  })

  it('reenviar as mortas: dryRun só conta; de verdade reenvia só as mortas do destinatário', async () => {
    const { h, emit, endpoint, relay } = await setup(
      () => new Response('fora', { status: 503 }),
    )
    const { endpoint: erp } = await endpoint(ERP)
    const { endpoint: other } = await endpoint(OTHER)
    for (let i = 0; i < 3; i++) await emit()
    for (const row of h.db.rows('webhookDelivery')) {
      row.status = 'dead'
      row.deadAt = h.clock.now()
    }

    expect(await relay.resendDead(erp.id, { dryRun: true })).toEqual({
      matched: 3,
      requeued: 0,
    })
    expect(h.db.rows('webhookDelivery').every(r => r.status === 'dead')).toBe(
      true,
    )

    expect(await relay.resendDead(erp.id, {})).toEqual({
      matched: 3,
      requeued: 3,
    })
    const byEndpoint = (id: number) =>
      h.db
        .rows('webhookDelivery')
        .filter(r => r.endpointId === id)
        .map(r => r.status)
    expect(byEndpoint(erp.id)).toEqual(['pending', 'pending', 'pending'])
    expect(byEndpoint(other.id)).toEqual(['dead', 'dead', 'dead'])
  })

  it('reenvio em lote acima do limite: 422 RESEND_TOO_LARGE; destinatário inexistente: 404', async () => {
    const { h, endpoint, relay } = await setup()
    const { endpoint: erp } = await endpoint()
    for (let i = 0; i < RESEND_LIMIT + 1; i++)
      h.db.rows('webhookDelivery').push({
        id: 1000 + i,
        endpointId: erp.id,
        eventId: `ev-${i}`,
        status: 'dead',
      })
    await expect(relay.resendDead(erp.id, {})).rejects.toMatchObject({
      status: 422,
      code: 'RESEND_TOO_LARGE',
    })
    await expect(relay.resendDead(999, {})).rejects.toMatchObject({
      status: 404,
      code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
    })
  })

  it('contagens de pendentes e mortas por destinatário', async () => {
    const { h, emit, endpoint, relay } = await setup()
    const { endpoint: erp } = await endpoint()
    for (let i = 0; i < 3; i++) await emit()
    h.db.rows('webhookDelivery')[0]!.status = 'dead'
    h.db.rows('webhookDelivery')[1]!.status = 'delivered'
    expect(await relay.counts(erp.id)).toEqual({ pending: 1, dead: 1 })
  })
})
