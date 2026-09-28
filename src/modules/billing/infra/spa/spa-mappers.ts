import z from 'zod'
import type { PlatformEnvironment } from '@/config/env'
import { invertEnum, parentField, type SpaConfig } from '@/config/spa-config'
import type { SpaEnvironment } from '@/shared/spa/environment'
import { logger } from '@/shared/observability/logger'
import type {
  Plan,
  PlanInterval,
  Product,
  Subscription,
  SubscriptionItem,
  SubscriptionItemStatus,
  SubscriptionModality,
  SubscriptionStatus,
} from '../../domain/entities'
import {
  endOfCalendarDay,
  parseSpaCalendarDate,
  startOfCalendarDay,
  toSpaCalendarDateValue,
} from './spa-calendar-date'

/**
 * Mappers SPA ↔ domínio, portados de `infra/bitrix/mappers/*` do hub-core com os
 * códigos de campo e IDs de enum vindos de `SpaConfig` (D10).
 *
 * Mesma postura do original: enum desconhecido é **erro** (assumir `active` daria
 * acesso a assinatura cancelada); modalidade ausente é `manual`; campo omitido na
 * escrita nunca é enviado como `null` (apagaria o que o patch não menciona).
 */

export class InvalidSpaItemError extends Error {
  constructor(
    readonly entity: 'product' | 'plan' | 'subscription' | 'subscriptionItem',
    readonly itemId: unknown,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(
      `Item inválido no SPA (${entity} ${String(itemId)}): ${issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    )
    this.name = 'InvalidSpaItemError'
  }
}

const bitrixBoolean = z
  .union([
    z.boolean(),
    z.literal('Y'),
    z.literal('N'),
    z.literal('1'),
    z.literal('0'),
    z.number(),
    z.null(),
    z.undefined(),
  ])
  .transform(
    value => value === true || value === 'Y' || value === '1' || value === 1,
  )

const requiredRef = z
  .union([z.string().min(1), z.number()])
  .transform(Number)
  .refine(value => Number.isInteger(value) && value > 0, {
    message: 'Referência obrigatória ausente',
  })

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform(value =>
    value === undefined || value === null || value === ''
      ? null
      : String(value),
  )

const enumValue = <T extends string>(
  map: Record<string, string>,
  label: string,
) =>
  z.unknown().transform((raw, ctx): T => {
    const value = map[String(raw)]
    if (!value) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} desconhecido: ${JSON.stringify(raw)}`,
      })
      return z.NEVER
    }
    return value as T
  })

const calendarDate = (anchor: typeof startOfCalendarDay) =>
  z.unknown().transform((raw, ctx): Date => {
    const day = parseSpaCalendarDate(raw)
    if (!day) {
      ctx.addIssue({ code: 'custom', message: 'Data de período inválida' })
      return z.NEVER
    }
    return anchor(day)
  })

const optionalDateTime = z.unknown().transform(raw => {
  if (typeof raw !== 'string' || raw === '') return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
})

/**
 * Campo ausente no payload do Bitrix vira `null` antes do parse: no Zod 4, chave
 * ausente com transform é tratada como obrigatória, e `null` é o que os parsers
 * tolerantes (modalidade, booleano, texto opcional) já sabem ler como vazio.
 */
function withNulls(
  raw: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const filled: Record<string, unknown> = Object.fromEntries(
    keys.map(key => [key, null]),
  )
  for (const [key, value] of Object.entries(raw))
    if (value !== undefined) filled[key] = value
  return filled
}

const MODALITIES: readonly SubscriptionModality[] = ['stripe', 'manual']

const modality = z.unknown().transform((raw): SubscriptionModality => {
  if (raw === undefined || raw === null || raw === '') return 'manual'
  const value =
    typeof raw === 'string' || typeof raw === 'number'
      ? String(raw)
      : JSON.stringify(raw)
  if ((MODALITIES as readonly string[]).includes(value))
    return value as SubscriptionModality
  logger().warn(
    { value },
    'modalidade de assinatura desconhecida — resolvendo como manual',
  )
  return 'manual'
})

export type SubscriptionWrite = Partial<{
  title: string
  installationSpaItemId: number
  planId: number
  status: SubscriptionStatus
  modality: SubscriptionModality
  periodStart: Date
  periodEnd: Date
  canceledAt: Date | null
  gatewaySubscriptionId: string | null
  cancelAtPeriodEnd: boolean
  versionMarker: string
}>

export type SubscriptionItemWrite = Partial<{
  title: string
  subscriptionId: number
  status: SubscriptionItemStatus
  billable: boolean
  externalRef: string
  metadata: Record<string, unknown>
  gatewayItemId: string | null
  deletedAt: Date | null
  deletedBy: string | null
  versionMarker: string
}>

export class SpaMappers {
  private readonly subscriptionStatusIds: Record<string, string>
  private readonly itemStatusIds: Record<string, string>

