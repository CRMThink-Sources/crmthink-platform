import { createApp } from './app'
import { bootstrap } from './bootstrap'

async function main(): Promise<void> {
  const boot = await bootstrap('crmthink-platform-api')
  const app = createApp(boot.container, boot.health)

  // Validação dos SPAs não bloqueia o boot: o resultado vai para o health check.
  void boot
    .checkSpa()
    .catch(error => boot.log.error({ err: error }, 'falha ao validar SPAs'))
  const spaTimer = setInterval(() => {
    void boot
      .checkSpa()
      .catch(error => boot.log.error({ err: error }, 'falha ao validar SPAs'))
  }, 10 * 60_000)

  const server = app.listen(boot.config.port, () => {
    boot.log.info(
      { port: boot.config.port, environment: boot.config.platformEnvironment },
      'api no ar',
    )
  })

  const stop = () => {
    boot.log.info('encerrando api')
    clearInterval(spaTimer)
    server.close(() => {
      void boot.shutdown().finally(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 15_000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch(error => {
  // Logger pode não estar configurado ainda (env inválida): stderr direto.
  console.error(
    '[crmthink-platform-api] falha no boot:',
    error instanceof Error ? error.message : error,
  )
  process.exit(1)
})
