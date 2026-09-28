/**
 * Servidor de JWKS + emissão de um JWT real da plataforma, para validar SDKs de
 * outras linguagens (ex.: `sdk/java`). Uso: `npx tsx src/test/jwks-fixture.ts`.
 * Imprime `READY <url> <token>` e serve `/.well-known/jwks.json` até ser encerrado.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { SigningKeys } from '@/modules/installations/application/signing-keys'
import { FakePrisma } from './fake-prisma'
import { TEST_KEY } from './fakes'

async function main(): Promise<void> {
  const holder = { issuer: '' }
  const server = createServer((_req, res) => {
    void keys.jwks().then(jwks => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(jwks))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  holder.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const keys = new SigningKeys(
    new FakePrisma().asDb(),
    createTokenCipher(TEST_KEY),
    { now: () => new Date() },
    {
      issuer: holder.issuer,
      ttlSeconds: 900,
    },
  )
  await keys.rotate(0)
  const { token } = await keys.sign({
    sub: '7',
    aud: process.argv[2] ?? 'crmthink.gptmaker',
    installationId: 1001,
    memberId: 'member-abc',
    domain: 'cliente.bitrix24.com.br',
    isAdmin: true,
    name: 'Ana Silva',
    departmentIds: [1, 5],
  })
  console.log(`READY ${holder.issuer} ${token}`)
}

void main()
