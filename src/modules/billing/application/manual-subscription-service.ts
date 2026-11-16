import z from 'zod'
import type { PlatformEnvironment } from '@/config/env'
import type { Clock } from '@/shared/clock'
import {
  badRequest,
  conflict,
  HttpError,
  notFound,
  unprocessable,
  upstream,
} from '@/shared/http/errors'
import { logger } from '@/shared/observability/logger'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { Subscription } from '../domain/entities'
import type { CatalogRepository } from '../infra/spa/catalog-repository'
import {
  endOfCalendarDay,
  formatCalendarDate,
  parseSpaCalendarDate,
  startOfCalendarDay,
} from '../infra/spa/spa-calendar-date'
import type { BillingContext } from './billing-context'
import type { SubscriptionWriter } from './subscription-writer'

/** Fim máximo do período: meses depois do início. */
const MAX_MONTHS = 24

export const createManualSubscriptionSchema = z
  .strictObject({
    planId: z.number().int().positive().describe('Id do plano no SPA'),
    kind: z
      .enum(['manual', 'bonus'])
      .describe('`manual` (boleto, contrato) ou `bonus` (bonificação)'),
    periodStart: z.iso
      .date()
      .optional()
      .describe('Início (AAAA-MM-DD); padrão: hoje'),
    periodEnd: z.iso.date().describe('Fim do período (AAAA-MM-DD)'),
    approvedBy: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Quem autorizou; obrigatório na bonificação'),
  })
  .refine(body => body.kind !== 'bonus' || !!body.approvedBy, {
    message: 'Informe o responsável pela bonificação',
    path: ['approvedBy'],
  })

export type CreateManualSubscription = z.infer<
  typeof createManualSubscriptionSchema
>

export type ManualSubscriptionWho = { actor: string; reason: string }

type Deps = {
  context: BillingContext
  writer: SubscriptionWriter
  registry: AppRegistry
  catalog: CatalogRepository
  clock: Clock
  environment: PlatformEnvironment
}

/** `date` + `months` meses, no mesmo dia (ou no último dia do mês, se não existir). */
function addMonths(date: Date, months: number): Date {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  )
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return target
}

/**
 * Criação, pelo operador, de assinatura `manual` (boleto, contrato) ou bonificação.
 *
 * Grava no SPA 1142 como a ativação Stripe: cria sem evento, relê para conferir e só
 * então emite `subscription.activated`, de modo que item divergente nunca vira evento.
 * Uma assinatura vigente por instalação; trial em andamento é substituído.
 */
export class ManualSubscriptionService {
  constructor(private readonly deps: Deps) {}

  async create(
    installationId: number,
    input: CreateManualSubscription,
    who: ManualSubscriptionWho,
  ): Promise<Subscription> {
    const { context, writer, registry, catalog, clock } = this.deps
    if (this.deps.environment !== 'production') {
      throw conflict(
        'SUBSCRIPTIONS_READ_ONLY',
        'Assinaturas só são criadas no ambiente de produção',
      )
    }

    const installation = await context.installations.get(installationId)
    if (!installation || installation.spaItemId === null)
      throw notFound('INSTALLATION_NOT_FOUND')
    if (installation.status !== 'ACTIVE') {
      throw conflict(
        'INSTALLATION_NOT_ACTIVE',
        `Instalação em ${installation.status}`,
      )
    }
    const spaItemId = installation.spaItemId

    const app = await registry.getOrThrow(installation.appCode)
    const plan = await catalog.getPlan(input.planId)
    if (!plan || !app.productSpaIds.includes(plan.productId))
      throw notFound('PLAN_NOT_FOUND')
    const product = await catalog.getProduct(plan.productId)
    if (!plan.active || !product?.active) throw unprocessable('PLAN_INACTIVE')
    if (plan.type !== 'subscription' || plan.isTrial) {
      throw badRequest(
        'PLAN_TYPE_MISMATCH',
        'Só plano pago de assinatura pode ser usado (não trial nem compra única)',
      )
    }

    const { periodStart, periodEnd } = this.period(input)
    const isBonus = input.kind === 'bonus'

    return context.withInstallationLock(
      installation.installationId,
      async () => {
        const current = await context.subscriptions.currentOf(spaItemId)
        if (
          current &&
          (current.status === 'active' || current.status === 'past_due')
        ) {
          throw new HttpError(
            409,
            'SUBSCRIPTION_ALREADY_EXISTS',
            'A instalação já tem assinatura vigente',
            {
              subscriptionId: current.id,
              modality: current.modality,
              status: current.status,
            },
          )
        }
        const trials = (
          await context.subscriptions.listByInstallation(spaItemId)
        ).filter(s => s.status === 'trialing')
        const previousSubscriptionId = trials[0]?.id ?? null

        const write = {
          title: isBonus
            ? `Bonificação — ${plan.name} — ${installation.domain}`
            : `${app.name} — ${installation.domain}`,
          installationSpaItemId: spaItemId,
          planId: plan.id,
          status: 'active' as const,
          modality: 'manual' as const,
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: false,
        }
        const created = await writer.create(installation, write, [])
        await this.confirm(created.id, write)

        const subscription = await writer.update(installation, created, {}, [
          {
            type: 'subscription.activated',
            data: { previousSubscriptionId },
            dedupeKey: `activated:${created.id}`,
          },
        ])
        for (const trial of trials) {
          await writer.update(
            installation,
            trial,
            { status: 'cancelled', canceledAt: clock.now() },
            [],
          )
        }
        await this.comment(subscription.id, input, who)
        return subscription
      },
    )
  }

