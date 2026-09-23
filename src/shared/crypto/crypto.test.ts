import { describe, expect, it } from 'vitest'
import { createTokenCipher, EncryptionKeyError } from './token-cipher'
import {
  buildSignatureHeader,
  computeSignature,
  verifySignatureHeader,
} from './hmac-signature'
import { generateApiKey, hashApiKey } from './api-key'
import { safeEqual } from './timing-safe'

const KEY = Buffer.alloc(32, 1).toString('base64')

describe('token cipher (AES-256-GCM v1)', () => {
  it('cifra com prefixo de versão e decifra de volta', () => {
    const cipher = createTokenCipher(KEY)
    const encrypted = cipher.encrypt('segredo-do-portal')
    expect(encrypted.startsWith('v1:')).toBe(true)
    expect(encrypted).not.toContain('segredo')
    expect(cipher.decrypt(encrypted)).toBe('segredo-do-portal')
  })

  it('gera IV novo a cada cifragem', () => {
    const cipher = createTokenCipher(KEY)
    expect(cipher.encrypt('x')).not.toBe(cipher.encrypt('x'))
  })

  it('detecta adulteração', () => {
    const cipher = createTokenCipher(KEY)
    const encrypted = cipher.encrypt('valor')
    const packed = Buffer.from(encrypted.slice(3), 'base64')
    packed[packed.length - 1] = (packed[packed.length - 1] ?? 0) ^ 0xff
    expect(() => cipher.decrypt('v1:' + packed.toString('base64'))).toThrow()
  })

  it('não decifra com outra chave', () => {
    const encrypted = createTokenCipher(KEY).encrypt('valor')
    expect(() =>
      createTokenCipher(Buffer.alloc(32, 2).toString('base64')).decrypt(
        encrypted,
      ),
    ).toThrow()
  })

  it('recusa valor sem prefixo (nada nasce em texto puro)', () => {
    expect(() => createTokenCipher(KEY).decrypt('texto-puro')).toThrow(
      /prefixo/,
    )
  })

  it('falha sem chave ou com chave de tamanho errado', () => {
    expect(() => createTokenCipher('')).toThrow(EncryptionKeyError)
    expect(() =>
      createTokenCipher(Buffer.alloc(16).toString('base64')),
    ).toThrow(EncryptionKeyError)
  })
})

describe('assinatura HMAC dos webhooks', () => {
  const body = JSON.stringify({ eventId: 'e1' })
  const now = new Date('2026-09-01T12:00:00Z')

  it('formato t=<unix>,v1=<hex>', () => {
    const header = buildSignatureHeader(['s1'], body, now)
    const t = Math.floor(now.getTime() / 1000)
    expect(header).toBe(`t=${t},v1=${computeSignature('s1', t, body)}`)
  })

  it('verifica assinatura válida', () => {
    const header = buildSignatureHeader(['s1'], body, now)
    expect(verifySignatureHeader(header, 's1', body, now)).toEqual({ ok: true })
  })

  it('rejeita corpo alterado e segredo errado', () => {
    const header = buildSignatureHeader(['s1'], body, now)
    expect(verifySignatureHeader(header, 's1', body + ' ', now)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    expect(verifySignatureHeader(header, 's2', body, now)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejeita assinatura com mais de 5 minutos', () => {
    const header = buildSignatureHeader(['s1'], body, now)
    const later = new Date(now.getTime() + 5 * 60_000 + 1000)
    expect(verifySignatureHeader(header, 's1', body, later)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('na rotação, leva uma assinatura por segredo e qualquer uma vale', () => {
    const header = buildSignatureHeader(['novo', 'antigo'], body, now)
    expect(header.match(/v1=/g)).toHaveLength(2)
    expect(verifySignatureHeader(header, 'novo', body, now).ok).toBe(true)
    expect(verifySignatureHeader(header, 'antigo', body, now).ok).toBe(true)
  })

  it('header malformado', () => {
    expect(verifySignatureHeader(undefined, 's', body)).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(verifySignatureHeader('lixo', 's', body)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('chave de API', () => {
  it('é aleatória e guardada só como hash', () => {
    const a = generateApiKey()
    expect(a).not.toBe(generateApiKey())
    expect(hashApiKey(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashApiKey(a)).not.toContain(a)
  })

  it('comparação em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('abc', '')).toBe(false)
  })
})
