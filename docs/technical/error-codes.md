# Catálogo de códigos de erro

<!-- Gerado por `yarn docs:openapi` a partir de `src/docs/errors.ts`. Não edite à mão. -->

Toda resposta de erro tem o formato `{ "error": { "code", "message", "details"? } }`. Os apps
decidem pelo `code` (estável); a `message` é texto para pessoas e pode mudar. O status HTTP
abaixo é o usual; a coluna *Operações* lista os `operationId` do OpenAPI que podem devolver
o código (`INSTALLATION_NOT_ACTIVE`, por exemplo, sai como 403 na sessão e 409 no checkout).

Para acrescentar um código: registre-o em `src/docs/errors.ts`, declare-o nas operações
em `src/docs/openapi/operations.ts` e rode `yarn docs:openapi`. O teste
`src/docs/openapi/openapi.test.ts` falha se um código lançado no código não estiver aqui.

| Código | Status | Significado | O que fazer | Operações | Origem (`src/modules/…` ou `src/…`) |
| --- | --- | --- | --- | --- | --- |
| `INVALID_SIGNATURE` | 400 | Assinatura `Stripe-Signature` inválida ou ausente. | Conferir `STRIPE_WEBHOOK_SECRET` do endpoint. | receiveStripeWebhook | `billing/http/routes.ts` |
| `MEMBER_ID_REQUIRED` | 400 | Query `memberId` ausente. | Informar `?memberId=`. | listInstallations | `installations/http/routes.ts` |
| `PLAN_TYPE_MISMATCH` | 400 | Plano de assinatura com `intent=purchase` ou avulso com `intent=subscribe`. | Usar o `intent` correspondente ao `type` do plano. | createCheckoutSession, changePlan | `billing/application/plan-catalog.ts` |
| `SAME_PLAN` | 400 | A assinatura já está no plano pedido. | Nada a fazer. | changePlan | `billing/application/subscription-queries.ts` |
| `TRIAL_CONFIG_INVALID` | 400 | `trialOnInstall` sem `trialDays` > 0 ou sem `trialPlanId`. | Informar os dois campos ou desligar `trialOnInstall`. | createApp, updateApp | `registry/app-registry.ts` |
| `VALIDATION_ERROR` | 400 | Corpo ou parâmetros fora do schema; `details` lista `{path, message}`. | Corrigir a requisição; não repetir igual. | install, retryInstall, createSession, refreshInstallationToken, requestTrial, createCheckoutSession +9 | `shared/http/errors.ts (ZodError)` |
| `UNAUTHORIZED` | 401 | Credencial ausente ou inválida (chave de API, token de operador ou auth do evento). | Conferir a credencial; após rotação, usar a nova. | receiveBitrixAppEvent, listInstallations, getInstallation, getInstallationToken, refreshInstallationToken, listPlans +22 | `registry/http/auth.ts, rotas de eventos` |
| `APP_INACTIVE` | 403 | Aplicação desativada ou inexistente. | Falar com o operador da plataforma. | createSession, listInstallations, getInstallation, getInstallationToken, refreshInstallationToken, listPlans +9 | `registry/http/auth.ts, installations/application/session-service.ts` |
| `BITRIX_TOKEN_REJECTED` | 403 | O Bitrix recusou o access token enviado. | Obter nova autenticação pelo `BX24.getAuth()` e repetir. | install, retryInstall, createSession | `installations/application/bitrix-auth-verifier.ts` |
| `BITRIX_USER_UNKNOWN` | 403 | O Bitrix não devolveu o usuário do token. | Reabrir o app no portal e repetir. | createSession | `installations/application/bitrix-auth-verifier.ts` |
| `DOMAIN_MISMATCH` | 403 | Domínio informado não é o do portal dono do token. | Enviar o domínio do `BX24.getAuth()` sem alterar. | install | `installations/application/bitrix-auth-verifier.ts` |
| `INSTALLATION_MISMATCH` | 403 | Retry de instalação para portal diferente do registrado. | Refazer pela instalação original do portal. | retryInstall | `installations/application/install-service.ts` |
| `INSTALLATION_NOT_ACTIVE` | 403 | Sem instalação `ACTIVE` do app no portal (sessão: 403; checkout: 409). | Concluir ou refazer a instalação. | createSession, createCheckoutSession | `installations/application/session-service.ts, billing/application/checkout-service.ts` |
| `MEMBER_ID_MISMATCH` | 403 | memberId informado não é o do portal dono do token. | Enviar o memberId do `BX24.getAuth()` sem alterar. | install | `installations/application/bitrix-auth-verifier.ts` |
| `NOT_PORTAL_ADMIN` | 403 | Instalar ou refazer instalação exige administrador do portal. | Pedir a um administrador do portal. | install, retryInstall | `installations/application/bitrix-auth-verifier.ts` |
| `ORIGIN_NOT_ALLOWED` | 403 | Origem do navegador não autorizada para o appCode (`SESSION_CORS_ORIGINS`). | Pedir ao operador o cadastro da origem do frontend. | createSession | `installations/http/routes.ts` |
| `TOKEN_APP_MISMATCH` | 403 | O access token pertence a outro app Bitrix (client_id diferente). | Abrir pelo app Bitrix correto do ambiente. | install, retryInstall, createSession | `installations/application/bitrix-auth-verifier.ts` |
| `APP_NOT_FOUND` | 404 | appCode não cadastrado ou inativo. | Conferir o appCode. | install, retryInstall, getApp, updateApp, rotateApiKey, rotateWebhookSecret +1 | `registry/app-registry.ts, installations/application/install-service.ts` |
| `INSTALLATION_NOT_FOUND` | 404 | Instalação inexistente, de outro app ou desvinculada do SPA 1060. | Conferir o id; não diferencia "não existe" de "não é sua". | getInstallation, getInstallationToken, refreshInstallationToken, getSubscription, requestTrial, createCheckoutSession +2 | `installations/application/installation-queries.ts, billing` |
| `ITEM_NOT_FOUND` | 404 | Item inexistente ou de outra assinatura. | Conferir o `itemId`. | updateItem, removeItem | `billing/application/items-service.ts` |
| `NO_SUBSCRIPTION` | 404 | A instalação não tem assinatura vigente. | Oferecer trial ou checkout. | getSubscription | `billing/application/subscription-queries.ts` |
| `NOT_FOUND` | 404 | Rota ou recurso inexistente. | Conferir método e caminho. | listInstallAttempts, runSweep | `app.ts (fallback), shared/http/errors.ts` |
| `PLAN_NOT_FOUND` | 404 | Plano inexistente ou de produto não vinculado ao app. | Usar um id de `GET /v1/plans`. | createCheckoutSession, changePlan | `billing/application/plan-catalog.ts` |
| `SUBSCRIPTION_NOT_FOUND` | 404 | Assinatura inexistente ou de instalação de outro app. | Usar o `subscriptionId` de `GET /v1/installations/{id}/subscription`. | changePlan, listItems, createItem, updateItem, removeItem | `billing/application/billing-context.ts` |
| `APP_ALREADY_EXISTS` | 409 | Já existe aplicação com este appCode. | Usar PATCH para alterar a existente. | createApp | `registry/app-registry.ts` |
| `AUTH_ERROR` | 409 | Credencial do Bitrix inválida; é preciso reinstalar o app. | Orientar o cliente a reinstalar; aguardar `installation.auth_restored`. | getInstallationToken, refreshInstallationToken | `installations/application/token-vault.ts` |
| `BILLING_BUSY` | 409 | Outra operação de cobrança da mesma instalação está em andamento. | Repetir em alguns segundos. | requestTrial, createItem, updateItem, removeItem, startTrial | `billing/application/billing-context.ts` |
| `INSTALLATION_NOT_PENDING` | 409 | Retry pedido para instalação que não está `INSTALL_PENDING`. | Nada a refazer; consultar o status da instalação. | retryInstall | `installations/application/install-service.ts` |
| `SUBSCRIPTION_ALREADY_EXISTS` | 409 | A instalação já tem assinatura paga vigente. | Usar troca de plano ou o Customer Portal. | requestTrial, createCheckoutSession, startTrial | `billing/application/checkout-service.ts, billing/application/trial-service.ts` |
| `TRIAL_ALREADY_USED` | 409 | A instalação já usou o trial (na rota de operador, também quando o trial está vigente). | Oferecer checkout. Na solicitação do app, o contato enviado já foi gravado. | requestTrial, startTrial | `billing/application/trial-service.ts` |
| `INSTALLATION_UNINSTALLED` | 410 | O app foi removido do portal; não há mais token. | Parar de chamar o Bitrix para esta instalação. | getInstallationToken, refreshInstallationToken | `installations/application/token-vault.ts` |
| `MANUAL_SUBSCRIPTION` | 422 | Assinatura manual: plano é alterado no SPA pelo time comercial. | Encaminhar ao comercial. | changePlan | `billing/application/subscription-queries.ts` |
| `NO_ACTIVE_SUBSCRIPTION` | 422 | Compra avulsa exige assinatura ativa ou em trial. | Assinar antes de comprar. | createCheckoutSession | `billing/application/checkout-service.ts` |
| `NO_GATEWAY_SUBSCRIPTION` | 422 | Assinatura sem cobrança Stripe ativa (trial, manual ou encerrada). | Não oferecer portal/troca de plano para esta assinatura. | createBillingPortalSession, changePlan | `billing/application/subscription-queries.ts` |
| `PLAN_INACTIVE` | 422 | Plano ou produto inativo. | Recarregar `GET /v1/plans`. | createCheckoutSession, changePlan | `billing/application/plan-catalog.ts` |
| `PLAN_NOT_PURCHASABLE` | 422 | Plano sem preço Stripe no ambiente atual. | Falar com o operador (configuração do plano). | createCheckoutSession, changePlan | `billing/application/plan-catalog.ts` |
| `SUBSCRIPTION_ENDED` | 422 | Assinatura cancelada ou com trial expirado não aceita itens. | Assinar de novo antes de alterar itens. | createItem, updateItem, removeItem | `billing/application/items-service.ts` |
| `TRIAL_NOT_CONFIGURED` | 422 | O app não tem trial configurado. | Pedir ao operador para configurar `trialDays`/`trialPlanId` no cadastro do app. | requestTrial, startTrial | `billing/application/trial-service.ts` |
| `AUTH_MISSING` | 500 | Rota de app montada sem `appAuth` (defeito da plataforma). | Reportar; não é causado pelo app. | — | `registry/http/auth.ts` |
| `INTERNAL_ERROR` | 500 | Erro não tratado; registrado no log com o `X-Request-Id`. | Repetir com backoff; persistindo, reportar com o `X-Request-Id`. | — | `shared/http/errors.ts` |
| `EVENT_BIND_FAILED` | 502 | Falha ao registrar `ONAPPINSTALL`/`ONAPPUNINSTALL` no portal (503 se o portal não respondeu). | Repetir a instalação; ela retoma sem duplicar. | install | `installations/application/install-service.ts` |
| `GATEWAY_ERROR` | 502 | O Stripe recusou ou falhou na operação. | Repetir com backoff; persistindo, reportar. | createCheckoutSession, createItem, updateItem, removeItem | `billing/application/checkout-service.ts, billing/application/items-service.ts` |
| `TOKEN_REFRESH_FAILED` | 502 | O OAuth do Bitrix falhou ao renovar o token. | Repetir com backoff. | getInstallationToken, refreshInstallationToken | `installations/application/token-vault.ts` |
| `BITRIX_UNAVAILABLE` | 503 | O portal Bitrix24 não respondeu a tempo. | Repetir com backoff. | install, retryInstall, createSession, getInstallationToken, refreshInstallationToken | `installations/application/bitrix-auth-verifier.ts, installations/application/token-vault.ts` |
| `CRMTHINK_UNAVAILABLE` | 503 | O portal CRMThink (SPAs) não respondeu durante a instalação. | Repetir a instalação; ela retoma sem duplicar. | install | `installations/application/install-service.ts` |
| `PAYMENTS_UNAVAILABLE` | 503 | Stripe não configurado neste ambiente. | Falar com o operador. | createCheckoutSession | `billing/application/checkout-service.ts` |
| `TOKEN_REFRESH_BUSY` | 503 | Outra renovação do mesmo token está em andamento. | Repetir em alguns segundos. | getInstallationToken, refreshInstallationToken | `installations/application/token-vault.ts` |
