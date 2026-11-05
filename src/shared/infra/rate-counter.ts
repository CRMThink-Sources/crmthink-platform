import type { Redis } from 'ioredis'
import type { Clock } from '@/shared/clock'

/**
 * Contador por janela fixa: a primeira batida abre a janela de `windowMs`; as
 * seguintes só incrementam. Usado no limite de tentativas de login do backoffice.
 */
export interface RateCounter {
  /** Conta uma batida e devolve o total da janela e quanto falta para ela fechar. */
  hit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetMs: number }>
  reset(key: string): Promise<void>
}

// INCR + PEXPIRE só na primeira batida, atômico (sem janela "eterna" se o processo cair).
const HIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
return { count, redis.call("PTTL", KEYS[1]) }
`

export class RedisRateCounter implements RateCounter {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
  ) {}

  async hit(key: string, windowMs: number) {
    const [count, ttl] = (await this.redis.eval(
      HIT_SCRIPT,
      1,
      `${this.namespace}:${key}`,
      String(windowMs),
    )) as [number, number]
    return { count, resetMs: ttl > 0 ? ttl : windowMs }
  }

  async reset(key: string) {
    await this.redis.del(`${this.namespace}:${key}`)
  }
}

export class MemoryRateCounter implements RateCounter {
  private readonly windows = new Map<string, { count: number; until: number }>()

  constructor(private readonly clock: Clock) {}

  async hit(key: string, windowMs: number) {
    const now = this.clock.now().getTime()
    const current = this.windows.get(key)
    const window =
      current && current.until > now
        ? current
        : { count: 0, until: now + windowMs }
    window.count += 1
    this.windows.set(key, window)
    return { count: window.count, resetMs: window.until - now }
  }

  async reset(key: string) {
    this.windows.delete(key)
  }
}
