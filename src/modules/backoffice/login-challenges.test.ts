import { describe, expect, it } from 'vitest'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { MemoryJsonCache } from '@/shared/infra/cache'
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
  )
  return { clock, cache, challenges }
}

describe('LoginChallenges', () => {
  it('cria um desafio opaco e devolve o estado', async () => {
    const { challenges } = setup()
    const token = await challenges.create(7)

    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(await challenges.peek(token)).toEqual({
      operatorId: 7,
      attempts: 0,
    })
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

  it('conta falhas e se apaga na quinta', async () => {
    const { challenges } = setup()
    const token = await challenges.create(7)

    await challenges.fail(token)
    expect((await challenges.peek(token))?.attempts).toBe(1)
    for (let i = 1; i < CHALLENGE_MAX_ATTEMPTS; i++)
      await challenges.fail(token)

    expect(await challenges.peek(token)).toBeNull()
  })

  it('token desconhecido não existe', async () => {
    const { challenges } = setup()

    expect(await challenges.peek('desconhecido')).toBeNull()
    await expect(challenges.fail('desconhecido')).resolves.toBeUndefined()
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
