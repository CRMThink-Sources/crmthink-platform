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

export function readSessionCookie(req: Request): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === SESSION_COOKIE) {
      const value = part.slice(index + 1).trim()
      return value || null
    }
  }
  return null
}
