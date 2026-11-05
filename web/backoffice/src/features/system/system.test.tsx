import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { meHandler, operator, viewer } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

describe('tela Sistema', () => {
  it('varredura do Stripe: confirma e mostra o resultado', async () => {
    let reason: string | null | undefined
    server.use(
      meHandler(operator()),
      http.post('*/admin/sweeps/stripe', ({ request }) => {
        reason = request.headers.get('X-Admin-Reason')
        return HttpResponse.json({
          fixed: 3,
          errors: 1,
          checked: 40,
          detail: { checked: 40 },
        })
      }),
    )
    const { user } = renderApp('/system')
    await user.click(
      await screen.findByRole('button', { name: 'Rodar varredura do Stripe' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Motivo/), 'divergência')
    await user.click(
      within(dialog).getByRole('button', { name: 'Rodar agora' }),
    )

    const result = await screen.findByLabelText('Resultado da varredura stripe')
    expect(result).toHaveTextContent('Corrigidos3')
    expect(result).toHaveTextContent('Erros1')
    expect(result).toHaveTextContent('Verificados40')
    expect(reason).toBe('divergência')
    expect(
      await screen.findByText(/Varredura concluída: 3 corrigido/),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('varredura dos SPAs: o resultado mostra o início da janela', async () => {
    server.use(
      meHandler(operator()),
      http.post('*/admin/sweeps/spa', () =>
        HttpResponse.json({
          fixed: 0,
          errors: 0,
          detail: { since: '2026-10-28T10:00:00.000Z' },
        }),
      ),
    )
    const { user } = renderApp('/system')
    await user.click(
      await screen.findByRole('button', { name: 'Rodar varredura dos SPAs' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Rodar agora' }),
    )
    const result = await screen.findByLabelText('Resultado da varredura spa')
    expect(result).toHaveTextContent('Janela desde28/10/2026')
  })

  it('erro da varredura: o diálogo fica aberto com o código', async () => {
    server.use(
      meHandler(operator()),
      http.post('*/admin/sweeps/stripe', () =>
        HttpResponse.json(
          {
            error: { code: 'BITRIX_UNAVAILABLE', message: 'Bitrix fora do ar' },
          },
          { status: 503 },
        ),
      ),
    )
    const { user } = renderApp('/system')
    await user.click(
      await screen.findByRole('button', { name: 'Rodar varredura do Stripe' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Rodar agora' }),
    )
    expect(
      await within(dialog).findByText('BITRIX_UNAVAILABLE'),
    ).toBeInTheDocument()
  })

  it('rotação da chave do JWT: exige ROTACIONAR e o motivo e envia leadMinutes', async () => {
    let body: Record<string, unknown> | null = null
    let reason: string | null = null
    server.use(
      meHandler(operator()),
      http.post('*/admin/signing-keys/rotate', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        reason = request.headers.get('X-Admin-Reason')
        return HttpResponse.json(
          { kid: 'k-2026-11', activatesAt: '2026-11-04T22:00:00.000Z' },
          { status: 201 },
        )
      }),
    )
    const { user } = renderApp('/system')
    await user.click(
      await screen.findByRole('button', { name: 'Rotacionar chave do JWT' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Rotacionar' })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Digite/), 'ROTACIONAR')
    expect(confirm).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText(/Motivo/),
      'rotina trimestral',
    )
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(
      await screen.findByText(/Chave do JWT rotacionada/),
    ).toBeInTheDocument()
    expect(body).toEqual({ leadMinutes: 10 })
    expect(reason).toBe('rotina trimestral')
    expect(await screen.findByRole('status')).toHaveTextContent('k-2026-11')
  })

  it('prazo da chave fora de 0 a 1440 trava a confirmação', async () => {
    server.use(meHandler(operator()))
    const { user } = renderApp('/system')
    await user.click(
      await screen.findByRole('button', { name: 'Rotacionar chave do JWT' }),
    )
    const dialog = await screen.findByRole('dialog')
    const lead = within(dialog).getByLabelText(/Minutos até/)
    await user.clear(lead)
    await user.type(lead, '2000')
    await user.type(within(dialog).getByLabelText(/Digite/), 'ROTACIONAR')
    await user.type(within(dialog).getByLabelText(/Motivo/), 'teste')
    expect(
      within(dialog).getByRole('button', { name: 'Rotacionar' }),
    ).toBeDisabled()
    expect(
      within(dialog).getByText('Informe de 0 a 1440 minutos.'),
    ).toBeInTheDocument()
  })

  it('suporte vê "Sem permissão" e o menu não tem Sistema nem Operadores', async () => {
    server.use(meHandler(viewer()))
    renderApp('/system')
    expect(await screen.findByText('Sem permissão')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /varredura/ })).toBeNull()
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(nav).queryByRole('link', { name: /Sistema/ })).toBeNull()
    expect(within(nav).queryByRole('link', { name: /Operadores/ })).toBeNull()
    expect(
      within(nav).getByRole('link', { name: /Auditoria/ }),
    ).toBeInTheDocument()
  })
})
