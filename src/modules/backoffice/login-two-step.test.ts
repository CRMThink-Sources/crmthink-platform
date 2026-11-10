import { describe, expect, it } from 'vitest'
import { http } from '@/test/app'
import {
  audit,
  code,
  cookieOf,
  DEVICE_COOKIE,
  firstStep,
  login,
  MINUTE,
  operator,
  ORIGIN,
  secondStep,
  setCookies,
  setup,
  SESSION_COOKIE,
} from './test-support'

describe('primeira etapa (e-mail e senha)', () => {
  it('com autenticador cadastrado devolve o desafio, sem sessão e sem cookie', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')

    const response = await firstStep(h, dev)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ step: 'totp', trustedDeviceDays: 30 })
    expect(response.body.challenge.length).toBeGreaterThanOrEqual(43)
    expect(setCookies(response)).toEqual([])
    expect(h.db.rows('adminSession')).toHaveLength(0)
  })

  it('e-mail inexistente, conta inativa e senha errada respondem igual', async () => {
    const h = setup()
    await operator(h, 'dev@connectthink.com.br', 'operator')
    const suporte = await operator(h, 'suporte@connectthink.com.br', 'viewer')
    await h.container.operators.update(suporte.id, { active: false }, null)

    const attempts = [
      { email: 'ninguem@connectthink.com.br', password: 'qualquer-senha-1' },
      suporte,
      { email: 'dev@connectthink.com.br', password: 'errada-errada-1' },
    ]
    const bodies: unknown[] = []
    for (const account of attempts) {
      const response = await firstStep(h, account)
      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
      bodies.push(response.body)
    }
    expect(new Set(bodies.map(body => JSON.stringify(body))).size).toBe(1)
  })

  it('ignora um `code` no corpo: nunca autentica por aí', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')

    const response = await http(h)
      .post('/admin/auth/login')
      .set('Origin', ORIGIN)
      .send({
        email: dev.email,
        password: dev.password,
        code: code(h, dev.secret!),
      })

    expect(response.status).toBe(200)
    expect(response.body.step).toBe('totp')
    expect(setCookies(response)).toEqual([])
  })

  it('Origin fora de BACKOFFICE_ORIGINS é recusado nas duas rotas', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')

    const first = await firstStep(h, dev, { origin: 'https://evil.test' })
    const second = await secondStep(
      h,
      { challenge: 'x', code: '123456' },
      { origin: 'https://evil.test' },
    )

    for (const response of [first, second]) {
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    }
  })
})

