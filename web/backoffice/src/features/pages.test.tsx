import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, page, viewer } from '@/test/fixtures'
import { currentUrl, renderApp } from '@/test/render'
import { server } from '@/test/server'

const NOW = '2026-10-28T12:00:00.000Z'

const GPTMAKER: Schemas['App'] = {
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

const appsHandler = http.get('*/admin/apps', () =>
  HttpResponse.json({ items: [GPTMAKER] }),
)

function installation(
  overrides: Partial<Schemas['AdminInstallationPage']['items'][number]> = {},
) {
  return {
    id: 1234,
    appCode: 'crmthink.gptmaker',
    domain: 'acme.bitrix24.com.br',
    memberId: 'member-acme',
    status: 'ACTIVE' as const,
    installedAt: NOW,
    activatedAt: NOW,
    uninstalledAt: null,
    trialUsed: true,
    tokenHealth: 'ok' as const,
    ...overrides,
  }
}

function detail(
  overrides: Partial<Schemas['AdminInstallation']> = {},
): Schemas['AdminInstallation'] {
  return {
    ...installation(),
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
    events: { pending: 0, delivered: 3, dead: 1 },
    subscription: { available: true, current: null },
    ...overrides,
  }
}

const TIMELINE: Schemas['InstallationTimeline']['items'] = [
  {
    kind: 'admin_action',
    occurredAt: '2026-10-28T11:00:00.000Z',
    summary: 'POST /admin/installations/:id/trial por operator:1',
    ref: { type: 'admin_audit_log', id: '9' },
    data: { actor: 'operator:1', statusCode: 201, errorCode: null },
  },
  {
    kind: 'event',
    occurredAt: '2026-10-28T10:00:00.000Z',
    summary: 'subscription.renewed (dead)',
    ref: { type: 'outbox_event', id: 'ev-1' },
    data: {
      status: 'dead',
      deliveries: [
        { attempt: 2, statusCode: null, error: 'timeout', createdAt: NOW },
        { attempt: 1, statusCode: 500, error: 'HTTP 500', createdAt: NOW },
      ],
    },
  },
  {
    kind: 'install_attempt',
    occurredAt: '2026-10-27T10:00:00.000Z',
    summary: 'Instalação: installer → ok',
    ref: { type: 'install_attempt', id: '1' },
    data: { step: 'installer', status: 'ok', error: null },
  },
]

function detailHandlers(overrides: Partial<Schemas['AdminInstallation']> = {}) {
  return [
    http.get('*/admin/installations/1234', () =>
      HttpResponse.json(detail(overrides)),
    ),
    http.get('*/admin/installations/1234/timeline', ({ request }) => {
      const kind = new URL(request.url).searchParams.get('kind')
      return HttpResponse.json(
        page(kind ? TIMELINE.filter(item => item.kind === kind) : TIMELINE),
      )
    }),
  ]
}

describe('painel', () => {
  it('do contador para a lista de eventos filtrada', async () => {
    server.use(
      meHandler(operator()),
      appsHandler,
      http.get('*/admin/overview', () =>
        HttpResponse.json({
          computedAt: NOW,
          installations: [
            { appCode: 'crmthink.gptmaker', status: 'ACTIVE', count: 40 },
          ],
          events: {
            byApp: [{ appCode: 'crmthink.gptmaker', pending: 2, dead: 12 }],
            oldestPendingAt: NOW,
          },
          stripeEvents: { failed: 1, dead: 0 },
          credentialsRefreshFailing: 3,
          trialsEndingSoon: { count: 0, items: [] },
          sweeps: [],
        } satisfies Schemas['Overview']),
      ),
      http.get('*/admin/events', () => HttpResponse.json(page([]))),
    )
    const { router, user } = renderApp('/')
    await user.click(await screen.findByText('12 eventos mortos'))
    await waitFor(() =>
      expect(currentUrl(router)).toBe(
        '/events?appCode=crmthink.gptmaker&status=dead',
      ),
    )
  })
})

describe('instalações', () => {
  it('suporte busca, abre a instalação e vê a linha do tempo em ordem', async () => {
    const searches: string[] = []
    server.use(
      meHandler(viewer()),
      appsHandler,
      http.get('*/admin/installations', ({ request }) => {
        searches.push(new URL(request.url).search)
        return HttpResponse.json(page([installation()]))
      }),
      ...detailHandlers(),
    )
    const { router, user } = renderApp('/installations')
    await user.type(await screen.findByLabelText('Buscar'), 'acme{Enter}')
    await waitFor(() =>
      expect(currentUrl(router)).toBe('/installations?q=acme'),
    )
    expect(searches).toContain('?q=acme')

    await user.click(await screen.findByText('acme.bitrix24.com.br'))
    const timeline = await screen.findByRole('list', { name: 'Linha do tempo' })
    const entries = within(timeline).getAllByRole('listitem', { name: '' })
    expect(entries[0]).toHaveTextContent('POST /admin/installations/:id/trial')
    expect(timeline).toHaveTextContent(
      /subscription\.renewed[\s\S]*Instalação: installer/,
    )

    const deliveries = within(timeline).getByRole('list', {
      name: 'Tentativas de entrega',
    })
    expect(deliveries).toHaveTextContent('#2HTTP —timeout')
    expect(deliveries).toHaveTextContent('#1HTTP 500HTTP 500')
  })

  it('assinatura indisponível não esconde o resto', async () => {
    server.use(
      meHandler(viewer()),
      ...detailHandlers({
        subscription: {
          available: false,
          reason: 'tempo esgotado lendo o portal',
        },
      }),
    )
    renderApp('/installations/1234')
    expect(
      await screen.findByText('Assinatura indisponível no momento'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('tempo esgotado lendo o portal'),
    ).toBeInTheDocument()
    expect(screen.getByText('acme.bitrix24.com.br')).toBeInTheDocument()
  })

  it('filtro de tipo na linha do tempo vai para a URL', async () => {
    server.use(meHandler(viewer()), ...detailHandlers())
    const { router, user } = renderApp('/installations/1234')
    await screen.findByRole('list', { name: 'Linha do tempo' })
    await user.selectOptions(screen.getByLabelText('Tipo'), 'admin_action')
    await waitFor(() =>
      expect(currentUrl(router)).toBe('/installations/1234?kind=admin_action'),
    )
    const timeline = await screen.findByRole('list', { name: 'Linha do tempo' })
    await waitFor(() =>
      expect(
        within(timeline).getAllByRole('listitem', { name: '' }),
      ).toHaveLength(1),
    )
  })

  it('erro na linha do tempo fica na aba; resumo continua visível', async () => {
    server.use(
      meHandler(viewer()),
      http.get('*/admin/installations/1234', () => HttpResponse.json(detail())),
      http.get('*/admin/installations/1234/timeline', () =>
        apiError(500, 'INTERNAL_ERROR', 'Erro interno'),
      ),
    )
    renderApp('/installations/1234')
    expect(await screen.findByText('Tentar novamente')).toBeInTheDocument()
    expect(screen.getByText('INTERNAL_ERROR')).toBeInTheDocument()
    expect(screen.getByText('Resumo')).toBeInTheDocument()
  })
})

describe('eventos Stripe', () => {
  const stripeList = http.get('*/admin/stripe-events', () =>
    HttpResponse.json(
      page([
        {
          eventId: 'evt_123',
          type: 'invoice.paid',
          appCode: 'crmthink.gptmaker',
          status: 'failed',
          attempts: 2,
          error: 'SPA indisponível',
          receivedAt: NOW,
          processedAt: null,
        },
      ]),
    ),
  )

  it('suporte vê status, tentativas e erro, sem payload (nem pede o detalhe)', async () => {
    server.use(meHandler(viewer()), appsHandler, stripeList)
    const { user } = renderApp('/stripe-events')
    await user.click(
      await screen.findByRole('button', { name: 'invoice.paid' }),
    )
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('SPA indisponível')
    expect(sheet).not.toHaveTextContent('Payload')
  })

  it('operator vê o payload', async () => {
    server.use(
      meHandler(operator()),
      appsHandler,
      stripeList,
      http.get('*/admin/stripe-events/evt_123', () =>
        HttpResponse.json({
          eventId: 'evt_123',
          type: 'invoice.paid',
          appCode: 'crmthink.gptmaker',
          status: 'failed',
          attempts: 2,
          error: null,
          receivedAt: NOW,
          processedAt: null,
          payload: { id: 'evt_123', object: 'event' },
        }),
      ),
    )
    const { user } = renderApp('/stripe-events')
    await user.click(
      await screen.findByRole('button', { name: 'invoice.paid' }),
    )
    const sheet = await screen.findByRole('dialog')
    expect(
      await within(sheet).findByText(/"object": "event"/),
    ).toBeInTheDocument()
  })
})

describe('apps e auditoria', () => {
  it('do registro de auditoria para a instalação', async () => {
    server.use(
      meHandler(viewer()),
      http.get('*/admin/audit', () =>
        HttpResponse.json(
          page([
            {
              id: 9,
              actor: 'operator:1',
              actorRole: 'operator',
              action: 'POST /admin/installations/:id/trial',
              targetType: 'installation',
              targetId: '1234',
              statusCode: 201,
              errorCode: null,
              summary: null,
              ip: '10.0.0.1',
              userAgent: null,
              requestId: null,
              createdAt: NOW,
            },
          ]),
        ),
      ),
      ...detailHandlers(),
    )
    const { router, user } = renderApp('/audit')
    await user.click(await screen.findByText('installation:1234'))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/installations/1234'),
    )
  })

  it('detalhe do app não mostra chave nem segredo', async () => {
    server.use(
      meHandler(operator()),
      http.get('*/admin/apps/crmthink.gptmaker', () =>
        HttpResponse.json(GPTMAKER),
      ),
    )
    renderApp('/apps/crmthink.gptmaker')
    expect(await screen.findByText('local.gptmaker')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(
      /apiKey|webhookSecret|clientSecret|whsec_|cp_/i,
    )
  })

  it('403 na lista aparece como sem permissão', async () => {
    server.use(
      meHandler(viewer()),
      http.get('*/admin/audit', () => apiError(403, 'FORBIDDEN_ROLE')),
    )
    renderApp('/audit')
    expect(await screen.findByText('Sem permissão')).toBeInTheDocument()
  })
})
