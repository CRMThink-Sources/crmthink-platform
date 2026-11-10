import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import {
  apiError,
  catalogHandler,
  catalogProduct,
  meHandler,
  operator,
  viewer,
} from '@/test/fixtures'
import { renderRoutes } from '@/test/render'
import { server } from '@/test/server'
import { ProductPicker } from './product-picker'

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <ProductPicker value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  )
}

const value = () => screen.getByTestId('value').textContent

const products = [
  catalogProduct({ id: 10, name: 'GPTMaker' }),
  catalogProduct({ id: 11, name: 'Extrator', billingModelKey: 'per_unit' }),
  catalogProduct({ id: 12, name: 'Legado', active: false }),
  catalogProduct({
    id: 13,
    name: 'Quebrado',
    valid: false,
    problems: ['Modelo de cobrança desconhecido'],
  }),
]

function open(
  initial: string,
  opts: { writable?: boolean; viewer?: boolean } = {},
) {
  server.use(
    meHandler(opts.viewer ? viewer() : operator()),
    catalogHandler(products, opts.writable ?? true),
  )
  return renderRoutes(
    [{ path: '/', element: <Harness initial={initial} /> }],
    '/',
  )
}

describe('seletor de produtos', () => {
  it('marcar e desmarcar atualiza o valor na ordem da seleção', async () => {
    const { user } = open('')
    await user.click(await screen.findByRole('checkbox', { name: /GPTMaker/ }))
    expect(value()).toBe('10')
    await user.click(screen.getByRole('checkbox', { name: /Extrator/ }))
    expect(value()).toBe('10, 11')
    await user.click(screen.getByRole('checkbox', { name: /GPTMaker/ }))
    expect(value()).toBe('11')
  })

  it('mostra #id, tipo da cobrança e estado, e já marca os ids existentes', async () => {
    open('10, 11')
    const gpt = await screen.findByRole('checkbox', { name: /GPTMaker/ })
    expect(gpt).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Extrator/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Legado/ })).not.toBeChecked()
    expect(screen.getByText('#10')).toBeInTheDocument()
    expect(screen.getByText('Por unidade')).toBeInTheDocument()
    expect(value()).toBe('10, 11')
  })

  it('id desconhecido aparece marcado com o aviso e continua no valor até desmarcar', async () => {
    const { user } = open('10, 999')
    const unknown = await screen.findByRole('checkbox', {
      name: /produto #999 \(não encontrado\)/,
    })
    expect(unknown).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: /Extrator/ }))
    expect(value()).toBe('10, 999, 11')
    await user.click(unknown)
    expect(value()).toBe('10, 11')
  })

  it('produto inativo fica selecionável e mostra o selo', async () => {
    const { user } = open('')
    const legacy = await screen.findByRole('checkbox', { name: /Legado/ })
    expect(screen.getByText('Inativo')).toBeInTheDocument()
    await user.click(legacy)
    expect(value()).toBe('12')
    await user.click(legacy)
    expect(value()).toBe('')
  })

  it('produto inválido mostra o problema e não pode ser marcado', async () => {
    open('')
    const broken = await screen.findByRole('checkbox', { name: /Quebrado/ })
    expect(broken).toBeDisabled()
    expect(
      screen.getByText('Modelo de cobrança desconhecido'),
    ).toBeInTheDocument()
  })

  it('produto inválido já marcado pode ser desmarcado', async () => {
    const { user } = open('13')
    const broken = await screen.findByRole('checkbox', { name: /Quebrado/ })
    expect(broken).toBeChecked()
    expect(broken).toBeEnabled()
    await user.click(broken)
    expect(value()).toBe('')
  })

  it('criar produto pelo seletor marca o novo e atualiza o catálogo', async () => {
    let calls = 0
    const { user } = open('10')
    server.use(
      http.post('*/admin/catalog/products', () =>
        HttpResponse.json(catalogProduct({ id: 20, name: 'Novo' }), {
          status: 201,
        }),
      ),
      http.get('*/admin/catalog/products', () => {
        calls++
        return HttpResponse.json({
          writable: true,
          products: [...products, catalogProduct({ id: 20, name: 'Novo' })],
          orphanPlans: [],
        })
      }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Criar produto' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Nome'), 'Novo')
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(value()).toBe('10, 20'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('checkbox', { name: /Novo/ })).toBeChecked()
    expect(calls).toBeGreaterThan(0)
  })

  it('na homologação (writable:false) não há Criar produto', async () => {
    open('', { writable: false })
    await screen.findByRole('checkbox', { name: /GPTMaker/ })
    expect(screen.queryByRole('button', { name: 'Criar produto' })).toBeNull()
  })

  it('suporte não vê Criar produto', async () => {
    open('', { viewer: true })
    await screen.findByRole('checkbox', { name: /GPTMaker/ })
    expect(screen.queryByRole('button', { name: 'Criar produto' })).toBeNull()
  })

  it('erro da API mostra tentar novamente e não mexe no valor', async () => {
    server.use(
      meHandler(operator()),
      http.get('*/admin/catalog/products', () =>
        apiError(500, 'INTERNAL', 'Falhou'),
      ),
    )
    const { user } = renderRoutes(
      [{ path: '/', element: <Harness initial="10, 11" /> }],
      '/',
    )
    expect(
      await screen.findByRole('button', { name: /Tentar novamente/ }),
    ).toBeInTheDocument()
    expect(value()).toBe('10, 11')

    server.use(catalogHandler(products))
    await user.click(screen.getByRole('button', { name: /Tentar novamente/ }))
    expect(
      await screen.findByRole('checkbox', { name: /GPTMaker/ }),
    ).toBeChecked()
    expect(value()).toBe('10, 11')
  })

  it('mostra o carregamento enquanto o catálogo não chegou', async () => {
    open('')
    expect(screen.getByLabelText('Carregando')).toBeInTheDocument()
    await screen.findByRole('checkbox', { name: /GPTMaker/ })
  })
})
