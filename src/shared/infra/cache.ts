import type { Redis } from 'ioredis'

/** Cache JSON com TTL. Redis em produção, memória nos testes. */
export interface JsonCache {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>
  del(...keys: string[]): Promise<void>
  /** Apaga por prefixo (SCAN), para famílias sem índice reverso. */
  delPrefix(prefix: string): Promise<void>
}

export class RedisJsonCache implements JsonCache {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
  ) {}

  private k(key: string): string {
    return `${this.namespace}:${key}`
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.k(key))
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.k(key), JSON.stringify(value), 'EX', ttlSeconds)
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys.map(key => this.k(key)))
  }

  async delPrefix(prefix: string): Promise<void> {
    let cursor = '0'
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.k(prefix)}*`,
        'COUNT',
        200,
      )
      cursor = next
      if (keys.length) await this.redis.del(...keys)
    } while (cursor !== '0')
  }
}

export class MemoryJsonCache implements JsonCache {
  readonly store = new Map<string, string>()
  async get<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key)
    return raw ? (JSON.parse(raw) as T) : null
  }
  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(value))
  }
  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key)
  }
  async delPrefix(prefix: string): Promise<void> {
    for (const key of [...this.store.keys()])
      if (key.startsWith(prefix)) this.store.delete(key)
  }
}
