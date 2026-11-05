import z from 'zod'
import type { Prisma } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import { HttpError, notFound } from '@/shared/http/errors'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { SubscriptionQueries } from '@/modules/billing/application/subscription-queries'
import {
  decodeCursor,
  pageQuerySchema,
  periodQuerySchema,
  periodWhere,
  toPage,
  type Page,
} from './pagination'

/**
 * Leituras de instalações para o backoffice: lista com busca, detalhe (com a assinatura
 * do portal, tolerante a falha) e linha do tempo. Nunca devolve tokens nem segredos.
 */

export type TokenHealth = 'ok' | 'refresh_failing' | 'missing'

type CredentialHealthRow = {
  refreshFailures: number
} | null

export function tokenHealth(credential: CredentialHealthRow): TokenHealth {
  if (!credential) return 'missing'
  return credential.refreshFailures > 0 ? 'refresh_failing' : 'ok'
}

export const installationQuerySchema = pageQuerySchema.extend({
  appCode: z.string().max(100).optional(),
  status: z.string().max(30).optional(),
  q: z.string().trim().min(1).max(255).optional(),
})

const listCursorSchema = z.tuple([z.iso.datetime(), z.number().int()])

type InstallationRow = Prisma.InstallationGetPayload<{
  include: { credential: true }
}>

function listItem(row: InstallationRow) {
  return {
    id: row.id,
    appCode: row.appCode,
    domain: row.domain,
    memberId: row.memberId,
    status: row.status,
    installedAt: row.installedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    uninstalledAt: row.uninstalledAt?.toISOString() ?? null,
    trialUsed: row.trialUsed,
    tokenHealth: tokenHealth(row.credential),
  }
}

export type InstallationListItem = ReturnType<typeof listItem>

export async function listInstallations(
  db: Db,
  query: unknown,
): Promise<Page<InstallationListItem>> {
  const q = installationQuerySchema.parse(query)
  const before = decodeCursor(q.cursor, listCursorSchema)
  const at = before ? new Date(before[0]) : null
  // Só dígitos é id ou memberId: "2" casaria com todo domínio `bitrix24`.
  const numeric = q.q !== undefined && /^\d+$/.test(q.q)
  const search = q.q
    ? {
        OR: numeric
          ? [
              { memberId: q.q },
              ...(Number(q.q) <= 2_147_483_647 ? [{ id: Number(q.q) }] : []),
            ]
          : [{ domain: { contains: q.q } }, { memberId: q.q }],
      }
    : undefined
  const page =
    before && at
      ? {
          OR: [
            { installedAt: { lt: at } },
            { installedAt: at, id: { lt: before[1] } },
          ],
        }
      : undefined
  const rows = await db.installation.findMany({
    where: {
      AND: [search ?? {}, page ?? {}],
      ...(q.appCode ? { appCode: q.appCode } : {}),
      ...(q.status ? { status: q.status as never } : {}),
    },
    orderBy: [{ installedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    include: { credential: true },
  })
  return toPage(
    rows,
    q.limit,
    row => [row.installedAt.toISOString(), row.id],
    listItem,
  )
}

const SUBSCRIPTION_TIMEOUT_MS = 3_000

export class InstallationReads {
  constructor(
    private readonly db: Db,
    private readonly registry: AppRegistry,
    private readonly subscriptions: SubscriptionQueries,
  ) {}

  async detail(id: number) {
    const row = await this.db.installation.findUnique({
      where: { id },
      include: { credential: true },
    })
    if (!row) throw notFound('INSTALLATION_NOT_FOUND')
    const app = await this.registry.get(row.appCode)
    const events = await this.db.outboxEvent.groupBy({
      by: ['status'],
      where: { installationId: id },
      _count: { _all: true },
    })
    const credential = row.credential

    return {
      ...listItem(row),
      app: app
        ? { appCode: app.appCode, name: app.name, active: app.active }
        : null,
      spaItemId: row.spaItemId,
      contact: row.contact ?? null,
      everActivated: row.everActivated,
      pendingReinstall: row.pendingReinstall,
      updatedAt: row.updatedAt.toISOString(),
      token: credential
        ? {
            health: tokenHealth(credential),
            expiresAt: credential.expiresAt.toISOString(),
            refreshFailures: credential.refreshFailures,
            lastRefreshError: credential.lastRefreshError,
            clientEndpoint: credential.clientEndpoint,
            updatedAt: credential.updatedAt.toISOString(),
          }
        : { health: 'missing' as const },
      events: Object.fromEntries(
        ['pending', 'delivered', 'dead'].map(status => [
          status,
          events.find(group => group.status === status)?._count._all ?? 0,
        ]),
      ) as Record<'pending' | 'delivered' | 'dead', number>,
      subscription: await this.subscriptionOf(row.appCode, id),
    }
  }

  /**
   * A assinatura vem do SPA do portal CRMThink. Se o Bitrix falhar ou demorar, o
   * detalhe sai mesmo assim, com o motivo — o suporte precisa ver o resto.
   */
  private async subscriptionOf(appCode: string, installationId: number) {
    try {
      const app = await this.registry.getOrThrow(appCode)
      const current = await Promise.race([
        this.subscriptions.current(app, installationId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('tempo esgotado lendo o portal')),
            SUBSCRIPTION_TIMEOUT_MS,
          ).unref(),
        ),
      ])
      return { available: true as const, current }
    } catch (error) {
      if (error instanceof HttpError && error.code === 'NO_SUBSCRIPTION') {
        return { available: true as const, current: null }
      }
      return {
        available: false as const,
        reason:
          error instanceof HttpError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : 'erro desconhecido',
      }
    }
  }

  async timeline(id: number, query: unknown) {
    const exists = await this.db.installation.findUnique({ where: { id } })
    if (!exists) throw notFound('INSTALLATION_NOT_FOUND')
    return installationTimeline(this.db, id, query)
  }
}

