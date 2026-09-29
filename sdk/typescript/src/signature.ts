import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-platform-signature'
export const DEFAULT_TOLERANCE_SECONDS = 300

export type SignatureResult =
  { ok: true } | { ok: false; reason: 'malformed' | 'expired' | 'mismatch' }

function sameDigest(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

/**
 * `X-Platform-Signature: t=<unix>,v1=<hex(hmac-sha256(secret, t + "." + body))>`.
 *
 * Use o corpo **cru** (bytes recebidos), nunca o JSON re-serializado. Durante a rotação
 * do segredo o header traz um `v1=` por segredo; passe os seus segredos vigentes.
 */
export function verifyPlatformSignature(input: {
  header: string | undefined | null
  rawBody: string | Buffer
  secrets: string[]
  now?: Date
  toleranceSeconds?: number
}): SignatureResult {
  if (!input.header) return { ok: false, reason: 'malformed' }
  const parts = input.header.split(',').map(part => part.trim())
  const timestamp = Number(parts.find(p => p.startsWith('t='))?.slice(2))
  const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3))
  if (!Number.isInteger(timestamp) || signatures.length === 0)
    return { ok: false, reason: 'malformed' }
  const now = (input.now ?? new Date()).getTime() / 1000
  if (
    Math.abs(now - timestamp) >
    (input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)
  ) {
    return { ok: false, reason: 'expired' }
  }
  const body =
    typeof input.rawBody === 'string'
      ? input.rawBody
      : input.rawBody.toString('utf8')
  for (const secret of input.secrets) {
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')
    if (signatures.some(signature => sameDigest(signature, expected)))
      return { ok: true }
  }
  return { ok: false, reason: 'mismatch' }
}
