import { NAV_GROUPS, visibleGroups } from './nav'

const labels = (isOperator: boolean) =>
  visibleGroups(isOperator).map(group => ({
    title: group.title,
    items: group.items.map(item => item.label),
  }))

describe('menu', () => {
  it('suporte não vê Sistema nem Operadores, e o grupo Plataforma some', () => {
    expect(labels(false)).toEqual([
      { title: undefined, items: ['Painel'] },
      {
        title: 'Operação',
        items: ['Instalações', 'Eventos', 'Eventos Stripe', 'Apps'],
      },
      { title: 'Acesso', items: ['Auditoria'] },
    ])
  })

  it('operator vê todos os grupos', () => {
    expect(labels(true)).toEqual([
      { title: undefined, items: ['Painel'] },
      {
        title: 'Operação',
        items: ['Instalações', 'Eventos', 'Eventos Stripe', 'Apps'],
      },
      { title: 'Acesso', items: ['Auditoria', 'Operadores'] },
      { title: 'Plataforma', items: ['Sistema'] },
    ])
  })

  it('só o Painel casa a rota exata', () => {
    const exact = NAV_GROUPS.flatMap(group => group.items)
      .filter(item => item.end)
      .map(item => item.label)

    expect(exact).toEqual(['Painel'])
  })
})
