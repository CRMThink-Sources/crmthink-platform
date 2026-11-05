import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, page, viewer } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

const GPTMAKER: Schemas['App'] = {
  appCode: 'crmthink.gptmaker',
  name: 'GPTMaker',
  logoUrl: null,
  installTheme: null,
  bitrixClientId: 'local.gptmaker',
  bitrixAppCode: null,
  scopes: [],
  installerUrl: null,
  webhookUrl: null,
  trialDays: 0,
  trialOnInstall: false,
  trialPlanId: null,
  productSpaIds: [],
  active: true,
}

const DEAD: Schemas['OutboxEventList']['items'][number] = {
  eventId: 'ev-dead-1',
  seq: 1,
  appCode: 'crmthink.gptmaker',
  type: 'subscription.renewed',
  installationId: 1234,
  status: 'dead',
  attempts: 9,
  payload: {},
  deliveries: [],
  createdAt: '2026-10-28T10:00:00.000Z',
}

const appsHandler = http.get('*/admin/apps', () =>
  HttpResponse.json({ items: [GPTMAKER] }),
)

function listHandler() {
  const calls = { count: 0 }
  return {
    calls,
    handler: http.get('*/admin/events', () => {
      calls.count++
      return HttpResponse.json(page([DEAD]))
    }),
  }
}

const URL_DEAD = '/events?appCode=crmthink.gptmaker&status=dead'

describe('ações em eventos', () => {
  it('reenvio dos dead de um app: prévia, REENVIAR <n>, motivo e lista atualizada', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let reason: string | null = null
    const list = listHandler()
    server.use(
      meHandler(operator()),
      appsHandler,
      list.handler,
      http.post('*/admin/events/resend', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        if (body.dryRun)
          return HttpResponse.json({ matched: 37, sample: ['a', 'b'] })
        reason = request.headers.get('X-Admin-Reason')
        return HttpResponse.json({ requeued: 37 })
      }),
    )
    const { user } = renderApp(URL_DEAD)
    await screen.findByText('subscription.renewed')
    const before = list.calls.count
    await user.click(
      screen.getByRole('button', { name: 'Reenviar todos do filtro' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/37 eventos serão reenviados/),
    ).toBeInTheDocument()
    expect(bodies[0]).toMatchObject({
      appCode: 'crmthink.gptmaker',
      onlyDead: true,
      dryRun: true,
    })
    const confirm = within(dialog).getByRole('button', { name: 'Reenviar' })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Digite/), 'REENVIAR 37')
    await user.type(within(dialog).getByLabelText(/Motivo/), 'app corrigido')
    await user.click(confirm)

    expect(await screen.findByText('37 eventos reenviados')).toBeInTheDocument()
    expect(reason).toBe('app corrigido')
    expect(bodies[1]).not.toHaveProperty('dryRun')
    await waitFor(() => expect(list.calls.count).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('o botão em lote exige status morto e um app no filtro', async () => {
    server.use(meHandler(operator()), appsHandler, listHandler().handler)
    renderApp('/events')
    await screen.findByText('subscription.renewed')
    expect(
      screen.getByRole('button', { name: 'Reenviar todos do filtro' }),
    ).toBeDisabled()
  })

  it('acima de 5000: a interface mostra o limite e não deixa confirmar', async () => {
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler().handler,
      http.post('*/admin/events/resend', () =>
        HttpResponse.json({ matched: 5001, sample: ['a'] }),
      ),
    )
    const { user } = renderApp(URL_DEAD)
    await user.click(
      await screen.findByRole('button', { name: 'Reenviar todos do filtro' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/Acima do limite de 5000/),
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Reduza o período/)
    expect(dialog).toHaveTextContent(/Nada será reenviado/)
    expect(dialog).not.toHaveTextContent(/serão reenviados ao app/)
    expect(
      within(dialog).getByRole('button', { name: 'Reenviar' }),
    ).toBeDisabled()
  })

  it('RESEND_TOO_LARGE vindo da API: mostra o limite e mantém o diálogo aberto', async () => {
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler().handler,
      http.post('*/admin/events/resend', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return body.dryRun
          ? HttpResponse.json({ matched: 4999, sample: ['a'] })
          : apiError(422, 'RESEND_TOO_LARGE', 'O filtro encontrou 5003 eventos')
      }),
    )
    const { user } = renderApp(URL_DEAD)
    await user.click(
      await screen.findByRole('button', { name: 'Reenviar todos do filtro' }),
    )
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/4999 eventos serão reenviados/)
    await user.type(within(dialog).getByLabelText(/Digite/), 'REENVIAR 4999')
    await user.type(within(dialog).getByLabelText(/Motivo/), 'lote grande')
    await user.click(within(dialog).getByRole('button', { name: 'Reenviar' }))

    expect(
      await within(dialog).findByText('RESEND_TOO_LARGE'),
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Reduza o período/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('"Reenviar este" aparece só para operator e reenvia pelo eventId', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      meHandler(operator()),
      appsHandler,
      listHandler().handler,
      http.post('*/admin/events/resend', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ requeued: 1 })
      }),
    )
    const { user } = renderApp('/events')
    await user.click(
      await screen.findByRole('button', { name: 'subscription.renewed' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Reenviar este' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Reenviar evento',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Reenviar' }))
    expect(await screen.findByText(/Evento reenviado/)).toBeInTheDocument()
    expect(body).toEqual({ eventId: 'ev-dead-1' })
  })

  it('suporte não vê os botões de reenvio', async () => {
    server.use(meHandler(viewer()), appsHandler, listHandler().handler)
    const { user } = renderApp(URL_DEAD)
    expect(
      screen.queryByRole('button', { name: 'Reenviar todos do filtro' }),
    ).toBeNull()
    await user.click(
      await screen.findByRole('button', { name: 'subscription.renewed' }),
    )
    await screen.findByText('Envelope entregue ao app')
    expect(screen.queryByRole('button', { name: 'Reenviar este' })).toBeNull()
  })
})
