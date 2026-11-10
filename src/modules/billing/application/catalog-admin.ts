import type { PlatformEnvironment } from '@/config/env'
import type { SpaConfig } from '@/config/spa-config'
import type { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'
import type { Db } from '@/shared/infra/prisma'
import {
  HttpError,
  conflict,
  notFound,
  unprocessable,
  upstream,
} from '@/shared/http/errors'
import type { PlanInterval, Product } from '../domain/entities'
import type { CatalogRepository } from '../infra/spa/catalog-repository'
import {
  InvalidSpaItemError,
  type PlanWrite,
  type ProductWrite,
  type SpaMappers,
} from '../infra/spa/spa-mappers'
import type { SubscriptionRepository } from '../infra/spa/subscription-repository'

/** `trial: true` exige os dois preços nulos: é a ausência de preço que faz o trial. */
export type PlanInput = PlanWrite & { trial: boolean }

export type BillingModelKey = ProductWrite['billingModel']

export type CatalogPlanView = {
  id: number
  productId: number
  name: string
  /** Centavos. */
  amount: number
  interval: PlanInterval | null
  isTrial: boolean
  active: boolean
  priceHomolog: string | null
  priceProduction: string | null
  valid: boolean
  problems: string[]
}

export type CatalogProductView = {
  id: number
  name: string
  /** Id de enum cru do portal. */
  billingModel: string
  /** Valor simbólico aceito por criar/editar; `null` se o id não é nenhum dos conhecidos. */
  billingModelKey: BillingModelKey | null
  kind: 'subscription' | 'one_time' | null
  active: boolean
  valid: boolean
  problems: string[]
  apps: string[]
  plans: CatalogPlanView[]
}

export type CatalogView = {
  writable: boolean
  products: CatalogProductView[]
  /** Planos cujo produto não existe no SPA 1134: sempre `valid:false`. */
  orphanPlans: CatalogPlanView[]
}
export type ProductUsage = { apps: string[]; plans: number }
/**
 * `details` de `CATALOG_WRITE_FAILED` depois que o Bitrix aceitou a escrita: o item
 * (`created` quando a falha veio depois de criá-lo) e os campos que não ficaram
 * gravados (vazio quando a releitura nem chegou a conferir).
 */
export type CatalogWriteFailure = {
  id: number
  created: boolean
  lost: string[]
}
export type PlanUsage = {
  subscriptions: { total: number; active: number }
  trialOfApps: string[]
}

export type CatalogAdminDeps = {
  crm: BitrixRestClient
  config: SpaConfig
  mappers: SpaMappers
  catalog: CatalogRepository
  subscriptions: SubscriptionRepository
  db: Db
  environment: PlatformEnvironment
}

type Raw = Record<string, unknown>

const isBlank = (value: unknown) =>
  value === undefined || value === null || value === ''

const isYes = (value: unknown) =>
  value === true || value === 'Y' || value === '1' || value === 1

/**
 * Campos de sistema obrigatórios nos SPAs 1134 e 1138 (conferência do portal),
 * enviados só na criação.
 */
const CREATE_DEFAULTS: Record<string, unknown> = { opened: 'Y' }

const PLAN_HINT = 'crie um plano novo e desative este'
const PRODUCT_HINT = 'crie um produto novo e desative este'

/** Texto de um valor cru do Bitrix (objeto vira JSON, não `[object Object]`). */
function text(value: unknown): string {
  if (isBlank(value)) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return JSON.stringify(value) ?? ''
}

/** Valor enviado × relido: vazio é vazio, número compara como número. */
function sameValue(sent: unknown, read: unknown, boolean: boolean): boolean {
  if (boolean) return isYes(sent) === isYes(read)
  const a = text(sent)
  const b = text(read)
  if (a === b) return true
  return a !== '' && b !== '' && Number(a) === Number(b)
}

/** Só os campos do `patch`: o que ele não menciona não vai ao Bitrix. */
function pick(
  fields: Record<string, unknown>,
  patch: object,
  codes: Record<string, string>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    const code = codes[key]
    if (value !== undefined && code) picked[code] = fields[code]
  }
  return picked
}

/** 409 com o que usa o item nos `details`. */
const planInUse = (message: string, usage: PlanUsage) =>
  new HttpError(409, 'PLAN_IN_USE', message, usage)
