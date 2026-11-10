/**
 * Pré-checagem do portal para o catálogo (somente leitura): lista, por SPA de produto e
 * de plano, os campos obrigatórios (`isRequired`) que NÃO estão em `SpaConfig`.
 *
 *   yarn tsx scripts/check-catalog-portal.ts
 *
 * Variáveis: `CRMTHINK_WEBHOOK_URL` (e, se houver, `SPA_CONFIG_FILE`).
 */
import { env } from '@/config/env'
import { loadSpaConfig, type SpaConfig } from '@/config/spa-config'
import { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'

type Fields = Record<string, { isRequired?: boolean }>

/** Códigos de campo de uma seção do `SpaConfig` (só os valores string). */
function configuredCodes(section: Record<string, unknown>): Set<string> {
  return new Set(
    Object.values(section).filter(
      (value): value is string => typeof value === 'string',
    ),
  )
}

/** Campos obrigatórios que o `SpaConfig` não conhece. */
export function missingRequiredFields(
  fields: Fields,
  known: Set<string>,
): string[] {
  return Object.entries(fields)
    .filter(([code, field]) => field.isRequired && !known.has(code))
    .map(([code]) => code)
}

async function main() {
  const cfg = env()
  if (!cfg.crmthink.webhookUrl) {
    console.error('CRMTHINK_WEBHOOK_URL não configurado: nada a checar.')
    process.exit(1)
  }
  const config: SpaConfig = loadSpaConfig(cfg.spaConfigFile || undefined)
  const crm = BitrixRestClient.forWebhook(cfg.crmthink.webhookUrl)
  const targets = [
    {
      name: 'produto',
      id: config.entityTypes.product,
      section: config.product,
    },
    { name: 'plano', id: config.entityTypes.plan, section: config.plan },
  ]
  for (const { name, id, section } of targets) {
    const fields = await crm.itemFields(id)
    const missing = missingRequiredFields(fields, configuredCodes(section))
    console.log(`SPA ${id} (${name}): ${Object.keys(fields).length} campos`)
    console.log(
      missing.length
        ? `  obrigatórios fora do SpaConfig: ${missing.join(', ')}`
        : '  nenhum obrigatório fora do SpaConfig',
    )
  }
}

if (process.argv[1]?.endsWith('check-catalog-portal.ts')) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
