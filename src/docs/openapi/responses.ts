import z from 'zod'
import {
  installThemeSchema,
  type RegisteredApp,
} from '@/modules/registry/domain/app'
import type { InstallationResponse } from '@/modules/installations/application/installation-queries'
import type { InstallOutcome } from '@/modules/installations/application/install-service'
import type { SessionResponse } from '@/modules/installations/application/session-service'
import type { TokenResponse } from '@/modules/installations/application/token-vault'
import type { ItemResponse } from '@/modules/billing/application/items-service'
import type { PlanResponse } from '@/modules/billing/application/plan-catalog'
import type {
  IssuedAccess,
  OperatorView,
} from '@/modules/backoffice/domain/operator'

/**
 * Schemas das respostas. Não rodam em produção: servem ao OpenAPI e aos testes de
 * integração, que conferem cada resposta com eles (`contract-check.ts`). Respostas dos
 * apps são `strictObject` — campo novo sem documentação quebra teste. `satisfies`
 * amarra ao tipo do serviço, quando ele existe.
 */

const isoDate = z.string().datetime({ offset: true })
const list = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item) })
/** Listagem paginada por cursor do backoffice. */
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .describe('Envie em `cursor` para a próxima página; `null` na última'),
  })

// Infraestrutura

export const healthSchema = z.strictObject({ status: z.literal('ok') })

export const readinessSchema = z.strictObject({
  ok: z.boolean(),
  checks: z
    .object({
      database: z.string(),
      redis: z.string().optional(),
      signingKey: z.string(),
      spaConfig: z.object({
        ok: z.boolean(),
        checkedAt: isoDate.nullable(),
        problems: z.array(z.unknown()).optional(),
      }),
    })
    .describe('`"ok"` ou a mensagem de erro de cada dependência'),
})

// Instalação e sessão

export const installationStatusSchema = z.enum([
  'INSTALLING',
  'INSTALL_PENDING',
  'ACTIVE',
  'UNINSTALLED',
  'AUTH_ERROR',
])

export const installOutcomeSchema = z.strictObject({
  installationId: z.number().int(),
  status: z.enum(['ACTIVE', 'INSTALL_PENDING']),
  error: z
    .string()
    .optional()
    .describe('Motivo quando o instalador do app falhou (`INSTALL_PENDING`)'),
}) satisfies z.ZodType<InstallOutcome>

export const bitrixEventResultSchema = z.strictObject({
  handled: z.enum([
    'application-token-stored',
    'application-token-pending',
    'uninstalled',
    'already-uninstalled',
    'app-inactive',
    'ignored',
  ]),
})

export const jwksSchema = z.strictObject({
  keys: z.array(
    z
      .object({
        kty: z.literal('RSA'),
        kid: z.string(),
        alg: z.literal('RS256'),
        use: z.literal('sig').optional(),
        n: z.string(),
        e: z.string(),
      })
      .describe('Chave pública RSA (JWK)'),
  ),
})

export const sessionSchema = z.strictObject({
  token: z.string().describe('JWT RS256; validar com o JWKS, `aud` = appCode'),
  expiresAt: isoDate,
  installationId: z.number().int(),
  user: z.strictObject({
    id: z.string(),
    name: z.string(),
    isAdmin: z.boolean(),
  }),
}) satisfies z.ZodType<SessionResponse>

export const installationSchema = z.strictObject({
  installationId: z.number().int(),
  appCode: z.string(),
  memberId: z.string(),
  domain: z.string(),
  status: installationStatusSchema,
  applicationToken: z
    .string()
    .nullable()
    .describe(
      '`application_token` do Bitrix, para validar eventos que o app recebe',
    ),
}) satisfies z.ZodType<InstallationResponse>

export const installationListSchema = list(installationSchema)

export const tokenSchema = z.strictObject({
  accessToken: z.string(),
  expiresAt: isoDate,
  domain: z.string(),
  clientEndpoint: z
    .string()
    .nullable()
    .describe('Endpoint REST do portal (`https://<domínio>/rest/`)'),
}) satisfies z.ZodType<TokenResponse>

