/**
 * Contrato de eventos para as aplicações (ver `openspec/.../event-delivery`).
 */

export const INSTALLATION_EVENT_TYPES = [
  'installation.created',
  'installation.reinstalled',
  'installation.removed',
  'installation.auth_error',
  'installation.auth_restored',
] as const

export const BILLING_EVENT_TYPES = [
  'subscription.trial_started',
  'subscription.activated',
  'subscription.renewed',
  'subscription.plan_changed',
  'subscription.past_due',
  'subscription.recovered',
  'subscription.cancel_scheduled',
  'subscription.ended',
  'subscription.period_ending',
  'subscription.item_changed',
  'purchase.paid',
  'charge.refunded',
  'charge.disputed',
] as const

export type InstallationEventType = (typeof INSTALLATION_EVENT_TYPES)[number]
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number]
export type EventType = InstallationEventType | BillingEventType

export type SubscriptionStatus =
  'trialing' | 'active' | 'past_due' | 'cancelled' | 'trial_expired'

export type SubscriptionModality = 'stripe' | 'manual'

/** Estado da assinatura no envelope. `version` cresce a cada decisão sobre ela. */
export type SubscriptionRef = {
  id: number
  status: SubscriptionStatus
  modality: SubscriptionModality
  planId: number
  periodStart: string
  periodEnd: string
  version: number
}

export type EventEnvelope = {
  eventId: string
  type: EventType
  appCode: string
  installationId: number
  memberId: string
  occurredAt: string
  subscription: SubscriptionRef | null
  data: Record<string, unknown>
}
