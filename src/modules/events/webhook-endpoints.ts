import z from 'zod'
import type { Clock } from '@/shared/clock'
import { generateWebhookSecret } from '@/shared/crypto/api-key'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { badRequest, notFound, unprocessable } from '@/shared/http/errors'
import type { Db } from '@/shared/infra/prisma'
import type { AppRegistry } from '@/modules/registry/app-registry'
import { ALL_EVENT_TYPES, type EventType } from './domain/event'

const MAX_URL_LENGTH = 500

const dedupe = <T>(items: T[]): T[] => [...new Set(items)]

const eventTypes = z
  .array(z.enum(ALL_EVENT_TYPES))
  .min(1, 'Escolha ao menos um tipo de evento')
  .transform(dedupe)

const appCodes = z
  .array(z.string().trim().min(1).max(100))
  .max(100)
  .transform(dedupe)

const name = z.string().trim().min(1).max(200)

export const createWebhookEndpointSchema = z.strictObject({
  name,
  url: z
    .string()
    .trim()
    .min(1)
    .describe('URL HTTPS que recebe os eventos (até 500 caracteres)'),
  eventTypes: eventTypes.describe('Tipos de evento desejados'),
  appCodes: appCodes
    .default([])
    .describe('Apps de interesse; vazio = todos os apps'),
})

export const updateWebhookEndpointSchema = z
  .strictObject({
    name: name.optional(),
    url: z.string().trim().min(1).optional(),
    eventTypes: eventTypes.optional(),
    appCodes: appCodes.optional(),
    active: z.boolean().optional(),
  })
  .refine(body => Object.keys(body).length > 0, {
    message: 'Informe ao menos um campo para alterar',
  })

export type CreateWebhookEndpoint = z.output<typeof createWebhookEndpointSchema>
export type UpdateWebhookEndpoint = z.output<typeof updateWebhookEndpointSchema>

/** O que o operador vê: nunca o segredo. */
export type WebhookEndpointView = {
  id: number
  name: string
  url: string
  eventTypes: EventType[]
  appCodes: string[]
  active: boolean
  createdAt: Date
  updatedAt: Date
}

