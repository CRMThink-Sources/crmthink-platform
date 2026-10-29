import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import { createHarness, seedGptMaker, type Harness } from '@/test/harness'
import { OPERATIONS } from '@/docs/openapi/operations'
import { ADMIN_POLICIES } from './http/policy'

const TOKEN = { Authorization: 'Bearer admin-token' }
const MINUTE = 60_000

const get = (h: Harness, path: string) => http(h).get(path).set(TOKEN)

async function installation(
  h: Harness,
  id: number,
  overrides: Record<string, unknown> = {},
) {
  await h.db.asDb().installation.create({
    data: {
      id,
      appCode: 'crmthink.gptmaker',
      memberId: `member-${id}`,
      domain: `cliente${id}.bitrix24.com.br`,
      status: 'ACTIVE',
      installedAt: h.clock.now(),
      ...overrides,
    } as never,
  })
}

async function event(
  h: Harness,
  installationId: number,
  overrides: Record<string, unknown> = {},
) {
  const eventId = randomUUID()
  await h.db.asDb().outboxEvent.create({
    data: {
      eventId,
      appCode: 'crmthink.gptmaker',
      type: 'subscription.renewed',
      installationId,
      payload: { data: {} },
      createdAt: h.clock.now(),
      ...overrides,
    } as never,
  })
  return eventId
}

describe('paginação por cursor', () => {
  it('navega sem repetir itens mesmo com evento novo no meio', async () => {
    const h = createHarness()
    for (let i = 0; i < 5; i++) {
      await event(h, 1)
      h.clock.advance(MINUTE)
    }
    const first = await get(h, '/admin/events?limit=2').expect(200)
    expect(first.body.items).toHaveLength(2)
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const fresh = await event(h, 1)
    const second = await get(
      h,
      `/admin/events?limit=2&cursor=${first.body.nextCursor}`,
    ).expect(200)
    const third = await get(
      h,
      `/admin/events?limit=2&cursor=${second.body.nextCursor}`,
    ).expect(200)

    const ids = [
      ...first.body.items,
      ...second.body.items,
      ...third.body.items,
    ].map((item: { eventId: string }) => item.eventId)
    expect(new Set(ids).size).toBe(5)
    expect(ids).not.toContain(fresh)
    expect(third.body.nextCursor).toBeNull()
  })

  it('cursor adulterado ou limite fora da faixa: 400 VALIDATION_ERROR', async () => {
    const h = createHarness()
    const bad = await get(h, '/admin/events?cursor=abc').expect(400)
    expect(bad.body.error.code).toBe('VALIDATION_ERROR')
    await get(h, '/admin/audit?cursor=abc').expect(400)
    await get(h, '/admin/events?limit=500').expect(400)
  })

  it('filtra eventos dead de um app numa janela (to com data inclui o dia)', async () => {
    const h = createHarness()
    h.clock.current = new Date('2026-10-03T10:00:00Z')
    const inside = await event(h, 1, { status: 'dead' })
    h.clock.current = new Date('2026-10-07T22:00:00Z')
    const lastDay = await event(h, 1, { status: 'dead' })
    await event(h, 1, { status: 'delivered' })
    await event(h, 1, { status: 'dead', appCode: 'outro.app' })
    h.clock.current = new Date('2026-10-09T10:00:00Z')
    await event(h, 1, { status: 'dead' })

    const response = await get(
      h,
      '/admin/events?appCode=crmthink.gptmaker&status=dead&from=2026-10-01&to=2026-10-07',
    ).expect(200)
    expect(
      response.body.items.map((item: { eventId: string }) => item.eventId),
    ).toEqual([lastDay, inside])
  })
})

describe('eventos Stripe', () => {
  async function stripe(h: Harness) {
    await h.db.asDb().stripeEvent.create({
      data: {
        eventId: 'evt_123',
        type: 'invoice.paid',
        status: 'failed',
        payload: { id: 'evt_123', object: 'event' },
      } as never,
    })
  }

  it('lista sem payload; detalhe com payload só para operator', async () => {
    const h = createHarness()
    await stripe(h)
    const list = await get(h, '/admin/stripe-events').expect(200)
    expect(list.body.items[0]).not.toHaveProperty('payload')
    const detail = await get(h, '/admin/stripe-events/evt_123').expect(200)
    expect(detail.body.payload).toEqual({ id: 'evt_123', object: 'event' })
    await get(h, '/admin/stripe-events/evt_nao_existe').expect(404)
  })
})

