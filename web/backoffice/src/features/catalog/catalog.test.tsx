import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { apiError, meHandler, operator, viewer } from '@/test/fixtures'
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
  apps: ['crmthink.gptmaker', 'crmthink.other'],
  plans: [plan()],
  ...overrides,
})

function open(
  view: Partial<Schemas['CatalogView']> = {},
  who = operator(),
  route = '/catalog',
) {
  server.use(
    meHandler(who),
    http.get('*/admin/catalog/products', () =>
      HttpResponse.json({
        writable: true,
        products: [product()],
        orphanPlans: [],
        ...view,
      }),
    ),
  )
  return renderApp(route)
}

describe('tela Catálogo', () => {
  it('lista o produto com o plano logo abaixo', async () => {
    open()

    const link = await screen.findByText('GPTMaker')
    expect(link).toHaveClass('font-medium')
    expect(screen.getByText('#100')).toBeInTheDocument()
    expect(screen.getByText('Padrão')).toBeInTheDocument()
    expect(screen.getByText('usado por 2 apps')).toBeInTheDocument()
    expect(screen.getByText('Plano Mensal')).toBeInTheDocument()
    expect(screen.getByText('#501')).toBeInTheDocument()
    expect(screen.getByText('R$ 199,00')).toBeInTheDocument()
    expect(screen.getByText('Stripe: homolog ok · produção ok')).toBeVisible()
  })

  it('plano pago sem preço de produção mostra o aviso', async () => {
    open({ products: [product({ plans: [plan({ priceProduction: null })] })] })

    expect(
      await screen.findByText('Stripe: homolog ok · produção faltando'),
    ).toBeInTheDocument()
  })

  it('plano de trial mostra o selo Trial e não cobra preço do Stripe', async () => {
    open({
      products: [
        product({
          plans: [
            plan({
              isTrial: true,
              amount: 0,
              priceHomolog: null,
              priceProduction: null,
            }),
          ],
        }),
      ],
    })

    expect(await screen.findByText('Trial')).toBeInTheDocument()
    expect(screen.queryByText(/faltando/)).not.toBeInTheDocument()
  })

  it('item inválido mostra o problema sem quebrar a tabela', async () => {
    open({
      products: [
        product({
          valid: false,
          problems: ['Modelo de cobrança desconhecido'],
          billingModelKey: null,
          plans: [
            plan({ valid: false, problems: ['Plano sem valor definido'] }),
          ],
        }),
      ],
    })

    expect(
      await screen.findByText('Modelo de cobrança desconhecido'),
    ).toBeInTheDocument()
    expect(screen.getByText('Plano sem valor definido')).toBeInTheDocument()
    expect(screen.getByText('Plano Mensal')).toBeInTheDocument()
  })

  it('planos órfãos aparecem numa seção própria', async () => {
    open({
      orphanPlans: [
        plan({
          id: 900,
          productId: 999,
          name: 'Plano solto',
          valid: false,
          problems: ['Produto 999 não existe'],
        }),
      ],
    })

    const heading = await screen.findByText(
      'Planos com problema (produto inexistente)',
    )
    const section = heading.closest('section') as HTMLElement
    expect(within(section).getByText('Plano solto')).toBeInTheDocument()
    expect(within(section).getByText('#900')).toBeInTheDocument()
    expect(within(section).getByText('Produto 999 não existe')).toBeVisible()
  })

  it('sem planos órfãos a seção não aparece', async () => {
    open()
    await screen.findByText('GPTMaker')
    expect(
      screen.queryByText('Planos com problema (produto inexistente)'),
    ).not.toBeInTheDocument()
  })

  it('operator em produção vê os botões de ação', async () => {
    open()
    expect(
      await screen.findByRole('button', { name: 'Novo produto' }),
    ).toBeInTheDocument()
  })

  it('writable:false mostra o aviso e nenhum botão de ação', async () => {
    open({ writable: false })

    expect(
      await screen.findByText(/Somente leitura fora da produção/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo produto' })).toBeNull()
  })

  it('viewer não vê botões', async () => {
    open({}, viewer())

    await screen.findByText('GPTMaker')
    expect(screen.queryByRole('button', { name: 'Novo produto' })).toBeNull()
  })

  it('estado vazio', async () => {
    open({ products: [] })
    expect(await screen.findByText('Nenhum produto cadastrado.')).toBeVisible()
  })

  it('erro da API', async () => {
    server.use(
      meHandler(operator()),
      http.get('*/admin/catalog/products', () =>
        apiError(500, 'INTERNAL_ERROR'),
      ),
    )
    renderApp('/catalog')

    expect(
      await screen.findByRole('button', { name: /tentar/i }),
    ).toBeInTheDocument()
  })
})
