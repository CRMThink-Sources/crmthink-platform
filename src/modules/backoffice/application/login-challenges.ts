import { createHash, randomBytes } from 'node:crypto'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import type { JsonCache } from '@/shared/infra/cache'
import type { RateCounter } from '@/shared/infra/rate-counter'

export const CHALLENGE_TTL_SECONDS = 5 * 60
export const CHALLENGE_MAX_ATTEMPTS = 5

export type LoginChallenge = {
  operatorId: number
  /** Primeiro acesso: segredo ainda não gravado na conta, confirmado pelo primeiro código. */
  setupSecret?: string
}

type Stored = {
  operatorId: number
  setupSecretEnc?: string
  /** Epoch ms. O cache em memória dos testes ignora o TTL, então a validade também vai no valor. */
  expiresAt: number
}

const hashOf = (token: string) =>
  createHash('sha256').update(token).digest('hex')
const keyOf = (token: string) => `login-challenge:${hashOf(token)}`

/**
 * Desafio entre a senha e o código TOTP: 256 bits aleatórios, de uso único, 5 minutos e
 * no máximo 5 tentativas de código. Só o hash do token vira chave. O segredo do cadastro do
 * autenticador, quando existe, fica cifrado enquanto o desafio vive.
 *
 * Tentativas e uso único são contados no `RateCounter` (INCR atômico no Redis), nunca por
 * ler-e-regravar o desafio: pedidos paralelos não furam o teto nem reabrem um desafio usado.
 */
export class LoginChallenges {
  constructor(
    private readonly cache: JsonCache,
    private readonly clock: Clock,
    private readonly cipher: TokenCipher,
    private readonly counters: RateCounter,
  ) {}

  async create(operatorId: number, setupSecret?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    const stored: Stored = {
      operatorId,
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
      ...(stored.setupSecretEnc
        ? { setupSecret: this.cipher.decrypt(stored.setupSecretEnc) }
        : {}),
    }
  }

  /**
   * Conta uma tentativa de código, antes de conferi-lo. A 6ª em diante apaga o desafio e
   * devolve `false`: o teto vale mesmo com pedidos simultâneos.
   */
  async attempt(token: string): Promise<boolean> {
    const hit = await this.counters.hit(
      `login-challenge-attempts:${hashOf(token)}`,
      CHALLENGE_TTL_SECONDS * 1000,
    )
    if (hit.count > CHALLENGE_MAX_ATTEMPTS) {
      await this.consume(token)
      return false
    }
    return true
  }

  /** Reivindica o desafio para abrir a sessão: só o primeiro pedido leva (uso único). */
  async claim(token: string): Promise<boolean> {
    const hit = await this.counters.hit(
      `login-challenge-claim:${hashOf(token)}`,
      CHALLENGE_TTL_SECONDS * 1000,
    )
    return hit.count === 1
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
}