describe('instalações', () => {
  async function seed(h: Harness) {
    await installation(h, 1, { domain: 'acme.bitrix24.com.br' })
    h.clock.advance(MINUTE)
    await installation(h, 2, {
      domain: 'outro.bitrix24.com.br',
      memberId: 'm-xyz',
    })
    h.clock.advance(MINUTE)
    await installation(h, 3, {
      domain: 'acme-filial.bitrix24.com',
      appCode: 'outro.app',
    })
    const db = h.db.asDb()
    const base = {
      accessTokenEnc: 'v1:x',
      refreshTokenEnc: 'v1:y',
      expiresAt: new Date('2026-09-01T13:00:00Z'),
    }
    await db.credential.create({
      data: { installationId: 1, ...base } as never,
    })
    await db.credential.create({
      data: {
        installationId: 2,
        ...base,
        refreshFailures: 3,
        lastRefreshError: 'invalid_grant',
      } as never,
    })
  }

  it('busca por trecho do domínio, memberId ou id, com saúde do token', async () => {
    const h = createHarness()
    await seed(h)
    const byDomain = await get(h, '/admin/installations?q=acme').expect(200)
    expect(byDomain.body.items.map((i: { id: number }) => i.id)).toEqual([3, 1])
    const byMember = await get(h, '/admin/installations?q=m-xyz').expect(200)
    expect(byMember.body.items.map((i: { id: number }) => i.id)).toEqual([2])
    const byId = await get(h, '/admin/installations?q=2').expect(200)
    expect(byId.body.items.map((i: { id: number }) => i.id)).toEqual([2])

    const all = await get(h, '/admin/installations').expect(200)
    expect(
      Object.fromEntries(
        all.body.items.map((i: { id: number; tokenHealth: string }) => [
          i.id,
          i.tokenHealth,
        ]),
      ),
    ).toEqual({ 1: 'ok', 2: 'refresh_failing', 3: 'missing' })
    const filtered = await get(
      h,
      '/admin/installations?appCode=outro.app',
    ).expect(200)
    expect(filtered.body.items).toHaveLength(1)
  })

  it('pagina instalações com a mesma data de instalação', async () => {
    const h = createHarness()
    for (let id = 1; id <= 5; id++) await installation(h, id)
    const seen: number[] = []
    let cursor: string | null = null
    do {
      const response: {
        body: { items: Array<{ id: number }>; nextCursor: string | null }
      } = await get(
        h,
        `/admin/installations?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200)
      seen.push(...response.body.items.map(item => item.id))
      cursor = response.body.nextCursor
    } while (cursor)
    expect(seen).toEqual([5, 4, 3, 2, 1])
  })

  it('detalhe com saúde do token sem tokens, contagem de eventos e assinatura indisponível', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    await seed(h)
    await event(h, 2, { status: 'dead' })
    await event(h, 2, { status: 'delivered' })
    h.container.subscriptionQueries.current = async () => {
      throw new Error('portal fora do ar')
    }

    const response = await get(h, '/admin/installations/2').expect(200)
    expect(response.body).toMatchObject({
      id: 2,
      tokenHealth: 'refresh_failing',
      token: {
        health: 'refresh_failing',
        refreshFailures: 3,
        lastRefreshError: 'invalid_grant',
        expiresAt: '2026-09-01T13:00:00.000Z',
      },
      events: { pending: 0, delivered: 1, dead: 1 },
      subscription: { available: false, reason: 'portal fora do ar' },
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /v1:|accessToken|refreshToken/,
    )
    await get(h, '/admin/installations/999').expect(404)
  })
})

describe('linha do tempo', () => {
  async function seed(h: Harness) {
    await installation(h, 7)
    const db = h.db.asDb()
    await db.installAttempt.create({
      data: { installationId: 7, step: 'installer', status: 'ok' } as never,
    })
    h.clock.advance(MINUTE)
    const dead = await event(h, 7, {
      status: 'dead',
      type: 'subscription.renewed',
    })
    await db.eventDelivery.create({
      data: {
        eventId: dead,
        attempt: 1,
        statusCode: 500,
        error: 'HTTP 500',
      } as never,
    })
    await db.eventDelivery.create({
      data: {
        eventId: dead,
        attempt: 2,
        statusCode: null,
        error: 'timeout',
      } as never,
    })
    h.clock.advance(MINUTE)
    await db.purchase.create({
      data: {
        appCode: 'crmthink.gptmaker',
        installationId: 7,
        planId: 510,
        checkoutSessionId: 'cs_1',
        status: 'paid',
        amount: 4900,
      } as never,
    })
    h.clock.advance(MINUTE)
    await db.adminAuditLog.create({
      data: {
        actor: 'operator:1',
        actorRole: 'operator',
        action: 'POST /admin/installations/:id/trial',
        targetType: 'installation',
        targetId: '7',
        statusCode: 201,
        createdAt: h.clock.now(),
      } as never,
    })
    // De outra instalação: não aparece.
    await event(h, 8)
    return { dead }
  }

  it('junta as fontes do mais recente para o mais antigo, com as entregas do evento', async () => {
    const h = createHarness()
    const { dead } = await seed(h)
    const response = await get(h, '/admin/installations/7/timeline').expect(200)
    const items = response.body.items as Array<{
      kind: string
      data: any
      ref: any
    }>
    expect(items.map(item => item.kind)).toEqual([
      'admin_action',
      'purchase',
      'event',
      'install_attempt',
    ])
    const deadItem = items[2]!
    expect(deadItem.ref).toEqual({ type: 'outbox_event', id: dead })
    expect(deadItem.data.status).toBe('dead')
    expect(deadItem.data.deliveries).toEqual([
      expect.objectContaining({
        attempt: 2,
        statusCode: null,
        error: 'timeout',
      }),
      expect.objectContaining({
        attempt: 1,
        statusCode: 500,
        error: 'HTTP 500',
      }),
    ])
    expect(deadItem.data).not.toHaveProperty('payload')
  })

  it('filtra por tipo', async () => {
    const h = createHarness()
    await seed(h)
    const response = await get(
      h,
      '/admin/installations/7/timeline?kind=admin_action',
    ).expect(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].data.action).toBe(
      'POST /admin/installations/:id/trial',
    )
    await get(h, '/admin/installations/7/timeline?kind=xyz').expect(400)
  })

  it('pagina entre fontes com o mesmo instante sem repetir nem pular', async () => {
    const h = createHarness()
    await installation(h, 7)
    const db = h.db.asDb()
    for (let i = 0; i < 3; i++) {
      await db.installAttempt.create({
        data: { installationId: 7, step: `s${i}`, status: 'ok' } as never,
      })
      await event(h, 7)
      await db.purchase.create({
        data: {
          appCode: 'crmthink.gptmaker',
          installationId: 7,
          planId: 510,
          checkoutSessionId: `cs_${i}`,
          status: 'paid',
        } as never,
      })
    }
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const response: {
        body: {
          items: Array<{ ref: { type: string; id: string } }>
          nextCursor: string | null
        }
      } = await get(
        h,
        `/admin/installations/7/timeline?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200)
      seen.push(
        ...response.body.items.map(item => `${item.ref.type}:${item.ref.id}`),
      )
      cursor = response.body.nextCursor
    } while (cursor)
    expect(seen).toHaveLength(9)
    expect(new Set(seen).size).toBe(9)
  })

  it('instalação inexistente: 404', async () => {
    const h = createHarness()
    const response = await get(h, '/admin/installations/404/timeline').expect(
      404,
    )
    expect(response.body.error.code).toBe('INSTALLATION_NOT_FOUND')
  })
})

