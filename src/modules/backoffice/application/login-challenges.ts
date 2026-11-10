import { createHash, randomBytes } from 'node:crypto'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import type { JsonCache } from '@/shared/infra/cache'

export const CHALLENGE_TTL_SECONDS = 5 * 60
export const CHALLENGE_MAX_ATTEMPTS = 5

export type LoginChallenge = {
  operatorId: number
  attempts: number
  /** Primeiro acesso: segredo ainda não gravado na conta, confirmado pelo primeiro código. */
  setupSecret?: string
}

type Stored = {
  operatorId: number
  attempts: number
  setupSecretEnc?: string
  /** Epoch ms. O cache em memória dos testes ignora o TTL, então a validade também vai no valor. */
  expiresAt: number
}

const keyOf = (token: string) =>
  `login-challenge:${createHash('sha256').update(token).digest('hex')}`

/**
 * Desafio entre a senha e o código TOTP: 256 bits aleatórios, de uso único, 5 minutos e
 * no máximo 5 códigos errados. Só o hash do token vira chave. O segredo do cadastro do
 * autenticador, quando existe, fica cifrado enquanto o desafio vive.
 */
export class LoginChallenges {
  constructor(
    private readonly cache: JsonCache,
    private readonly clock: Clock,
    private readonly cipher: TokenCipher,
  ) {}

  async create(operatorId: number, setupSecret?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    const stored: Stored = {
      operatorId,
      attempts: 0,
      expiresAt: this.clock.now().getTime() + CHALLENGE_TTL_SECONDS * 1000,
      ...(setupSecret
        ? { setupSecretEnc: this.cipher.encrypt(setupSecret) }
        : {}),
    }
    await this.cache.set(keyOf(token), stored, CHALLENGE_TTL_SECONDS)
    return token
  }

  async peek(token: string): Promise<LoginChallenge | null> {
    const stored = await this.load(token)
    if (!stored) return null
    return {
      operatorId: stored.operatorId,
      attempts: stored.attempts,
      ...(stored.setupSecretEnc
        ? { setupSecret: this.cipher.decrypt(stored.setupSecretEnc) }
        : {}),
    }
  }

  /** Um código errado: a quinta falha apaga o desafio. */
  async fail(token: string): Promise<void> {
    const stored = await this.load(token)
    if (!stored) return
    stored.attempts += 1
    if (stored.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      await this.consume(token)
      return
    }
    await this.cache.set(keyOf(token), stored, this.remainingSeconds(stored))
  }

  async consume(token: string): Promise<void> {
    await this.cache.del(keyOf(token))
  }

  private async load(token: string): Promise<Stored | null> {
    const stored = await this.cache.get<Stored>(keyOf(token))
    if (!stored) return null
    if (stored.expiresAt <= this.clock.now().getTime()) {
      await this.consume(token)
      return null
    }
    return stored
  }

  private remainingSeconds(stored: Stored): number {
    return Math.max(
      1,
      Math.ceil((stored.expiresAt - this.clock.now().getTime()) / 1000),
    )
  }
}
