import { describe, expect, it } from 'vitest'
import { metrics } from '@/shared/observability/metrics'
import { http } from '@/test/app'
import { createHarness, seedGptMaker } from '@/test/harness'
import { maskSummary } from './application/audit'

describe('auditoria do backoffice', () => {
  it('mascara campos sensíveis e encurta textos longos', () => {
    expect(
      maskSummary({
        name: 'GPTMaker',
        bitrixClientSecret: 'segredo',
        password: 'x',
        newPassword: 'y',
        apiKey: 'cp_abc',
        code: '123456',
        appCode: 'crmthink.gptmaker',
        nested: { webhookSecret: 'whsec', ok: 1 },
        long: 'a'.repeat(300),
      }),
    ).toEqual({
      name: 'GPTMaker',
      bitrixClientSecret: '***',
      password: '***',
      newPassword: '***',
      apiKey: '***',
      code: '***',
      appCode: 'crmthink.gptmaker',
      nested: { webhookSecret: '***', ok: 1 },
      long: `${'a'.repeat(200)}…`,
    })
  })

  it('PATCH de app guarda o corpo mascarado no resumo', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    await http(h)
      .patch('/admin/apps/crmthink.gptmaker')
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'GPTMaker 2', bitrixClientSecret: 'novo-segredo' })
      .expect(200)
    const row = h.db
      .rows('adminAuditLog')
      .find(r => r.action === 'PATCH /admin/apps/:appCode')!
    expect(row.summary).toEqual({
      body: { name: 'GPTMaker 2', bitrixClientSecret: '***' },
    })
    expect(JSON.stringify(row)).not.toContain('novo-segredo')
  })

  it('falha ao gravar não muda a resposta da ação e conta na métrica', async () => {
    const h = createHarness()
    await seedGptMaker(h)
    const before =
      (await metrics.adminAuditWriteFailures.get()).values[0]?.value ?? 0
    ;(h.db as any).adminAuditLog.create = async () => {
      throw new Error('banco fora')
    }
    const response = await http(h)
      .post('/admin/apps/crmthink.gptmaker/rotate-webhook-secret')
      .set('Authorization', 'Bearer admin-token')
    expect(response.status).toBe(200)
    await new Promise(resolve => setTimeout(resolve, 0))
    const after = (await metrics.adminAuditWriteFailures.get()).values[0]?.value
    expect(after).toBe(before + 1)
  })

  it('retenção apaga só os registros mais antigos que o prazo', async () => {
    const h = createHarness()
    const db = h.db.asDb()
    const day = 86_400_000
    const at = (days: number) => new Date(h.clock.now().getTime() - days * day)
    for (const days of [400, 366, 364, 1]) {
      await db.adminAuditLog.create({
        data: { actor: 'token:abc', action: `a${days}`, createdAt: at(days) },
      })
    }
    expect(await h.container.audit.purgeExpired()).toEqual({ deleted: 2 })
    expect(h.db.rows('adminAuditLog').map(row => row.action)).toEqual([
      'a364',
      'a1',
    ])
  })

  it('leituras não geram registro', async () => {
    const h = createHarness()
    await http(h)
      .get('/admin/apps')
      .set('Authorization', 'Bearer admin-token')
      .expect(200)
    expect(h.db.rows('adminAuditLog')).toHaveLength(0)
  })
})
