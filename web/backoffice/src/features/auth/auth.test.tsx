import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { RoleGate } from '@/components/role-gate'
import { safeNext } from '@/lib/safe-next'
import { apiError, meHandler, operator, viewer } from '@/test/fixtures'
import { currentUrl, renderApp, renderRoutes } from '@/test/render'
import { server } from '@/test/server'

type User = ReturnType<typeof renderApp>['user']

const SECRET = 'JBSWY3DPEHPK3PXP'
const OTPAUTH = `otpauth://totp/CRMThink:dev@connectthink.com.br?secret=${SECRET}&issuer=CRMThink`
const EXPIRES = '2026-10-29T00:00:00.000Z'

async function fillCredentials(user: User) {
  await user.type(screen.getByLabelText('E-mail'), 'dev@connectthink.com.br')
  await user.type(screen.getByLabelText('Senha'), 'senha-definitiva-123')
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
}

async function fillCode(user: User, button = 'Entrar') {
  await user.type(await screen.findByLabelText('Código (6 dígitos)'), '123456')
  await user.click(screen.getByRole('button', { name: button }))
}

const askCode = (trustedDeviceDays = 30) =>
  http.post('*/admin/auth/login', () =>
    HttpResponse.json({ step: 'totp', challenge: 'c1', trustedDeviceDays }),
  )

/** `GET /admin/auth/me` que só passa a responder depois de `login()` ser chamado. */
function sessionAfterLogin() {
  let me: ReturnType<typeof operator> | null = null
  return {
    login: (who = operator()) => {
      me = who
      return who
    },
    handler: http.get('*/admin/auth/me', () =>
      me
        ? HttpResponse.json({
            kind: 'operator',
            actor: 'operator:1',
            role: me.role,
            operator: me,
          })
        : apiError(401, 'UNAUTHORIZED'),
    ),
  }
}