// Cobrança

const planInterval = z.enum(['monthly', 'quarterly', 'semiannual', 'yearly'])
const planType = z.enum(['subscription', 'one_time'])
const subscriptionStatus = z.enum([
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'trial_expired',
])
const modality = z.enum(['stripe', 'manual'])

export const planSchema = z.strictObject({
  id: z.number().int(),
  productId: z.number().int(),
  productName: z.string(),
  name: z.string(),
  amount: z
    .number()
    .int()
    .describe(
      'Centavos, como cadastrado no CRM (o valor cobrado vem do Stripe)',
    ),
  interval: planInterval.nullable(),
  type: planType,
  trial: z.boolean(),
}) satisfies z.ZodType<PlanResponse>

export const planListSchema = list(planSchema)

export const currentSubscriptionSchema = z.strictObject({
  subscriptionId: z.number().int(),
  status: subscriptionStatus,
  modality,
  plan: z.union([
    z.strictObject({
      id: z.number().int(),
      name: z.string(),
      interval: planInterval.nullable(),
      type: planType,
      amount: z.number(),
    }),
    z
      .strictObject({ id: z.number().int() })
      .describe('Plano fora do catálogo atual: só o id'),
  ]),
  periodStart: isoDate,
  periodEnd: isoDate,
  cancelAtPeriodEnd: z.boolean(),
  trial: z.strictObject({
    used: z.boolean(),
    endsAt: isoDate.nullable(),
  }),
  version: z
    .number()
    .int()
    .describe(
      'Cresce a cada decisão; compare com `subscription.version` dos eventos',
    ),
})

export const checkoutSessionSchema = z.strictObject({
  clientSecret: z
    .string()
    .describe('Para `initEmbeddedCheckout({ clientSecret })` no frontend'),
  sessionId: z.string(),
  purchaseId: z.number().int().optional().describe('Só em `intent=purchase`'),
})

export const billingPortalSchema = z.strictObject({
  url: z.string().url().describe('Abrir em aba nova'),
})

export const changePlanResultSchema = z.union([
  z.strictObject({
    subscriptionId: z.number().int(),
    planId: z.number().int(),
    effective: z.literal('immediate'),
    remainingFraction: z
      .number()
      .describe('Fração restante do período, base da cobrança proporcional'),
  }),
  z.strictObject({
    subscriptionId: z.number().int(),
    planId: z.number().int(),
    effective: z.literal('next_period'),
    effectiveAt: isoDate,
  }),
])

export const itemSchema = z.strictObject({
  itemId: z.number().int(),
  subscriptionId: z.number().int(),
  externalRef: z.string().nullable(),
  title: z.string(),
  status: z.enum(['active', 'cancelled']),
  billable: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  deletedAt: isoDate.nullable(),
}) satisfies z.ZodType<ItemResponse>

export const itemListSchema = list(itemSchema)

// Webhooks recebidos

export const stripeWebhookResultSchema = z.strictObject({
  received: z.literal(true),
  outcome: z.enum(['queued', 'duplicate', 'ignored']),
})

export const spaEventResultSchema = z.strictObject({ handled: z.boolean() })

// Operador

export const appSchema = z.strictObject({
  appCode: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  installTheme: installThemeSchema.nullable(),
  bitrixClientId: z.string(),
  bitrixAppCode: z.string().nullable(),
  scopes: z.array(z.string()),
  installerUrl: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  trialDays: z.number().int(),
  trialOnInstall: z.boolean(),
  trialPlanId: z.number().int().nullable(),
  productSpaIds: z.array(z.number().int()),
  active: z.boolean(),
}) satisfies z.ZodType<RegisteredApp>

export const appListSchema = list(appSchema)

export const appCreatedSchema = z.strictObject({
  app: appSchema,
  credentials: z.strictObject({
    apiKey: z.string(),
    webhookSecret: z.string(),
  }),
  notice: z.string(),
})

export const apiKeyRotatedSchema = z.strictObject({
  apiKey: z.string(),
  previousValidUntil: isoDate,
})

