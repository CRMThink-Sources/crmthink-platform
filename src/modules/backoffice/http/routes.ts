import { Router } from 'express'
import { ZodError } from 'zod'
import {
  asyncHandler,
  forbidden,
  HttpError,
  intParam,
} from '@/shared/http/errors'
import type { AdminAudit } from '../application/audit'
import type { LoginService } from '../application/login'
import {
  changePasswordSchema,
  createOperatorSchema,
  toOperatorView,
  updateOperatorSchema,
  type OperatorService,
} from '../application/operators'
import type { AdminSessions } from '../application/sessions'
import { currentActor, currentOperator } from './actor'
import { clearSessionCookie, setSessionCookie } from './cookies'
import { requestMeta } from './gate'

export type BackofficeRoutesDeps = {
  login: LoginService
  sessions: AdminSessions
  operators: OperatorService
  audit: AdminAudit
  cookieSecure: boolean
  origins: string[]
}

/**
 * Acesso ao backoffice (`/admin/auth/*`) e gestão de operadores. Montadas atrás de
 * `adminGate` — autenticação, papel e auditoria das mutações ficam lá.
 */
export function backofficeRoutes(deps: BackofficeRoutesDeps): Router {
  const router = Router()

  router.post(
    '/admin/auth/login',
    asyncHandler(async (req, res) => {
      // Navegador: só das origens do backoffice. Sem `Origin` (curl) segue.
      const origin = req.headers.origin?.replace(/\/+$/, '')
      if (origin && !deps.origins.includes(origin)) {
        throw forbidden(
          'ORIGIN_NOT_ALLOWED',
          'Origem da requisição não permitida',
        )
      }
      const result = await deps.login.login(req.body, requestMeta(req, res))
      setSessionCookie(res, result.token, deps.cookieSecure)
      res.json({ operator: result.operator, expiresAt: result.expiresAt })
    }),
  )

  router.post(
    '/admin/auth/logout',
    asyncHandler(async (req, res) => {
      const actor = currentOperator(res)
      await deps.sessions.revoke(actor.sessionId)
      await deps.audit.record({
        ...requestMeta(req, res),
        actor: actor.id,
        actorRole: actor.role,
        action: 'auth.logout',
        targetType: 'operator',
        targetId: String(actor.operatorId),
        statusCode: 204,
      })
      clearSessionCookie(res, deps.cookieSecure)
      res.status(204).end()
    }),
  )

  router.get(
    '/admin/auth/me',
    asyncHandler(async (_req, res) => {
      const actor = currentActor(res)
      if (actor.kind === 'token') {
        res.json({ kind: 'token', actor: actor.id, role: actor.role })
        return
      }
      res.json({
        kind: 'operator',
        actor: actor.id,
        role: actor.role,
        operator: toOperatorView(await deps.operators.get(actor.operatorId)),
      })
    }),
  )

  router.post(
    '/admin/auth/password',
    asyncHandler(async (req, res) => {
      const actor = currentOperator(res)
      const meta = requestMeta(req, res)
      try {
        const operator = await deps.operators.changePassword(
          actor.operatorId,
          changePasswordSchema.parse(req.body ?? {}),
          actor.sessionId,
        )
        await deps.audit.record({
          ...meta,
          actor: actor.id,
          actorRole: actor.role,
          action: 'auth.password_changed',
          targetType: 'operator',
          targetId: String(actor.operatorId),
          statusCode: 200,
        })
        res.json({ operator })
      } catch (error) {
        await deps.audit.record({
          ...meta,
          actor: actor.id,
          actorRole: actor.role,
          action: 'auth.password_change_failed',
          targetType: 'operator',
          targetId: String(actor.operatorId),
          errorCode:
            error instanceof HttpError
              ? error.code
              : error instanceof ZodError
                ? 'VALIDATION_ERROR'
                : 'INTERNAL_ERROR',
        })
        throw error
      }
    }),
  )

  router.get(
    '/admin/operators',
    asyncHandler(async (_req, res) => {
      res.json({ items: await deps.operators.list() })
    }),
  )

  router.post(
    '/admin/operators',
    asyncHandler(async (req, res) => {
      const issued = await deps.operators.create(
        createOperatorSchema.parse(req.body),
      )
      res.locals.auditTargetId = String(issued.operator.id)
      res.status(201).json(issued)
    }),
  )

  router.patch(
    '/admin/operators/:id',
    asyncHandler(async (req, res) => {
      const actor = currentActor(res)
      res.json(
        await deps.operators.update(
          intParam(req.params.id, 'OPERATOR_NOT_FOUND'),
          updateOperatorSchema.parse(req.body),
          actor.kind === 'operator' ? actor.operatorId : null,
        ),
      )
    }),
  )

  router.post(
    '/admin/operators/:id/reset-access',
    asyncHandler(async (req, res) => {
      res.json(
        await deps.operators.resetAccess(
          intParam(req.params.id, 'OPERATOR_NOT_FOUND'),
        ),
      )
    }),
  )

  return router
}
