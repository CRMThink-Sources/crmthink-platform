/**
 * Nomes curtos para os tipos do contrato (`docs/api/openapi.json`). Nada aqui é escrito
 * à mão: mudou o contrato, rode `yarn sdk:types`.
 */
import type {
  components,
  operations,
  paths,
  webhooks,
} from './generated/openapi.js'

export type { components, operations, paths, webhooks }

type Schemas = components['schemas']

export type PlatformErrorBody = Schemas['Error']
export type PlatformToken = Schemas['Token']
export type Installation = Schemas['Installation']
export type InstallationList = Schemas['InstallationList']
export type InstallerPayload = Schemas['InstallerPayload']
export type PlanList = Schemas['PlanList']
export type Plan = PlanList['items'][number]
export type CurrentSubscription = Schemas['CurrentSubscription']
export type CheckoutRequest = Schemas['CheckoutRequest']
export type CheckoutSession = Schemas['CheckoutSession']
export type BillingPortalRequest = Schemas['BillingPortalRequest']
export type BillingPortalSession = Schemas['BillingPortalSession']
export type ChangePlanRequest = Schemas['ChangePlanRequest']
export type ChangePlanResult = Schemas['ChangePlanResult']
export type SubscriptionItem = Schemas['SubscriptionItem']
export type SubscriptionItemList = Schemas['SubscriptionItemList']
export type CreateItemRequest = Schemas['CreateItemRequest']
export type UpdateItemRequest = Schemas['UpdateItemRequest']

/** Tipos de evento enviados ao `webhookUrl` do app (o `installer` é outra chamada). */
export type PlatformEventType = Exclude<keyof webhooks, 'installer'>

type WebhookBody<K extends keyof webhooks> = webhooks[K] extends {
  post: { requestBody: { content: { 'application/json': infer Body } } }
}
  ? Body
  : never

/** Envelope de evento, discriminado por `type`: `data` tem o formato de cada tipo. */
export type PlatformEvent = {
  [K in PlatformEventType]: WebhookBody<K>
}[PlatformEventType]

/** Evento de um tipo específico: `PlatformEventOf<'subscription.renewed'>`. */
export type PlatformEventOf<K extends PlatformEventType> = Extract<
  PlatformEvent,
  { type: K }
>

export type PlatformSubscription = NonNullable<PlatformEvent['subscription']>
