import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router'
import { api, call } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useHasRole } from '@/components/role-gate'
import { useMe } from '@/features/auth/session'
import { cn } from '@/lib/utils'
import { visibleGroups } from './nav'

function Brand(props: { onNavigate?: () => void }) {
  return (
    <Link
      to="/"
      onClick={props.onNavigate}
      className="flex items-center gap-2 px-2 py-1"
    >
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
      >
        C
      </span>
      <span className="grid leading-tight">
        <span className="text-sm font-semibold">CRMThink</span>
        <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">
          Backoffice
        </span>
      </span>
    </Link>
  )
}

/** Usuário no rodapé do menu: trocar a senha e sair. */
function UserMenu() {
  const me = useMe()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = useMutation({
    mutationFn: () => call(api.POST('/admin/auth/logout')),
    onSettled: () => {
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })
  if (me.data?.kind !== 'operator') return null
  const { operator } = me.data
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2 p-2"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-full bg-muted text-xs font-semibold"
          >
            {operator.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 truncate font-medium">{operator.name}</span>
          <Badge variant="outline" className="ml-auto">
            {operator.role}
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="font-medium">{operator.name}</div>
          <div className="text-xs text-muted-foreground">{operator.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/password')}>
          <KeyRound /> Trocar senha
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Menu lateral: marca, navegação em grupos e o usuário no rodapé. O mesmo conteúdo serve ao
 * menu fixo do desktop (`navLabel="Principal"`) e à gaveta do celular (`navLabel="Menu"`).
 */
export function Sidebar(props: { navLabel: string; onNavigate?: () => void }) {
  const groups = visibleGroups(useHasRole('operator'))
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-3">
        <Brand onNavigate={props.onNavigate} />
      </div>
      <nav
        aria-label={props.navLabel}
        className="flex-1 space-y-5 overflow-y-auto px-3 py-3"
      >
        {groups.map((group, index) => (
          <div key={group.title ?? index}>
            {group.title && (
              <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {group.title}
              </p>
            )}
            <div className="grid gap-0.5">
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={props.onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    )
                  }
                >
                  <item.icon className="size-4" /> {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t p-2">
        <UserMenu />
      </div>
    </div>
  )
}
