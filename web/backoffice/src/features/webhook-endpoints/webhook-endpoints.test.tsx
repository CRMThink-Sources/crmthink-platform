import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, viewer } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

type Endpoint = Schemas['WebhookEndpoint'] & {
  pendingDeliveries: number
  deadDeliveries: number
}

const SECRET = `whsec_${'s'.repeat(43)}`
const NEW_SECRET = `whsec_${'n'.repeat(43)}`
const REASON = 'integracao do erp combinada com o financeiro'
const NOW = '2026-11-16T12:00:00.000Z'

const endpoint = (overrides: Partial<Endpoint> = {}): Endpoint => ({
  id: 1,
  name: 'ERP',
  url: 'https://erp.example.com/hooks',
  eventTypes: ['subscription.renewed', 'subscription.past_due'],
  appCodes: [],
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
  pendingDeliveries: 2,
  deadDeliveries: 1,
  ...overrides,
})

const listHandler = (items: Endpoint[]) =>
  http.get('*/admin/webhook-endpoints', () => HttpResponse.json({ items }))

const appsHandler = http.get('*/admin/apps', () =>
  HttpResponse.json({
    items: [
      { appCode: 'crmthink.gptmaker', name: 'GPTMaker', active: true },
      { appCode: 'crmthink.thinkzap', name: 'ThinkZap', active: true },
    ],
  }),
)

const created = (item: Endpoint, secret: string) => ({
  endpoint: item,
  secret,
  notice: 'Guarde o segredo agora.',
})

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(
    await screen.findByRole('button', { name: `Ações de ${name}` }),
  )
}

