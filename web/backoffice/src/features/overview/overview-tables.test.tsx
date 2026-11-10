import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { meHandler, operator, page } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

const NOW = '2026-10-28T12:00:00.000Z'

describe('painel: tabelas dentro de cartões', () => {
  it('não desenham um segundo cartão dentro do cartão', async () => {
    server.use(
      meHandler(operator()),
      http.get('*/admin/apps', () => HttpResponse.json({ items: [] })),
      http.get('*/admin/events', () => HttpResponse.json(page([]))),
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
    )
    const { container } = renderApp('/')
    await screen.findByText('Eventos por app')

    const tables = container.querySelectorAll(
      '[data-slot="card"] [data-slot="table-container"]',
    )
    expect(tables).toHaveLength(2)
    for (const table of tables) expect(table).not.toHaveClass('border')
  })
})