const productInUse = (message: string, usage: ProductUsage) =>
  new HttpError(409, 'PRODUCT_IN_USE', message, usage)

const usageText = (usage: PlanUsage) => {
  const parts: string[] = []
  const { total, active } = usage.subscriptions
  if (total) parts.push(`${total} assinatura(s), ${active} ativa(s)`)
  if (usage.trialOfApps.length)
    parts.push(`plano de trial de ${usage.trialOfApps.join(', ')}`)
  return parts.join('; ')
}

/**
 * Catálogo para o backoffice: leituras frescas do portal (sem cache), com itens
 * inativos e inválidos incluídos e sinalizados. Só o ambiente de produção grava.
 */
export class CatalogAdmin {
  constructor(private readonly deps: CatalogAdminDeps) {}

  async list(): Promise<CatalogView> {
    const { crm, config } = this.deps
    const [products, plans, appsByProduct] = await Promise.all([
      crm.listItems(config.entityTypes.product, {}),
      crm.listItems(config.entityTypes.plan, {}),
      this.appsByProduct(),
    ])
    const views = products.map(raw => {
      const id = Number(raw.id)
      const { view, product } = this.productView(raw)
      const own = plans.filter(p => Number(p[config.plan.product]) === id)
      return {
        ...view,
        apps: appsByProduct.get(id) ?? [],
        plans: own.map(p => this.planView(p, product)),
      }
    })
    const known = new Set(products.map(raw => Number(raw.id)))
    const orphanPlans = plans
      .filter(p => !known.has(Number(p[config.plan.product])))
      .map(p => {
        const view = this.planView(p, null)
        return {
          ...view,
          problems: [`Produto inexistente (#${view.productId})`],
        }
      })
    return {
      writable: this.deps.environment === 'production',
      products: views,
      orphanPlans,
    }
  }

  async productUsage(id: number): Promise<ProductUsage> {
    const { crm, config } = this.deps
    const [apps, plans] = await Promise.all([
      this.deps.db.appProduct.findMany({ where: { productSpaId: id } }),
      crm.listItems(config.entityTypes.plan, { [config.plan.product]: id }),
    ])
    return { apps: apps.map(a => a.appCode).sort(), plans: plans.length }
  }

  async planUsage(id: number): Promise<PlanUsage> {
    const [subscriptions, apps] = await Promise.all([
      this.deps.subscriptions.countByPlan(id),
      this.deps.db.app.findMany({ where: { trialPlanId: id } }),
    ])
    return { subscriptions, trialOfApps: apps.map(a => a.appCode).sort() }
  }

  // ─── Escrita (só produção) ───

  async createProduct(input: ProductWrite): Promise<CatalogProductView> {
    this.assertWritable()
    const type = this.deps.config.entityTypes.product
    const fields = {
      ...this.deps.mappers.productFields(input),
      ...CREATE_DEFAULTS,
    }
    const created = await this.write(() => this.deps.crm.addItem(type, fields))
    const id = Number(created.id)
    await this.deps.catalog.invalidateProduct(id)
    const raw = await this.verify(type, id, fields, true)
    return this.productWithRelations(raw)
  }

  async updateProduct(
    id: number,
    patch: Partial<ProductWrite>,
  ): Promise<CatalogProductView> {
    this.assertWritable()
    const { config, mappers } = this.deps
    const f = config.product
    const type = config.entityTypes.product
    const current = await this.getProduct(id)
    // Valores fora do patch só completam a chamada; `pick` os descarta.
    const all = mappers.productFields({
      name: '',
      billingModel: 'standard',
      active: false,
      ...patch,
    })
    const fields = pick(all, patch, {
      name: 'title',
      billingModel: f.billingModel,
      active: f.active,
    })
    // Preencher um modelo vazio é livre; um id desconhecido pode ser fixado num modelo
    // do mesmo tipo (os planos seguem válidos). Trocar um modelo existente, não.
    const currentKind = this.kindOf(current)
    const nextKind =
      patch.billingModel === 'one_time' ? 'one_time' : 'subscription'
    const filling =
      currentKind === null ||
      (this.productView(current).view.billingModelKey === null &&
        currentKind === nextKind)
    if (
      f.billingModel in fields &&
      !sameValue(fields[f.billingModel], current[f.billingModel], false) &&
      !filling
    ) {
      const usage = await this.productUsage(id)
      if (usage.plans > 0)
        throw productInUse(
          `Produto com ${usage.plans} plano(s) não muda de modelo de cobrança: ${PRODUCT_HINT}`,
          usage,
        )
    }
    if (!Object.keys(fields).length) return this.productWithRelations(current)
    await this.write(() => this.deps.crm.updateItem(type, id, fields))
    await this.deps.catalog.invalidateProduct(id)
    return this.productWithRelations(await this.verify(type, id, fields))
  }

