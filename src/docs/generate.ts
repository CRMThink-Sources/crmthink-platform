import { ERROR_CATALOG } from './errors'
import { buildOpenApi, declaredErrors, serializeOpenApi } from './openapi/build'
import { OPERATIONS } from './openapi/operations'

/** Arquivos gerados, por caminho relativo à raiz do repositório. */
export function renderGeneratedDocs(): Record<string, string> {
  return {
    'docs/api/openapi.json': serializeOpenApi(
      buildOpenApi({ audience: 'public' }),
    ),
    'docs/api/openapi-admin.json': serializeOpenApi(
      buildOpenApi({ audience: 'admin' }),
    ),
    'docs/technical/error-codes.md': renderErrorCodes(),
  }
}

const cell = (text: string) =>
  text.replace(/\|/g, String.raw`\|`).replace(/\n/g, ' ')

function renderErrorCodes(): string {
  const usedBy = new Map<string, string[]>()
  for (const operation of OPERATIONS) {
    for (const code of declaredErrors(operation).keys()) {
      usedBy.set(code, [...(usedBy.get(code) ?? []), operation.operationId])
    }
  }
  const rows = Object.entries(ERROR_CATALOG)
    .sort(([a, x], [b, y]) => x.status - y.status || a.localeCompare(b))
    .map(([code, info]) => {
      const ops = usedBy.get(code) ?? []
      const opsCell =
        ops.length > 6
          ? `${ops.slice(0, 6).join(', ')} +${ops.length - 6}`
          : ops.join(', ')
      return `| \`${code}\` | ${info.status} | ${cell(info.meaning)} | ${cell(info.action)} | ${cell(opsCell || '—')} | \`${cell(info.origin)}\` |`
    })
  return [
    '# Catálogo de códigos de erro',
    '',
    '<!-- Gerado por `yarn docs:openapi` a partir de `src/docs/errors.ts`. Não edite à mão. -->',
    '',
    'Toda resposta de erro tem o formato `{ "error": { "code", "message", "details"? } }`. Os apps',
    'decidem pelo `code` (estável); a `message` é texto para pessoas e pode mudar. O status HTTP',
    'abaixo é o usual; a coluna *Operações* lista os `operationId` do OpenAPI que podem devolver',
    'o código (`INSTALLATION_NOT_ACTIVE`, por exemplo, sai como 403 na sessão e 409 no checkout).',
    '',
    'Para acrescentar um código: registre-o em `src/docs/errors.ts`, declare-o nas operações',
    'em `src/docs/openapi/operations.ts` e rode `yarn docs:openapi`. O teste',
    '`src/docs/openapi/openapi.test.ts` falha se um código lançado no código não estiver aqui.',
    '',
    '| Código | Status | Significado | O que fazer | Operações | Origem (`src/modules/…` ou `src/…`) |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}
