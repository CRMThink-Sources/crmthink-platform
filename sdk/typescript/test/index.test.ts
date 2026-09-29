import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSignatureHeader } from '@/shared/crypto/hmac-signature'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { SigningKeys } from '@/modules/installations/application/signing-keys'
import { FakePrisma } from '@/test/fake-prisma'
import { TEST_KEY } from '@/test/fakes'
import {
  createSessionVerifier,
  PlatformError,
  PlatformTokenClient,
  shouldApply,
  verifyPlatformSignature,
  type PlatformEvent,
} from '../src/index.js'

/** O SDK é validado contra a implementação real da plataforma (assinatura e JWKS). */

describe('SDK: assinatura HMAC', () => {
  const body = '{"eventId":"e1"}'

  it('aceita a assinatura gerada pela plataforma', () => {
    const header = buildSignatureHeader(['s1'], body)
    expect(
      verifyPlatformSignature({ header, rawBody: body, secrets: ['s1'] }),
    ).toEqual({ ok: true })
    expect(
      verifyPlatformSignature({
        header,
        rawBody: Buffer.from(body),
        secrets: ['outro', 's1'],
      }).ok,
    ).toBe(true)
  })

  it('recusa corpo alterado, segredo errado e mais de 5 minutos', () => {
    const now = new Date()
    const header = buildSignatureHeader(['s1'], body, now)
    expect(
      verifyPlatformSignature({ header, rawBody: body + 'x', secrets: ['s1'] })
        .ok,
    ).toBe(false)
    expect(
      verifyPlatformSignature({ header, rawBody: body, secrets: ['s2'] }).ok,
    ).toBe(false)
    expect(
      verifyPlatformSignature({
        header,
        rawBody: body,
        secrets: ['s1'],
        now: new Date(now.getTime() + 301_000),
      }),
    ).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('SDK: dedupe e versão', () => {
  const event = (eventId: string, version: number | null): PlatformEvent => ({
    eventId,
    type: 'subscription.past_due',
    appCode: 'a',
    installationId: 1,
    memberId: 'm',
    occurredAt: '',
    subscription:
      version === null
        ? null
        : {
            id: 9,
            status: 'past_due',
            modality: 'stripe',
            planId: 1,
            periodStart: '',
            periodEnd: '',
            version,
          },
    data: { invoiceId: null, hostedInvoiceUrl: null },
  })
  const state = { seen: (id: string) => id === 'dup', lastVersion: () => 6 }

  it('ignora duplicado e versão menor', () => {
    expect(shouldApply(event('dup', 7), state)).toBe(false)
    expect(shouldApply(event('e5', 5), state)).toBe(false)
    expect(shouldApply(event('e7', 7), state)).toBe(true)
    expect(shouldApply(event('i1', null), state)).toBe(true)
  })
})

describe('SDK: sessão pelo JWKS', () => {
  let server: Server
  let url: string
  let keys: SigningKeys

  beforeAll(async () => {
    const db = new FakePrisma()
    const clock = { now: () => new Date() }
    keys = new SigningKeys(db.asDb(), createTokenCipher(TEST_KEY), clock, {
      issuer: 'http://placeholder',
      ttlSeconds: 900,
    })
    server = createServer((req, res) => {
      void keys.jwks().then(jwks => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(jwks))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    ;(keys as unknown as { options: { issuer: string } }).options.issuer = url
    await keys.rotate(0)
  })

  afterAll(() => {
    server.close()
  })

  const claims = {
    sub: '7',
    aud: 'crmthink.gptmaker',
    installationId: 1,
    memberId: 'm',
    domain: 'd',
    isAdmin: true,
    name: 'Ana',
    departmentIds: [],
  }

  it('valida token da plataforma e recarrega o JWKS após rotação (kid novo)', async () => {
    const verify = createSessionVerifier({
      platformUrl: url,
      appCode: 'crmthink.gptmaker',
      cooldownMs: 0,
    })
    const first = await keys.sign(claims)
    expect(await verify(first.token)).toMatchObject({
      sub: '7',
      isAdmin: true,
      installationId: 1,
    })

    await keys.rotate(0)
    const second = await keys.sign(claims)
    expect((await verify(second.token)).sub).toBe('7')
  })

  it('rejeita token de outro app', async () => {
    const verify = createSessionVerifier({
      platformUrl: url,
      appCode: 'crmthink.gptmaker',
    })
    const other = await keys.sign({ ...claims, aud: 'crmthink.thinkzap' })
    await expect(verify(other.token)).rejects.toThrow()
  })
})

describe('SDK: cliente de tokens', () => {
  it('cache até expiresAt - 5 min, renovação explícita e erros com código', async () => {
    const calls: string[] = []
    let now = Date.parse('2026-09-01T12:00:00Z')
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = String(input).replace('https://p.test', '')
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (path.includes('/404/'))
        return new Response(
          JSON.stringify({
            error: { code: 'INSTALLATION_NOT_FOUND', message: 'x' },
          }),
          { status: 404 },
        )
      const accessToken = path.endsWith('/refresh') ? 'novo' : 'atual'
      return new Response(
        JSON.stringify({
          accessToken,
          expiresAt: new Date(now + 3600_000).toISOString(),
          domain: 'd',
          clientEndpoint: null,
        }),
      )
    }) as typeof fetch
    const client = new PlatformTokenClient(
      'https://p.test/',
      'cp_key',
      fetchImpl,
      () => now,
    )

    expect((await client.get(1)).accessToken).toBe('atual')
    await client.get(1)
    expect(calls).toHaveLength(1)
    now += 56 * 60_000
    await client.get(1)
    expect(calls).toHaveLength(2)
    expect((await client.refresh(1, 'atual')).accessToken).toBe('novo')
    expect(calls.at(-1)).toBe('POST /v1/installations/1/token/refresh')
    await expect(client.get(404)).rejects.toMatchObject({
      status: 404,
      code: 'INSTALLATION_NOT_FOUND',
    })
    expect(PlatformError).toBeTruthy()
  })
})
