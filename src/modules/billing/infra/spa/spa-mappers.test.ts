import { describe, expect, it } from 'vitest'
import { DEFAULT_SPA_CONFIG, loadSpaConfig } from '@/config/spa-config'
import { SpaEnvironment } from '@/shared/spa/environment'
import { InvalidSpaItemError, SpaMappers } from './spa-mappers'
import {
  calendarDaysBetween,
  formatCalendarDate,
  parseSpaCalendarDate,
  toSpaCalendarDateValue,
} from './spa-calendar-date'

const config = {
  ...DEFAULT_SPA_CONFIG,
  product: { ...DEFAULT_SPA_CONFIG.product, oneTimeBillingModelIds: ['99001'] },
}
const environment = new SpaEnvironment('homolog', config.environmentValues)
const mappers = new SpaMappers(config, environment, 'homolog')
const s = config.subscription

const subscriptionRaw = (overrides: Record<string, unknown> = {}) => ({
  id: 3001,
  title: 'GPTMaker — cliente',
  [s.plan]: 501,
  parentId1060: 1001,
  [s.status]: '13617',
  [s.periodStart]: '2026-08-01T00:00:00+03:00',
  [s.periodEnd]: '2026-08-31T00:00:00+03:00',
  [s.gatewayId]: 'sub_1',
  [s.modality]: 'stripe',
  [s.environment]: 'homolog',
  [s.version]: '4',
  ...overrides,
})

describe('mapper de produto e plano', () => {
  const product = mappers.product({
    id: 10,
    title: 'GPTMaker',
    ufCrm87BillingModel: 13605,
    ufCrm87Active: 'Y',
  })
  const oneTime = mappers.product({
    id: 11,
    title: 'Créditos',
    ufCrm87BillingModel: '99001',
    ufCrm87Active: true,
  })

  it('tipo do produto vem do modelo de cobrança', () => {
    expect(product.kind).toBe('subscription')
    expect(oneTime.kind).toBe('one_time')
  })

  it('plano de assinatura exige intervalo', () => {
    const plan = mappers.plan(
      {
        id: 501,
        title: 'Básico',
        ufCrm89Product: 10,
        ufCrm89Value: 9900,
        ufCrm89Interval: '13609',
        ufCrm89Active: 'Y',
        ufCrm89GatewayIdHomolog: 'price_h',
        ufCrm89GatewayId: 'price_p',
      },
      product,
    )
    expect(plan).toMatchObject({
      type: 'subscription',
      interval: 'monthly',
      gatewayPriceId: 'price_h',
      isTrial: false,
    })
    expect(() =>
      mappers.plan(
        {
          id: 502,
          title: 'Sem intervalo',
          ufCrm89Product: 10,
          ufCrm89Value: 1,
          ufCrm89Active: 'Y',
        },
        product,
      ),
    ).toThrow(InvalidSpaItemError)
  })

  it('plano de compra única dispensa intervalo', () => {
    const plan = mappers.plan(
      {
        id: 510,
        title: 'Pacote 1000',
        ufCrm89Product: 11,
        ufCrm89Value: 4900,
        ufCrm89Active: 'Y',
        ufCrm89GatewayIdHomolog: 'price_pack',
      },
      oneTime,
    )
    expect(plan).toMatchObject({ type: 'one_time', interval: null })
  })

  it('preço por ambiente, sem fallback para o outro', () => {
    const production = new SpaMappers(config, environment, 'production')
    const raw = {
      id: 501,
      title: 'Básico',
      ufCrm89Product: 10,
      ufCrm89Value: 9900,
      ufCrm89Interval: '13609',
      ufCrm89Active: 'Y',
      ufCrm89GatewayIdHomolog: 'price_h',
    }
    expect(production.plan(raw, product).gatewayPriceId).toBeNull()
    expect(production.plan(raw, product).isTrial).toBe(false)
    expect(mappers.plan(raw, product).gatewayPriceId).toBe('price_h')
  })

  it('plano sem preço em nenhum ambiente é trial', () => {
    const plan = mappers.plan(
      {
        id: 500,
        title: 'Trial',
        ufCrm89Product: 10,
        ufCrm89Value: 0,
        ufCrm89Interval: '13609',
        ufCrm89Active: 'Y',
      },
      product,
    )
    expect(plan.isTrial).toBe(true)
  })
})

