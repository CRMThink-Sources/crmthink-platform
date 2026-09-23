import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Comparação de tempo constante. Compara os SHA-256 para não vazar nem o tamanho
 * (e porque `timingSafeEqual` lança com buffers de tamanhos diferentes).
 */
export function safeEqual(received: string, expected: string): boolean {
  if (!expected) return false
  const a = createHash('sha256').update(received).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