  async deleteProduct(id: number): Promise<void> {
    this.assertWritable()
    const type = this.deps.config.entityTypes.product
    await this.getProduct(id)
    // Uso conferido como último passo antes de excluir (corrida com quem vincula).
    const usage = await this.productUsage(id)
    if (usage.apps.length || usage.plans) {
      const parts = [
        usage.apps.length ? `vinculado a ${usage.apps.join(', ')}` : '',
        usage.plans ? `com ${usage.plans} plano(s): exclua-os primeiro` : '',
      ].filter(Boolean)
      throw productInUse(
        `Produto em uso (${parts.join('; ')}); desative-o em vez de excluir`,
        usage,
      )
    }
    await this.write(() => this.deps.crm.deleteItem(type, id))
    await this.deps.catalog.invalidateProduct(id)
  }

  async createPlan(
    productId: number,
    input: PlanInput,
  ): Promise<CatalogPlanView> {
    this.assertWritable()
    const type = this.deps.config.entityTypes.plan
    const productRaw = await this.getProduct(productId)
    this.validatePlan(input, this.kindOf(productRaw), {
      interval: true,
      trial: true,
    })
    const fields = {
      ...this.deps.mappers.planFields(input, productId),
      ...CREATE_DEFAULTS,
    }
    const created = await this.write(() => this.deps.crm.addItem(type, fields))
    const id = Number(created.id)
    await this.deps.catalog.invalidatePlan(id)
    const raw = await this.verify(type, id, fields, true)
    return this.planView(raw, this.productOrNull(productRaw))
  }

  async updatePlan(
    id: number,
    patch: Partial<PlanInput>,
  ): Promise<CatalogPlanView> {
    this.assertWritable()
    const { crm, config, mappers } = this.deps
    const f = config.plan
    const type = config.entityTypes.plan
    const raw = await this.getPlan(id)
    const current = this.planView(raw, null)
    const next: PlanInput = {
      name: patch.name ?? current.name,
      amount: patch.amount ?? current.amount,
      interval:
        patch.interval !== undefined ? patch.interval : current.interval,
      priceHomolog:
        patch.priceHomolog !== undefined
          ? patch.priceHomolog
          : current.priceHomolog,
      priceProduction:
        patch.priceProduction !== undefined
          ? patch.priceProduction
          : current.priceProduction,
      active: patch.active ?? current.active,
      trial: patch.trial ?? current.isTrial,
    }
    const productRaw = await crm.getItem(
      config.entityTypes.product,
      current.productId,
    )
    this.validatePlan(next, productRaw ? this.kindOf(productRaw) : null, {
      interval: patch.interval !== undefined,
      trial:
        patch.trial !== undefined ||
        patch.priceHomolog !== undefined ||
        patch.priceProduction !== undefined,
    })

    // Preencher um preço ou intervalo vazio é livre; trocar ou apagar um existente, não.
    const priceChanged = (['priceHomolog', 'priceProduction'] as const).some(
      key =>
        patch[key] !== undefined &&
        current[key] !== null &&
        patch[key] !== current[key],
    )
    const trialChanged = next.trial !== current.isTrial
    const intervalChanged =
      patch.interval !== undefined &&
      current.interval !== null &&
      patch.interval !== current.interval
    if (priceChanged || trialChanged || intervalChanged) {
      const usage = await this.planUsage(id)
      const subscribed = usage.subscriptions.total > 0
      const used = subscribed || usage.trialOfApps.length > 0
      const blocked = [
        priceChanged && subscribed ? 'trocar ou apagar o preço' : '',
        trialChanged && used ? 'ligar ou desligar o trial' : '',
        intervalChanged && subscribed ? 'mudar o intervalo' : '',
      ].filter(Boolean)
      if (blocked.length)
        throw planInUse(
          `Plano em uso (${usageText(usage)}) não permite ${blocked.join(', ')}: ${PLAN_HINT}`,
          usage,
        )
    }

    const fields = pick(mappers.planFields(next), patch, {
      name: 'title',
      amount: f.value,
      interval: f.interval,
      priceHomolog: f.gatewayIdHomolog,
      priceProduction: f.gatewayIdProduction,
      active: f.active,
    })
    const product = productRaw ? this.productOrNull(productRaw) : null
    if (!Object.keys(fields).length) return this.planView(raw, product)
    await this.write(() => crm.updateItem(type, id, fields))
    await this.deps.catalog.invalidatePlan(id)
    return this.planView(await this.verify(type, id, fields), product)
  }

