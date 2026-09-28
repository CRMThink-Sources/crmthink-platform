import 'dotenv/config'
import { defineConfig } from '@prisma/config'

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (url?.length) return url
  // `prisma generate` não precisa de banco; o placeholder evita erro de config.
  return 'mysql://placeholder:placeholder@localhost:3306/placeholder'
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: resolveDatabaseUrl() },
})
