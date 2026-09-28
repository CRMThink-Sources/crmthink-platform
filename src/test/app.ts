import express, { type Express } from 'express'
import request from 'supertest'
import { createApp } from '@/app'
import { HealthState } from '@/health'
import { checkResponse } from '@/docs/openapi/contract-check'
import { contractViolations } from './contract-violations'
import type { Harness } from './harness'

/**
 * Envolve o app para conferir cada resposta JSON com o contrato OpenAPI
 * (`src/docs/openapi`). Divergências falham o teste no `afterEach`.
 */
function withContractCheck(app: Express): Express {
  const outer = express()
  outer.use((req, res, next) => {
    const json = res.json.bind(res)
    res.json = body => {
      const violation = checkResponse({
        method: req.method,
        routePath: (req.route as { path?: string } | undefined)?.path,
        status: res.statusCode,
        body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
      })
      if (violation) contractViolations.push(violation)
      return json(body)
    }
    next()
  })
  outer.use(app)
  return outer
}

/** `contract: false` para testes que provocam respostas fora do contrato de propósito. */
export function http(h: Harness, options: { contract?: boolean } = {}) {
  const app = createApp(h.container, new HealthState(h.container.db, null))
  return request(options.contract === false ? app : withContractCheck(app))
}
