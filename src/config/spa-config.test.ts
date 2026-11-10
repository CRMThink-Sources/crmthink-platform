import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SPA_CONFIG, loadSpaConfig } from './spa-config'

describe('spa-config billingModelIds', () => {
  it('traz os ids de enum do modelo de cobrança por padrão', () => {
    expect(DEFAULT_SPA_CONFIG.product.billingModelIds).toEqual({
      standard: '13605',
      perUnit: '13607',
      oneTime: '14455',
    })
    expect(DEFAULT_SPA_CONFIG.product.oneTimeBillingModelIds).toEqual(['14455'])
  })

  it('arquivo sem billingModelIds carrega com o padrão', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spa-config-'))
    const file = join(dir, 'spa.json')
    writeFileSync(file, JSON.stringify({ product: { active: 'ufCrm87X' } }))
    const config = loadSpaConfig(file)
    expect(config.product.active).toBe('ufCrm87X')
    expect(config.product.billingModelIds).toEqual({
      standard: '13605',
      perUnit: '13607',
      oneTime: '14455',
    })
  })
})
