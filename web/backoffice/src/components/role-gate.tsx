import type { ReactNode } from 'react'
import { useMe, type Role } from '@/features/auth/session'

const RANK: Record<Role, number> = { viewer: 1, operator: 2 }

export function useHasRole(role: Role): boolean {
  const me = useMe()
  return !!me.data && RANK[me.data.role] >= RANK[role]
}

/**
 * Esconde controles de quem não tem o papel. Só conforto de interface: a API é a
 * barreira real (403 `FORBIDDEN_ROLE`).
 */
export function RoleGate(props: { role: Role; children: ReactNode }) {
  return useHasRole(props.role) ? <>{props.children}</> : null
}
