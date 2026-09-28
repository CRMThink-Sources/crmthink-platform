import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import express, { Router } from 'express'
import { describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { HealthState } from '@/health'
import { envSchema } from '@/config/env'
import { createHarness } from '@/test/harness'
import { http } from '@/test/app'
import { ERROR_CATALOG } from '../errors'
import { renderGeneratedDocs } from '../generate'
import { buildOpenApi, EVENT_TYPES } from './build'
import { checkResponse, listRoutes, operationKeys } from './contract-check'
import { EVENT_DATA } from './events'
import { OPERATIONS } from './operations'

const ROOT = path.resolve(__dirname, '../../..')

/** Preflight explícito do CORS da sessão: documentado como nota em `POST /v1/sessions`. */
const IGNORED_ROUTES = new Set(['OPTIONS /v1/sessions'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory())
      return name === 'test' ? [] : sourceFiles(full)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : []
  })
}

describe('inventário de rotas', () => {
  it('lê rotas de routers aninhados e converte parâmetros', () => {
    const inner = Router()
    inner.get('/v1/things/:id', (_req, res) => res.end())
    const outer = Router()
    outer.use(inner)
    const app = express()
    app.post('/top', (_req, res) => res.end())
    app.use(outer)
    expect(listRoutes(app)).toEqual(['GET /v1/things/{id}', 'POST /top'])
  })
})

describe('contrato OpenAPI', () => {
  const h = createHarness()
  const app = createApp(h.container, new HealthState(h.container.db, null))

  it('cobre exatamente as rotas montadas em createApp', () => {
    const mounted = listRoutes(app).filter(route => !IGNORED_ROUTES.has(route))
    const documented = operationKeys()
    expect({
      semDocumentacao: mounted.filter(route => !documented.includes(route)),
      semRota: documented.filter(route => !mounted.includes(route)),
    }).toEqual({ semDocumentacao: [], semRota: [] })
  })

  it('arquivos versionados batem com a geração (rode `yarn docs:openapi`)', () => {
    for (const [file, content] of Object.entries(renderGeneratedDocs())) {
      const committed = readFileSync(path.join(ROOT, file), 'utf8').replace(
        /\r\n/g,
        '\n',
      )
      expect(committed, `${file} desatualizado: rode yarn docs:openapi`).toBe(
        content,
      )
    }
  })

  it('todo código de erro lançado no código está no catálogo', () => {
    const found = new Map<string, string>()
    const dynamic: string[] = []
    const helpers =
      /\b(?:badRequest|forbidden|notFound|conflict|gone|unprocessable|upstream)\(\s*([^)\s][^,)]*)/g
    const literal = /^'([A-Z][A-Z0-9_]*)'$/
    for (const file of sourceFiles(path.join(ROOT, 'src'))) {
      const relative = path.relative(ROOT, file).replace(/\\/g, '/')
      if (relative.startsWith('src/docs/')) continue
      const text = readFileSync(file, 'utf8')
      const collect = (argument: string) => {
        const match = literal.exec(argument.trim())
        if (match) found.set(match[1]!, relative)
        else dynamic.push(`${relative}: ${argument.trim()}`)
      }
      if (relative !== 'src/shared/http/errors.ts') {
        for (const match of text.matchAll(helpers)) collect(match[1]!)
        for (const match of text.matchAll(
          /new HttpError\(([^']*?)('[A-Z_]+')/g,
        ))
          collect(match[2]!)
      }
      for (const match of text.matchAll(/intParam\([^,)]+,\s*('[A-Z_]+')/g))
        collect(match[1]!)
      for (const match of text.matchAll(/error:\s*\{\s*code:\s*('[A-Z_]+')/g))
        collect(match[1]!)
    }
    expect(dynamic, 'código de erro precisa ser literal').toEqual([])
    const missing = [...found].filter(([code]) => !(code in ERROR_CATALOG))
    expect(missing.map(([code, file]) => `${code} (${file})`)).toEqual([])
    expect(found.size).toBeGreaterThan(30)
  })

  it('documenta exatamente os tipos de evento do domínio', () => {
    expect(Object.keys(EVENT_DATA).sort()).toEqual([...EVENT_TYPES].sort())
    const document = buildOpenApi({ audience: 'public' }) as {
      webhooks: object
    }
    expect(Object.keys(document.webhooks).sort()).toEqual(
      [...EVENT_TYPES, 'installer'].sort(),
    )
  })

  it('é estruturalmente válido', () => {
    for (const audience of ['public', 'admin'] as const) {
      const document = buildOpenApi({ audience }) as {
        openapi: string
        paths: Record<string, Record<string, { operationId: string }>>
        components: { schemas: Record<string, unknown> }
      }
      expect(document.openapi).toMatch(/^3\.1\./)
      const ids = Object.values(document.paths).flatMap(item =>
        Object.values(item).map(operation => operation.operationId),
      )
      expect(new Set(ids).size).toBe(ids.length)
      const refs = [
        ...JSON.stringify(document).matchAll(
          /"\$ref":"#\/components\/schemas\/([^"]+)"/g,
        ),
      ]
      for (const [, id] of refs)
        expect(document.components.schemas, `$ref ${id}`).toHaveProperty([id!])
      if (audience === 'public') {
        expect(
          Object.keys(document.paths).some(p => p.startsWith('/admin')),
        ).toBe(false)
        expect(JSON.stringify(document)).not.toContain('"adminToken"')
      }
    }
  })

  it('declara só códigos do catálogo', () => {
    for (const operation of OPERATIONS) {
      for (const entry of operation.errors ?? []) {
        const code = Array.isArray(entry) ? entry[0] : entry
        expect(ERROR_CATALOG, operation.operationId).toHaveProperty([code])
      }
    }
  })

  it('documenta toda variável de ambiente em docs/technical/configuration.md', () => {
    const doc = readFileSync(
      path.join(ROOT, 'docs/technical/configuration.md'),
      'utf8',
    )
    const missing = Object.keys(envSchema.shape).filter(
      name => !doc.includes(`\`${name}\``),
    )
    expect(missing).toEqual([])
  })
})

describe('checagem de resposta', () => {
  it('acusa campo com tipo errado', () => {
    const violation = checkResponse({
      method: 'POST',
      routePath: '/v1/installations/:id/trial',
      status: 201,
      body: { subscriptionId: 1, trialEndsAt: 123 },
    })
    expect(violation?.problems[0]).toContain('trialEndsAt')
  })

  it('acusa código de erro não declarado na operação', () => {
    const violation = checkResponse({
      method: 'GET',
      routePath: '/v1/plans',
      status: 409,
      body: { error: { code: 'TRIAL_ALREADY_USED' } },
    })
    expect(violation?.problems[0]).toContain('não declarado')
  })
})

describe('rotas de documentação', () => {
  it('serve o contrato público e a página, mas não o de operador', async () => {
    const h = createHarness()
    const document = await http(h).get('/openapi.json').expect(200)
    expect(document.body.openapi).toBe('3.1.0')
    expect(document.body.servers).toEqual([{ url: h.env.publicBaseUrl }])
    expect(
      Object.keys(document.body.paths).some((p: string) =>
        p.startsWith('/admin'),
      ),
    ).toBe(false)
    const page = await http(h).get('/docs').expect(200)
    expect(page.text).toContain('data-url="/openapi.json"')
    // Rota inexistente cai no appAuth (401 sem chave, 404 com chave): nunca 200.
    const admin = await http(h).get('/openapi-admin.json')
    expect([401, 404]).toContain(admin.status)
  })
})
