import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, viewer } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

const DEV = operator()
const SUPORTE = viewer()
const PENDENTE = operator({
  id: 4,
  email: 'pendente@connectthink.com.br',
  name: 'Pendente',
  role: 'viewer',
  totpConfigured: false,
})
const BLOQUEADO = operator({
  id: 3,
  email: 'bloqueado@connectthink.com.br',
  name: 'Bloqueado',
  role: 'viewer',
  lockedUntil: '2099-01-01T00:00:00.000Z',
})

const listHandler = (items: Schemas['Operator'][]) =>
  http.get('*/admin/operators', () => HttpResponse.json({ items }))

const ISSUED = (who: Schemas['Operator']): Schemas['IssuedOperatorAccess'] => ({
  operator: who,
  temporaryPassword: 'Provisoria-123456',
})

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(
    await screen.findByRole('button', { name: `Ações de ${name}` }),
  )
}

describe('tela Operadores', () => {
  it('lista nome, e-mail, papel, estado e bloqueio', async () => {
    server.use(meHandler(DEV), listHandler([DEV, SUPORTE, BLOQUEADO]))
    renderApp('/operators')
    const row = (
      await screen.findByText('bloqueado@connectthink.com.br')
    ).closest('tr')!
    expect(within(row).getByText('Bloqueado')).toBeInTheDocument()
    expect(within(row).getByText('viewer')).toBeInTheDocument()
    expect(within(row).getByText('Ativo')).toBeInTheDocument()
    expect(within(row).getByText(/até/)).toBeInTheDocument()
    const own = screen.getByText('dev@connectthink.com.br').closest('tr')!
    expect(within(own).getByText('(você)')).toBeInTheDocument()
  })

  it('mostra "Autenticador pendente" só para quem ainda não cadastrou o app', async () => {
    server.use(meHandler(DEV), listHandler([DEV, PENDENTE]))
    renderApp('/operators')
    const pending = (
      await screen.findByText('pendente@connectthink.com.br')
    ).closest('tr')!
    expect(
      within(pending).getByText('Autenticador pendente'),
    ).toBeInTheDocument()
    const own = screen.getByText('dev@connectthink.com.br').closest('tr')!
    expect(within(own).queryByText('Autenticador pendente')).toBeNull()
  })

  it('redefinir acesso: exige o e-mail e o motivo e mostra só a senha provisória, uma vez', async () => {
    let reason: string | null = null
    server.use(
      meHandler(DEV),
      listHandler([DEV, SUPORTE]),
      http.post('*/admin/operators/2/reset-access', ({ request }) => {
        reason = request.headers.get('X-Admin-Reason')
        return HttpResponse.json(ISSUED(SUPORTE))
      }),
    )
    const { user } = renderApp('/operators')
    await openMenu(user, 'Suporte')
    await user.click(
      await screen.findByRole('menuitem', { name: 'Redefinir acesso' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Redefinir acesso',
    })
    expect(confirm).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText(/Digite/),
      'suporte@connectthink.com.br',
    )
    await user.type(within(dialog).getByLabelText(/Motivo/), 'perdeu o celular')
    await user.click(confirm)

    expect(await screen.findByText('Provisoria-123456')).toBeInTheDocument()
    expect(reason).toBe('perdeu o celular')
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() =>
      expect(screen.queryByText('Provisoria-123456')).toBeNull(),
    )
  })

  it('na própria linha não há Trocar papel nem Desativar', async () => {
    server.use(meHandler(DEV), listHandler([DEV, SUPORTE]))
    const { user } = renderApp('/operators')
    await openMenu(user, 'Dev')
    expect(
      await screen.findByRole('menuitem', { name: 'Redefinir acesso' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Trocar papel' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Desativar' })).toBeNull()
  })

  it('nas outras linhas há Trocar papel e Desativar', async () => {
    server.use(meHandler(DEV), listHandler([DEV, SUPORTE]))
    const { user } = renderApp('/operators')
    await openMenu(user, 'Suporte')
    expect(
      await screen.findByRole('menuitem', { name: 'Trocar papel' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Desativar' }),
    ).toBeInTheDocument()
  })

  it('LAST_OPERATOR: mostra a mensagem da API e mantém o diálogo aberto', async () => {
    const OUTRO = operator({
      id: 9,
      email: 'outro@connectthink.com.br',
      name: 'Outro',
    })
    server.use(
      meHandler(DEV),
      listHandler([DEV, OUTRO]),
      http.patch('*/admin/operators/9', () =>
        apiError(
          409,
          'LAST_OPERATOR',
          'Deve existir ao menos um operator ativo',
        ),
      ),
    )
    const { user } = renderApp('/operators')
    await openMenu(user, 'Outro')
    await user.click(
      await screen.findByRole('menuitem', { name: 'Trocar papel' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Tornar viewer' }),
    )
    expect(await within(dialog).findByText('LAST_OPERATOR')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Deve existir ao menos um operator ativo')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('trocar papel e ativar/desativar enviam o PATCH certo', async () => {
    const bodies: Array<Record<string, unknown>> = []
    server.use(
      meHandler(DEV),
      listHandler([DEV, SUPORTE]),
      http.patch('*/admin/operators/2', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(SUPORTE)
      }),
    )
    const { user } = renderApp('/operators')
    await openMenu(user, 'Suporte')
    await user.click(
      await screen.findByRole('menuitem', { name: 'Trocar papel' }),
    )
    let dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Tornar operator' }),
    )
    await waitFor(() => expect(bodies).toEqual([{ role: 'operator' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await openMenu(user, 'Suporte')
    await user.click(await screen.findByRole('menuitem', { name: 'Desativar' }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(bodies[1]).toEqual({ active: false }))
  })

  it('criar operador mostra só a senha provisória, uma vez', async () => {
    let body: Record<string, unknown> | null = null
    const novo = operator({
      id: 7,
      email: 'novo@connectthink.com.br',
      name: 'Novo',
      role: 'viewer',
    })
    server.use(
      meHandler(DEV),
      listHandler([DEV]),
      http.post('*/admin/operators', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(ISSUED(novo), { status: 201 })
      }),
    )
    const { user } = renderApp('/operators')
    await user.click(
      await screen.findByRole('button', { name: 'Criar operador' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Criar conta' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Nome'), 'Novo')
    await user.type(
      within(dialog).getByLabelText('E-mail'),
      'novo@connectthink.com.br',
    )
    await user.click(confirm)

    expect(await screen.findByText('Provisoria-123456')).toBeInTheDocument()
    expect(body).toEqual({
      name: 'Novo',
      email: 'novo@connectthink.com.br',
      role: 'viewer',
    })
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull()
  })

  it('suporte vê "Sem permissão" e nenhuma conta', async () => {
    server.use(meHandler(SUPORTE))
    renderApp('/operators')
    expect(await screen.findByText('Sem permissão')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Criar operador' })).toBeNull()
  })
})
