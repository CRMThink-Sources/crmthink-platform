import z from 'zod'
import { Prisma } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import type { Clock } from '@/shared/clock'
import {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
} from '@/shared/crypto/api-key'
import { badRequest, conflict, notFound } from '@/shared/http/errors'
import {
  installThemeSchema,
  type AppSecrets,
  type RegisteredApp,
} from './domain/app'

/**
 * Cadastro das aplicações consumidoras (`app` + `app_product`).
 *
 * Chave de API e segredo de webhook são gerados aqui e devolvidos **uma única vez**:
 * a chave só existe como hash; o segredo, o `client_secret` do app Bitrix e o
 * anterior (na rotação) ficam cifrados.
 */

const appCodeSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,99}$/,
    'appCode inválido (ex.: crmthink.gptmaker)',
  )

export const createAppSchema = z.object({
  appCode: appCodeSchema,
  name: z.string().min(1).max(200),
  logoUrl: z.string().url().nullish(),
  installTheme: installThemeSchema.nullish(),
  bitrixClientId: z.string().min(1),
  bitrixClientSecret: z.string().min(1),
  bitrixAppCode: z.string().min(1).max(200).nullish(),
  scopes: z.array(z.string().min(1)).default([]),
  installerUrl: z.string().url().nullish(),
  webhookUrl: z.string().url().nullish(),
  productSpaIds: z.array(z.number().int().positive()).default([]),
  trialDays: z.number().int().min(0).max(365).default(0),
  trialOnInstall: z.boolean().default(false),
  trialPlanId: z.number().int().positive().nullish(),
  active: z.boolean().default(true),
})

export const updateAppSchema = createAppSchema
  .omit({ appCode: true, bitrixClientSecret: true })
  .partial()
  .extend({ bitrixClientSecret: z.string().min(1).optional() })

export type CreateAppInput = z.infer<typeof createAppSchema>
export type UpdateAppInput = z.infer<typeof updateAppSchema>

type AppRow = Prisma.AppGetPayload<{ include: { products: true } }>

function toRegisteredApp(row: AppRow): RegisteredApp {
  const theme = installThemeSchema.safeParse(row.installTheme)
  return {
    appCode: row.appCode,
    name: row.name,
    logoUrl: row.logoUrl,
    installTheme: row.installTheme && theme.success ? theme.data : null,
    bitrixClientId: row.bitrixClientId,
    bitrixAppCode: row.bitrixAppCode,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    installerUrl: row.installerUrl,
    webhookUrl: row.webhookUrl,
    trialDays: row.trialDays,
    trialOnInstall: row.trialOnInstall,
    trialPlanId: row.trialPlanId,
    productSpaIds: row.products.map(product => product.productSpaId),
    active: row.active,
  }
}

function assertTrialConfig(input: {
  trialOnInstall?: boolean
  trialDays?: number
  trialPlanId?: number | null
}): void {
  if (input.trialOnInstall && (!input.trialDays || !input.trialPlanId)) {
    throw badRequest(
      'TRIAL_CONFIG_INVALID',
      '`trial_on_install` exige `trialDays` > 0 e `trialPlanId` (plano de trial no SPA 1138)',
    )
  }
}

export type IssuedCredentials = { apiKey: string; webhookSecret: string }

