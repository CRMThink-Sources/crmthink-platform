# Migração dos apps do hub-core para a plataforma

Cada app (ThinkZap, ThinkAnalise, ImportSheet, ClickSign) sai do `hub-core` para um
repositório próprio e passa a consumir a plataforma — uma change por app. Este documento
é o roteiro comum: mapeamento (18.1), importação (18.2), corte (18.3) e correções de
segurança (18.4).

## 1. Mapeamento hub-core → plataforma (18.1)

### Tabelas

| hub-core | plataforma | Observações |
| --- | --- | --- |
| `core_app_codes` (`id` = `crmthink.<app>`, `code` = client_id do app Bitrix, `secret`) | `app` (`app_code`, `bitrix_client_id`, `bitrix_client_secret_enc`) | Secret passa a ser cifrado. Novos: escopos, `installer_url`, `webhook_url` + segredo HMAC, chave de API (hash), trial, tema da página. |
| `core_domains` (`name`, `member_id`) | colunas `domain`/`member_id` de `installation` | Sem tabela de domínio: a instalação é a unidade (`UNIQUE(app_code, member_id)`). |
| `core_apps` (`domain_id`, `app_code_id`, `spa_id`, `email`, `status`) | `installation` (`id` = item do SPA 1060, `spa_item_id`, `contact`, `status`) | `installationId` = `core_apps.spa_id`. Status técnico novo: `INSTALLING`, `INSTALL_PENDING`, `ACTIVE`, `UNINSTALLED`, `AUTH_ERROR`. |
| `core_credentials` (`client_id`, `client_secret` copiados, tokens em texto puro ou `v1:`) | `credential` (tokens `v1:` com a chave da plataforma) | `client_id/secret` não são mais copiados por instalação: vêm de `app`. `refresh_failed_attempts` → `refresh_failures`. |
| — | `application_token` | O hub-core nunca guardou. Ver 18.2. |
| — | `signing_key`, `outbox_event`, `event_delivery`, `stripe_event`, `subscription_version`, `item_version`, `period_notice`, `purchase`, `sweep_run`, `install_attempt` | Novas. |

SPAs: os mesmos (1134, 1138, 1060, 1142, 1146), agora com Ambiente, trial usado,
`billable`, `externalRef`, versão e `cancelAtPeriodEnd`. STATUS/TRIAL_* do 1060 deixam de
ser lidos e escritos.

### Rotas

| hub-core | plataforma |
| --- | --- |
| `POST /api/auth/install` (público, confia no navegador) | `GET /install/{appCode}` + `POST /v1/install` (verificação no servidor) + `POST /v1/install/retry` |
| — (sem handler de `ONAPPINSTALL`/`ONAPPUNINSTALL`) | `POST /bitrix/events/{appCode}` |
| `POST /api/auth` / `POST /api/auth/bitrix-oauth` / `GET /api/auth/session` (JWT HS256 sem `exp`, admin do navegador) | `POST /v1/sessions` (JWT RS256 15 min, admin via `user.admin`) + `/.well-known/jwks.json` |
| `resolve-bitrix-client-for-app.ts` (renova sem lock, dentro do app) | `GET /v1/installations/{id}/token` + `POST …/token/refresh` (renovação única sob lock) |
| `GET /api/application/me` | `GET /v1/installations/{id}` + `GET /v1/installations/{id}/subscription` |
| `/api/thinkzap/...` checkout, portal, itens | `POST /v1/checkout-sessions`, `/v1/billing-portal-sessions`, `/v1/subscriptions/{id}/items`, `/change-plan` |
| `POST /api/webhooks/stripe` | `POST /webhooks/stripe` (endpoint próprio, filtrado por `appCode`) |
| `POST /api/webhooks/bitrix` (SPA, `BITRIX_SPA_WEBHOOK_TOKEN`) | `POST /bitrix/spa-events` (`CRMTHINK_APPLICATION_TOKEN`) |

### Instalador

