import client from 'prom-client'

/**
 * Métricas Prometheus (`GET /metrics`). Os alertas de operação (task 16.4) são
 * definidos sobre estas séries — ver `docs/operations/alerts.md`.
 */
export const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry })

export const metrics = {
  installationsPending: new client.Gauge({
    name: 'platform_installations_pending',
    help: 'Instalações em INSTALL_PENDING',
    registers: [registry],
  }),
  installationsAuthError: new client.Gauge({
    name: 'platform_installations_auth_error',
    help: 'Instalações em AUTH_ERROR',
    registers: [registry],
  }),
  tokenRefreshFailures: new client.Counter({
    name: 'platform_token_refresh_failures_total',
    help: 'Falhas de renovação de token do Bitrix',
    labelNames: ['appCode'],
    registers: [registry],
  }),
  tokenRefreshes: new client.Counter({
    name: 'platform_token_refreshes_total',
    help: 'Renovações de token do Bitrix bem-sucedidas',
    labelNames: ['appCode', 'trigger'],
    registers: [registry],
  }),
  tokenApiLatency: new client.Histogram({
    name: 'platform_token_api_duration_seconds',
    help: 'Latência da API de tokens',
    labelNames: ['route'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  }),
  eventsPending: new client.Gauge({
    name: 'platform_events_pending',
    help: 'Eventos no outbox ainda não entregues',
    registers: [registry],
  }),
  eventsDead: new client.Gauge({
    name: 'platform_events_dead',
    help: 'Eventos em dead-letter',
    registers: [registry],
  }),
  eventDeliveries: new client.Counter({
    name: 'platform_event_deliveries_total',
    help: 'Tentativas de entrega de eventos aos apps',
    labelNames: ['appCode', 'outcome'],
    registers: [registry],
  }),
  sweepDivergences: new client.Counter({
    name: 'platform_sweep_divergences_total',
    help: 'Divergências corrigidas pelas varreduras',
    labelNames: ['kind'],
    registers: [registry],
  }),
  sweepFailures: new client.Counter({
    name: 'platform_sweep_failures_total',
    help: 'Varreduras que falharam',
    labelNames: ['kind'],
    registers: [registry],
  }),
  stripeWebhookFailures: new client.Counter({
    name: 'platform_stripe_webhook_failures_total',
    help: 'Webhooks Stripe recusados ou com falha de processamento',
    labelNames: ['reason'],
    registers: [registry],
  }),
  adminLoginFailures: new client.Counter({
    name: 'platform_admin_login_failures_total',
    help: 'Falhas de login no backoffice (inclui bloqueios e limite por IP)',
    labelNames: ['reason'],
    registers: [registry],
  }),
  adminAuditWriteFailures: new client.Counter({
    name: 'admin_audit_write_failures_total',
    help: 'Registros de auditoria do backoffice que não foram gravados',
    registers: [registry],
  }),
  operationalAlerts: new client.Counter({
    name: 'platform_operational_alerts_total',
    help: 'Alertas operacionais registrados',
    labelNames: ['kind'],
    registers: [registry],
  }),
}
