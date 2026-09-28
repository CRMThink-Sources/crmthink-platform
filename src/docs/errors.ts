/**
 * Catálogo dos códigos de erro estáveis do contrato. Fonte única: o OpenAPI monta as
 * respostas de erro de cada operação a partir daqui e `docs/technical/error-codes.md`
 * é gerado deste arquivo (`yarn docs:openapi`). Um código lançado no código-fonte e
 * ausente aqui derruba `src/docs/openapi/openapi.test.ts`.
 */

export type ErrorInfo = {
  status: number
  /** O que aconteceu, para quem lê a referência. */
  meaning: string
  /** O que o app (ou o operador) deve fazer. */
  action: string
  /** Onde o erro nasce, para quem mantém a plataforma. */
  origin: string
}

export const ERROR_CATALOG = {
  // Genéricos
  VALIDATION_ERROR: {
    status: 400,
    meaning:
      'Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.',
    action: 'Corrigir a requisição; não repetir igual.',
    origin: 'shared/http/errors.ts (ZodError)',
  },
  UNAUTHORIZED: {
    status: 401,
    meaning:
      'Credencial ausente ou inválida (chave de API, token de operador ou auth do evento).',
    action: 'Conferir a credencial; após rotação, usar a nova.',
    origin: 'registry/http/auth.ts, rotas de eventos',
  },
  NOT_FOUND: {
    status: 404,
    meaning: 'Rota ou recurso inexistente.',
    action: 'Conferir método e caminho.',
    origin: 'app.ts (fallback), shared/http/errors.ts',
  },
  INTERNAL_ERROR: {
    status: 500,
    meaning: 'Erro não tratado; registrado no log com o `X-Request-Id`.',
    action: 'Repetir com backoff; persistindo, reportar com o `X-Request-Id`.',
    origin: 'shared/http/errors.ts',
  },
  AUTH_MISSING: {
    status: 500,
    meaning: 'Rota de app montada sem `appAuth` (defeito da plataforma).',
    action: 'Reportar; não é causado pelo app.',
    origin: 'registry/http/auth.ts',
  },

  // Aplicação e credenciais
  APP_INACTIVE: {
    status: 403,
    meaning: 'Aplicação desativada ou inexistente.',
    action: 'Falar com o operador da plataforma.',
    origin:
      'registry/http/auth.ts, installations/application/session-service.ts',
  },
  APP_NOT_FOUND: {
    status: 404,
    meaning: 'appCode não cadastrado ou inativo.',
    action: 'Conferir o appCode.',
    origin:
      'registry/app-registry.ts, installations/application/install-service.ts',
  },
  APP_ALREADY_EXISTS: {
    status: 409,
    meaning: 'Já existe aplicação com este appCode.',
    action: 'Usar PATCH para alterar a existente.',
    origin: 'registry/app-registry.ts',
  },
  TRIAL_CONFIG_INVALID: {
    status: 400,
    meaning: '`trialOnInstall` sem `trialDays` > 0 ou sem `trialPlanId`.',
    action: 'Informar os dois campos ou desligar `trialOnInstall`.',
    origin: 'registry/app-registry.ts',
  },

  // Instalação e autenticação do Bitrix
  BITRIX_TOKEN_REJECTED: {
    status: 403,
    meaning: 'O Bitrix recusou o access token enviado.',
    action: 'Obter nova autenticação pelo `BX24.getAuth()` e repetir.',
    origin: 'installations/application/bitrix-auth-verifier.ts',
  },
  TOKEN_APP_MISMATCH: {
    status: 403,
    meaning:
      'O access token pertence a outro app Bitrix (client_id diferente).',
    action: 'Abrir pelo app Bitrix correto do ambiente.',
    origin: 'installations/application/bitrix-auth-verifier.ts',
  },
  MEMBER_ID_MISMATCH: {
    status: 403,
    meaning: 'memberId informado não é o do portal dono do token.',
    action: 'Enviar o memberId do `BX24.getAuth()` sem alterar.',
    origin: 'installations/application/bitrix-auth-verifier.ts',
  },
  DOMAIN_MISMATCH: {
    status: 403,
    meaning: 'Domínio informado não é o do portal dono do token.',
    action: 'Enviar o domínio do `BX24.getAuth()` sem alterar.',
    origin: 'installations/application/bitrix-auth-verifier.ts',
  },
  NOT_PORTAL_ADMIN: {
    status: 403,
    meaning: 'Instalar ou refazer instalação exige administrador do portal.',
    action: 'Pedir a um administrador do portal.',
    origin: 'installations/application/bitrix-auth-verifier.ts',
  },
  BITRIX_USER_UNKNOWN: {
    status: 403,
    meaning: 'O Bitrix não devolveu o usuário do token.',
    action: 'Reabrir o app no portal e repetir.',
    origin: 'installations/application/bitrix-auth-verifier.ts',
  },
  BITRIX_UNAVAILABLE: {
    status: 503,
    meaning: 'O portal Bitrix24 não respondeu a tempo.',
    action: 'Repetir com backoff.',
    origin:
      'installations/application/bitrix-auth-verifier.ts, installations/application/token-vault.ts',
  },
  CRMTHINK_UNAVAILABLE: {
    status: 503,
    meaning: 'O portal CRMThink (SPAs) não respondeu durante a instalação.',
    action: 'Repetir a instalação; ela retoma sem duplicar.',
    origin: 'installations/application/install-service.ts',
  },
  EVENT_BIND_FAILED: {
    status: 502,
    meaning:
      'Falha ao registrar `ONAPPUNINSTALL` no portal (503 se o portal não respondeu).',
    action: 'Repetir a instalação; ela retoma sem duplicar.',
    origin: 'installations/application/install-service.ts',
  },
  INSTALLATION_MISMATCH: {
    status: 403,
    meaning: 'Retry de instalação para portal diferente do registrado.',
    action: 'Refazer pela instalação original do portal.',
    origin: 'installations/application/install-service.ts',
  },
  INSTALLATION_NOT_PENDING: {
    status: 409,
    meaning: 'Retry pedido para instalação que não está `INSTALL_PENDING`.',
    action: 'Nada a refazer; consultar o status da instalação.',
    origin: 'installations/application/install-service.ts',
  },
  ORIGIN_NOT_ALLOWED: {
    status: 403,
    meaning:
      'Origem do navegador não autorizada para o appCode (`SESSION_CORS_ORIGINS`).',
    action: 'Pedir ao operador o cadastro da origem do frontend.',
    origin: 'installations/http/routes.ts',
  },
  INSTALLATION_NOT_ACTIVE: {
    status: 403,
    meaning:
      'Sem instalação `ACTIVE` do app no portal (sessão: 403; checkout: 409).',
    action: 'Concluir ou refazer a instalação.',
    origin:
      'installations/application/session-service.ts, billing/application/checkout-service.ts',
  },
  MEMBER_ID_REQUIRED: {
    status: 400,
    meaning: 'Query `memberId` ausente.',
    action: 'Informar `?memberId=`.',
    origin: 'installations/http/routes.ts',
  },
  INSTALLATION_NOT_FOUND: {
    status: 404,
    meaning:
      'Instalação inexistente, de outro app ou desvinculada do SPA 1060.',
    action: 'Conferir o id; não diferencia "não existe" de "não é sua".',
    origin: 'installations/application/installation-queries.ts, billing',
  },

  // Tokens
  INSTALLATION_UNINSTALLED: {
    status: 410,
    meaning: 'O app foi removido do portal; não há mais token.',
    action: 'Parar de chamar o Bitrix para esta instalação.',
    origin: 'installations/application/token-vault.ts',
  },
  AUTH_ERROR: {
    status: 409,
    meaning: 'Credencial do Bitrix inválida; é preciso reinstalar o app.',
    action:
      'Orientar o cliente a reinstalar; aguardar `installation.auth_restored`.',
    origin: 'installations/application/token-vault.ts',
  },
  TOKEN_REFRESH_BUSY: {
    status: 503,
    meaning: 'Outra renovação do mesmo token está em andamento.',
    action: 'Repetir em alguns segundos.',
    origin: 'installations/application/token-vault.ts',
  },
  TOKEN_REFRESH_FAILED: {
    status: 502,
    meaning: 'O OAuth do Bitrix falhou ao renovar o token.',
    action: 'Repetir com backoff.',
    origin: 'installations/application/token-vault.ts',
  },

  // Cobrança
  PLAN_NOT_FOUND: {
    status: 404,
    meaning: 'Plano inexistente ou de produto não vinculado ao app.',
    action: 'Usar um id de `GET /v1/plans`.',
    origin: 'billing/application/plan-catalog.ts',
  },
  PLAN_INACTIVE: {
    status: 422,
    meaning: 'Plano ou produto inativo.',
    action: 'Recarregar `GET /v1/plans`.',
    origin: 'billing/application/plan-catalog.ts',
  },
  PLAN_TYPE_MISMATCH: {
    status: 400,
    meaning:
      'Plano de assinatura com `intent=purchase` ou avulso com `intent=subscribe`.',
    action: 'Usar o `intent` correspondente ao `type` do plano.',
    origin: 'billing/application/plan-catalog.ts',
  },
  PLAN_NOT_PURCHASABLE: {
    status: 422,
    meaning: 'Plano sem preço Stripe no ambiente atual.',
    action: 'Falar com o operador (configuração do plano).',
    origin: 'billing/application/plan-catalog.ts',
  },
  SUBSCRIPTION_NOT_FOUND: {
    status: 404,
    meaning: 'Assinatura inexistente ou de instalação de outro app.',
    action:
      'Usar o `subscriptionId` de `GET /v1/installations/{id}/subscription`.',
    origin: 'billing/application/billing-context.ts',
  },
  NO_SUBSCRIPTION: {
    status: 404,
    meaning: 'A instalação não tem assinatura vigente.',
    action: 'Oferecer trial ou checkout.',
    origin: 'billing/application/subscription-queries.ts',
  },
  SUBSCRIPTION_ALREADY_EXISTS: {
    status: 409,
    meaning: 'A instalação já tem assinatura paga (ou trial, no trial manual).',
    action: 'Usar troca de plano ou o Customer Portal.',
    origin:
      'billing/application/checkout-service.ts, billing/application/trial-service.ts',
  },
  NO_ACTIVE_SUBSCRIPTION: {
    status: 422,
    meaning: 'Compra avulsa exige assinatura ativa ou em trial.',
    action: 'Assinar antes de comprar.',
    origin: 'billing/application/checkout-service.ts',
  },
  NO_GATEWAY_SUBSCRIPTION: {
    status: 422,
    meaning:
      'Assinatura sem cobrança Stripe ativa (trial, manual ou encerrada).',
    action: 'Não oferecer portal/troca de plano para esta assinatura.',
    origin: 'billing/application/subscription-queries.ts',
  },
  MANUAL_SUBSCRIPTION: {
    status: 422,
    meaning: 'Assinatura manual: plano é alterado no SPA pelo time comercial.',
    action: 'Encaminhar ao comercial.',
    origin: 'billing/application/subscription-queries.ts',
  },
  SAME_PLAN: {
    status: 400,
    meaning: 'A assinatura já está no plano pedido.',
    action: 'Nada a fazer.',
    origin: 'billing/application/subscription-queries.ts',
  },
  SUBSCRIPTION_ENDED: {
    status: 422,
    meaning: 'Assinatura cancelada ou com trial expirado não aceita itens.',
    action: 'Assinar de novo antes de alterar itens.',
    origin: 'billing/application/items-service.ts',
  },
  ITEM_NOT_FOUND: {
    status: 404,
    meaning: 'Item inexistente ou de outra assinatura.',
    action: 'Conferir o `itemId`.',
    origin: 'billing/application/items-service.ts',
  },
  BILLING_BUSY: {
    status: 409,
    meaning:
      'Outra operação de cobrança da mesma instalação está em andamento.',
    action: 'Repetir em alguns segundos.',
    origin: 'billing/application/billing-context.ts',
  },
  PAYMENTS_UNAVAILABLE: {
    status: 503,
    meaning: 'Stripe não configurado neste ambiente.',
    action: 'Falar com o operador.',
    origin: 'billing/application/checkout-service.ts',
  },
  GATEWAY_ERROR: {
    status: 502,
    meaning: 'O Stripe recusou ou falhou na operação.',
    action: 'Repetir com backoff; persistindo, reportar.',
    origin:
      'billing/application/checkout-service.ts, billing/application/items-service.ts',
  },
  TRIAL_NOT_CONFIGURED: {
    status: 422,
    meaning: 'O app não tem trial configurado.',
    action: 'Configurar `trialDays`/`trialPlanId` no cadastro.',
    origin: 'billing/application/trial-service.ts',
  },
  TRIAL_ALREADY_USED: {
    status: 409,
    meaning: 'A instalação já usou o trial.',
    action: 'Oferecer checkout.',
    origin: 'billing/application/trial-service.ts',
  },

  // Webhooks recebidos
  INVALID_SIGNATURE: {
    status: 400,
    meaning: 'Assinatura `Stripe-Signature` inválida ou ausente.',
    action: 'Conferir `STRIPE_WEBHOOK_SECRET` do endpoint.',
    origin: 'billing/http/routes.ts',
  },
} as const satisfies Record<string, ErrorInfo>

export type ErrorCode = keyof typeof ERROR_CATALOG

export const isErrorCode = (code: string): code is ErrorCode =>
  Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code)