describe('segunda etapa (código)', () => {
  it('código certo abre a sessão: cookie HttpOnly, Secure, SameSite=Strict, Path=/admin', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const first = await firstStep(h, dev)

    const response = await secondStep(h, {
      challenge: first.body.challenge,
      code: code(h, dev.secret!),
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      step: 'authenticated',
      operator: { email: dev.email, role: 'operator' },
    })
    expect(response.body.token).toBeUndefined()
    const cookie = setCookies(response)[0]!
    expect(cookie).toMatch(/^cp_admin_session=[A-Za-z0-9_-]{43};/)
    for (const part of [
      'Path=/admin',
      'HttpOnly',
      'SameSite=Strict',
      'Secure',
    ]) {
      expect(cookie).toContain(part)
    }
    const me = await http(h)
      .get('/admin/auth/me')
      .set('Cookie', cookieOf(response))
    expect(me.status).toBe(200)
    expect(audit(h).map(row => row.action)).toContain('auth.login_succeeded')
  })

  it('código errado: 401 INVALID_CREDENTIALS, sem sessão, e conta uma falha', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const first = await firstStep(h, dev)

    const response = await secondStep(h, {
      challenge: first.body.challenge,
      code: '000000',
    })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(setCookies(response)).toEqual([])
    expect(h.db.rows('adminOperator')[0]!.failedLogins).toBe(1)
    const failure = audit(h).find(row => row.action === 'auth.login_failed')
    expect(failure?.summary.reason).toBe('bad_totp')
  })

  it('5 códigos errados esgotam o desafio, mesmo que o sexto esteja certo', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const first = await firstStep(h, dev)
    for (let i = 0; i < 4; i++) {
      await secondStep(h, { challenge: first.body.challenge, code: '000000' })
    }
    // Quinto erro: esgota o desafio e também bloqueia a conta (5 falhas).
    await secondStep(h, { challenge: first.body.challenge, code: '000000' })

    const response = await secondStep(h, {
      challenge: first.body.challenge,
      code: code(h, dev.secret!),
    })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('CHALLENGE_EXPIRED')
    expect(h.db.rows('adminSession')).toHaveLength(0)
  })

  it('desafio vencido, usado ou desconhecido: CHALLENGE_EXPIRED', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')

    const stale = await firstStep(h, dev)
    h.clock.advance(6 * MINUTE)
    const expired = await secondStep(h, {
      challenge: stale.body.challenge,
      code: code(h, dev.secret!),
    })
    expect(expired.status).toBe(401)
    expect(expired.body.error.code).toBe('CHALLENGE_EXPIRED')

    const fresh = await firstStep(h, dev)
    const ok = await secondStep(h, {
      challenge: fresh.body.challenge,
      code: code(h, dev.secret!),
    })
    expect(ok.status).toBe(200)
    const again = await secondStep(h, {
      challenge: fresh.body.challenge,
      code: code(h, dev.secret!),
    })
    expect(again.body.error.code).toBe('CHALLENGE_EXPIRED')

    const unknown = await secondStep(h, {
      challenge: 'nunca-existiu',
      code: '123456',
    })
    expect(unknown.body.error.code).toBe('CHALLENGE_EXPIRED')
  })

  it('código já usado não vale de novo, nem com outro desafio', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const used = code(h, dev.secret!)
    const a = await firstStep(h, dev)
    expect(
      (await secondStep(h, { challenge: a.body.challenge, code: used })).status,
    ).toBe(200)

    const b = await firstStep(h, dev)
    const replay = await secondStep(h, {
      challenge: b.body.challenge,
      code: used,
    })

    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('senha provisória: a sessão só permite trocar a senha', async () => {
    const h = setup()
    const nova = await operator(h, 'nova@connectthink.com.br', 'viewer', {
      ready: false,
    })
    const cookie = await login(h, nova)

    const blocked = await http(h).get('/admin/apps').set('Cookie', cookie)

    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })
})

