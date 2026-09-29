import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

export type SessionClaims = JWTPayload & {
  sub: string
  aud: string
  installationId: number
  memberId: string
  domain: string
  isAdmin: boolean
  name: string
  departmentIds: number[]
}

/**
 * Valida o JWT da sessão localmente: assinatura (JWKS), `iss`, `aud` (= seu appCode) e
 * `exp`. O JWKS fica em cache e é recarregado quando chega um `kid` desconhecido
 * (rotação de chave). JWT expirado ⇒ o frontend cria outra sessão com o auth atual do BX24.
 */
export function createSessionVerifier(options: {
  platformUrl: string
  appCode: string
  issuer?: string
  /** Intervalo mínimo entre recargas do JWKS. */
  cooldownMs?: number
  /** Idade máxima do JWKS em cache — menor que a antecedência da rotação (10 min). */
  cacheMaxAgeMs?: number
}) {
  const base = options.platformUrl.replace(/\/+$/, '')
  const jwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`), {
    cooldownDuration: options.cooldownMs ?? 30_000,
    cacheMaxAge: options.cacheMaxAgeMs ?? 5 * 60_000,
  })
  return async function verifySession(token: string): Promise<SessionClaims> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: options.issuer ?? base,
      audience: options.appCode,
      algorithms: ['RS256'],
    })
    return payload as SessionClaims
  }
}
