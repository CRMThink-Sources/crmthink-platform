import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import openapiTS, { astToString } from 'openapi-typescript'

/**
 * Tipos do cliente da API de operador a partir de `docs/api/openapi-admin.json`.
 *   `yarn gen:api`   regrava `src/api/schema.d.ts`
 *   `yarn check:api` falha se o arquivo versionado divergir do contrato (CI)
 * Mesmo padrão de `sdk/typescript/scripts/generate-types.ts`.
 */
const HERE = import.meta.dirname
const CONTRACT = path.resolve(HERE, '../../../docs/api/openapi-admin.json')
const OUTPUT = path.resolve(HERE, '../src/api/schema.d.ts')

const HEADER = `/**
 * Gerado por \`yarn gen:api\` a partir de \`docs/api/openapi-admin.json\`. Não edite à mão.
 */
`

const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'))
// Campo com `default` é opcional na requisição: o servidor preenche.
const content =
  HEADER + astToString(await openapiTS(contract, { defaultNonNullable: false }))

if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, content)
  console.log(`gravado ${path.relative(process.cwd(), OUTPUT)}`)
} else {
  let current = ''
  try {
    current = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    // ausente: diverge
  }
  if (current !== content) {
    console.error(
      'src/api/schema.d.ts desatualizado em relação a docs/api/openapi-admin.json: rode `yarn gen:api`',
    )
    process.exit(1)
  }
  console.log('src/api/schema.d.ts em dia com o contrato')
}
