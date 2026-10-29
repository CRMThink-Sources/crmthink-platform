import type { Redis } from 'ioredis'
import type { Env } from '@/config/env'
import { loadSpaConfig, type SpaConfig } from '@/config/spa-config'
import { systemClock, type Clock } from '@/shared/clock'
import {
  createTokenCipher,
  type TokenCipher,
} from '@/shared/crypto/token-cipher'
import {
  BitrixRestClient,
  type Fetch,
} from '@/shared/bitrix/bitrix-rest.client'
import {
  BitrixOAuthClient,
  type BitrixOAuth,
} from '@/shared/bitrix/bitrix-oauth.client'
import { RedisJsonCache, type JsonCache } from '@/shared/infra/cache'
import type { Db } from '@/shared/infra/prisma'
import type { JobQueue } from '@/shared/infra/queue'
import type { LockStore } from '@/shared/infra/redis'
import { RedisRateCounter, type RateCounter } from '@/shared/infra/rate-counter'
import { SpaEnvironment } from '@/shared/spa/environment'
import { AppRegistry } from '@/modules/registry/app-registry'
import { EventDelivery } from '@/modules/events/event-delivery'
import {
  BitrixAuthVerifier,
  type BitrixClientFactory,
} from '@/modules/installations/application/bitrix-auth-verifier'
import { BitrixAppEvents } from '@/modules/installations/application/bitrix-app-events'
import { InstallService } from '@/modules/installations/application/install-service'
import { InstallationQueries } from '@/modules/installations/application/installation-queries'
import { SessionService } from '@/modules/installations/application/session-service'
import { SigningKeys } from '@/modules/installations/application/signing-keys'
import { TokenVault } from '@/modules/installations/application/token-vault'
import { PrismaInstallationDirectory } from '@/modules/installations/infra/installation-directory'
import { InstallationSpa } from '@/modules/installations/infra/installation-spa'
import { InstallerClient } from '@/modules/installations/infra/installer-client'
import {
  RedisPendingApplicationTokens,
  type PendingApplicationTokens,
} from '@/modules/installations/infra/pending-application-tokens'
import { BillingContext } from '@/modules/billing/application/billing-context'
import { CheckoutService } from '@/modules/billing/application/checkout-service'
import { ItemsService } from '@/modules/billing/application/items-service'
import { ManualLifecycle } from '@/modules/billing/application/manual-lifecycle'
import { PeriodEndingJob } from '@/modules/billing/application/period-ending-job'
import { PlanCatalog } from '@/modules/billing/application/plan-catalog'
import { PurchaseService } from '@/modules/billing/application/purchase-service'
import { RefundService } from '@/modules/billing/application/refund-service'
import {
  SpaEventProcessor,
  SpaEventsIngest,
} from '@/modules/billing/application/spa-events'
import { StripeLifecycle } from '@/modules/billing/application/stripe-lifecycle'
import {
  StripeEventProcessor,
  StripeWebhookIngest,
} from '@/modules/billing/application/stripe-webhooks'
import { SubscriptionQueries } from '@/modules/billing/application/subscription-queries'
import { SubscriptionWriter } from '@/modules/billing/application/subscription-writer'
import { Sweeps } from '@/modules/billing/application/sweeps'
import { TrialService } from '@/modules/billing/application/trial-service'
import { CatalogRepository } from '@/modules/billing/infra/spa/catalog-repository'
import { SpaMappers } from '@/modules/billing/infra/spa/spa-mappers'
import { SubscriptionRepository } from '@/modules/billing/infra/spa/subscription-repository'
import { CacheInvalidatingPaymentGateway } from '@/modules/billing/infra/stripe/cache-invalidating-gateway'
import { StripePaymentGateway } from '@/modules/billing/infra/stripe/stripe-gateway'
import type { PaymentGateway } from '@/modules/billing/ports/payment-gateway'
import { AdminAudit } from '@/modules/backoffice/application/audit'
import { LoginService } from '@/modules/backoffice/application/login'
import { OperatorService } from '@/modules/backoffice/application/operators'
import { AdminSessions } from '@/modules/backoffice/application/sessions'
import { totpIssuer } from '@/modules/backoffice/domain/operator'
import { InstallationReads } from '@/modules/backoffice/application/installation-reads'
import { OverviewQuery } from '@/modules/backoffice/application/overview'

