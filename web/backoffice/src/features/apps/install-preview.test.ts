import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PREVIEW_DEFAULTS } from './install-preview'

/**
 * A pré-visualização do tema copia o CSS e os padrões da página de instalação do
 * servidor. Estes testes quebram quando o servidor muda e a cópia fica para trás.
 */
// O vitest roda na pasta do pacote web; o servidor fica duas pastas acima.
const SERVER = readFileSync(
  resolve(
    process.cwd(),
    '../../src/modules/installations/http/install-page.ts',
  ),
  'utf8',
)
const PREVIEW_CSS = readFileSync(
  resolve(process.cwd(), 'src/features/apps/install-preview.css'),
  'utf8',
)

/**
 * Forma canônica do CSS, para comparar sem depender de formatação: o prettier
 * reformata a cópia (várias linhas, aspas simples, `0.85rem`), o servidor tem tudo em
 * uma linha por regra.
 */
const canon = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/'/g, '"')
    .replace(/(^|[^\d])0\./g, '$1.')
    .trim()

/** Regras do `<style>` do servidor, menos o `:root` (que é montado com o tema). */
function serverRules(): string[] {
  const css = /<style>([\s\S]*?)<\/style>/.exec(SERVER)?.[1] ?? ''
  return css
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith(':root'))
}

/** Mesma regra no escopo da pré-visualização (`body` vira o próprio contêiner). */
function scoped(rule: string): string {
  const [selector, ...rest] = rule.split('{')
  const sel = selector!.trim()
  const scope = '.install-preview'
  const next = sel === 'body' ? scope : `${scope} ${sel}`
  return `${next} {${rest.join('{')}`
}

describe('pré-visualização do tema × página de instalação', () => {
  it('o CSS copiado acompanha o do servidor', () => {
    const expected = serverRules().map(scoped)
    expect(expected.length).toBeGreaterThan(8)
    expect(canon(PREVIEW_CSS)).toBe(canon(expected.join('\n')))
  })

  it('detecta divergência (sanidade do próprio teste)', () => {
    const expected = serverRules().map(scoped).join('\n')
    expect(canon(PREVIEW_CSS.replace('12px', '13px'))).not.toBe(canon(expected))
  })

  it('os padrões de tema são os do servidor', () => {
    const block =
      /DEFAULT_THEME[\s\S]*?= \{([\s\S]*?)\n\}/.exec(SERVER)?.[1] ?? ''
    const read = (key: string) =>
      new RegExp(`${key}: '([^']*)'`).exec(block)?.[1]
    for (const [key, value] of Object.entries(PREVIEW_DEFAULTS))
      expect(read(key), key).toBe(value)
  })

  it('a regra de cor segura é a do servidor', () => {
    const server = /const COLOR =\s*(\/.*\/)\r?\n/.exec(SERVER)?.[1]
    expect(server).toBe(
      String.raw`/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/`,
    )
  })
})
