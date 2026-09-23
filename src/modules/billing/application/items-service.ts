import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import { HttpError, notFound, unprocessable } from '@/shared/http/errors'
import { logger } from '@/shared/observability/logger'
import type { RegisteredApp } from '@/modules/registry/domain/app'
import type { InstallationView } from '@/modules/installations/ports'
import type { Subscription, SubscriptionItem } from '../domain/entities'
import type { PaymentGateway } from '../ports/payment-gateway'
import type { CatalogRepository } from '../infra/spa/catalog-repository'
import type { SubscriptionItemWrite } from '../infra/spa/spa-mappers'
import type { BillingContext } from './billing-context'
import type { SubscriptionWriter } from './subscription-writer'

export const createItemSchema = z.object({
  externalRef: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
  metadata: z.record(z.string(), z.unknown()).optional(),
  billable: z.boolean().default(false),
})

export const updateItemSchema = z.object({
  status: z.enum(['active', 'cancelled']).optional(),
  title: z.string().min(1).max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

type ItemSnapshot = {
  status: SubscriptionItem['status']
  billable: boolean
  title: string
  externalRef: string | null
  deleted: boolean
}

const itemSnapshot = (item: SubscriptionItem): ItemSnapshot => ({
  status: item.status,
  billable: item.billable,
  title: item.title,
  externalRef: item.externalRef,
  deleted: item.deletedAt !== null,
})

export type ItemResponse = {
  itemId: number
  subscriptionId: number
  externalRef: string | null
  title: string
  status: SubscriptionItem['status']
  billable: boolean
  metadata: Record<string, unknown>
  deletedAt: string | null
}

const toResponse = (item: SubscriptionItem): ItemResponse => ({
  itemId: item.id,
  subscriptionId: item.subscriptionId,
  externalRef: item.externalRef,
  title: item.title,
  status: item.status,
  billable: item.billable,
  metadata: item.metadata,
  deletedAt: item.deletedAt?.toISOString() ?? null,
})

/**
 * Espelho de itens de assinatura no SPA 1146. Idempotente por (assinatura,
 * `externalRef`); remoção lógica (status `cancelled` + data/autor). Só itens
 * `billable` mexem no Stripe: a quantidade do item de assinatura segue o número de
 * itens cobráveis ativos (estado desejado, respeitando as faixas do preço).
 */
export class ItemsService {
  constructor(
    private readonly db: Db,
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly catalog: CatalogRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
  ) {}

  private async remember(
    item: SubscriptionItem,
    marker?: string,
  ): Promise<void> {
    await this.db.itemVersion.upsert({
      where: { itemSpaId: item.id },
      create: {
        itemSpaId: item.id,
        version: 1,
        lastWrittenMarker: marker ?? null,
        lastSnapshot: itemSnapshot(item),
      },
      update: {
        version: { increment: 1 },
        ...(marker ? { lastWrittenMarker: marker } : {}),
        lastSnapshot: itemSnapshot(item),
      },
    })
  }

  private async write(
    id: number | null,
    input: SubscriptionItemWrite,
  ): Promise<SubscriptionItem> {
    const current = id
      ? await this.db.itemVersion.findUnique({ where: { itemSpaId: id } })
      : null
    const marker = String((current?.version ?? 0) + 1)
    const item = id
      ? await this.context.subscriptions.updateItem(id, {
          ...input,
          versionMarker: marker,
        })
      : await this.context.subscriptions.createItem({
          ...input,
          versionMarker: marker,
        })
    await this.remember(item, marker)
    return item
  }

  private async owned(app: RegisteredApp, subscriptionId: number) {
    const owned = await this.context.ownedSubscription(
      app.appCode,
      subscriptionId,
    )
    if (
      owned.subscription.status === 'cancelled' ||
      owned.subscription.status === 'trial_expired'
    ) {
      throw unprocessable('SUBSCRIPTION_ENDED', 'Assinatura encerrada')
    }
    return owned
  }

  async list(
    app: RegisteredApp,
    subscriptionId: number,
  ): Promise<ItemResponse[]> {
    await this.context.ownedSubscription(app.appCode, subscriptionId)
    return (await this.context.subscriptions.listItems(subscriptionId)).map(
      toResponse,
    )
  }

  async create(
    app: RegisteredApp,
    subscriptionId: number,
    input: z.infer<typeof createItemSchema>,
  ): Promise<{ item: ItemResponse; created: boolean }> {
    const { installation, subscription } = await this.owned(app, subscriptionId)
    return this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const existing = (
          await this.context.subscriptions.listItems(subscriptionId)
        ).find(item => item.externalRef === input.externalRef)
        if (existing) return { item: toResponse(existing), created: false }

        const item = await this.write(null, {
          title: input.title,
          subscriptionId,
          status: 'active',
          billable: input.billable,
          externalRef: input.externalRef,
          metadata: input.metadata ?? {},
        })
        if (item.billable) await this.syncQuantity(subscription)
        return { item: toResponse(item), created: true }
      },
    )
  }

  private async ownedItem(
    subscriptionId: number,
    itemId: number,
  ): Promise<SubscriptionItem> {
    const item = await this.context.subscriptions.getItem(itemId)
    if (!item || item.subscriptionId !== subscriptionId)
      throw notFound('ITEM_NOT_FOUND')
    return item
  }

  async update(
    app: RegisteredApp,
    subscriptionId: number,
    itemId: number,
    input: z.infer<typeof updateItemSchema>,
  ): Promise<ItemResponse> {
    const { installation, subscription } = await this.owned(app, subscriptionId)
    return this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const current = await this.ownedItem(subscriptionId, itemId)
        const item = await this.write(itemId, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.status === 'active'
            ? { deletedAt: null, deletedBy: null }
            : {}),
        })
        if (item.billable && current.status !== item.status)
          await this.syncQuantity(subscription)
        return toResponse(item)
      },
    )
  }

  async remove(
    app: RegisteredApp,
    subscriptionId: number,
    itemId: number,
  ): Promise<ItemResponse> {
    const { installation, subscription } = await this.context.ownedSubscription(
      app.appCode,
      subscriptionId,
    )
    return this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const current = await this.ownedItem(subscriptionId, itemId)
        if (current.status === 'cancelled' && current.deletedAt)
          return toResponse(current)
        const item = await this.write(itemId, {
          status: 'cancelled',
          deletedAt: this.clock.now(),
          deletedBy: `app:${app.appCode}`,
        })
        if (item.billable) await this.syncQuantity(subscription)
        return toResponse(item)
      },
    )
  }

  /**
   * Quantidade Stripe = itens cobráveis ativos. Só para assinatura `stripe` com
   * gateway; `manual` e trial não têm o que sincronizar.
   */
  async syncQuantity(
    subscription: Subscription,
  ): Promise<{ desired: number } | null> {
    if (
      subscription.modality !== 'stripe' ||
      !subscription.gatewaySubscriptionId
    )
      return null
    const plan = await this.catalog.getPlan(subscription.planId)
    if (!plan?.gatewayPriceId) return null
    const items = await this.context.subscriptions.listItems(subscription.id)
    const desired = items.filter(
      item => item.billable && item.status === 'active',
    ).length
    try {
      await this.gateway.setItemQuantity(
        subscription.gatewaySubscriptionId,
        plan.gatewayPriceId,
        desired,
      )
    } catch (error) {
      logger().error(
        { err: error, subscriptionId: subscription.id },
        'falha ao sincronizar quantidade no Stripe',
      )
      throw new HttpError(
        502,
        'GATEWAY_ERROR',
        'Não foi possível atualizar a cobrança no Stripe',
      )
    }
    return { desired }
  }

  /**
   * Mudança no SPA 1146 vinda de fora da plataforma (humano ou automação): evento
   * para o app dono e, se o item é cobrável, quantidade Stripe reaplicada.
   * Eco de escrita própria (mesmo estado do último registrado) é ignorado.
   */
  async onSpaItemChanged(
    itemId: number,
    verb: 'ADD' | 'UPDATE' | 'DELETE',
  ): Promise<void> {
    const known = await this.db.itemVersion.findUnique({
      where: { itemSpaId: itemId },
    })
    const previous = (known?.lastSnapshot as ItemSnapshot | null) ?? null

    if (verb === 'DELETE') {
      // Item apagado de verdade: sem o item não há assinatura a resolver pelo SPA.
      logger().warn(
        { itemId },
        'item do SPA 1146 apagado (não cancelado) — sem efeito',
      )
      return
    }

    const item = await this.context.subscriptions.getItem(itemId)
    if (!item) return
    const snapshot = itemSnapshot(item)
    if (previous && JSON.stringify(previous) === JSON.stringify(snapshot))
      return

    const subscription = await this.context.subscriptions.get(
      item.subscriptionId,
    )
    if (!subscription) return
    const installation = await this.context.installationOf(subscription)
    if (!installation) return

    await this.context.withInstallationLock(
      installation.installationId,
      async () => {
        await this.remember(item)
        const change = !previous
          ? 'created'
          : item.status === 'cancelled' && previous.status !== 'cancelled'
            ? 'removed'
            : 'updated'
        await this.emitItemChanged(installation, subscription, item, change)
        const billableChanged =
          !previous ||
          previous.billable !== item.billable ||
          previous.status !== item.status
        if ((item.billable || previous?.billable) && billableChanged) {
          await this.syncQuantity(subscription).catch(() => undefined)
        }
      },
    )
  }

  private async emitItemChanged(
    installation: InstallationView,
    subscription: Subscription,
    item: SubscriptionItem,
    change: 'created' | 'updated' | 'removed',
  ): Promise<void> {
    const version =
      (await this.db.itemVersion.findUnique({ where: { itemSpaId: item.id } }))
        ?.version ?? 0
    await this.writer.emitWithoutChange(installation, subscription, {
      type: 'subscription.item_changed',
      data: { change, item: toResponse(item) },
      dedupeKey: `item_changed:${item.id}:${version}`,
    })
  }

  /** Varredura: quantidade Stripe divergente do SPA ⇒ reaplica a do SPA. */
  async reconcileQuantity(
    subscription: Subscription,
    gatewayQuantity: number,
  ): Promise<boolean> {
    if (subscription.modality !== 'stripe') return false
    const items = await this.context.subscriptions.listItems(subscription.id)
    if (!items.some(item => item.billable)) return false
    const desired = items.filter(
      item => item.billable && item.status === 'active',
    ).length
    if (desired === gatewayQuantity) return false
    await this.syncQuantity(subscription)
    return true
  }
}
