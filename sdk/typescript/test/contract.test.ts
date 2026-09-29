import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONTRACT_PATH,
  renderSdkTypes,
  TYPES_PATH,
} from '../scripts/generate-types.js'
import { OPERATIONS, type PlatformEventType } from '../src/index.js'

type Contract = {
  paths: Record<
    string,
    Record<string, { operationId?: string; security?: object[] }>
  >
  webhooks: Record<string, unknown>
}

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as Contract

/** Faltar ou sobrar uma chave aqui não compila: a lista acompanha a união do SDK. */
const EVENT_TYPES: Record<PlatformEventType, true> = {
  'installation.created': true,
  'installation.reinstalled': true,
  'installation.removed': true,
  'installation.auth_error': true,
  'installation.auth_restored': true,
  'subscription.trial_started': true,
  'subscription.activated': true,
  'subscription.renewed': true,
  'subscription.plan_changed': true,
  'subscription.past_due': true,
  'subscription.recovered': true,
  'subscription.cancel_scheduled': true,
  'subscription.ended': true,
  'subscription.period_ending': true,
  'subscription.item_changed': true,
  'purchase.paid': true,
  'charge.refunded': true,
  'charge.disputed': true,
}

describe('SDK × contrato OpenAPI', () => {
  it('tipos gerados batem com docs/api/openapi.json (rode `yarn sdk:types`)', async () => {
    const committed = readFileSync(TYPES_PATH, 'utf8').replace(/\r\n/g, '\n')
    expect(
      committed,
      'sdk/typescript/src/generated/openapi.ts desatualizado: rode yarn sdk:types',
    ).toBe(await renderSdkTypes())
  })

  it('o cliente tem exatamente um método por operação com chave de app', () => {
    const documented = Object.entries(contract.paths).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(([, op]) => op.security?.some(scheme => 'appApiKey' in scheme))
        .map(
          ([method, op]) => `${op.operationId} ${method.toUpperCase()} ${path}`,
        ),
    )
    const covered = Object.entries(OPERATIONS).map(
      ([id, op]) => `${id} ${op.method} ${op.path}`,
    )
    expect(covered.sort()).toEqual(documented.sort())
  })

  it('a união de eventos cobre exatamente os eventos do contrato', () => {
    const documented = Object.keys(contract.webhooks)
      .filter(name => name !== 'installer')
      .sort()
    expect(Object.keys(EVENT_TYPES).sort()).toEqual(documented)
  })
})
