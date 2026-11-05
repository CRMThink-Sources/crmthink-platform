import z from 'zod'
import { badRequest } from '@/shared/http/errors'

/**
 * Paginação por cursor das listagens de operador: `{ items, nextCursor }`.
 *
 * O cursor é opaco para quem chama (`base64url` de um JSON com a chave de ordenação
 * do último item) e não é assinado: adulterá-lo só muda a página lida, e todas as
 * linhas já estão disponíveis ao mesmo papel. Um cursor que não decodifica responde
 * `VALIDATION_ERROR`.
 */

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(500).optional(),
})

export type Page<T> = { items: T[]; nextCursor: string | null }

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeCursor<T>(
  cursor: string | undefined,
  schema: z.ZodType<T>,
): T | undefined {
  if (cursor === undefined) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    raw = undefined
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw badRequest('VALIDATION_ERROR', 'Cursor inválido', [
      { path: 'cursor', message: 'Cursor inválido' },
    ])
  }
  return parsed.data
}

/**
 * Corta `rows` (buscadas com `limit + 1`) na página e monta o próximo cursor a partir
 * do último item devolvido.
 */
export function toPage<R, T>(
  rows: R[],
  limit: number,
  cursorOf: (row: R) => unknown,
  map: (row: R) => T,
): Page<T> {
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map(map),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(cursorOf(last))
        : null,
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `from`/`to` em query (`2026-10-01` ou ISO completo). `to` só com a data inclui o
 * dia inteiro (UTC): `to=2026-10-07` vai até `2026-10-07T23:59:59.999Z`.
 */
export const periodQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z
    .string()
    .optional()
    .transform(value =>
      value && DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value,
    )
    .pipe(z.coerce.date<string | undefined>().optional()),
})

export function periodWhere(period: { from?: Date; to?: Date }) {
  if (!period.from && !period.to) return undefined
  return {
    ...(period.from ? { gte: period.from } : {}),
    ...(period.to ? { lte: period.to } : {}),
  }
}
