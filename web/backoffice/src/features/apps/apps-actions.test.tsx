import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { meHandler, operator, viewer } from '@/test/fixtures'
import { currentUrl, renderApp } from '@/test/render'
import { server } from '@/test/server'

const APP: Schemas['App'] = {
  appCode: 'crmthink.gptmaker',
  name: 'GPTMaker',
  logoUrl: null,
  installTheme: null,
  bitrixClientId: 'local.gptmaker',
  bitrixAppCode: null,
  scopes: ['crm', 'imbot'],
  installerUrl: 'https://gptmaker.app/platform/installer',
  webhookUrl: 'https://gptmaker.app/platform/events',
  trialDays: 14,
  trialOnInstall: true,
  trialPlanId: 500,
  productSpaIds: [10, 11],
  active: true,
}

const NEW_API_KEY = 'cp_api_key_nova_123'
const NEW_WEBHOOK_SECRET = 'whsec_nova_456'

const getApp = (app: Schemas['App'] = APP) =>
  http.get(`*/admin/apps/${app.appCode}`, () => HttpResponse.json(app))

describe('cadastro de app', () => {
  async function fillRequired(user: ReturnType<typeof renderApp>['user']) {
    await user.type(await screen.findByLabelText('appCode'), 'crmthink.novo')
    await user.type(screen.getByLabelText('Nome'), 'Novo App')
    await user.type(screen.getByLabelText('client_id do Bitrix'), 'local.novo')
    await user.type(
      screen.getByLabelText('client_secret do Bitrix'),
      'segredo-bitrix',
    )
  }

  it('mostra chave e segredo uma vez e, depois de fechar, o detalhe não tem nenhum dos dois', async () => {
    let body: Record<string, unknown> | null = null
    const created: Schemas['App'] = {
      ...APP,
      appCode: 'crmthink.novo',
      name: 'Novo App',
      bitrixClientId: 'local.novo',
      scopes: ['crm'],
      trialDays: 0,
      trialOnInstall: false,
      trialPlanId: null,
      productSpaIds: [],
    }
    server.use(
      meHandler(operator()),
      http.post('*/admin/apps', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          {
            app: created,
            credentials: {
              apiKey: NEW_API_KEY,
              webhookSecret: NEW_WEBHOOK_SECRET,
            },
            notice: 'Guarde agora.',
          } satisfies Schemas['AppCreated'],
          { status: 201 },
        )
      }),
      getApp(created),
    )
    const { user, router } = renderApp('/apps/new')
    await fillRequired(user)
    await user.type(screen.getByLabelText('Escopos'), 'crm')
    await user.click(screen.getByRole('button', { name: 'Cadastrar app' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(NEW_API_KEY)).toBeInTheDocument()
    expect(within(dialog).getByText(NEW_WEBHOOK_SECRET)).toBeInTheDocument()
    expect(body).toMatchObject({
      appCode: 'crmthink.novo',
      name: 'Novo App',
      bitrixClientId: 'local.novo',
      bitrixClientSecret: 'segredo-bitrix',
      scopes: ['crm'],
      productSpaIds: [],
      trialDays: 0,
      trialOnInstall: false,
      active: true,
      installTheme: null,
    })

    await user.click(within(dialog).getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(currentUrl(router)).toBe('/apps/crmthink.novo'))
    await screen.findByText('Cadastro')
    expect(document.body).not.toHaveTextContent(NEW_API_KEY)
    expect(document.body).not.toHaveTextContent(NEW_WEBHOOK_SECRET)
  })

  it('erro da API no campo: VALIDATION_ERROR aparece abaixo do campo certo', async () => {
    server.use(
      meHandler(operator()),
      http.post('*/admin/apps', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Requisição inválida',
              details: [
                { path: 'webhookUrl', message: 'A URL de webhook é recusada' },
                {
                  path: 'installTheme.primaryColor',
                  message: 'Cor inválida',
                },
              ],
            },
          },
          { status: 400 },
        ),
      ),
    )
    const { user } = renderApp('/apps/new')
    await fillRequired(user)
    await user.type(
      screen.getByLabelText('URL de webhook'),
      'https://app.test/events',
    )
    await user.click(screen.getByRole('button', { name: 'Cadastrar app' }))

    const field = screen.getByLabelText('URL de webhook')
    expect(
      await screen.findByText('A URL de webhook é recusada'),
    ).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Cor inválida')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('valida no navegador: client_secret obrigatório e trial na instalação exige plano', async () => {
    let posted = false
    server.use(
      meHandler(operator()),
      http.post('*/admin/apps', () => {
        posted = true
        return HttpResponse.json({}, { status: 500 })
      }),
    )
    const { user } = renderApp('/apps/new')
    await user.type(await screen.findByLabelText('appCode'), 'crmthink.novo')
    await user.type(screen.getByLabelText('Nome'), 'Novo App')
    await user.type(screen.getByLabelText('client_id do Bitrix'), 'local.novo')
    await user.click(screen.getByLabelText('Iniciar trial na instalação'))
    await user.click(screen.getByRole('button', { name: 'Cadastrar app' }))

    expect(
      await screen.findByText('Informe o client_secret'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('O trial na instalação exige o plano de trial'),
    ).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('suporte não vê "Cadastrar app" na lista', async () => {
    server.use(
      meHandler(viewer()),
      http.get('*/admin/apps', () => HttpResponse.json({ items: [APP] })),
    )
    renderApp('/apps')
    await screen.findByText('GPTMaker')
    expect(screen.queryByRole('button', { name: 'Cadastrar app' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Cadastrar app' })).toBeNull()
  })
})

describe('edição de app', () => {
  it('envia só os campos alterados; o segredo do Bitrix vem vazio e só vai se digitado', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      meHandler(operator()),
      getApp(),
      http.patch('*/admin/apps/crmthink.gptmaker', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...APP, name: 'GPTMaker 2' })
      }),
    )
    const { user, router } = renderApp('/apps/crmthink.gptmaker/edit')
    const name = await screen.findByLabelText('Nome')
    expect(name).toHaveValue('GPTMaker')
    expect(screen.getByLabelText('client_secret do Bitrix')).toHaveValue('')
    expect(screen.getByLabelText('appCode')).toHaveAttribute('readonly')
    expect(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    ).toBeDisabled()

    await user.clear(name)
    await user.type(name, 'GPTMaker 2')
    expect(screen.getByText('O que vai mudar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(body).toEqual({ name: 'GPTMaker 2' }))
    await waitFor(() =>
      expect(currentUrl(router)).toBe('/apps/crmthink.gptmaker'),
    )
  })

  it('o client_secret só é enviado quando preenchido', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      meHandler(operator()),
      getApp(),
      http.patch('*/admin/apps/crmthink.gptmaker', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(APP)
      }),
    )
    const { user } = renderApp('/apps/crmthink.gptmaker/edit')
    await user.type(
      await screen.findByLabelText('client_secret do Bitrix'),
      'novo-segredo',
    )
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(body).toEqual({ bitrixClientSecret: 'novo-segredo' }),
    )
  })

  it('a pré-visualização do tema acompanha o formulário', async () => {
    server.use(meHandler(operator()), getApp())
    const { user } = renderApp('/apps/crmthink.gptmaker/edit')
    const preview = await screen.findByLabelText(
      'Pré-visualização da página de instalação',
    )
    expect(within(preview).getByRole('heading')).toHaveTextContent(
      'Instalação — GPTMaker',
    )
    await user.type(screen.getByLabelText('Título'), 'Instale o GPTMaker')
    await user.type(screen.getByLabelText('Cor do botão'), '#ff0000')
    expect(within(preview).getByRole('heading')).toHaveTextContent(
      'Instale o GPTMaker',
    )
    expect(preview.style.getPropertyValue('--primary')).toBe('#ff0000')
  })
})

