import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, viewer } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

type Endpoint = Schemas['WebhookEndpointList']['items'][number]
type Delivery = Schemas['WebhookDeliveryList']['items'][number]

const NOW = '2026-11-16T12:00:00.000Z'
const REASON = 'destinatario voltou do ar'

const ENDPOINT: Endpoint = {
  id: 1,
  name: 'ERP',
  url: 'https://erp.example.com/hooks',
  eventTypes: ['subscription.renewed'],
  appCodes: [],
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
  pendingDeliveries: 1,
  deadDeliveries: 12,
}

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  id: 10,
  eventId: 'ev-10',
  eventType: 'subscription.renewed',
  installationId: 7,
  appCode: 'crmthink.gptmaker',
  status: 'dead',
  attempts: 2,
  nextAttemptAt: NOW,
  deliveredAt: null,
  deadAt: NOW,
  createdAt: NOW,
  attemptLog: [
    {
      attempt: 2,
      statusCode: null,
      error: 'timeout',
      nextAttemptAt: null,
      deliveredAt: null,
      createdAt: NOW,
    },
    {
      attempt: 1,
      statusCode: 503,
      error: 'HTTP 503',
      nextAttemptAt: null,
      deliveredAt: null,
      createdAt: NOW,
    },
  ],
  ...overrides,
})

const endpointsHandler = (items: Endpoint[] = [ENDPOINT]) =>
  http.get('*/admin/webhook-endpoints', () => HttpResponse.json({ items }))

function deliveriesHandler(
  pages: Array<{ items: Delivery[]; nextCursor: string | null }>,
) {
  const queries: URLSearchParams[] = []
  return {
    queries,
    handler: http.get(
      '*/admin/webhook-endpoints/1/deliveries',
      ({ request }) => {
        const params = new URL(request.url).searchParams
        queries.push(params)
        const index = params.get('cursor') ? 1 : 0
        return HttpResponse.json(pages[index] ?? pages[0])
      },
    ),
  }
}