| hub-core | plataforma |
| --- | --- |
| `AppInstaller.install(ctx)` em processo, registrado em `setup-app-installers.ts`, recebe `BitrixRestClient` | `POST <installer_url>` assinado (HMAC), `{installationId, memberId, domain, appCode, isReinstall}`, timeout 60s. O app pede o token em `GET /v1/installations/{id}/token` e faz os mesmos binds. |
| Falha aborta a instalação inteira | Falha ⇒ `INSTALL_PENDING` e "tentar novamente" só do instalador |
| `callBitrixIdempotent`, `ensure-event-bindings`, `ensure-placement-bindings` | Continuam no app (copiar do hub-core), agora com o token da plataforma |

### Eventos

O hub-core não emite eventos: cada módulo lê o banco/SPA direto. Na plataforma o app
recebe webhooks assinados — `installation.*` e `subscription.*`/`purchase.*`/`charge.*`
(ver `docs/apps-integration.md`). O que o ThinkZap hoje decide no
`handle-gateway-webhook-event.ts` (ativar linha, bloquear em `past_due`) passa a reagir a
`subscription.activated`, `subscription.past_due`, `subscription.recovered`,
`subscription.ended`, `subscription.item_changed`.

Metadados Stripe: hub-core `{domainId, appCode, planId, intent: convert|add-line}` →
plataforma `{appCode, installationId, planId, intent: subscribe|purchase}`.

## 2. Importação sem reinstalação (18.2)

Script: `scripts/import-hub-core.ts` (dry-run por padrão; `--apply` para gravar).

1. **Pré-requisitos**
   - `spa_id` preenchido em todos os `core_apps` do app (`backfill:aplication-spa-id` no
     hub-core). Instalação sem espelho é listada e pulada.
   - Campos novos criados nos SPAs (task 17.1). Itens existentes do 1060/1142/1146 **sem
     Ambiente contam como `production`** — nada a preencher para clientes reais.
   - App cadastrado na plataforma **com o mesmo `client_id`** do app Bitrix em uso (a
     importação só serve para o app Bitrix que os clientes já instalaram).
2. **Congelar a renovação no hub-core** para o app (desligar o `credential-refresh.job`
   para o `app_code_id` ou pôr o hub-core em modo leitura para ele). Duas renovações de
   lados diferentes derrubam a credencial: o refresh token é rotacionado.
3. `yarn tsx scripts/import-hub-core.ts --app=<appCode> --hub-core-url=mysql://…` →
   conferir o relatório (importadas, puladas sem SPA, desinstaladas).
4. `--apply`. Tokens decifrados com `HUB_CORE_TOKEN_ENCRYPTION_KEY` (ou lidos em texto
   puro, o legado) e gravados com a chave da plataforma. `trial_used = true` e
   `ever_activated = true`: cliente existente não ganha trial novo e a próxima instalação
   é reinstalação. Nenhum evento é emitido.
5. A partir daqui só a plataforma renova (job de 10 min). Conferir no
   `/metrics` (`platform_token_refresh_failures_total`) e em `AUTH_ERROR`.
6. **`application_token`**: o hub-core nunca guardou. Até o próximo `ONAPPINSTALL`, a
   plataforma aceita `ONAPPUNINSTALL` dessas instalações só se o portal já recusar o
   token delas (o Bitrix revoga os tokens na desinstalação) — evento forjado com o app
   instalado é recusado. Isso exige o `event.bind` de `ONAPPUNINSTALL` apontando para a
   plataforma, feito no corte (18.3, passo 4).

## 3. Plano de corte por app (18.3)

1. **Repositório novo do app** com o instalador (`POST /platform/installer`), o receptor
   de eventos (`POST /platform/events`), o cliente de tokens e a validação do JWT
   (SDK em `sdk/typescript`). O app mantém sua política de acesso.
2. **Cadastro** na plataforma (staging primeiro): `POST /admin/apps` com o `client_id`/
   secret do app Bitrix atual, escopos, `installerUrl`, `webhookUrl`, produtos, trial e
   `trial_on_install` (desligado para apps com base instalada, se não houver trial na
   instalação hoje). Origem do frontend em `SESSION_CORS_ORIGINS`.
