import { createHash, randomBytes } from 'node:crypto'

/**
 * Chave de API das aplicações. Só o hash (SHA-256) é guardado: a chave tem 256 bits
 * aleatórios, então hash lento não acrescenta nada e a busca por hash é direta.
 */

export function generateApiKey(): string {
  return `cp_${randomBytes(32).toString('base64url')}`
}

/** Chave de uma integração de pagamento (`POST /webhooks/payments`); mesmo hash da chave de app. */
export function generatePaymentKey(): string {
  return `pay_${randomBytes(32).toString('base64url')}`
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}
