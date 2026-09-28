/**
 * Importa as instalações e credenciais de um app do hub-core para a plataforma, sem
 * reinstalação pelos clientes (task 18.2 — ver docs/migration/hub-core.md).
 *
 *   yarn tsx scripts/import-hub-core.ts --app=crmthink.thinkzap --hub-core-url=mysql://…        (dry-run)
 *   yarn tsx scripts/import-hub-core.ts --app=crmthink.thinkzap --hub-core-url=mysql://… --apply
 *
 * Variáveis: as da plataforma (DATABASE_URL, TOKEN_ENCRYPTION_KEY, …) e
 * `HUB_CORE_TOKEN_ENCRYPTION_KEY` quando os tokens do hub-core estão cifrados (`v1:`).
 *
 * Regras:
 * - o app precisa estar cadastrado na plataforma com o mesmo `client_id` do hub-core;
 * - `installationId` = `core_apps.spa_id` (item do SPA 1060 que já existe); instalação
 *   sem espelho no SPA é listada e pulada;
 * - tokens decifrados com a chave do hub-core (ou lidos como texto puro, o legado) e
 *   gravados cifrados com a chave da plataforma;
 * - `trial_used = true` (cliente existente não ganha trial novo) e `ever_activated = true`
 *   (a próxima instalação é reinstalação);
 * - nenhum evento é emitido; instalação já presente na plataforma não é tocada.
 */
import { createDecipheriv } from 'node:crypto'
import mariadb from 'mariadb'
import { env } from '@/config/env'
import { createTokenCipher } from '@/shared/crypto/token-cipher'
import { createPrismaClient } from '@/shared/infra/prisma'
import { normalizeBitrixDomain } from '@/shared/bitrix/normalize'

type HubRow = {
  core_app_id: string
  spa_id: string | null
  email: string
  status: string
  installed_at: Date
  domain: string
  member_id: string
  client_id: string | null
  access_token: string | null
  refresh_token: string | null
  expires_at: Date | null
  refresh_failed_attempts: number | null
}

function arg(name: string): string | undefined {
  return process.argv
    .find(value => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

/** Decifra no formato do hub-core (`token-cipher.ts`): `v1:` AES-256-GCM, senão texto puro. */
function hubDecrypt(value: string, keyBase64: string | undefined): string {
  if (!value.startsWith('v1:')) return value
  if (!keyBase64)
    throw new Error(
      'token cifrado no hub-core: defina HUB_CORE_TOKEN_ENCRYPTION_KEY',
    )
  const packed = Buffer.from(value.slice(3), 'base64')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyBase64, 'base64'),
    packed.subarray(0, 12),
  )
  decipher.setAuthTag(packed.subarray(12, 28))
  return Buffer.concat([
    decipher.update(packed.subarray(28)),
    decipher.final(),
  ]).toString('utf8')
}

async function main(): Promise<void> {
  const appCode = arg('app')
  const hubUrl = arg('hub-core-url')
  const apply = process.argv.includes('--apply')
  if (!appCode || !hubUrl)
    throw new Error('uso: --app=<appCode> --hub-core-url=mysql://… [--apply]')

  const config = env()
  const cipher = createTokenCipher(config.tokenEncryptionKey)
  const db = createPrismaClient(config.databaseUrl)
  const hub = await mariadb.createConnection(hubUrl)

  const summary = {
    imported: 0,
    skippedExisting: 0,
    skippedNoSpa: 0,
    uninstalled: 0,
    errors: 0,
  }
  try {
    const app = await db.app.findUnique({ where: { appCode } })
    if (!app) throw new Error(`app ${appCode} não cadastrado na plataforma`)

    const [appCodeRow] = await hub.query<Array<{ id: string; code: string }>>(
      'SELECT id, code FROM core_app_codes WHERE id = ?',
      [appCode],
    )
    if (!appCodeRow)
      throw new Error(`app ${appCode} não existe em core_app_codes`)
    if (appCodeRow.code !== app.bitrixClientId) {
      throw new Error(
        `client_id divergente: hub-core ${appCodeRow.code} × plataforma ${app.bitrixClientId}`,
      )
    }

    const rows = await hub.query<HubRow[]>(
      `SELECT a.id AS core_app_id, a.spa_id, a.email, a.status, a.installed_at,
              d.name AS domain, d.member_id,
              c.client_id, c.access_token, c.refresh_token, c.expires_at, c.refresh_failed_attempts
         FROM core_apps a
         JOIN core_domains d ON d.id = a.domain_id
         LEFT JOIN core_credentials c ON c.app_id = a.id
        WHERE a.app_code_id = ?`,
      [appCode],
    )

    for (const row of rows) {
      const label = `${row.domain} (${row.member_id})`
      try {
        if (!row.spa_id) {
          summary.skippedNoSpa++
          console.warn(
            `- ${label}: sem item no SPA 1060 — rode o backfill de spa_id no hub-core e repita`,
          )
          continue
        }
        const exists = await db.installation.findUnique({
          where: { appCode_memberId: { appCode, memberId: row.member_id } },
        })
        if (exists) {
          summary.skippedExisting++
          continue
        }

        const hasCredential = Boolean(
          row.refresh_token && row.access_token && row.expires_at,
        )
        const active = row.status === 'ACTIVE' || row.status === 'TRIAL'
        const status = active && hasCredential ? 'ACTIVE' : 'UNINSTALLED'
        if (status === 'UNINSTALLED') summary.uninstalled++

        const id = Number(row.spa_id)
        if (apply) {
          await db.$transaction(async tx => {
            await tx.installation.create({
              data: {
                id,
                appCode,
                memberId: row.member_id,
                domain: normalizeBitrixDomain(row.domain),
                status,
                spaItemId: id,
                contact: { email: row.email },
                trialUsed: true,
                everActivated: true,
                installedAt: row.installed_at,
                activatedAt: row.installed_at,
                uninstalledAt: status === 'UNINSTALLED' ? new Date() : null,
              },
            })
            if (status === 'ACTIVE') {
              await tx.credential.create({
                data: {
                  installationId: id,
                  accessTokenEnc: cipher.encrypt(
                    hubDecrypt(
                      row.access_token as string,
                      process.env.HUB_CORE_TOKEN_ENCRYPTION_KEY,
                    ),
                  ),
                  refreshTokenEnc: cipher.encrypt(
                    hubDecrypt(
                      row.refresh_token as string,
                      process.env.HUB_CORE_TOKEN_ENCRYPTION_KEY,
                    ),
                  ),
                  expiresAt: row.expires_at as Date,
                  refreshFailures: row.refresh_failed_attempts ?? 0,
                },
              })
            }
          })
        }
        summary.imported++
        console.log(
          `${apply ? '+' : '~'} ${label} → installationId ${id} (${status})`,
        )
      } catch (error) {
        summary.errors++
        console.error(
          `! ${label}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } finally {
    await hub.end()
    await db.$disconnect()
  }
  console.log(`\n${apply ? 'APLICADO' : 'DRY-RUN (use --apply)'}:`, summary)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
