import { beforeEach, describe, expect, it } from 'vitest'
import { BitrixOAuthRejectedError } from '@/shared/bitrix/bitrix-oauth.client'
import { http } from '@/test/app'
import {
  createHarness,
  GPTMAKER,
  installPayload,
  outbox,
  seedGptMaker,
  type Harness,
} from '@/test/harness'

describe('cofre de tokens', () => {
  let h: Harness
  let apiKey: string
  let installationId: number

  beforeEach(async () => {
    h = createHarness()
    apiKey = (await seedGptMaker(h, { trialOnInstall: false })).credentials
      .apiKey
    const res = await http(h).post('/v1/install').send(installPayload(h))
    installationId = res.body.installationId
    h.oauth.calls = 0
  })

  const auth = () => ({ Authorization: `Bearer ${apiKey}` })

  it('entrega token vigente com expiração, domínio e client_endpoint', async () => {
    const res = await http(h)
      .get(`/v1/installations/${installationId}/token`)
      .set(auth())
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      accessToken: 'access-1',
      domain: 'cliente.bitrix24.com.br',
      clientEndpoint: 'https://cliente.bitrix24.com.br/rest/',
    })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(h.oauth.calls).toBe(0)
  })

  it('pedidos concorrentes com o mesmo token vencido: uma renovação só, mesmo token novo para todos', async () => {
    h.oauth.delayMs = 30
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        http(h)
          .post(`/v1/installations/${installationId}/token/refresh`)
          .set(auth())
          .send({ staleAccessToken: 'access-1' }),
      ),
    )
    expect(results.map(r => r.status)).toEqual([200, 200, 200])
    expect(new Set(results.map(r => r.body.accessToken))).toEqual(
      new Set(['access-2']),
    )
    expect(h.oauth.calls).toBe(1)
  })

  it('renovação entre processos: quem espera o lock recebe o token gravado pelo outro', async () => {
    h.oauth.delayMs = 30
    // Dois "processos": o job e o pedido sob demanda, cada um com o seu single-flight.
    const [job, onDemand] = await Promise.all([
      (async () => {
        h.clock.advance(55 * 60_000) // token vence em 5 min: o job renova
        return h.container.vault.refreshDue()
      })(),
      new Promise(resolve => setTimeout(resolve, 5)).then(() =>
        http(h)
          .post(`/v1/installations/${installationId}/token/refresh`)
          .set(auth())
          .send({ staleAccessToken: 'access-1' }),
      ),
    ])
    expect(h.oauth.calls).toBe(1)
    expect(job.refreshed + job.skipped).toBe(1)
    expect(
      (onDemand as { body: { accessToken: string } }).body.accessToken,
    ).toBe('access-2')
  })

  it('token já renovado: devolve o atual sem chamar o Bitrix', async () => {
    await http(h)
      .post(`/v1/installations/${installationId}/token/refresh`)
      .set(auth())
      .send({ staleAccessToken: 'access-1' })
    h.oauth.calls = 0
    const res = await http(h)
      .post(`/v1/installations/${installationId}/token/refresh`)
      .set(auth())
      .send({ staleAccessToken: 'access-1' })
    expect(res.body.accessToken).toBe('access-2')
    expect(h.oauth.calls).toBe(0)
  })

  it('job renova tokens que vencem em menos de 10 min e ignora os demais', async () => {
    expect((await h.container.vault.refreshDue()).refreshed).toBe(0)
    h.clock.advance(52 * 60_000) // vence em 8 min
    const stats = await h.container.vault.refreshDue()
    expect(stats.refreshed).toBe(1)
    const credential = h.db.rows('credential')[0]!
    expect(h.container.cipher.decrypt(credential.accessTokenEnc)).toBe(
      'access-2',
    )
    expect(h.container.cipher.decrypt(credential.refreshTokenEnc)).toBe(
      'refresh-2',
    )
  })

  it('5 falhas seguidas: AUTH_ERROR + installation.auth_error; token 409; reinstalação restaura', async () => {
    h.oauth.failWith = new BitrixOAuthRejectedError('invalid_grant', 'revoked')
    h.clock.advance(55 * 60_000)
    for (let i = 0; i < 5; i++) await h.container.vault.refreshDue()
    expect(h.db.rows('installation')[0]!.status).toBe('AUTH_ERROR')
    const event = outbox(h).find(e => e.type === 'installation.auth_error')
    expect(event?.payload.data.lastError).toContain('revoked')

    // Mais falhas não emitem de novo e o job para de tentar.
    await h.container.vault.refreshDue()
    expect(
      outbox(h).filter(e => e.type === 'installation.auth_error'),
    ).toHaveLength(1)

    const token = await http(h)
      .get(`/v1/installations/${installationId}/token`)
      .set(auth())
    expect(token.status).toBe(409)
    expect(token.body.error.code).toBe('AUTH_ERROR')

    h.oauth.failWith = null
    const res = await http(h).post('/v1/install').send(installPayload(h))
    expect(res.body.status).toBe('ACTIVE')
    expect(outbox(h).map(e => e.type)).toContain('installation.auth_restored')
    expect(h.db.rows('credential')[0]!.refreshFailures).toBe(0)
  })

  it('indisponibilidade do Bitrix não conta para AUTH_ERROR', async () => {
    const { BitrixUnavailableError } =
      await import('@/shared/bitrix/bitrix-errors')
    h.oauth.failWith = new BitrixUnavailableError('oauth.refresh', 'timeout')
    h.clock.advance(55 * 60_000)
    for (let i = 0; i < 6; i++) await h.container.vault.refreshDue()
    expect(h.db.rows('installation')[0]!.status).toBe('ACTIVE')
    const res = await http(h)
      .post(`/v1/installations/${installationId}/token/refresh`)
      .set(auth())
      .send({ staleAccessToken: 'access-1' })
    expect(res.status).toBe(503)
  })

  it('nenhum token aparece em texto puro no banco', async () => {
    const dump = JSON.stringify(h.db.store)
    expect(dump).not.toContain('access-1')
    expect(dump).not.toContain('refresh-1')
    expect(dump).not.toContain('secret-gptmaker')
  })
})

