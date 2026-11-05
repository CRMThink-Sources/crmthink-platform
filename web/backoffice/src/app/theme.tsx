import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * Tema claro/escuro/sistema. Substitui o `next-themes`, que injeta um `<script>` no
 * React 19 (aviso no console a cada carga) e cujo script a CSP do backoffice
 * (`script-src 'self'`) bloquearia de qualquer jeito. Mesma chave de armazenamento
 * (`theme`) e mesma convenção (classe `dark` no `<html>`), então a escolha já feita
 * pelas pessoas continua valendo.
 */
export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'
const QUERY = '(prefers-color-scheme: dark)'

function readStored(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function prefersDark(): boolean {
  return window.matchMedia?.(QUERY).matches ?? false
}

function apply(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}

/** Aplica a escolha guardada antes do primeiro desenho (chamado em `main.tsx`). */
export function applyStoredTheme(): void {
  apply(readStored())
}

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored)

  useEffect(() => {
    apply(theme)
    if (theme !== 'system' || !window.matchMedia) return
    // No modo sistema, acompanha a troca de tema do sistema operacional.
    const media = window.matchMedia(QUERY)
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: next => {
        try {
          window.localStorage.setItem(STORAGE_KEY, next)
        } catch {
          // Sem armazenamento: a escolha vale só nesta sessão.
        }
        setThemeState(next)
      },
    }),
    [theme],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
