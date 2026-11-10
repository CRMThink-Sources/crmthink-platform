import { screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { meHandler, operator } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

const plan = (
  overrides: Partial<Schemas['CatalogPlan']> = {},
): Schemas['CatalogPlan'] => ({
  id: 501,
  productId: 100,
  name: 'Plano Mensal',
  amount: 19900,
  interval: 'monthly',
  isTrial: false,
  active: true,
  priceHomolog: 'price_h',
  priceProduction: 'price_p',
  valid: true,
  problems: [],
  ...overrides,
})

const product = (
  overrides: Partial<Schemas['CatalogProduct']> = {},
): Schemas['CatalogProduct'] => ({
  id: 100,
  name: 'GPTMaker',
  billingModel: '13605',
  billingModelKey: 'standard',
  kind: 'subscription',
  active: true,
  valid: true,
  problems: [],
  apps: [],
  plans: [plan()],
  ...overrides,
})

function open(
  products = [product()],
  orphanPlans: Schemas['CatalogPlan'][] = [],
) {
  server.use(
    meHandler(operator()),
    http.get('*/admin/catalog/products', () =>
      HttpResponse.json({ writable: true, products, orphanPlans }),
    ),
  )
  return renderApp('/catalog')
}

type Captured = { body: unknown; reason: string | null; called: boolean }

function capture(
  method: 'patch' | 'delete',
  path: string,
  reply: () => Response = () => new HttpResponse(null, { status: 204 }),
) {
  const seen: Captured = { body: undefined, reason: null, called: false }
  server.use(
    http[method](path, async ({ request }) => {
      seen.called = true
      seen.body = method === 'patch' ? await request.json() : undefined
      seen.reason = request.headers.get('X-Admin-Reason')
      return reply()
    }),
  )
  return seen
}

const usage = (path: string, body: Record<string, unknown>) =>
  server.use(http.get(path, () => HttpResponse.json(body)))

const NONE = { subscriptions: { total: 0, active: 0 }, trialOfApps: [] }

describe('excluir e desativar', () => {
  it('plano em uso mostra assinaturas e app do trial e só oferece Desativar', async () => {
    const { user } = open()
    usage('*/admin/catalog/plans/501/usage', {
      subscriptions: { total: 12, active: 4 },
      trialOfApps: ['crmthink.gptmaker'],
    })

    await user.click(
      await screen.findByRole('button', { name: 'Excluir plano Plano Mensal' }),
    )
    expect(await screen.findByText(/12 assinaturas \(4 ativas\)/)).toBeVisible()
    expect(
      screen.getByText(/plano de trial de crmthink.gptmaker/),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
  })

  it('produto com planos mostra "tem N planos: exclua-os primeiro"', async () => {
    const { user } = open()
    usage('*/admin/catalog/products/100/usage', {
      apps: ['crmthink.gptmaker'],
      plans: 3,
    })

    await user.click(
      await screen.findByRole('button', { name: 'Excluir produto GPTMaker' }),
    )
    expect(
      await screen.findByText(/tem 3 planos: exclua-os primeiro/),
    ).toBeVisible()
    expect(screen.getByText(/apps vinculados: crmthink.gptmaker/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
  })

  it('sem uso exige o nome e o motivo e envia DELETE com o cabeçalho', async () => {
    const { user } = open()
    usage('*/admin/catalog/plans/501/usage', NONE)
    const seen = capture('delete', '*/admin/catalog/plans/501')

    await user.click(
      await screen.findByRole('button', { name: 'Excluir plano Plano Mensal' }),
    )
    const confirm = await screen.findByRole('button', { name: 'Excluir' })
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText(/Digite/), 'Plano Mensal')
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('Motivo'), 'Duplicado')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(seen.reason).toBe('Duplicado'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Desativar envia PATCH active:false com o motivo', async () => {
    const { user } = open()
    const seen = capture('patch', '*/admin/catalog/plans/501', () =>
      HttpResponse.json(plan({ active: false })),
    )

    await user.click(
      await screen.findByRole('button', {
        name: 'Desativar plano Plano Mensal',
      }),
    )
    const confirm = screen.getByRole('button', { name: 'Desativar' })
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('Motivo'), 'Descontinuado')
    await user.click(confirm)

    await waitFor(() => expect(seen.body).toEqual({ active: false }))
    expect(seen.reason).toBe('Descontinuado')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('409 no DELETE reabre o aviso de uso', async () => {
    const { user } = open()
    usage('*/admin/catalog/plans/501/usage', NONE)
    server.use(
      http.delete('*/admin/catalog/plans/501', () =>
        HttpResponse.json(
          {
            error: {
              code: 'PLAN_IN_USE',
              message: 'Plano em uso',
              details: {
                subscriptions: { total: 2, active: 1 },
                trialOfApps: [],
              },
            },
          },
          { status: 409 },
        ),
      ),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Excluir plano Plano Mensal' }),
    )
    await user.type(await screen.findByLabelText(/Digite/), 'Plano Mensal')
    await user.type(screen.getByLabelText('Motivo'), 'Duplicado')
    await user.click(screen.getByRole('button', { name: 'Excluir' }))

    expect(await screen.findByText(/2 assinaturas \(1 ativa\)/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeDisabled()
  })

  it('usage com tipos inesperados é tratado como sem uso', async () => {
    const { user } = open()
    usage('*/admin/catalog/plans/501/usage', {
      subscriptions: 'x',
      trialOfApps: 7,
    })
    await user.click(
      await screen.findByRole('button', { name: 'Excluir plano Plano Mensal' }),
    )
    expect(await screen.findByLabelText(/Digite/)).toBeVisible()
  })

  it('plano órfão também tem Excluir e Desativar', async () => {
    open([], [plan({ id: 900, name: 'Órfão', productId: 999 })])
    expect(
      await screen.findByRole('button', { name: 'Excluir plano Órfão' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Desativar plano Órfão' }),
    ).toBeVisible()
  })

  it('falha ao consultar o uso não oferece excluir nem pede confirmação', async () => {
    const { user } = open()
    const seen = capture('delete', '*/admin/catalog/plans/501')
    server.use(
      http.get('*/admin/catalog/plans/501/usage', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Falhou' } },
          { status: 500 },
        ),
      ),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Excluir plano Plano Mensal' }),
    )
    expect(
      await screen.findByText(/Não foi possível verificar o uso/),
    ).toBeVisible()
    expect(screen.getByText(/INTERNAL_ERROR/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(screen.queryByLabelText(/Digite/)).toBeNull()
    expect(seen.called).toBe(false)
  })

  it('enquanto o uso carrega mostra Verificando sem Excluir nem Desativar', async () => {
    const { user } = open()
    server.use(
      http.get('*/admin/catalog/plans/501/usage', async () => {
        await delay('infinite')
        return HttpResponse.json(NONE)
      }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Excluir plano Plano Mensal' }),
    )
    expect(await screen.findByText(/Verificando/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull()
    expect(screen.queryByLabelText(/Digite/)).toBeNull()
  })
})
