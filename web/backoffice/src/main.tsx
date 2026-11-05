import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { applyStoredTheme } from '@/app/theme'
import { createQueryClient } from '@/app/query-client'
import { routes } from '@/app/routes'
import './index.css'

// Antes do primeiro desenho: evita piscar o tema errado.
applyStoredTheme()

const router = createBrowserRouter(routes, { basename: '/backoffice' })
const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
