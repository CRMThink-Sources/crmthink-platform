import type { Db } from '@/shared/infra/prisma'
import { appendEvent } from '@/modules/events/outbox'
import type {
  BillingEventType,
  SubscriptionRef,
} from '@/modules/events/domain/event'
import type { InstallationView } from '@/modules/installations/ports'
import type { Subscription } from '../domain/entities'
import type { SubscriptionWrite } from '../infra/spa/spa-mappers'
import type { SubscriptionRepository } from '../infra/spa/subscription-repository'
import { formatCalendarDate } from '../infra/spa/spa-calendar-date'

/**
 * Único caminho de escrita de assinatura (SPA 1142) + eventos.
 *
 * Ordem de cada decisão:
 * 1. escreve no SPA **só o que mudou** (comparando com o estado atual), com o
 *    marcador de versão;
 * 2. numa transação: versão da assinatura, último marcador e último estado escritos
 *    (anti-loop) e os eventos no outbox.
 *
 * Se o processo cair entre 1 e 2, o reprocessamento (retry do Stripe, varredura)
 * reescreve o mesmo estado — idempotente — e a `dedupeKey` garante um evento só.
 *
 * `version` cresce a cada evento: os apps ignoram evento com versão menor que a
 * última aplicada.
 */

export type PlannedEvent = {
  type: BillingEventType
  data?: Record<string, unknown>
  dedupeKey?: string
}

export type Snapshot = {
  status: Subscription['status']
  planId: number
  periodStart: string
  periodEnd: string
  modality: Subscription['modality']
  cancelAtPeriodEnd: boolean
  gatewaySubscriptionId: string | null
  /** Parent (SPA 1060): permite resolver a instalação quando o item já foi apagado. */
  installationSpaItemId: number
}

export function snapshotOf(subscription: Subscription): Snapshot {
  return {
    status: subscription.status,
    planId: subscription.planId,
    periodStart: formatCalendarDate(subscription.periodStart),
    periodEnd: formatCalendarDate(subscription.periodEnd),
    modality: subscription.modality,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    gatewaySubscriptionId: subscription.gatewaySubscriptionId,
    installationSpaItemId: subscription.installationSpaItemId,
  }
}

export const sameSnapshot = (a: Snapshot | null, b: Snapshot): boolean =>
  a !== null && JSON.stringify(a) === JSON.stringify(b)

export function toSubscriptionRef(
  subscription: Subscription,
  version: number,
): SubscriptionRef {
  return {
    id: subscription.id,
    status: subscription.status,
    modality: subscription.modality,
    planId: subscription.planId,
    periodStart: subscription.periodStart.toISOString(),
    periodEnd: subscription.periodEnd.toISOString(),
    version,
  }
}

/** Campos do patch que diferem do estado atual (evita escrita e evento de SPA à toa). */
function diff(
  current: Subscription,
  patch: SubscriptionWrite,
): SubscriptionWrite {
  const changed: SubscriptionWrite = {}
  const day = (d: Date) => formatCalendarDate(d)
  if (patch.title !== undefined && patch.title !== current.title)
    changed.title = patch.title
  if (patch.planId !== undefined && patch.planId !== current.planId)
    changed.planId = patch.planId
  if (patch.status !== undefined && patch.status !== current.status)
    changed.status = patch.status
  if (patch.modality !== undefined && patch.modality !== current.modality)
    changed.modality = patch.modality
  if (
    patch.periodStart !== undefined &&
    day(patch.periodStart) !== day(current.periodStart)
  ) {
    changed.periodStart = patch.periodStart
  }
  if (
    patch.periodEnd !== undefined &&
    day(patch.periodEnd) !== day(current.periodEnd)
  ) {
    changed.periodEnd = patch.periodEnd
  }
  if (
    patch.canceledAt !== undefined &&
    (patch.canceledAt?.getTime() ?? null) !==
      (current.canceledAt?.getTime() ?? null)
  ) {
    changed.canceledAt = patch.canceledAt
  }
  if (
    patch.gatewaySubscriptionId !== undefined &&
    patch.gatewaySubscriptionId !== current.gatewaySubscriptionId
  ) {
    changed.gatewaySubscriptionId = patch.gatewaySubscriptionId
  }
  if (
    patch.cancelAtPeriodEnd !== undefined &&
    patch.cancelAtPeriodEnd !== current.cancelAtPeriodEnd
  ) {
    changed.cancelAtPeriodEnd = patch.cancelAtPeriodEnd
  }
  if (
    patch.installationSpaItemId !== undefined &&
    patch.installationSpaItemId !== current.installationSpaItemId
  ) {
    changed.installationSpaItemId = patch.installationSpaItemId
  }
  return changed
}

