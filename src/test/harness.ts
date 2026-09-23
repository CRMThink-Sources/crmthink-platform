import { DEFAULT_SPA_CONFIG, type SpaConfig } from '@/config/spa-config'
import { MemoryJsonCache } from '@/shared/infra/cache'
import { InMemoryJobQueue } from '@/shared/infra/queue'
import { buildContainer } from '@/container'
import { InMemoryPendingApplicationTokens } from '@/modules/installations/infra/pending-application-tokens'
import { FakePrisma } from './fake-prisma'
import {
  FakeBitrixPortal,
  FakeClock,
  FakeCrm,
  FakeGateway,
  FakeLocks,
  FakeOAuth,
  fakeFetch,
  testEnv,
} from './fakes'

export const GPTMAKER = 'crmthink.gptmaker'
export const GPTMAKER_CLIENT_ID = 'local.gptmaker'
export const MEMBER_ID = 'member-abc'
export const DOMAIN = 'cliente.bitrix24.com.br'

/** Configuração dos SPAs dos testes: produto "compra única" com enum 99001. */
export const TEST_SPA_CONFIG: SpaConfig = {
  ...DEFAULT_SPA_CONFIG,
  product: { ...DEFAULT_SPA_CONFIG.product, oneTimeBillingModelIds: ['99001'] },
}

export type HarnessOptions = {
  env?: Record<string, string>
  webhookHandler?: (
    url: string,
    init: RequestInit,
  ) => Response | Promise<Response>
}

/**
 * Grafo real da plataforma (`buildContainer`) sobre dublês: Prisma em memória, portal
 * CRMThink em memória, portal do cliente, OAuth, Stripe e `fetch` (instalador e
 * webhooks dos apps).
 */
export function createHarness(options: HarnessOptions = {}) {
  const env = testEnv(options.env)
  const db = new FakePrisma()
  const crm = new FakeCrm()
  const portal = new FakeBitrixPortal()
  const clock = new FakeClock()
  const oauth = new FakeOAuth()
  oauth.now = () => clock.now()
  oauth.onIssue = (accessToken, owner) =>
    portal.clientIdByToken.set(accessToken, owner.clientId)
  const gateway = new FakeGateway()
  db.useClock(() => clock.now())
  const locks = new FakeLocks()
  const queue = new InMemoryJobQueue()
  const cache = new MemoryJsonCache()
  const http = fakeFetch(
    options.webhookHandler ?? (() => new Response('{}', { status: 200 })),
  )

  const container = buildContainer({
    env,
    db: db.asDb(),
    locks,
    queue,
    cache,
    pendingTokens: new InMemoryPendingApplicationTokens(),
    clock,
    fetch: http.impl,
    oauth,
    bitrixClientFactory: portal.factory,
    crm: crm.asClient(),
    gateway,
    spaConfig: TEST_SPA_CONFIG,
  })

  return {
    env,
    db,
    crm,
    portal,
    oauth,
    gateway,
    clock,
    locks,
    queue,
    cache,
    http,
    container,
    config: TEST_SPA_CONFIG,
  }
}

export type Harness = ReturnType<typeof createHarness>

/** Cadastra o GPTMaker (trial de 14 dias no plano 500) e seus produtos/planos no SPA. */
export async function seedGptMaker(
  h: Harness,
  overrides: Record<string, unknown> = {},
) {
  const c = h.config
  h.crm.seed(c.entityTypes.product, {
    id: 10,
    title: 'GPTMaker',
    [c.product.billingModel]: '13605',
    [c.product.active]: 'Y',
  })
  h.crm.seed(c.entityTypes.product, {
    id: 11,
    title: 'Créditos GPTMaker',
    [c.product.billingModel]: '99001',
    [c.product.active]: 'Y',
  })
  const plan = (
    id: number,
    productId: number,
    title: string,
    value: number,
    extra: Record<string, unknown> = {},
  ) =>
    h.crm.seed(c.entityTypes.plan, {
      id,
      title,
      [c.plan.product]: productId,
      [c.plan.value]: value,
      [c.plan.interval]: '13609',
      [c.plan.active]: 'Y',
      ...extra,
    })
  plan(500, 10, 'Trial', 0)
  plan(501, 10, 'Básico', 9900, {
    [c.plan.gatewayIdHomolog]: 'price_basic',
    [c.plan.gatewayIdProduction]: 'price_basic_live',
  })
  plan(502, 10, 'Pro', 19900, {
    [c.plan.gatewayIdHomolog]: 'price_pro',
    [c.plan.gatewayIdProduction]: 'price_pro_live',
  })
  plan(510, 11, 'Pacote 1000', 4900, {
    [c.plan.interval]: '',
    [c.plan.gatewayIdHomolog]: 'price_pack',
  })

  const { app, credentials } = await h.container.registry.create({
    appCode: GPTMAKER,
    name: 'GPTMaker',
    bitrixClientId: GPTMAKER_CLIENT_ID,
    bitrixClientSecret: 'secret-gptmaker',
    scopes: ['crm', 'imbot'],
    installerUrl: 'https://gptmaker.app/platform/installer',
    webhookUrl: 'https://gptmaker.app/platform/events',
    productSpaIds: [10, 11],
    trialDays: 14,
    trialOnInstall: true,
    trialPlanId: 500,
    active: true,
    ...overrides,
  })
  return { app, credentials }
}

/** Prepara o portal do cliente para uma instalação do GPTMaker e devolve o payload de `POST /v1/install`. */
export function installPayload(
  h: Harness,
  options: {
    memberId?: string
    domain?: string
    admin?: boolean
    clientId?: string
    token?: string
  } = {},
) {
  const token =
    options.token ?? `browser-access-${Math.random().toString(36).slice(2)}`
  const refresh = `browser-refresh-${token}`
  const memberId = options.memberId ?? MEMBER_ID
  const domain = options.domain ?? DOMAIN
  h.portal.clientIdByToken.set(token, options.clientId ?? GPTMAKER_CLIENT_ID)
  if (options.admin !== false) h.portal.admins.add(token)
  h.oauth.owners.set(refresh, {
    clientId: options.clientId ?? GPTMAKER_CLIENT_ID,
    memberId,
    domain,
  })
  return {
    appCode: GPTMAKER,
    auth: {
      accessToken: token,
      refreshToken: refresh,
      expiresIn: 3600,
      memberId,
      domain,
    },
    contact: { email: 'admin@cliente.com', name: 'Admin' },
    acceptedTerms: true as const,
  }
}

export function outbox(h: Harness) {
  return h.db.rows('outboxEvent') as Array<{
    type: string
    payload: any
    installationId: number
    dedupeKey: string | null
    status: string
  }>
}
