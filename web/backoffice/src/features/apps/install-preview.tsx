import type { CSSProperties } from 'react'
import './install-preview.css'
import type { AppFormValues } from './app-form-schema'

/**
 * Mesmos padrões e mesma regra de cores seguras do servidor
 * (`install-page.ts`: `DEFAULT_THEME`, `safeColor`). `install-preview.test.ts` confere
 * que os padrões não divergiram.
 */
export const PREVIEW_DEFAULTS = {
  primaryColor: '#2f6fed',
  backgroundColor: '#f5f7fb',
  textColor: '#1f2937',
  title: 'Instalação',
  welcomeText: 'Clique em Instalar para concluir a instalação no seu Bitrix24.',
  termsText: 'termos de uso',
} as const

const COLOR =
  /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/
const safeColor = (value: string, fallback: string) =>
  value && COLOR.test(value) ? value : fallback

/**
 * Como a página `/install/{appCode}` ficará com o tema do formulário. O botão não faz
 * nada: é só visual.
 */
export function InstallPreview(props: {
  name: string
  logoUrl: string
  theme: AppFormValues['theme']
}) {
  const { theme } = props
  const style = {
    '--primary': safeColor(theme.primaryColor, PREVIEW_DEFAULTS.primaryColor),
    '--bg': safeColor(theme.backgroundColor, PREVIEW_DEFAULTS.backgroundColor),
    '--text': safeColor(theme.textColor, PREVIEW_DEFAULTS.textColor),
  } as CSSProperties
  const title = theme.title || `${PREVIEW_DEFAULTS.title} — ${props.name}`
  const termsText = theme.termsText || PREVIEW_DEFAULTS.termsText
  const logo = props.logoUrl && URL.canParse(props.logoUrl) ? props.logoUrl : ''

  return (
    <div
      className="install-preview overflow-hidden rounded-lg border"
      style={style}
      aria-label="Pré-visualização da página de instalação"
    >
      <main>
        {logo && <img className="logo" src={logo} alt={props.name} />}
        <h1>{title}</h1>
        <section className="state active">
          <p>{theme.welcomeText || PREVIEW_DEFAULTS.welcomeText}</p>
          <button type="button" tabIndex={-1}>
            Instalar
          </button>
          <p className="terms">
            Ao clicar em Instalar, você aceita os{' '}
            {theme.termsUrl && URL.canParse(theme.termsUrl) ? (
              <a
                href={theme.termsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {termsText}
              </a>
            ) : (
              termsText
            )}
            .
          </p>
        </section>
      </main>
    </div>
  )
}
