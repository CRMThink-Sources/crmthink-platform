import { Router } from 'express'
import { buildOpenApi } from './openapi/build'

/**
 * `GET /openapi.json` (contrato sem rotas de operador) e `GET /docs` (visualizador).
 * O contrato de operador não é servido: fica em `docs/api/openapi-admin.json`.
 */

// Versão fixada + SRI: atualização do pacote no CDN não muda a página sem um commit.
// Use o arquivo final, não um que redirecione (`standalone.min.js` redireciona para
// este): o SRI é conferido sobre o corpo recebido. Hash novo:
// curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
const SCALAR_URL =
  'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.0/dist/browser/standalone.js'
const SCALAR_SRI =
  'sha384-OPr81V05YKGVtMFR7bgn6teWINJ+Qb5LIgvuAi2xv2C/5Y1/PcjZ0DrvpMdP39ix'

const DOCS_PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CRMThink Platform API</title>
<link rel="icon" href="data:,">
</head>
<body>
<script id="api-reference" data-url="/openapi.json"></script>
<script src="${SCALAR_URL}" integrity="${SCALAR_SRI}" crossorigin="anonymous"></script>
</body>
</html>
`

export function docsRoutes(publicBaseUrl: string): Router {
  const router = Router()
  let document: string | null = null

  router.get('/openapi.json', (_req, res) => {
    document ??= JSON.stringify(
      buildOpenApi({ audience: 'public', serverUrl: publicBaseUrl }),
    )
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type('application/json').send(document)
  })

  router.get('/docs', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type('html').send(DOCS_PAGE)
  })

  return router
}
