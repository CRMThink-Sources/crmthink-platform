import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Boxes,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  ScrollText,
  Send,
  Sun,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Fragment } from 'react'
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useMatches,
  useNavigate,
  type UIMatch,
} from 'react-router'
import { api, call } from '@/api/client'
import { ErrorState, LoadingState } from '@/components/states'
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
import { useMe } from '@/features/auth/session'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/installations', label: 'Instalações', icon: Boxes },
  { to: '/events', label: 'Eventos', icon: Send },
  { to: '/stripe-events', label: 'Eventos Stripe', icon: CreditCard },
  { to: '/apps', label: 'Apps', icon: Activity },
  { to: '/audit', label: 'Auditoria', icon: ScrollText },
]

/** `handle.crumb` de cada rota: texto fixo ou função dos parâmetros. */
export type RouteHandle = {
  crumb?: string | ((match: UIMatch) => string)
}

function Breadcrumbs() {
  const matches = useMatches() as UIMatch<unknown, RouteHandle | undefined>[]
  const crumbs = matches.filter(match => match.handle?.crumb)
  if (crumbs.length < 2) return null
  return (
    <nav aria-label="Trilha" className="text-sm text-muted-foreground">
      {crumbs.map((match, index) => {
        const crumb = match.handle!.crumb!
        const label = typeof crumb === 'function' ? crumb(match) : crumb
        const last = index === crumbs.length - 1
        return (
          <Fragment key={match.id}>
            {index > 0 && <span className="mx-1.5">/</span>}
            {last ? (
              <span className="text-foreground">{label}</span>
            ) : (
              <Link to={match.pathname} className="hover:underline">
                {label}
              </Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next =
    theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const label =
    theme === 'light'
      ? 'Tema claro'
      : theme === 'dark'
        ? 'Tema escuro'
        : 'Tema do sistema'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${label} (trocar)`}
      title={label}
      onClick={() => setTheme(next)}
    >
      <Icon />
    </Button>
  )
}

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
        <Button variant="ghost" className="gap-2">
          <span className="font-medium">{operator.name}</span>
          <Badge variant="outline">{operator.role}</Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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

/** Moldura das telas autenticadas: barra lateral, cabeçalho e trilha. */
export function AppLayout() {
  return (
    <div className="grid min-h-svh grid-cols-[220px_1fr]">
      <aside className="border-r bg-sidebar p-3 text-sidebar-foreground">
        <div className="px-2 py-3 text-sm font-semibold">
          Backoffice CRMThink
        </div>
        <nav className="grid gap-1" aria-label="Principal">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent',
                  isActive && 'bg-sidebar-accent font-medium',
                )
              }
            >
              <item.icon className="size-4" /> {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex h-12 items-center justify-between border-b px-4">
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/**
 * Guarda das telas autenticadas: sem sessão a API responde 401 e a ponte de auth leva
 * ao login; com senha provisória, só a troca de senha.
 */
export function RequireSession() {
  const me = useMe()
  const location = useLocation()
  if (me.isPending) return <LoadingState rows={6} />
  if (me.isError)
    return (
      <div className="p-6">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </div>
    )
  if (me.data.kind === 'operator' && me.data.operator.mustChangePassword)
    return (
      <Navigate
        to={`/password?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  return <AppLayout />
}
