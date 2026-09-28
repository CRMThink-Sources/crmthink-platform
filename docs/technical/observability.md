# Observabilidade

Código: `src/shared/observability/logger.ts`, `log-context.ts`, `metrics.ts`, `alert.ts`,
`src/health.ts`, `ops/prometheus-alerts.yml`.

## Logs

- **pino**, JSON, uma linha por evento. Nível por `LOG_LEVEL`. Com `LOKI_URL`, envio em lote ao
  Loki (`pino-loki`, a cada 5 s) com labels `service` (`crmthink-platform-api` ou `-worker`),
  `env` (`PLATFORM_ENVIRONMENT`) e `appCode`.
- **Contexto automático** (`AsyncLocalStorage`): `requestId` em toda requisição; `appCode`,
  `installationId`, `subscriptionId` e `eventId` quando o serviço os conhece. Buscar por
  `installationId` traz instalação, tokens, cobrança e entrega de eventos daquela instalação.
- **Linha `request`** por resposta: método, caminho, status, `durationMs`, `requestId`. O
  `X-Request-Id` volta ao cliente — é o que o app deve informar ao reportar problema.
- **Segredos censurados** por caminho e em mensagens de erro (ver [security.md](security.md#o-que-nunca-vai-para-o-log)).

## Alertas operacionais no log

`raiseAlert(kind, detalhe, mensagem)` escreve uma linha `warn` com `alert=<kind>` e incrementa
`platform_operational_alerts_total{kind}`. Tipos:

| `kind` | Quando |
| --- | --- |
| `install.scopes_missing` | Escopos do app Bitrix diferentes do cadastro |
| `install.token_mismatch` | Instalação recusada na verificação do token |
| `token.auth_error` | Instalação entrou em `AUTH_ERROR` |
| `event.dead_letter` | Evento esgotou a janela de reenvio |
| `stripe.dead_letter` | Evento Stripe esgotou as tentativas |
| `stripe.event_unrouted` | Evento Stripe sem app/instalação identificável |
| `charge.disputed` | Disputa aberta |
| `charge.unknown_origin` | Reembolso/disputa sem compra ou fatura conhecida |
| `plan.misconfigured` | Plano pago sem *price id* no ambiente |
| `spa.invalid_item` | Item de SPA com campos inválidos |
| `sweep.divergence` / `sweep.failed` | Varredura corrigiu divergência / falhou |
| `subscription.orphan_created` | Assinatura criada sem vínculo esperado |

## Métricas (Prometheus)

`GET /metrics` na `api` e no `worker` (mesma `PORT`). Além das métricas padrão do Node
(`collectDefaultMetrics`):

| Métrica | Tipo | Labels | Significado |
| --- | --- | --- | --- |
| `platform_installations_pending` | gauge | — | Instalações em `INSTALL_PENDING` |
| `platform_installations_auth_error` | gauge | — | Instalações em `AUTH_ERROR` |
| `platform_token_refreshes_total` | counter | `appCode`, `trigger` | Renovações bem-sucedidas (`on-demand`, `job`, `delivery`) |
| `platform_token_refresh_failures_total` | counter | `appCode` | Falhas de renovação |
| `platform_token_api_duration_seconds` | histogram | `route` (`get`, `refresh`) | Latência da API de tokens |
| `platform_events_pending` | gauge | — | Eventos no outbox não entregues |
| `platform_events_dead` | gauge | — | Eventos em dead-letter |
| `platform_event_deliveries_total` | counter | `appCode`, `outcome` | Tentativas de entrega |
| `platform_sweep_divergences_total` | counter | `kind` | Divergências corrigidas |
| `platform_sweep_failures_total` | counter | `kind` | Varreduras que falharam |
| `platform_stripe_webhook_failures_total` | counter | `reason` (`signature`, `dead_letter`) | Webhooks Stripe recusados ou mortos |
| `platform_operational_alerts_total` | counter | `kind` | Alertas operacionais |

Os gauges são atualizados pelo agendamento `gauges` do worker (60 s).

## Alertas (`ops/prometheus-alerts.yml`)

| Alerta | Condição | Severidade |
| --- | --- | --- |
| `PlatformDown` | `api` ou `worker` fora por 2 min | critical |
| `TokenApiSlow` | p95 da API de tokens > 1 s por 10 min | warning |
| `TokenRefreshFailures` | > 5 falhas de renovação em 15 min por app | warning |
| `InstallationsAuthError` | Instalação entrou em `AUTH_ERROR` na última hora | warning |
| `InstallationsPending` | Instalação em `INSTALL_PENDING` por 30 min | warning |
| `EventsDeadLetter` | Qualquer evento em dead-letter | critical |
| `EventsBacklog` | > 200 eventos pendentes por 15 min | warning |
| `StripeWebhookFailures` | > 3 falhas em 15 min por motivo | critical |
| `SweepFailed` | Varredura falhou nas últimas 2 h | warning |
| `SweepDivergences` | > 10 divergências em 6 h por tipo | warning |
| `ChargeDisputed` | Disputa aberta na última hora | warning |

Procedimentos operacionais: [`docs/operations/runbook.md`](../operations/runbook.md).

## Health checks

| Rota | Uso | Responde |
| --- | --- | --- |
| `GET /health` | *liveness* (processo responde) | Sempre `200 {status: ok}` |
| `GET /health/ready` | *readiness* (pode receber tráfego) | `200`/`503` com `checks`: `database` (`SELECT 1`), `redis` (`PING`), `signingKey` (há chave ativa), `spaConfig` (campos e enums dos SPAs existem no portal; revalidado a cada 10 min, com a lista de problemas por SPA e campo) |

O `worker` expõe só `/health` e `/metrics`.