describe('detalhe do destinatário de eventos', () => {
  it('mostra o destinatário e as entregas com tipo, instalação, estado e tentativas', async () => {
    const { handler } = deliveriesHandler([
      { items: [delivery()], nextCursor: null },
    ])
    server.use(meHandler(viewer()), endpointsHandler(), handler)
    renderApp('/webhook-endpoints/1')

    expect(
      await screen.findByRole('heading', { name: 'ERP' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('https://erp.example.com/hooks'),
    ).toBeInTheDocument()
    const row = (await screen.findByText('subscription.renewed')).closest('tr')!
    expect(within(row).getByText('Morto')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '#7' })).toHaveAttribute(
      'href',
      '/installations/7',
    )
    expect(row).toHaveTextContent('#2')
    expect(row).toHaveTextContent('timeout')
    expect(row).toHaveTextContent('#1')
    expect(row).toHaveTextContent('HTTP 503')
  })

  it('o filtro de estado vive na URL e vai para a API; "Todos" o remove', async () => {
    const { handler, queries } = deliveriesHandler([
      { items: [delivery()], nextCursor: null },
    ])
    server.use(meHandler(viewer()), endpointsHandler(), handler)
    const { user } = renderApp('/webhook-endpoints/1?status=dead')
    await screen.findByText('subscription.renewed')
    expect(queries[0]!.get('status')).toBe('dead')
    expect(screen.getByLabelText('Estado')).toHaveValue('dead')

    await user.selectOptions(screen.getByLabelText('Estado'), '')
    await waitFor(() => expect(queries.at(-1)!.get('status')).toBeNull())
  })

  it('pagina com o cursor da API', async () => {
    const { handler, queries } = deliveriesHandler([
      { items: [delivery({ id: 10 })], nextCursor: 'proxima' },
      {
        items: [delivery({ id: 9, eventType: 'charge.refunded' })],
        nextCursor: null,
      },
    ])
    server.use(meHandler(viewer()), endpointsHandler(), handler)
    const { user } = renderApp('/webhook-endpoints/1')
    await screen.findByText('subscription.renewed')

    await user.click(screen.getByRole('button', { name: /Próxima/ }))

    expect(await screen.findByText('charge.refunded')).toBeInTheDocument()
    expect(queries.at(-1)!.get('cursor')).toBe('proxima')
  })

  it('suporte não vê reenviar', async () => {
    const { handler } = deliveriesHandler([
      { items: [delivery()], nextCursor: null },
    ])
    server.use(meHandler(viewer()), endpointsHandler(), handler)
    renderApp('/webhook-endpoints/1')
    await screen.findByText('subscription.renewed')
    expect(screen.queryByRole('button', { name: 'Reenviar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reenviar mortas' })).toBeNull()
  })

  it('reenviar uma entrega, sem motivo', async () => {
    let called: { id: string; reason: string | null } | null = null
    const { handler } = deliveriesHandler([
      { items: [delivery({ id: 10 })], nextCursor: null },
    ])
    server.use(
      meHandler(operator()),
      endpointsHandler(),
      handler,
      http.post(
        '*/admin/webhook-deliveries/:id/resend',
        ({ params, request }) => {
          called = {
            id: String(params.id),
            reason: request.headers.get('X-Admin-Reason'),
          }
          return HttpResponse.json({ id: 10, status: 'pending' })
        },
      ),
    )
    const { user } = renderApp('/webhook-endpoints/1')
    const row = (await screen.findByText('subscription.renewed')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Reenviar' }))

    expect(await screen.findByText('Entrega reenfileirada')).toBeInTheDocument()
    expect(called).toEqual({ id: '10', reason: null })
  })

  it('reenviar mortas: prévia da quantidade, motivo obrigatório e aviso do resultado', async () => {
    const bodies: unknown[] = []
    let reason: string | null = null
    const { handler } = deliveriesHandler([
      { items: [delivery()], nextCursor: null },
    ])
    server.use(
      meHandler(operator()),
      endpointsHandler(),
      handler,
      http.post(
        '*/admin/webhook-endpoints/1/resend-dead',
        async ({ request }) => {
          const body = (await request.json()) as { dryRun?: boolean }
          bodies.push(body)
          if (body.dryRun)
            return HttpResponse.json({ matched: 12, requeued: 0 })
          reason = request.headers.get('X-Admin-Reason')
          return HttpResponse.json({ matched: 12, requeued: 12 })
        },
      ),
    )
    const { user } = renderApp('/webhook-endpoints/1')
    await user.click(
      await screen.findByRole('button', { name: 'Reenviar mortas' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/12 entregas mortas serão reenviadas/),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Reenviar' })
    expect(confirm).toBeDisabled() // falta o motivo
    await user.type(within(dialog).getByLabelText('Motivo'), REASON)
    await user.click(confirm)

    expect(
      await screen.findByText('12 entregas reenviadas'),
    ).toBeInTheDocument()
    expect(bodies).toEqual([{ dryRun: true }, {}])
    expect(reason).toBe(REASON)
  })

  it('sem entregas mortas a prévia avisa e nada é reenviado', async () => {
    const { handler } = deliveriesHandler([{ items: [], nextCursor: null }])
    server.use(
      meHandler(operator()),
      endpointsHandler(),
      handler,
      http.post('*/admin/webhook-endpoints/1/resend-dead', () =>
        HttpResponse.json({ matched: 0, requeued: 0 }),
      ),
    )
    const { user } = renderApp('/webhook-endpoints/1')
    await user.click(
      await screen.findByRole('button', { name: 'Reenviar mortas' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText(/Nenhuma entrega morta/),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Reenviar' }),
    ).toBeDisabled()
  })

  it('erro da lista: mostra o código e "Tentar novamente"', async () => {
    server.use(
      meHandler(viewer()),
      endpointsHandler(),
      http.get('*/admin/webhook-endpoints/1/deliveries', () =>
        apiError(500, 'INTERNAL_ERROR'),
      ),
    )
    renderApp('/webhook-endpoints/1')
    expect(await screen.findByText('INTERNAL_ERROR')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Tentar novamente/ }),
    ).toBeInTheDocument()
  })

  it('destinatário que não está na lista: avisa que não foi encontrado', async () => {
    const { handler } = deliveriesHandler([{ items: [], nextCursor: null }])
    server.use(meHandler(viewer()), endpointsHandler([]), handler)
    renderApp('/webhook-endpoints/1')
    expect(
      await screen.findByText('Destinatário não encontrado.'),
    ).toBeInTheDocument()
  })

  it('o nome na lista leva ao detalhe', async () => {
    server.use(meHandler(viewer()), endpointsHandler())
    renderApp('/webhook-endpoints')
    expect(await screen.findByRole('link', { name: 'ERP' })).toHaveAttribute(
      'href',
      '/webhook-endpoints/1',
    )
  })
})
