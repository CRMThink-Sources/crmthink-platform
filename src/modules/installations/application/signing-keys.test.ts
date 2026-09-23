import {
  exportPKCS8,
  generateKeyPair,
  createLocalJWKSet,
  jwtVerify,
} from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { FakePrisma } from '@/test/fake-prisma'
import { FakeClock, TEST_KEY } from '@/test/fakes'
import {
  NoActiveSigningKeyError,
  SigningKeys,
  type JwtClaims,
} from './signing-keys'

const claims: JwtClaims = {
  sub: '7',
  aud: 'crmthink.gptmaker',
  installationId: 1001,
  memberId: 'm1',
  domain: 'cliente.bitrix24.com.br',
  isAdmin: false,
  name: 'Ana Silva',
  departmentIds: [1],
}

describe('SigningKeys (RS256 + JWKS)', () => {
  let db: FakePrisma
  let clock: FakeClock
  let keys: SigningKeys

  beforeEach(() => {
    db = new FakePrisma()
    clock = new FakeClock()
    keys = new SigningKeys(db.asDb(), createTokenCipher(TEST_KEY), clock, {
      issuer: 'https://platform.test',
      ttlSeconds: 900,
    })
  })

  it('não sobe sem chave ativa nem chave de bootstrap', async () => {
    await expect(keys.ensureActive('')).rejects.toBeInstanceOf(
      NoActiveSigningKeyError,
    )
  })

  it('importa a chave de bootstrap e guarda a privada cifrada', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    await keys.ensureActive(await exportPKCS8(privateKey))
    const row = db.rows('signingKey')[0]!
    expect(row.privateKeyEnc.startsWith('v1:')).toBe(true)
    expect(row.privateKeyEnc).not.toContain('PRIVATE KEY')
  })

  it('emite JWT de 15 min com as claims do contrato, validável pelo JWKS', async () => {
    await keys.rotate(0)
    const { token, expiresAt } = await keys.sign(claims)
    expect(expiresAt.getTime() - clock.now().getTime()).toBe(900_000)

    const jwks = createLocalJWKSet(await keys.jwks())
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer: 'https://platform.test',
      audience: 'crmthink.gptmaker',
      currentDate: clock.now(),
    })
    expect(protectedHeader.alg).toBe('RS256')
    expect(payload).toMatchObject({
      sub: '7',
      installationId: 1001,
      memberId: 'm1',
      domain: 'cliente.bitrix24.com.br',
      isAdmin: false,
      name: 'Ana Silva',
      departmentIds: [1],
    })
    expect(payload.exp).toBe(Math.floor(expiresAt.getTime() / 1000))
  })

  it('token de outro app é rejeitado pelo aud', async () => {
    await keys.rotate(0)
    const { token } = await keys.sign({ ...claims, aud: 'crmthink.thinkzap' })
    const jwks = createLocalJWKSet(await keys.jwks())
    await expect(
      jwtVerify(token, jwks, {
        issuer: 'https://platform.test',
        audience: 'crmthink.gptmaker',
        currentDate: clock.now(),
      }),
    ).rejects.toThrow()
  })

  it('token expirado é rejeitado', async () => {
    await keys.rotate(0)
    const { token } = await keys.sign(claims)
    const jwks = createLocalJWKSet(await keys.jwks())
    await expect(
      jwtVerify(token, jwks, {
        issuer: 'https://platform.test',
        audience: 'crmthink.gptmaker',
        currentDate: new Date(clock.now().getTime() + 901_000),
      }),
    ).rejects.toThrow(/exp/)
  })

  it('rotação: chave nova publicada antes de assinar; antiga retida por ttl + margem', async () => {
    const first = await keys.rotate(0)
    clock.advance(1000)
    const second = await keys.rotate(10 * 60_000)

    // Antes da ativação: as duas no JWKS, assina a primeira.
    let kids = (await keys.jwks()).keys.map(k => k.kid)
    expect(kids).toEqual([first.kid, second.kid])
    const before = await keys.sign(claims)
    expect(
      JSON.parse(
        Buffer.from(before.token.split('.')[0]!, 'base64url').toString(),
      ).kid,
    ).toBe(first.kid)

    // Depois da ativação: assina a segunda; a primeira continua publicada.
    clock.advance(10 * 60_000)
    const after = await keys.sign(claims)
    expect(
      JSON.parse(
        Buffer.from(after.token.split('.')[0]!, 'base64url').toString(),
      ).kid,
    ).toBe(second.kid)
    kids = (await keys.jwks()).keys.map(k => k.kid)
    expect(kids).toContain(first.kid)

    // Token emitido com a antiga ainda valida pelo JWKS.
    const jwks = createLocalJWKSet(await keys.jwks())
    await expect(
      jwtVerify(before.token, jwks, {
        issuer: 'https://platform.test',
        audience: 'crmthink.gptmaker',
        currentDate: clock.now(),
      }),
    ).resolves.toBeTruthy()

    // Passado ttl (15 min) + margem (5 min) da troca, a antiga sai do JWKS.
    clock.advance(20 * 60_000 + 1000)
    kids = (await keys.jwks()).keys.map(k => k.kid)
    expect(kids).toEqual([second.kid])
  })
})
