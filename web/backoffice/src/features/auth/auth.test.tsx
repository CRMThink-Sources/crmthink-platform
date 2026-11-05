import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { RoleGate } from '@/components/role-gate'
import { safeNext } from '@/lib/safe-next'
import { apiError, meHandler, operator, viewer } from '@/test/fixtures'
import { currentUrl, renderApp, renderRoutes } from '@/test/render'
import { server } from '@/test/server'

async function fillLogin(user: ReturnType<typeof renderApp>['user']) {
  await user.type(screen.getByLabelText('E-mail'), 'dev@connectthink.com.br')
  await user.type(screen.getByLabelText('Senha'), 'senha-definitiva-123')
  await user.type(screen.getByLabelText('Código (6 dígitos)'), '123456')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('login', () => {
  it('sem sessão vai ao login e, ao entrar, volta ao endereço de origem', async () => {
    let me: ReturnType<typeof operator> | null = null
    server.use(
      http.get('*/admin/auth/me', () =>
        me
          ? HttpResponse.json({
              kind: 'operator',
              actor: 'operator:1',
              role: me.role,
              operator: me,
            })
          : apiError(401, 'UNAUTHORIZED'),
      ),
      http.post('*/admin/auth/login', async ({ request }) => {
        expect(await request.json()).toEqual({
          email: 'dev@connectthink.com.br',
          password: 'senha-definitiva-123',
          code: '123456',
        })
        me = operator()
        return HttpResponse.json({
          operator: me,
          expiresAt: '2026-10-29T00:00:00.000Z',
        })
      }),
    )
    const { router, user } = renderApp('/audit?actor=token%3Aabc')
    await screen.findByRole('button', { name: 'Entrar' })
    expect(currentUrl(router)).toBe(
      '/login?next=%2Faudit%3Factor%3Dtoken%253Aabc',
    )

    await fillLogin(user)
    await waitFor(() =>
      expect(currentUrl(router)).toBe('/audit?actor=token%3Aabc'),
    )
    expect(await screen.findByText('Dev')).toBeInTheDocument()
  })

  it('falha mostra uma mensagem genérica', async () => {
    server.use(
      meHandler(null),
      http.post('*/admin/auth/login', () =>
        apiError(401, 'INVALID_CREDENTIALS'),
      ),
    )
    const { user } = renderApp('/login')
    await fillLogin(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-mail, senha ou código inválidos.',
    )
    expect(screen.getByLabelText('Código (6 dígitos)')).toHaveValue('')
  })

  it('429 mostra o tempo de espera', async () => {
    server.use(
      meHandler(null),
      http.post('*/admin/auth/login', () =>
        HttpResponse.json(
          {
            error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas' },
          },
          { status: 429, headers: { 'Retry-After': '540' } },
        ),
      ),
    )
    const { user } = renderApp('/login')
    await fillLogin(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Tente de novo em 9 minutos.',
    )
  })

  it('senha provisória leva à troca e só depois libera o painel', async () => {
    let current = operator({ mustChangePassword: true })
    server.use(
      http.get('*/admin/auth/me', () =>
        HttpResponse.json({
          kind: 'operator',
          actor: 'operator:1',
          role: 'operator',
          operator: current,
        }),
      ),
      http.post('*/admin/auth/password', async ({ request }) => {
        expect(await request.json()).toEqual({
          currentPassword: 'provisoria-xyz',
          newPassword: 'nova-senha-segura-1',
        })
        current = operator()
        return HttpResponse.json({ operator: current })
      }),
    )
    const { router, user } = renderApp('/installations')
    expect(await screen.findByText('Defina sua senha')).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Principal' }),
    ).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Senha provisória'), 'provisoria-xyz')
    await user.type(screen.getByLabelText('Nova senha'), 'curta')
    await user.type(screen.getByLabelText('Confirme a nova senha'), 'curta')
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ao menos 12 caracteres',
    )

    await user.clear(screen.getByLabelText('Nova senha'))
    await user.type(screen.getByLabelText('Nova senha'), 'nova-senha-segura-1')
    await user.clear(screen.getByLabelText('Confirme a nova senha'))
    await user.type(
      screen.getByLabelText('Confirme a nova senha'),
      'nova-senha-segura-1',
    )
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/installations'),
    )
    expect(
      await screen.findByRole('navigation', { name: 'Principal' }),
    ).toBeInTheDocument()
  })

  it('next só aceita caminhos internos', () => {
    expect(safeNext('/installations/1?tab=timeline')).toBe(
      '/installations/1?tab=timeline',
    )
    expect(safeNext('//evil.test')).toBe('/')
    expect(safeNext('https://evil.test')).toBe('/')
    expect(safeNext('/login')).toBe('/')
    expect(safeNext(null)).toBe('/')
  })
})

describe('layout e papéis', () => {
  it('mostra nome e papel; sair revoga a sessão e volta ao login', async () => {
    let loggedOut = false
    server.use(
      meHandler(viewer()),
      http.post('*/admin/auth/logout', () => {
        loggedOut = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: /Suporte/ }))
    expect(screen.getByText('suporte@connectthink.com.br')).toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: /Sair/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(loggedOut).toBe(true)
  })

  it('RoleGate esconde controles de operator para viewer', async () => {
    server.use(meHandler(viewer()))
    renderRoutes(
      [
        {
          path: '/',
          element: (
            <>
              <p>conteúdo</p>
              <RoleGate role="viewer">ver</RoleGate>
              <RoleGate role="operator">ação de operator</RoleGate>
            </>
          ),
        },
      ],
      '/',
    )
    expect(await screen.findByText('ver')).toBeInTheDocument()
    expect(screen.queryByText('ação de operator')).not.toBeInTheDocument()
  })

  it('trilha de navegação no detalhe', async () => {
    server.use(meHandler(operator()))
    renderApp('/installations/1234')
    const trail = await screen.findByRole('navigation', { name: 'Trilha' })
    expect(trail).toHaveTextContent('Painel/Instalações/#1234')
  })
})