/**
 * Composition root. Tudo que tem efeito externo (banco, Redis, Bitrix, Stripe, relógio,
 * fetch) entra por `ContainerDeps`, o que permite montar o mesmo grafo nos testes com
 * dublês.
 */
export type ContainerDeps = {
  env: Env
  db: Db
  redis?: Redis
  locks: LockStore
  queue: JobQueue
  cache?: JsonCache
  /** Contadores do limite de tentativas de login (Redis por padrão). */
  counters?: RateCounter
  pendingTokens?: PendingApplicationTokens
  clock?: Clock
  fetch?: Fetch
  oauth?: BitrixOAuth
  bitrixClientFactory?: BitrixClientFactory
  crm?: BitrixRestClient
  gateway?: PaymentGateway
  spaConfig?: SpaConfig
}

export function buildContainer(deps: ContainerDeps) {
  const { env, db, locks, queue } = deps
  const clock = deps.clock ?? systemClock
  const fetchImpl = deps.fetch ?? fetch
  const cipher: TokenCipher = createTokenCipher(env.tokenEncryptionKey)
  const spaConfig =
    deps.spaConfig ?? loadSpaConfig(env.spaConfigFile || undefined)
  const environment = new SpaEnvironment(
    env.platformEnvironment,
    spaConfig.environmentValues,
  )

  const cache: JsonCache =
    deps.cache ??
    new RedisJsonCache(deps.redis as Redis, `${env.queuePrefix}:cache`)
  const pendingTokens =
    deps.pendingTokens ??
    new RedisPendingApplicationTokens(deps.redis as Redis, env.queuePrefix)

  // Portal CRMThink (SPAs) via webhook de entrada. Sem webhook, a criação é adiada até o uso.
  const crm =
    deps.crm ??
    (env.crmthink.webhookUrl
      ? BitrixRestClient.forWebhook(env.crmthink.webhookUrl, {
          fetch: fetchImpl,
        })
      : (new Proxy(
          {},
          {
            get() {
              throw new Error('CRMTHINK_WEBHOOK_URL não configurado')
            },
          },
        ) as BitrixRestClient))

  const clientFor: BitrixClientFactory =
    deps.bitrixClientFactory ??
    ((domain, accessToken) =>
      BitrixRestClient.forOAuth(domain, accessToken, { fetch: fetchImpl }))
  const oauth = deps.oauth ?? new BitrixOAuthClient(fetchImpl)

  // Registro e eventos
  const registry = new AppRegistry(
    db,
    cipher,
    clock,
    env.credentialRotationGraceMs,
  )
  const delivery = new EventDelivery(
    db,
    registry,
    locks,
    clock,
    {
      timeoutMs: env.webhookTimeoutMs,
      retryWindowMs: env.eventRetryWindowMs,
    },
    fetchImpl,
  )

  // Instalações
  const verifier = new BitrixAuthVerifier(clientFor, oauth)
  const installationSpa = new InstallationSpa(crm, spaConfig, environment)
  const installationDirectory = new PrismaInstallationDirectory(db)
  const queries = new InstallationQueries(db, cipher)
  const vault = new TokenVault(
    db,
    registry,
    queries,
    oauth,
    cipher,
    locks,
    clock,
  )
  const signingKeys = new SigningKeys(db, cipher, clock, {
    issuer: env.jwt.issuer,
    ttlSeconds: env.jwt.ttlSeconds,
  })
  const sessions = new SessionService(db, registry, verifier, signingKeys)
  const appEvents = new BitrixAppEvents(
    db,
    registry,
    verifier,
    cipher,
    pendingTokens,
    clock,
  )

  // Cobrança
  const baseGateway: PaymentGateway =
    deps.gateway ??
    new StripePaymentGateway(env.stripe.secretKey, env.stripe.webhookSecret)
  const gateway = new CacheInvalidatingPaymentGateway(baseGateway, cache)
  const mappers = new SpaMappers(spaConfig, environment, env.stripe.environment)
  const catalog = new CatalogRepository(
    crm,
    spaConfig,
    mappers,
    cache,
    env.stripe.environment,
  )
  const subscriptionRepo = new SubscriptionRepository(
    crm,
    spaConfig,
    mappers,
    environment,
  )
  const billingContext = new BillingContext(
    installationDirectory,
    subscriptionRepo,
    locks,
  )
  const writer = new SubscriptionWriter(db, subscriptionRepo)
  const plans = new PlanCatalog(catalog)
  const trials = new TrialService(
    billingContext,
    writer,
    registry,
    installationSpa,
    clock,
  )
  const purchases = new PurchaseService(db, billingContext, writer, gateway)
  const refunds = new RefundService(db, billingContext, writer, gateway)
  const lifecycle = new StripeLifecycle(
    billingContext,
    writer,
    gateway,
    registry,
    plans,
    clock,
  )
  const manual = new ManualLifecycle(billingContext, writer)
  const items = new ItemsService(
    db,
    billingContext,
    writer,
    catalog,
    gateway,
    clock,
  )
  const checkout = new CheckoutService(
    billingContext,
    plans,
    gateway,
    purchases,
  )
  const subscriptionQueries = new SubscriptionQueries(
    billingContext,
    writer,
    catalog,
    plans,
    gateway,
    clock,
  )
  const periodEnding = new PeriodEndingJob(db, billingContext, writer, clock)
  const stripeIngest = new StripeWebhookIngest(db, gateway, queue)
  const stripeProcessor = new StripeEventProcessor(
    db,
    gateway,
    lifecycle,
    purchases,
    refunds,
    id => gateway.onSubscriptionChanged(id),
  )
  const spaIngest = new SpaEventsIngest(env.crmthink.applicationToken, queue)
  const spaProcessor = new SpaEventProcessor(
    spaConfig,
    catalog,
    manual,
    items,
    spaItemId => queries.unlinkSpaItem(spaItemId),
  )
  const sweeps = new Sweeps(
    db,
    billingContext,
    writer,
    gateway,
    registry,
    lifecycle,
    manual,
    items,
    clock,
  )

  // Backoffice
  const counters: RateCounter =
    deps.counters ??
    new RedisRateCounter(deps.redis as Redis, `${env.queuePrefix}:rate`)
  const audit = new AdminAudit(db, clock, env.backoffice.auditRetentionDays)
  const adminSessions = new AdminSessions(db, clock, env.backoffice)
  const operators = new OperatorService(
    db,
    cipher,
    totpIssuer(env.platformEnvironment),
    (id, except) => adminSessions.revokeAll(id, except),
  )
  const login = new LoginService(
    db,
    cipher,
    adminSessions,
    counters,
    audit,
    clock,
  )

  const installationReads = new InstallationReads(
    db,
    registry,
    subscriptionQueries,
  )
  const overview = new OverviewQuery(db, cache, clock)

  const install = new InstallService({
    db,
    registry,
    verifier,
    spa: installationSpa,
    installer: new InstallerClient(env.installerTimeoutMs, fetchImpl),
    clientFor,
    cipher,
    pendingTokens,
    trial: trials,
    clock,
    publicBaseUrl: env.publicBaseUrl,
  })

  return {
    env,
    db,
    clock,
    cipher,
    spaConfig,
    crm,
    registry,
    delivery,
    install,
    appEvents,
    queries,
    vault,
    signingKeys,
    sessions,
    gateway,
    catalog,
    plans,
    trials,
    purchases,
    refunds,
    lifecycle,
    manual,
    items,
    checkout,
    subscriptionQueries,
    periodEnding,
    stripeIngest,
    stripeProcessor,
    spaIngest,
    spaProcessor,
    sweeps,
    audit,
    adminSessions,
    operators,
    login,
    installationReads,
    overview,
  }
}

export type Container = ReturnType<typeof buildContainer>
