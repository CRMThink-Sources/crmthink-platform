import { describe, expect, it } from 'vitest'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { MemoryJsonCache } from '@/shared/infra/cache'
import { MemoryRateCounter } from '@/shared/infra/rate-counter'
import { FakeClock, TEST_KEY } from '@/test/fakes'
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_TTL_SECONDS,
  LoginChallenges,
} from './application/login-challenges'

function setup() {
  const clock = new FakeClock()
  const cache = new MemoryJsonCache()
  const challenges = new LoginChallenges(
    cache,
    clock,
    createTokenCipher(TEST_KEY),
    new MemoryRateCounter(clock),
  )
  return { clock, cache, challenges }
}

describe('LoginChallenges', () => {
  it('cria um desafio opaco e devolve o estado', async () => {
    const { challenges } = setup()
    const token = await challenges.create(7)

    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(await challenges.peek(token)).toEqual({ operatorId: 7 })
  })

  it('vale por 5 minutos', async () => {
    const { clock, challenges } = setup()
    const token = await challenges.create(7)

    clock.advance((CHALLENGE_TTL_SECONDS - 1) * 1000)
    expect(await challenges.peek(token)).not.toBeNull()
    clock.advance(2000)
    expect(await challenges.peek(token)).toBeNull()
  })

  it('é de uso único', async () => {
    const { challenges } = setup()
    const token = await challenges.create(7)

    await challenges.consume(token)

    expect(await challenges.peek(token)).toBeNull()
  })

  it('aceita 5 tentativas; a sexta apaga o desafio', async () => {
    const { challenges } = setup()
    const token = await challenges.create(7)

    for (let i = 0; i < CHALLENGE_MAX_ATTEMPTS; i++)
      expect(await challenges.attempt(token)).toBe(true)
    expect(await challenges.peek(token)).not.toBeNull()

    expect(await challenges.attempt(token)).toBe(false)
    expect(await challenges.peek(token)).toBeNull()
  })

  it('tentativas simultâneas também respeitam o teto', async () => {
    const { challenges } = setup()
    const token = await challenges.create(7)

    const results = await Promise.all(
      Array.from({ length: 12 }, () => challenges.attempt(token)),
    )

    expect(results.filter(Boolean)).toHaveLength(CHALLENGE_MAX_ATTEMPTS)
  })

  it('só o primeiro pedido reivindica o desafio', async () => {
    const { challenges } = setup()
    const token = await challenges.create(7)

    const results = await Promise.all([
      challenges.claim(token),
      challenges.claim(token),
      challenges.claim(token),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('token desconhecido não existe', async () => {
    const { challenges } = setup()

    expect(await challenges.peek('desconhecido')).toBeNull()
    expect(await challenges.claim('desconhecido')).toBe(true)
  })

  it('o segredo do cadastro volta em claro mas fica cifrado no cache', async () => {
    const { cache, challenges } = setup()
    const secret = 'JBSWY3DPEHPK3PXP'
    const token = await challenges.create(7, secret)

    expect((await challenges.peek(token))?.setupSecret).toBe(secret)
    const stored = [...cache.store.entries()]
    expect(stored).toHaveLength(1)
    const [key, value] = stored[0]!
    expect(value).not.toContain(secret)
    expect(key).not.toContain(token)
  })
})
