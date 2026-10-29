import { useQuery } from '@tanstack/react-query'
import { api, call, type Schemas } from '@/api/client'

export type WhoAmI = Schemas['WhoAmI']
export type Role = 'viewer' | 'operator'

export const meQueryKey = ['auth', 'me'] as const

/** Quem está logado (`GET /admin/auth/me`). 401 dispara a ida ao login (ver `client.ts`). */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => call(api.GET('/admin/auth/me')),
    staleTime: 60_000,
  })
}

export function roleOf(me: WhoAmI | undefined): Role | null {
  return me?.role ?? null
}
