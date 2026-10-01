import z from 'zod'
import {
  installRequestSchema,
  retryRequestSchema,
} from '@/modules/installations/application/install-service'
import { sessionRequestSchema } from '@/modules/installations/application/session-service'
import { bitrixAppEventSchema } from '@/modules/installations/application/bitrix-app-events'
import { refreshSchema } from '@/modules/installations/http/routes'
import { checkoutRequestSchema } from '@/modules/billing/application/checkout-service'
import {
  changePlanSchema,
  portalRequestSchema,
} from '@/modules/billing/application/subscription-queries'
import {
  createItemSchema,
  updateItemSchema,
} from '@/modules/billing/application/items-service'
import { spaEventSchema } from '@/modules/billing/application/spa-events'
import {
  createAppSchema,
  updateAppSchema,
} from '@/modules/registry/app-registry'
import {
  resendSchema,
  rotateSigningKeySchema,
} from '@/modules/registry/http/admin-routes'
import type { ErrorCode } from '../errors'
import * as r from './responses'

/**
 * Registro de todas as rotas HTTP da plataforma. Toda rota montada em `createApp`
 * precisa de uma entrada aqui (e vice-versa) — `openapi.test.ts` compara os dois.
 */

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete'

export type Tag =
  | 'Instalação'
  | 'Sessão'
  | 'Tokens'
  | 'Cobrança'
  | 'Webhooks recebidos'
  | 'Infraestrutura'
  | 'Operador'

export type Security = 'appApiKey' | 'adminToken' | 'stripeSignature' | 'none'

/** Schema com nome de componente (`#/components/schemas/<id>`). */
export type Named = { id: string; schema: z.ZodType }
const named = (id: string, schema: z.ZodType): Named => ({ id, schema })

export type ContentType =
  | 'application/json'
  | 'application/x-www-form-urlencoded'
  | 'application/octet-stream'
  | 'text/html'
  | 'text/plain'

export type ResponseDoc = {
  description: string
  schema?: Named
  contentType?: ContentType
}

export type QueryParam = {
  name: string
  description: string
  required?: boolean
  type?: 'string' | 'integer'
  enum?: string[]
}

export type Operation = {
  method: HttpMethod
  /** Formato OpenAPI (`/v1/installations/{id}`). */
  path: string
  operationId: string
  tag: Tag
  summary: string
  description?: string
  security: Security
  pathParams?: Record<string, string>
  query?: QueryParam[]
  body?: {
    schema: Named
    contentType?: ContentType
    required?: boolean
    description?: string
  }
  responses: Record<number, ResponseDoc>
  /** Códigos que a operação devolve; `[código, status]` quando difere do catálogo. */
  errors?: Array<ErrorCode | [ErrorCode, number]>
}

// Schemas de entrada com nome de componente.
const req = {
  install: named('InstallRequest', installRequestSchema),
  retry: named('InstallRetryRequest', retryRequestSchema),
  session: named('SessionRequest', sessionRequestSchema),
  bitrixEvent: named('BitrixAppEvent', bitrixAppEventSchema),
  refresh: named('TokenRefreshRequest', refreshSchema),
  checkout: named('CheckoutRequest', checkoutRequestSchema),
  portal: named('BillingPortalRequest', portalRequestSchema),
  changePlan: named('ChangePlanRequest', changePlanSchema),
  createItem: named('CreateItemRequest', createItemSchema),
  updateItem: named('UpdateItemRequest', updateItemSchema),
  spaEvent: named('SpaEvent', spaEventSchema),
  stripeEvent: named(
    'StripeEvent',
    z
      .record(z.string(), z.unknown())
      .describe('Evento Stripe, corpo cru assinado'),
  ),
  createApp: named('CreateAppRequest', createAppSchema),
  updateApp: named('UpdateAppRequest', updateAppSchema),
  resend: named('ResendEventsRequest', resendSchema),
  rotateSigningKey: named('RotateSigningKeyRequest', rotateSigningKeySchema),
}

