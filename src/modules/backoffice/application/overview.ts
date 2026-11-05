import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { JsonCache } from '@/shared/infra/cache'

/**
 * `GET /admin/overview`: contadores do painel do backoffice. Só banco (nada do
 * Bitrix), calculados no máximo a cada 60 s (cache) e com `computedAt`.
 */

const CACHE_KEY = 'backoffice:overview'
const CACHE_SECONDS = 60
const DAY_MS = 86_400_000
/** O trial mais longo possível (`trialDays` ≤ 365): eventos mais antigos já venceram. */
const TRIAL_LOOKBACK_MS = 366 * DAY_MS
const TRIALS_LISTED = 50

type CountBy<K extends string> = Array<Record<K, string> & { count: number }>

export type Overview = {
  computedAt: string
  installations: CountBy<'appCode' | 'status'>
  events: {
    byApp: Array<{ appCode: string; pending: number; dead: number }>
    oldestPendingAt: string | null
  }
  stripeEvents: { failed: number; dead: number }
  credentialsRefreshFailing: number
  trialsEndingSoon: {
    count: number
    items: Array<{
      installationId: number
      appCode: string
      subscriptionId: number | null
      trialEndsAt: string
    }>
  }
  sweeps: Array<{
    kind: string
    startedAt: string
    finishedAt: string | null
    fixed: number
    errors: number
  }>
}

export class OverviewQuery {
  constructor(
    private readonly db: Db,
    private readonly cache: JsonCache,
    private readonly clock: Clock,
  ) {}

  async get(): Promise<Overview> {
    const cached = await this.cache.get<Overview>(CACHE_KEY)
    if (cached) return cached
    const overview = await this.compute()
    await this.cache.set(CACHE_KEY, overview, CACHE_SECONDS)
    return overview
  }

  private async compute(): Promise<Overview> {
    const now = this.clock.now()
    const [
      installations,
      events,
      oldestPending,
      stripe,
      refreshFailing,
      trials,
      sweeps,
    ] = await Promise.all([
      this.db.installation.groupBy({
        by: ['appCode', 'status'],
        _count: { _all: true },
      }),
      this.db.outboxEvent.groupBy({
        by: ['appCode', 'status'],
        where: { status: { in: ['pending', 'dead'] } },
        _count: { _all: true },
      }),
      this.db.outboxEvent.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.stripeEvent.groupBy({
        by: ['status'],
        where: { status: { in: ['failed', 'dead'] } },
        _count: { _all: true },
      }),
      this.db.credential.count({ where: { refreshFailures: { gt: 0 } } }),
      this.trialsEndingSoon(now),
      Promise.all(
        ['stripe', 'spa'].map(kind =>
          this.db.sweepRun.findFirst({
            where: { kind },
            orderBy: { startedAt: 'desc' },
          }),
        ),
      ),
    ])

    const byApp = new Map<
      string,
      { appCode: string; pending: number; dead: number }
    >()
    for (const group of events) {
      const entry = byApp.get(group.appCode) ?? {
        appCode: group.appCode,
        pending: 0,
        dead: 0,
      }
      if (group.status === 'pending' || group.status === 'dead')
        entry[group.status] = group._count._all
      byApp.set(group.appCode, entry)
    }
    const stripeCount = (status: string) =>
      stripe.find(group => group.status === status)?._count._all ?? 0

    return {
      computedAt: now.toISOString(),
      installations: installations
        .map(group => ({
          appCode: group.appCode,
          status: group.status,
          count: group._count._all,
        }))
        .sort((a, b) =>
          `${a.appCode}${a.status}`.localeCompare(`${b.appCode}${b.status}`),
        ),
      events: {
        byApp: [...byApp.values()].sort((a, b) =>
          a.appCode.localeCompare(b.appCode),
        ),
        oldestPendingAt: oldestPending?.createdAt.toISOString() ?? null,
      },
      stripeEvents: {
        failed: stripeCount('failed'),
        dead: stripeCount('dead'),
      },
      credentialsRefreshFailing: refreshFailing,
      trialsEndingSoon: trials,
      sweeps: sweeps.flatMap(run =>
        run
          ? [
              {
                kind: run.kind,
                startedAt: run.startedAt.toISOString(),
                finishedAt: run.finishedAt?.toISOString() ?? null,
                fixed: run.fixed,
                errors: run.errors,
              },
            ]
          : [],
      ),
    }
  }

  /**
   * Último `subscription.trial_started` de cada instalação com `trialEndsAt` nos
   * próximos 7 dias e sem `subscription.activated`/`subscription.ended` posterior
   * para a mesma assinatura. Vem do outbox para o painel não depender do Bitrix.
   */
  private async trialsEndingSoon(
    now: Date,
  ): Promise<Overview['trialsEndingSoon']> {
    const started = await this.db.outboxEvent.findMany({
      where: {
        type: 'subscription.trial_started',
        createdAt: { gte: new Date(now.getTime() - TRIAL_LOOKBACK_MS) },
      },
      orderBy: { createdAt: 'desc' },
    })
    const latest = new Map<number, (typeof started)[number]>()
    for (const event of started) {
      if (!latest.has(event.installationId))
        latest.set(event.installationId, event)
    }
    const limit = now.getTime() + 7 * DAY_MS
    const candidates = [...latest.values()].flatMap(event => {
      const endsAt = trialEndsAt(event.payload)
      return endsAt &&
        endsAt.getTime() >= now.getTime() &&
        endsAt.getTime() <= limit
        ? [{ event, endsAt }]
        : []
    })
    if (!candidates.length) return { count: 0, items: [] }

    const subscriptionIds = candidates.flatMap(c =>
      c.event.subscriptionId === null ? [] : [c.event.subscriptionId],
    )
    const closing = subscriptionIds.length
      ? await this.db.outboxEvent.findMany({
          where: {
            subscriptionId: { in: subscriptionIds },
            type: { in: ['subscription.activated', 'subscription.ended'] },
          },
        })
      : []
    const open = candidates
      .filter(
        ({ event }) =>
          !closing.some(
            other =>
              other.subscriptionId === event.subscriptionId &&
              other.createdAt > event.createdAt,
          ),
      )
      .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime())
    return {
      count: open.length,
      items: open.slice(0, TRIALS_LISTED).map(({ event, endsAt }) => ({
        installationId: event.installationId,
        appCode: event.appCode,
        subscriptionId: event.subscriptionId,
        trialEndsAt: endsAt.toISOString(),
      })),
    }
  }
}

function trialEndsAt(payload: unknown): Date | null {
  const value = (payload as { data?: { trialEndsAt?: unknown } } | null)?.data
    ?.trialEndsAt
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
