import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, page, viewer } from '@/test/fixtures'
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
  tokenHealth: 'refresh_failing',
  app: { appCode: 'crmthink.gptmaker', name: 'GPTMaker', active: true },
  spaItemId: 77,
  contact: null,
  everActivated: true,
  pendingReinstall: false,
  updatedAt: NOW,
  token: {
    health: 'refresh_failing',
    expiresAt: NOW,
    refreshFailures: 3,
    lastRefreshError: 'recusado',
    clientEndpoint: null,
    updatedAt: NOW,
  },
  events: { pending: 0, delivered: 3, dead: 37 },
  subscription: { available: true, current: null },
}

const ADMIN_ACTION: Schemas['InstallationTimeline']['items'][number] = {
  kind: 'admin_action',
  occurredAt: '2026-10-28T12:05:00.000Z',
  summary: 'POST /admin/installations/:id/trial por operator:1',
  ref: { type: 'admin_audit_log', id: '9' },
  data: { actor: 'operator:1', statusCode: 201, errorCode: null },
}
const TRIAL_EVENT: Schemas['InstallationTimeline']['items'][number] = {
  kind: 'event',
  occurredAt: '2026-10-28T12:05:01.000Z',
  summary: 'subscription.trial_started (pending)',
  ref: { type: 'outbox_event', id: 'ev-9' },
  data: { status: 'pending', deliveries: [] },
}

function detailHandlers(
  timeline: () => Schemas['InstallationTimeline']['items'],
) {
  const calls = { timeline: 0 }
  return {
    calls,
    handlers: [
      http.get('*/admin/installations/1234', () => HttpResponse.json(DETAIL)),
      http.get('*/admin/installations/1234/timeline', () => {
        calls.timeline++
        return HttpResponse.json(page(timeline()))
      }),
    ],
  }
}

describe('ações na instalação', () => {
  it('suporte não vê ações', async () => {
    const { handlers } = detailHandlers(() => [])
    server.use(meHandler(viewer()), ...handlers)
    renderApp('/installations/1234')
    await screen.findByText('Token do Bitrix')
    expect(screen.queryByRole('button', { name: 'Conceder trial' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Renovar token' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Reenviar eventos/ }),
    ).toBeNull()
  })

  it('trial concedido: aviso com a data e a linha do tempo mostra a ação e o evento', async () => {
    let granted = false
    let reasonHeader: string | null | undefined
    const { handlers, calls } = detailHandlers(() =>
      granted ? [TRIAL_EVENT, ADMIN_ACTION] : [],
    )
    server.use(
      meHandler(operator()),
      ...handlers,
      http.post('*/admin/installations/1234/trial', ({ request }) => {
        granted = true
        reasonHeader = request.headers.get('X-Admin-Reason')
        return HttpResponse.json(
          { subscriptionId: 5, trialEndsAt: '2026-11-11T12:00:00.000Z' },
          { status: 201 },
        )
      }),
    )
    const { user } = renderApp('/installations/1234')
    await user.click(
      await screen.findByRole('button', { name: 'Conceder trial' }),
    )
    // Sem motivo: nesta ação ele é opcional.
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Conceder trial' }),
    )

    expect(
      await screen.findByText(/Trial concedido até 11\/11\/2026/),
    ).toBeInTheDocument()
    expect(reasonHeader).toBeNull()
    const timeline = await screen.findByRole('list', { name: 'Linha do tempo' })
    await waitFor(() =>
      expect(timeline).toHaveTextContent('subscription.trial_started'),
    )
    expect(timeline).toHaveTextContent('POST /admin/installations/:id/trial')
    expect(calls.timeline).toBeGreaterThanOrEqual(2)
  })

  it('renovar token recusado pelo Bitrix: o diálogo fica aberto com o código e o motivo', async () => {
    const { handlers } = detailHandlers(() => [])
    server.use(
      meHandler(operator()),
      ...handlers,
      http.post('*/admin/installations/1234/token/refresh', () =>
        HttpResponse.json(
          {
            error: {
              code: 'TOKEN_REFRESH_FAILED',
              message: 'O Bitrix recusou a renovação do token',
              details: { reason: 'invalid_grant' },
            },
          },
          { status: 502 },
        ),
      ),
    )
    const { user } = renderApp('/installations/1234')
    await user.click(
      await screen.findByRole('button', { name: 'Renovar token' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Renovar token' }),
    )

    expect(
      await within(dialog).findByText('TOKEN_REFRESH_FAILED'),
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent('invalid_grant')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('reenviar os mortos da instalação: prévia, REENVIAR <n> e motivo', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let reason: string | null = null
    const { handlers } = detailHandlers(() => [])
    server.use(
      meHandler(operator()),
      ...handlers,
      http.post('*/admin/events/resend', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        if (body.dryRun) {
          return HttpResponse.json({ matched: 37, sample: ['ev-1', 'ev-2'] })
        }
        reason = request.headers.get('X-Admin-Reason')
        return HttpResponse.json({ requeued: 37 })
      }),
    )
    const { user } = renderApp('/installations/1234')
    await user.click(
      await screen.findByRole('button', {
        name: 'Reenviar eventos desta instalação',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/37 eventos serão reenviados/),
    ).toBeInTheDocument()
    expect(bodies[0]).toMatchObject({
      installationId: 1234,
      onlyDead: true,
      dryRun: true,
    })
    const confirm = within(dialog).getByRole('button', { name: 'Reenviar' })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Digite/), 'REENVIAR 37')
    await user.type(within(dialog).getByLabelText(/Motivo/), 'app voltou do ar')
    await user.click(confirm)

    expect(await screen.findByText('37 eventos reenviados')).toBeInTheDocument()
    expect(bodies[1]).toMatchObject({ installationId: 1234, onlyDead: true })
    expect(bodies[1]).not.toHaveProperty('dryRun')
    expect(reason).toBe('app voltou do ar')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('403 FORBIDDEN_ROLE da API aparece no diálogo (a interface é só conforto)', async () => {
    const { handlers } = detailHandlers(() => [])
    server.use(
      meHandler(operator()),
      ...handlers,
      http.post('*/admin/installations/1234/trial', () =>
        apiError(403, 'FORBIDDEN_ROLE', 'Papel sem permissão para esta ação'),
      ),
    )
    const { user } = renderApp('/installations/1234')
    await user.click(
      await screen.findByRole('button', { name: 'Conceder trial' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Conceder trial' }),
    )
    expect(
      await within(dialog).findByText('FORBIDDEN_ROLE'),
    ).toBeInTheDocument()
  })
})
