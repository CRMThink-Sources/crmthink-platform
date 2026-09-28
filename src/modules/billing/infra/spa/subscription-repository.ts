import type { SpaConfig } from '@/config/spa-config'
import type { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'
import type { SpaEnvironment } from '@/shared/spa/environment'
import { raiseAlert } from '@/shared/observability/alert'
import type { Subscription, SubscriptionItem } from '../../domain/entities'
import {
  InvalidSpaItemError,
  type SpaMappers,
  type SubscriptionItemWrite,
  type SubscriptionWrite,
} from './spa-mappers'

/**
 * Assinaturas (1142) e itens (1146). Sem cache: são o estado que decide eventos, e
 * cada leitura precisa ser a do portal. Todo resultado é filtrado pelo Ambiente —
 * item de outro ambiente é invisível para esta instância.
 */
export class SubscriptionRepository {
  constructor(
    private readonly crm: BitrixRestClient,
    private readonly config: SpaConfig,
    private readonly mappers: SpaMappers,
    private readonly environment: SpaEnvironment,
  ) {}

  private get subscriptionType(): number {
    return this.config.entityTypes.subscription
  }

  private get itemType(): number {
    return this.config.entityTypes.subscriptionItem
  }

  /** Mapeia descartando (com alerta) item inválido e item de outro ambiente. */
  private mapSubscriptions(raws: Record<string, unknown>[]): Subscription[] {
    const result: Subscription[] = []
    for (const raw of raws) {
      const mapped = this.tryMapSubscription(raw)
      if (mapped) result.push(mapped)
    }
    return result
  }

  tryMapSubscription(raw: Record<string, unknown>): Subscription | null {
    try {
      const subscription = this.mappers.subscription(raw)
      return subscription.environment === this.environment.current
        ? subscription
        : null
    } catch (error) {
      if (error instanceof InvalidSpaItemError) {
        raiseAlert(
          'spa.invalid_item',
          { itemId: raw.id, issues: error.issues.map(i => i.message) },
          error.message,
        )
        return null
      }
      throw error
    }
  }

  tryMapItem(raw: Record<string, unknown>): SubscriptionItem | null {
    try {
      const item = this.mappers.subscriptionItem(raw)
      return item.environment === this.environment.current ? item : null
    } catch (error) {
      if (error instanceof InvalidSpaItemError) {
        raiseAlert(
          'spa.invalid_item',
          { itemId: raw.id, issues: error.issues.map(i => i.message) },
          error.message,
        )
        return null
      }
      throw error
    }
  }

  async getRaw(id: number): Promise<Record<string, unknown> | null> {
    return this.crm.getItem(this.subscriptionType, id)
  }

  async get(id: number): Promise<Subscription | null> {
    const raw = await this.getRaw(id)
    return raw ? this.tryMapSubscription(raw) : null
  }

  async listByInstallation(spaItemId: number): Promise<Subscription[]> {
    const raws = await this.crm.listItems(this.subscriptionType, {
      [this.mappers.installationParent]: spaItemId,
    })
    return this.mapSubscriptions(raws)
  }

  /** A assinatura vigente da instalação (a mais recente não encerrada). */
  async currentOf(spaItemId: number): Promise<Subscription | null> {
    const open = (await this.listByInstallation(spaItemId)).filter(
      s => s.status !== 'cancelled' && s.status !== 'trial_expired',
    )
    return open.sort((a, b) => b.id - a.id)[0] ?? null
  }

  async findByGatewayId(
    gatewaySubscriptionId: string,
  ): Promise<Subscription | null> {
    const raws = await this.crm.listItems(this.subscriptionType, {
      [this.config.subscription.gatewayId]: gatewaySubscriptionId,
    })
    return this.mapSubscriptions(raws)[0] ?? null
  }

  async listByStatus(status: Subscription['status']): Promise<Subscription[]> {
    const id = Object.entries(this.config.subscription.statusEnum).find(
      ([, v]) => v === status,
    )?.[0]
    if (!id) return []
    const raws = await this.crm.listItems(this.subscriptionType, {
      [this.config.subscription.status]: id,
    })
    return this.mapSubscriptions(raws)
  }

  async listModifiedSince(since: Date): Promise<Subscription[]> {
    const raws = await this.crm.listItems(this.subscriptionType, {
      '>=updatedTime': since.toISOString(),
    })
    return this.mapSubscriptions(raws)
  }

  async create(input: SubscriptionWrite): Promise<Subscription> {
    const raw = await this.crm.addItem(
      this.subscriptionType,
      this.mappers.subscriptionFields(input, { create: true }),
    )
    return this.mappers.subscription(raw)
  }

  async update(id: number, input: SubscriptionWrite): Promise<Subscription> {
    const raw = await this.crm.updateItem(
      this.subscriptionType,
      id,
      this.mappers.subscriptionFields(input),
    )
    return this.mappers.subscription(raw)
  }

  async comment(id: number, text: string): Promise<void> {
    await this.crm.addTimelineComment(this.subscriptionType, id, text)
  }

  // ─── Itens ───

  async getItemRaw(id: number): Promise<Record<string, unknown> | null> {
    return this.crm.getItem(this.itemType, id)
  }

  async getItem(id: number): Promise<SubscriptionItem | null> {
    const raw = await this.getItemRaw(id)
    return raw ? this.tryMapItem(raw) : null
  }

  async listItems(subscriptionId: number): Promise<SubscriptionItem[]> {
    const raws = await this.crm.listItems(this.itemType, {
      [this.mappers.subscriptionParent]: subscriptionId,
    })
    return raws
      .map(raw => this.tryMapItem(raw))
      .filter((i): i is SubscriptionItem => i !== null)
  }

  async listItemsModifiedSince(since: Date): Promise<SubscriptionItem[]> {
    const raws = await this.crm.listItems(this.itemType, {
      '>=updatedTime': since.toISOString(),
    })
    return raws
      .map(raw => this.tryMapItem(raw))
      .filter((i): i is SubscriptionItem => i !== null)
  }

  async createItem(input: SubscriptionItemWrite): Promise<SubscriptionItem> {
    const raw = await this.crm.addItem(
      this.itemType,
      this.mappers.subscriptionItemFields(input, { create: true }),
    )
    return this.mappers.subscriptionItem(raw)
  }

  async updateItem(
    id: number,
    input: SubscriptionItemWrite,
  ): Promise<SubscriptionItem> {
    const raw = await this.crm.updateItem(
      this.itemType,
      id,
      this.mappers.subscriptionItemFields(input),
    )
    return this.mappers.subscriptionItem(raw)
  }
}
