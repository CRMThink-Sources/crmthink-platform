import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import {
  apiError,
  catalogHandler,
  catalogProduct,
  meHandler,
  operator,
  page,
  viewer,
} from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

const NOW = '2026-10-28T12:00:00.000Z'

const DETAIL: Schemas['AdminInstallation'] = {
  id: 1234,
  appCode: 'crmthink.gptmaker',
  domain: 'acme.bitrix24.com.br',
  memberId: 'member-acme',
  status: 'ACTIVE',
  installedAt: '2026-10-01T12:00:00.000Z',
  activatedAt: NOW,
  uninstalledAt: null,
  trialUsed: false,
  tokenHealth: 'ok',
  app: { appCode: 'crmthink.gptmaker', name: 'GPTMaker', active: true },
  spaItemId: 77,
  contact: null,
  everActivated: true,
  pendingReinstall: false,
  updatedAt: NOW,
  token: {
    health: 'ok',
    expiresAt: NOW,
    refreshFailures: 0,
    lastRefreshError: null,
    clientEndpoint: null,
    updatedAt: NOW,
  },
  events: { pending: 0, delivered: 3, dead: 0 },
  subscription: { available: true, current: null },
}

const plan = (
  overrides: Partial<Schemas['CatalogPlan']>,
): Schemas['CatalogPlan'] => ({
  id: 501,
  productId: 10,
  name: 'Básico',
  amount: 9900,
  interval: 'monthly',
  isTrial: false,
  active: true,
  priceHomolog: 'price_basic',
  priceProduction: 'price_basic_live',
  valid: true,
  problems: [],
  ...overrides,
})

/** Produto 10 é do app da instalação (com planos bons e ruins); o 11 é de outro app. */
const CATALOG = catalogHandler([
  catalogProduct({
    id: 10,
    name: 'GPTMaker',
    apps: ['crmthink.gptmaker'],
    plans: [
      plan({ id: 501, name: 'Básico' }),
      plan({ id: 502, name: 'Pro', amount: 19900, interval: 'yearly' }),
      plan({ id: 500, name: 'Trial', isTrial: true, amount: 0 }),
      plan({ id: 503, name: 'Antigo', active: false }),
      plan({ id: 504, name: 'Pacote', interval: null }),
    ],
  }),
  catalogProduct({
    id: 11,
    name: 'Extrator',
    apps: ['crmthink.extrator'],
    plans: [plan({ id: 600, productId: 11, name: 'Outro app' })],
  }),
])

function handlers(status: Schemas['AdminInstallation']['status'] = 'ACTIVE') {
  const calls = { detail: 0 }
  return {
    calls,
    list: [
      CATALOG,
      http.get('*/admin/installations/1234', () => {
        calls.detail++
        return HttpResponse.json({ ...DETAIL, status })
      }),
      http.get('*/admin/installations/1234/timeline', () =>
        HttpResponse.json(page([])),
      ),
    ],
  }
}

const REASON = 'boleto trimestral combinado com o financeiro'

async function openDialog(user: ReturnType<typeof renderApp>['user']) {
  await user.click(
    await screen.findByRole('button', { name: 'Nova assinatura' }),
  )
  const dialog = await screen.findByRole('dialog')
  // Os planos vêm do catálogo: espera a lista chegar.
  await within(dialog).findByRole('option', { name: /Básico/ })
  return dialog
}

