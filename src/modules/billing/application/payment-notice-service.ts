import z from 'zod'
import type { PlatformEnvironment } from '@/config/env'
import type { Clock } from '@/shared/clock'
import {
  conflict,
  HttpError,
  notFound,
  unprocessable,
} from '@/shared/http/errors'
import type { Db } from '@/shared/infra/prisma'
import { logger } from '@/shared/observability/logger'
import type { InstallationView } from '@/modules/installations/ports'
import type { Subscription } from '../domain/entities'
import type { CatalogRepository } from '../infra/spa/catalog-repository'
import {
  addCalendarMonths,
  endOfCalendarDay,
  formatCalendarDate,
  parseSpaCalendarDate,
  startOfCalendarDay,
  type CalendarDate,
} from '../infra/spa/spa-calendar-date'
import type { BillingContext } from './billing-context'
import type { PaymentIntegrationView } from './payment-integrations'
import type { SubscriptionWriter } from './subscription-writer'

/** O novo fim não pode passar de hoje + meses. */
const MAX_MONTHS = 24

const INTERVAL_MONTHS = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
} as const

export const paymentNoticeSchema = z
  .strictObject({
    externalId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        'Id do pagamento no sistema de origem (ex.: id do boleto). Único por integração: repetir é seguro, reaproveitar para outro pagamento não.',
      ),
    subscriptionId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Id da assinatura no SPA 1142'),
    installationId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Id da instalação: renova a assinatura vigente dela'),
    paidAt: z.iso.date().optional().describe('Data do pagamento (AAAA-MM-DD)'),
    periodEnd: z.iso
      .date()
      .optional()
      .describe(
        'Novo fim do período (AAAA-MM-DD); sem ele, vale o fim atual mais o intervalo do plano',
      ),
  })
  .refine(
    body =>
      (body.subscriptionId === undefined) !==
      (body.installationId === undefined),
    {
      message: 'Informe subscriptionId ou installationId (apenas um)',
      path: ['subscriptionId'],
    },
  )

export type PaymentNoticeInput = z.infer<typeof paymentNoticeSchema>

export type PaymentNoticeResult = {
  subscriptionId: number
  status: 'active'
  periodStart: Date
  periodEnd: Date
  /** `true` quando o aviso já tinha sido aplicado (nada foi escrito de novo). */
  duplicate: boolean
}

type Notice = {
  id: number
  externalId: string
  subscriptionSpaId: number
  installationId: number
  periodStart: Date
  periodEnd: Date
  paidAt: Date | null
  status: string
}

type Deps = {
  db: Db
  context: BillingContext
  writer: SubscriptionWriter
  catalog: CatalogRepository
  clock: Clock
  environment: PlatformEnvironment
}

const brDate = (date: Date) =>
  formatCalendarDate(date).split('-').reverse().join('/')

const calendar = (value: Date | string) =>
  parseSpaCalendarDate(value) as CalendarDate
const startOf = (value: Date | string) => startOfCalendarDay(calendar(value))
const endOf = (value: Date | string) => endOfCalendarDay(calendar(value))

/**
 * Aviso de pagamento de uma assinatura `manual` (boleto): renova pelo mesmo caminho e
 * com o mesmo evento da renovação feita à mão (`subscription.renewed`).
 *
 * Idempotente por `(integração, externalId)`. O período decidido é gravado em
 * `payment_notice` (`pending`) **antes** de escrever no SPA; se o processo cair no meio,
 * o reenvio conclui o período já gravado em vez de calcular outro a partir do fim já
 * estendido. Tudo sob o lock de cobrança da instalação.
 */
export class PaymentNoticeService {
  constructor(private readonly deps: Deps) {}