describe('auditoria', () => {
  it('filtra por alvo, do mais recente para o mais antigo', async () => {
    const h = createHarness()
    const db = h.db.asDb()
    for (const [targetId, action] of [
      ['crmthink.gptmaker', 'PATCH /admin/apps/:appCode'],
      ['outro.app', 'PATCH /admin/apps/:appCode'],
      ['crmthink.gptmaker', 'POST /admin/apps/:appCode/rotate-api-key'],
    ] as const) {
      await db.adminAuditLog.create({
        data: {
          actor: 'token:abc',
          action,
          targetType: 'app',
          targetId,
          statusCode: 200,
        } as never,
      })
    }
    await db.adminAuditLog.create({
      data: {
        actor: 'anonymous',
        action: 'auth.login_failed',
        statusCode: 401,
        errorCode: 'INVALID_CREDENTIALS',
      } as never,
    })

    const response = await get(
      h,
      '/admin/audit?targetType=app&targetId=crmthink.gptmaker',
    ).expect(200)
    expect(
      response.body.items.map((i: { action: string }) => i.action),
    ).toEqual([
      'POST /admin/apps/:appCode/rotate-api-key',
      'PATCH /admin/apps/:appCode',
    ])
    const failures = await get(h, '/admin/audit?result=failure').expect(200)
    expect(
      failures.body.items.map((i: { action: string }) => i.action),
    ).toEqual(['auth.login_failed'])
  })

  it('não há rota de alteração em /admin/audit', () => {
    const routes = OPERATIONS.filter(op => op.path.startsWith('/admin/audit'))
    expect(routes.map(op => op.method)).toEqual(['get'])
  })
})

