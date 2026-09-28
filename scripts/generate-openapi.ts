import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { renderGeneratedDocs } from '@/docs/generate'

/**
 * `yarn docs:openapi`: regrava `docs/api/openapi.json`, `docs/api/openapi-admin.json`
 * e a tabela de `docs/technical/error-codes.md`. O teste de sincronia falha se os
 * arquivos versionados divergirem do que este script gera.
 */
const root = path.resolve(__dirname, '..')
const files = renderGeneratedDocs()
for (const [file, content] of Object.entries(files)) {
  writeFileSync(path.join(root, file), content)
  console.log(`gravado ${file}`)
}
