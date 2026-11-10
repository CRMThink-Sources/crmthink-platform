import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (relative: string) =>
  readFileSync(path.resolve(import.meta.dirname, relative), 'utf8')

describe('tipografia', () => {
  it('usa a fonte do sistema, sem Geist', () => {
    const css = read('../index.css')
    const fontLine = css.split('\n').find(line => line.includes('--font-sans:'))

    expect(fontLine).toContain('system-ui')
    expect(fontLine).toContain("'Segoe UI'")
    expect(css.toLowerCase()).not.toContain('geist')
    expect(read('../../package.json')).not.toContain(
      '@fontsource-variable/geist',
    )
  })
})