export class SubscriptionWriter {
  constructor(
    private readonly db: Db,
    private readonly repo: SubscriptionRepository,
  ) {}

  async currentVersion(subscriptionId: number): Promise<number> {
    const row = await this.db.subscriptionVersion.findUnique({
      where: { subscriptionSpaId: subscriptionId },
    })
    return row?.version ?? 0
  }

  async lastSnapshot(
    subscriptionId: number,
  ): Promise<{ marker: string | null; snapshot: Snapshot | null }> {
    const row = await this.db.subscriptionVersion.findUnique({
      where: { subscriptionSpaId: subscriptionId },
    })
    return {
      marker: row?.lastWrittenMarker ?? null,
      snapshot: (row?.lastSnapshot as Snapshot | null) ?? null,
    }
  }

  /**
   * O evento do SPA é eco de uma escrita nossa? (marcador igual ao último escrito e
   * estado igual ao último estado conhecido).
   */
  async isOwnEcho(subscription: Subscription): Promise<boolean> {
    const last = await this.lastSnapshot(subscription.id)
    return (
      sameSnapshot(last.snapshot, snapshotOf(subscription)) &&
      (last.marker === null ||
        subscription.versionMarker === last.marker ||
        subscription.versionMarker === null)
    )
  }

  async create(
    installation: InstallationView,
    write: SubscriptionWrite,
    events: PlannedEvent[],
  ): Promise<Subscription> {
    const version = events.length || 1
    const created = await this.repo.create({
      ...write,
      versionMarker: String(version),
    })
    await this.persist(installation, created, 0, events)
    return created
  }

  async update(
    installation: InstallationView,
    current: Subscription,
    patch: SubscriptionWrite,
    events: PlannedEvent[],
  ): Promise<Subscription> {
    const changes = diff(current, patch)
    const hasChanges = Object.keys(changes).length > 0
    if (!hasChanges && events.length === 0) return current

    const base = await this.currentVersion(current.id)
    const next = base + Math.max(1, events.length)
    const updated = hasChanges
      ? await this.repo.update(current.id, {
          ...changes,
          versionMarker: String(next),
        })
      : current
    await this.persist(
      installation,
      updated,
      base,
      events,
      hasChanges ? String(next) : undefined,
    )
    return updated
  }

  /** Registra o estado observado (mudança humana sem evento) para o anti-loop. */
  async observe(subscription: Subscription): Promise<void> {
    await this.db.subscriptionVersion.upsert({
      where: { subscriptionSpaId: subscription.id },
      create: {
        subscriptionSpaId: subscription.id,
        version: 0,
        lastSnapshot: snapshotOf(subscription),
      },
      update: { lastSnapshot: snapshotOf(subscription) },
    })
  }

  private async persist(
    installation: InstallationView,
    subscription: Subscription,
    baseVersion: number,
    events: PlannedEvent[],
    marker?: string,
  ): Promise<void> {
    const finalVersion = baseVersion + Math.max(1, events.length)
    await this.db.$transaction(async tx => {
      await tx.subscriptionVersion.upsert({
        where: { subscriptionSpaId: subscription.id },
        create: {
          subscriptionSpaId: subscription.id,
          version: finalVersion,
          lastWrittenMarker: marker ?? String(finalVersion),
          lastSnapshot: snapshotOf(subscription),
        },
        update: {
          version: finalVersion,
          ...(marker ? { lastWrittenMarker: marker } : {}),
          lastSnapshot: snapshotOf(subscription),
        },
      })
      let version = baseVersion
      for (const event of events) {
        version++
        await appendEvent(tx, {
          appCode: installation.appCode,
          type: event.type,
          installationId: installation.installationId,
          memberId: installation.memberId,
          subscription: toSubscriptionRef(subscription, version),
          data: event.data,
          dedupeKey: event.dedupeKey,
        })
      }
    })
  }

  /** Evento sem assinatura mudando (ex.: compra avulsa, estorno), com a versão atual. */
  async emitWithoutChange(
    installation: InstallationView,
    subscription: Subscription | null,
    event: PlannedEvent,
  ): Promise<void> {
    const version = subscription
      ? await this.currentVersion(subscription.id)
      : 0
    await this.db.$transaction(async tx => {
      await appendEvent(tx, {
        appCode: installation.appCode,
        type: event.type,
        installationId: installation.installationId,
        memberId: installation.memberId,
        subscription: subscription
          ? toSubscriptionRef(subscription, version)
          : null,
        data: event.data,
        dedupeKey: event.dedupeKey,
      })
    })
  }
}
