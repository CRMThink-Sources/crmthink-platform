import type { Request, RequestHandler, Response } from 'express'
import { safeEqual } from '@/shared/crypto/timing-safe'
import { asyncHandler, forbidden, unauthorized } from '@/shared/http/errors'
import type { AdminAudit } from '../application/audit'
import type { AdminSessions } from '../application/sessions'
import type { OperatorRole } from '../domain/operator'
import { findActor, setActor, tokenActorId, type Actor } from './actor'
import { readSessionCookie } from './cookies'
import {
  fallbackPolicy,
  matchPolicy,
  type AdminPolicy,
  type RequiredRole,
} from './policy'

export type AdminGateDeps = {
  tokens: string[]
  sessions: AdminSessions
  audit: AdminAudit
  /** `BACKOFFICE_ORIGINS`: origens aceitas em mutações com sessão. */
  origins: string[]
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const RANK: Record<OperatorRole, number> = { viewer: 1, operator: 2 }

function bearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '')
  return match?.[1]?.trim() || null
}

export const requestMeta = (req: Request, res: Response) => ({
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent'] ?? null,
  requestId: (res.getHeader('X-Request-Id') as string | undefined) ?? null,
})

function allows(required: RequiredRole, actor: Actor): boolean {
  if (required === 'public' || required === 'self') return true
  return RANK[actor.role] >= RANK[required]
}

/**
 * Porta única de `/admin/*`: autentica (token de script ou cookie de sessão),
 * confere `Origin` nas mutações com sessão, aplica o papel da rota (`policy.ts`) e
 * agenda a auditoria de toda mutação — inclusive as negadas por papel.
 *
 * Roda antes de o Express casar a rota, por isso casa a política sozinho.
 */
export function adminGate(deps: AdminGateDeps): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const method = req.method.toUpperCase()
    // Montado em `/admin`: o Express tira o prefixo de `req.path`.
    const path = req.baseUrl + req.path
    const matched = matchPolicy(method, path)
    const policy: AdminPolicy = matched?.policy ?? fallbackPolicy(method)
    const action = matched?.action ?? `${method} ${path}`

    if (!SAFE_METHODS.has(method) && !policy.auditedByHandler) {
      auditOnFinish(req, res, deps.audit, action, matched?.params ?? {}, policy)
    }
    if (policy.role === 'public') return next()

    const actor = await authenticate(req, res, deps)
    setActor(res, actor)

    if (actor.kind === 'operator') {
      if (actor.mustChangePassword && policy.role !== 'self') {
        throw forbidden(
          'PASSWORD_CHANGE_REQUIRED',
          'Troque a senha provisória antes de continuar',
        )
      }
      if (!SAFE_METHODS.has(method)) {
        const origin = req.headers.origin?.replace(/\/+$/, '')
        if (!origin || !deps.origins.includes(origin)) {
          throw forbidden(
            'ORIGIN_NOT_ALLOWED',
            'Origem da requisição não permitida',
          )
        }
      }
    }
    if (!allows(policy.role, actor)) {
      throw forbidden('FORBIDDEN_ROLE', 'Papel sem permissão para esta ação')
    }
    next()
  })
}

async function authenticate(
  req: Request,
  res: Response,
  deps: AdminGateDeps,
): Promise<Actor> {
  const token = bearer(req.headers.authorization)
  if (token) {
    // Bearer inválido não cai para o cookie: credencial errada é erro, não ausência.
    if (!deps.tokens.some(known => safeEqual(token, known))) {
      throw unauthorized('Credencial de operador inválida')
    }
    return { kind: 'token', id: tokenActorId(token), role: 'operator' }
  }

  const cookie = readSessionCookie(req)
  if (!cookie) throw unauthorized('Sessão ausente')
  const resolved = await deps.sessions.resolve(cookie)
  if (resolved.status === 'expired') {
    const { operator } = resolved.session
    await deps.audit.record({
      ...requestMeta(req, res),
      actor: `operator:${operator.id}`,
      actorRole: operator.role,
      action: 'auth.session_expired',
      targetType: 'operator',
      targetId: String(operator.id),
      statusCode: 401,
      errorCode: 'UNAUTHORIZED',
    })
  }
  if (resolved.status !== 'ok') throw unauthorized('Sessão expirada')
  const { operator } = resolved.session
  return {
    kind: 'operator',
    id: `operator:${operator.id}`,
    operatorId: operator.id,
    role: operator.role as OperatorRole,
    email: operator.email,
    name: operator.name,
    sessionId: resolved.session.id,
    mustChangePassword: operator.mustChangePassword,
  }
}

/**
 * Grava a auditoria da mutação quando a resposta termina, com o status real. Sem ator
 * (401) não há registro: só credenciais válidas agem em nome de alguém.
 */
function auditOnFinish(
  req: Request,
  res: Response,
  audit: AdminAudit,
  action: string,
  params: Record<string, string>,
  policy: AdminPolicy,
): void {
  const json = res.json.bind(res)
  res.json = body => {
    const code = (body as { error?: { code?: unknown } } | undefined)?.error
      ?.code
    if (typeof code === 'string') res.locals.errorCode = code
    return json(body)
  }
  res.on('finish', () => {
    const actor = findActor(res)
    if (!actor) return
    const target = policy.target?.(params)
    const createdId = res.locals.auditTargetId as string | undefined
    void audit.record({
      ...requestMeta(req, res),
      actor: actor.id,
      actorRole: actor.role,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id || createdId || null,
      statusCode: res.statusCode,
      errorCode: (res.locals.errorCode as string | undefined) ?? null,
      summary:
        req.body &&
        typeof req.body === 'object' &&
        Object.keys(req.body as object).length
          ? { body: req.body as Record<string, unknown> }
          : null,
    })
  })
}