type Row = {
  id: number
  name: string
  url: string
  eventTypes: unknown
  appCodes: unknown
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const view = (row: Row): WebhookEndpointView => ({
  id: row.id,
  name: row.name,
  url: row.url,
  eventTypes: row.eventTypes as EventType[],
  appCodes: row.appCodes as string[],
  active: row.active,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const missing = () =>
  notFound(
    'WEBHOOK_ENDPOINT_NOT_FOUND',
    'Destinatário de eventos não encontrado',
  )

const notAllowed = (message: string) =>
  unprocessable('WEBHOOK_URL_NOT_ALLOWED', message)

/** IPv4 em endereço que não é de destino público: reservado, privado, loopback ou link-local. */
function isInternalIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const [a = 0, b = 0] = match.slice(1).map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

/** IPv6 literal (sem colchetes) de loopback, privado, link-local ou IPv4 mapeado. */
function isInternalIpv6(host: string): boolean {
  if (!host.includes(':')) return false
  const value = host.toLowerCase()
  return (
    value === '::' ||
    value === '::1' ||
    value.startsWith('::ffff:') ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    /^fe[89ab]/.test(value)
  )
}

/**
 * URL de destinatário: `https`, até 500 caracteres, sem usuário e senha e sem host
 * interno **informado como IP literal** (`new URL` já normaliza `2130706433` e formas
 * parecidas para `127.0.0.1`). Não resolve DNS: um nome público que aponte para um IP
 * interno passa. Quem cadastra é `operator` e a ação é auditada.
 */
export function assertWebhookUrl(raw: string): void {
  if (raw.length > MAX_URL_LENGTH)
    throw notAllowed(`A URL deve ter até ${MAX_URL_LENGTH} caracteres`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw notAllowed('A URL não é válida')
  }
  if (url.protocol !== 'https:') throw notAllowed('A URL deve usar HTTPS')
  if (url.username || url.password)
    throw notAllowed('A URL não pode conter usuário e senha')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost'))
    throw notAllowed('A URL não pode apontar para localhost')
  if (isInternalIpv4(host) || isInternalIpv6(host))
    throw notAllowed('A URL não pode apontar para um endereço interno')
}

type Deps = {
  db: Db
  cipher: TokenCipher
  registry: AppRegistry
  clock: Clock
  /** Quanto o segredo anterior continua valendo depois de uma rotação. */
  rotationGraceMs: number
}

/**
 * Destinatários de eventos (ERP, financeiro...). Cada um tem o próprio segredo de
 * assinatura, cifrado em repouso: devolvido só na criação e na rotação (que mantém o
 * anterior válido pela convivência de credenciais).
 */
export class WebhookEndpoints {
  constructor(private readonly deps: Deps) {}

  async list(): Promise<WebhookEndpointView[]> {
    const rows = await this.deps.db.webhookEndpoint.findMany({
      orderBy: { id: 'asc' },
    })
    return rows.map(view)
  }

  async get(id: number): Promise<WebhookEndpointView> {
    return view(await this.row(id))
  }

  async create(
    input: CreateWebhookEndpoint,
  ): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    assertWebhookUrl(input.url)
    await this.assertAppsExist(input.appCodes)
    const secret = generateWebhookSecret()
    const row = await this.deps.db.webhookEndpoint.create({
      data: {
        name: input.name,
        url: input.url,
        secretEnc: this.deps.cipher.encrypt(secret),
        eventTypes: input.eventTypes,
        appCodes: input.appCodes,
      },
    })
    return { endpoint: view(row), secret }
  }

  async update(
    id: number,
    patch: UpdateWebhookEndpoint,
  ): Promise<WebhookEndpointView> {
    await this.row(id)
    if (patch.url !== undefined) assertWebhookUrl(patch.url)
    if (patch.appCodes) await this.assertAppsExist(patch.appCodes)
    const row = await this.deps.db.webhookEndpoint.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.eventTypes ? { eventTypes: patch.eventTypes } : {}),
        ...(patch.appCodes ? { appCodes: patch.appCodes } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      },
    })
    return view(row)
  }

  async rotateSecret(id: number): Promise<{
    endpoint: WebhookEndpointView
    secret: string
    previousValidUntil: Date
  }> {
    const current = await this.row(id)
    const secret = generateWebhookSecret()
    const previousValidUntil = new Date(
      this.deps.clock.now().getTime() + this.deps.rotationGraceMs,
    )
    const row = await this.deps.db.webhookEndpoint.update({
      where: { id },
      data: {
        secretEnc: this.deps.cipher.encrypt(secret),
        previousSecretEnc: current.secretEnc,
        previousSecretUntil: previousValidUntil,
      },
    })
    return { endpoint: view(row), secret, previousValidUntil }
  }

  /** Segredos vigentes para assinar: o atual e, durante a convivência, o anterior. */
  async secrets(id: number): Promise<string[]> {
    const row = await this.row(id)
    const secrets = [this.deps.cipher.decrypt(row.secretEnc)]
    if (
      row.previousSecretEnc &&
      row.previousSecretUntil &&
      row.previousSecretUntil > this.deps.clock.now()
    ) {
      secrets.push(this.deps.cipher.decrypt(row.previousSecretEnc))
    }
    return secrets
  }

  private async row(id: number) {
    const row = await this.deps.db.webhookEndpoint.findUnique({ where: { id } })
    if (!row) throw missing()
    return row
  }

  private async assertAppsExist(appCodes: string[]): Promise<void> {
    for (const appCode of appCodes) {
      if (!(await this.deps.registry.get(appCode)))
        throw badRequest(
          'WEBHOOK_APP_UNKNOWN',
          `O app ${appCode} não está cadastrado`,
        )
    }
  }
}
