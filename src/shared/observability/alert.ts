import { logger } from './logger'
import { metrics } from './metrics'

/**
 * Alerta operacional: linha `warn` com `alert=<kind>` (o Loki/Grafana alerta por ela)
 * e contador Prometheus. Um ponto só para que todo alerta seja pesquisável igual.
 */
export type AlertKind =
  | 'install.scopes_missing'
  | 'install.token_mismatch'
  | 'event.dead_letter'
  | 'stripe.dead_letter'
  | 'stripe.event_unrouted'
  | 'charge.disputed'
  | 'charge.unknown_origin'
  | 'plan.misconfigured'
  | 'spa.invalid_item'
  | 'sweep.divergence'
  | 'sweep.failed'
  | 'subscription.orphan_created'
  | 'token.auth_error'

export function raiseAlert(
  kind: AlertKind,
  detail: Record<string, unknown>,
  message: string,
): void {
  metrics.operationalAlerts.inc({ kind })
  logger().warn({ alert: kind, ...detail }, message)
}