// Schemas de resposta com nome de componente.
const res = {
  health: named('Health', r.healthSchema),
  readiness: named('Readiness', r.readinessSchema),
  installOutcome: named('InstallOutcome', r.installOutcomeSchema),
  bitrixEventResult: named('BitrixAppEventResult', r.bitrixEventResultSchema),
  jwks: named('Jwks', r.jwksSchema),
  session: named('Session', r.sessionSchema),
  installation: named('Installation', r.installationSchema),
  installationList: named('InstallationList', r.installationListSchema),
  token: named('Token', r.tokenSchema),
  planList: named('PlanList', r.planListSchema),
  subscription: named('CurrentSubscription', r.currentSubscriptionSchema),
  checkout: named('CheckoutSession', r.checkoutSessionSchema),
  portal: named('BillingPortalSession', r.billingPortalSchema),
  changePlan: named('ChangePlanResult', r.changePlanResultSchema),
  item: named('SubscriptionItem', r.itemSchema),
  itemList: named('SubscriptionItemList', r.itemListSchema),
  stripeResult: named('StripeWebhookResult', r.stripeWebhookResultSchema),
  spaResult: named('SpaEventResult', r.spaEventResultSchema),
  app: named('App', r.appSchema),
  appList: named('AppList', r.appListSchema),
  appCreated: named('AppCreated', r.appCreatedSchema),
  apiKeyRotated: named('ApiKeyRotated', r.apiKeyRotatedSchema),
  webhookSecretRotated: named(
    'WebhookSecretRotated',
    r.webhookSecretRotatedSchema,
  ),
  trialStarted: named('TrialStarted', r.trialStartedSchema),
  attempts: named('InstallAttemptList', r.installAttemptListSchema),
  outboxEvents: named('OutboxEventList', r.outboxEventListSchema),
  stripeEvents: named('StripeEventList', r.stripeEventListSchema),
  resend: named('ResendResult', r.resendResultSchema),
  signingKey: named('SigningKeyRotated', r.signingKeyRotatedSchema),
  sweep: named('SweepResult', r.sweepResultSchema),
}

const json = (description: string, schema: Named): ResponseDoc => ({
  description,
  schema,
})

const BITRIX_TOKEN_ERRORS: ErrorCode[] = [
  'BITRIX_TOKEN_REJECTED',
  'TOKEN_APP_MISMATCH',
  'BITRIX_UNAVAILABLE',
]

const installationId = { id: 'Id da instalação (`installationId`)' }
const subscriptionId = { id: 'Id da assinatura (`subscriptionId`)' }