describe('mapper de assinatura', () => {
  it('lê o dia de calendário do offset do portal (sem D-1)', () => {
    const subscription = mappers.subscription(subscriptionRaw())
    expect(subscription.periodStart.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    )
    expect(subscription.periodEnd.toISOString()).toBe(
      '2026-08-31T23:59:59.999Z',
    )
    expect(subscription).toMatchObject({
      status: 'active',
      modality: 'stripe',
      installationSpaItemId: 1001,
      versionMarker: '4',
    })
  })

  it('status desconhecido é erro, não default', () => {
    expect(() =>
      mappers.subscription(subscriptionRaw({ [s.status]: '999' })),
    ).toThrow(/Status de assinatura desconhecido/)
  })

  it('modalidade ausente resolve manual', () => {
    expect(
      mappers.subscription(subscriptionRaw({ [s.modality]: '' })).modality,
    ).toBe('manual')
  })

  it('item sem ambiente conta como production', () => {
    expect(
      mappers.subscription(subscriptionRaw({ [s.environment]: '' }))
        .environment,
    ).toBe('production')
  })

  it('escrita omite campos ausentes e grava ambiente só na criação', () => {
    expect(mappers.subscriptionFields({ status: 'past_due' })).toEqual({
      [s.status]: '13621',
    })
    const created = mappers.subscriptionFields(
      {
        installationSpaItemId: 1001,
        periodEnd: new Date('2026-09-30T23:59:59.999Z'),
      },
      { create: true },
    )
    expect(created).toMatchObject({
      parentId1060: 1001,
      [s.client]: 1001,
      [s.environment]: 'homolog',
    })
    expect(created[s.periodEnd]).toBe('2026-09-30T12:00:00.000Z')
  })
})

describe('mapper de item', () => {
  const it93 = config.subscriptionItem
  it('lê billable, externalRef e metadados (JSON inválido degrada para {})', () => {
    const item = mappers.subscriptionItem({
      id: 9001,
      title: 'Agente 1',
      parentId1142: 3001,
      [it93.status]: '13625',
      [it93.billable]: 'Y',
      [it93.externalRef]: 'agent-1',
      [it93.metadata]: '{quebrado',
    })
    expect(item).toMatchObject({
      subscriptionId: 3001,
      status: 'active',
      billable: true,
      externalRef: 'agent-1',
      metadata: {},
    })
  })
})

describe('datas de calendário', () => {
  it('rejeita data inexistente', () => {
    expect(parseSpaCalendarDate('2026-02-31')).toBeNull()
  })
  it('escrita ao meio-dia UTC', () => {
    expect(toSpaCalendarDateValue(new Date('2026-08-01T23:59:59.999Z'))).toBe(
      '2026-08-01T12:00:00.000Z',
    )
    expect(formatCalendarDate(new Date('2026-08-01T00:00:00Z'))).toBe(
      '2026-08-01',
    )
  })
  it('dias entre instantes pelo dia UTC', () => {
    expect(
      calendarDaysBetween(
        new Date('2026-09-01T23:00:00Z'),
        new Date('2026-09-04T00:30:00Z'),
      ),
    ).toBe(3)
  })
})

describe('configuração dos SPAs', () => {
  it('padrões iguais ao hub-core', () => {
    const loaded = loadSpaConfig()
    expect(loaded.entityTypes).toEqual({
      product: 1134,
      plan: 1138,
      installation: 1060,
      subscription: 1142,
      subscriptionItem: 1146,
    })
    expect(loaded.subscription.statusEnum['13617']).toBe('active')
  })
})
