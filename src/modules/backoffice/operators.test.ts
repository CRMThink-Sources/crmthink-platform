import { describe, expect, it } from 'vitest'
import { FakePrisma } from '@/test/fake-prisma'
import { OperatorService } from './application/operators'
import { needsRehash, verifyPassword } from './application/passwords'

function setup() {
  const db = new FakePrisma()
  const revoked: Array<[number, number | undefined]> = []
  const service = new OperatorService(db.asDb(), async (id, except) => {
    revoked.push([id, except])
  })
  return { db, service, revoked }
}

describe('operadores', () => {
  it('cria conta com senha provisória e sem TOTP, guardando só o hash', async () => {
    const { db, service } = setup()
    const issued = await service.create({
      email: '  Dev@ConnectThink.com.br ',
      name: 'Dev',
      role: 'operator',
    })

    expect(issued.operator).toMatchObject({
      email: 'dev@connectthink.com.br',
      role: 'operator',
      active: true,
      mustChangePassword: true,
      totpConfigured: false,
    })
    expect(issued.temporaryPassword.length).toBeGreaterThanOrEqual(12)
    expect(Object.keys(issued)).not.toContain('totpUri')
    expect(Object.keys(issued.operator)).not.toContain('passwordHash')

    const row = db.rows('adminOperator')[0]!
    expect(row.passwordHash).toMatch(/^\$argon2id\$/)
    expect(needsRehash(row.passwordHash)).toBe(false)
    expect(
      await verifyPassword(row.passwordHash, issued.temporaryPassword),
    ).toBe(true)
    expect(row.totpSecretEnc).toBeNull()
  })

  it('a lista indica quem já cadastrou o autenticador', async () => {
    const { db, service } = setup()
    await service.create({ email: 'a@x.com', name: 'A', role: 'viewer' })
    await service.create({ email: 'b@x.com', name: 'B', role: 'viewer' })
    db.rows('adminOperator')[1]!.totpSecretEnc = 'v1:qualquer'

    const list = await service.list()

    expect(list.map(o => [o.email, o.totpConfigured])).toEqual([
      ['a@x.com', false],
      ['b@x.com', true],
    ])
  })

  it('recusa e-mail repetido sem diferenciar maiúsculas', async () => {
    const { service } = setup()
    await service.create({
      email: 'dev@connectthink.com.br',
      name: 'Dev',
      role: 'operator',
    })
    await expect(
      service.create({
        email: 'Dev@ConnectThink.com.br',
        name: 'Outro',
        role: 'viewer',
      }),
    ).rejects.toMatchObject({ code: 'OPERATOR_EMAIL_TAKEN', status: 409 })
  })

  describe('papel e estado', () => {
    async function twoAccounts() {
      const ctx = setup()
      const dev = await ctx.service.create({
        email: 'dev@connectthink.com.br',
        name: 'Dev',
        role: 'operator',
      })
      const suporte = await ctx.service.create({
        email: 'suporte@connectthink.com.br',
        name: 'Suporte',
        role: 'viewer',
      })
      return { ...ctx, devId: dev.operator.id, suporteId: suporte.operator.id }
    }

    it('último operator ativo não pode ser rebaixado nem desativado', async () => {
      const { service, devId } = await twoAccounts()
      await expect(
        service.update(devId, { role: 'viewer' }, devId),
      ).rejects.toMatchObject({ code: 'LAST_OPERATOR', status: 409 })
      await expect(
        service.update(devId, { active: false }, null),
      ).rejects.toMatchObject({ code: 'LAST_OPERATOR' })
    })

    it('não desativa nem rebaixa a própria conta', async () => {
      const { service, devId, suporteId } = await twoAccounts()
      await service.update(suporteId, { role: 'operator' }, devId)
      await expect(
        service.update(devId, { active: false }, devId),
      ).rejects.toMatchObject({ code: 'OPERATOR_SELF_CHANGE', status: 409 })
      await expect(
        service.update(devId, { role: 'viewer' }, devId),
      ).rejects.toMatchObject({ code: 'OPERATOR_SELF_CHANGE' })
    })

    it('troca de papel e desativação derrubam as sessões', async () => {
      const { service, devId, suporteId, revoked } = await twoAccounts()
      const promoted = await service.update(
        suporteId,
        { role: 'operator' },
        devId,
      )
      expect(promoted.role).toBe('operator')
      await service.update(suporteId, { active: false }, devId)
      expect(revoked).toEqual([
        [suporteId, undefined],
        [suporteId, undefined],
      ])
    })

    it('operador inexistente', async () => {
      const { service } = setup()
      await expect(
        service.update(99, { active: false }, null),
      ).rejects.toMatchObject({ code: 'OPERATOR_NOT_FOUND', status: 404 })
    })
  })

  it('redefinir acesso gera senha nova, apaga o TOTP, desbloqueia e derruba sessões', async () => {
    const { db, service, revoked } = setup()
    const first = await service.create({
      email: 'suporte@connectthink.com.br',
      name: 'Suporte',
      role: 'viewer',
    })
    const row = db.rows('adminOperator')[0]!
    Object.assign(row, {
      mustChangePassword: false,
      failedLogins: 5,
      lockedUntil: new Date('2099-01-01'),
      lastTotpStep: 123,
      totpSecretEnc: 'v1:segredo-antigo',
    })

    const reset = await service.resetAccess(first.operator.id)

    expect(reset.temporaryPassword).not.toBe(first.temporaryPassword)
    expect(Object.keys(reset)).not.toContain('totpUri')
    expect(row).toMatchObject({
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
      lastTotpStep: 0,
      totpSecretEnc: null,
    })
    expect(
      await verifyPassword(row.passwordHash, first.temporaryPassword),
    ).toBe(false)
    expect(revoked).toEqual([[first.operator.id, undefined]])
  })

  describe('troca da própria senha', () => {
    it('exige a senha atual e ao menos 12 caracteres; mantém a sessão atual', async () => {
      const { db, service, revoked } = setup()
      const issued = await service.create({
        email: 'dev@connectthink.com.br',
        name: 'Dev',
        role: 'operator',
      })
      const id = issued.operator.id

      await expect(
        service.changePassword(id, {
          currentPassword: 'errada',
          newPassword: 'uma-senha-longa-o-bastante',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
      await expect(
        service.changePassword(id, {
          currentPassword: issued.temporaryPassword,
          newPassword: 'curta',
        }),
      ).rejects.toMatchObject({ name: 'ZodError' })

      const view = await service.changePassword(
        id,
        {
          currentPassword: issued.temporaryPassword,
          newPassword: 'uma-senha-longa-o-bastante',
        },
        7,
      )
      expect(view.mustChangePassword).toBe(false)
      expect(
        await verifyPassword(
          db.rows('adminOperator')[0]!.passwordHash,
          'uma-senha-longa-o-bastante',
        ),
      ).toBe(true)
      expect(revoked).toEqual([[id, 7]])
    })
  })
})
