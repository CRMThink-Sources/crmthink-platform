import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp'

// RFC 6238, apêndice B (SHA-1): segredo ASCII "12345678901234567890", 8 dígitos.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'))
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
]

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('vetor da RFC em T=%i', (seconds, expected) => {
    const step = totpStep(new Date(seconds * 1000))
    expect(totpCode(RFC_SECRET, step, 8)).toBe(expected)
    expect(totpCode(RFC_SECRET, step)).toBe(expected.slice(-6))
  })

  it('base32 ida e volta', () => {
    const data = Buffer.from('qualquer coisa ç')
    expect(base32Decode(base32Encode(data))).toEqual(data)
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    )
  })

  it('segredo novo tem 160 bits em base32', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(base32Decode(secret)).toHaveLength(20)
  })

  describe('verificação', () => {
    const secret = generateTotpSecret()
    const at = new Date('2026-10-28T12:00:10Z')
    const step = totpStep(at)

    it('aceita o passo atual e ±1, devolvendo o passo', () => {
      expect(verifyTotp(secret, totpCode(secret, step), at)).toBe(step)
      expect(verifyTotp(secret, totpCode(secret, step - 1), at)).toBe(step - 1)
      expect(verifyTotp(secret, totpCode(secret, step + 1), at)).toBe(step + 1)
    })

    it('recusa fora da janela', () => {
      expect(verifyTotp(secret, totpCode(secret, step - 2), at)).toBeNull()
      expect(verifyTotp(secret, totpCode(secret, step + 2), at)).toBeNull()
    })

    it('recusa passo já usado (replay) e anteriores', () => {
      expect(verifyTotp(secret, totpCode(secret, step), at, step)).toBeNull()
      expect(
        verifyTotp(secret, totpCode(secret, step - 1), at, step),
      ).toBeNull()
      expect(verifyTotp(secret, totpCode(secret, step + 1), at, step)).toBe(
        step + 1,
      )
    })

    it('recusa formato inválido', () => {
      expect(verifyTotp(secret, '12345', at)).toBeNull()
      expect(verifyTotp(secret, 'abcdef', at)).toBeNull()
    })
  })

  it('URI otpauth com emissor e conta', () => {
    const uri = totpUri({
      secret: 'ABC',
      account: 'dev@connectthink.com.br',
      issuer: 'CRMThink Backoffice',
    })
    expect(uri).toBe(
      'otpauth://totp/CRMThink%20Backoffice%3Adev%40connectthink.com.br?secret=ABC&issuer=CRMThink+Backoffice&algorithm=SHA1&digits=6&period=30',
    )
  })
})
