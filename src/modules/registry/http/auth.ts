import type { RequestHandler, Response } from 'express'
import { safeEqual } from '@/shared/crypto/timing-safe'
import {
  asyncHandler,
  forbidden,
  HttpError,
  unauthorized,
} from '@/shared/http/errors'
import { setLogContext } from '@/shared/observability/log-context'
import type { AppRegistry } from '../app-registry'
import type { RegisteredApp } from '../domain/app'

function bearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '')
  return match?.[1]?.trim() || null
}

/**
 * `Authorization: Bearer <api key>` → app dono da chave em `res.locals.app`.
 * Sem chave ou chave desconhecida: 401. App inativo: 403.
 */
export function appAuth(registry: AppRegistry): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const key = bearer(req.headers.authorization)
    if (!key) throw unauthorized('API key ausente')
    const app = await registry.findByApiKey(key)
    if (!app) throw unauthorized('API key inválida')
    if (!app.active) throw forbidden('APP_INACTIVE', 'Aplicação desativada')
    res.locals.app = app
    setLogContext({ appCode: app.appCode })
    next()
  })
}

export function currentApp(res: Response): RegisteredApp {
  const app = res.locals.app as RegisteredApp | undefined
  if (!app) throw new HttpError(500, 'AUTH_MISSING', 'appAuth não aplicado')
  return app
}

/** Credencial de operador, separada da chave dos apps. */
export function adminAuth(tokens: string[]): RequestHandler {
  return (req, _res, next) => {
    const key = bearer(req.headers.authorization)
    if (!key || !tokens.some(token => safeEqual(key, token))) {
      next(unauthorized('Credencial de operador inválida'))
      return
    }
    next()
  }
}
