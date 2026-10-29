import { Outlet, type RouteObject } from 'react-router'
import { LoginPage } from '@/features/auth/login-page'
import { PasswordPage } from '@/features/auth/password-page'
import { AppDetailPage } from '@/features/app-detail/page'
import { AppsPage } from '@/features/apps/page'
import { AuditPage } from '@/features/audit/page'
import { EventsPage } from '@/features/events/page'
import { InstallationDetailPage } from '@/features/installation-detail/page'
import { InstallationsPage } from '@/features/installations/page'
import { OverviewPage } from '@/features/overview/page'
import { StripeEventsPage } from '@/features/stripe-events/page'
import { AuthEventsBridge } from './auth-bridge'
import { RequireSession, type RouteHandle } from './layout'

function Root() {
  return (
    <>
      <AuthEventsBridge />
      <Outlet />
    </>
  )
}

const handle = (crumb: RouteHandle['crumb']): RouteHandle => ({ crumb })

/** Telas autenticadas (dentro do layout). Exportadas para os testes. */
export const appRoutes: RouteObject[] = [
  { index: true, element: <OverviewPage /> },
  {
    path: 'installations',
    handle: handle('Instalações'),
    children: [
      { index: true, element: <InstallationsPage /> },
      {
        path: ':id',
        element: <InstallationDetailPage />,
        handle: handle(match => `#${match.params.id}`),
      },
    ],
  },
  { path: 'events', element: <EventsPage />, handle: handle('Eventos') },
  {
    path: 'stripe-events',
    element: <StripeEventsPage />,
    handle: handle('Eventos Stripe'),
  },
  {
    path: 'apps',
    handle: handle('Apps'),
    children: [
      { index: true, element: <AppsPage /> },
      {
        path: ':appCode',
        element: <AppDetailPage />,
        handle: handle(match => match.params.appCode ?? ''),
      },
    ],
  },
  { path: 'audit', element: <AuditPage />, handle: handle('Auditoria') },
]

/**
 * Árvore do backoffice. Montada com `basename: '/backoffice'` em `main.tsx`; os
 * caminhos aqui não levam o prefixo.
 */
export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'password', element: <PasswordPage /> },
      {
        path: '/',
        element: <RequireSession />,
        handle: handle('Painel'),
        children: appRoutes,
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]

function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <p>Página não encontrada.</p>
      <a href="/backoffice/" className="underline">
        Ir para o painel
      </a>
    </main>
  )
}
