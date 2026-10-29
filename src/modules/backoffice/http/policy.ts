/**
 * Política de cada rota `/admin/*`: papel mínimo e alvo da auditoria. Fonte única para
 * o middleware (`gate.ts`) e para o contrato OpenAPI (`operations.ts` mostra o papel);
 * `policy.test.ts` garante que toda operação de operador tem uma entrada aqui.
 *
 * Papéis:
 * - `public`: sem credencial (só o login).
 * - `self`: qualquer sessão, inclusive com troca de senha pendente (`/admin/auth/*`).
 * - `viewer` / `operator`: papel mínimo.
 *
 * Este arquivo não importa nada de propósito: `operations.ts` o importa, e o registro
 * de operações já importa as rotas.
 */

export type RequiredRole = 'public' | 'self' | 'viewer' | 'operator'

export type AdminPolicy = {
  role: RequiredRole
  /** Alvo da auditoria a partir dos parâmetros da rota. */
  target?: (params: Record<string, string>) => { type: string; id: string }
  /** Mutações que registram a própria auditoria (login, logout, senha). */
  auditedByHandler?: boolean
}

const app = (p: Record<string, string>) => ({
  type: 'app',
  id: p.appCode ?? '',
})
const installation = (p: Record<string, string>) => ({
  type: 'installation',
  id: p.id ?? '',
})
const operator = (p: Record<string, string>) => ({
  type: 'operator',
  id: p.id ?? '',
})

/** Chave: `MÉTODO /caminho` no formato do Express (`:param`). */
export const ADMIN_POLICIES: Record<string, AdminPolicy> = {
  'POST /admin/auth/login': { role: 'public', auditedByHandler: true },
  'POST /admin/auth/logout': { role: 'self', auditedByHandler: true },
  'GET /admin/auth/me': { role: 'self' },
  'POST /admin/auth/password': { role: 'self', auditedByHandler: true },

  'GET /admin/operators': { role: 'operator' },
  'POST /admin/operators': { role: 'operator' },
  'PATCH /admin/operators/:id': { role: 'operator', target: operator },
  'POST /admin/operators/:id/reset-access': {
    role: 'operator',
    target: operator,
  },

  'GET /admin/audit': { role: 'viewer' },
  'GET /admin/overview': { role: 'viewer' },

  'GET /admin/apps': { role: 'viewer' },
  'POST /admin/apps': {
    role: 'operator',
    target: () => ({ type: 'app', id: '' }),
  },
  'GET /admin/apps/:appCode': { role: 'viewer', target: app },
  'PATCH /admin/apps/:appCode': { role: 'operator', target: app },
  'POST /admin/apps/:appCode/rotate-api-key': { role: 'operator', target: app },
  'POST /admin/apps/:appCode/rotate-webhook-secret': {
    role: 'operator',
    target: app,
  },

  'GET /admin/installations': { role: 'viewer' },
  'GET /admin/installations/:id': { role: 'viewer', target: installation },
  'GET /admin/installations/:id/timeline': {
    role: 'viewer',
    target: installation,
  },
  'GET /admin/installations/:id/attempts': {
    role: 'viewer',
    target: installation,
  },
  'POST /admin/installations/:id/trial': {
    role: 'operator',
    target: installation,
  },

  'GET /admin/events': { role: 'viewer' },
  'POST /admin/events/resend': { role: 'operator' },
  'GET /admin/stripe-events': { role: 'viewer' },
  'GET /admin/stripe-events/:eventId': {
    role: 'operator',
    target: p => ({ type: 'stripe_event', id: p.eventId ?? '' }),
  },
  'POST /admin/signing-keys/rotate': {
    role: 'operator',
    target: () => ({ type: 'signing_key', id: '' }),
  },
  'POST /admin/sweeps/:kind': {
    role: 'operator',
    target: p => ({ type: 'sweep', id: p.kind ?? '' }),
  },
}

type Compiled = {
  key: string
  method: string
  segments: string[]
  policy: AdminPolicy
}

const COMPILED: Compiled[] = Object.entries(ADMIN_POLICIES).map(
  ([key, policy]) => {
    const [method, path] = key.split(' ') as [string, string]
    return { key, method, segments: path.split('/'), policy }
  },
)

export type MatchedPolicy = {
  /** `POST /admin/apps/:appCode/rotate-api-key` (sem os valores). */
  action: string
  policy: AdminPolicy
  params: Record<string, string>
}

/**
 * Política da requisição. O middleware roda antes de o Express casar a rota, então o
 * casamento é feito aqui. Segmento literal ganha de parâmetro.
 */
export function matchPolicy(
  method: string,
  path: string,
): MatchedPolicy | null {
  const segments = path.replace(/\/+$/, '').split('/')
  let best: {
    compiled: Compiled
    params: Record<string, string>
    literals: number
  } | null = null
  for (const compiled of COMPILED) {
    if (compiled.method !== method.toUpperCase()) continue
    if (compiled.segments.length !== segments.length) continue
    const params: Record<string, string> = {}
    let literals = 0
    let ok = true
    for (let i = 0; i < segments.length; i++) {
      const pattern = compiled.segments[i]!
      const value = segments[i]!
      if (pattern.startsWith(':')) {
        if (!value) {
          ok = false
          break
        }
        params[pattern.slice(1)] = decodeURIComponent(value)
      } else if (pattern === value) {
        literals++
      } else {
        ok = false
        break
      }
    }
    if (ok && (!best || literals > best.literals))
      best = { compiled, params, literals }
  }
  return best
    ? {
        action: best.compiled.key,
        policy: best.compiled.policy,
        params: best.params,
      }
    : null
}

/** Sem entrada (rota inexistente → 404): leitura pede `viewer`, o resto `operator`. */
export function fallbackPolicy(method: string): AdminPolicy {
  return {
    role: ['GET', 'HEAD'].includes(method.toUpperCase())
      ? 'viewer'
      : 'operator',
  }
}

/** Papel mínimo como texto, para a descrição das operações no contrato. */
export function roleOf(
  method: string,
  openApiPath: string,
): RequiredRole | null {
  const key = `${method.toUpperCase()} ${openApiPath.replace(/\{([^}]+)\}/g, ':$1')}`
  return ADMIN_POLICIES[key]?.role ?? null
}
