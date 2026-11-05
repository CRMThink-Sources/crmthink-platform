import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type z from 'zod'

type Primitive = string | number | boolean | null | undefined

/**
 * Filtros, aba e cursor de uma tela vivem na URL: recarregar ou abrir o link em outro
 * navegador mostra a mesma visão, e "voltar" desfaz a última mudança.
 *
 * `schema` deve aceitar `{}` (campos opcionais ou com `.catch`). Qualquer mudança que
 * não seja do próprio `cursor` volta para a primeira página.
 */
export function useSearchState<S extends z.ZodType<Record<string, unknown>>>(
  schema: S,
): [z.output<S>, (patch: Record<string, Primitive>) => void] {
  const [params, setParams] = useSearchParams()

  const state = useMemo(() => {
    const parsed = schema.safeParse(Object.fromEntries(params))
    return parsed.success ? parsed.data : schema.parse({})
  }, [params, schema])

  const update = useCallback(
    (patch: Record<string, Primitive>) => {
      setParams(previous => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === null || value === '')
            next.delete(key)
          else next.set(key, String(value))
        }
        if (!('cursor' in patch)) next.delete('cursor')
        return next
      })
    },
    [setParams],
  )

  return [state, update]
}
