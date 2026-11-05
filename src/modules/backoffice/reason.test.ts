import { describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import { createHarness, seedGptMaker, GPTMAKER } from '@/test/harness'
import { ADMIN_POLICIES, isHighImpact } from './http/policy'

const TOKEN = { Authorization: 'Bearer admin-token' }
const EVENT_ID = '00000000-0000-4000-8000-000000000000'

const audit = (h: ReturnType<typeof createHarness>) =>
  h.db.rows('adminAuditLog') as Array<Record<string, any>>

describe('motivo da ação (X-Admin-Reason)', () => {
  it('rotação sem motivo: 400 REASON_REQUIRED, a chave não muda e a tentativa é auditada', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    const before = h.db
      .rows('app')
      .find(a => a.appCode === GPTMAKER)!.apiKeyHash

    const response = await http(h)
      .post(`/admin/apps/${GPTMAKER}/rotate-api-key`)
      .set(TOKEN)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('REASON_REQUIRED')
    expect(h.db.rows('app').find(a => a.appCode === GPTMAKER)!.apiKeyHash).toBe(
      before,
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(
      audit(h).find(
        r => r.action === 'POST /admin/apps/:appCode/rotate-api-key',
      ),
    ).toMatchObject({ statusCode: 400, errorCode: 'REASON_REQUIRED' })
  })

  it('com motivo a rotação segue e o registro de auditoria guarda o motivo', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    const response = await http(h)
      .post(`/admin/apps/${GPTMAKER}/rotate-api-key`)
      .set(TOKEN)
      .set('X-Admin-Reason', 'chave vazou em um print')
    expect(response.status).toBe(200)
    await new Promise(resolve => setTimeout(resolve, 0))
    const row = audit(h).find(
      r => r.action === 'POST /admin/apps/:appCode/rotate-api-key',
    )!
    expect(row.statusCode).toBe(200)
    expect(row.summary).toEqual({ reason: 'chave vazou em um print' })
  })

  it('o motivo vale para qualquer mutação, mesmo as que não o exigem', async () => {
    const h = createHarness()
    await http(h)
      .post('/admin/events/resend')
      .set(TOKEN)
      .set('X-Admin-Reason', 'cliente relatou webhook perdido')
      .send({ eventId: EVENT_ID })
      .expect(200)
    await new Promise(resolve => setTimeout(resolve, 0))
    const row = audit(h).find(r => r.action === 'POST /admin/events/resend')!
    expect(row.summary).toEqual({
      body: { eventId: EVENT_ID },
      reason: 'cliente relatou webhook perdido',
    })
  })

  it('motivo longo ou com quebra de linha: 400 REASON_INVALID', async () => {
    const h = createHarness()
    const long = await http(h)
      .post('/admin/events/resend')
      .set(TOKEN)
      .set('X-Admin-Reason', 'a'.repeat(501))
      .send({ eventId: EVENT_ID })
    expect(long.status).toBe(400)
    expect(long.body.error.code).toBe('REASON_INVALID')

    const max = await http(h)
      .post('/admin/events/resend')
      .set(TOKEN)
      .set('X-Admin-Reason', 'a'.repeat(500))
      .send({ eventId: EVENT_ID })
    expect(max.status).toBe(200)
  })

  it('o motivo de 500 caracteres não é encurtado pelo mascaramento da auditoria', async () => {
    const h = createHarness()
    const reason = 'b'.repeat(500)
    await http(h)
      .post('/admin/events/resend')
      .set(TOKEN)
      .set('X-Admin-Reason', reason)
      .send({ eventId: EVENT_ID })
      .expect(200)
    await new Promise(resolve => setTimeout(resolve, 0))
    const row = audit(h).find(r => r.action === 'POST /admin/events/resend')!
    expect(row.summary.reason).toBe(reason)
  })
})

