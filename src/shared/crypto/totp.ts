import { createHmac, randomBytes } from 'node:crypto'
import { safeEqual } from './timing-safe'

/**
 * TOTP (RFC 6238) para o segundo fator dos operadores do backoffice: HMAC-SHA1,
 * 6 dígitos, passo de 30 s — o padrão que qualquer app autenticador lê de um
 * `otpauth://`. O segredo circula em base32 (RFC 4648), como os apps esperam.
 */

export const TOTP_STEP_SECONDS = 30
const DIGITS = 6
const SECRET_BYTES = 20
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(data: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of data) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) throw new Error('Segredo TOTP fora do alfabeto base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Segredo novo (160 bits, o tamanho da saída do SHA-1), em base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES))
}

export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS)
}

/** Código de um passo (HOTP com contador = passo). `digits` só muda nos vetores da RFC. */
export function totpCode(
  secret: string,
  step: number,
  digits = DIGITS,
): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/**
 * Passo aceito para `code` em `at` (±1 passo de tolerância de relógio), ou `null`.
 * `afterStep`: último passo já usado pela conta — só passos maiores valem, para o
 * mesmo código não ser aceito duas vezes.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: Date,
  afterStep = 0,
): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const current = totpStep(at)
  let accepted: number | null = null
  // Percorre a janela inteira sempre: o tempo não depende de qual passo casou.
  for (const step of [current - 1, current, current + 1]) {
    if (safeEqual(code, totpCode(secret, step)) && step > afterStep)
      accepted ??= step
  }
  return accepted
}

export function totpUri(options: {
  secret: string
  account: string
  issuer: string
}): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`)
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
