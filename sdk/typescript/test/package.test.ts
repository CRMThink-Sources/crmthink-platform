import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? sourceFiles(path.join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [path.join(dir, entry.name)]
        : [],
  )
}

/** Especificadores de `import`/`export ... from` e `import()` de um arquivo. */
function specifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    match => match[1]!,
  )
}

describe('pacote @crmthink-sources/platform-sdk', () => {
  it('publica só dist/, package.json e README.md', () => {
    const output = execSync('npm pack --dry-run --json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const [pack] = JSON.parse(output) as [{ files: { path: string }[] }]
    const files = pack.files.map(file => file.path)
    expect(files).toContain('package.json')
    expect(files).toContain('README.md')
    const extra = files.filter(
      file =>
        !file.startsWith('dist/') &&
        file !== 'package.json' &&
        file !== 'README.md',
    )
    expect(extra).toEqual([])
    expect(files.filter(file => file.endsWith('.test.js'))).toEqual([])
  }, 60_000)

  it('não importa código da plataforma', () => {
    const allowed = new Set(['jose', 'node:crypto'])
    const offending = sourceFiles(path.join(root, 'src')).flatMap(file =>
      specifiers(file)
        .filter(spec =>
          spec.startsWith('.')
            ? !path
                .resolve(path.dirname(file), spec)
                .startsWith(path.join(root, 'src'))
            : !allowed.has(spec),
        )
        .map(spec => `${path.relative(root, file)}: ${spec}`),
    )
    expect(offending).toEqual([])
  })
})
