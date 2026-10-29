import { useQuery } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { api, ApiError, call } from '@/api/client'
import { currentUrl, renderRoutes } from '@/test/render'
import { server } from '@/test/server'

function Installations() {
  const query = useQuery({
    queryKey: ['installations'],
    queryFn: () => call(api.GET('/admin/installations')),
  })
  return <p>{query.isError ? 'erro' : 'carregando'}</p>
}

const routes = [
  { path: '/installations', element: <Installations /> },
  { path: '/login', element: <p>tela de login</p> },
  { path: '/password', element: <p>troca de senha</p> },
]

describe('cliente da API', () => {
  it('401 vai ao login guardando o endereço em next', async () => {
    server.use(
      http.get('*/admin/installations', () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Sessão expirada' } },
          { status: 401 },
        ),
      ),
    )
    const { router } = renderRoutes(routes, '/installations?q=acme')
    await screen.findByText('tela de login')
    expect(currentUrl(router)).toBe('/login?next=%2Finstallations%3Fq%3Dacme')
  })

  it('403 PASSWORD_CHANGE_REQUIRED vai à troca de senha', async () => {
    server.use(
      http.get('*/admin/installations', () =>
        HttpResponse.json(
          {
            error: {
              code: 'PASSWORD_CHANGE_REQUIRED',
              message: 'Troque a senha',
            },
          },
          { status: 403 },
        ),
      ),
    )
    const { router } = renderRoutes(routes, '/installations')
    await screen.findByText('troca de senha')
    expect(router.state.location.pathname).toBe('/password')
  })

  it('outros 403 ficam na tela como erro', async () => {
    server.use(
      http.get('*/admin/installations', () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN_ROLE', message: 'Sem permissão' } },
          { status: 403 },
        ),
      ),
    )
    const { router } = renderRoutes(routes, '/installations')
    await screen.findByText('erro')
    expect(router.state.location.pathname).toBe('/installations')
  })

  it('call devolve ApiError com status, código, mensagem e detalhes', async () => {
    server.use(
      http.post('*/admin/operators', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Requisição inválida',
              details: [{ path: 'email', message: 'E-mail inválido' }],
            },
          },
          { status: 400 },
        ),
      ),
    )
    const error = await call(
      api.POST('/admin/operators', {
        body: { email: 'x', name: 'X', role: 'viewer' },
      }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Requisição inválida',
    })
    expect((error as ApiError).fieldErrors).toEqual([
      { path: 'email', message: 'E-mail inválido' },
    ])
  })

  it('401 no próprio login não redireciona', async () => {
    server.use(
      http.post('*/admin/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Credenciais inválidas',
            },
          },
          { status: 401 },
        ),
      ),
    )
    const { router } = renderRoutes(routes, '/password')
    await call(
      api.POST('/admin/auth/login', {
        body: { email: 'a@b.com', password: 'x', code: '000000' },
      }),
    ).catch(() => null)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/password'),
    )
  })
})