// ─────────────── Linha do tempo ───────────────

export const TIMELINE_KINDS = [
  'install_attempt',
  'event',
  'purchase',
  'admin_action',
] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]

export const timelineQuerySchema = pageQuerySchema
  .extend(periodQuerySchema.shape)
  .extend({
    kind: z
      .string()
      .optional()
      .transform(value => (value ? value.split(',') : undefined))
      .pipe(z.array(z.enum(TIMELINE_KINDS)).optional()),
  })

const timelineCursorSchema = z.tuple([
  z.iso.datetime(),
  z.enum(TIMELINE_KINDS),
  z.union([z.number().int(), z.string()]),
])

type TimelineCursor = z.infer<typeof timelineCursorSchema>

export type TimelineItem = {
  kind: TimelineKind
  occurredAt: string
  summary: string
  ref: { type: string; id: string }
  data: Record<string, unknown>
}

type Sortable = { kind: TimelineKind; at: Date; id: number | string }

/** Ordem da linha do tempo: data desc, depois tipo desc, depois id desc. */
function compare(a: Sortable, b: Sortable): number {
  if (a.at.getTime() !== b.at.getTime()) return b.at.getTime() - a.at.getTime()
  if (a.kind !== b.kind) return a.kind < b.kind ? 1 : -1
  if (typeof a.id === 'number' && typeof b.id === 'number') return b.id - a.id
  return String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0
}

/**
 * Filtro "antes do cursor" de uma fonte: na mesma data, a fonte só entra se o tipo
 * dela vem depois do tipo do cursor, ou se é o mesmo tipo com id menor.
 */
function beforeCursor(
  cursor: TimelineCursor | undefined,
  kind: TimelineKind,
  dateField: string,
  idField: string,
): Record<string, unknown> | null {
  if (!cursor) return {}
  const at = new Date(cursor[0])
  const sameInstant =
    kind < cursor[1]
      ? { [dateField]: at }
      : kind === cursor[1]
        ? { [dateField]: at, [idField]: { lt: cursor[2] } }
        : null
  return {
    OR: [{ [dateField]: { lt: at } }, ...(sameInstant ? [sameInstant] : [])],
  }
}

/**
 * Junta as fontes da instalação numa lista só. Cada fonte busca até `limit + 1`
 * linhas antes do cursor, já ordenadas; o merge corta na página. Custo limitado a
 * 4 × (limit + 1) linhas por página.
 */
