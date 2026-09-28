import z from 'zod'
import type { EventEnvelope, EventType } from '@/modules/events/domain/event'
import { itemSchema } from './responses'

/**
 * Eventos entregues ao `webhookUrl` dos apps (seção `webhooks` do OpenAPI). As chaves
 * de `EVENT_DATA` precisam cobrir exatamente os tipos de `events/domain/event.ts` —
 * conferido em `openapi.test.ts`.
 */

const isoDate = z.string().datetime({ offset: true })

export const subscriptionRefSchema = z.strictObject({
  id: z.number().int(),
  status: z.enum([
    'trialing',
    'active',
    'past_due',
    'cancelled',
    'trial_expired',
  ]),
  modality: z.enum(['stripe', 'manual']),
  planId: z.number().int(),
  periodStart: isoDate,
  periodEnd: isoDate,
  version: z
    .number()
    .int()
    .describe('Ignore eventos com `version` menor que a última aplicada'),
})

const empty = z.strictObject({})
const chargeOrigin = {
  source: z.enum(['purchase', 'invoice']),
  purchaseId: z.number().int().optional().describe('Quando `source=purchase`'),
  invoiceId: z
    .string()
    .nullable()
    .optional()
    .describe('Quando `source=invoice`'),
}

type EventDoc = { summary: string; data: z.ZodType<Record<string, unknown>> }

export const EVENT_DATA: Record<EventType, EventDoc> = {
  'installation.created': {
    summary:
      'App instalado no portal pela primeira vez (`subscription: null`).',
    data: empty,
  },
  'installation.reinstalled': {
    summary: 'App reinstalado em portal que já tinha instalação.',
    data: empty,
  },
  'installation.removed': {
    summary:
      'App removido do portal (`ONAPPUNINSTALL` verificado). Tokens deixam de ser entregues.',
    data: empty,
  },
  'installation.auth_error': {
    summary:
      'Renovação do token falhou repetidamente; a instalação vai para `AUTH_ERROR` e precisa ser reinstalada.',
    data: z.strictObject({
      lastError: z.string(),
      failures: z.number().int(),
    }),
  },
  'installation.auth_restored': {
    summary: 'Reinstalação recuperou uma instalação em `AUTH_ERROR`.',
    data: empty,
  },
  'subscription.trial_started': {
    summary: 'Trial iniciado (na instalação ou manualmente pelo operador).',
    data: z.strictObject({ trialEndsAt: isoDate, trialDays: z.number().int() }),
  },
  'subscription.activated': {
    summary:
      'Assinatura paga ativa (checkout concluído ou manual marcada ativa).',
    data: z.strictObject({
      previousSubscriptionId: z
        .number()
        .int()
        .nullable()
        .describe('Trial encerrado pela ativação, se havia'),
    }),
  },
  'subscription.renewed': {
    summary: 'Novo período pago.',
    data: z.strictObject({
      invoiceId: z.string().nullable().describe('`null` em assinatura manual'),
      previousPeriodEnd: isoDate,
    }),
  },
  'subscription.plan_changed': {
    summary: 'Plano trocado (upgrade imediato ou downgrade no próximo ciclo).',
    data: z.strictObject({
      previousPlanId: z.number().int(),
      planId: z.number().int(),
      effective: z.enum(['immediate', 'next_period']),
      remainingFraction: z
        .number()
        .optional()
        .describe(
          'Só em `immediate`: fração do período cobrada proporcionalmente',
        ),
    }),
  },
  'subscription.past_due': {
    summary:
      'Pagamento da renovação falhou; carência e corte são decisão do app.',
    data: z.strictObject({
      invoiceId: z.string().nullable(),
      hostedInvoiceUrl: z
        .string()
        .nullable()
        .describe('Link da fatura para o cliente pagar'),
    }),
  },
  'subscription.recovered': {
    summary: 'Pagamento em atraso regularizado.',
    data: empty,
  },
  'subscription.cancel_scheduled': {
    summary: 'Cancelamento agendado para o fim do período.',
    data: z.strictObject({ effectiveAt: isoDate }),
  },
  'subscription.ended': {
    summary: 'Assinatura encerrada.',
    data: z.strictObject({
      reason: z.enum(['cancelled', 'trial_expired', 'deleted']),
    }),
  },
  'subscription.period_ending': {
    summary:
      'Aviso de fim de período de assinatura `manual` (3, 2 e 1 dia antes).',
    data: z.strictObject({
      daysLeft: z.union([z.literal(3), z.literal(2), z.literal(1)]),
      periodEnd: isoDate,
    }),
  },
  'subscription.item_changed': {
    summary:
      'Item alterado por uma pessoa no SPA 1146 (alterações via API não geram evento).',
    data: z.strictObject({
      change: z.enum(['created', 'updated', 'removed']),
      item: itemSchema,
    }),
  },
  'purchase.paid': {
    summary: 'Compra avulsa paga.',
    data: z.strictObject({
      purchaseId: z.number().int(),
      planId: z.number().int(),
      quantity: z.number().int(),
      chargeId: z.string().nullable(),
      amount: z.number().int().describe('Centavos cobrados'),
    }),
  },
  'charge.refunded': {
    summary: 'Cobrança reembolsada (total ou parcial).',
    data: z.strictObject({
      chargeId: z.string(),
      ...chargeOrigin,
      amountRefunded: z.number().int().describe('Centavos reembolsados'),
      amount: z.number().int().describe('Centavos da cobrança'),
    }),
  },
  'charge.disputed': {
    summary: 'Cliente abriu disputa (chargeback) no cartão.',
    data: z.strictObject({
      chargeId: z.string(),
      disputeId: z.string(),
      ...chargeOrigin,
      amount: z.number().int(),
      reason: z.string(),
    }),
  },
}

export const eventEnvelopeSchema = (
  type: EventType,
  data: z.ZodType<Record<string, unknown>>,
) =>
  z.strictObject({
    eventId: z.string().uuid().describe('Deduplique por este id'),
    type: z.literal(type),
    appCode: z.string(),
    installationId: z.number().int(),
    memberId: z.string(),
    occurredAt: isoDate,
    subscription: type.startsWith('installation.')
      ? z.null()
      : subscriptionRefSchema.nullable(),
    data,
  }) satisfies z.ZodType<EventEnvelope>

export const installerPayloadSchema = z.strictObject({
  installationId: z.number().int(),
  memberId: z.string(),
  domain: z.string(),
  appCode: z.string(),
  isReinstall: z.boolean(),
})

export const SIGNATURE_DESCRIPTION =
  '`t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir.'
