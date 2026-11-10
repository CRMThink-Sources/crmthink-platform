/** Centavos → `199,00` (sem o símbolo; quem exibe põe `R$ `). */
export function centsToReais(cents: number): string {
  const abs = Math.abs(Math.trunc(cents))
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
  return cents < 0 ? `-${text}` : text
}

/**
 * Texto em reais → centavos. Aceita `199`, `199,5`, `199,50` e `1.990,00`.
 * Vazio, negativo ou fora do formato → `null`.
 */
export function reaisToCents(text: string): number | null {
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const reais = Number((match[1] ?? '').replaceAll('.', ''))
  const cents = Number((match[2] ?? '').padEnd(2, '0'))
  return reais * 100 + cents
}
