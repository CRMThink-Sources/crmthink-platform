import type { Request, Response } from 'express'

/**
 * Cookie da sessão do backoffice. `Path=/admin` (só vai para a API de operador),
 * `HttpOnly`, `SameSite=Strict` e `Secure` (fora `ADMIN_COOKIE_INSECURE` em dev).
 * Sem `Max-Age`: some ao fechar o navegador; a expiração real é no servidor.
 */
export const SESSION_COOKIE = 'cp_admin_session'

function attributes(secure: boolean): string {
  return `Path=/admin; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export function setSessionCookie(
  res: Response,
  token: string,
  secure: boolean,
): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${attributes(secure)}`)
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; ${attributes(secure)}; Max-Age=0`,
  )
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim()
      return value || null
    }
  }
  return null
}

export function readSessionCookie(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE)
}

/**
 * Cookie do navegador lembrado: dispensa o código TOTP, nunca a senha. Ao contrário da
 * sessão, leva `Max-Age` (precisa sobreviver ao fechamento do navegador); mesmo escopo.
 */
export const DEVICE_COOKIE = 'cp_admin_device'

export function setDeviceCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  now: Date,
  secure: boolean,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
  )
  res.append(
    'Set-Cookie',
    `${DEVICE_COOKIE}=${token}; ${attributes(secure)}; Max-Age=${maxAge}`,
  )
}

export function readDeviceCookie(req: Request): string | null {
  return readCookie(req, DEVICE_COOKIE)
}
