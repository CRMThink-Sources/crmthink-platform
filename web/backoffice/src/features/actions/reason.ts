/**
 * Motivo da ação (`X-Admin-Reason`): 1 a 500 caracteres, em uma linha. Cabeçalho HTTP só
 * leva Latin-1 (acentos do português cabem; emoji e aspas curvas não), e o `fetch`
 * recusa o resto, por isso a validação acontece antes de enviar.
 */
export const REASON_MAX = 500

export function validateReason(value: string): string | null {
  const reason = value.trim()
  if (!reason) return 'Informe o motivo.'
  if (reason.length > REASON_MAX)
    return `O motivo deve ter até ${REASON_MAX} caracteres.`
  if (/[\r\n]/.test(reason)) return 'O motivo deve ficar em uma linha.'
  if ([...reason].some(char => char.charCodeAt(0) > 0xff))
    return 'Use só letras, números e pontuação comuns (sem emojis nem aspas curvas).'
  return null
}
