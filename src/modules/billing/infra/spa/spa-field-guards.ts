import type { SpaConfig } from '@/config/spa-config'
import type { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'

/**
 * Guardas `ensure*Field` (portadas de `infra/bitrix/ensure-*.ts` do hub-core) e a
 * validação da configuração dos SPAs no boot.
 *
 * Por que existem: `crm.item.update` aceita campo **desconhecido** e responde
 * sucesso, descartando o valor; e campo criado como **lista** devolve id de enum, não
 * o valor. Nos dois casos a escrita "funciona" e a leitura resolve o default, sem
 * erro nem log. Por isso a checagem reprova campo ausente, texto criado como lista e
 * enum com ID que o portal não tem.
 */

type FieldSpec = {
  field: string
  kind: 'text' | 'enum' | 'any'
  /** IDs de enum que precisam existir no campo. */
  enumIds?: string[]
}

export type SpaProblem = {
  entityTypeId: number
  field: string
  problem: string
}

type FieldsReader = Pick<BitrixRestClient, 'itemFields'>

export class SpaFieldMissingError extends Error {
  constructor(readonly problems: SpaProblem[]) {
    super(
      `Configuração dos SPAs incompatível com o portal: ${problems
        .map(p => `SPA ${p.entityTypeId}.${p.field}: ${p.problem}`)
        .join('; ')}`,
    )
    this.name = 'SpaFieldMissingError'
  }
}

export async function checkSpaFields(
  crm: FieldsReader,
  entityTypeId: number,
  specs: FieldSpec[],
): Promise<SpaProblem[]> {
  const fields = await crm.itemFields(entityTypeId)
  const problems: SpaProblem[] = []
  for (const spec of specs) {
    const field = fields[spec.field]
    if (!field) {
      problems.push({
        entityTypeId,
        field: spec.field,
        problem: 'campo não existe',
      })
      continue
    }
    if (spec.kind === 'text' && field.type === 'enumeration') {
      problems.push({
        entityTypeId,
        field: spec.field,
        problem:
          'campo é do tipo lista; precisa ser texto (lista devolve id de enum)',
      })
    }
    if (spec.kind === 'enum' && spec.enumIds?.length) {
      const known = new Set((field.items ?? []).map(item => String(item.ID)))
      const missing = spec.enumIds.filter(id => !known.has(id))
      if (missing.length) {
        problems.push({
          entityTypeId,
          field: spec.field,
          problem: `IDs de enum inexistentes no portal: ${missing.join(', ')}`,
        })
      }
    }
  }
  return problems
}

/** Guarda pontual antes de uma escrita que depende do campo. Lança com o problema. */
export async function ensureSpaFields(
  crm: FieldsReader,
  entityTypeId: number,
  specs: FieldSpec[],
): Promise<void> {
  const problems = await checkSpaFields(crm, entityTypeId, specs)
  if (problems.length) throw new SpaFieldMissingError(problems)
}

/** Todos os SPAs, campos e enums da configuração. Vazio = compatível. */
export async function validateSpaConfig(
  crm: FieldsReader,
  config: SpaConfig,
): Promise<SpaProblem[]> {
  const envIsEnum = config.environmentValues.production !== 'production'
  const envSpec = (field: string): FieldSpec =>
    envIsEnum
      ? {
          field,
          kind: 'enum',
          enumIds: [
            config.environmentValues.production,
            config.environmentValues.homolog,
          ],
        }
      : { field, kind: 'text' }

  const p = config.product
  const pl = config.plan
  const i = config.installation
  const s = config.subscription
  const it = config.subscriptionItem
  const e = config.entityTypes

  const checks: Array<Promise<SpaProblem[]>> = [
    checkSpaFields(crm, e.product, [
      {
        field: p.billingModel,
        kind: 'enum',
        enumIds: p.oneTimeBillingModelIds,
      },
      { field: p.active, kind: 'any' },
    ]),
    checkSpaFields(crm, e.plan, [
      { field: pl.product, kind: 'any' },
      { field: pl.value, kind: 'any' },
      {
        field: pl.interval,
        kind: 'enum',
        enumIds: Object.keys(pl.intervalEnum),
      },
      { field: pl.gatewayIdProduction, kind: 'text' },
      { field: pl.gatewayIdHomolog, kind: 'text' },
      { field: pl.active, kind: 'any' },
    ]),
    checkSpaFields(crm, e.installation, [
      { field: i.appCode, kind: 'text' },
      { field: i.domain, kind: 'text' },
      { field: i.memberId, kind: 'text' },
      { field: i.email, kind: 'any' },
      { field: i.name, kind: 'any' },
      { field: i.phone, kind: 'any' },
      { field: i.company, kind: 'any' },
      { field: i.trialUsed, kind: 'any' },
      envSpec(i.environment),
    ]),
    checkSpaFields(crm, e.subscription, [
      { field: s.plan, kind: 'any' },
      { field: s.client, kind: 'any' },
      { field: s.status, kind: 'enum', enumIds: Object.keys(s.statusEnum) },
      { field: s.periodStart, kind: 'any' },
      { field: s.periodEnd, kind: 'any' },
      { field: s.canceledAt, kind: 'any' },
      { field: s.gatewayId, kind: 'text' },
      { field: s.modality, kind: 'text' },
      { field: s.version, kind: 'text' },
      { field: s.cancelAtPeriodEnd, kind: 'any' },
      envSpec(s.environment),
    ]),
    checkSpaFields(crm, e.subscriptionItem, [
      { field: it.status, kind: 'enum', enumIds: Object.keys(it.statusEnum) },
      { field: it.gatewayId, kind: 'text' },
      { field: it.billable, kind: 'any' },
      { field: it.externalRef, kind: 'text' },
      { field: it.metadata, kind: 'text' },
      { field: it.version, kind: 'text' },
      { field: it.deletedAt, kind: 'any' },
      { field: it.deletedBy, kind: 'any' },
      envSpec(it.environment),
    ]),
  ]

  const results = await Promise.all(
    checks.map(check =>
      check.catch((error: unknown) => [
        {
          entityTypeId: 0,
          field: '*',
          problem: `não foi possível ler crm.item.fields: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]),
    ),
  )
  return results.flat()
}