describe('ações no detalhe do app', () => {
  it('rotação de chave de API: só libera digitando o appCode e o motivo, e mostra a chave nova uma vez', async () => {
    let reason: string | null = null
    server.use(
      meHandler(operator()),
      getApp(),
      http.post(
        '*/admin/apps/crmthink.gptmaker/rotate-api-key',
        ({ request }) => {
          reason = request.headers.get('X-Admin-Reason')
          return HttpResponse.json({
            apiKey: NEW_API_KEY,
            previousValidUntil: '2026-11-05T12:00:00.000Z',
          })
        },
      ),
    )
    const { user } = renderApp('/apps/crmthink.gptmaker')
    await user.click(
      await screen.findByRole('button', { name: 'Rotacionar chave' }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Rotacionar chave',
    })
    expect(confirm).toBeDisabled()

    await user.type(
      within(dialog).getByLabelText(/Digite/),
      'crmthink.gptmaker',
    )
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Motivo/), 'chave vazou')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(await screen.findByText(NEW_API_KEY)).toBeInTheDocument()
    // A validade da chave anterior é só informação: não ganha botão de copiar.
    expect(screen.getByText(/A chave anterior vale até/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Copiar/ })).toHaveLength(1)
    expect(reason).toBe('chave vazou')
    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(screen.queryByText(NEW_API_KEY)).toBeNull())
  })

  it('rotação do segredo de webhook mostra o segredo novo uma vez', async () => {
    server.use(
      meHandler(operator()),
      getApp(),
      http.post('*/admin/apps/crmthink.gptmaker/rotate-webhook-secret', () =>
        HttpResponse.json({
          webhookSecret: NEW_WEBHOOK_SECRET,
          previousValidUntil: '2026-11-05T12:00:00.000Z',
        }),
      ),
    )
    const { user } = renderApp('/apps/crmthink.gptmaker')
    await user.click(
      await screen.findByRole('button', { name: 'Rotacionar segredo' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText(/Digite/),
      'crmthink.gptmaker',
    )
    await user.type(
      within(dialog).getByLabelText(/Motivo/),
      'rotina trimestral',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Rotacionar segredo' }),
    )
    expect(await screen.findByText(NEW_WEBHOOK_SECRET)).toBeInTheDocument()
  })

  it('desativar exige o appCode e o motivo e envia active:false; ativar é direto', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let reason: string | null = null
    server.use(
      meHandler(operator()),
      getApp(),
      http.patch('*/admin/apps/crmthink.gptmaker', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        reason = request.headers.get('X-Admin-Reason')
        return HttpResponse.json({ ...APP, active: false })
      }),
    )
    const { user } = renderApp('/apps/crmthink.gptmaker')
    await user.click(await screen.findByRole('button', { name: 'Desativar' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Desativar' })
    expect(confirm).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText(/Digite/),
      'crmthink.gptmaker',
    )
    await user.type(
      within(dialog).getByLabelText(/Motivo/),
      'app em manutenção',
    )
    await user.click(confirm)
    await waitFor(() => expect(bodies).toEqual([{ active: false }]))
    expect(reason).toBe('app em manutenção')
  })

  it('suporte não vê nenhuma ação no detalhe do app', async () => {
    server.use(meHandler(viewer()), getApp())
    renderApp('/apps/crmthink.gptmaker')
    await screen.findByText('Cadastro')
    for (const name of [
      'Rotacionar chave',
      'Rotacionar segredo',
      'Desativar',
      'Ativar',
    ])
      expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull()
  })
})
