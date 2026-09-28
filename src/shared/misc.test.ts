import { describe, expect, it } from 'vitest'
import {
  buildEnv,
  parseSessionCorsOrigins,
  resolveStripeEnvironment,
} from '@/config/env'
import {
  resolveBitrixTokenExpiresAt,
  normalizeBitrixDomain,
} from '@/shared/bitrix/normalize'
import { BitrixOAuthClient } from '@/shared/bitrix/bitrix-oauth.client'
import { scrubSecrets } from '@/shared/observability/logger'
import { parseSpaEvent } from '@/modules/billing/application/spa-events'
import { nextBackoffMs } from '@/modules/events/event-delivery'
import {
  readMetadata,
  STATUS_BY_STRIPE_STATUS,
  StripePaymentGateway,
} from '@/modules/billing/infra/stripe/stripe-gateway'
import { parsePlanChange } from '@/modules/billing/application/stripe-lifecycle'
import { TEST_KEY } from '@/test/fakes'

describe('env', () => {
  const base = {
    PUBLIC_BASE_URL: 'https://p.test',
    PLATFORM_ENVIRONMENT: 'homolog',
    REDIS_URL: 'redis://x',
    TOKEN_ENCRYPTION_KEY: TEST_KEY,
  }

  it('falha no boot sem chave de cifragem', () => {
    expect(() => buildEnv({ ...base, TOKEN_ENCRYPTION_KEY: '' })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    )
    expect(() => buildEnv({ ...base, TOKEN_ENCRYPTION_KEY: 'curta' })).toThrow(
      /32 bytes/,
    )
  })

  it('exige PLATFORM_ENVIRONMENT válido', () => {
    expect(() =>
      buildEnv({ ...base, PLATFORM_ENVIRONMENT: 'staging' }),
    ).toThrow(/PLATFORM_ENVIRONMENT/)
  })

  it('SESSION_CORS_ORIGINS por app', () => {
    const map = parseSessionCorsOrigins(
      'crmthink.gptmaker=https://a.app, https://b.app/;crmthink.thinkzap=https://z.app',
    )
    expect([...(map.get('crmthink.gptmaker') ?? [])]).toEqual([
      'https://a.app',
      'https://b.app',
    ])
    expect([...(map.get('crmthink.thinkzap') ?? [])]).toEqual(['https://z.app'])
  })

  it('ambiente Stripe pelo prefixo da chave', () => {
    expect(resolveStripeEnvironment('sk_live_x')).toBe('production')
    expect(resolveStripeEnvironment('rk_live_x')).toBe('production')
    expect(resolveStripeEnvironment('sk_test_x')).toBe('homolog')
    expect(resolveStripeEnvironment('')).toBe('homolog')
  })
})

describe('normalização do Bitrix', () => {
  const now = new Date('2026-09-01T12:00:00Z')
  it('expires como TTL, epoch em segundos e em ms', () => {
    expect(resolveBitrixTokenExpiresAt(3600, now).toISOString()).toBe(
      '2026-09-01T13:00:00.000Z',
    )
    expect(resolveBitrixTokenExpiresAt(1788264000, now).toISOString()).toBe(
      new Date(1788264000 * 1000).toISOString(),
    )
    expect(resolveBitrixTokenExpiresAt(1788264000000, now).toISOString()).toBe(
      new Date(1788264000000).toISOString(),
    )
  })
  it('domínio sem esquema nem barra', () => {
    expect(normalizeBitrixDomain('https://Cliente.Bitrix24.com.br/')).toBe(
      'cliente.bitrix24.com.br',
    )
  })
})

describe('logs sem tokens', () => {
  it('remove auth de URLs em mensagens', () => {
    expect(
      scrubSecrets('POST https://x/rest/profile.json?auth=abc123&x=1'),
    ).toBe('POST https://x/rest/profile.json?auth=[REDACTED]&x=1')
    expect(scrubSecrets('?refresh_token=r1&client_secret=s')).toBe(
      '?refresh_token=[REDACTED]&client_secret=[REDACTED]',
    )
  })
})

