import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, viewer } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

type Integration = Schemas['PaymentIntegration']

const KEY = `pay_${'k'.repeat(43)}`
const NEW_KEY = `pay_${'n'.repeat(43)}`
const REASON = 'integracao combinada com o financeiro'

const integration = (overrides: Partial<Integration> = {}): Integration => ({
  id: 1,
  name: 'Banco X',
  keyPrefix: KEY.slice(0, 8),
  active: true,
  lastUsedAt: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  ...overrides,
})

const listHandler = (items: Integration[]) =>
  http.get('*/admin/payment-integrations', () => HttpResponse.json({ items }))

const withKey = (item: Integration, apiKey: string) => ({
  integration: item,
  apiKey,
  notice: 'Guarde a chave agora.',
})

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(
    await screen.findByRole('button', { name: `Ações de ${name}` }),
  )
}

describe('tela Integrações de pagamento', () => {
  it('o menu tem o item para qualquer papel e a lista mostra só o prefixo da chave', async () => {
    server.use(
      meHandler(viewer()),
      listHandler([
        integration(),
        integration({
          id: 2,
          name: 'Cobrança Y',
          active: false,
          keyPrefix: 'pay_abcd',
          lastUsedAt: '2026-10-20T12:00:00.000Z',
        }),
      ]),
    )
    renderApp('/payment-integrations')

    const row = (await screen.findByText('Banco X')).closest('tr')!
    expect(within(row).getByText('pay_kkkk…')).toBeInTheDocument()
    expect(within(row).getByText('Ativa')).toBeInTheDocument()
    expect(within(row).getByText('Nunca usada')).toBeInTheDocument()
    const other = screen.getByText('Cobrança Y').closest('tr')!
    expect(within(other).getByText('Desativada')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Integrações de pagamento/ }),
    ).toBeInTheDocument()
  })

  it('suporte só consulta: sem criar, renomear, rotacionar nem desativar', async () => {
    server.use(meHandler(viewer()), listHandler([integration()]))
    renderApp('/payment-integrations')
    await screen.findByText('Banco X')
    expect(screen.queryByRole('button', { name: 'Nova integração' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ações de/ })).toBeNull()
  })

  it('sem integrações: estado vazio', async () => {
    server.use(meHandler(operator()), listHandler([]))
    renderApp('/payment-integrations')
    expect(
      await screen.findByText('Nenhuma integração cadastrada.'),
    ).toBeInTheDocument()
  })

  it('criar: exige o motivo, mostra a chave uma única vez e some ao fechar', async () => {
    let created = false
    let received: { body: unknown; reason: string | null } | null = null
    server.use(
      meHandler(operator()),
      http.get('*/admin/payment-integrations', () =>
        HttpResponse.json({ items: created ? [integration()] : [] }),
      ),
      http.post('*/admin/payment-integrations', async ({ request }) => {
        created = true
        received = {
          body: await request.json(),
          reason: request.headers.get('X-Admin-Reason'),
        }
        return HttpResponse.json(withKey(integration(), KEY), { status: 201 })
      }),
    )
    const { user } = renderApp('/payment-integrations')
    await user.click(
      await screen.findByRole('button', { name: 'Nova integração' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Criar integração',
    })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Nome'), 'Banco X')
    expect(confirm).toBeDisabled() // falta o motivo
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(confirm)

    expect(await screen.findByText(KEY)).toBeInTheDocument()
    expect(screen.getByText('Exibido uma única vez')).toBeInTheDocument()
    expect(received).toEqual({ body: { name: 'Banco X' }, reason: REASON })

    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(screen.queryByText(KEY)).toBeNull())
    expect(await screen.findByText('pay_kkkk…')).toBeInTheDocument()
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain(KEY)
  })

  it('rotacionar: exige o motivo e mostra a chave nova uma única vez', async () => {
    let received: string | null = null
    server.use(
      meHandler(operator()),
      listHandler([integration()]),
      http.post('*/admin/payment-integrations/1/rotate-key', ({ request }) => {
        received = request.headers.get('X-Admin-Reason')
        return HttpResponse.json(withKey(integration(), NEW_KEY))
      }),
    )
    const { user } = renderApp('/payment-integrations')
    await openMenu(user, 'Banco X')
    await user.click(
      await screen.findByRole('menuitem', { name: 'Rotacionar chave' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Rotacionar chave',
    })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(confirm)

    expect(await screen.findByText(NEW_KEY)).toBeInTheDocument()
    expect(received).toBe(REASON)
    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(screen.queryByText(NEW_KEY)).toBeNull())
  })

  it('desativar exige o motivo; reativar e renomear não', async () => {
    const calls: Array<{
      body: Record<string, unknown>
      reason: string | null
    }> = []
    server.use(
      meHandler(operator()),
      listHandler([
        integration(),
        integration({ id: 2, name: 'Cobrança Y', active: false }),
      ]),
      http.patch('*/admin/payment-integrations/:id', async ({ request }) => {
        calls.push({
          body: (await request.json()) as Record<string, unknown>,
          reason: request.headers.get('X-Admin-Reason'),
        })
        return HttpResponse.json(integration())
      }),
    )
    const { user } = renderApp('/payment-integrations')

    await openMenu(user, 'Banco X')
    await user.click(await screen.findByRole('menuitem', { name: 'Desativar' }))
    let dialog = await screen.findByRole('dialog')
    const off = within(dialog).getByRole('button', { name: 'Desativar' })
    expect(off).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(off)
    expect(await screen.findByText('Integração desativada')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await openMenu(user, 'Cobrança Y')
    await user.click(await screen.findByRole('menuitem', { name: 'Reativar' }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reativar' }))
    expect(await screen.findByText('Integração reativada')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await openMenu(user, 'Banco X')
    await user.click(await screen.findByRole('menuitem', { name: 'Renomear' }))
    dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByLabelText('Nome')
    expect(name).toHaveValue('Banco X')
    const rename = within(dialog).getByRole('button', { name: 'Renomear' })
    expect(rename).toBeDisabled() // nome igual ao atual
    await user.clear(name)
    await user.type(name, 'Banco Z')
    await user.click(rename)
    expect(await screen.findByText('Integração renomeada')).toBeInTheDocument()

    expect(calls).toEqual([
      { body: { active: false }, reason: REASON },
      { body: { active: true }, reason: null },
      { body: { name: 'Banco Z' }, reason: null },
    ])
  })

  it('erro da API aparece no diálogo, que continua aberto', async () => {
    server.use(
      meHandler(operator()),
      listHandler([integration()]),
      http.post('*/admin/payment-integrations/1/rotate-key', () =>
        apiError(
          404,
          'PAYMENT_INTEGRATION_NOT_FOUND',
          'Integração de pagamento não encontrada',
        ),
      ),
    )
    const { user } = renderApp('/payment-integrations')
    await openMenu(user, 'Banco X')
    await user.click(
      await screen.findByRole('menuitem', { name: 'Rotacionar chave' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(
      within(dialog).getByRole('button', { name: 'Rotacionar chave' }),
    )
    expect(
      await within(dialog).findByText('PAYMENT_INTEGRATION_NOT_FOUND'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