describe('login', () => {
  it('sem sessão vai ao login, pede senha e depois o código, e volta ao endereço de origem', async () => {
    const session = sessionAfterLogin()
    const bodies: unknown[] = []
    server.use(
      session.handler,
      http.post('*/admin/auth/login', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({
          step: 'totp',
          challenge: 'c1',
          trustedDeviceDays: 30,
        })
      }),
      http.post('*/admin/auth/totp', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({
          step: 'authenticated',
          operator: session.login(),
          expiresAt: EXPIRES,
        })
      }),
    )
    const { router, user } = renderApp('/audit?actor=token%3Aabc')
    await screen.findByRole('button', { name: 'Continuar' })
    expect(currentUrl(router)).toBe(
      '/login?next=%2Faudit%3Factor%3Dtoken%253Aabc',
    )

    await fillCredentials(user)
    expect(screen.queryByLabelText('Senha')).toBeNull()
    await fillCode(user)

    await waitFor(() =>
      expect(currentUrl(router)).toBe('/audit?actor=token%3Aabc'),
    )
    expect(await screen.findByText('Dev')).toBeInTheDocument()
    expect(bodies).toEqual([
      { email: 'dev@connectthink.com.br', password: 'senha-definitiva-123' },
      { challenge: 'c1', code: '123456', rememberDevice: false },
    ])
  })

  it('"Lembrar este navegador" informa os dias e envia rememberDevice', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      meHandler(null),
      askCode(30),
      http.post('*/admin/auth/totp', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return apiError(401, 'INVALID_CREDENTIALS')
      }),
    )
    const { user } = renderApp('/login')
    await fillCredentials(user)
    const box = await screen.findByRole('checkbox', {
      name: 'Lembrar este navegador por 30 dias',
    })
    expect(box).not.toBeChecked()
    await user.click(box)
    await fillCode(user)

    await waitFor(() => expect(body).toMatchObject({ rememberDevice: true }))
  })

  it('com o recurso desligado (0 dias) não oferece a opção', async () => {
    server.use(meHandler(null), askCode(0))
    const { user } = renderApp('/login')
    await fillCredentials(user)
    await screen.findByLabelText('Código (6 dígitos)')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('navegador lembrado entra direto, sem pedir o código', async () => {
    const session = sessionAfterLogin()
    server.use(
      session.handler,
      http.post('*/admin/auth/login', () =>
        HttpResponse.json({
          step: 'authenticated',
          operator: session.login(),
          expiresAt: EXPIRES,
        }),
      ),
    )
    const { router, user } = renderApp('/login')
    await fillCredentials(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.queryByLabelText('Código (6 dígitos)')).toBeNull()
  })

  it('primeiro acesso mostra o QR code e o segredo, e o primeiro código conclui o cadastro', async () => {
    const session = sessionAfterLogin()
    let body: unknown = null
    server.use(
      session.handler,
      http.post('*/admin/auth/login', () =>
        HttpResponse.json({
          step: 'totp-setup',
          challenge: 'c9',
          secret: SECRET,
          otpauthUri: OTPAUTH,
          trustedDeviceDays: 30,
        }),
      ),
      http.post('*/admin/auth/totp', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          step: 'authenticated',
          operator: session.login(),
          expiresAt: EXPIRES,
        })
      }),
    )
    const networkCalls: string[] = []
    server.events.on('request:start', ({ request }) => {
      networkCalls.push(new URL(request.url).pathname)
    })
    const { router, queryClient, user } = renderApp('/login')
    await fillCredentials(user)

    expect(
      await screen.findByRole('img', {
        name: 'QR code para o app autenticador',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(SECRET)).toBeInTheDocument()
    // Só a API de operador: o URI com o segredo nunca vai a um serviço de QR code.
    expect(networkCalls.every(path => path.startsWith('/admin/'))).toBe(true)
    expect(window.location.href).not.toContain(SECRET)

    await fillCode(user, 'Confirmar e entrar')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(body).toEqual({
      challenge: 'c9',
      code: '123456',
      rememberDevice: false,
    })
    // O segredo não fica no cache de consultas, no armazenamento nem na tela.
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(
      SECRET,
    )
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain(SECRET)
    expect(document.body).not.toHaveTextContent(SECRET)
  })

  it('falha mostra uma mensagem genérica e limpa o código', async () => {
    server.use(
      meHandler(null),
      askCode(),
      http.post('*/admin/auth/totp', () =>
        apiError(401, 'INVALID_CREDENTIALS'),
      ),
    )
    const { user } = renderApp('/login')
    await fillCredentials(user)
    await fillCode(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-mail, senha ou código inválidos.',
    )
    expect(screen.getByLabelText('Código (6 dígitos)')).toHaveValue('')
  })

  it('senha errada na primeira etapa mostra a mesma mensagem genérica', async () => {
    server.use(
      meHandler(null),
      http.post('*/admin/auth/login', () =>
        apiError(401, 'INVALID_CREDENTIALS'),
      ),
    )
    const { user } = renderApp('/login')
    await fillCredentials(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-mail, senha ou código inválidos.',
    )
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
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
    await fillCredentials(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Tente de novo em 9 minutos.',
    )
  })

  it('desafio vencido volta para e-mail e senha com o aviso', async () => {
    server.use(
      meHandler(null),
      askCode(),
      http.post('*/admin/auth/totp', () => apiError(401, 'CHALLENGE_EXPIRED')),
    )
    const { user } = renderApp('/login')
    await fillCredentials(user)
    await fillCode(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O tempo para digitar o código acabou. Entre de novo.',
    )
    expect(screen.getByLabelText('Senha')).toHaveValue('')
    expect(screen.queryByLabelText('Código (6 dígitos)')).toBeNull()
  })

  it('senha provisória, depois do código, leva à troca de senha', async () => {
    const session = sessionAfterLogin()
    server.use(
      session.handler,
      askCode(),
      http.post('*/admin/auth/totp', () =>
        HttpResponse.json({
          step: 'authenticated',
          operator: session.login(operator({ mustChangePassword: true })),
          expiresAt: EXPIRES,
        }),
      ),
    )
    const { router, user } = renderApp('/login')
    await fillCredentials(user)
    await fillCode(user)

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/password'),
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

describe('menu lateral', () => {
  // As telas abertas nestes testes buscam dados; a falha delas não importa aqui.
  const anyData = http.get('*/admin/*', () => apiError(500, 'INTERNAL_ERROR'))

  it('operator vê os grupos e os oito links', async () => {
    server.use(meHandler(operator()), anyData)
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })

    for (const title of ['Operação', 'Acesso', 'Plataforma'])
      expect(within(nav).getByText(title)).toBeInTheDocument()
    for (const label of [
      'Painel',
      'Instalações',
      'Eventos',
      'Eventos Stripe',
      'Apps',
      'Auditoria',
      'Operadores',
      'Sistema',
    ])
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
  })

  it('suporte não vê Plataforma, Sistema nem Operadores, mas vê Auditoria', async () => {
    server.use(meHandler(viewer()), anyData)
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })

    expect(within(nav).queryByText('Plataforma')).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Sistema' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Operadores' })).toBeNull()
    expect(
      within(nav).getByRole('link', { name: 'Auditoria' }),
    ).toBeInTheDocument()
  })

  it('numa rota aninhada o item da seção continua marcado', async () => {
    server.use(meHandler(operator()), anyData)
    renderApp('/installations/1234')
    const nav = await screen.findByRole('navigation', { name: 'Principal' })

    expect(
      within(nav).getByRole('link', { name: 'Instalações' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(nav).getByRole('link', { name: 'Painel' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('marca com selo e usuário no rodapé do menu', async () => {
    server.use(meHandler(viewer()), anyData)
    const { user } = renderApp('/')
    const aside = await screen.findByRole('complementary')

    expect(within(aside).getByText('CRMThink')).toBeInTheDocument()
    expect(within(aside).getByText('Backoffice')).toBeInTheDocument()
    await user.click(within(aside).getByRole('button', { name: /Suporte/ }))
    expect(
      await screen.findByRole('menuitem', { name: /Trocar senha/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Sair/ })).toBeInTheDocument()
  })

  it('o nome no rodapé do menu encolhe em vez de empurrar o papel para fora', async () => {
    server.use(meHandler(viewer()), anyData)
    renderApp('/')
    const aside = await screen.findByRole('complementary')

    expect(within(aside).getByText('Suporte')).toHaveClass(
      'min-w-0',
      'truncate',
    )
  })

  it('a barra de cima guarda o tema e o menu usa só tokens do tema', async () => {
    server.use(meHandler(operator()), anyData)
    renderApp('/')
    const aside = await screen.findByRole('complementary')
    const bar = screen.getByRole('banner')

    expect(
      within(bar).getByRole('button', { name: /\(trocar\)$/ }),
    ).toBeInTheDocument()
    expect(aside.innerHTML).not.toMatch(/zinc-|#[0-9a-f]{3,6}/i)
  })

  it('no celular o menu abre numa gaveta e fecha ao navegar', async () => {
    server.use(meHandler(operator()), anyData)
    const { router, user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: 'Abrir menu' }))

    const dialog = await screen.findByRole('dialog')
    const drawerNav = within(dialog).getByRole('navigation', { name: 'Menu' })
    await user.click(within(drawerNav).getByRole('link', { name: 'Eventos' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/events'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
