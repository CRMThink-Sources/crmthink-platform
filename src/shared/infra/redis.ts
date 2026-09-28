import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'

export function createRedis(url: string): Redis {
  // `maxRetriesPerRequest: null` é exigência do BullMQ para conexões de worker.
  return new Redis(url, { maxRetriesPerRequest: null })
}

/** Subconjunto do Redis que o lock usa — satisfeito pelo ioredis e por um dublê de teste. */
export interface LockStore {
  set(
    key: string,
    value: string,
    px: 'PX',
    ttl: number,
    nx: 'NX',
  ): Promise<'OK' | null>
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

export class LockTimeoutError extends Error {
  constructor(key: string) {
    super(`Não foi possível obter o lock ${key}`)
    this.name = 'LockTimeoutError'
  }
}

/**
 * Lock distribuído (SET NX PX + liberação atômica pelo dono).
 *
 * `waitMs` > 0 espera o lock ficar livre (polling curto). Quem espera o lock da
 * renovação de token não precisa renovar de novo: ao entrar, relê o token e, se já
 * mudou, devolve o novo — é o single-flight entre processos.
 */
export async function withLock<T>(
  store: LockStore,
  key: string,
  options: { ttlMs: number; waitMs?: number; pollMs?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const owner = randomUUID()
  const deadline = Date.now() + (options.waitMs ?? 0)
  const pollMs = options.pollMs ?? 100

  for (;;) {
    const acquired = await store.set(key, owner, 'PX', options.ttlMs, 'NX')
    if (acquired === 'OK') break
    if (Date.now() >= deadline) throw new LockTimeoutError(key)
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }

  try {
    return await fn()
  } finally {
    await store.eval(RELEASE_SCRIPT, 1, key, owner)
  }
}

/**
 * Single-flight dentro do processo: chamadas concorrentes com a mesma chave
 * compartilham a mesma promessa.
 */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>()

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const promise = fn().finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, promise)
    return promise
  }
}