  async deletePlan(id: number): Promise<void> {
    this.assertWritable()
    const type = this.deps.config.entityTypes.plan
    await this.getPlan(id)
    // Uso conferido como último passo antes de excluir (corrida com nova assinatura).
    const usage = await this.planUsage(id)
    if (usage.subscriptions.total || usage.trialOfApps.length)
      throw planInUse(
        `Plano em uso (${usageText(usage)}): desative-o em vez de excluir`,
        usage,
      )
    await this.write(() => this.deps.crm.deleteItem(type, id))
    await this.deps.catalog.invalidatePlan(id)
  }

  private assertWritable(): void {
    if (this.deps.environment !== 'production')
      throw conflict(
        'CATALOG_READ_ONLY',
        'O catálogo só é editado no ambiente de produção',
      )
  }

  private async getProduct(id: number): Promise<Raw> {
    const raw = await this.deps.crm.getItem(
      this.deps.config.entityTypes.product,
      id,
    )
    if (!raw) throw notFound('PRODUCT_NOT_FOUND', `Produto #${id} não existe`)
    return raw
  }

  private async getPlan(id: number): Promise<Raw> {
    const raw = await this.deps.crm.getItem(
      this.deps.config.entityTypes.plan,
      id,
    )
    if (!raw) throw notFound('PLAN_NOT_FOUND', `Plano #${id} não existe`)
    return raw
  }

  private kindOf(productRaw: Raw): 'subscription' | 'one_time' | null {
    const f = this.deps.config.product
    const model = productRaw[f.billingModel]
    if (isBlank(model)) return null
    return f.oneTimeBillingModelIds.includes(text(model))
      ? 'one_time'
      : 'subscription'
  }

  private productOrNull(raw: Raw): Product | null {
    return this.productView(raw).product
  }

  private validatePlan(
    input: PlanInput,
    kind: 'subscription' | 'one_time' | null,
    check: { interval: boolean; trial: boolean },
  ): void {
    const invalid = (message: string) =>
      unprocessable('PLAN_INVALID_FOR_PRODUCT', message)
    const priced = Boolean(input.priceHomolog || input.priceProduction)
    if (check.trial && input.trial && priced)
      throw invalid('Plano de trial não tem preço do Stripe')
    if (check.trial && !input.trial && !priced)
      throw invalid(
        'Plano pago precisa de ao menos um id de preço do Stripe (sem preço, ele vira trial)',
      )
    if (!check.interval) return
    if (!kind) throw invalid('Produto sem modelo de cobrança válido')
    if (kind === 'one_time' && input.interval)
      throw invalid('Produto de compra única não tem intervalo')
    if (kind === 'subscription' && !input.interval)
      throw invalid('Plano de assinatura exige intervalo')
  }

  /** Erro do Bitrix numa escrita vira 502; erro da própria regra passa adiante. */
  private async write<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (error) {
      if (error instanceof HttpError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw upstream(
        'CATALOG_WRITE_FAILED',
        `Falha ao gravar no Bitrix: ${message}`,
      )
    }
  }

