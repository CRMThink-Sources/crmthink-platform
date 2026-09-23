# Operação do crmthink-platform

## Provisionamento (16.1)

Por ambiente (`staging` a partir de `develop`, `production` a partir de `main`):

1. **Banco**: MySQL 8 (mesma infra do hub-core), database própria
   (`crmthink_platform_staging` / `crmthink_platform`) e usuário com DDL (as migrações
   rodam no deploy).
2. **Redis**: instância/DB própria, `QUEUE_PREFIX` diferente por ambiente.
3. **Segredos** — gerar e guardar no cofre da equipe **antes** do primeiro deploy:
   - `TOKEN_ENCRYPTION_KEY`: `yarn admin:generate-encryption-key`. Perdê-la = perder todos
     os tokens (clientes reinstalam). Nunca reutilizar a do hub-core.
   - `JWT_SIGNING_PRIVATE_KEY`: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`.
     Só semeia a primeira chave; depois, rotação pela API.
   - `ADMIN_API_TOKENS`: `openssl rand -base64 32` (um por operador).
   - `STRIPE_SECRET_KEY` (staging: `sk_test_…`/`rk_test_…`; produção: `…_live_…`) e
     `STRIPE_WEBHOOK_SECRET` do endpoint criado no passo 4.
   - `CRMTHINK_WEBHOOK_URL` e `CRMTHINK_APPLICATION_TOKEN` (16.3).
4. **Endpoint Stripe da plataforma** (test mode em staging, live em produção):
   `https://<host>/webhooks/stripe` com os eventos `checkout.session.completed`,
   `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`,
   `charge.dispute.created`. O endpoint do hub-core continua existindo até cada app migrar.
   Customer Portal habilitado (cancelamento no fim do período, atualização de cartão).
5. **GitHub Environments** `staging` e `production`:
   - vars: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_DIR` (ex.: `~/crmthink-platform-staging`),
     `COMPOSE_PROJECT`, `API_PORT`, `WORKER_METRICS_PORT`;
   - secrets: `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KEY_PASSPHRASE`, `ENV_PLATFORM` (conteúdo do
     `.env`, a partir de `.env.example`).
6. Push em `develop` ⇒ CI ⇒ imagem `ghcr.io/<org>/crmthink-platform:<sha>` ⇒
   `prisma migrate deploy` ⇒ `docker compose -f docker-compose.deploy.yml up -d`.
7. Conferir `GET /health/ready` (banco, Redis, chave JWT e **configuração dos SPAs**: o
   relatório lista SPA e campo que faltam).

## Domínio e TLS (16.2)

Um host por ambiente (ex.: `platform-staging.crmthink.com.br`, `platform.crmthink.com.br`)
com TLS válido — o Bitrix24 recusa handler sem HTTPS. Proxy reverso na VPS para a porta
`API_PORT`. Precisam estar públicos: `/install/*`, `/v1/*`, `/.well-known/jwks.json`,
`/bitrix/*`, `/webhooks/stripe`, `/health`. **Não** expor: `/metrics` (só a rede do
Prometheus) e, de preferência, `/admin/*` (restringir por IP/VPN).

Exemplo (Caddy):

```
platform.crmthink.com.br {
  @internal path /metrics
  respond @internal 404
  reverse_proxy 127.0.0.1:4100
}
```

`PUBLIC_BASE_URL` = `https://<host>` (entra no `iss` do JWT e nos handlers registrados no
Bitrix: trocar depois exige reinstalação).

## Webhook de saída do portal CRMThink (16.3)

No portal CRMThink: Desenvolvedores → Outros → Webhook de saída.

- URL: `https://<host>/bitrix/spa-events`
- Eventos: `onCrmDynamicItemAdd`, `onCrmDynamicItemUpdate`, `onCrmDynamicItemDelete`
- O `application_token` gerado vai em `CRMTHINK_APPLICATION_TOKEN`.

Webhook de entrada (REST dos SPAs) com escopo `crm`: URL em `CRMTHINK_WEBHOOK_URL`.

O mesmo portal serve produção e homologação: cada instância só processa itens do próprio
Ambiente (item sem Ambiente = produção).

## Monitoramento e alertas (16.4)

- Prometheus: scrape `api:4100/metrics` e `worker:9464/metrics`; regras em
  `ops/prometheus-alerts.yml` (plataforma fora, API de tokens lenta, falhas de renovação,
  `AUTH_ERROR`, instalações pendentes, dead-letter, fila de eventos, webhook Stripe,
  varreduras).
- Loki: toda linha de alerta tem `alert=<tipo>` — ex.:
  `{service=~"crmthink-platform-.*"} | json | alert != ""`.
- **Monitoramento externo** (UptimeRobot/Better Stack) a cada 1 min em
  `GET https://<host>/health` e `GET https://<host>/.well-known/jwks.json`, com alerta
  imediato: a plataforma fora do ar por mais que a validade do token (~1h) quebra as
  chamadas dos apps ao Bitrix.

## Procedimentos

| Situação | Ação |
| --- | --- |
| Evento em dead-letter | `GET /admin/events?status=dead` → corrigir o app → `POST /admin/events/resend {"eventId"}` ou `{"appCode","from","to","onlyDead":true}` |
| Evento Stripe `dead` | `GET /admin/stripe-events?status=dead`; corrigir causa; `POST /admin/sweeps/stripe` reconcilia o SPA e emite o que faltou |
| Instalação `INSTALL_PENDING` | `GET /admin/installations/{id}/attempts` (erro do instalador); o admin do portal clica "tentar novamente" |
| Instalação `AUTH_ERROR` | O cliente reinstala o app (volta a `ACTIVE` e emite `installation.auth_restored`) |
| Rotação da chave do JWT | `POST /admin/signing-keys/rotate {"leadMinutes":10}` — publicada já, assina após 10 min |
| Rotação de credencial de app | `POST /admin/apps/{appCode}/rotate-api-key` ou `/rotate-webhook-secret` (24h de transição) |
| SPA divergente | `POST /admin/sweeps/spa` e `/admin/sweeps/stripe` |
| Rollback | redeploy da imagem anterior (`PLATFORM_IMAGE=…:<sha>`); outbox e tokens permanecem no banco |