3. **Importação** (seção 2).
4. **Troca da URL de instalação** no app Bitrix (marketplace/local) para
   `https://<plataforma>/install/<appCode>` e do handler de eventos de instalação para
   `https://<plataforma>/bitrix/events/<appCode>`. Rodar, para cada instalação importada, o
   `event.bind` de `ONAPPUNINSTALL` para a plataforma (o instalador do app pode fazer isso
   na primeira chamada, ou um script com `GET /v1/installations/{id}/token`).
5. **Stripe**: o endpoint da plataforma já existe (um só para todos os apps). Backfill dos
   metadados das assinaturas ativas do app: `installationId` (= `core_apps.spa_id`) e
   `intent: subscribe` em `subscription.metadata`, mantendo `appCode`. Até o backfill, a
   plataforma roteia pelo item do SPA 1142 (`ufCrm91GatewayId`) — que já existe para
   assinaturas ativas.
6. **Filtro por `appCode`**: no hub-core, o webhook Stripe passa a ignorar (200) o
   `appCode` migrado; a plataforma passa a processá-lo por estar cadastrado e ativo.
   Durante a janela, o hub-core ainda recebe os eventos do app no endpoint dele e **não**
   deve agir.
7. **Frontend do app** troca o login (`/api/auth`) por `POST /v1/sessions` e o backend
   passa a validar o JWT pelo JWKS.
8. **Validação em staging** (roteiro da task 17.5 aplicado ao app), depois produção.
9. **Desligar no hub-core**: rotas do módulo, installer do `setup-app-installers.ts`,
   renovação das credenciais do app e o módulo em si.

Rollback por app: reativar o módulo no hub-core e a URL de instalação antiga. Os tokens
no hub-core podem ter sido rotacionados pela plataforma — por isso o passo 2 congela e o
rollback exige reimportar na direção inversa (ou reinstalação) para as instalações que a
plataforma renovou.

## 4. Correções de segurança na migração (18.4)

Checklist por app. Na plataforma todas já estão implementadas; o app migrado só não pode
reintroduzi-las.

- [ ] **Admin verificado no servidor**: nada de `isBitrixAdmin` do payload
      (`resolve-bitrix-user-at-login.ts:83`). O app usa `isAdmin` do JWT da plataforma
      (vem de `user.admin`).
- [ ] **JWT com expiração e segredo obrigatório**: fim do HS256 sem `expiresIn` com
      segredo `''` (`jwt-token-generator.ts:10-11`, `middleware/auth.ts:33`). JWT RS256 de
      15 min; o app valida pelo JWKS; sem chave ativa a plataforma não sobe.
- [ ] **Instalação verificada no servidor**: `POST /api/auth/install` público removido; a
      plataforma confere `app.info`, `profile` (admin) e troca o refresh token com o
      `client_secret` (prova do `client_id` e do `member_id`).
- [ ] **`application_token` guardado e validado**: capturado no `ONAPPINSTALL`
      (verificado), comparado em tempo constante no `ONAPPUNINSTALL`. Eventos do Bitrix que
      o app recebe devem ser validados com o `applicationToken` de
      `GET /v1/installations/{id}`.
- [ ] **Tokens cifrados**: `credential` com AES-256-GCM `v1:`; o app não guarda refresh
      token nenhum.
- [ ] **Renovação única com lock**: o app **não** chama `oauth.bitrix.info`; usa
      `/token/refresh` com o token recusado.
- [ ] **Desinstalação tratada**: `installation.removed` no app (parar filas, bots,
      cobranças internas); a assinatura Stripe não é cancelada.
- [ ] **Um único cliente Bitrix**: `BitrixClient`, `BitrixRestClient` e
      `makeBitrixClient*` substituídos por um cliente só (na plataforma,
      `src/shared/bitrix/bitrix-rest.client.ts`; no app, um cliente sobre o token da
      plataforma).
