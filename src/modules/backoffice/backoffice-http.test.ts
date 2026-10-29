import { describe, expect, it } from 'vitest'
import { totpCode, totpStep } from '@/shared/crypto/totp'
import { http } from '@/test/app'
import { createHarness, seedGptMaker, type Harness } from '@/test/harness'
import { tokenActorId } from './http/actor'

const ORIGIN = 'https://platform.test'
const PASSWORD = 'senha-definitiva-123'
const MINUTE = 60_000

function setup() {
  return createHarness({ env: { BACKOFFICE_ORIGINS: ORIGIN } })
}

/** Cria o operador; `ready` já troca a senha provisória (o caso comum dos testes). */
async function operator(
  h: Harness,
  email: string,
  role: 'viewer' | 'operator',
  options: { ready?: boolean } = {},
) {
  const issued = await h.container.operators.create({
    email,
    name: email.split('@')[0]!,
    role,
  })
  const secret = new URL(issued.totpUri).searchParams.get('secret')!
  let password = issued.temporaryPassword
  if (options.ready !== false) {
    await h.container.operators.changePassword(issued.operator.id, {
      currentPassword: password,
      newPassword: PASSWORD,
    })
    password = PASSWORD
  }
  return { id: issued.operator.id, email, password, secret }
}

const code = (h: Harness, secret: string) =>
  totpCode(secret, totpStep(h.clock.now()))

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'] as string[] | undefined
  const value = header?.[0]?.split(';')[0]
  if (!value) throw new Error('sem cookie de sessão')
  return value
}

async function login(
  h: Harness,
  account: { email: string; password: string; secret: string },
) {
  const response = await http(h)
    .post('/admin/auth/login')
    .set('Origin', ORIGIN)
    .send({
      email: account.email,
      password: account.password,
      code: code(h, account.secret),
    })
  expect(response.status).toBe(200)
  // O próximo login precisa de um passo TOTP novo (o atual já foi usado).
  h.clock.advance(30_000)
  return cookieOf(response)
}

const audit = (h: Harness) =>
  h.db.rows('adminAuditLog') as Array<Record<string, any>>