export const OPERATIONS: Operation[] = [
  // Infraestrutura
  {
    method: 'get',
    path: '/health',
    operationId: 'health',
    tag: 'Infraestrutura',
    summary: 'Processo no ar (liveness)',
    security: 'none',
    responses: {
      200: json('Sempre `ok` enquanto o processo responde', res.health),
    },
  },
  {
    method: 'get',
    path: '/health/ready',
    operationId: 'readiness',
    tag: 'Infraestrutura',
    summary: 'Pronto para tráfego (readiness)',
    description:
      'Confere banco, Redis, chave de assinatura ativa e configuração dos SPAs. 503 se qualquer um falhar.',
    security: 'none',
    responses: {
      200: json('Tudo ok', res.readiness),
      503: json('Alguma dependência falhou; ver `checks`', res.readiness),
    },
  },
  {
    method: 'get',
    path: '/metrics',
    operationId: 'metrics',
    tag: 'Infraestrutura',
    summary: 'Métricas Prometheus',
    security: 'none',
    responses: {
      200: {
        description: 'Formato de exposição Prometheus',
        contentType: 'text/plain',
      },
    },
  },
  {
    method: 'get',
    path: '/openapi.json',
    operationId: 'openapi',
    tag: 'Infraestrutura',
    summary: 'Este contrato (sem rotas de operador)',
    security: 'none',
    responses: { 200: { description: 'Documento OpenAPI 3.1' } },
  },
  {
    method: 'get',
    path: '/docs',
    operationId: 'docsPage',
    tag: 'Infraestrutura',
    summary: 'Referência navegável deste contrato',
    security: 'none',
    responses: {
      200: { description: 'Página HTML', contentType: 'text/html' },
    },
  },

  // Instalação
  {
    method: 'get',
    path: '/install/{appCode}',
    operationId: 'getInstallPage',
    tag: 'Instalação',
    summary: 'Página de instalação do app no Bitrix24',
    description:
      'URL de instalação cadastrada no app Bitrix. A página lê a autenticação via `BX24.getAuth()` e chama `POST /v1/install`.',
    security: 'none',
    pathParams: { appCode: 'Código do app (ex.: `crmthink.gptmaker`)' },
    responses: {
      200: {
        description: 'Página HTML com o tema do app',
        contentType: 'text/html',
      },
      404: {
        description: 'App inexistente ou inativo (HTML)',
        contentType: 'text/html',
      },
    },
  },
  {
    method: 'post',
    path: '/install/{appCode}',
    operationId: 'postInstallPage',
    tag: 'Instalação',
    summary: 'Página de instalação (aberta pelo Bitrix via POST)',
    description:
      'O Bitrix abre o app com POST de formulário; o corpo é ignorado e a resposta é a mesma do GET.',
    security: 'none',
    pathParams: { appCode: 'Código do app' },
    responses: {
      200: {
        description: 'Página HTML com o tema do app',
        contentType: 'text/html',
      },
      404: {
        description: 'App inexistente ou inativo (HTML)',
        contentType: 'text/html',
      },
    },
  },
  {
    method: 'post',
    path: '/v1/install',
    operationId: 'install',
    tag: 'Instalação',
    summary: 'Instalar o app no portal',
    description:
      'Chamado pela página de instalação. Verifica o token no Bitrix (administrador, app e portal corretos), registra a instalação no SPA 1060, guarda os tokens cifrados, registra `ONAPPINSTALL` e `ONAPPUNINSTALL` e chama o instalador do app. Idempotente: repetir retoma sem duplicar. Se o instalador do app falhar, responde `INSTALL_PENDING` com `error`.',
    security: 'none',
    body: { schema: req.install },
    responses: {
      200: json(
        'Instalação ativa ou pendente do instalador',
        res.installOutcome,
      ),
    },
    errors: [
      'APP_NOT_FOUND',
      'NOT_PORTAL_ADMIN',
      'MEMBER_ID_MISMATCH',
      'DOMAIN_MISMATCH',
      ...BITRIX_TOKEN_ERRORS,
      'CRMTHINK_UNAVAILABLE',
      'EVENT_BIND_FAILED',
    ],
  },
  {
    method: 'post',
    path: '/v1/install/retry',
    operationId: 'retryInstall',
    tag: 'Instalação',
    summary: 'Refazer a chamada ao instalador do app',
    description:
      'Só para instalação `INSTALL_PENDING`; exige administrador do portal.',
    security: 'none',
    body: { schema: req.retry },
    responses: {
      200: json('Resultado do novo chamado ao instalador', res.installOutcome),
    },
    errors: [
      'APP_NOT_FOUND',
      'NOT_PORTAL_ADMIN',
      ...BITRIX_TOKEN_ERRORS,
      'INSTALLATION_MISMATCH',
      'INSTALLATION_NOT_PENDING',
    ],
  },
  {
    method: 'post',
    path: '/bitrix/events/{appCode}',
    operationId: 'receiveBitrixAppEvent',
    tag: 'Instalação',
    summary:
      'Eventos de instalação do app Bitrix (`ONAPPINSTALL`, `ONAPPUNINSTALL`)',
    description:
      'Handler cadastrado no app Bitrix. `ONAPPINSTALL` só guarda o `application_token` depois de provar que o `access_token` do evento é deste app no portal; `ONAPPUNINSTALL` compara o `application_token` em tempo constante.',
    security: 'none',
    pathParams: { appCode: 'Código do app' },
    body: {
      schema: req.bitrixEvent,
      contentType: 'application/x-www-form-urlencoded',
    },
    responses: {
      200: json('Evento tratado ou ignorado', res.bitrixEventResult),
    },
    errors: ['UNAUTHORIZED'],
  },
  {
    method: 'get',
    path: '/.well-known/jwks.json',
    operationId: 'getJwks',
    tag: 'Sessão',
    summary: 'Chaves públicas do JWT de sessão',
    description:
      'Inclui a chave ativa, a próxima (rotação agendada) e as anteriores ainda válidas. Cache de 5 minutos.',
    security: 'none',
    responses: { 200: json('JWKS', res.jwks) },
  },
  {
    method: 'post',
    path: '/v1/sessions',
    operationId: 'createSession',
    tag: 'Sessão',
    summary: 'Trocar a autenticação do iframe por um JWT da plataforma',
    description:
      'Chamado pelo frontend do app dentro do Bitrix. CORS restrito às origens de `SESSION_CORS_ORIGINS` do `appCode` pedido (o preflight `OPTIONS` aceita qualquer origem configurada). Identidade e admin vêm do Bitrix com o próprio token; campos extras do corpo são descartados. Valide o JWT com o JWKS e `aud` = appCode.',
    security: 'none',
    body: { schema: req.session },
    responses: { 200: json('JWT e usuário', res.session) },
    errors: [
      'ORIGIN_NOT_ALLOWED',
      ['APP_INACTIVE', 403],
      ['INSTALLATION_NOT_ACTIVE', 403],
      ...BITRIX_TOKEN_ERRORS,
      'BITRIX_USER_UNKNOWN',
    ],
  },

  // Tokens (servidor-a-servidor)
  {
    method: 'get',
    path: '/v1/installations',
    operationId: 'listInstallations',
    tag: 'Tokens',
    summary: 'Instalação do app em um portal',
    security: 'appApiKey',
    query: [
      {
        name: 'memberId',
        description: '`member_id` do portal',
        required: true,
      },
    ],
    responses: { 200: json('Zero ou uma instalação', res.installationList) },
    errors: ['MEMBER_ID_REQUIRED'],
  },
  {
    method: 'get',
    path: '/v1/installations/{id}',
    operationId: 'getInstallation',
    tag: 'Tokens',
    summary: 'Detalhes de uma instalação do app',
    security: 'appApiKey',
    pathParams: installationId,
    responses: { 200: json('Instalação', res.installation) },
    errors: ['INSTALLATION_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/v1/installations/{id}/token',
    operationId: 'getInstallationToken',
    tag: 'Tokens',
    summary: 'Access token do Bitrix para a instalação',
    description:
      'Só a plataforma renova tokens. Token a menos de 60 s de vencer é renovado antes de ser entregue. `Cache-Control: no-store`.',
    security: 'appApiKey',
    pathParams: installationId,
    responses: { 200: json('Token válido', res.token) },
    errors: [
      'INSTALLATION_NOT_FOUND',
      'INSTALLATION_UNINSTALLED',
      'AUTH_ERROR',
      'TOKEN_REFRESH_BUSY',
      'TOKEN_REFRESH_FAILED',
      'BITRIX_UNAVAILABLE',
    ],
  },
  {
    method: 'post',
    path: '/v1/installations/{id}/token/refresh',
    operationId: 'refreshInstallationToken',
    tag: 'Tokens',
    summary: 'Renovar o token quando o Bitrix recusou o atual',
    description:
      'Envie o token recusado em `staleAccessToken`. Se outro processo já renovou, devolve o novo sem nova troca (single-flight).',
    security: 'appApiKey',
    pathParams: installationId,
    body: { schema: req.refresh },
    responses: { 200: json('Token renovado', res.token) },
    errors: [
      'INSTALLATION_NOT_FOUND',
      'INSTALLATION_UNINSTALLED',
      'AUTH_ERROR',
      'TOKEN_REFRESH_BUSY',
      'TOKEN_REFRESH_FAILED',
      'BITRIX_UNAVAILABLE',
    ],
  },

  // Cobrança
  {
    method: 'get',
    path: '/v1/plans',
    operationId: 'listPlans',
    tag: 'Cobrança',
    summary: 'Planos ativos dos produtos do app',
    description: 'Plano pago sem preço Stripe no ambiente atual não é listado.',
    security: 'appApiKey',
    responses: { 200: json('Planos', res.planList) },
  },
  {
    method: 'get',
    path: '/v1/installations/{id}/subscription',
    operationId: 'getSubscription',
    tag: 'Cobrança',
    summary: 'Assinatura vigente da instalação',
    security: 'appApiKey',
    pathParams: installationId,
    responses: { 200: json('Assinatura', res.subscription) },
    errors: ['INSTALLATION_NOT_FOUND', 'NO_SUBSCRIPTION'],
  },
  {
    method: 'post',
    path: '/v1/checkout-sessions',
    operationId: 'createCheckoutSession',
    tag: 'Cobrança',
    summary: 'Criar sessão do Checkout embutido do Stripe',
    description:
      '`intent=subscribe` para plano `subscription`, `intent=purchase` para plano `one_time` (exige assinatura ativa ou em trial). A conclusão chega pelo evento `subscription.activated`/`purchase.paid`, não pelo navegador.',
    security: 'appApiKey',
    body: { schema: req.checkout },
    responses: { 201: json('Sessão criada', res.checkout) },
    errors: [
      'INSTALLATION_NOT_FOUND',
      ['INSTALLATION_NOT_ACTIVE', 409],
      'PLAN_NOT_FOUND',
      'PLAN_INACTIVE',
      'PLAN_TYPE_MISMATCH',
      'PLAN_NOT_PURCHASABLE',
      'SUBSCRIPTION_ALREADY_EXISTS',
      'NO_ACTIVE_SUBSCRIPTION',
      'PAYMENTS_UNAVAILABLE',
      'GATEWAY_ERROR',
    ],
  },
  {
    method: 'post',
    path: '/v1/billing-portal-sessions',
    operationId: 'createBillingPortalSession',
    tag: 'Cobrança',
    summary: 'Link do Customer Portal do Stripe',
    security: 'appApiKey',
    body: { schema: req.portal },
    responses: { 201: json('URL do portal', res.portal) },
    errors: ['INSTALLATION_NOT_FOUND', 'NO_GATEWAY_SUBSCRIPTION'],
  },
  {
    method: 'post',
    path: '/v1/subscriptions/{id}/change-plan',
    operationId: 'changePlan',
    tag: 'Cobrança',
    summary: 'Trocar o plano da assinatura',
    description:
      'Upgrade: imediato, com fatura proporcional; o evento `subscription.plan_changed` sai quando ela é paga. Downgrade: agendado para o próximo ciclo.',
    security: 'appApiKey',
    pathParams: subscriptionId,
    body: { schema: req.changePlan },
    responses: { 200: json('Troca aplicada ou agendada', res.changePlan) },
    errors: [
      'SUBSCRIPTION_NOT_FOUND',
      'MANUAL_SUBSCRIPTION',
      'NO_GATEWAY_SUBSCRIPTION',
      'SAME_PLAN',
      'PLAN_NOT_FOUND',
      'PLAN_INACTIVE',
      'PLAN_TYPE_MISMATCH',
      'PLAN_NOT_PURCHASABLE',
    ],
  },
  {
    method: 'get',
    path: '/v1/subscriptions/{id}/items',
    operationId: 'listItems',
    tag: 'Cobrança',
    summary: 'Itens da assinatura (SPA 1146)',
    security: 'appApiKey',
    pathParams: subscriptionId,
    responses: { 200: json('Itens, inclusive removidos', res.itemList) },
    errors: ['SUBSCRIPTION_NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/v1/subscriptions/{id}/items',
    operationId: 'createItem',
    tag: 'Cobrança',
    summary: 'Criar item da assinatura (idempotente por `externalRef`)',
    description:
      '201 quando cria; 200 com o item existente quando o `externalRef` já existe. Itens `billable` ativos definem a quantidade cobrada no Stripe.',
    security: 'appApiKey',
    pathParams: subscriptionId,
    body: { schema: req.createItem },
    responses: {
      201: json('Item criado', res.item),
      200: json('Item já existia com este `externalRef`', res.item),
    },
    errors: [
      'SUBSCRIPTION_NOT_FOUND',
      'SUBSCRIPTION_ENDED',
      'BILLING_BUSY',
      'GATEWAY_ERROR',
    ],
  },
  {
    method: 'patch',
    path: '/v1/subscriptions/{id}/items/{itemId}',
    operationId: 'updateItem',
    tag: 'Cobrança',
    summary: 'Alterar item da assinatura',
    security: 'appApiKey',
    pathParams: { ...subscriptionId, itemId: 'Id do item' },
    body: { schema: req.updateItem },
    responses: { 200: json('Item atualizado', res.item) },
    errors: [
      'SUBSCRIPTION_NOT_FOUND',
      'ITEM_NOT_FOUND',
      'SUBSCRIPTION_ENDED',
      'BILLING_BUSY',
      'GATEWAY_ERROR',
    ],
  },
  {
    method: 'delete',
    path: '/v1/subscriptions/{id}/items/{itemId}',
    operationId: 'removeItem',
    tag: 'Cobrança',
    summary: 'Remover item (remoção lógica: `status=cancelled`)',
    security: 'appApiKey',
    pathParams: { ...subscriptionId, itemId: 'Id do item' },
    responses: { 200: json('Item removido', res.item) },
    errors: [
      'SUBSCRIPTION_NOT_FOUND',
      'ITEM_NOT_FOUND',
      'SUBSCRIPTION_ENDED',
      'BILLING_BUSY',
      'GATEWAY_ERROR',
    ],
  },

  // Webhooks recebidos
  {
    method: 'post',
    path: '/webhooks/stripe',
    operationId: 'receiveStripeWebhook',
    tag: 'Webhooks recebidos',
    summary: 'Webhook do Stripe',
    description:
      'Corpo cru: a assinatura `Stripe-Signature` é HMAC sobre os bytes. O evento é gravado e processado de forma assíncrona pelo worker.',
    security: 'stripeSignature',
    body: { schema: req.stripeEvent, contentType: 'application/octet-stream' },
    responses: { 200: json('Recebido', res.stripeResult) },
    errors: ['INVALID_SIGNATURE'],
  },
  {
    method: 'post',
    path: '/bitrix/spa-events',
    operationId: 'receiveSpaEvent',
    tag: 'Webhooks recebidos',
    summary: 'Eventos dos SPAs do portal CRMThink (`ONCRMDYNAMICITEM*`)',
    description:
      'Autenticado pelo `auth[application_token]` do evento (`CRMTHINK_APPLICATION_TOKEN`). Evento reconhecido vai para a fila do worker.',
    security: 'none',
    body: {
      schema: req.spaEvent,
      contentType: 'application/x-www-form-urlencoded',
    },
    responses: {
      200: json(
        '`handled=false` quando o evento não é de interesse',
        res.spaResult,
      ),
      401: json('`application_token` inválido', res.spaResult),
      503: json('`CRMTHINK_APPLICATION_TOKEN` não configurado', res.spaResult),
    },
  },

  // Operador
  {
    method: 'get',
    path: '/admin/apps',
    operationId: 'listApps',
    tag: 'Operador',
    summary: 'Listar aplicações cadastradas',
    security: 'adminToken',
    responses: { 200: json('Aplicações', res.appList) },
  },
  {
    method: 'post',
    path: '/admin/apps',
    operationId: 'createApp',
    tag: 'Operador',
    summary: 'Cadastrar aplicação',
    description:
      '**`apiKey` e `webhookSecret` só aparecem nesta resposta.** A chave é guardada só como hash; o segredo e o `client_secret` ficam cifrados.',
    security: 'adminToken',
    body: { schema: req.createApp },
    responses: { 201: json('Aplicação e credenciais', res.appCreated) },
    errors: ['APP_ALREADY_EXISTS', 'TRIAL_CONFIG_INVALID'],
  },
  {
    method: 'get',
    path: '/admin/apps/{appCode}',
    operationId: 'getApp',
    tag: 'Operador',
    summary: 'Detalhes de uma aplicação',
    security: 'adminToken',
    pathParams: { appCode: 'Código do app' },
    responses: { 200: json('Aplicação', res.app) },
    errors: ['APP_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: '/admin/apps/{appCode}',
    operationId: 'updateApp',
    tag: 'Operador',
    summary: 'Alterar aplicação',
    security: 'adminToken',
    pathParams: { appCode: 'Código do app' },
    body: { schema: req.updateApp },
    responses: { 200: json('Aplicação atualizada', res.app) },
    errors: ['APP_NOT_FOUND', 'TRIAL_CONFIG_INVALID'],
  },
  {
    method: 'post',
    path: '/admin/apps/{appCode}/rotate-api-key',
    operationId: 'rotateApiKey',
    tag: 'Operador',
    summary: 'Rotacionar chave de API',
    description:
      'A chave anterior vale até `previousValidUntil` (`CREDENTIAL_ROTATION_GRACE_HOURS`). A nova só aparece nesta resposta.',
    security: 'adminToken',
    pathParams: { appCode: 'Código do app' },
    responses: { 200: json('Nova chave', res.apiKeyRotated) },
    errors: ['APP_NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/admin/apps/{appCode}/rotate-webhook-secret',
    operationId: 'rotateWebhookSecret',
    tag: 'Operador',
    summary: 'Rotacionar segredo de webhook',
    description:
      'Durante a carência os webhooks levam duas assinaturas `v1=`. O novo segredo só aparece nesta resposta.',
    security: 'adminToken',
    pathParams: { appCode: 'Código do app' },
    responses: { 200: json('Novo segredo', res.webhookSecretRotated) },
    errors: ['APP_NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/v1/installations/{id}/trial',
    operationId: 'startTrial',
    tag: 'Operador',
    summary: 'Iniciar trial manualmente',
    security: 'adminToken',
    pathParams: installationId,
    responses: { 201: json('Trial iniciado', res.trialStarted) },
    errors: [
      'INSTALLATION_NOT_FOUND',
      'APP_NOT_FOUND',
      'TRIAL_NOT_CONFIGURED',
      'TRIAL_ALREADY_USED',
      'SUBSCRIPTION_ALREADY_EXISTS',
      'BILLING_BUSY',
    ],
  },
  {
    method: 'get',
    path: '/admin/installations/{id}/attempts',
    operationId: 'listInstallAttempts',
    tag: 'Operador',
    summary: 'Passos registrados da instalação (50 mais recentes)',
    security: 'adminToken',
    pathParams: installationId,
    responses: { 200: json('Tentativas', res.attempts) },
    errors: ['NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/admin/events',
    operationId: 'listOutboxEvents',
    tag: 'Operador',
    summary: 'Eventos do outbox (100 mais recentes)',
    security: 'adminToken',
    query: [
      {
        name: 'status',
        description: 'Filtra por status',
        enum: ['pending', 'delivered', 'dead'],
      },
      { name: 'appCode', description: 'Filtra por app' },
    ],
    responses: {
      200: json('Eventos com as últimas tentativas', res.outboxEvents),
    },
  },
  {
    method: 'get',
    path: '/admin/stripe-events',
    operationId: 'listStripeEvents',
    tag: 'Operador',
    summary: 'Eventos Stripe recebidos (100 mais recentes, sem payload)',
    security: 'adminToken',
    query: [{ name: 'status', description: 'Filtra por status' }],
    responses: { 200: json('Eventos', res.stripeEvents) },
  },
  {
    method: 'post',
    path: '/admin/events/resend',
    operationId: 'resendEvents',
    tag: 'Operador',
    summary: 'Reenviar eventos (um `eventId` ou uma janela por app)',
    description: 'Reabre a janela de reenvio de 24 h dos eventos selecionados.',
    security: 'adminToken',
    body: { schema: req.resend },
    responses: { 200: json('Quantidade reenfileirada', res.resend) },
  },
  {
    method: 'post',
    path: '/admin/signing-keys/rotate',
    operationId: 'rotateSigningKey',
    tag: 'Operador',
    summary: 'Gerar nova chave de assinatura do JWT',
    description:
      'A chave entra no JWKS já, mas só passa a assinar após `leadMinutes` — tempo para os apps atualizarem o cache do JWKS.',
    security: 'adminToken',
    body: { schema: req.rotateSigningKey, required: false },
    responses: { 201: json('Chave criada', res.signingKey) },
  },
  {
    method: 'post',
    path: '/admin/sweeps/{kind}',
    operationId: 'runSweep',
    tag: 'Operador',
    summary: 'Rodar varredura de reconciliação agora',
    security: 'adminToken',
    pathParams: { kind: '`stripe` ou `spa`' },
    responses: { 200: json('Resultado da varredura', res.sweep) },
    errors: ['NOT_FOUND'],
  },
]

export const ADMIN_TAG: Tag = 'Operador'
