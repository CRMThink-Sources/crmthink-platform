import { afterEach } from 'vitest'

// Env mínima para módulos que leem `env()` na importação. Os testes montam a própria
// config via `testEnv()`; isto só evita que um import acidental derrube a suíte.
process.env.PUBLIC_BASE_URL ??= 'https://platform.test'
process.env.PLATFORM_ENVIRONMENT ??= 'homolog'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')
process.env.LOG_LEVEL ??= 'silent'

// Respostas HTTP fora do contrato OpenAPI (ver `src/test/app.ts`) falham o teste.
afterEach(async () => {
  const { takeContractViolations } = await import('./contract-violations')
  const violations = takeContractViolations()
  if (violations.length) {
    throw new Error(
      `resposta fora do contrato OpenAPI:\n${violations
        .map(v => `  ${v.route} → ${v.status}: ${v.problems.join('; ')}`)
        .join('\n')}`,
    )
  }
})