describe('login do backoffice', () => {
  it('cria a sessão com cookie HttpOnly, Secure, SameSite=Strict e Path=/admin', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const response = await http(h)
      .post('/admin/auth/login')
      .set('Origin', ORIGIN)
      .send({
        email: 'DEV@connectthink.com.br',
        password: PASSWORD,
        code: code(h, dev.secret),
      })

    expect(response.status).toBe(200)
    expect(response.body.operator).toMatchObject({
      email: 'dev@connectthink.com.br',
      role: 'operator',
    })
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!
    expect(cookie).toMatch(/^cp_admin_session=[A-Za-z0-9_-]{43};/)
    expect(cookie).toContain('Path=/admin')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')

    const me = await http(h)
      .get('/admin/auth/me')
      .set('Cookie', cookieOf(response))
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({
      kind: 'operator',
      actor: `operator:${dev.id}`,
      role: 'operator',
    })
    expect(audit(h).map(row => row.action)).toContain('auth.login_succeeded')
  })

  it('qualquer falha responde o mesmo INVALID_CREDENTIALS', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const attempts = [
      { email: 'dev@connectthink.com.br', password: PASSWORD, code: '000000' },
      {
        email: 'dev@connectthink.com.br',
        password: 'errada-errada',
        code: code(h, dev.secret),
      },
      {
        email: 'ninguem@connectthink.com.br',
        password: PASSWORD,
        code: code(h, dev.secret),
      },
    ]
    const bodies = []
    for (const body of attempts) {
      const response = await http(h).post('/admin/auth/login').send(body)
      expect(response.status).toBe(401)
      bodies.push(response.body)
    }
    expect(new Set(bodies.map(body => JSON.stringify(body))).size).toBe(1)
    expect(bodies[0].error.code).toBe('INVALID_CREDENTIALS')

    const failures = audit(h).filter(row => row.action === 'auth.login_failed')
    expect(failures.map(row => row.summary.reason)).toEqual([
      'bad_totp',
      'bad_password',
      'unknown_account',
    ])
    expect(failures[2]!.summary.accountExists).toBe(false)
    expect(JSON.stringify(failures)).not.toContain(PASSWORD)
  })

  it('código TOTP já usado não vale de novo', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const body = {
      email: dev.email,
      password: PASSWORD,
      code: code(h, dev.secret),
    }
    expect((await http(h).post('/admin/auth/login').send(body)).status).toBe(
      200,
    )
    const replay = await http(h).post('/admin/auth/login').send(body)
    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('conta inativa não entra', async () => {
    const h = setup()
    await operator(h, 'dev@connectthink.com.br', 'operator')
    const suporte = await operator(h, 'suporte@connectthink.com.br', 'viewer')
    await h.container.operators.update(suporte.id, { active: false }, null)
    const response = await http(h)
      .post('/admin/auth/login')
      .send({
        email: suporte.email,
        password: PASSWORD,
        code: code(h, suporte.secret),
      })
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('login de outra origem é recusado', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const response = await http(h)
      .post('/admin/auth/login')
      .set('Origin', 'https://evil.test')
      .send({ email: dev.email, password: PASSWORD, code: code(h, dev.secret) })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })

  it('senha provisória: só a troca de senha até trocar', async () => {
    const h = setup()
    const nova = await operator(h, 'nova@connectthink.com.br', 'viewer', {
      ready: false,
    })
    const cookie = await login(h, nova)

    const blocked = await http(h).get('/admin/apps').set('Cookie', cookie)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    expect(
      (await http(h).get('/admin/auth/me').set('Cookie', cookie)).status,
    ).toBe(200)

    const changed = await http(h)
      .post('/admin/auth/password')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({
        currentPassword: nova.password,
        newPassword: 'nova-senha-segura-1',
      })
    expect(changed.status).toBe(200)
    expect(changed.body.operator.mustChangePassword).toBe(false)
    expect(
      (await http(h).get('/admin/apps').set('Cookie', cookie)).status,
    ).toBe(200)
    expect(audit(h).map(row => row.action)).toContain('auth.password_changed')
  })
})

describe('limite de tentativas', () => {
  it('5 falhas seguidas bloqueiam a conta por 15 min, mesmo com credenciais corretas', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    for (let i = 0; i < 5; i++) {
      await http(h)
        .post('/admin/auth/login')
        .send({ email: dev.email, password: 'errada-errada', code: '000000' })
    }
    const locked = await http(h)
      .post('/admin/auth/login')
      .send({ email: dev.email, password: PASSWORD, code: code(h, dev.secret) })
    expect(locked.status).toBe(401)
    expect(locked.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(
      audit(h).filter(row => row.action === 'auth.account_locked'),
    ).toHaveLength(1)
    expect(h.db.rows('adminOperator')[0]!.lockedUntil).toBeInstanceOf(Date)

    h.clock.advance(16 * MINUTE)
    const ok = await http(h)
      .post('/admin/auth/login')
      .send({ email: dev.email, password: PASSWORD, code: code(h, dev.secret) })
    expect(ok.status).toBe(200)
    expect(h.db.rows('adminOperator')[0]).toMatchObject({
      failedLogins: 0,
      lockedUntil: null,
    })
  })

  it('sucesso zera a contagem de falhas', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const fail = () =>
      http(h)
        .post('/admin/auth/login')
        .send({ email: dev.email, password: 'x', code: '000000' })
    for (let i = 0; i < 4; i++) await fail()
    await login(h, dev)
    for (let i = 0; i < 4; i++) await fail()
    expect(h.db.rows('adminOperator')[0]!.lockedUntil).toBeNull()
  })

  it('a 21ª tentativa do mesmo IP em 15 min recebe 429 com Retry-After', async () => {
    const h = setup()
    for (let i = 0; i < 20; i++) {
      const response = await http(h)
        .post('/admin/auth/login')
        .send({
          email: `x${i}@connectthink.com.br`,
          password: 'x',
          code: '000000',
        })
      expect(response.status).toBe(401)
    }
    const limited = await http(h)
      .post('/admin/auth/login')
      .send({ email: 'x@connectthink.com.br', password: 'x', code: '000000' })
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS')
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(900)
  })
})