  /** Início (padrão: hoje) e fim como dias de calendário; fim depois do início e até 24 meses. */
  private period(input: CreateManualSubscription): {
    periodStart: Date
    periodEnd: Date
  } {
    const invalid = (message: string) =>
      unprocessable('INVALID_PERIOD', message)
    const startDay = input.periodStart
      ? parseSpaCalendarDate(input.periodStart)
      : parseSpaCalendarDate(this.deps.clock.now())
    const endDay = parseSpaCalendarDate(input.periodEnd)
    if (!startDay || !endDay) throw invalid('Data inválida')

    const periodStart = startOfCalendarDay(startDay)
    const periodEnd = endOfCalendarDay(endDay)
    if (periodEnd <= endOfCalendarDay(startDay))
      throw invalid('O fim do período deve ser depois do início')
    if (
      periodEnd >
      endOfCalendarDay(
        parseSpaCalendarDate(addMonths(periodStart, MAX_MONTHS))!,
      )
    )
      throw invalid(`O período pode ter no máximo ${MAX_MONTHS} meses`)
    return { periodStart, periodEnd }
  }

  /** Relê o item e confere o que foi pedido; divergência vira 502 sem evento. */
  private async confirm(
    id: number,
    expected: {
      planId: number
      status: Subscription['status']
      modality: Subscription['modality']
      periodStart: Date
      periodEnd: Date
    },
  ): Promise<void> {
    const found = await this.deps.context.subscriptions.get(id)
    const day = formatCalendarDate
    const lost = !found
      ? ['item']
      : [
          found.planId !== expected.planId && 'plano',
          found.status !== expected.status && 'status',
          found.modality !== expected.modality && 'modalidade',
          day(found.periodStart) !== day(expected.periodStart) &&
            'início do período',
          day(found.periodEnd) !== day(expected.periodEnd) && 'fim do período',
        ].filter((x): x is string => typeof x === 'string')
    if (lost.length === 0) return
    throw upstream(
      'SUBSCRIPTION_WRITE_FAILED',
      `O Bitrix aceitou a criação, mas a releitura da assinatura #${id} não confere (${lost.join(', ')}). Nenhum evento foi enviado.`,
      { id, created: true, lost },
    )
  }

  /** Informativo: falha vai ao log e não desfaz a assinatura já criada. */
  private async comment(
    id: number,
    input: CreateManualSubscription,
    who: ManualSubscriptionWho,
  ): Promise<void> {
    const kind = input.kind === 'bonus' ? 'Bonificação' : 'Cobrança manual'
    const lines = [
      `${kind} criada pelo backoffice por ${who.actor}.`,
      `Motivo: ${who.reason}`,
      ...(input.approvedBy ? [`Responsável: ${input.approvedBy}`] : []),
    ]
    try {
      await this.deps.context.subscriptions.comment(id, lines.join('\n'))
    } catch (error) {
      logger().warn(
        { err: error, subscriptionId: id },
        'não foi possível gravar o comentário da assinatura manual',
      )
    }
  }
}