describe('painel', () => {
  it('conta eventos, trials que terminam em 7 dias e usa cache de 60 s', async () => {
    const h = createHarness()
    await installation(h, 1)
    await installation(h, 2, { status: 'INSTALL_PENDING' })
    for (let i = 0; i < 12; i++) await event(h, 1, { status: 'dead' })
    await event(h, 1, { status: 'pending' })
    const trialEndsAt = (days: number) =>
      new Date(h.clock.now().getTime() + days * 86_400_000).toISOString()
    await event(h, 1, {
      type: 'subscription.trial_started',
      status: 'delivered',
      subscriptionId: 100,
      payload: { data: { trialEndsAt: trialEndsAt(3), trialDays: 14 } },
    })
    // Trial que já virou assinatura paga: não conta.
    await event(h, 2, {
      type: 'subscription.trial_started',
      status: 'delivered',
      subscriptionId: 200,
      payload: { data: { trialEndsAt: trialEndsAt(5), trialDays: 14 } },
    })
    h.clock.advance(MINUTE)
    await event(h, 2, {
      type: 'subscription.activated',
      status: 'delivered',
      subscriptionId: 200,
    })

    const response = await get(h, '/admin/overview').expect(200)
    expect(response.body.events.byApp).toEqual([
      { appCode: 'crmthink.gptmaker', pending: 1, dead: 12 },
    ])
    expect(response.body.installations).toEqual([
      { appCode: 'crmthink.gptmaker', status: 'ACTIVE', count: 1 },
      { appCode: 'crmthink.gptmaker', status: 'INSTALL_PENDING', count: 1 },
    ])
    expect(response.body.trialsEndingSoon).toMatchObject({
      count: 1,
      items: [{ installationId: 1, subscriptionId: 100 }],
    })

    await event(h, 1, { status: 'dead' })
    const cached = await get(h, '/admin/overview').expect(200)
    expect(cached.body.events.byApp[0].dead).toBe(12)
    expect(cached.body.computedAt).toBe(response.body.computedAt)
  })
})

describe('política de acesso × contrato', () => {
  it('toda operação de operador tem política e vice-versa', () => {
    const fromOperations = OPERATIONS.filter(op => op.path.startsWith('/admin'))
      .map(
        op =>
          `${op.method.toUpperCase()} ${op.path.replace(/\{([^}]+)\}/g, ':$1')}`,
      )
      .sort()
    expect(Object.keys(ADMIN_POLICIES).sort()).toEqual(fromOperations)
  })
})