describe('tela Destinatários de eventos', () => {
  it('lista nome, URL, tipos, apps, estado e contagens; o item do menu existe para qualquer papel', async () => {
    server.use(
      meHandler(viewer()),
      appsHandler,
      listHandler([
        endpoint(),
        endpoint({
          id: 2,
          name: 'Financeiro',
          active: false,
          appCodes: ['crmthink.gptmaker'],
          eventTypes: ['charge.refunded'],
          pendingDeliveries: 0,
          deadDeliveries: 0,
        }),
      ]),
    )
    renderApp('/webhook-endpoints')

    const row = (await screen.findByText('ERP')).closest('tr')!
    expect(
      within(row).getByText('https://erp.example.com/hooks'),
    ).toBeInTheDocument()
    expect(within(row).getByText('2 tipos')).toBeInTheDocument()
    expect(within(row).getByText('Todos os apps')).toBeInTheDocument()
    expect(within(row).getByText('Ativo')).toBeInTheDocument()
    const other = screen.getByText('Financeiro').closest('tr')!
    expect(within(other).getByText('1 tipo')).toBeInTheDocument()
    expect(within(other).getByText('crmthink.gptmaker')).toBeInTheDocument()
    expect(within(other).getByText('Desativado')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Destinatários de eventos/ }),
    ).toBeInTheDocument()
  })

  it('suporte só consulta: sem criar, editar, rotacionar nem desativar', async () => {
    server.use(meHandler(viewer()), appsHandler, listHandler([endpoint()]))
    renderApp('/webhook-endpoints')
    await screen.findByText('ERP')
    expect(
      screen.queryByRole('button', { name: 'Novo destinatário' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /Ações de/ })).toBeNull()
  })

  it('sem destinatários: estado vazio', async () => {
    server.use(meHandler(operator()), appsHandler, listHandler([]))
    renderApp('/webhook-endpoints')
    expect(
      await screen.findByText('Nenhum destinatário cadastrado.'),
    ).toBeInTheDocument()
  })

  it('criar: barra URL sem HTTPS no cliente, exige motivo, mostra o segredo uma vez e ele some ao fechar', async () => {
    let calls = 0
    let created_ = false
    let received: { body: unknown; reason: string | null } | null = null
    server.use(
      meHandler(operator()),
      appsHandler,
      http.get('*/admin/webhook-endpoints', () =>
        HttpResponse.json({ items: created_ ? [endpoint()] : [] }),
      ),
      http.post('*/admin/webhook-endpoints', async ({ request }) => {
        calls++
        created_ = true
        received = {
          body: await request.json(),
          reason: request.headers.get('X-Admin-Reason'),
        }
        return HttpResponse.json(created(endpoint(), SECRET), { status: 201 })
      }),
    )
    const { user } = renderApp('/webhook-endpoints')
    await user.click(
      await screen.findByRole('button', { name: 'Novo destinatário' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Criar destinatário',
    })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Nome'), 'ERP')
    await user.type(
      within(dialog).getByLabelText('URL'),
      'http://erp.example.com/hooks',
    )
    expect(
      await within(dialog).findByText(/A URL deve usar HTTPS/),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByLabelText('subscription.past_due'))
    await user.click(within(dialog).getByLabelText('subscription.renewed'))
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    expect(confirm).toBeDisabled() // URL ainda sem HTTPS
    expect(calls).toBe(0)

    const url = within(dialog).getByLabelText('URL')
    await user.clear(url)
    await user.type(url, 'https://erp.example.com/hooks')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(screen.getByText('Exibido uma única vez')).toBeInTheDocument()
    expect(received).toEqual({
      body: {
        name: 'ERP',
        url: 'https://erp.example.com/hooks',
        // Na ordem do catálogo de tipos, não na ordem dos cliques.
        eventTypes: ['subscription.renewed', 'subscription.past_due'],
        appCodes: [],
      },
      reason: REASON,
    })

    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(screen.queryByText(SECRET)).toBeNull())
    expect(await screen.findByText('ERP')).toBeInTheDocument()
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain(SECRET)
  })

  it('criar com apps marcados envia os appCodes; o formulário oferece os 18 tipos de evento', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler([]),
      http.post('*/admin/webhook-endpoints', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(created(endpoint(), SECRET), { status: 201 })
      }),
    )
    const { user } = renderApp('/webhook-endpoints')
    await user.click(
      await screen.findByRole('button', { name: 'Novo destinatário' }),
    )
    const dialog = await screen.findByRole('dialog')
    for (const group of ['Instalação', 'Assinatura', 'Compra e estorno'])
      expect(within(dialog).getByText(group)).toBeInTheDocument()
    expect(
      within(dialog).getAllByRole('checkbox').length,
    ).toBeGreaterThanOrEqual(18)
    for (const type of [
      'installation.created',
      'subscription.item_changed',
      'charge.disputed',
    ])
      expect(within(dialog).getByLabelText(type)).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Nome'), 'Só GPT')
    await user.type(
      within(dialog).getByLabelText('URL'),
      'https://erp.example.com/hooks',
    )
    await user.click(within(dialog).getByLabelText('purchase.paid'))
    await user.click(await within(dialog).findByLabelText('GPTMaker'))
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(
      within(dialog).getByRole('button', { name: 'Criar destinatário' }),
    )

    await screen.findByText(SECRET)
    expect(body).toMatchObject({
      eventTypes: ['purchase.paid'],
      appCodes: ['crmthink.gptmaker'],
    })
  })

  it('editar o nome envia só o nome, sem motivo', async () => {
    let received: { body: unknown; reason: string | null } | null = null
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler([endpoint()]),
      http.patch('*/admin/webhook-endpoints/1', async ({ request }) => {
        received = {
          body: await request.json(),
          reason: request.headers.get('X-Admin-Reason'),
        }
        return HttpResponse.json(endpoint({ name: 'ERP novo' }))
      }),
    )
    const { user } = renderApp('/webhook-endpoints')
    await openMenu(user, 'ERP')
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByLabelText('Nome')
    expect(name).toHaveValue('ERP')
    expect(within(dialog).getByLabelText('URL')).toHaveValue(
      'https://erp.example.com/hooks',
    )
    expect(within(dialog).getByLabelText('subscription.renewed')).toBeChecked()
    const save = within(dialog).getByRole('button', { name: 'Salvar' })
    expect(save).toBeDisabled() // nada mudou
    await user.clear(name)
    await user.type(name, 'ERP novo')
    await user.click(save)

    expect(
      await screen.findByText('Destinatário atualizado'),
    ).toBeInTheDocument()
    expect(received).toEqual({ body: { name: 'ERP novo' }, reason: null })
  })

  it('desativar exige o motivo; reativar não', async () => {
    const calls: Array<{ body: unknown; reason: string | null }> = []
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler([
        endpoint(),
        endpoint({ id: 2, name: 'Financeiro', active: false }),
      ]),
      http.patch('*/admin/webhook-endpoints/:id', async ({ request }) => {
        calls.push({
          body: await request.json(),
          reason: request.headers.get('X-Admin-Reason'),
        })
        return HttpResponse.json(endpoint())
      }),
    )
    const { user } = renderApp('/webhook-endpoints')

    await openMenu(user, 'ERP')
    await user.click(await screen.findByRole('menuitem', { name: 'Desativar' }))
    let dialog = await screen.findByRole('dialog')
    const off = within(dialog).getByRole('button', { name: 'Desativar' })
    expect(off).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(off)
    expect(
      await screen.findByText('Destinatário desativado'),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await openMenu(user, 'Financeiro')
    await user.click(await screen.findByRole('menuitem', { name: 'Reativar' }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reativar' }))
    expect(
      await screen.findByText('Destinatário reativado'),
    ).toBeInTheDocument()

    expect(calls).toEqual([
      { body: { active: false }, reason: REASON },
      { body: { active: true }, reason: null },
    ])
  })

  it('rotacionar exige o motivo e mostra o segredo novo uma vez', async () => {
    let reason: string | null = null
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler([endpoint()]),
      http.post('*/admin/webhook-endpoints/1/rotate-secret', ({ request }) => {
        reason = request.headers.get('X-Admin-Reason')
        return HttpResponse.json({
          endpoint: endpoint(),
          secret: NEW_SECRET,
          previousValidUntil: '2026-11-17T12:00:00.000Z',
          notice: 'Guarde o segredo agora.',
        })
      }),
    )
    const { user } = renderApp('/webhook-endpoints')
    await openMenu(user, 'ERP')
    await user.click(
      await screen.findByRole('menuitem', { name: 'Rotacionar segredo' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Rotacionar segredo',
    })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(confirm)

    expect(await screen.findByText(NEW_SECRET)).toBeInTheDocument()
    expect(reason).toBe(REASON)
    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(screen.queryByText(NEW_SECRET)).toBeNull())
  })

  it('erro da API aparece no diálogo, que continua aberto', async () => {
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler([endpoint()]),
      http.post('*/admin/webhook-endpoints/1/rotate-secret', () =>
        apiError(
          404,
          'WEBHOOK_ENDPOINT_NOT_FOUND',
          'Destinatário de eventos não encontrado',
        ),
      ),
    )
    const { user } = renderApp('/webhook-endpoints')
    await openMenu(user, 'ERP')
    await user.click(
      await screen.findByRole('menuitem', { name: 'Rotacionar segredo' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(
      within(dialog).getByRole('button', { name: 'Rotacionar segredo' }),
    )
    expect(
      await within(dialog).findByText('WEBHOOK_ENDPOINT_NOT_FOUND'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
