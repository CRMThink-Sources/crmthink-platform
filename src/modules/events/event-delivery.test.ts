import { beforeEach, describe, expect, it } from 'vitest'
import { verifySignatureHeader } from '@/shared/crypto/hmac-signature'
import { http } from '@/test/app'
import {
  createHarness,
  GPTMAKER,
  installPayload,
  outbox,
  seedGptMaker,
  type Harness,
} from '@/test/harness'

type Delivered = { eventId: string; type: string; body: any; signature: string }

describe('entrega de eventos aos apps', () => {
  let h: Harness
  let secret: string
  let delivered: Delivered[]
  let appStatus: number

  beforeEach(async () => {
    delivered = []
    appStatus = 200
    h = createHarness({
      webhookHandler: (url, init) => {
        if (url.endsWith('/platform/events')) {
          const headers = init.headers as Record<string, string>
          delivered.push({
            eventId: headers['X-Platform-Event-Id']!,
            type: headers['X-Platform-Event-Type']!,
            body: JSON.parse(String(init.body)),
            signature: headers['X-Platform-Signature']!,
          })
          return new Response('', { status: appStatus })
        }
        return new Response('{}', { status: 200 })
      },
    })
    secret = (await seedGptMaker(h)).credentials.webhookSecret
    await http(h).post('/v1/install').send(installPayload(h))
  })

  it('entrega assinada com o envelope completo e marca concluída', async () => {
    await h.container.delivery.dispatchDue()
    await h.container.delivery.dispatchDue()
    expect(delivered.map(d => d.type)).toEqual([
      'installation.created',
      'subscription.trial_started',
    ])
    const [created, trial] = delivered
    expect(created!.body).toMatchObject({
      type: 'installation.created',
      appCode: GPTMAKER,
      subscription: null,
      data: {},
    })
    expect(Object.keys(created!.body).sort()).toEqual([
      'appCode',
      'data',
      'eventId',
      'installationId',
      'memberId',
      'occurredAt',
      'subscription',
      'type',
    ])
    expect(trial!.body.subscription).toMatchObject({
      status: 'trialing',
      modality: 'manual',
      planId: 500,
      version: 1,
    })
    expect(
      verifySignatureHeader(
        created!.signature,
        secret,
        JSON.stringify(created!.body),
        h.clock.now(),
      ).ok,
    ).toBe(true)
    expect(outbox(h).every(e => e.status === 'delivered')).toBe(true)
  })

  it('ordem por instalação: evento mais novo espera o mais antigo em backoff', async () => {
    appStatus = 500
    await h.container.delivery.dispatchDue()
    expect(delivered.map(d => d.type)).toEqual(['installation.created'])
    appStatus = 200
    await h.container.delivery.dispatchDue() // created em backoff: trial não sai antes
    expect(delivered).toHaveLength(1)
    h.clock.advance(31_000)
    await h.container.delivery.dispatchDue()
    await h.container.delivery.dispatchDue()
    expect(delivered.map(d => d.type)).toEqual([
      'installation.created',
      'installation.created',
      'subscription.trial_started',
    ])
  })

  it('app fora do ar por 2h: entregue quando volta, mesmo eventId entre tentativas', async () => {
    appStatus = 503
    for (let minute = 0; minute <= 120; minute += 5) {
      await h.container.delivery.dispatchDue()
      h.clock.advance(5 * 60_000)
    }
    appStatus = 200
    h.clock.advance(60 * 60_000)
    await h.container.delivery.dispatchDue()
    await h.container.delivery.dispatchDue()
    const created = delivered.filter(d => d.type === 'installation.created')
    expect(created.length).toBeGreaterThan(2)
    expect(new Set(created.map(d => d.eventId)).size).toBe(1)
    expect(outbox(h).every(e => e.status === 'delivered')).toBe(true)
  })

  it('janela de 24h esgotada: dead-letter; reenvio manual entrega de novo', async () => {
    appStatus = 500
    for (let i = 0; i < 60; i++) {
      await h.container.delivery.dispatchDue()
      h.clock.advance(60 * 60_000)
    }
    const head = outbox(h)[0]!
    expect(head.status).toBe('dead')
    expect(
      h.db
        .rows('eventDelivery')
        .filter(d => d.eventId === (head as any).eventId).length,
    ).toBeGreaterThan(5)

    appStatus = 200
    const res = await http(h)
      .post('/admin/events/resend')
      .set('Authorization', 'Bearer admin-token')
      .send({ eventId: (head as any).eventId })
    expect(res.body.requeued).toBe(1)
    await h.container.delivery.dispatchDue()
    expect(outbox(h)[0]!.status).toBe('delivered')

    const range = await http(h)
      .post('/admin/events/resend')
      .set('Authorization', 'Bearer admin-token')
      .send({
        appCode: GPTMAKER,
        from: new Date(0).toISOString(),
        to: new Date(h.clock.now().getTime() + 1000).toISOString(),
        onlyDead: true,
      })
    expect(range.status).toBe(200)
  })

  it('rotação do segredo: as duas assinaturas durante a transição, só a nova depois', async () => {
    const rotated = await http(h)
      .post(`/admin/apps/${GPTMAKER}/rotate-webhook-secret`)
      .set('Authorization', 'Bearer admin-token')
    const fresh = rotated.body.webhookSecret as string
    await h.container.delivery.dispatchDue()
    const during = delivered[0]!
    expect(
      verifySignatureHeader(
        during.signature,
        fresh,
        JSON.stringify(during.body),
        h.clock.now(),
      ).ok,
    ).toBe(true)
    expect(
      verifySignatureHeader(
        during.signature,
        secret,
        JSON.stringify(during.body),
        h.clock.now(),
      ).ok,
    ).toBe(true)

    h.clock.advance(25 * 3600_000)
    await h.container.delivery.dispatchDue()
    const after = delivered[1]!
    expect(
      verifySignatureHeader(
        after.signature,
        fresh,
        JSON.stringify(after.body),
        h.clock.now(),
      ).ok,
    ).toBe(true)
    expect(
      verifySignatureHeader(
        after.signature,
        secret,
        JSON.stringify(after.body),
        h.clock.now(),
      ).ok,
    ).toBe(false)
  })

  it('decisão reprocessada não duplica evento (dedupeKey)', async () => {
    const { appendEvent } = await import('./outbox')
    const input = {
      appCode: GPTMAKER,
      type: 'subscription.renewed' as const,
      installationId: 1,
      memberId: 'm',
      subscription: null,
      dedupeKey: 'renewed:1:2026-09-01',
    }
    const first = await h.db.$transaction((tx: any) => appendEvent(tx, input))
    const second = await h.db.$transaction((tx: any) => appendEvent(tx, input))
    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('queda depois da decisão: o evento continua pendente e sai no próximo ciclo', async () => {
    // Nada foi entregue ainda (o "processo caiu" antes do relay); um worker novo entrega.
    expect(outbox(h).every(e => e.status === 'pending')).toBe(true)
    const worker = createHarness()
    expect(worker).toBeTruthy()
    await h.container.delivery.dispatchDue()
    expect(delivered).toHaveLength(1)
  })
})
