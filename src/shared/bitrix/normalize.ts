/** `https://empresa.bitrix24.com.br/` → `empresa.bitrix24.com.br`. */
export function normalizeBitrixDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Unix timestamp in seconds (roughly year 2001–2286). */
const UNIX_SECONDS_THRESHOLD = 1e9
/** Unix timestamp in milliseconds (roughly year 2001–2286). */
const UNIX_MS_THRESHOLD = 1e12

/**
 * `BX24.getAuth()` manda `expires_in` como TTL (segundos) ou como instante absoluto
 * (epoch em segundos ou ms); o OAuth do Bitrix manda TTL. Portado de
 * `resolve-bitrix-token-expires-at.ts` do hub-core — converter na mão produzia 1970.
 */
export function resolveBitrixTokenExpiresAt(
  expiresIn: number,
  now: Date = new Date(),
): Date {
  if (expiresIn > UNIX_MS_THRESHOLD) return new Date(expiresIn)
  if (expiresIn > UNIX_SECONDS_THRESHOLD) return new Date(expiresIn * 1000)
  return new Date(now.getTime() + expiresIn * 1000)
}
