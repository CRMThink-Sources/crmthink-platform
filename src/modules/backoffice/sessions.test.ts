import { describe, expect, it } from 'vitest'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { FakePrisma } from '@/test/fake-prisma'
import { FakeClock, TEST_KEY } from '@/test/fakes'
import { OperatorService } from './application/operators'
import { AdminSessions, hashSessionToken } from './application/sessions'
import { runCreateOperator } from './application/create-operator-cli'

const MINUTE = 60_000

function setup() {
  const db = new FakePrisma()
  const clock = new FakeClock()
  db.useClock(() => clock.now())
  const sessions = new AdminSessions(db.asDb(), clock, {
    sessionIdleMs: 30 * MINUTE,
    sessionMaxMs: 12 * 60 * MINUTE,
  })
  const operators = new OperatorService(
    db.asDb(),
    createTokenCipher(TEST_KEY),
    'CRMThink Backoffice',
    (id, except) => sessions.revokeAll(id, except),
  )
  return { db, clock, sessions, operators }
}

async function withOperator(ctx: ReturnType<typeof setup>) {
  const dev = await ctx.operators.create({
    email: 'dev@connectthink.com.br',
    name: 'Dev',
    role: 'operator',
  })
  const suporte = await ctx.operators.create({
    email: 'suporte@connectthink.com.br',
    name: 'Suporte',
    role: 'viewer',
  })
  return { devId: dev.operator.id, suporteId: suporte.operator.id }
}

describe('sessões do backoffice', () => {
  it('guarda só o hash do valor do cookie (256 bits)', async () => {
    const ctx = setup()
    const { devId } = await withOperator(ctx)
    const { token } = await ctx.sessions.create(devId, {
      ip: '10.0.0.1',
      userAgent: 'vitest',
    })
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    const row = ctx.db.rows('adminSession')[0]!
    expect(row.idHash).toBe(hashSessionToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect((await ctx.sessions.resolve(token)).status).toBe('ok')
  })

  it('expira após 30 min sem uso e não volta a valer', async () => {
    const ctx = setup()
    const { devId } = await withOperator(ctx)
    const { token } = await ctx.sessions.create(devId)

    ctx.clock.advance(29 * MINUTE)
    expect((await ctx.sessions.resolve(token)).status).toBe('ok')
    ctx.clock.advance(29 * MINUTE)
    expect((await ctx.sessions.resolve(token)).status).toBe('ok')
    ctx.clock.advance(31 * MINUTE)
    expect((await ctx.sessions.resolve(token)).status).toBe('expired')
    expect((await ctx.sessions.resolve(token)).status).toBe('invalid')
  })

  it('só regrava lastSeenAt a cada minuto', async () => {
    const ctx = setup()
    const { devId } = await withOperator(ctx)
    const { token } = await ctx.sessions.create(devId)
    const row = ctx.db.rows('adminSession')[0]!
    const created = row.lastSeenAt.getTime()

    ctx.clock.advance(30_000)
    await ctx.sessions.resolve(token)
    expect(row.lastSeenAt.getTime()).toBe(created)
    ctx.clock.advance(31_000)
    await ctx.sessions.resolve(token)
    expect(row.lastSeenAt.getTime()).toBe(created + 61_000)
  })

  it('expira 12 h após o login mesmo em uso', async () => {
    const ctx = setup()
    const { devId } = await withOperator(ctx)
    const { token } = await ctx.sessions.create(devId)
    for (let i = 0; i < 47; i++) {
      ctx.clock.advance(15 * MINUTE)
      expect((await ctx.sessions.resolve(token)).status).toBe('ok')
    }
    ctx.clock.advance(15 * MINUTE)
    expect((await ctx.sessions.resolve(token)).status).toBe('expired')
  })

  it('desativação, troca de papel e redefinição derrubam as sessões da conta', async () => {
    const ctx = setup()
    const { devId, suporteId } = await withOperator(ctx)

    const a = await ctx.sessions.create(suporteId)
    await ctx.operators.update(suporteId, { role: 'operator' }, devId)
    expect((await ctx.sessions.resolve(a.token)).status).toBe('invalid')

    const b = await ctx.sessions.create(suporteId)
    await ctx.operators.resetAccess(suporteId)
    expect((await ctx.sessions.resolve(b.token)).status).toBe('invalid')

    const c = await ctx.sessions.create(suporteId)
    await ctx.operators.update(suporteId, { active: false }, devId)
    expect((await ctx.sessions.resolve(c.token)).status).toBe('invalid')
  })

  it('logout revoga só a sessão', async () => {
    const ctx = setup()
    const { devId } = await withOperator(ctx)
    const one = await ctx.sessions.create(devId)
    const two = await ctx.sessions.create(devId)
    await ctx.sessions.revoke(one.sessionId)
    expect((await ctx.sessions.resolve(one.token)).status).toBe('invalid')
    expect((await ctx.sessions.resolve(two.token)).status).toBe('ok')
  })
})

describe('yarn admin:create-operator', () => {
  it('cria o operador e mostra senha e URI uma vez', async () => {
    const ctx = setup()
    const lines: string[] = []
    await runCreateOperator(
      [
        '--email',
        'Dev@ConnectThink.com.br',
        '--name',
        'Dev',
        '--role',
        'operator',
      ],
      ctx.operators,
      line => lines.push(line),
    )
    expect(ctx.db.rows('adminOperator')[0]).toMatchObject({
      email: 'dev@connectthink.com.br',
      role: 'operator',
    })
    expect(lines.join('\n')).toMatch(/Senha provisória .*: \S{12,}/)
    expect(lines.join('\n')).toContain('otpauth://totp/')
  })

  it('--reset redefine o acesso de quem existe', async () => {
    const ctx = setup()
    const { suporteId } = await withOperator(ctx)
    const session = await ctx.sessions.create(suporteId)
    const before = ctx.db.rows('adminOperator')[1]!.passwordHash
    const lines: string[] = []
    await runCreateOperator(
      ['--email', 'suporte@connectthink.com.br', '--reset'],
      ctx.operators,
      line => lines.push(line),
    )
    expect(lines[0]).toContain('Acesso redefinido')
    expect(ctx.db.rows('adminOperator')[1]!.passwordHash).not.toBe(before)
    expect((await ctx.sessions.resolve(session.token)).status).toBe('invalid')
  })

  it('recusa argumentos faltando ou papel inválido', async () => {
    const ctx = setup()
    await expect(
      runCreateOperator(['--email', 'a@b.com'], ctx.operators, () => {}),
    ).rejects.toThrow(/--name e --role/)
    await expect(
      runCreateOperator(
        ['--email', 'a@b.com', '--name', 'A', '--role', 'admin'],
        ctx.operators,
        () => {},
      ),
    ).rejects.toThrow()
    await expect(
      runCreateOperator(
        ['--email', 'ninguem@b.com', '--reset'],
        ctx.operators,
        () => {},
      ),
    ).rejects.toThrow(/não encontrado/)
  })
})
