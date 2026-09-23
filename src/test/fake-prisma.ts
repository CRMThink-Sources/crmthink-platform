import { Prisma } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'

/**
 * Prisma em memória para os testes de serviço: cobre só as operações que o código usa
 * (`find*`, `create`, `update`, `upsert`, `*Many`, `count`, `$transaction` com
 * rollback). Unicidade viola com `P2002`, como o MySQL.
 */

type Row = Record<string, any>
type Relation = { model: string; local: string; foreign: string; many: boolean }

type ModelSpec = {
  pk: string[]
  unique?: string[][]
  autoincrement?: string
  defaults?: () => Row
  relations?: Record<string, Relation>
  compound?: Record<string, string[]>
}

/** Relógio dos defaults (`@default(now())`). O harness aponta para o relógio falso. */
let clockNow: () => Date = () => new Date()
const now = () => clockNow()

const MODELS: Record<string, ModelSpec> = {
  app: {
    pk: ['appCode'],
    unique: [['bitrixClientId'], ['apiKeyHash'], ['previousApiKeyHash']],
    defaults: () => ({
      trialDays: 0,
      trialOnInstall: false,
      active: true,
      createdAt: now(),
      updatedAt: now(),
      logoUrl: null,
      installTheme: null,
      installerUrl: null,
      webhookUrl: null,
      previousWebhookSecretEnc: null,
      previousWebhookSecretUntil: null,
      previousApiKeyHash: null,
      previousApiKeyUntil: null,
      trialPlanId: null,
    }),
    relations: {
      products: {
        model: 'appProduct',
        local: 'appCode',
        foreign: 'appCode',
        many: true,
      },
    },
  },
  appProduct: { pk: ['appCode', 'productSpaId'] },
  installation: {
    pk: ['id'],
    unique: [['appCode', 'memberId'], ['spaItemId']],
    compound: { appCode_memberId: ['appCode', 'memberId'] },
    defaults: () => ({
      trialUsed: false,
      installedAt: now(),
      activatedAt: null,
      uninstalledAt: null,
      everActivated: false,
      pendingReinstall: false,
      contact: null,
      spaItemId: null,
      updatedAt: now(),
    }),
    relations: {
      credential: {
        model: 'credential',
        local: 'id',
        foreign: 'installationId',
        many: false,
      },
      applicationToken: {
        model: 'applicationToken',
        local: 'id',
        foreign: 'installationId',
        many: false,
      },
    },
  },
  credential: {
    pk: ['installationId'],
    defaults: () => ({
      refreshFailures: 0,
      lastRefreshError: null,
      clientEndpoint: null,
      updatedAt: now(),
    }),
    relations: {
      installation: {
        model: 'installation',
        local: 'installationId',
        foreign: 'id',
        many: false,
      },
    },
  },
  applicationToken: {
    pk: ['installationId'],
    defaults: () => ({ receivedAt: now() }),
  },
  installAttempt: {
    pk: ['id'],
    autoincrement: 'id',
    defaults: () => ({ createdAt: now(), error: null }),
  },
  signingKey: {
    pk: ['kid'],
    defaults: () => ({ createdAt: now(), activatedAt: null, retiredAt: null }),
  },
  stripeEvent: {
    pk: ['eventId'],
    defaults: () => ({
      receivedAt: now(),
      processedAt: null,
      attempts: 0,
      error: null,
      appCode: null,
      payload: null,
    }),
  },
  subscriptionVersion: {
    pk: ['subscriptionSpaId'],
    defaults: () => ({
      version: 0,
      lastWrittenMarker: null,
      lastSnapshot: null,
      updatedAt: now(),
    }),
  },
  itemVersion: {
    pk: ['itemSpaId'],
    defaults: () => ({
      version: 0,
      lastWrittenMarker: null,
      lastSnapshot: null,
      updatedAt: now(),
    }),
  },
  sweepRun: {
    pk: ['id'],
    autoincrement: 'id',
    defaults: () => ({
      startedAt: now(),
      finishedAt: null,
      fixed: 0,
      errors: 0,
      detail: null,
    }),
  },
  periodNotice: {
    pk: ['subscriptionSpaId', 'periodEnd', 'daysLeft'],
    defaults: () => ({ createdAt: now() }),
  },
  purchase: {
    pk: ['id'],
    autoincrement: 'id',
    unique: [['checkoutSessionId'], ['chargeId'], ['paymentIntentId']],
    defaults: () => ({
      quantity: 1,
      chargeId: null,
      paymentIntentId: null,
      amount: null,
      amountRefunded: 0,
      createdAt: now(),
      updatedAt: now(),
    }),
  },
  outboxEvent: {
    pk: ['eventId'],
    unique: [['dedupeKey'], ['seq']],
    autoincrement: 'seq',
    defaults: () => ({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now(),
      windowStartedAt: now(),
      deliveredAt: null,
      deadAt: null,
      createdAt: now(),
      subscriptionId: null,
      version: null,
      dedupeKey: null,
    }),
    relations: {
      deliveries: {
        model: 'eventDelivery',
        local: 'eventId',
        foreign: 'eventId',
        many: true,
      },
    },
  },
  eventDelivery: {
    pk: ['id'],
    autoincrement: 'id',
    defaults: () => ({
      statusCode: null,
      error: null,
      nextAttemptAt: null,
      deliveredAt: null,
      createdAt: now(),
    }),
  },
}