export class AppRegistry {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly clock: Clock,
    private readonly rotationGraceMs: number,
  ) {}

  async get(appCode: string): Promise<RegisteredApp | null> {
    const row = await this.db.app.findUnique({
      where: { appCode },
      include: { products: true },
    })
    return row ? toRegisteredApp(row) : null
  }

  async getOrThrow(appCode: string): Promise<RegisteredApp> {
    const app = await this.get(appCode)
    if (!app) throw notFound('APP_NOT_FOUND', `App ${appCode} não cadastrado`)
    return app
  }

  async list(): Promise<RegisteredApp[]> {
    const rows = await this.db.app.findMany({
      include: { products: true },
      orderBy: { appCode: 'asc' },
    })
    return rows.map(toRegisteredApp)
  }

  /** App dono da chave (atual, ou anterior dentro da transição). */
  async findByApiKey(apiKey: string): Promise<RegisteredApp | null> {
    const hash = hashApiKey(apiKey)
    const row = await this.db.app.findFirst({
      where: {
        OR: [
          { apiKeyHash: hash },
          {
            previousApiKeyHash: hash,
            previousApiKeyUntil: { gt: this.clock.now() },
          },
        ],
      },
      include: { products: true },
    })
    return row ? toRegisteredApp(row) : null
  }

  async secrets(appCode: string): Promise<AppSecrets> {
    const row = await this.db.app.findUnique({ where: { appCode } })
    if (!row) throw notFound('APP_NOT_FOUND')
    const webhookSecrets = [this.cipher.decrypt(row.webhookSecretEnc)]
    if (
      row.previousWebhookSecretEnc &&
      row.previousWebhookSecretUntil &&
      row.previousWebhookSecretUntil > this.clock.now()
    ) {
      webhookSecrets.push(this.cipher.decrypt(row.previousWebhookSecretEnc))
    }
    return {
      bitrixClientSecret: this.cipher.decrypt(row.bitrixClientSecretEnc),
      webhookSecrets,
    }
  }

  async create(
    input: CreateAppInput,
  ): Promise<{ app: RegisteredApp; credentials: IssuedCredentials }> {
    assertTrialConfig(input)
    const existing = await this.db.app.findUnique({
      where: { appCode: input.appCode },
    })
    if (existing) throw conflict('APP_ALREADY_EXISTS')
    await this.assertClientIdFree(input.bitrixClientId, input.appCode)

    const apiKey = generateApiKey()
    const webhookSecret = generateWebhookSecret()

    const row = await this.db.app.create({
      data: {
        appCode: input.appCode,
        name: input.name,
        logoUrl: input.logoUrl ?? null,
        installTheme: input.installTheme ?? undefined,
        bitrixClientId: input.bitrixClientId,
        bitrixClientSecretEnc: this.cipher.encrypt(input.bitrixClientSecret),
        bitrixAppCode: input.bitrixAppCode ?? null,
        scopes: input.scopes,
        installerUrl: input.installerUrl ?? null,
        webhookUrl: input.webhookUrl ?? null,
        webhookSecretEnc: this.cipher.encrypt(webhookSecret),
        apiKeyHash: hashApiKey(apiKey),
        trialDays: input.trialDays,
        trialOnInstall: input.trialOnInstall,
        trialPlanId: input.trialPlanId ?? null,
        active: input.active,
        products: {
          create: input.productSpaIds.map(productSpaId => ({ productSpaId })),
        },
      },
      include: { products: true },
    })

    return { app: toRegisteredApp(row), credentials: { apiKey, webhookSecret } }
  }

  async update(appCode: string, input: UpdateAppInput): Promise<RegisteredApp> {
    const current = await this.getOrThrow(appCode)
    if (input.bitrixClientId) {
      await this.assertClientIdFree(input.bitrixClientId, appCode)
    }
    assertTrialConfig({
      trialOnInstall: input.trialOnInstall ?? current.trialOnInstall,
      trialDays: input.trialDays ?? current.trialDays,
      trialPlanId:
        input.trialPlanId === undefined
          ? current.trialPlanId
          : input.trialPlanId,
    })

    const row = await this.db.$transaction(async tx => {
      if (input.productSpaIds) {
        await tx.appProduct.deleteMany({ where: { appCode } })
        await tx.appProduct.createMany({
          data: input.productSpaIds.map(productSpaId => ({
            appCode,
            productSpaId,
          })),
        })
      }
      return tx.app.update({
        where: { appCode },
        data: {
          name: input.name,
          logoUrl: input.logoUrl,
          installTheme:
            input.installTheme === null
              ? Prisma.DbNull
              : (input.installTheme ?? undefined),
          bitrixClientId: input.bitrixClientId,
          bitrixClientSecretEnc: input.bitrixClientSecret
            ? this.cipher.encrypt(input.bitrixClientSecret)
            : undefined,
          bitrixAppCode: input.bitrixAppCode,
          scopes: input.scopes,
          installerUrl: input.installerUrl,
          webhookUrl: input.webhookUrl,
          trialDays: input.trialDays,
          trialOnInstall: input.trialOnInstall,
          trialPlanId: input.trialPlanId,
          active: input.active,
        },
        include: { products: true },
      })
    })
    return toRegisteredApp(row)
  }

  /** O client_id é único: um app Bitrix pertence a um só cadastro. */
  private async assertClientIdFree(
    bitrixClientId: string,
    appCode: string,
  ): Promise<void> {
    const owner = await this.db.app.findUnique({ where: { bitrixClientId } })
    if (owner && owner.appCode !== appCode) {
      throw conflict(
        'BITRIX_CLIENT_ID_IN_USE',
        `client_id já cadastrado em ${owner.appCode}`,
      )
    }
  }

  /**
   * Nova chave de API. A anterior continua aceita até o fim do período de transição,
   * para o app trocar a variável sem janela de indisponibilidade.
   */
  async rotateApiKey(
    appCode: string,
  ): Promise<{ apiKey: string; previousValidUntil: Date }> {
    const row = await this.db.app.findUnique({ where: { appCode } })
    if (!row) throw notFound('APP_NOT_FOUND')
    const apiKey = generateApiKey()
    const previousValidUntil = new Date(
      this.clock.now().getTime() + this.rotationGraceMs,
    )
    await this.db.app.update({
      where: { appCode },
      data: {
        apiKeyHash: hashApiKey(apiKey),
        previousApiKeyHash: row.apiKeyHash,
        previousApiKeyUntil: previousValidUntil,
      },
    })
    return { apiKey, previousValidUntil }
  }

  /**
   * Novo segredo de webhook. Durante a transição as entregas levam as duas
   * assinaturas (`v1=` por segredo); depois, só a nova.
   */
  async rotateWebhookSecret(
    appCode: string,
  ): Promise<{ webhookSecret: string; previousValidUntil: Date }> {
    const row = await this.db.app.findUnique({ where: { appCode } })
    if (!row) throw notFound('APP_NOT_FOUND')
    const webhookSecret = generateWebhookSecret()
    const previousValidUntil = new Date(
      this.clock.now().getTime() + this.rotationGraceMs,
    )
    await this.db.app.update({
      where: { appCode },
      data: {
        webhookSecretEnc: this.cipher.encrypt(webhookSecret),
        previousWebhookSecretEnc: row.webhookSecretEnc,
        previousWebhookSecretUntil: previousValidUntil,
      },
    })
    return { webhookSecret, previousValidUntil }
  }

  /** Apps donos de um produto do SPA 1134. */
  async appsForProduct(productSpaId: number): Promise<string[]> {
    const rows = await this.db.appProduct.findMany({ where: { productSpaId } })
    return rows.map(row => row.appCode)
  }
}
