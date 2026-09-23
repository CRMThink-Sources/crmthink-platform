import z from 'zod'
import type { SpaConfig } from '@/config/spa-config'
import { safeEqual } from '@/shared/crypto/timing-safe'
import { QUEUES, type JobQueue } from '@/shared/infra/queue'
import { logger } from '@/shared/observability/logger'
import type { CatalogRepository } from '../infra/spa/catalog-repository'
import type { ItemsService } from './items-service'
import type { ManualLifecycle } from './manual-lifecycle'

/**
 * Eventos `onCrmDynamicItem{Add,Update,Delete}` do portal CRMThink.
 *
 * Portado de `spa-webhook.controller.ts` do hub-core: só duas respostas fogem de 200
 * — token inválido (401) e não configurado (503). Todo o resto responde 200 com log,
 * porque o Bitrix desativa handler que erra em sequência. O processamento vai para a
 * fila (o worker busca o item completo com `crm.item.get`).
 */

const payloadSchema = z.object({
  event: z.string().optional(),
  data: z
    .object({
      FIELDS: z
        .object({
          ID: z.union([z.string(), z.number()]).optional(),
          ENTITY_TYPE_ID: z.union([z.string(), z.number()]).optional(),
        })
        .optional(),
    })
    .optional(),
  auth: z.object({ application_token: z.string().optional() }).optional(),
})

const EVENT_PATTERN = /^ONCRMDYNAMICITEM(ADD|UPDATE|DELETE)(?:_(\d+))?$/i

export type SpaVerb = 'ADD' | 'UPDATE' | 'DELETE'
export type SpaEventJob = {
  entityTypeId: number
  itemId: number
  verb: SpaVerb
}

export function parseSpaEvent(body: unknown): SpaEventJob | null {
  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) return null
  const match = parsed.data.event
    ? EVENT_PATTERN.exec(parsed.data.event.trim())
    : null
  if (!match) return null
  const fields = parsed.data.data?.FIELDS
  const entityTypeId = match[2]
    ? Number(match[2])
    : Number(fields?.ENTITY_TYPE_ID)
  const itemId = Number(fields?.ID)
  if (
    !Number.isInteger(entityTypeId) ||
    !Number.isInteger(itemId) ||
    itemId <= 0
  )
    return null
  return { entityTypeId, itemId, verb: match[1]!.toUpperCase() as SpaVerb }
}

export class SpaEventsIngest {
  constructor(
    private readonly expectedToken: string,
    private readonly queue: JobQueue,
  ) {}

  async receive(
    body: unknown,
  ): Promise<{ status: 200 | 401 | 503; handled?: boolean }> {
    if (!this.expectedToken) {
      logger().warn(
        'CRMTHINK_APPLICATION_TOKEN não configurado — eventos dos SPAs desabilitados',
      )
      return { status: 503 }
    }
    const token = (body as { auth?: { application_token?: unknown } } | null)
      ?.auth?.application_token
    if (typeof token !== 'string' || !safeEqual(token, this.expectedToken)) {
      logger().warn('evento do SPA com application_token inválido')
      return { status: 401 }
    }
    const job = parseSpaEvent(body)
    if (!job) return { status: 200, handled: false }
    try {
      await this.queue.add(
        QUEUES.spaEvents,
        `${job.verb}:${job.entityTypeId}`,
        job,
      )
    } catch (error) {
      // 200 mesmo assim: a varredura dos SPAs recupera.
      logger().error(
        { err: error, job },
        'não foi possível enfileirar evento do SPA',
      )
    }
    return { status: 200, handled: true }
  }
}

export class SpaEventProcessor {
  constructor(
    private readonly config: SpaConfig,
    private readonly catalog: CatalogRepository,
    private readonly manual: ManualLifecycle,
    private readonly items: ItemsService,
    private readonly unlinkInstallation: (
      spaItemId: number,
    ) => Promise<unknown>,
  ) {}

  async process(job: SpaEventJob): Promise<void> {
    const types = this.config.entityTypes
    switch (job.entityTypeId) {
      case types.product:
        await this.catalog.invalidateProduct(job.itemId)
        return
      case types.plan:
        await this.catalog.invalidatePlan(job.itemId)
        return
      case types.installation:
        if (job.verb === 'DELETE') await this.unlinkInstallation(job.itemId)
        return
      case types.subscription:
        if (job.verb === 'DELETE') await this.manual.deleted(job.itemId)
        else await this.manual.apply(job.itemId)
        return
      case types.subscriptionItem:
        await this.items.onSpaItemChanged(job.itemId, job.verb)
        return
      default:
        logger().debug({ job }, 'evento de SPA fora da cobrança — ignorado')
    }
  }
}