describe('sessão do iframe', () => {
  let h: Harness
  let token: string

  beforeEach(async () => {
    h = createHarness()
    await seedGptMaker(h, { trialOnInstall: false })
    await h.container.signingKeys.rotate(0)
    const payload = installPayload(h)
    await http(h).post('/v1/install').send(payload)
    token = 'user-token'
    h.portal.clientIdByToken.set(token, 'local.gptmaker')
  })

  const session = (
    body: Record<string, unknown>,
    origin = 'https://gptmaker.app',
  ) =>
    http(h)
      .post('/v1/sessions')
      .set('Origin', origin)
      .send({
        appCode: GPTMAKER,
        accessToken: token,
        domain: 'cliente.bitrix24.com.br',
        memberId: 'member-abc',
        ...body,
      })

  it('usuário comum: isAdmin=false conforme user.admin; ignora isAdmin do navegador', async () => {
    const res = await session({ isAdmin: true })
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://gptmaker.app',
    )
    expect(res.body.user).toEqual({
      id: '7',
      name: 'Ana Silva',
      isAdmin: false,
    })
    const payload = JSON.parse(
      Buffer.from(res.body.token.split('.')[1], 'base64url').toString(),
    )
    expect(payload).toMatchObject({
      aud: GPTMAKER,
      sub: '7',
      isAdmin: false,
      memberId: 'member-abc',
      iss: 'https://platform.test',
    })
  })

  it('admin do portal: isAdmin=true', async () => {
    h.portal.admins.add(token)
    const res = await session({})
    expect(res.body.user.isAdmin).toBe(true)
  })

  it('instalação inexistente ou inativa: 403', async () => {
    expect((await session({ memberId: 'outro' })).status).toBe(403)
    h.db.rows('installation')[0]!.status = 'INSTALL_PENDING'
    expect((await session({})).status).toBe(403)
  })

  it('token de outro app Bitrix: 403', async () => {
    h.portal.clientIdByToken.set(token, 'local.outroapp')
    const res = await session({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('TOKEN_APP_MISMATCH')
  })

  it('origem fora da lista do app: sem CORS e sem sessão', async () => {
    const res = await session({}, 'https://malicioso.app')
    expect(res.status).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()

    const preflight = await http(h)
      .options('/v1/sessions')
      .set('Origin', 'https://malicioso.app')
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    const ok = await http(h)
      .options('/v1/sessions')
      .set('Origin', 'https://gptmaker.app')
    expect(ok.headers['access-control-allow-origin']).toBe(
      'https://gptmaker.app',
    )
  })

  it('JWKS público', async () => {
    const res = await http(h).get('/.well-known/jwks.json')
    expect(res.status).toBe(200)
    expect(res.body.keys[0]).toMatchObject({
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
    })
    expect(res.body.keys[0].d).toBeUndefined()
  })
})