describe('cadastro do autenticador no primeiro acesso', () => {
  it('devolve segredo e otpauth:// sem gravar nada na conta', async () => {
    const h = setup()
    const nova = await operator(h, 'nova@connectthink.com.br', 'operator', {
      enrolled: false,
    })

    const response = await firstStep(h, nova)

    expect(response.status).toBe(200)
    expect(response.body.step).toBe('totp-setup')
    expect(response.body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(response.body.otpauthUri).toMatch(
      /^otpauth:\/\/totp\/CRMThink%20Backoffice%20\(homolog\)%3Anova%40connectthink\.com\.br\?secret=/,
    )
    expect(h.db.rows('adminOperator')[0]!.totpSecretEnc).toBeNull()
  })

  it('o primeiro código válido grava o segredo cifrado, abre a sessão e audita sem o segredo', async () => {
    const h = setup()
    const nova = await operator(h, 'nova@connectthink.com.br', 'operator', {
      enrolled: false,
    })
    const first = await firstStep(h, nova)
    const { secret, challenge, otpauthUri } = first.body

    const response = await secondStep(h, {
      challenge,
      code: code(h, secret),
    })

    expect(response.status).toBe(200)
    expect(setCookies(response)[0]).toContain(`${SESSION_COOKIE}=`)
    const row = h.db.rows('adminOperator')[0]!
    expect(row.totpSecretEnc.startsWith('v1:')).toBe(true)
    expect(h.container.cipher.decrypt(row.totpSecretEnc)).toBe(secret)
    const actions = audit(h).map(entry => entry.action)
    expect(actions).toContain('auth.totp_configured')
    const trail = JSON.stringify(audit(h))
    expect(trail).not.toContain(secret)
    expect(trail).not.toContain(otpauthUri)
  })

  it('abandonar e entrar de novo gera outro segredo; o anterior não vale', async () => {
    const h = setup()
    const nova = await operator(h, 'nova@connectthink.com.br', 'operator', {
      enrolled: false,
    })
    const first = await firstStep(h, nova)
    const second = await firstStep(h, nova)
    expect(second.body.secret).not.toBe(first.body.secret)

    const stale = await secondStep(h, {
      challenge: second.body.challenge,
      code: code(h, first.body.secret),
    })

    expect(stale.status).toBe(401)
    expect(h.db.rows('adminOperator')[0]!.totpSecretEnc).toBeNull()
  })

  it('dois cadastros abertos: o primeiro confirmado vence e o segredo dele fica', async () => {
    const h = setup()
    const nova = await operator(h, 'nova@connectthink.com.br', 'operator', {
      enrolled: false,
    })
    const a = await firstStep(h, nova)
    const b = await firstStep(h, nova)

    const winner = await secondStep(h, {
      challenge: a.body.challenge,
      code: code(h, a.body.secret),
    })
    h.clock.advance(30_000)
    const loser = await secondStep(h, {
      challenge: b.body.challenge,
      code: code(h, b.body.secret),
    })

    expect(winner.status).toBe(200)
    expect(loser.status).toBe(401)
    const row = h.db.rows('adminOperator')[0]!
    expect(h.container.cipher.decrypt(row.totpSecretEnc)).toBe(a.body.secret)
  })
})

describe('navegador lembrado', () => {
  async function remembered(h: ReturnType<typeof setup>, dev: any) {
    const first = await firstStep(h, dev)
    const second = await secondStep(h, {
      challenge: first.body.challenge,
      code: code(h, dev.secret),
      rememberDevice: true,
    })
    expect(second.status).toBe(200)
    h.clock.advance(30_000)
    return { response: second, device: cookieOf(second, DEVICE_COOKIE) }
  }

  it('lembrar define o cookie do navegador pelo prazo configurado', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')

    const { response } = await remembered(h, dev)

    const line = setCookies(response).find(c => c.startsWith(DEVICE_COOKIE))!
    expect(line).toMatch(/^cp_admin_device=[A-Za-z0-9_-]{43};/)
    expect(line).toContain(`Max-Age=${30 * 86400}`)
    for (const part of [
      'Path=/admin',
      'HttpOnly',
      'SameSite=Strict',
      'Secure',
    ]) {
      expect(line).toContain(part)
    }
  })

  it('sem pedir para lembrar, nenhum cookie de navegador é definido', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const first = await firstStep(h, dev)
    const second = await secondStep(h, {
      challenge: first.body.challenge,
      code: code(h, dev.secret!),
    })

    expect(setCookies(second).some(c => c.startsWith(DEVICE_COOKIE))).toBe(
      false,
    )
  })

  it('próximo login com senha certa e o cookie entra direto e audita a dispensa', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const { device } = await remembered(h, dev)

    const response = await firstStep(h, dev, { cookie: device })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      step: 'authenticated',
      operator: { email: dev.email },
    })
    expect(setCookies(response)[0]).toContain(`${SESSION_COOKIE}=`)
    const skipped = audit(h).filter(
      row => row.summary?.secondFactor === 'skipped_trusted_device',
    )
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.action).toBe('auth.login_succeeded')
  })

  it('senha errada com o cookie continua 401 e conta a falha', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const { device } = await remembered(h, dev)

    const response = await firstStep(
      h,
      { email: dev.email, password: 'errada-errada-1' },
      { cookie: device },
    )

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(h.db.rows('adminOperator')[0]!.failedLogins).toBe(1)
  })

  it('cookie de outra conta exige o código', async () => {
    const h = setup()
    const a = await operator(h, 'a@connectthink.com.br', 'operator')
    const b = await operator(h, 'b@connectthink.com.br', 'viewer')
    const { device } = await remembered(h, a)

    const response = await firstStep(h, b, { cookie: device })

    expect(response.body.step).toBe('totp')
    expect(setCookies(response)).toEqual([])
  })

  it('conta com TOTP redefinido ignora o cookie antigo e cai no cadastro', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const { device } = await remembered(h, dev)
    await h.db.asDb().adminOperator.update({
      where: { id: dev.id },
      data: { totpSecretEnc: null },
    })

    const response = await firstStep(h, dev, { cookie: device })

    expect(response.body.step).toBe('totp-setup')
  })

  it('conta desativada com o cookie: INVALID_CREDENTIALS', async () => {
    const h = setup()
    await operator(h, 'admin@connectthink.com.br', 'operator')
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const { device } = await remembered(h, dev)
    await h.container.operators.update(dev.id, { active: false }, null)

    const response = await firstStep(h, dev, { cookie: device })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('validade vencida pede o código de novo', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const { device } = await remembered(h, dev)

    h.clock.advance(31 * 86_400_000)
    const response = await firstStep(h, dev, { cookie: device })

    expect(response.body.step).toBe('totp')
  })

  it('ADMIN_TRUSTED_DEVICE_DAYS=0 ignora o pedido e não define cookie', async () => {
    const h = setup({ ADMIN_TRUSTED_DEVICE_DAYS: '0' })
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const first = await firstStep(h, dev)
    expect(first.body.trustedDeviceDays).toBe(0)

    const second = await secondStep(h, {
      challenge: first.body.challenge,
      code: code(h, dev.secret!),
      rememberDevice: true,
    })

    expect(second.status).toBe(200)
    expect(setCookies(second).some(c => c.startsWith(DEVICE_COOKIE))).toBe(
      false,
    )
    expect(h.db.rows('adminTrustedDevice')).toHaveLength(0)
  })
})

