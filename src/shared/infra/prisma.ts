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
  })
  return new PrismaClient({ adapter })
}
