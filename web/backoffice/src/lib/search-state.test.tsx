import { act, screen } from '@testing-library/react'
import z from 'zod'
import { Pager } from '@/components/pager'
import { useSearchState } from '@/lib/search-state'
import { currentUrl, renderRoutes } from '@/test/render'

const schema = z.object({
  status: z.enum(['pending', 'dead']).optional().catch(undefined),
  cursor: z.string().optional(),
})

function Events() {
  const [state, update] = useSearchState(schema)
  return (
    <div>
      <p>status: {state.status ?? 'todos'}</p>
      <button onClick={() => update({ status: 'dead' })}>só dead</button>
      <button onClick={() => update({ status: 'pending' })}>só pending</button>
      <Pager
        cursor={state.cursor}
        nextCursor="c2"
        onCursor={cursor => update({ cursor })}
      />
    </div>
  )
}

describe('estado na URL', () => {
  it('filtro vai para a URL, limpa o cursor e voltar desfaz', async () => {
    const { router, user } = renderRoutes(
      [{ path: '/events', element: <Events /> }],
      '/events?status=pending&cursor=c1',
    )
    expect(screen.getByText('status: pending')).toBeInTheDocument()

    await user.click(screen.getByText('só dead'))
    expect(currentUrl(router)).toBe('/events?status=dead')
    expect(screen.getByText('status: dead')).toBeInTheDocument()

    await act(() => router.navigate(-1))
    expect(currentUrl(router)).toBe('/events?status=pending&cursor=c1')
    expect(screen.getByText('status: pending')).toBeInTheDocument()
  })

  it('valor inválido na URL cai no padrão', () => {
    renderRoutes(
      [{ path: '/events', element: <Events /> }],
      '/events?status=xyz',
    )
    expect(screen.getByText('status: todos')).toBeInTheDocument()
  })

  it('Próxima põe o cursor; Anterior volta no histórico', async () => {
    const { router, user } = renderRoutes(
      [{ path: '/events', element: <Events /> }],
      '/events?status=dead',
    )
    await user.click(screen.getByText('Próxima'))
    expect(currentUrl(router)).toBe('/events?status=dead&cursor=c2')
    await user.click(screen.getByText('Anterior'))
    expect(currentUrl(router)).toBe('/events?status=dead')
  })

  it('Anterior num link direto para página do meio vai para a primeira', async () => {
    const { router, user } = renderRoutes(
      [{ path: '/events', element: <Events /> }],
      '/events?status=dead&cursor=c5',
    )
    await user.click(screen.getByText('Anterior'))
    expect(currentUrl(router)).toBe('/events?status=dead')
  })
})