describe('sessão', () => {
  it('31 min sem uso: 401 e registro de expiração', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const cookie = await login(h, dev)
    h.clock.advance(31 * MINUTE)
    const response = await http(h).get('/admin/apps').set('Cookie', cookie)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
    expect(audit(h).map(row => row.action)).toContain('auth.session_expired')
    expect(
      (await http(h).get('/admin/apps').set('Cookie', cookie)).status,
    ).toBe(401)
  })

  it('logout revoga a sessão e apaga o cookie', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const cookie = await login(h, dev)
    const out = await http(h)
      .post('/admin/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
    expect(out.status).toBe(204)
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toContain(
      'Max-Age=0',
    )
    expect(
      (await http(h).get('/admin/auth/me').set('Cookie', cookie)).status,
    ).toBe(401)
    expect(audit(h).map(row => row.action)).toContain('auth.logout')
  })

  it('desativar a conta derruba a sessão aberta', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const suporte = await operator(h, 'suporte@connectthink.com.br', 'viewer')
    const devCookie = await login(h, dev)
    const suporteCookie = await login(h, suporte)
    const response = await http(h)
      .patch(`/admin/operators/${suporte.id}`)
      .set('Cookie', devCookie)
      .set('Origin', ORIGIN)
      .send({ active: false })
    expect(response.status).toBe(200)
    expect(
      (await http(h).get('/admin/apps').set('Cookie', suporteCookie)).status,
    ).toBe(401)
  })
})

