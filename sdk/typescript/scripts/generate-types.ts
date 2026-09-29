import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import openapiTS, { astToString, type OpenAPI3 } from 'openapi-typescript'

/**
 * `yarn sdk:types`: regrava `sdk/typescript/src/generated/openapi.ts` a partir de
 * `docs/api/openapi.json`. O teste de deriva do SDK falha se o arquivo versionado
 * divergir do que esta função gera. Caminhos relativos à raiz do repositório, de onde
 * rodam o yarn e o vitest.
 */
export const ROOT = process.cwd()
export const CONTRACT_PATH = path.join(ROOT, 'docs/api/openapi.json')
export const TYPES_PATH = path.join(
  ROOT,
  'sdk/typescript/src/generated/openapi.ts',
)

const HEADER = `/**
 * Gerado por \`yarn sdk:types\` a partir de \`docs/api/openapi.json\`. Não edite à mão.
 */
`

export async function renderSdkTypes(): Promise<string> {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as OpenAPI3
  // Campo com `default` é opcional na requisição: o servidor preenche.
  const ast = await openapiTS(contract, { defaultNonNullable: false })
  return HEADER + astToString(ast)
}

if (process.argv.includes('--write')) {
  void renderSdkTypes().then(content => {
    writeFileSync(TYPES_PATH, content)
    console.log(`gravado ${path.relative(ROOT, TYPES_PATH)}`)
  })
}
