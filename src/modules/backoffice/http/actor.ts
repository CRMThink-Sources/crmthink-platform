import { createHash } from 'node:crypto'
import type { Response } from 'express'
import { HttpError } from '@/shared/http/errors'
import type { OperatorRole } from '../domain/operator'

/**
 * Quem fez a requisição em `/admin/*`: um operador com sessão (backoffice) ou um token
 * de `ADMIN_API_TOKENS` (scripts), que vale como `operator`.
 */
export type Actor =
  | {
      kind: 'operator'
      id: string
      operatorId: number
      role: OperatorRole
      email: string
      name: string
      sessionId: number
      mustChangePassword: boolean
    }
  | { kind: 'token'; id: string; role: 'operator' }

/** `token:<8 primeiros hex do SHA-256>`: identifica o token sem expô-lo. */
export function tokenActorId(token: string): string {
  return `token:${createHash('sha256').update(token).digest('hex').slice(0, 8)}`
}

export function setActor(res: Response, actor: Actor): void {
  res.locals.actor = actor
}

export function findActor(res: Response): Actor | undefined {
  return res.locals.actor as Actor | undefined
}

export function currentActor(res: Response): Actor {
  const actor = findActor(res)
  if (!actor) throw new HttpError(500, 'AUTH_MISSING', 'adminGate não aplicado')
  return actor
}

/** Sessão de operador da requisição (rotas `/admin/auth/*`, que não aceitam token). */
export function currentOperator(
  res: Response,
): Extract<Actor, { kind: 'operator' }> {
  const actor = currentActor(res)
  if (actor.kind !== 'operator') {
    throw new HttpError(
      400,
      'SESSION_REQUIRED',
      'Rota exclusiva de sessão de operador',
    )
  }
  return actor
}
