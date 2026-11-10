import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'

/**
 * Dados e handlers MSW tipados pelo contrato (`src/api/schema.d.ts`): uma resposta
 * fora do schema não compila.
 */

export function operator(
  overrides: Partial<Schemas['Operator']> = {},
): Schemas['Operator'] {
  return {
    id: 1,
    email: 'dev@connectthink.com.br',
    name: 'Dev',
    role: 'operator',
    active: true,
    mustChangePassword: false,
    totpConfigured: true,
    lockedUntil: null,
    lastLoginAt: '2026-10-28T12:00:00.000Z',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

export const viewer = () =>
  operator({
    id: 2,
    email: 'suporte@connectthink.com.br',
    name: 'Suporte',
    role: 'viewer',
  })

/** `GET /admin/auth/me` com o operador dado (ou 401 com `null`). */
export function meHandler(who: Schemas['Operator'] | null) {
  return http.get('*/admin/auth/me', () =>
    who
      ? HttpResponse.json({
          kind: 'operator',
          actor: `operator:${who.id}`,
          role: who.role,
          operator: who,
        } satisfies Schemas['WhoAmI'])
      : HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Sessão ausente' } },
          { status: 401 },
        ),
  )
}

export const apiError = (status: number, code: string, message = code) =>
  HttpResponse.json({ error: { code, message } }, { status })

export function page<T>(items: T[], nextCursor: string | null = null) {
  return { items, nextCursor }
}

export function catalogProduct(
  overrides: Partial<Schemas['CatalogProduct']> = {},
): Schemas['CatalogProduct'] {
  return {
    id: 10,
    name: 'GPTMaker',
    billingModel: '13605',
    billingModelKey: 'standard',
    kind: 'subscription',
    active: true,
    valid: true,
    problems: [],
    apps: [],
    plans: [],
    ...overrides,
  }
}

/** `GET /admin/catalog/products`; o padrão tem os produtos 10 e 11 (usados pelos testes do app). */
export function catalogHandler(
  products: Schemas['CatalogProduct'][] = [
    catalogProduct({ id: 10, name: 'GPTMaker' }),
    catalogProduct({ id: 11, name: 'Extrator' }),
  ],
  writable = true,
) {
  return http.get('*/admin/catalog/products', () =>
    HttpResponse.json({
      writable,
      products,
      orphanPlans: [],
    } satisfies Schemas['CatalogView']),
  )
}
