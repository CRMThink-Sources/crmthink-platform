import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, applyStoredTheme, useTheme } from './theme'

function Probe() {
  const { theme, setTheme } = useTheme()
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('dark')}>escuro</button>
      <button onClick={() => setTheme('light')}>claro</button>
      <button onClick={() => setTheme('system')}>sistema</button>
    </>
  )
}

const root = document.documentElement

describe('tema', () => {
  beforeEach(() => {
    window.localStorage.clear()
    root.classList.remove('dark')
  })

  it('começa no sistema e guarda a escolha com a classe dark no html', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('system')
    await user.click(screen.getByText('escuro'))
    expect(root).toHaveClass('dark')
    expect(window.localStorage.getItem('theme')).toBe('dark')
    await user.click(screen.getByText('claro'))
    expect(root).not.toHaveClass('dark')
    expect(window.localStorage.getItem('theme')).toBe('light')
  })

  it('lê a escolha guardada (a mesma chave do next-themes)', () => {
    window.localStorage.setItem('theme', 'dark')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(root).toHaveClass('dark')
  })

  it('applyStoredTheme aplica antes de o React montar', () => {
    window.localStorage.setItem('theme', 'dark')
    act(() => applyStoredTheme())
    expect(root).toHaveClass('dark')
  })

  it('valor guardado inválido volta para o sistema', () => {
    window.localStorage.setItem('theme', 'roxo')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('system')
  })
})
