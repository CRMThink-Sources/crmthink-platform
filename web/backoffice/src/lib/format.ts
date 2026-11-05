import { formatDistanceStrict } from 'date-fns'
import { ptBR } from 'date-fns/locale'

/** Fuso de exibição do backoffice: o time opera no horário de Brasília. */
export const TIME_ZONE = 'America/Sao_Paulo'

const absolute = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'medium',
})

/** `28/10/2026, 14:03:09` no horário de Brasília. */
export function formatDateTime(value: string | Date): string {
  return absolute.format(new Date(value))
}

/** `há 3 horas` / `em 2 dias`, relativo a `now`. */
export function formatRelative(
  value: string | Date,
  now: Date = new Date(),
): string {
  return formatDistanceStrict(new Date(value), now, {
    addSuffix: true,
    locale: ptBR,
  })
}

/** Centavos → `R$ 49,00`. */
export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