  async receive(
    integration: PaymentIntegrationView,
    input: PaymentNoticeInput,
  ): Promise<PaymentNoticeResult> {
    const { context } = this.deps
    if (this.deps.environment !== 'production') {
      throw conflict(
        'SUBSCRIPTIONS_READ_ONLY',
        'Avisos de pagamento só são aceitos no ambiente de produção',
      )
    }

    // Reenvio de aviso já aplicado responde sem exigir mais nada da assinatura.
    const known = await this.findNotice(integration.id, input.externalId)
    if (known) this.assertSameTarget(known, input)
    if (known?.status === 'applied') return this.resultOf(known, true)

    const installation = await this.resolveInstallation(known, input)
    return context.withInstallationLock(
      installation.installationId,
      async () => {
        // Relê sob o lock: um aviso simultâneo igual já pode ter registrado ou aplicado.
        const notice = await this.findNotice(integration.id, input.externalId)
        if (notice) {
          this.assertSameTarget(notice, input)
          if (notice.status === 'applied') return this.resultOf(notice, true)
          return this.apply(installation, integration, notice)
        }

        const subscription = await this.resolveSubscription(installation, input)
        if (subscription.modality !== 'manual') {
          throw unprocessable(
            'NOT_MANUAL_SUBSCRIPTION',
            'Só assinaturas manuais são renovadas por aviso de pagamento',
          )
        }
        if (
          subscription.status !== 'active' &&
          subscription.status !== 'past_due'
        ) {
          throw new HttpError(
            409,
            'SUBSCRIPTION_NOT_RENEWABLE',
            `Assinatura em ${subscription.status} não pode ser renovada por pagamento`,
            { subscriptionId: subscription.id, status: subscription.status },
          )
        }

        const { periodStart, periodEnd } = await this.decidePeriod(
          subscription,
          input,
        )
        const created = await this.deps.db.paymentNotice.create({
          data: {
            integrationId: integration.id,
            externalId: input.externalId,
            subscriptionSpaId: subscription.id,
            installationId: installation.installationId,
            periodStart,
            periodEnd,
            paidAt: input.paidAt ? startOf(input.paidAt) : null,
            status: 'pending',
          },
        })
        return this.apply(installation, integration, created)
      },
    )
  }

  private findNotice(
    integrationId: number,
    externalId: string,
  ): Promise<Notice | null> {
    return this.deps.db.paymentNotice.findUnique({
      where: { integrationId_externalId: { integrationId, externalId } },
    })
  }

  /** O mesmo `externalId` só vale para a assinatura (ou instalação) do primeiro aviso. */
  private assertSameTarget(notice: Notice, input: PaymentNoticeInput): void {
    const sameSubscription =
      input.subscriptionId === undefined ||
      input.subscriptionId === notice.subscriptionSpaId
    const sameInstallation =
      input.installationId === undefined ||
      input.installationId === notice.installationId
    if (!sameSubscription || !sameInstallation) {
      throw conflict(
        'EXTERNAL_ID_REUSED',
        'Este externalId já foi usado para outra assinatura: ele identifica um pagamento só',
      )
    }
  }

  private async resolveInstallation(
    known: Notice | null,
    input: PaymentNoticeInput,
  ): Promise<InstallationView> {
    const { context } = this.deps
    const installationId = known?.installationId ?? input.installationId
    if (installationId !== undefined) {
      const installation = await context.installations.get(installationId)
      if (!installation || installation.spaItemId === null)
        throw notFound('INSTALLATION_NOT_FOUND')
      return installation
    }
    const subscription = await context.subscriptions.get(
      input.subscriptionId as number,
    )
    if (!subscription) throw notFound('SUBSCRIPTION_NOT_FOUND')
    const installation = await context.installationOf(subscription)
    if (!installation) throw notFound('SUBSCRIPTION_NOT_FOUND')
    return installation
  }

  /** A assinatura relida sob o lock, dentro da instalação resolvida. */
  private async resolveSubscription(
    installation: InstallationView,
    input: PaymentNoticeInput,
  ): Promise<Subscription> {
    const { subscriptions } = this.deps.context
    const subscription =
      input.subscriptionId !== undefined
        ? await subscriptions.get(input.subscriptionId)
        : await subscriptions.currentOf(installation.spaItemId as number)
    if (
      !subscription ||
      subscription.installationSpaItemId !== installation.spaItemId
    )
      throw notFound('SUBSCRIPTION_NOT_FOUND')
    return subscription
  }

