/**
 * Cria um operador do backoffice ou redefine o acesso de um existente. Única forma de
 * criar o primeiro operador (não há cadastro público).
 *
 * Uso: `yarn admin:create-operator --email <e-mail> --name "<nome>" --role <viewer|operator>`
 *      `yarn admin:create-operator --email <e-mail> --reset`
 */
import { env } from '@/config/env'
import { systemClock } from '@/shared/clock'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { createPrismaClient } from '@/shared/infra/prisma'
import { totpIssuer } from '@/modules/backoffice/domain/operator'
import { OperatorService } from '@/modules/backoffice/application/operators'
import { AdminSessions } from '@/modules/backoffice/application/sessions'
import { runCreateOperator } from '@/modules/backoffice/application/create-operator-cli'

async function main(): Promise<void> {
  const config = env()
  const db = createPrismaClient(config.databaseUrl)
  try {
    const sessions = new AdminSessions(db, systemClock, config.backoffice)
    const operators = new OperatorService(
      db,
      createTokenCipher(config.tokenEncryptionKey),
      totpIssuer(config.platformEnvironment),
      (id, except) => sessions.revokeAll(id, except),
    )
    await runCreateOperator(process.argv.slice(2), operators, line =>
      console.log(line),
    )
  } finally {
    await db.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
