import type { Redis } from 'ioredis'

/**
 * `ONAPPINSTALL` pode chegar antes do `POST /v1/install` gravar a instalação. O token
 * (já cifrado) espera aqui por até 1h e é consumido quando a instalação é gravada.
 */
export interface PendingApplicationTokens {
  put(appCode: string, memberId: string, tokenEnc: string): Promise<void>
  take(appCode: string, memberId: string): Promise<string | null>
}

const TTL_SECONDS = 3600

export class RedisPendingApplicationTokens implements PendingApplicationTokens {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  private key(appCode: string, memberId: string): string {
    return `${this.prefix}:pending-app-token:${appCode}:${memberId}`
  }

  async put(
    appCode: string,
    memberId: string,
    tokenEnc: string,
  ): Promise<void> {
    await this.redis.set(
      this.key(appCode, memberId),
      tokenEnc,
      'EX',
      TTL_SECONDS,
    )
  }

  async take(appCode: string, memberId: string): Promise<string | null> {
    const key = this.key(appCode, memberId)
    const value = await this.redis.get(key)
    if (value) await this.redis.del(key)
    return value
  }
}

export class InMemoryPendingApplicationTokens implements PendingApplicationTokens {
  private readonly store = new Map<string, string>()
  async put(
    appCode: string,
    memberId: string,
    tokenEnc: string,
  ): Promise<void> {
    this.store.set(`${appCode}:${memberId}`, tokenEnc)
  }
  async take(appCode: string, memberId: string): Promise<string | null> {
    const key = `${appCode}:${memberId}`
    const value = this.store.get(key) ?? null
    this.store.delete(key)
    return value
  }
}