export async function installationTimeline(
  db: Db,
  installationId: number,
  query: unknown,
): Promise<Page<TimelineItem>> {
  const q = timelineQuerySchema.parse(query)
  const cursor = decodeCursor(q.cursor, timelineCursorSchema)
  const kinds = new Set<TimelineKind>(q.kind ?? TIMELINE_KINDS)
  const period = periodWhere(q)
  const take = q.limit + 1
  const range = period ? { createdAt: period } : {}
  const pending: Array<Promise<Array<Sortable & { item: TimelineItem }>>> = []

  if (kinds.has('install_attempt')) {
    const where = beforeCursor(cursor, 'install_attempt', 'createdAt', 'id')
    pending.push(
      db.installAttempt
        .findMany({
          where: { installationId, AND: [where ?? {}, range] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        })
        .then(rows =>
          rows.map(row => ({
            kind: 'install_attempt' as const,
            at: row.createdAt,
            id: row.id,
            item: {
              kind: 'install_attempt' as const,
              occurredAt: row.createdAt.toISOString(),
              summary: `Instalação: ${row.step} → ${row.status}`,
              ref: { type: 'install_attempt', id: String(row.id) },
              data: { step: row.step, status: row.status, error: row.error },
            },
          })),
        ),
    )
  }

  if (kinds.has('event')) {
    const where = beforeCursor(cursor, 'event', 'createdAt', 'eventId')
    pending.push(
      db.outboxEvent
        .findMany({
          where: { installationId, AND: [where ?? {}, range] },
          orderBy: [{ createdAt: 'desc' }, { eventId: 'desc' }],
          take,
          include: { deliveries: { orderBy: { attempt: 'desc' }, take: 5 } },
        })
        .then(rows =>
          rows.map(row => ({
            kind: 'event' as const,
            at: row.createdAt,
            id: row.eventId,
            item: {
              kind: 'event' as const,
              occurredAt: row.createdAt.toISOString(),
              summary: `${row.type} (${row.status})`,
              ref: { type: 'outbox_event', id: row.eventId },
              data: {
                eventId: row.eventId,
                type: row.type,
                status: row.status,
                subscriptionId: row.subscriptionId,
                version: row.version,
                attempts: row.attempts,
                deliveredAt: row.deliveredAt?.toISOString() ?? null,
                deadAt: row.deadAt?.toISOString() ?? null,
                deliveries: row.deliveries.map(delivery => ({
                  attempt: delivery.attempt,
                  statusCode: delivery.statusCode,
                  error: delivery.error,
                  createdAt: delivery.createdAt.toISOString(),
                  deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
                })),
              },
            },
          })),
        ),
    )
  }

  if (kinds.has('purchase')) {
    const where = beforeCursor(cursor, 'purchase', 'createdAt', 'id')
    pending.push(
      db.purchase
        .findMany({
          where: { installationId, AND: [where ?? {}, range] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        })
        .then(rows =>
          rows.map(row => ({
            kind: 'purchase' as const,
            at: row.createdAt,
            id: row.id,
            item: {
              kind: 'purchase' as const,
              occurredAt: row.createdAt.toISOString(),
              summary: `Compra avulsa (${row.status})`,
              ref: { type: 'purchase', id: String(row.id) },
              data: {
                planId: row.planId,
                quantity: row.quantity,
                status: row.status,
                amount: row.amount,
                amountRefunded: row.amountRefunded,
              },
            },
          })),
        ),
    )
  }

  if (kinds.has('admin_action')) {
    const where = beforeCursor(cursor, 'admin_action', 'createdAt', 'id')
    pending.push(
      db.adminAuditLog
        .findMany({
          where: {
            targetType: 'installation',
            targetId: String(installationId),
            AND: [where ?? {}, range],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        })
        .then(rows =>
          rows.map(row => ({
            kind: 'admin_action' as const,
            at: row.createdAt,
            id: row.id,
            item: {
              kind: 'admin_action' as const,
              occurredAt: row.createdAt.toISOString(),
              summary: `${row.action} por ${row.actor}`,
              ref: { type: 'admin_audit_log', id: String(row.id) },
              data: {
                actor: row.actor,
                actorRole: row.actorRole,
                action: row.action,
                statusCode: row.statusCode,
                errorCode: row.errorCode,
              },
            },
          })),
        ),
    )
  }

  const merged = (await Promise.all(pending)).flat().sort(compare)
  return toPage(
    merged,
    q.limit,
    row => [row.at.toISOString(), row.kind, row.id],
    row => row.item,
  )
}
