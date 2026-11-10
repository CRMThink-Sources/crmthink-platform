import { render, screen } from '@testing-library/react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

function renderTable() {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>x</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )
}

describe('Table', () => {
  it('desenha a tabela como cartão', () => {
    const { container } = renderTable()

    const card = container.querySelector('[data-slot="table-container"]')
    expect(card).toHaveClass('rounded-lg', 'border', 'bg-card')
  })

  it('cabeçalho pequeno e cinza', () => {
    renderTable()

    expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveClass(
      'text-xs',
      'text-muted-foreground',
    )
  })

  it('com bare não desenha o cartão (para tabelas que já estão dentro de um)', () => {
    const { container } = render(
      <Table bare>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    const wrapper = container.querySelector('[data-slot="table-container"]')
    expect(wrapper).toHaveClass('overflow-x-auto')
    expect(wrapper).not.toHaveClass('border')
    expect(wrapper).not.toHaveClass('rounded-lg')
    expect(wrapper).not.toHaveClass('bg-card')
  })

  it('sem cor fixa: só tokens do tema', () => {
    const { container } = renderTable()

    expect(container.innerHTML).not.toMatch(/zinc-|#[0-9a-f]{3,6}/i)
  })
})