describe('eventos dos SPAs', () => {
  it('verbo e SPA pelo nome do evento ou pelo payload', () => {
    expect(
      parseSpaEvent({
        event: 'ONCRMDYNAMICITEMUPDATE',
        data: { FIELDS: { ID: '5', ENTITY_TYPE_ID: '1142' } },
      }),
    ).toEqual({
      entityTypeId: 1142,
      itemId: 5,
      verb: 'UPDATE',
    })
    expect(
      parseSpaEvent({
        event: 'ONCRMDYNAMICITEMDELETE_1146',
        data: { FIELDS: { ID: 9 } },
      }),
    ).toEqual({
      entityTypeId: 1146,
      itemId: 9,
      verb: 'DELETE',
    })
    expect(
      parseSpaEvent({ event: 'OUTRO', data: { FIELDS: { ID: 9 } } }),
    ).toBeNull()
  })
})

describe('entrega de eventos', () => {
  it('backoff exponencial com teto de 1h', () => {
    expect(nextBackoffMs(1)).toBe(30_000)
    expect(nextBackoffMs(2)).toBe(60_000)
    expect(nextBackoffMs(20)).toBe(3_600_000)
  })
})

describe('Stripe', () => {
  it('mapa de status (D10)', () => {
    expect(STATUS_BY_STRIPE_STATUS).toMatchObject({
      active: 'active',
      trialing: 'active',
      past_due: 'past_due',
      unpaid: 'past_due',
      incomplete: 'past_due',
      incomplete_expired: 'past_due',
      paused: 'past_due',
      canceled: 'cancelled',
    })
  })

  it('metadados incompletos ou do hub-core não são roteáveis', () => {
    expect(
      readMetadata({
        appCode: 'a',
        installationId: '1',
        planId: '2',
        intent: 'subscribe',
      }),
    ).toEqual({
      appCode: 'a',
      installationId: 1,
      planId: 2,
      intent: 'subscribe',
    })
    expect(
      readMetadata({
        appCode: 'crmthink.thinkzap',
        domainId: 'uuid',
        planId: '2',
        intent: 'convert',
      }),
    ).toBeNull()
  })

  it('normaliza evento não tratado como ignored', () => {
    const gateway = new StripePaymentGateway('', 'whsec')
    expect(
      gateway.normalize({ type: 'customer.created', data: { object: {} } }),
    ).toEqual({ type: 'ignored', name: 'customer.created' })
  })

  it('troca de plano nos metadados', () => {
    expect(parsePlanChange('immediate:502:0.5000')).toEqual({
      effective: 'immediate',
      planId: 502,
      remainingFraction: 0.5,
    })
    expect(parsePlanChange('next_period:501')).toEqual({
      effective: 'next_period',
      planId: 501,
    })
    expect(parsePlanChange('lixo')).toBeNull()
  })
})

describe('OAuth do Bitrix', () => {
  const refreshWith = (body: object) =>
    new BitrixOAuthClient(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    ).refresh({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })

  it('domínio do portal vem de client_endpoint, não do domain do servidor OAuth', async () => {
    const tokens = await refreshWith({
      access_token: 'a',
      refresh_token: 'r2',
      expires_in: 3600,
      member_id: 'm1',
      domain: 'oauth.bitrix.info',
      client_endpoint: 'https://Cliente.Bitrix24.com.br/rest/',
    })
    expect(tokens.domain).toBe('cliente.bitrix24.com.br')
  })

  it('sem client_endpoint, oauth.bitrix.info não conta como portal', async () => {
    const tokens = await refreshWith({
      access_token: 'a',
      refresh_token: 'r2',
      member_id: 'm1',
      domain: 'oauth.bitrix.info',
    })
    expect(tokens.domain).toBeNull()
  })
})
