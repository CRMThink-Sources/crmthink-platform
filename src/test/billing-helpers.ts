import type {
  GatewayEvent,
  GatewaySubscriptionState,
} from '@/modules/billing/ports/payment-gateway'
import { http } from './app'
import { GPTMAKER, installPayload, seedGptMaker, type Harness } from './harness'

let seq = 0

/** Entrega um evento Stripe pelo endpoint real e processa a fila como o worker. */
export async function stripeEvent(
  h: Harness,
  event: GatewayEvent,
  id = `evt_${++seq}`,
) {
  h.gateway.nextEvent = { id, name: event.type, event }
  h.gateway.normalized.set(id, event)
  const res = await http(h)
    .post('/webhooks/stripe')
    .set('Stripe-Signature', 'valid')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ id }))
  const job = h.queue.jobs.find(
    j => (j.data as { eventId?: string }).eventId === id,
  )
  if (job) await h.container.stripeProcessor.process(id)
  return { res, id }
}

export async function installedGptMaker(
  h: Harness,
  overrides: Record<string, unknown> = {},
) {
  const { credentials } = await seedGptMaker(h, overrides)
  const res = await http(h).post('/v1/install').send(installPayload(h))
  return {
    apiKey: credentials.apiKey,
    installationId: res.body.installationId as number,
  }
}

export function stripeSubscription(
  h: Harness,
  overrides: Partial<GatewaySubscriptionState> & {
    id: string
    installationId: number
  },
): GatewaySubscriptionState {
  const { installationId, ...rest } = overrides
  const start = h.clock.now()
  const state: GatewaySubscriptionState = {
    customerId: 'cus_1',
    status: 'active',
    rawStatus: 'active',
    periodStart: start,
    periodEnd: new Date(start.getTime() + 30 * 86_400_000),
    cancelAtPeriodEnd: false,
    items: [{ itemId: 'si_1', priceId: 'price_basic', quantity: 1 }],
    metadata: {
      appCode: GPTMAKER,
      installationId,
      planId: 501,
      intent: 'subscribe',
    },
    ...rest,
  }
  h.gateway.subscriptions.set(state.id, state)
  return state
}

export function spaSubscriptions(h: Harness) {
  return [...(h.crm.items.get(1142)?.values() ?? [])]
}