describe('papéis, origem e tokens', () => {
  async function accounts() {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const suporte = await operator(h, 'suporte@connectthink.com.br', 'viewer')
    return {
      h,
      dev,
      suporte,
      devCookie: await login(h, dev),
      suporteCookie: await login(h, suporte),
    }
  }

  it('suporte lê, mas não age (403 FORBIDDEN_ROLE, registrado na auditoria)', async () => {
    const { h, suporteCookie, suporte } = await accounts()
    expect(
      (await http(h).get('/admin/apps').set('Cookie', suporteCookie)).status,
    ).toBe(200)
    expect(
      (await http(h).get('/admin/events').set('Cookie', suporteCookie)).status,
    ).toBe(200)

    const denied = await http(h)
      .post('/admin/events/resend')
      .set('Cookie', suporteCookie)
      .set('Origin', ORIGIN)
      .send({ eventId: '00000000-0000-4000-8000-000000000000' })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('FORBIDDEN_ROLE')
    const row = audit(h).find(r => r.action === 'POST /admin/events/resend')
    expect(row).toMatchObject({
      actor: `operator:${suporte.id}`,
      actorRole: 'viewer',
      statusCode: 403,
      errorCode: 'FORBIDDEN_ROLE',
    })

    const operators = await http(h)
      .get('/admin/operators')
      .set('Cookie', suporteCookie)
    expect(operators.status).toBe(403)
  })

  it('mutação com sessão exige Origin do backoffice', async () => {
    const { h, devCookie } = await accounts()
    const none = await http(h)
      .post('/admin/sweeps/spa')
      .set('Cookie', devCookie)
    expect(none.status).toBe(403)
    expect(none.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    const evil = await http(h)
      .post('/admin/sweeps/spa')
      .set('Cookie', devCookie)
      .set('Origin', 'https://evil.test')
    expect(evil.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })

  it('token de script funciona sem cookie e sem Origin, auditado pelo prefixo', async () => {
    const h = setup()
    await seedGptMaker(h)
    const response = await http(h)
      .post('/admin/apps/crmthink.gptmaker/rotate-api-key')
      .set('Authorization', 'Bearer admin-token')
    expect(response.status).toBe(200)
    const row = audit(h).find(
      r => r.action === 'POST /admin/apps/:appCode/rotate-api-key',
    )
    expect(row).toMatchObject({
      actor: tokenActorId('admin-token'),
      actorRole: 'operator',
      targetType: 'app',
      targetId: 'crmthink.gptmaker',
      statusCode: 200,
    })
    expect(tokenActorId('admin-token')).toMatch(/^token:[0-9a-f]{8}$/)
    expect(JSON.stringify(audit(h))).not.toContain(response.body.apiKey)

    const me = await http(h)
      .get('/admin/auth/me')
      .set('Authorization', 'Bearer admin-token')
    expect(me.body).toEqual({
      kind: 'token',
      actor: tokenActorId('admin-token'),
      role: 'operator',
    })
  })

  it('Bearer inválido não cai para o cookie', async () => {
    const { h, devCookie } = await accounts()
    const response = await http(h)
      .get('/admin/apps')
      .set('Cookie', devCookie)
      .set('Authorization', 'Bearer errado')
    expect(response.status).toBe(401)
  })

  it('sem credencial: 401', async () => {
    const h = setup()
    expect((await http(h).get('/admin/apps')).status).toBe(401)
    expect((await http(h).post('/admin/sweeps/spa')).status).toBe(401)
    expect(audit(h)).toHaveLength(0)
  })
})

describe('gestão de operadores', () => {
  it('cria, lista sem segredos e redefine o acesso', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const cookie = await login(h, dev)
    const send = (method: 'post' | 'patch', path: string, body?: object) =>
      http(h)
        [method](path)
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send(body)

    const created = await send('post', '/admin/operators', {
      email: 'suporte@connectthink.com.br',
      name: 'Suporte',
      role: 'viewer',
    })
    expect(created.status).toBe(201)
    expect(created.body.temporaryPassword).toBeTruthy()
    expect(created.body.totpUri).toMatch(/^otpauth:\/\/totp\//)
    const id = created.body.operator.id

    const listed = await http(h).get('/admin/operators').set('Cookie', cookie)
    expect(listed.body.items).toHaveLength(2)
    const text = JSON.stringify(listed.body)
    expect(text).not.toMatch(/passwordHash|totpSecret|argon2|v1:/)

    const duplicate = await send('post', '/admin/operators', {
      email: 'Suporte@connectthink.com.br',
      name: 'X',
      role: 'viewer',
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('OPERATOR_EMAIL_TAKEN')

    const reset = await send('post', `/admin/operators/${id}/reset-access`)
    expect(reset.status).toBe(200)
    expect(reset.body.temporaryPassword).not.toBe(
      created.body.temporaryPassword,
    )

    const self = await send('patch', `/admin/operators/${dev.id}`, {
      role: 'viewer',
    })
    expect(self.status).toBe(409)
    expect(self.body.error.code).toBe('LAST_OPERATOR')

    const actions = audit(h).map(row => `${row.action} ${row.statusCode}`)
    expect(actions).toEqual(
      expect.arrayContaining([
        'POST /admin/operators 201',
        'POST /admin/operators/:id/reset-access 200',
        'PATCH /admin/operators/:id 409',
      ]),
    )
    const createdRow = audit(h).find(
      row => row.action === 'POST /admin/operators',
    )
    expect(createdRow?.targetId).toBe(String(id))
    expect(JSON.stringify(audit(h))).not.toContain(
      created.body.temporaryPassword,
    )
    expect(JSON.stringify(audit(h))).not.toContain(reset.body.temporaryPassword)
  })
})