  /**
   * `crm.item.update` descarta campo desconhecido em silêncio: relê o item e
   * confere cada campo enviado. Na criação, o erro traz o id do item criado.
   */
  private async verify(
    entityTypeId: number,
    id: number,
    sent: Record<string, unknown>,
    created = false,
  ): Promise<Raw> {
    const prefix = created
      ? `Item #${id} criado no Bitrix, mas`
      : `Item #${id} gravado no Bitrix, mas`
    const failed = (message: string, lost: string[] = []) => {
      const details: CatalogWriteFailure = { id, created, lost }
      return upstream('CATALOG_WRITE_FAILED', message, details)
    }
    let raw: Raw | null
    try {
      raw = await this.deps.crm.getItem(entityTypeId, id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw failed(
        `${prefix} a releitura falhou (${message}); confira o item no portal`,
      )
    }
    if (!raw) throw failed(`${prefix} a releitura não o achou`)
    const { product, plan } = this.deps.config
    const booleans = new Set([product.active, plan.active, 'opened'])
    const lost = Object.keys(sent).filter(
      key => !sameValue(sent[key], raw[key], booleans.has(key)),
    )
    if (lost.length)
      throw failed(`${prefix} não gravou: ${lost.join(', ')}`, lost)
    return raw
  }

  private async productWithRelations(raw: Raw): Promise<CatalogProductView> {
    const { view, product } = this.productView(raw)
    const [apps, plans] = await Promise.all([
      this.deps.db.appProduct.findMany({ where: { productSpaId: view.id } }),
      this.deps.crm.listItems(this.deps.config.entityTypes.plan, {
        [this.deps.config.plan.product]: view.id,
      }),
    ])
    return {
      ...view,
      apps: apps.map(a => a.appCode).sort(),
      plans: plans.map(p => this.planView(p, product)),
    }
  }

  private async appsByProduct(): Promise<Map<number, string[]>> {
    const rows = await this.deps.db.appProduct.findMany({})
    const map = new Map<number, string[]>()
    for (const row of rows) {
      const list = map.get(row.productSpaId) ?? []
      list.push(row.appCode)
      map.set(row.productSpaId, list)
    }
    for (const list of map.values()) list.sort()
    return map
  }

  private productView(raw: Raw): {
    view: Omit<CatalogProductView, 'apps' | 'plans'>
    product: Product | null
  } {
    const f = this.deps.config.product
    const rawModel = isBlank(raw[f.billingModel])
      ? ''
      : String(raw[f.billingModel])
    const ids = f.billingModelIds
    const base = {
      id: Number(raw.id),
      name: typeof raw.title === 'string' ? raw.title : '',
      billingModel: rawModel,
      billingModelKey:
        rawModel === ids.standard
          ? ('standard' as const)
          : rawModel === ids.perUnit
            ? ('per_unit' as const)
            : rawModel === ids.oneTime
              ? ('one_time' as const)
              : null,
      active: isYes(raw[f.active]),
    }
    try {
      const product = this.deps.mappers.product(raw)
      return {
        product,
        view: {
          ...base,
          name: product.name,
          billingModel: product.billingModel,
          kind: product.kind,
          active: product.active,
          valid: true,
          problems: [],
        },
      }
    } catch (error) {
      if (!(error instanceof InvalidSpaItemError)) throw error
      const problems = isBlank(raw[f.billingModel])
        ? ['Produto sem modelo de cobrança']
        : error.issues.map(i => i.message)
      return {
        product: null,
        view: { ...base, kind: null, valid: false, problems },
      }
    }
  }

  private planView(raw: Raw, product: Product | null): CatalogPlanView {
    const f = this.deps.config.plan
    const priceHomolog = isBlank(raw[f.gatewayIdHomolog])
      ? null
      : String(raw[f.gatewayIdHomolog])
    const priceProduction = isBlank(raw[f.gatewayIdProduction])
      ? null
      : String(raw[f.gatewayIdProduction])
    const amount = Number(raw[f.value])
    const base = {
      id: Number(raw.id),
      productId: Number(raw[f.product]),
      name: typeof raw.title === 'string' ? raw.title : '',
      amount: Number.isFinite(amount) ? amount : 0,
      interval: (f.intervalEnum[String(raw[f.interval])] ??
        null) as PlanInterval | null,
      isTrial: !priceHomolog && !priceProduction,
      active: isYes(raw[f.active]),
      priceHomolog,
      priceProduction,
    }
    if (!product)
      return {
        ...base,
        valid: false,
        problems: ['Produto do plano ausente ou inválido'],
      }
    try {
      const plan = this.deps.mappers.plan(raw, product)
      return {
        ...base,
        name: plan.name,
        amount: plan.amount,
        interval: plan.interval,
        isTrial: plan.isTrial,
        active: plan.active,
        valid: true,
        problems: [],
      }
    } catch (error) {
      if (!(error instanceof InvalidSpaItemError)) throw error
      const problems = error.issues.map(issue =>
        issue.path.includes(f.value)
          ? 'Valor ausente ou inválido'
          : issue.message,
      )
      return { ...base, valid: false, problems }
    }
  }
}
