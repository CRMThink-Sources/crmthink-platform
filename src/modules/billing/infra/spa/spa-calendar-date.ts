/**
 * Conversão entre a **data de calendário** da SPA e o domínio. Portado sem mudanças
 * de `modules/application/infra/bitrix/spa-calendar-date.ts` do hub-core — ver lá a
 * história do bug de D-1.
 *
 * Convenção: o componente **UTC** do `Date` é o dia; início do período ancora em
 * `00:00:00.000Z`, fim em `23:59:59.999Z`; a escrita vai ao meio-dia UTC, o único
 * horário que nenhum fuso real desloca para outro dia.
 */

export type CalendarDate = { year: number; month: number; day: number }

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/

const fromUtc = (date: Date): CalendarDate => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
})

export function parseSpaCalendarDate(value: unknown): CalendarDate | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : fromUtc(value)
  }
  if (typeof value !== 'string' || value.trim() === '') return null

  const iso = ISO_DATE_PREFIX.exec(value)
  if (iso) {
    const [, year, month, day] = iso
    const candidate = {
      year: Number(year),
      month: Number(month),
      day: Number(day),
    }
    const roundTrip = fromUtc(
      new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day)),
    )
    return roundTrip.year === candidate.year &&
      roundTrip.month === candidate.month &&
      roundTrip.day === candidate.day
      ? candidate
      : null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : fromUtc(parsed)
}

export function startOfCalendarDay(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0))
}

export function endOfCalendarDay(date: CalendarDate): Date {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, 23, 59, 59, 999),
  )
}

const pad = (value: number) => String(value).padStart(2, '0')

export const formatCalendarDate = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

export function toSpaCalendarDateValue(date: Date): string {
  const day = startOfCalendarDay(fromUtc(date))
  return new Date(day.getTime() + 12 * 60 * 60 * 1000).toISOString()
}

/** Dias de calendário entre dois instantes (b − a), pelo dia UTC. */
export function calendarDaysBetween(a: Date, b: Date): number {
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.round((dayB - dayA) / 86_400_000)
}