  /** Início = dia do fim atual; fim = informado ou fim atual + intervalo do plano. */
  private async decidePeriod(
    subscription: Subscription,
    input: PaymentNoticeInput,
  ): Promise<{ periodStart: Date; periodEnd: Date }> {
    const invalid = (message: string) =>
      unprocessable('INVALID_PERIOD', message)
    const currentEndDay = formatCalendarDate(subscription.periodEnd)
    const periodStart = startOf(currentEndDay)

    let endDay: Date
    if (input.periodEnd) {
      if (input.periodEnd <= currentEndDay)
        throw invalid('O novo fim deve ser depois do fim atual do período')
      endDay = startOf(input.periodEnd)
    } else {
      const plan = await this.deps.catalog.getPlan(subscription.planId)
      const months = plan?.interval ? INTERVAL_MONTHS[plan.interval] : null
      if (!months)
        throw invalid('O plano não tem intervalo: informe periodEnd no aviso')
      endDay = addCalendarMonths(periodStart, months)
    }

    const today = startOf(this.deps.clock.now())
    if (endDay > addCalendarMonths(today, MAX_MONTHS))
      throw invalid(
        `O novo fim pode ficar no máximo ${MAX_MONTHS} meses à frente`,
      )
    return {
      periodStart,
      periodEnd: endOf(endDay),
    }
  }

  /** Escreve o período já decidido no aviso (primeira vez ou reenvio) e o marca `applied`. */
  private async apply(
    installation: InstallationView,
    integration: PaymentIntegrationView,
    notice: Notice,
  ): Promise<PaymentNoticeResult> {
    const { context, writer, db, clock } = this.deps
    const current = await context.subscriptions.get(notice.subscriptionSpaId)
    if (!current) throw notFound('SUBSCRIPTION_NOT_FOUND')

    const start = formatCalendarDate(notice.periodStart)
    const end = formatCalendarDate(notice.periodEnd)
    await writer.update(
      installation,
      current,
      {
        status: 'active',
        periodStart: notice.periodStart,
        periodEnd: notice.periodEnd,
      },
      [
        {
          type: 'subscription.renewed',
          data: {
            invoiceId: null,
            previousPeriodEnd: endOf(notice.periodStart).toISOString(),
          },
          // Mesma chave do ManualLifecycle: o eco do SPA não duplica o evento.
          dedupeKey: `renewed:${current.id}:${start}:${end}`,
        },
      ],
    )
    const applied = await db.paymentNotice.update({
      where: { id: notice.id },
      data: { status: 'applied', appliedAt: clock.now() },
    })
    await this.comment(current.id, integration, applied)
    return this.resultOf(applied, false)
  }

  /** Informativo: falha vai ao log e não desfaz a renovação já gravada. */
  private async comment(
    subscriptionId: number,
    integration: PaymentIntegrationView,
    notice: Notice,
  ): Promise<void> {
    const text = [
      `Pagamento ${notice.externalId} recebido de ${integration.name}.`,
      `Novo período: ${brDate(notice.periodStart)} a ${brDate(notice.periodEnd)}.`,
    ].join('\n')
    try {
      await this.deps.context.subscriptions.comment(subscriptionId, text)
    } catch (error) {
      logger().warn(
        { err: error, subscriptionId },
        'não foi possível gravar o comentário do pagamento na assinatura',
      )
    }
  }

  private resultOf(notice: Notice, duplicate: boolean): PaymentNoticeResult {
    return {
      subscriptionId: notice.subscriptionSpaId,
      status: 'active',
      periodStart: notice.periodStart,
      periodEnd: notice.periodEnd,
      duplicate,
    }
  }
}
