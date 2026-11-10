import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
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
  apps: ['crmthink.gptmaker'],
  plans: [plan()],
  ...overrides,
})

function open(products = [product()]) {
  server.use(
    meHandler(operator()),
    http.get('*/admin/catalog/products', () =>
      HttpResponse.json({ writable: true, products, orphanPlans: [] }),
    ),
  )
  return renderApp('/catalog')
}

type Captured = { body: unknown; reason: string | null }

/** Registra o corpo e o motivo da próxima chamada e responde com `reply`. */
function capture(
  method: 'post' | 'patch',
  path: string,
  reply: () => Response | Promise<Response> = () => HttpResponse.json(plan()),
) {
  const seen: Captured = { body: undefined, reason: null }
  server.use(
    http[method](path, async ({ request }) => {
      seen.body = await request.json()
      seen.reason = request.headers.get('X-Admin-Reason')
      return reply()
    }),
  )
  return seen
}

const dialog = () => screen.getByRole('dialog')
const save = () => screen.getByRole('button', { name: 'Salvar' })

describe('formulário de produto', () => {
  it('criar envia nome, modelo e ativo', async () => {
    const { user } = open()
    const seen = capture('post', '*/admin/catalog/products', () =>
      HttpResponse.json(product(), { status: 201 }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Novo produto' }),
    )
    await user.type(screen.getByLabelText('Nome'), '  Novo app  ')
    await user.selectOptions(
      screen.getByLabelText('Modelo de cobrança'),
      'Compra única',
    )
    await user.click(save())

    await waitFor(() =>
      expect(seen.body).toEqual({
        name: 'Novo app',
        billingModel: 'one_time',
        active: true,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('nome vazio bloqueia o envio', async () => {
    const { user } = open()
    await user.click(
      await screen.findByRole('button', { name: 'Novo produto' }),
    )
    await user.click(save())
    expect(await screen.findByText('Informe o nome')).toBeInTheDocument()
  })

  it('editar prefill o modelo e envia só o campo alterado', async () => {
    const { user } = open()
    const seen = capture('patch', '*/admin/catalog/products/100', () =>
      HttpResponse.json(product({ name: 'GPTMaker 2' })),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Editar produto GPTMaker' }),
    )
    expect(screen.getByLabelText('Modelo de cobrança')).toHaveValue('standard')
    const name = screen.getByLabelText('Nome')
    await user.clear(name)
    await user.type(name, 'GPTMaker 2')
    await user.click(save())

    await waitFor(() => expect(seen.body).toEqual({ name: 'GPTMaker 2' }))
    expect(seen.reason).toBeNull()
  })

  it('desligar Ativo no produto exige motivo e o envia no cabeçalho', async () => {
    const { user } = open()
    const seen = capture('patch', '*/admin/catalog/products/100', () =>
      HttpResponse.json(product({ active: false })),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Editar produto GPTMaker' }),
    )
    await user.click(screen.getByLabelText('Ativo'))
    await user.click(save())
    expect(await screen.findByText('Informe o motivo.')).toBeInTheDocument()
    expect(seen.body).toBeUndefined()

    await user.type(screen.getByLabelText('Motivo'), 'Descontinuado')
    await user.click(save())
    await waitFor(() => expect(seen.body).toEqual({ active: false }))
    expect(seen.reason).toBe('Descontinuado')
  })

  it('409 PRODUCT_IN_USE ao trocar o modelo vira alerta com o uso', async () => {
    const { user } = open()
    capture('patch', '*/admin/catalog/products/100', () =>
      HttpResponse.json(
        {
          error: {
            code: 'PRODUCT_IN_USE',
            message: 'Produto em uso',
            details: { apps: ['crmthink.gptmaker'], plans: 1 },
          },
        },
        { status: 409 },
      ),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Editar produto GPTMaker' }),
    )
    await user.selectOptions(
      screen.getByLabelText('Modelo de cobrança'),
      'Por unidade',
    )
    await user.click(save())

    const alert = await within(dialog()).findByRole('alert')
    expect(alert).toHaveTextContent('Produto em uso')
    expect(alert).toHaveTextContent('crmthink.gptmaker')
    expect(alert).toHaveTextContent('1 plano')
    expect(alert).toHaveTextContent('crie um plano novo e desative este')
  })
})

describe('formulário de plano', () => {
  async function newPlan(user: ReturnType<typeof open>['user']) {
    await user.click(
      await screen.findByRole('button', { name: 'Novo plano neste produto' }),
    )
  }

  it('criar envia o valor em centavos, intervalo e preços', async () => {
    const { user } = open()
    const seen = capture('post', '*/admin/catalog/products/100/plans', () =>
      HttpResponse.json(plan(), { status: 201 }),
    )

    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Plano Anual')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '199,00')
    await user.selectOptions(screen.getByLabelText('Intervalo'), 'Anual')
    await user.type(
      screen.getByLabelText('ID do preço no Stripe: homologação'),
      ' price_abc1 ',
    )
    await user.type(
      screen.getByLabelText('ID do preço no Stripe: produção'),
      'price_xyz9',
    )
    await user.click(save())

    await waitFor(() =>
      expect(seen.body).toEqual({
        name: 'Plano Anual',
        amount: 19900,
        interval: 'yearly',
        trial: false,
        priceHomolog: 'price_abc1',
        priceProduction: 'price_xyz9',
        active: true,
      }),
    )
  })

  it('só um preço informado basta; o outro vai null', async () => {
    const { user } = open()
    const seen = capture('post', '*/admin/catalog/products/100/plans')

    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Plano')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '10')
    await user.type(
      screen.getByLabelText('ID do preço no Stripe: produção'),
      'price_xyz9',
    )
    await user.click(save())

    await waitFor(() =>
      expect(seen.body).toMatchObject({
        amount: 1000,
        priceHomolog: null,
        priceProduction: 'price_xyz9',
      }),
    )
  })

  it('trial esconde os preços e envia os dois null', async () => {
    const { user } = open()
    const seen = capture('post', '*/admin/catalog/products/100/plans')

    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Trial')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '0')
    await user.click(screen.getByLabelText('Plano de trial (sem cobrança)'))
    expect(
      screen.queryByLabelText('ID do preço no Stripe: homologação'),
    ).toBeNull()
    expect(
      screen.queryByLabelText('ID do preço no Stripe: produção'),
    ).toBeNull()
    await user.click(save())

    await waitFor(() =>
      expect(seen.body).toMatchObject({
        trial: true,
        priceHomolog: null,
        priceProduction: null,
      }),
    )
  })

  it('plano pago sem nenhum preço bloqueia o envio com mensagem', async () => {
    const { user } = open()
    const seen = capture('post', '*/admin/catalog/products/100/plans')

    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Plano')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '10')
    await user.click(save())

    expect(
      await screen.findByText(/Informe ao menos um preço/),
    ).toBeInTheDocument()
    expect(seen.body).toBeUndefined()
  })

  it('formato de preço inválido bloqueia o envio', async () => {
    const { user } = open()
    const seen = capture('post', '*/admin/catalog/products/100/plans')

    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Plano')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '10')
    await user.type(
      screen.getByLabelText('ID do preço no Stripe: homologação'),
      'prod_123',
    )
    await user.click(save())

    expect(await screen.findByText(/Use o formato price_/)).toBeInTheDocument()
    expect(seen.body).toBeUndefined()
  })

  it('valor inválido vira erro no campo', async () => {
    const { user } = open()
    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Plano')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '1,234')
    await user.click(save())
    expect(await screen.findByText(/Valor inválido/)).toBeInTheDocument()
  })

  it('compra única esconde o intervalo e envia interval null', async () => {
    const { user } = open([
      product({ kind: 'one_time', billingModelKey: 'one_time', plans: [] }),
    ])
    const seen = capture('post', '*/admin/catalog/products/100/plans')

    await newPlan(user)
    expect(screen.queryByLabelText('Intervalo')).toBeNull()
    await user.type(screen.getByLabelText('Nome'), 'Avulso')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '50')
    await user.type(
      screen.getByLabelText('ID do preço no Stripe: produção'),
      'price_one1',
    )
    await user.click(save())

    await waitFor(() =>
      expect(seen.body).toMatchObject({ interval: null, amount: 5000 }),
    )
  })

  it('editar envia só o campo alterado e explica o bloqueio por uso', async () => {
    const { user } = open()
    const seen = capture('patch', '*/admin/catalog/plans/501')

    await user.click(
      await screen.findByRole('button', { name: 'Editar plano Plano Mensal' }),
    )
    const amount = screen.getByLabelText('Valor de referência (R$)')
    expect(amount).toHaveValue('199,00')
    expect(screen.getByLabelText('Intervalo')).toHaveValue('monthly')
    expect(
      screen.getByText(/Plano em uso não troca preço, trial nem intervalo/),
    ).toBeInTheDocument()
    await user.clear(amount)
    await user.type(amount, '249,90')
    await user.click(save())

    await waitFor(() => expect(seen.body).toEqual({ amount: 24990 }))
  })

  it('409 PLAN_IN_USE ao trocar o preço vira alerta com o uso e a orientação', async () => {
    const { user } = open()
    capture('patch', '*/admin/catalog/plans/501', () =>
      HttpResponse.json(
        {
          error: {
            code: 'PLAN_IN_USE',
            message: 'Plano em uso: não troca preço',
            details: {
              subscriptions: { total: 3, active: 2 },
              trialOfApps: ['crmthink.gptmaker'],
            },
          },
        },
        { status: 409 },
      ),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Editar plano Plano Mensal' }),
    )
    const price = screen.getByLabelText('ID do preço no Stripe: produção')
    await user.clear(price)
    await user.type(price, 'price_novo')
    await user.click(save())

    const alert = await within(dialog()).findByRole('alert')
    expect(alert).toHaveTextContent('Plano em uso: não troca preço')
    expect(alert).toHaveTextContent('3 assinaturas, 2 ativas')
    expect(alert).toHaveTextContent('crmthink.gptmaker')
    expect(alert).toHaveTextContent('crie um plano novo e desative este')
  })

  it('desligar Ativo no plano exige motivo', async () => {
    const { user } = open()
    const seen = capture('patch', '*/admin/catalog/plans/501')

    await user.click(
      await screen.findByRole('button', { name: 'Editar plano Plano Mensal' }),
    )
    await user.click(screen.getByLabelText('Ativo'))
    await user.click(save())
    expect(await screen.findByText('Informe o motivo.')).toBeInTheDocument()
    expect(seen.body).toBeUndefined()
    await user.type(screen.getByLabelText('Motivo'), 'Substituído')
    await user.click(save())

    await waitFor(() => expect(seen.body).toEqual({ active: false }))
    expect(seen.reason).toBe('Substituído')
  })

  it('preço inválido digitado e depois ocultado pelo trial não trava o envio', async () => {
    const { user } = open()
    const seen = capture('post', '*/admin/catalog/products/100/plans')

    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Trial')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '0')
    await user.type(
      screen.getByLabelText('ID do preço no Stripe: homologação'),
      'prod_1',
    )
    await user.click(save())
    expect(await screen.findByText(/Use o formato price_/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('Plano de trial (sem cobrança)'))
    await user.click(save())

    await waitFor(() =>
      expect(seen.body).toMatchObject({
        trial: true,
        priceHomolog: null,
        priceProduction: null,
      }),
    )
  })

  it.each([
    ['texto solto'],
    [{ apps: 'x', trialOfApps: 'y', subscriptions: 'z' }],
  ])(
    '409 com details malformado (%j) mostra mensagem e orientação sem quebrar',
    async details => {
      const { user } = open()
      capture('patch', '*/admin/catalog/plans/501', () =>
        HttpResponse.json(
          { error: { code: 'PLAN_IN_USE', message: 'Plano em uso', details } },
          { status: 409 },
        ),
      )
      await user.click(
        await screen.findByRole('button', {
          name: 'Editar plano Plano Mensal',
        }),
      )
      const amount = screen.getByLabelText('Valor de referência (R$)')
      await user.clear(amount)
      await user.type(amount, '5')
      await user.click(save())

      const alert = await within(dialog()).findByRole('alert')
      expect(alert).toHaveTextContent('Plano em uso')
      expect(alert).toHaveTextContent('crie um plano novo e desative este')
    },
  )

  it('erro de validação da API cai no campo', async () => {
    const { user } = open()
    capture('post', '*/admin/catalog/products/100/plans', () =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Inválido',
            details: [{ path: 'name', message: 'Nome já existe' }],
          },
        },
        { status: 400 },
      ),
    )
    await newPlan(user)
    await user.type(screen.getByLabelText('Nome'), 'Plano')
    await user.type(screen.getByLabelText('Valor de referência (R$)'), '10')
    await user.type(
      screen.getByLabelText('ID do preço no Stripe: produção'),
      'price_xyz9',
    )
    await user.click(save())
    expect(await screen.findByText('Nome já existe')).toBeInTheDocument()
  })
})