export const webhookSecretRotatedSchema = z.strictObject({
  webhookSecret: z.string(),
  previousValidUntil: isoDate,
})

export const trialStartedSchema = z.strictObject({
  subscriptionId: z.number().int(),
  trialEndsAt: isoDate,
})

export const installAttemptListSchema = list(
  z.looseObject({
    id: z.number().int(),
    installationId: z.number().int(),
    step: z.string(),
    status: z.string(),
    error: z.string().nullable(),
    createdAt: isoDate,
  }),
)

export const outboxEventListSchema = page(
  z.looseObject({
    eventId: z.string(),
    seq: z.number().int(),
    appCode: z.string(),
    type: z.string(),
    installationId: z.number().int(),
    status: z.enum(['pending', 'delivered', 'dead']),
    attempts: z.number().int(),
    payload: z.unknown().describe('Envelope entregue ao app'),
    deliveries: z
      .array(
        z.looseObject({
          attempt: z.number().int(),
          statusCode: z.number().int().nullable(),
          error: z.string().nullable(),
        }),
      )
      .describe('Até as 3 tentativas mais recentes'),
  }),
)

export const stripeEventListSchema = page(
  z.strictObject({
    eventId: z.string(),
    type: z.string(),
    appCode: z.string().nullable(),
    status: z.string(),
    attempts: z.number().int(),
    error: z.string().nullable(),
    receivedAt: isoDate,
    processedAt: isoDate.nullable(),
  }),
)

export const resendResultSchema = z.strictObject({
  requeued: z.number().int().describe('Eventos recolocados na fila'),
})

export const signingKeyRotatedSchema = z.strictObject({
  kid: z.string(),
  activatesAt: isoDate,
})

export const sweepResultSchema = z.strictObject({
  fixed: z.number().int(),
  errors: z.number().int(),
  checked: z.number().int().optional().describe('Só na varredura `stripe`'),
  detail: z
    .union([
      z.strictObject({ checked: z.number().int() }),
      z.strictObject({ since: isoDate }),
    ])
    .describe('`{checked}` na `stripe`; `{since}` (início da janela) na `spa`'),
})

// Backoffice: acesso e operadores

export const operatorSchema = z.strictObject({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['viewer', 'operator']),
  active: z.boolean(),
  mustChangePassword: z
    .boolean()
    .describe('Senha provisória: só `POST /admin/auth/password` é permitido'),
  lockedUntil: isoDate.nullable(),
  lastLoginAt: isoDate.nullable(),
  createdAt: isoDate,
}) satisfies z.ZodType<OperatorView>

export const operatorListSchema = list(operatorSchema)

export const issuedAccessSchema = z.strictObject({
  operator: operatorSchema,
  temporaryPassword: z
    .string()
    .describe('Senha provisória. Só aparece nesta resposta.'),
  totpUri: z
    .string()
    .describe(
      'URI `otpauth://` para o app autenticador. Só aparece nesta resposta.',
    ),
}) satisfies z.ZodType<IssuedAccess>

export const loginResultSchema = z.strictObject({
  operator: operatorSchema,
  expiresAt: isoDate.describe(
    'Fim da validade máxima da sessão; antes disso ela expira após o tempo de inatividade',
  ),
})

export const whoAmISchema = z.union([
  z.strictObject({
    kind: z.literal('operator'),
    actor: z.string().describe('`operator:<id>`, como na auditoria'),
    role: z.enum(['viewer', 'operator']),
    operator: operatorSchema,
  }),
  z.strictObject({
    kind: z.literal('token'),
    actor: z.string().describe('`token:<prefixo>`, como na auditoria'),
    role: z.literal('operator'),
  }),
])

export const passwordChangedSchema = z.strictObject({
  operator: operatorSchema,
})

// Backoffice: leituras

const tokenHealth = z
  .enum(['ok', 'refresh_failing', 'missing'])
  .describe(
    '`missing`: sem credencial; `refresh_failing`: a última renovação falhou',
  )

