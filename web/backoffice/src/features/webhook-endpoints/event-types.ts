import type { Schemas } from '@/api/client'

export type EventType =
  Schemas['CreateWebhookEndpointRequest']['eventTypes'][number]

/** Tipos de evento oferecidos no formulário, agrupados como o operador pensa neles. */
export const EVENT_GROUPS = [
  {
    title: 'Instalação',
    types: [
      'installation.created',
      'installation.reinstalled',
      'installation.removed',
      'installation.auth_error',
      'installation.auth_restored',
    ],
  },
  {
    title: 'Assinatura',
    types: [
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
    ],
  },
  {
    title: 'Compra e estorno',
    types: ['purchase.paid', 'charge.refunded', 'charge.disputed'],
  },
] as const satisfies ReadonlyArray<{ title: string; types: EventType[] }>

type Offered = (typeof EVENT_GROUPS)[number]['types'][number]

// Falha de compilação se o contrato ganhar um tipo de evento que o formulário não oferece.
const _allTypesOffered: Exclude<EventType, Offered> extends never
  ? true
  : never = true
void _allTypesOffered

/** Ordem do catálogo: o corpo enviado não depende da ordem dos cliques. */
export const EVENT_TYPE_ORDER: readonly EventType[] = EVENT_GROUPS.flatMap(
  group => group.types,
)

export const inCatalogOrder = (selected: Iterable<EventType>): EventType[] => {
  const set = new Set(selected)
  return EVENT_TYPE_ORDER.filter(type => set.has(type))
}

export const typesLabel = (count: number) =>
  `${count} ${count === 1 ? 'tipo' : 'tipos'}`
