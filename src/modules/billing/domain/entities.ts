import type { PlatformEnvironment } from '@/config/env'
import type {
  SubscriptionModality,
  SubscriptionStatus,
} from '@/modules/events/domain/event'

/**
 * Entidades dos SPAs de cobrança do portal CRMThink (fonte da verdade, D6).
 * Generalizadas de `modules/application/domain/entities/*` do hub-core, sem os tipos
 * do ThinkZap (`PlanProvider`, `ConnectorSettings`).
 */

export type { SubscriptionModality, SubscriptionStatus }

/** SPA 1134. */
export type Product = {
  id: number
  name: string
  /** Id de enum cru de `ufCrm87BillingModel`. */
  billingModel: string
  /** Derivado de `billingModel`: produto de compra única ⇒ planos `one_time`. */
  kind: 'subscription' | 'one_time'
  active: boolean
}

export type PlanInterval = 'monthly' | 'quarterly' | 'semiannual' | 'yearly'
export type PlanType = 'subscription' | 'one_time'

/** SPA 1138. */
export type Plan = {
  id: number
  productId: number
  name: string
  /** Centavos, como cadastrado no CRM. Não é o preço cobrado (esse vem do Stripe). */
  amount: number
  /** Obrigatório em `subscription`; ausente em `one_time`. */
  interval: PlanInterval | null
  type: PlanType
  /** Price id do Stripe **no ambiente em uso** (produção ou homologação). */
  gatewayPriceId: string | null
  /** Plano sem price em nenhum ambiente: é plano de trial (grátis por construção). */
  isTrial: boolean
  active: boolean
}

/** SPA 1142. Datas de período são dias de calendário ancorados em UTC (ver `spa-calendar-date.ts`). */
export type Subscription = {
  id: number
  title: string
  /** Item do SPA 1060 (parent). */
  installationSpaItemId: number
  planId: number
  status: SubscriptionStatus
  modality: SubscriptionModality
  periodStart: Date
  periodEnd: Date
  canceledAt: Date | null
  gatewaySubscriptionId: string | null
  cancelAtPeriodEnd: boolean
  environment: PlatformEnvironment
  versionMarker: string | null
}

export type SubscriptionItemStatus = 'active' | 'cancelled'

/** SPA 1146. */
export type SubscriptionItem = {
  id: number
  subscriptionId: number
  title: string
  status: SubscriptionItemStatus
  billable: boolean
  externalRef: string | null
  metadata: Record<string, unknown>
  gatewayItemId: string | null
  environment: PlatformEnvironment
  deletedAt: Date | null
  deletedBy: string | null
  versionMarker: string | null
}

/** Assinatura ainda vigente (no máximo uma por instalação). */
export const isOpenSubscription = (
  subscription: Pick<Subscription, 'status'>,
): boolean =>
  subscription.status !== 'cancelled' && subscription.status !== 'trial_expired'

export const isPaidSubscription = (
  subscription: Pick<Subscription, 'status'>,
): boolean =>
  subscription.status === 'active' || subscription.status === 'past_due'
