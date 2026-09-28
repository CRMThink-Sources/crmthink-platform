import { createHmac } from 'node:crypto'
import { safeEqual } from './timing-safe'

/**
 * Assinatura dos webhooks para apps e da chamada ao instalador:
 *
 *   X-Platform-Signature: t=<unix>,v1=<hex(hmac-sha256(secret, t + "." + body))>
 *
 * Nome do header e formato mantidos do contrato v1 já adotado pelo GPTMaker. Durante a
 * rotação do segredo, o header carrega um `v1=` por segredo vigente — o app aceita se
 * qualquer um conferir.
 */

export const SIGNATURE_HEADER = 'X-Platform-Signature'
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

export function computeSignature(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
}

export function buildSignatureHeader(
  secrets: string[],
  body: string,
  now: Date = new Date(),
): string {
  const timestamp = Math.floor(now.getTime() / 1000)
  const parts = secrets.map(
    secret => `v1=${computeSignature(secret, timestamp, body)}`,
  )
  return [`t=${timestamp}`, ...parts].join(',')
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: 'malformed' | 'expired' | 'mismatch' }

export function verifySignatureHeader(
  header: string | undefined,
  secret: string,
  body: string,
  now: Date = new Date(),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!header) return { ok: false, reason: 'malformed' }
  const parts = header.split(',').map(part => part.trim())
  const timestamp = Number(parts.find(p => p.startsWith('t='))?.slice(2))
  const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3))
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    return { ok: false, reason: 'malformed' }
  }
  if (Math.abs(now.getTime() / 1000 - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'expired' }
  }
  const expected = computeSignature(secret, timestamp, body)
  return signatures.some(signature => safeEqual(signature, expected))
    ? { ok: true }
    : { ok: false, reason: 'mismatch' }
}
