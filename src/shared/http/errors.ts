import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'
import { logger } from '@/shared/observability/logger'

/**
 * Erro com status HTTP e código estável do contrato (`TRIAL_ALREADY_USED`,
 * `PLAN_TYPE_MISMATCH`, ...). Os apps decidem pelo `code`, nunca pela mensagem.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code)
    this.name = 'HttpError'
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) =>
  new HttpError(400, code, message, details)
export const unauthorized = (message = 'Unauthorized') =>
  new HttpError(401, 'UNAUTHORIZED', message)
export const forbidden = (code = 'FORBIDDEN', message?: string) =>
  new HttpError(403, code, message)
export const notFound = (code = 'NOT_FOUND', message?: string) =>
  new HttpError(404, code, message)
export const conflict = (code: string, message?: string) =>
  new HttpError(409, code, message)
export const gone = (code: string, message?: string) =>
  new HttpError(410, code, message)
export const unprocessable = (code: string, message?: string) =>
  new HttpError(422, code, message)
export const upstream = (code: string, message?: string) =>
  new HttpError(502, code, message)

/** 429 com `Retry-After` (segundos): limite de tentativas. */
export class TooManyRequestsError extends HttpError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      429,
      'TOO_MANY_REQUESTS',
      'Muitas tentativas; aguarde para tentar de novo',
    )
    this.name = 'TooManyRequestsError'
  }
}

/** Encaminha rejeições de handler assíncrono ao middleware de erro. */
export function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}

export function errorMiddleware() {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      if (error.status >= 500) {
        logger().error({ err: error, path: req.path }, 'request failed')
      }
      if (error instanceof TooManyRequestsError) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds))
      }
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      })
      return
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Requisição inválida',
          details: error.issues.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      })
      return
    }
    logger().error({ err: error, path: req.path }, 'unhandled error')
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } })
  }
}

/** `:id` numérico da rota, ou 404 (id que não é número não é instalação de ninguém). */
export function intParam(
  value: string | undefined,
  code = 'NOT_FOUND',
): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw notFound(code)
  return id
}