describe('Nova assinatura na instalação', () => {
  it('só operador vê o botão, e só em instalação ACTIVE', async () => {
    server.use(meHandler(viewer()), ...handlers().list)
    const first = renderApp('/installations/1234')
    await screen.findByText('Token do Bitrix')
    expect(screen.queryByRole('button', { name: 'Nova assinatura' })).toBeNull()
    first.unmount()

    server.use(meHandler(operator()), ...handlers('UNINSTALLED').list)
    renderApp('/installations/1234')
    await screen.findByText('Token do Bitrix')
    expect(screen.queryByRole('button', { name: 'Nova assinatura' })).toBeNull()
  })

  it('lista só planos ativos, pagos e de assinatura dos produtos do app', async () => {
    server.use(meHandler(operator()), ...handlers().list)
    const { user } = renderApp('/installations/1234')
    const dialog = await openDialog(user)

    const options = within(dialog)
      .getAllByRole('option')
      .map(option => option.textContent ?? '')
    expect(options.some(text => text.includes('Básico'))).toBe(true)
    expect(options.some(text => text.includes('Pro'))).toBe(true)
    for (const excluded of ['Trial', 'Antigo', 'Pacote', 'Outro app'])
      expect(options.some(text => text.includes(excluded))).toBe(false)
  })

  it('bonificação mostra e exige o responsável; cobrança manual não mostra', async () => {
    server.use(meHandler(operator()), ...handlers().list)
    const { user } = renderApp('/installations/1234')
    const dialog = await openDialog(user)

    expect(within(dialog).queryByLabelText(/Responsável/)).toBeNull()
    await user.click(within(dialog).getByLabelText('Bonificação'))
    expect(within(dialog).getByLabelText(/Responsável/)).toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText('Plano'), '501')
    fireEvent.change(within(dialog).getByLabelText('Fim'), {
      target: { value: '2027-09-01' },
    })
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    expect(
      within(dialog).getByRole('button', { name: 'Criar assinatura' }),
    ).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Responsável/), 'Maria')
    expect(
      within(dialog).getByRole('button', { name: 'Criar assinatura' }),
    ).toBeEnabled()
  })

  it('envia o POST com o corpo e o motivo, avisa o sucesso e atualiza a instalação', async () => {
    let received: {
      body: Schemas['CreateManualSubscription']
      reason: string | null
    } | null = null
    const { list, calls } = handlers()
    server.use(
      meHandler(operator()),
      ...list,
      http.post(
        '*/admin/installations/1234/subscriptions',
        async ({ request }) => {
          received = {
            body: (await request.json()) as Schemas['CreateManualSubscription'],
            reason: request.headers.get('X-Admin-Reason'),
          }
          return HttpResponse.json(
            {
              subscriptionId: 9,
              status: 'active',
              modality: 'manual',
              planId: 501,
              periodStart: '2026-10-28T00:00:00.000Z',
              periodEnd: '2027-09-01T23:59:59.999Z',
            } satisfies Schemas['ManualSubscriptionCreated'],
            { status: 201 },
          )
        },
      ),
    )
    const { user } = renderApp('/installations/1234')
    const dialog = await openDialog(user)
    expect(
      (within(dialog).getByLabelText('Início') as HTMLInputElement).value,
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const before = calls.detail

    await user.click(within(dialog).getByLabelText('Bonificação'))
    await user.selectOptions(within(dialog).getByLabelText('Plano'), '501')
    fireEvent.change(within(dialog).getByLabelText('Início'), {
      target: { value: '2026-10-28' },
    })
    fireEvent.change(within(dialog).getByLabelText('Fim'), {
      target: { value: '2027-09-01' },
    })
    await user.type(within(dialog).getByLabelText(/Responsável/), 'Maria')
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(
      within(dialog).getByRole('button', { name: 'Criar assinatura' }),
    )

    expect(await screen.findByText(/Assinatura criada/)).toBeInTheDocument()
    expect(received).toEqual({
      body: {
        planId: 501,
        kind: 'bonus',
        periodStart: '2026-10-28',
        periodEnd: '2027-09-01',
        approvedBy: 'Maria',
      },
      reason: REASON,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(calls.detail).toBeGreaterThan(before))
  })

  it('validação no cliente: fim obrigatório, depois do início e até 24 meses; não envia', async () => {
    let posts = 0
    server.use(
      meHandler(operator()),
      ...handlers().list,
      http.post('*/admin/installations/1234/subscriptions', () => {
        posts++
        return apiError(500, 'NAO_DEVERIA_CHAMAR')
      }),
    )
    const { user } = renderApp('/installations/1234')
    const dialog = await openDialog(user)
    const confirm = within(dialog).getByRole('button', {
      name: 'Criar assinatura',
    })
    await user.selectOptions(within(dialog).getByLabelText('Plano'), '501')
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    fireEvent.change(within(dialog).getByLabelText('Início'), {
      target: { value: '2026-10-28' },
    })
    expect(confirm).toBeDisabled() // sem fim

    fireEvent.change(within(dialog).getByLabelText('Fim'), {
      target: { value: '2026-10-28' },
    })
    expect(
      await within(dialog).findByText(/fim .* depois do início/i),
    ).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Fim'), {
      target: { value: '2028-10-29' },
    })
    expect(
      await within(dialog).findByText(/no máximo 24 meses/i),
    ).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Fim'), {
      target: { value: '2028-10-28' },
    })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(posts).toBe(0)
  })

  it('409 aparece no diálogo; INVALID_PERIOD vai junto ao campo Fim; o diálogo continua aberto', async () => {
    let code = 'SUBSCRIPTION_ALREADY_EXISTS'
    server.use(
      meHandler(operator()),
      ...handlers().list,
      http.post('*/admin/installations/1234/subscriptions', () =>
        code === 'INVALID_PERIOD'
          ? apiError(422, code, 'O período pode ter no máximo 24 meses')
          : apiError(409, code, 'A instalação já tem assinatura vigente'),
      ),
    )
    const { user } = renderApp('/installations/1234')
    const dialog = await openDialog(user)
    await user.selectOptions(within(dialog).getByLabelText('Plano'), '501')
    fireEvent.change(within(dialog).getByLabelText('Fim'), {
      target: { value: '2027-09-01' },
    })
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    const confirm = within(dialog).getByRole('button', {
      name: 'Criar assinatura',
    })

    await user.click(confirm)
    expect(
      await within(dialog).findByText('SUBSCRIPTION_ALREADY_EXISTS'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    code = 'INVALID_PERIOD'
    await user.click(confirm)
    const alert = await within(dialog).findByText(
      'O período pode ter no máximo 24 meses',
    )
    expect(alert).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