const adminInstallationItem = z.strictObject({
  id: z.number().int(),
  appCode: z.string(),
  domain: z.string(),
  memberId: z.string(),
  status: installationStatusSchema,
  installedAt: isoDate,
  activatedAt: isoDate.nullable(),
  uninstalledAt: isoDate.nullable(),
  trialUsed: z.boolean(),
  tokenHealth,
})

export const adminInstallationPageSchema = page(adminInstallationItem)

export const adminInstallationDetailSchema = adminInstallationItem.extend({
  app: z
    .strictObject({
      appCode: z.string(),
      name: z.string(),
      active: z.boolean(),
    })
    .nullable(),
  spaItemId: z.number().int().nullable(),
  contact: z.unknown().nullable(),
  everActivated: z.boolean(),
  pendingReinstall: z.boolean(),
  updatedAt: isoDate,
  token: z.union([
    z.strictObject({
      health: tokenHealth,
      expiresAt: isoDate,
      refreshFailures: z.number().int(),
      lastRefreshError: z.string().nullable(),
      clientEndpoint: z.string().nullable(),
      updatedAt: isoDate,
    }),
    z.strictObject({ health: z.literal('missing') }),
  ]),
  events: z.strictObject({
    pending: z.number().int(),
    delivered: z.number().int(),
    dead: z.number().int(),
  }),
  subscription: z.union([
    z.strictObject({
      available: z.literal(true),
      current: currentSubscriptionSchema
        .nullable()
        .describe('`null`: instalação sem assinatura vigente'),
    }),
    z.strictObject({
      available: z.literal(false),
      reason: z.string(),
    }),
  ]),
})

export const timelinePageSchema = page(
  z.strictObject({
    kind: z.enum(['install_attempt', 'event', 'purchase', 'admin_action']),
    occurredAt: isoDate,
    summary: z.string(),
    ref: z.strictObject({ type: z.string(), id: z.string() }),
    data: z
      .record(z.string(), z.unknown())
      .describe(
        'Campos do tipo: etapa e erro, tipo e entregas do evento, compra, ação',
      ),
  }),
)

export const auditPageSchema = page(
  z.strictObject({
    id: z.number().int(),
    actor: z
      .string()
      .describe('`operator:<id>`, `token:<prefixo>` ou `anonymous`'),
    actorRole: z.string().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    statusCode: z.number().int().nullable(),
    errorCode: z.string().nullable(),
    summary: z.unknown().describe('Resumo com campos sensíveis mascarados'),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: isoDate,
  }),
)

export const overviewSchema = z.strictObject({
  computedAt: isoDate,
  installations: z.array(
    z.strictObject({
      appCode: z.string(),
      status: z.string(),
      count: z.number().int(),
    }),
  ),
  events: z.strictObject({
    byApp: z.array(
      z.strictObject({
        appCode: z.string(),
        pending: z.number().int(),
        dead: z.number().int(),
      }),
    ),
    oldestPendingAt: isoDate.nullable(),
  }),
  stripeEvents: z.strictObject({
    failed: z.number().int(),
    dead: z.number().int(),
  }),
  credentialsRefreshFailing: z.number().int(),
  trialsEndingSoon: z.strictObject({
    count: z.number().int(),
    items: z.array(
      z.strictObject({
        installationId: z.number().int(),
        appCode: z.string(),
        subscriptionId: z.number().int().nullable(),
        trialEndsAt: isoDate,
      }),
    ),
  }),
  sweeps: z.array(
    z.strictObject({
      kind: z.string(),
      startedAt: isoDate,
      finishedAt: isoDate.nullable(),
      fixed: z.number().int(),
      errors: z.number().int(),
    }),
  ),
})

export const stripeEventDetailSchema = z.strictObject({
  eventId: z.string(),
  type: z.string(),
  appCode: z.string().nullable(),
  status: z.string(),
  attempts: z.number().int(),
  error: z.string().nullable(),
  receivedAt: isoDate,
  processedAt: isoDate.nullable(),
  payload: z.unknown().describe('Evento cru do Stripe'),
})