describe('mapa de alto impacto', () => {
  const marked = Object.entries(ADMIN_POLICIES)
    .filter(([, policy]) => policy.highImpact)
    .map(([key]) => key)
    .sort()

  it('as sete operações de alto impacto estão marcadas', () => {
    expect(marked).toEqual(
      [
        'PATCH /admin/apps/:appCode',
        'POST /admin/apps/:appCode/reveal-webhook-secret',
        'POST /admin/apps/:appCode/rotate-api-key',
        'POST /admin/apps/:appCode/rotate-webhook-secret',
        'POST /admin/events/resend',
        'POST /admin/operators/:id/reset-access',
        'POST /admin/signing-keys/rotate',
      ].sort(),
    )
  })

  it('só mutações podem ser de alto impacto', () => {
    for (const key of marked) expect(key.startsWith('GET ')).toBe(false)
  })

  it('desativar app e reenvio em lote dependem do corpo', () => {
    const patch = ADMIN_POLICIES['PATCH /admin/apps/:appCode']!
    expect(isHighImpact(patch, { active: false })).toBe(true)
    expect(isHighImpact(patch, { name: 'Novo nome' })).toBe(false)
    expect(isHighImpact(patch, { active: true })).toBe(false)

    const resend = ADMIN_POLICIES['POST /admin/events/resend']!
    expect(isHighImpact(resend, { eventId: EVENT_ID })).toBe(false)
    expect(isHighImpact(resend, { appCode: GPTMAKER })).toBe(true)
    expect(isHighImpact(resend, { appCode: GPTMAKER, dryRun: true })).toBe(
      false,
    )
  })

  it('reenvio em lote sem motivo é recusado antes de executar', async () => {
    const h = createHarness()
    const response = await http(h)
      .post('/admin/events/resend')
      .set(TOKEN)
      .send({
        appCode: GPTMAKER,
        from: new Date(0).toISOString(),
        to: new Date(1000).toISOString(),
      })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('REASON_REQUIRED')
  })
})

describe('consulta do segredo de webhook', () => {
  const reveal = (h: ReturnType<typeof createHarness>, appCode = GPTMAKER) =>
    http(h).post(`/admin/apps/${appCode}/reveal-webhook-secret`).set(TOKEN)

  it('sem motivo: 400 REASON_REQUIRED e nenhum segredo na resposta', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    const res = await reveal(h)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REASON_REQUIRED')
    expect(JSON.stringify(res.body)).not.toContain('whsec_')
  })

  it('com motivo: devolve o segredo cadastrado, sem cache, e audita só o motivo', async () => {
    const h = createHarness()
    const { credentials } = await seedGptMaker(h)
    const res = await reveal(h).set('X-Admin-Reason', 'perdi o valor do cofre')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ webhookSecret: credentials.webhookSecret })
    expect(res.headers['cache-control']).toBe('no-store')

    await new Promise(resolve => setTimeout(resolve, 0))
    const row = audit(h).find(
      r => r.action === 'POST /admin/apps/:appCode/reveal-webhook-secret',
    )!
    expect(row).toMatchObject({
      targetType: 'app',
      targetId: GPTMAKER,
      statusCode: 200,
    })
    expect(row.summary).toEqual({ reason: 'perdi o valor do cofre' })
    expect(JSON.stringify(audit(h))).not.toContain(credentials.webhookSecret)
  })

  it('depois de rotacionar, devolve o segredo novo', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    const rotated = await http(h)
      .post(`/admin/apps/${GPTMAKER}/rotate-webhook-secret`)
      .set(TOKEN)
      .set('X-Admin-Reason', 'rotina')
    const res = await reveal(h).set('X-Admin-Reason', 'conferir')
    expect(res.body.webhookSecret).toBe(rotated.body.webhookSecret)
  })

  it('app inexistente: 404 APP_NOT_FOUND', async () => {
    const h = createHarness()
    const res = await reveal(h, 'nao.existe').set('X-Admin-Reason', 'teste')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('APP_NOT_FOUND')
  })

  it('é só para operator (suporte não consulta segredo)', () => {
    expect(
      ADMIN_POLICIES['POST /admin/apps/:appCode/reveal-webhook-secret']!.role,
    ).toBe('operator')
  })
})