  constructor(
    private readonly config: SpaConfig,
    private readonly environment: SpaEnvironment,
    /** Ambiente da conta Stripe (prefixo da chave), que escolhe o campo de price id. */
    private readonly stripeEnvironment: PlatformEnvironment,
  ) {
    this.subscriptionStatusIds = invertEnum(config.subscription.statusEnum)
    this.itemStatusIds = invertEnum(config.subscriptionItem.statusEnum)
  }

  get installationParent(): string {
    return parentField(this.config.entityTypes.installation)
  }

  get subscriptionParent(): string {
    return parentField(this.config.entityTypes.subscription)
  }

  // ─── Produto (1134) ───

  product(raw: Record<string, unknown>): Product {
    const f = this.config.product
    const schema = z.object({
      id: requiredRef,
      title: z
        .string()
        .nullish()
        .transform(value => value ?? ''),
      [f.billingModel]: z
        .union([z.string().min(1), z.number()])
        .transform(String),
      [f.active]: bitrixBoolean,
    })
    const parsed = schema.safeParse(withNulls(raw, Object.keys(schema.shape)))
    if (!parsed.success)
      throw new InvalidSpaItemError('product', raw.id, parsed.error.issues)
    const data = parsed.data as Record<string, unknown>
    const billingModel = String(data[f.billingModel])
    return {
      id: data.id as number,
      name: data.title as string,
      billingModel,
      kind: f.oneTimeBillingModelIds.includes(billingModel)
        ? 'one_time'
        : 'subscription',
      active: data[f.active] as boolean,
    }
  }

  // ─── Plano (1138) ───

  /**
   * O tipo vem do produto; a validação do intervalo depende dele, então o plano é
   * mapeado já com o produto em mãos.
   */
  plan(raw: Record<string, unknown>, product: Product): Plan {
    const f = this.config.plan
    const schema = z.object({
      id: requiredRef,
      title: z
        .string()
        .nullish()
        .transform(value => value ?? ''),
      [f.product]: requiredRef,
      [f.value]: z
        .union([z.number(), z.string().min(1)])
        .transform(Number)
        .pipe(z.number().int().nonnegative()),
      [f.gatewayIdProduction]: optionalText,
      [f.gatewayIdHomolog]: optionalText,
      [f.active]: bitrixBoolean,
    })
    const parsed = schema.safeParse(withNulls(raw, Object.keys(schema.shape)))
    if (!parsed.success)
      throw new InvalidSpaItemError('plan', raw.id, parsed.error.issues)
    const data = parsed.data as Record<string, unknown>

    const type = product.kind
    let interval: PlanInterval | null = null
    if (type === 'subscription') {
      const mapped = f.intervalEnum[String(raw[f.interval])]
      if (!mapped) {
        throw new InvalidSpaItemError('plan', raw.id, [
          {
            code: 'custom',
            path: [f.interval],
            message:
              'Plano de assinatura sem intervalo (mensal, trimestral, semestral ou anual)',
            input: raw[f.interval],
          },
        ])
      }
      interval = mapped as PlanInterval
    }

    const production = data[f.gatewayIdProduction] as string | null
    const homolog = data[f.gatewayIdHomolog] as string | null
    const current =
      this.stripeEnvironment === 'production' ? production : homolog

    return {
      id: data.id as number,
      productId: data[f.product] as number,
      name: data.title as string,
      amount: data[f.value] as number,
      interval,
      type,
      gatewayPriceId: current,
      isTrial: !production && !homolog,
      active: data[f.active] as boolean,
    }
  }

  // ─── Assinatura (1142) ───

  subscription(raw: Record<string, unknown>): Subscription {
    const f = this.config.subscription
    const parent = this.installationParent
    const schema = z.object({
      id: requiredRef,
      title: z
        .string()
        .nullish()
        .transform(value => value ?? ''),
      [f.plan]: requiredRef,
      [parent]: requiredRef,
      [f.status]: enumValue<SubscriptionStatus>(
        f.statusEnum,
        'Status de assinatura',
      ),
      [f.periodStart]: calendarDate(startOfCalendarDay),
      [f.periodEnd]: calendarDate(endOfCalendarDay),
      [f.canceledAt]: optionalDateTime,
      [f.gatewayId]: optionalText,
      [f.modality]: modality,
      [f.cancelAtPeriodEnd]: bitrixBoolean,
      [f.version]: optionalText,
    })
    const parsed = schema.safeParse(withNulls(raw, Object.keys(schema.shape)))
    if (!parsed.success)
      throw new InvalidSpaItemError('subscription', raw.id, parsed.error.issues)
    const data = parsed.data as Record<string, unknown>
    return {
      id: data.id as number,
      title: data.title as string,
      installationSpaItemId: data[parent] as number,
      planId: data[f.plan] as number,
      status: data[f.status] as SubscriptionStatus,
      modality: data[f.modality] as SubscriptionModality,
      periodStart: data[f.periodStart] as Date,
      periodEnd: data[f.periodEnd] as Date,
      canceledAt: data[f.canceledAt] as Date | null,
      gatewaySubscriptionId: data[f.gatewayId] as string | null,
      cancelAtPeriodEnd: data[f.cancelAtPeriodEnd] as boolean,
      environment: this.environment.resolve(raw[f.environment]),
      versionMarker: data[f.version] as string | null,
    }
  }

