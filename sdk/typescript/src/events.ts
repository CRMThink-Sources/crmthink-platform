import type { PlatformEvent } from './types.js'

/**
 * Regras de consumo: deduplicar por `eventId` e ignorar evento de assinatura com
 * `version` menor que a última aplicada. Devolve `true` se o evento deve ser aplicado.
 */
export function shouldApply(
  event: Pick<PlatformEvent, 'eventId' | 'subscription'>,
  state: {
    seen(eventId: string): boolean
    lastVersion(subscriptionId: number): number | null
  },
): boolean {
  if (state.seen(event.eventId)) return false
  if (!event.subscription) return true
  const last = state.lastVersion(event.subscription.id)
  return last === null || event.subscription.version > last
}
