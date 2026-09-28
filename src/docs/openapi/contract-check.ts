import type { Express } from 'express'
import { declaredErrors, errorEnvelopeSchema } from './build'
import { OPERATIONS, type HttpMethod, type Operation } from './operations'

/**
 * Ligações entre o Express e o registro de operações, usadas nos testes: o
 * inventário das rotas montadas e a conferência de uma resposta com o contrato.
 */

export const toOpenApiPath = (expressPath: string) =>
  expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}')

export const routeKey = (method: string, path: string) =>
  `${method.toUpperCase()} ${toOpenApiPath(path)}`

type Layer = {
  route?: { path: string | string[]; methods: Record<string, boolean> }
  name?: string
  handle?: { stack?: Layer[] }
}

/**
 * Pares `MÉTODO /caminho` das rotas de `app`, inclusive de routers aninhados. Depende
 * de `app._router` (Express 4); na migração para o Express 5 só esta função muda.
 * Routers montados com prefixo não são usados nesta base — o prefixo não é somado.
 */
export function listRoutes(app: Express): string[] {
  const routes = new Set<string>()
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path)
          ? layer.route.path
          : [layer.route.path]
        for (const path of paths) {
          for (const [method, enabled] of Object.entries(layer.route.methods)) {
            if (enabled) routes.add(routeKey(method, path))
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack)
      }
    }
  }
  const router = (app as unknown as { _router?: { stack: Layer[] } })._router
  if (!router) throw new Error('app sem _router: Express mudou?')
  walk(router.stack)
  return [...routes].sort()
}

const byKey = new Map(
  OPERATIONS.map(operation => [
    routeKey(operation.method, operation.path),
    operation,
  ]),
)

export function findOperation(
  method: string,
  path: string,
): Operation | undefined {
  return byKey.get(routeKey(method, path))
}

export const operationKeys = () => [...byKey.keys()].sort()

export type ContractViolation = {
  route: string
  status: number
  problems: string[]
}

/**
 * Confere uma resposta JSON com o contrato. `routePath` é o caminho do Express
 * (`req.route.path`) ou `undefined` quando a resposta saiu antes de casar uma rota
 * (autenticação, 404) — aí só o envelope de erro é conferido.
 */
export function checkResponse(input: {
  method: string
  routePath: string | undefined
  status: number
  body: unknown
}): ContractViolation | null {
  const route = input.routePath
    ? routeKey(input.method, input.routePath)
    : `${input.method} (sem rota)`
  const operation = input.routePath
    ? findOperation(input.method, input.routePath)
    : undefined
  const problems: string[] = []

  if (input.routePath && !operation) {
    problems.push('rota sem operação no contrato')
  } else if (operation?.responses[input.status]) {
    const schema = operation.responses[input.status]!.schema?.schema
    if (schema) {
      const parsed = schema.safeParse(input.body)
      if (!parsed.success) {
        problems.push(
          ...parsed.error.issues.map(
            issue => `${issue.path.join('.') || '(corpo)'}: ${issue.message}`,
          ),
        )
      }
    }
  } else if (input.status >= 400) {
    const parsed = errorEnvelopeSchema.safeParse(input.body)
    if (!parsed.success) {
      problems.push(
        `envelope de erro inválido: ${parsed.error.issues[0]?.message}`,
      )
    } else if (operation) {
      const { code } = parsed.data.error
      const declared = declaredErrors(operation)
      if (code !== 'INTERNAL_ERROR' && !declared.has(code)) {
        problems.push(`código ${code} não declarado em errors`)
      } else if (declared.has(code) && declared.get(code) !== input.status) {
        problems.push(
          `código ${code} declarado com status ${declared.get(code)}, saiu ${input.status}`,
        )
      }
    }
  } else {
    problems.push(`status ${input.status} não documentado`)
  }

  return problems.length ? { route, status: input.status, problems } : null
}

export type { HttpMethod }