const uniqueError = (model: string, fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on ${model}(${fields.join(',')})`,
    {
      code: 'P2002',
      clientVersion: 'fake',
    },
  )

const notFoundError = (model: string) =>
  new Prisma.PrismaClientKnownRequestError(`No ${model} found`, {
    code: 'P2025',
    clientVersion: 'fake',
  })

const isPlainObject = (value: unknown): value is Row =>
  typeof value === 'object' &&
  value !== null &&
  !(value instanceof Date) &&
  !Array.isArray(value)

const clone = <T>(value: T): T => structuredClone(value)

function normalizeValue(value: unknown): unknown {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return null
  return value
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Date || b instanceof Date) return false
  return a === b
}

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string)
  const y = b instanceof Date ? b.getTime() : (b as number | string)
  return x < y ? -1 : x > y ? 1 : 0
}

export class FakePrisma {
  store: Record<string, Row[]> = Object.fromEntries(
    Object.keys(MODELS).map(name => [name, []]),
  )
  private counters: Record<string, number> = {}

  constructor() {
    for (const name of Object.keys(MODELS)) {
      ;(this as any)[name] = this.delegate(name)
    }
  }

  useClock(fn: () => Date): this {
    clockNow = fn
    return this
  }

  asDb(): Db {
    return this as unknown as Db
  }

  rows(model: string): Row[] {
    return this.store[model] as Row[]
  }

  private spec(model: string): ModelSpec {
    return MODELS[model] as ModelSpec
  }

  private expandWhere(model: string, where: Row = {}): Row {
    const compound = this.spec(model).compound ?? {}
    const result: Row = {}
    for (const [key, value] of Object.entries(where)) {
      if (compound[key] && isPlainObject(value)) Object.assign(result, value)
      else result[key] = value
    }
    return result
  }

  matches(model: string, row: Row, where: Row = {}): boolean {
    const spec = this.spec(model)
    for (const [key, condition] of Object.entries(
      this.expandWhere(model, where),
    )) {
      if (condition === undefined) continue
      if (key === 'OR') {
        if (!(condition as Row[]).some(sub => this.matches(model, row, sub)))
          return false
        continue
      }
      if (key === 'AND') {
        if (!(condition as Row[]).every(sub => this.matches(model, row, sub)))
          return false
        continue
      }
      const relation = spec.relations?.[key]
      if (relation) {
        const related = this.rows(relation.model).filter(r =>
          eq(r[relation.foreign], row[relation.local]),
        )
        if (
          !related.some(r => this.matches(relation.model, r, condition as Row))
        )
          return false
        continue
      }
      const value = row[key]
      if (isPlainObject(condition)) {
        for (const [op, operand] of Object.entries(condition)) {
          if (operand === undefined) continue
          switch (op) {
            case 'equals':
              if (!eq(value, operand)) return false
              break
            case 'in':
              if (!(operand as unknown[]).some(o => eq(value, o))) return false
              break
            case 'notIn':
              if ((operand as unknown[]).some(o => eq(value, o))) return false
              break
            case 'not':
              if (
                operand === null
                  ? value === null || value === undefined
                  : eq(value, operand)
              )
                return false
              break
            case 'lt':
              if (value == null || cmp(value, operand) >= 0) return false
              break
            case 'lte':
              if (value == null || cmp(value, operand) > 0) return false
              break
            case 'gt':
              if (value == null || cmp(value, operand) <= 0) return false
              break
            case 'gte':
              if (value == null || cmp(value, operand) < 0) return false
              break
            default:
              throw new Error(`FakePrisma: operador não suportado ${op}`)
          }
        }
        continue
      }
      if (
        condition === null
          ? value !== null && value !== undefined
          : !eq(value, condition)
      )
        return false
    }
    return true
  }

  private withIncludes(model: string, row: Row, include?: Row): Row {
    const result = clone(row)
    if (!include) return result
    const spec = this.spec(model)
    for (const [name, option] of Object.entries(include)) {
      if (!option) continue
      const relation = spec.relations?.[name]
      if (!relation) continue
      let related = this.rows(relation.model).filter(r =>
        eq(r[relation.foreign], row[relation.local]),
      )
      if (isPlainObject(option))
        related = this.sortTake(related, option.orderBy, option.take)
      result[name] = relation.many
        ? related.map(clone)
        : related[0]
          ? clone(related[0])
          : null
    }
    return result
  }

  private sortTake(rows: Row[], orderBy?: Row | Row[], take?: number): Row[] {
    let result = [...rows]
    const orders = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : []
    if (orders.length) {
      result.sort((a, b) => {
        for (const order of orders) {
          for (const [field, dir] of Object.entries(order)) {
            const c = cmp(a[field] ?? 0, b[field] ?? 0)
            if (c !== 0) return dir === 'desc' ? -c : c
          }
        }
        return 0
      })
    }
    if (take !== undefined) result = result.slice(0, take)
    return result
  }

  private checkUnique(model: string, candidate: Row, self?: Row): void {
    const spec = this.spec(model)
    for (const fields of [spec.pk, ...(spec.unique ?? [])]) {
      if (fields.some(f => candidate[f] === null || candidate[f] === undefined))
        continue
      const clash = this.rows(model).find(
        r => r !== self && fields.every(f => eq(r[f], candidate[f])),
      )
      if (clash) throw uniqueError(model, fields)
    }
  }

  private applyData(row: Row, data: Row): Row {
    const next = { ...row }
    for (const [key, raw] of Object.entries(data)) {
      if (raw === undefined) continue
      const value = normalizeValue(raw)
      if (
        isPlainObject(value) &&
        ('increment' in value || 'decrement' in value || 'set' in value)
      ) {
        if ('increment' in value) next[key] = (next[key] ?? 0) + value.increment
        if ('decrement' in value) next[key] = (next[key] ?? 0) - value.decrement
        if ('set' in value) next[key] = value.set
        continue
      }
      next[key] = value
    }
    if ('updatedAt' in next) next.updatedAt = now()
    return next
  }

  private createRow(model: string, data: Row): Row {
    const spec = this.spec(model)
    const nested: Array<[Relation, Row[]]> = []
    const flat: Row = {}
    for (const [key, value] of Object.entries(data)) {
      const relation = spec.relations?.[key]
      if (relation && isPlainObject(value) && 'create' in value) {
        const creates = Array.isArray(value.create)
          ? value.create
          : [value.create]
        nested.push([relation, creates])
      } else {
        flat[key] = value
      }
    }
    let row = this.applyData({ ...(spec.defaults?.() ?? {}) }, flat)
    if (spec.autoincrement && row[spec.autoincrement] === undefined) {
      this.counters[model] = (this.counters[model] ?? 0) + 1
      row[spec.autoincrement] = this.counters[model]
    }
    this.checkUnique(model, row)
    this.rows(model).push(row)
    for (const [relation, creates] of nested) {
      for (const child of creates) {
        this.createRow(relation.model, {
          ...child,
          [relation.foreign]: row[relation.local],
        })
      }
    }
    row = this.rows(model).find(r => r === row) as Row
    return row
  }

  private delegate(model: string) {
    const find = (where?: Row) =>
      this.rows(model).filter(r => this.matches(model, r, where))
    return {
      findUnique: async (args: Row) => {
        const row = find(args.where)[0]
        return row ? this.withIncludes(model, row, args.include) : null
      },
      findFirst: async (args: Row = {}) => {
        const row = this.sortTake(find(args.where), args.orderBy, 1)[0]
        return row ? this.withIncludes(model, row, args.include) : null
      },
      findMany: async (args: Row = {}) =>
        this.sortTake(find(args.where), args.orderBy, args.take).map(r =>
          this.withIncludes(model, r, args.include),
        ),
      count: async (args: Row = {}) => find(args.where).length,
      create: async (args: Row) =>
        this.withIncludes(
          model,
          this.createRow(model, args.data),
          args.include,
        ),
      createMany: async (args: Row) => {
        for (const data of args.data as Row[]) this.createRow(model, data)
        return { count: (args.data as Row[]).length }
      },
      update: async (args: Row) => {
        const row = find(args.where)[0]
        if (!row) throw notFoundError(model)
        const next = this.applyData(row, args.data)
        this.checkUnique(model, next, row)
        Object.assign(row, next)
        return this.withIncludes(model, row, args.include)
      },
      updateMany: async (args: Row) => {
        const rows = find(args.where)
        for (const row of rows)
          Object.assign(row, this.applyData(row, args.data))
        return { count: rows.length }
      },
      upsert: async (args: Row) => {
        const row = find(args.where)[0]
        if (row) {
          Object.assign(row, this.applyData(row, args.update))
          return this.withIncludes(model, row, args.include)
        }
        return this.withIncludes(
          model,
          this.createRow(model, args.create),
          args.include,
        )
      },
      delete: async (args: Row) => {
        const row = find(args.where)[0]
        if (!row) throw notFoundError(model)
        this.store[model] = this.rows(model).filter(r => r !== row)
        return row
      },
      deleteMany: async (args: Row = {}) => {
        const rows = find(args.where)
        this.store[model] = this.rows(model).filter(r => !rows.includes(r))
        return { count: rows.length }
      },
    }
  }

  async $transaction(input: unknown): Promise<unknown> {
    if (Array.isArray(input)) return Promise.all(input)
    const snapshot = clone(this.store)
    const counters = { ...this.counters }
    try {
      return await (input as (tx: unknown) => Promise<unknown>)(this)
    } catch (error) {
      this.store = snapshot
      this.counters = counters
      throw error
    }
  }

  async $queryRawUnsafe(): Promise<unknown[]> {
    return [{ 1: 1 }]
  }

  async $disconnect(): Promise<void> {}
}
