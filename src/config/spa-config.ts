import { readFileSync } from 'node:fs'
import z from 'zod'

/**
 * IDs dos SPAs do portal CRMThink, códigos de campo UF e IDs de enum.
 *
 * Os IDs de enum são gerados pelo portal (`isDynamic`): se um SPA for recriado, eles
 * mudam. Por isso vivem em configuração — padrões iguais aos do hub-core, com
 * sobrescrita por arquivo (`SPA_CONFIG_FILE`) — e são conferidos no boot contra
 * `crm.item.fields` (ver `billing/infra/spa/validate-spa-config.ts`).
 *
 * Campos novos da plataforma (Ambiente, trial usado, cargo do contato, `billable`,
 * `externalRef`, versão, `cancelAtPeriodEnd`) são criados pelo dono do portal; os códigos abaixo são os nomes
 * de leitura esperados e devem ser confirmados no onboarding.
 */

const enumMap = z.record(z.string(), z.string())

const spaConfigSchema = z.object({
  entityTypes: z.object({
    product: z.number().int(),
    plan: z.number().int(),
    installation: z.number().int(),
    subscription: z.number().int(),
    subscriptionItem: z.number().int(),
  }),
  product: z.object({
    billingModel: z.string(),
    active: z.string(),
    /** IDs de enum de `billingModel` que significam "compra única". Os demais são assinatura. */
    oneTimeBillingModelIds: z.array(z.string()),
  }),
  plan: z.object({
    product: z.string(),
    value: z.string(),
    interval: z.string(),
    gatewayIdProduction: z.string(),
    gatewayIdHomolog: z.string(),
    active: z.string(),
    /** enum id → intervalo */
    intervalEnum: enumMap,
  }),
  installation: z.object({
    appCode: z.string(),
    domain: z.string(),
    memberId: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    company: z.string(),
    /** Cargo do contato, informado na solicitação de trial. */
    role: z.string(),
    environment: z.string(),
    trialUsed: z.string(),
  }),
  subscription: z.object({
    plan: z.string(),
    client: z.string(),
    status: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
    canceledAt: z.string(),
    gatewayId: z.string(),
    modality: z.string(),
    environment: z.string(),
    version: z.string(),
    cancelAtPeriodEnd: z.string(),
    /** enum id → status */
    statusEnum: enumMap,
  }),
  subscriptionItem: z.object({
    status: z.string(),
    gatewayId: z.string(),
    billable: z.string(),
    externalRef: z.string(),
    metadata: z.string(),
    environment: z.string(),
    version: z.string(),
    deletedAt: z.string(),
    deletedBy: z.string(),
    /** enum id → status */
    statusEnum: enumMap,
  }),
  /**
   * Valor gravado no campo Ambiente, por ambiente. Com campo de lista são IDs de enum;
   * com campo de texto, o próprio rótulo. A leitura aceita os dois.
   */
  environmentValues: z.object({
    production: z.string(),
    homolog: z.string(),
  }),
})

export type SpaConfig = z.infer<typeof spaConfigSchema>

export const DEFAULT_SPA_CONFIG: SpaConfig = {
  entityTypes: {
    product: 1134,
    plan: 1138,
    installation: 1060,
    subscription: 1142,
    subscriptionItem: 1146,
  },
  product: {
    billingModel: 'ufCrm87BillingModel',
    active: 'ufCrm87Active',
    // 13605 Padrão, 13607 Por unidade → assinatura; 14455 Compra única → pacote.
    oneTimeBillingModelIds: ['14455'],
  },
  plan: {
    product: 'ufCrm89Product',
    value: 'ufCrm89Value',
    interval: 'ufCrm89Interval',
    gatewayIdProduction: 'ufCrm89GatewayId',
    gatewayIdHomolog: 'ufCrm89GatewayIdHomolog',
    active: 'ufCrm89Active',
    intervalEnum: {
      '13609': 'monthly',
      '13611': 'quarterly',
      '13613': 'semiannual',
      '13615': 'yearly',
    },
  },
  installation: {
    appCode: 'ufCrm55_1749851506',
    domain: 'ufCrm55_1749851499',
    memberId: 'ufCrm55_1749851446',
    name: 'ufCrm55_1764705031358',
    email: 'ufCrm55_1764705052074',
    phone: 'ufCrm55_1764705060227',
    company: 'ufCrm55_1764705072229',
    role: 'ufCrm55Role',
    environment: 'ufCrm55Environment',
    trialUsed: 'ufCrm55TrialUsed',
  },
  subscription: {
    plan: 'ufCrm91Plan',
    client: 'ufCrm91Client',
    status: 'ufCrm91Status',
    periodStart: 'ufCrm91CurrentPeriodStart',
    periodEnd: 'ufCrm91CurrentPeriodEnd',
    canceledAt: 'ufCrm91CanceledAt',
    gatewayId: 'ufCrm91GatewayId',
    modality: 'ufCrm91Modality',
    environment: 'ufCrm91Environment',
    version: 'ufCrm91Version',
    cancelAtPeriodEnd: 'ufCrm91CancelAtPeriodEnd',
    statusEnum: {
      '13617': 'active',
      '13619': 'trialing',
      '13621': 'past_due',
      '13623': 'cancelled',
      '14353': 'trial_expired',
    },
  },
  subscriptionItem: {
    status: 'ufCrm93Status',
    gatewayId: 'ufCrm93GatewayId',
    billable: 'ufCrm93Billable',
    externalRef: 'ufCrm93ExternalReference',
    metadata: 'ufCrm93Metadata',
    environment: 'ufCrm93Environment',
    version: 'ufCrm93Version',
    deletedAt: 'ufCrm93DeletedAt',
    deletedBy: 'ufCrm93DeletedBy',
    statusEnum: {
      '13625': 'active',
      '13627': 'cancelled',
    },
  },
  environmentValues: {
    production: 'production',
    homolog: 'homolog',
  },
}

function deepMerge<T>(base: T, override: unknown): T {
  if (
    typeof base !== 'object' ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== 'object' ||
    override === null ||
    Array.isArray(override)
  ) {
    return (override === undefined ? base : override) as T
  }
  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  }
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge((base as Record<string, unknown>)[key], value)
  }
  return result as T
}

/** Padrões do hub-core + sobrescritas do arquivo, validados. Lança com o campo inválido. */
export function loadSpaConfig(file?: string): SpaConfig {
  const override: unknown = file
    ? JSON.parse(readFileSync(file, 'utf8'))
    : undefined
  const merged = deepMerge(DEFAULT_SPA_CONFIG, override)
  const parsed = spaConfigSchema.safeParse(merged)
  if (!parsed.success) {
    throw new Error(
      `SPA_CONFIG_FILE inválido: ${parsed.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    )
  }
  return parsed.data
}

/** Nome do campo parent (`parentId1060`) de uma SPA. */
export const parentField = (entityTypeId: number) =>
  `parentId${entityTypeId}` as const

/** Inverte `enum id → valor` para escrita. Um mapa só, impossível de dessincronizar. */
export function invertEnum(
  map: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map).map(([id, value]) => [value, id]),
  )
}
