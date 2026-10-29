import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { HealthState } from '@/health'
import { createHarness } from '@/test/harness'

function fakeDist(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'backoffice-'))
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><div id="root"></div>',
  )
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
  return dir
}

function app(dist: string) {
  const h = createHarness()
  return request(
    createApp(h.container, new HealthState(h.container.db, null), {
      backofficeDist: dist,
    }),
  )
}

describe('entrega do backoffice em /backoffice', () => {
  it('link direto para uma tela devolve index.html sem cache e com CSP', async () => {
    const response = await app(fakeDist())
      .get('/backoffice/installations/1234')
      .expect(200)
    expect(response.text).toContain('<div id="root">')
    expect(response.headers['cache-control']).toBe('no-store')
    const csp = response.headers['content-security-policy'] as string
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['referrer-policy']).toBe('same-origin')
  })

  it('assets com hash têm cache longo e imutável', async () => {
    const response = await app(fakeDist())
      .get('/backoffice/assets/index-abc123.js')
      .expect(200)
    expect(response.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    )
  })

  it('asset inexistente é 404, não a página', async () => {
    const response = await app(fakeDist())
      .get('/backoffice/assets/nao-existe.js')
      .expect(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('/backoffice redireciona para /backoffice/', async () => {
    const response = await app(fakeDist()).get('/backoffice').expect(301)
    expect(response.headers.location).toBe('/backoffice/')
  })

  it('sem build: 404 explicando o comando', async () => {
    const response = await app(path.join(tmpdir(), 'nao-existe-backoffice'))
      .get('/backoffice/')
      .expect(404)
    expect(response.text).toContain('yarn --cwd web/backoffice build')
  })

  it('CSP só no backoffice; mutações não caem na página', async () => {
    const client = app(fakeDist())
    const health = await client.get('/health').expect(200)
    expect(health.headers['content-security-policy']).toBeUndefined()
    await client.post('/backoffice/installations').expect(404)
  })
})
