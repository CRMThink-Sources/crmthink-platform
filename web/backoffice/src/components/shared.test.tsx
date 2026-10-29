import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/api/client'
import { DateTime } from '@/components/date-time'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { StatusBadge } from '@/components/status-badge'
import { TooltipProvider } from '@/components/ui/tooltip'
import { formatDateTime, formatRelative } from '@/lib/format'

describe('formatação de datas', () => {
  it('mostra no fuso de São Paulo, independente do fuso da máquina', () => {
    expect(formatDateTime('2026-10-28T15:00:00Z')).toBe('28/10/2026, 12:00:00')
    expect(formatDateTime('2026-10-29T02:30:00Z')).toBe('28/10/2026, 23:30:00')
  })

  it('relativa em pt-br', () => {
    const now = new Date('2026-10-28T15:00:00Z')
    expect(formatRelative('2026-10-28T12:00:00Z', now)).toBe('há 3 horas')
    expect(formatRelative('2026-10-30T15:00:00Z', now)).toBe('em 2 dias')
  })

  it('tooltip da data relativa traz a data completa', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DateTime value="2026-10-28T15:00:00Z" />
      </TooltipProvider>,
    )
    await userEvent.hover(screen.getByText(/há|em /))
    expect(
      (await screen.findAllByText('28/10/2026, 12:00:00 (America/Sao_Paulo)'))
        .length,
    ).toBeGreaterThan(0)
  })
})

describe('estados', () => {
  it('carregando, vazio e erro com retry', async () => {
    const retry = vi.fn()
    const { rerender } = render(<LoadingState />)
    expect(screen.getByLabelText('Carregando')).toBeInTheDocument()

    rerender(<EmptyState message="Nenhum evento morto de crmthink.gptmaker" />)
    expect(
      screen.getByText('Nenhum evento morto de crmthink.gptmaker'),
    ).toBeInTheDocument()

    rerender(
      <ErrorState
        error={new ApiError(500, 'INTERNAL_ERROR', 'Erro interno')}
        onRetry={retry}
      />,
    )
    expect(screen.getByText('INTERNAL_ERROR')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Tentar novamente'))
    expect(retry).toHaveBeenCalled()
  })

  it('403 aparece como sem permissão', () => {
    render(
      <ErrorState
        error={new ApiError(403, 'FORBIDDEN_ROLE', 'Papel sem permissão')}
      />,
    )
    expect(screen.getByText('Sem permissão')).toBeInTheDocument()
  })

  it('badges com rótulo em pt-br', () => {
    render(
      <>
        <StatusBadge kind="event" value="dead" />
        <StatusBadge kind="token" value="refresh_failing" />
        <StatusBadge kind="installation" value="NOVO_STATUS" />
      </>,
    )
    expect(screen.getByText('Morto')).toBeInTheDocument()
    expect(screen.getByText('Renovação falhando')).toBeInTheDocument()
    expect(screen.getByText('NOVO_STATUS')).toBeInTheDocument()
  })
})