  subscriptionFields(
    input: SubscriptionWrite,
    options: { create?: boolean } = {},
  ): Record<string, unknown> {
    const f = this.config.subscription
    const fields: Record<string, unknown> = {}
    if (input.title !== undefined) fields.title = input.title
    if (input.installationSpaItemId !== undefined) {
      fields[this.installationParent] = input.installationSpaItemId
      fields[f.client] = input.installationSpaItemId
    }
    if (input.planId !== undefined) fields[f.plan] = input.planId
    if (input.status !== undefined)
      fields[f.status] = this.subscriptionStatusIds[input.status]
    if (input.modality !== undefined) fields[f.modality] = input.modality
    if (input.periodStart !== undefined)
      fields[f.periodStart] = toSpaCalendarDateValue(input.periodStart)
    if (input.periodEnd !== undefined)
      fields[f.periodEnd] = toSpaCalendarDateValue(input.periodEnd)
    if (input.canceledAt !== undefined)
      fields[f.canceledAt] = input.canceledAt
        ? input.canceledAt.toISOString()
        : ''
    if (input.gatewaySubscriptionId !== undefined)
      fields[f.gatewayId] = input.gatewaySubscriptionId ?? ''
    if (input.cancelAtPeriodEnd !== undefined)
      fields[f.cancelAtPeriodEnd] = input.cancelAtPeriodEnd ? 'Y' : 'N'
    if (input.versionMarker !== undefined)
      fields[f.version] = input.versionMarker
    if (options.create) fields[f.environment] = this.environment.writeValue
    return fields
  }

  // ─── Item de assinatura (1146) ───

  subscriptionItem(raw: Record<string, unknown>): SubscriptionItem {
    const f = this.config.subscriptionItem
    const parent = this.subscriptionParent
    const schema = z.object({
      id: requiredRef,
      title: z
        .string()
        .nullish()
        .transform(value => value ?? ''),
      [parent]: requiredRef,
      [f.status]: enumValue<SubscriptionItemStatus>(
        f.statusEnum,
        'Status de item',
      ),
      [f.billable]: bitrixBoolean,
      [f.externalRef]: optionalText,
      [f.gatewayId]: optionalText,
      [f.metadata]: z.unknown(),
      [f.deletedAt]: optionalDateTime,
      [f.deletedBy]: optionalText,
      [f.version]: optionalText,
    })
    const parsed = schema.safeParse(withNulls(raw, Object.keys(schema.shape)))
    if (!parsed.success)
      throw new InvalidSpaItemError(
        'subscriptionItem',
        raw.id,
        parsed.error.issues,
      )
    const data = parsed.data as Record<string, unknown>
    return {
      id: data.id as number,
      subscriptionId: data[parent] as number,
      title: data.title as string,
      status: data[f.status] as SubscriptionItemStatus,
      billable: data[f.billable] as boolean,
      externalRef: data[f.externalRef] as string | null,
      metadata: parseMetadata(data[f.metadata]),
      gatewayItemId: data[f.gatewayId] as string | null,
      environment: this.environment.resolve(raw[f.environment]),
      deletedAt: data[f.deletedAt] as Date | null,
      deletedBy: data[f.deletedBy] as string | null,
      versionMarker: data[f.version] as string | null,
    }
  }

  subscriptionItemFields(
    input: SubscriptionItemWrite,
    options: { create?: boolean } = {},
  ): Record<string, unknown> {
    const f = this.config.subscriptionItem
    const fields: Record<string, unknown> = {}
    if (input.title !== undefined) fields.title = input.title
    if (input.subscriptionId !== undefined)
      fields[this.subscriptionParent] = input.subscriptionId
    if (input.status !== undefined)
      fields[f.status] = this.itemStatusIds[input.status]
    if (input.billable !== undefined)
      fields[f.billable] = input.billable ? 'Y' : 'N'
    if (input.externalRef !== undefined)
      fields[f.externalRef] = input.externalRef
    if (input.metadata !== undefined)
      fields[f.metadata] = JSON.stringify(input.metadata)
    if (input.gatewayItemId !== undefined)
      fields[f.gatewayId] = input.gatewayItemId ?? ''
    if (input.deletedAt !== undefined)
      fields[f.deletedAt] = input.deletedAt ? input.deletedAt.toISOString() : ''
    if (input.deletedBy !== undefined)
      fields[f.deletedBy] = input.deletedBy ?? ''
    if (input.versionMarker !== undefined)
      fields[f.version] = input.versionMarker
    if (options.create) fields[f.environment] = this.environment.writeValue
    return fields
  }
}

/** JSON de metadados do item: degrada para `{}` em vez de reprovar o item. */
function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
