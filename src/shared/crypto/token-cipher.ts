import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Cifra simétrica para segredos em repouso (tokens do Bitrix, `application_token`,
 * `client_secret`, segredos HMAC, chaves privadas do JWT).
 *
 * AES-256-GCM (autenticado: detecta adulteração). Formato:
 *   `v1:<base64(iv | authTag | ciphertext)>`
 *
 * Portado de `hub-core/api/src/shared/infra/crypto/token-cipher.ts`, sem o caminho de
 * texto puro legado: aqui nada nasce sem cifra, então um valor sem prefixo é dado
 * corrompido ou importado sem cifrar — e decifrá-lo "como está" esconderia isso.
 */

const VERSION_PREFIX = 'v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const KEY_BYTES = 32

export class EncryptionKeyError extends Error {
  constructor(detail: string) {
    super(`TOKEN_ENCRYPTION_KEY inválida: ${detail}`)
    this.name = 'EncryptionKeyError'
  }
}

export interface TokenCipher {
  encrypt(plaintext: string): string
  decrypt(value: string): string
}

export function createTokenCipher(keyBase64: string): TokenCipher {
  if (!keyBase64) throw new EncryptionKeyError('não configurada')
  const key = Buffer.from(keyBase64, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError(
      `esperado ${KEY_BYTES} bytes (base64), recebido ${key.length}`,
    )
  }

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ])
      const packed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
      return VERSION_PREFIX + packed.toString('base64')
    },

    decrypt(value: string): string {
      if (!value.startsWith(VERSION_PREFIX)) {
        throw new Error('Valor cifrado sem prefixo de versão conhecido')
      }
      const packed = Buffer.from(value.slice(VERSION_PREFIX.length), 'base64')
      const iv = packed.subarray(0, IV_BYTES)
      const authTag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES)
      const ciphertext = packed.subarray(IV_BYTES + AUTH_TAG_BYTES)
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}