describe('limites e bloqueio nas duas etapas', () => {
  it('4 senhas erradas e 1 código errado bloqueiam a conta; o código certo depois também falha', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const open = await firstStep(h, dev)
    for (let i = 0; i < 4; i++) {
      await firstStep(h, { email: dev.email, password: 'errada-errada-1' })
    }

    const wrong = await secondStep(h, {
      challenge: open.body.challenge,
      code: '000000',
    })
    expect(wrong.status).toBe(401)
    expect(h.db.rows('adminOperator')[0]!.lockedUntil).toBeInstanceOf(Date)
    expect(
      audit(h).filter(row => row.action === 'auth.account_locked'),
    ).toHaveLength(1)

    const later = await firstStep(h, dev)
    expect(later.status).toBe(401)
  })

  it('conta bloqueada no meio do desafio não entra', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const open = await firstStep(h, dev)
    await h.db.asDb().adminOperator.update({
      where: { id: dev.id },
      data: { lockedUntil: new Date(h.clock.now().getTime() + 10 * MINUTE) },
    })

    const response = await secondStep(h, {
      challenge: open.body.challenge,
      code: code(h, dev.secret!),
    })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(h.db.rows('adminSession')).toHaveLength(0)
  })

  it('a 21ª tentativa por IP, somando as duas rotas, recebe 429 com Retry-After', async () => {
    const h = setup()
    for (let i = 0; i < 10; i++) {
      await firstStep(h, {
        email: `x${i}@connectthink.com.br`,
        password: 'qualquer-senha-1',
      })
      await secondStep(h, { challenge: `c${i}`, code: '000000' })
    }

    const limited = await firstStep(h, {
      email: 'x@connectthink.com.br',
      password: 'qualquer-senha-1',
    })

    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS')
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('20 códigos errados em paralelo: a conta trava e nenhuma sessão abre', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const open = await firstStep(h, dev)

    const responses = await Promise.all(
      Array.from({ length: 19 }, () =>
        secondStep(h, { challenge: open.body.challenge, code: '000000' }),
      ),
    )

    expect(responses.every(r => r.status !== 200)).toBe(true)
    expect(responses.every(r => setCookies(r).length === 0)).toBe(true)
    expect(h.db.rows('adminOperator')[0]!.lockedUntil).toBeInstanceOf(Date)
    expect(h.db.rows('adminSession')).toHaveLength(0)
  })

  it('dois códigos certos iguais em paralelo abrem no máximo uma sessão', async () => {
    const h = setup()
    const dev = await operator(h, 'dev@connectthink.com.br', 'operator')
    const a = await firstStep(h, dev)
    const b = await firstStep(h, dev)
    const valid = code(h, dev.secret!)

    const responses = await Promise.all([
      secondStep(h, { challenge: a.body.challenge, code: valid }),
      secondStep(h, { challenge: b.body.challenge, code: valid }),
    ])

    expect(responses.filter(r => r.status === 200)).toHaveLength(1)
    expect(h.db.rows('adminSession')).toHaveLength(1)
  })
})
