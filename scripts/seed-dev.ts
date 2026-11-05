import { randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import type { Prisma } from '@/prisma/client'
import { systemClock } from '@/shared/clock'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { createPrismaClient } from '@/shared/infra/prisma'
import { AppRegistry } from '@/modules/registry/app-registry'

/**
 * `yarn seed:dev`: dados de exemplo para ver o backoffice com conteúdo (instalações em
 * vários estados, eventos entregues, pendentes e mortos, tentativas de instalação,
 * eventos Stripe). **Só em banco local**: recusa qualquer outro `DATABASE_URL`.
 *
 * Idempotente: apaga e recria só o que ele mesmo criou (instalações `9001–9099` e seus
 * eventos); apps e operadores existentes ficam como estão. Nada é enviado a Bitrix,
 * Stripe nem aos apps: são só linhas no banco.
 */

const GPTMAKER = 'crmthink.gptmaker'
const TESTE = 'crmthink.teste'
const FIRST_ID = 9001
const LAST_ID = 9099

const config = env()
const url = new URL(config.databaseUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
  throw new Error(
    `seed:dev só roda em banco local (DATABASE_URL aponta para ${url.hostname}).`,
  )
}
if (config.nodeEnv === 'production') {
  throw new Error('seed:dev não roda com NODE_ENV=production.')
}

const db = createPrismaClient(config.databaseUrl)
const cipher = createTokenCipher(config.tokenEncryptionKey)
const now = Date.now()
const ago = (minutes: number) => new Date(now - minutes * 60_000)
const DAY = 24 * 60

async function ensureApps(): Promise<void> {
  const registry = new AppRegistry(
    db,
    cipher,
    systemClock,
    config.credentialRotationGraceMs,
  )
  if (!(await registry.get(GPTMAKER))) {
    await registry.create({
      appCode: GPTMAKER,
      name: 'GPTMaker',
      logoUrl: null,
      installTheme: {
        primaryColor: '#6d28d9',
        title: 'Instalar o GPTMaker',
        welcomeText: 'Conecte o GPTMaker ao seu Bitrix24 em um clique.',
      },
      bitrixClientId: 'local.gptmaker-seed',
      bitrixClientSecret: 'segredo-de-exemplo',
      bitrixAppCode: null,
      scopes: ['crm', 'imbot', 'imopenlines'],
      installerUrl: 'https://gptmaker.example.test/platform/installer',
      webhookUrl: 'https://gptmaker.example.test/platform/events',
      productSpaIds: [10, 11],
      trialDays: 14,
      trialOnInstall: true,
      trialPlanId: 500,
      active: true,
    })
  }
  if (!(await registry.get(TESTE))) {
    await registry.create({
      appCode: TESTE,
      name: 'App Teste',
      bitrixClientId: 'local.teste-seed',
      bitrixClientSecret: 'segredo-de-exemplo',
      scopes: ['crm'],
      productSpaIds: [],
      trialDays: 0,
      trialOnInstall: false,
      active: true,
    })
  }
}

type Seed = {
  id: number
  appCode: string
  domain: string
  status: 'ACTIVE' | 'INSTALL_PENDING' | 'AUTH_ERROR' | 'UNINSTALLED'
  installedDaysAgo: number
  trialUsed?: boolean
  contact?: Record<string, string>
  /** `null`: sem credencial. */
  credential: null | {
    expiresInMinutes: number
    refreshFailures?: number
    lastRefreshError?: string
  }
}

const INSTALLATIONS: Seed[] = [
  {
    id: 9001,
    appCode: GPTMAKER,
    domain: 'alfa.bitrix24.com.br',
    status: 'ACTIVE',
    installedDaysAgo: 40,
    credential: { expiresInMinutes: 45 },
  },
  {
    id: 9002,
    appCode: GPTMAKER,
    domain: 'beta-vendas.bitrix24.com.br',
    status: 'ACTIVE',
    installedDaysAgo: 25,
    trialUsed: true,
    contact: { name: 'Marina Souza', email: 'marina@beta-vendas.test' },
    credential: {
      expiresInMinutes: -30,
      refreshFailures: 3,
      lastRefreshError:
        'Bitrix OAuth recusou o refresh token: invalid_grant (seed)',
    },
  },
  {
    id: 9003,
    appCode: GPTMAKER,
    domain: 'gama.bitrix24.com.br',
    status: 'INSTALL_PENDING',
    installedDaysAgo: 1,
    credential: { expiresInMinutes: 50 },
  },
  {
    id: 9004,
    appCode: GPTMAKER,
    domain: 'delta-suporte.bitrix24.com.br',
    status: 'AUTH_ERROR',
    installedDaysAgo: 60,
    credential: {
      expiresInMinutes: -600,
      refreshFailures: 5,
      lastRefreshError: 'Bitrix OAuth recusou o refresh token: invalid_grant',
    },
  },
  {
    id: 9005,
    appCode: GPTMAKER,
    domain: 'epsilon.bitrix24.com.br',
    status: 'UNINSTALLED',
    installedDaysAgo: 90,
    credential: null,
  },
  {
    id: 9006,
    appCode: GPTMAKER,
    domain: 'zeta-novo.bitrix24.com.br',
    status: 'ACTIVE',
    installedDaysAgo: 2,
    credential: { expiresInMinutes: 5 },
  },
  {
    id: 9007,
    appCode: TESTE,
    domain: 'eta.bitrix24.com.br',
    status: 'ACTIVE',
    installedDaysAgo: 10,
    credential: { expiresInMinutes: 50 },
  },
  {
    id: 9008,
    appCode: TESTE,
    domain: 'volume.bitrix24.com.br',
    status: 'ACTIVE',
    installedDaysAgo: 30,
    credential: { expiresInMinutes: 50 },
  },
]

type EventSeed = {
  installationId: number
  type: string
  status: 'pending' | 'delivered' | 'dead'
  minutesAgo: number
}

const envelope = (
  seed: EventSeed,
  appCode: string,
  memberId: string,
  eventId: string,
) => ({
  eventId,
  type: seed.type,
  appCode,
  installationId: seed.installationId,
  memberId,
  occurredAt: ago(seed.minutesAgo).toISOString(),
  subscription: null,
  data: {},
})

async function wipe(): Promise<void> {
  await db.outboxEvent.deleteMany({
    where: { installationId: { gte: FIRST_ID, lte: LAST_ID } },
  })
  await db.installation.deleteMany({
    where: { id: { gte: FIRST_ID, lte: LAST_ID } },
  })
  await db.stripeEvent.deleteMany({
    where: { eventId: { startsWith: 'evt_seed_' } },
  })
}

async function seedInstallations(): Promise<void> {
  for (const row of INSTALLATIONS) {
    const installedAt = ago(row.installedDaysAgo * DAY)
    await db.installation.create({
      data: {
        id: row.id,
        appCode: row.appCode,
        memberId: `member-${row.id}`,
        domain: row.domain,
        status: row.status,
        installedAt,
        activatedAt: row.status === 'ACTIVE' ? installedAt : null,
        uninstalledAt:
          row.status === 'UNINSTALLED'
            ? ago(row.installedDaysAgo * DAY - DAY)
            : null,
        everActivated: row.status !== 'INSTALL_PENDING',
        trialUsed: row.trialUsed ?? false,
        contact: row.contact ?? undefined,
      },
    })
    if (row.credential) {
      await db.credential.create({
        data: {
          installationId: row.id,
          accessTokenEnc: cipher.encrypt(`seed-access-${row.id}`),
          refreshTokenEnc: cipher.encrypt(`seed-refresh-${row.id}`),
          expiresAt: ago(-row.credential.expiresInMinutes),
          clientEndpoint: `https://${row.domain}/rest/`,
          refreshFailures: row.credential.refreshFailures ?? 0,
          lastRefreshError: row.credential.lastRefreshError ?? null,
        },
      })
    }
  }

  await db.installAttempt.createMany({
    data: [
      { installationId: 9003, step: 'verify', status: 'ok', minutesAgo: 62 },
      {
        installationId: 9003,
        step: 'installer',
        status: 'error',
        minutesAgo: 60,
        error: 'HTTP 502 do instalador do app (seed)',
      },
      {
        installationId: 9003,
        step: 'installer',
        status: 'error',
        minutesAgo: 20,
        error: 'timeout aguardando o instalador do app (seed)',
      },
      {
        installationId: 9001,
        step: 'verify',
        status: 'ok',
        minutesAgo: 40 * DAY,
      },
      {
        installationId: 9001,
        step: 'installer',
        status: 'ok',
        minutesAgo: 40 * DAY - 1,
      },
    ].map(({ minutesAgo, ...rest }) => ({
      ...rest,
      createdAt: ago(minutesAgo),
    })),
  })
}

async function seedEvents(): Promise<{ total: number; dead: number }> {
  const memberOf = (id: number) => `member-${id}`
  const appOf = (id: number) =>
    INSTALLATIONS.find(row => row.id === id)!.appCode
  const rows: Array<EventSeed & { eventId: string }> = []
  const push = (seed: EventSeed, count = 1) => {
    for (let i = 0; i < count; i++)
      rows.push({
        ...seed,
        minutesAgo: seed.minutesAgo + i,
        eventId: randomUUID(),
      })
  }

  push({
    installationId: 9001,
    type: 'installation.created',
    status: 'delivered',
    minutesAgo: 40 * DAY,
  })
  push(
    {
      installationId: 9001,
      type: 'subscription.renewed',
      status: 'delivered',
      minutesAgo: 10 * DAY,
    },
    3,
  )
  push({
    installationId: 9002,
    type: 'installation.created',
    status: 'delivered',
    minutesAgo: 25 * DAY,
  })
  push({
    installationId: 9002,
    type: 'subscription.trial_started',
    status: 'delivered',
    minutesAgo: 25 * DAY - 1,
  })
  // 37 mortos do GPTMaker: o caso do reenvio em lote do roteiro.
  push(
    {
      installationId: 9002,
      type: 'subscription.renewed',
      status: 'dead',
      minutesAgo: 3 * DAY,
    },
    30,
  )
  push(
    {
      installationId: 9002,
      type: 'purchase.paid',
      status: 'dead',
      minutesAgo: 2 * DAY,
    },
    7,
  )
  push(
    {
      installationId: 9002,
      type: 'subscription.renewed',
      status: 'pending',
      minutesAgo: 5,
    },
    2,
  )
  push({
    installationId: 9004,
    type: 'installation.auth_error',
    status: 'delivered',
    minutesAgo: 5 * DAY,
  })
  push({
    installationId: 9006,
    type: 'installation.created',
    status: 'pending',
    minutesAgo: 3,
  })
  push({
    installationId: 9006,
    type: 'subscription.trial_started',
    status: 'pending',
    minutesAgo: 2,
  })
  push({
    installationId: 9007,
    type: 'installation.created',
    status: 'delivered',
    minutesAgo: 10 * DAY,
  })
  push(
    {
      installationId: 9007,
      type: 'subscription.renewed',
      status: 'dead',
      minutesAgo: 4 * DAY,
    },
    3,
  )
  // Acima do limite de 5000 do reenvio em lote do App Teste (9007 + 9008 = 5003).
  push(
    {
      installationId: 9008,
      type: 'subscription.renewed',
      status: 'dead',
      minutesAgo: 6 * DAY,
    },
    5000,
  )

  const data = rows.map(row => ({
    eventId: row.eventId,
    appCode: appOf(row.installationId),
    type: row.type,
    installationId: row.installationId,
    payload: envelope(
      row,
      appOf(row.installationId),
      memberOf(row.installationId),
      row.eventId,
    ),
    status: row.status,
    attempts: row.status === 'dead' ? 9 : row.status === 'delivered' ? 1 : 0,
    deliveredAt: row.status === 'delivered' ? ago(row.minutesAgo) : null,
    deadAt: row.status === 'dead' ? ago(row.minutesAgo - 1440) : null,
    createdAt: ago(row.minutesAgo),
    nextAttemptAt: ago(row.minutesAgo),
    windowStartedAt: ago(row.minutesAgo),
  }))
  for (let i = 0; i < data.length; i += 1000)
    await db.outboxEvent.createMany({ data: data.slice(i, i + 1000) })

  const withDeliveries = rows.filter(
    row => row.status !== 'pending' && row.installationId !== 9008,
  )
  await db.eventDelivery.createMany({
    data: withDeliveries.flatMap(
      (row): Prisma.EventDeliveryCreateManyInput[] =>
        row.status === 'delivered'
          ? [
              {
                eventId: row.eventId,
                attempt: 1,
                statusCode: 200,
                deliveredAt: ago(row.minutesAgo),
                createdAt: ago(row.minutesAgo),
              },
            ]
          : [3, 2, 1].map(attempt => ({
              eventId: row.eventId,
              attempt,
              statusCode: attempt === 1 ? 503 : null,
              error: attempt === 1 ? 'HTTP 503' : 'timeout após 10 s',
              createdAt: ago(row.minutesAgo - attempt * 60),
            })),
    ),
  })
  return {
    total: rows.length,
    dead: rows.filter(r => r.status === 'dead').length,
  }
}

async function seedStripeEvents(): Promise<void> {
  const mk = (
    suffix: string,
    status: string,
    type: string,
    minutes: number,
    error?: string,
  ) => ({
    eventId: `evt_seed_${suffix}`,
    type,
    appCode: GPTMAKER,
    status,
    receivedAt: ago(minutes),
    processedAt: status === 'processed' ? ago(minutes - 1) : null,
    attempts: status === 'failed' || status === 'dead' ? 4 : 1,
    error: error ?? null,
    payload: {
      id: `evt_seed_${suffix}`,
      type,
      data: { object: { id: 'sub_seed' } },
    },
  })
  await db.stripeEvent.createMany({
    data: [
      mk('1', 'processed', 'invoice.paid', 120),
      mk('2', 'processed', 'customer.subscription.updated', 90),
      mk('3', 'ignored', 'charge.succeeded', 80),
      mk(
        '4',
        'failed',
        'invoice.payment_failed',
        30,
        'SPA do portal indisponível (seed)',
      ),
      mk(
        '5',
        'dead',
        'customer.subscription.deleted',
        3 * DAY,
        'Assinatura sem item no SPA (seed)',
      ),
    ],
  })
}

async function main(): Promise<void> {
  await ensureApps()
  await wipe()
  await seedInstallations()
  const events = await seedEvents()
  await seedStripeEvents()
  const mortosGptmaker = await db.outboxEvent.count({
    where: { appCode: GPTMAKER, status: 'dead' },
  })
  const mortosTeste = await db.outboxEvent.count({
    where: { appCode: TESTE, status: 'dead' },
  })
  process.stdout.write(
    [
      `Instalações: ${INSTALLATIONS.length} (ids ${FIRST_ID}–${INSTALLATIONS.at(-1)!.id})`,
      `Eventos: ${events.total} (${events.dead} mortos)`,
      `Mortos por app: ${GPTMAKER}=${mortosGptmaker}, ${TESTE}=${mortosTeste} (acima do limite de 5000)`,
      'Eventos Stripe: 5 (processado, ignorado, falho e morto)',
      '',
    ].join('\n'),
  )
}

main()
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
