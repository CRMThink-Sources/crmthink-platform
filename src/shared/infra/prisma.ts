import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '@/prisma/client'

export type Db = PrismaClient
/** Cliente dentro de `$transaction(async tx => ...)`. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>

export function createPrismaClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada')
  const url = new URL(databaseUrl)
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 10,
    // MySQL 8.4 (`caching_sha2_password`) sem TLS exige buscar a chave RSA do servidor.
    // Opt-in pela URL (`?allowPublicKeyRetrieval=true`), só para dev local: sem TLS a
    // chave pode ser trocada no caminho. Sem isso o erro aparece como "pool timeout".
    allowPublicKeyRetrieval:
      url.searchParams.get('allowPublicKeyRetrieval') === 'true',
  })
  return new PrismaClient({ adapter })
}
