import { existsSync } from 'node:fs'
import path from 'node:path'
import express, { Router, type Response } from 'express'

/**
 * Entrega do backoffice (React, `web/backoffice`) em `/backoffice`, na mesma origem de
 * `/admin/*`: o cookie de sessão vai sem CORS.
 *
 * - `assets/*` (nome com hash): cache longo e `immutable`;
 * - qualquer outro caminho: `index.html` sem cache (o roteamento é do navegador);
 * - CSP só desta rota: nada de outra origem, sem iframe.
 *
 * Montado com `use` (middleware), não como rota: não é API e fica fora do contrato.
 */

export const BACKOFFICE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Componentes (sonner, posicionamento do Radix) aplicam estilo inline.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

function securityHeaders(res: Response): void {
  res.setHeader('Content-Security-Policy', BACKOFFICE_CSP)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
}

export function defaultBackofficeDist(): string {
  return path.resolve(process.cwd(), 'web/backoffice/dist')
}

export function backofficeWeb(distDir: string): Router {
  const router = Router()
  const indexFile = path.join(distDir, 'index.html')

  router.use('/backoffice', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    securityHeaders(res)
    if (!existsSync(indexFile)) {
      res
        .status(404)
        .type('text/plain')
        .send(
          'Backoffice não compilado: rode `yarn --cwd web/backoffice build` (a imagem Docker já inclui o build).',
        )
      return
    }
    // `/backoffice` → `/backoffice/`: a base do Vite é `/backoffice/`.
    if (req.originalUrl === '/backoffice') {
      res.redirect(301, '/backoffice/')
      return
    }
    next()
  })

  router.use(
    '/backoffice',
    express.static(distDir, {
      index: false,
      redirect: false,
      fallthrough: true,
      setHeaders(res, file) {
        res.setHeader(
          'Cache-Control',
          file.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        )
      },
    }),
  )

  router.use('/backoffice', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    // Arquivo de `assets/` inexistente é 404 de verdade, não a página.
    if (req.path.startsWith('/assets/')) return next()
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(indexFile)
  })

  // O resto de `/backoffice` termina aqui: depois vêm as rotas dos apps, que pediriam
  // chave de API (401) para um caminho que não existe.
  router.use('/backoffice', (_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } })
  })

  return router
}
