/**
 * Gera uma chave de assinatura do JWT nova (publicada já, assina após o `--lead`).
 * Equivale a `POST /admin/signing-keys/rotate`, para quando a API ainda não sobe
 * (ex.: primeiro deploy sem `JWT_SIGNING_PRIVATE_KEY`).
 *
 * Uso: `yarn admin:rotate-signing-key [--lead=<minutos>]` (padrão 10; 0 = imediato).
 */
import { env } from '@/config/env'
import { systemClock } from '@/shared/clock'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { createPrismaClient } from '@/shared/infra/prisma'
import { SigningKeys } from '@/modules/installations/application/signing-keys'

async function main(): Promise<void> {
  const config = env()
  const leadArg = process.argv.find(arg => arg.startsWith('--lead='))
  const leadMinutes = leadArg ? Number(leadArg.slice('--lead='.length)) : 10
  const db = createPrismaClient(config.databaseUrl)
  try {
    const keys = new SigningKeys(
      db,
      createTokenCipher(config.tokenEncryptionKey),
      systemClock,
      {
        issuer: config.jwt.issuer,
        ttlSeconds: config.jwt.ttlSeconds,
      },
    )
    const result = await keys.rotate(leadMinutes * 60_000)
    console.log(
      `chave ${result.kid} publicada; assina a partir de ${result.activatesAt.toISOString()}`,
    )
  } finally {
    await db.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
