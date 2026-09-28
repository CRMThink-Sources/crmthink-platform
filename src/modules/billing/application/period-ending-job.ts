import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import { Prisma } from '@/prisma/client'
import {
  calendarDaysBetween,
  formatCalendarDate,
} from '../infra/spa/spa-calendar-date'
import type { BillingContext } from './billing-context'
import type { SubscriptionWriter } from './subscription-writer'

export const PERIOD_ENDING_MILESTONES = [3, 2, 1] as const

/**
 * Job diário: `subscription.period_ending` com `daysLeft` 3, 2 e 1 para assinaturas
 * `manual` ativas cujo fim de período não foi estendido. Um aviso por marco e
 * período (`period_notice` único); período estendido muda a chave, então o aviso do
 * período anterior não sai. Assinaturas `stripe` nunca geram o evento.
 */
export class PeriodEndingJob {
  constructor(
    private readonly db: Db,
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<number> {
    const now = this.clock.now()
    let emitted = 0
    for (const subscription of await this.context.subscriptions.listByStatus(
      'active',
    )) {
      if (subscription.modality !== 'manual') continue
      const daysLeft = calendarDaysBetween(now, subscription.periodEnd)
      if (!(PERIOD_ENDING_MILESTONES as readonly number[]).includes(daysLeft))
        continue
      const installation = await this.context.installationOf(subscription)
      if (!installation) continue

      const periodEnd = new Date(
        formatCalendarDate(subscription.periodEnd) + 'T00:00:00.000Z',
      )
      try {
        await this.db.periodNotice.create({
          data: { subscriptionSpaId: subscription.id, periodEnd, daysLeft },
        })
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          continue
        throw error
      }

      await this.writer.emitWithoutChange(installation, subscription, {
        type: 'subscription.period_ending',
        data: { daysLeft, periodEnd: subscription.periodEnd.toISOString() },
        dedupeKey: `period_ending:${subscription.id}:${formatCalendarDate(subscription.periodEnd)}:${daysLeft}`,
      })
      emitted++
    }
    return emitted
  }
}
