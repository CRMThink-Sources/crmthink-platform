import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  type RouteObject,
} from 'react-router'
import { AuthEventsBridge } from '@/app/auth-bridge'
import { Providers } from '@/app/providers'
import { createQueryClient } from '@/app/query-client'
import { routes as appTree } from '@/app/routes'

function testQueryClient() {
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({
    queries: { retry: false, staleTime: 0 },
    mutations: { retry: false },
  })
  return queryClient
}

function mount(routes: RouteObject[], initialPath: string) {
  const queryClient = testQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  const view = render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { ...view, router, queryClient, user: userEvent.setup() }
}

/** Monta rotas avulsas com o mesmo cache, provedores e ponte de auth do app. */
export function renderRoutes(routes: RouteObject[], initialPath: string) {
  return mount(
    [
      {
        element: (
          <>
            <AuthEventsBridge />
            <Outlet />
          </>
        ),
        children: routes,
      },
    ],
    initialPath,
  )
}

/** Monta o app inteiro (`src/app/routes.tsx`) num endereço. */
export function renderApp(initialPath: string) {
  return mount(appTree, initialPath)
}

/** `pathname + search` atual do roteador. */
export const currentUrl = (router: {
  state: { location: { pathname: string; search: string } }
}) => router.state.location.pathname + router.state.location.search
