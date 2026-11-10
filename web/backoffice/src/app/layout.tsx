import { Menu, Monitor, Moon, Sun } from 'lucide-react'
import { Fragment, useState } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useMatches,
  type UIMatch,
} from 'react-router'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMe } from '@/features/auth/session'
import { Sidebar } from './sidebar'
import { useTheme } from './theme'

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

/**
 * Moldura das telas autenticadas: menu lateral fixo no desktop e em gaveta no celular, e
 * uma barra fina com a trilha e o seletor de tema.
 */
export function AppLayout() {
  const [open, setOpen] = useState(false)
  return (
    <div className="grid min-h-svh lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-svh border-r bg-sidebar text-sidebar-foreground lg:block">
        <Sidebar navLabel="Principal" />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Abrir menu"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-64 gap-0 bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Navegação do backoffice
          </SheetDescription>
          <Sidebar navLabel="Menu" onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
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
