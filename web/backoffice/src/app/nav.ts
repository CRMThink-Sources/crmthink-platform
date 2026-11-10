import {
  Activity,
  Boxes,
  CreditCard,
  LayoutDashboard,
  Package,
  ScrollText,
  Send,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Só a rota exata marca o item como ativo (o Painel, que é a raiz). */
  end?: boolean
  /** Item só para `operator`: o suporte não vê. */
  operatorOnly?: boolean
}

export type NavGroup = { title?: string; items: NavItem[] }

/** Menu lateral em grupos. O Painel fica sozinho, sem título, no topo. */
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ to: '/', label: 'Painel', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Operação',
    items: [
      { to: '/installations', label: 'Instalações', icon: Boxes },
      { to: '/events', label: 'Eventos', icon: Send },
      { to: '/stripe-events', label: 'Eventos Stripe', icon: CreditCard },
      { to: '/apps', label: 'Apps', icon: Activity },
      { to: '/catalog', label: 'Catálogo', icon: Package },
    ],
  },
  {
    title: 'Acesso',
    items: [
      { to: '/audit', label: 'Auditoria', icon: ScrollText },
      {
        to: '/operators',
        label: 'Operadores',
        icon: Users,
        operatorOnly: true,
      },
    ],
  },
  {
    title: 'Plataforma',
    items: [
      { to: '/system', label: 'Sistema', icon: Settings, operatorOnly: true },
    ],
  },
]

/** Grupos que a pessoa enxerga: sem os itens de `operator` para o suporte e sem grupo vazio. */
export function visibleGroups(isOperator: boolean): NavGroup[] {
  return NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => !item.operatorOnly || isOperator),
  })).filter(group => group.items.length > 0)
}
