import 'dotenv/config'
import z from 'zod'

/**
 * Configuração do processo, validada uma vez no boot.
 *
 * Tudo que é segredo obrigatório (chave de cifragem, banco, Redis) falha aqui, antes
 * de o processo aceitar tráfego: subir sem chave de cifragem gravaria token em texto
 * puro, e descobrir isso só na primeira instalação é tarde.
 */

export type PlatformEnvironment = 'production' | 'homolog'

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform(value =>
      value === undefined || value === '' ? fallback : value === 'true',
    )

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform(value =>
      value === undefined || value === '' ? fallback : Number(value),
    )
    .pipe(z.number().int())

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: int(4100),
  LOG_LEVEL: z.string().default('info'),
  LOKI_URL: z.string().optional().default(''),

  /** URL pública da plataforma (sem barra final). Base da página de instalação, dos handlers e do `iss` do JWT. */
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .transform(value => value.replace(/\/+$/, '')),
  PLATFORM_ENVIRONMENT: z.enum(['production', 'homolog']),

  DATABASE_URL: z.string().optional().default(''),
  DATABASE_HOST: z.string().optional().default(''),
  DATABASE_PORT: int(3306),
  DATABASE_USER: z.string().optional().default(''),
  DATABASE_PASSWORD: z.string().optional().default(''),
  DATABASE_NAME: z.string().optional().default(''),

  REDIS_URL: z.string().min(1),
  QUEUE_PREFIX: z.string().default('crmthink-platform'),

  /** AES-256-GCM, 32 bytes em base64. Obrigatória: sem ela nada é gravado. */
  TOKEN_ENCRYPTION_KEY: z
    .string({ error: 'TOKEN_ENCRYPTION_KEY não configurada' })
    .min(1, 'TOKEN_ENCRYPTION_KEY não configurada')
    .refine(value => Buffer.from(value, 'base64').length === 32, {
      message: 'TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64',
    }),

  /**
   * Chave privada RSA (PEM) usada só para semear o primeiro `signing_key` quando o
   * banco não tem nenhuma ativa. Depois disso a rotação é pelo endpoint administrativo.
   */
  JWT_SIGNING_PRIVATE_KEY: z
    .string()
    .optional()
    .default('')
    .transform(value => value.replace(/\\n/g, '\n')),
  JWT_ISSUER: z.string().optional().default(''),
  JWT_TTL_SECONDS: int(15 * 60),

  /** Credenciais de operador (separadas por vírgula) para rotas administrativas. */
  ADMIN_API_TOKENS: z
    .string()
    .optional()
    .default('')
    .transform(value =>
      value
        .split(',')
        .map(token => token.trim())
        .filter(Boolean),
    ),

  /** `appCode=https://a,https://b;appCode2=https://c` */
  SESSION_CORS_ORIGINS: z.string().optional().default(''),

  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),

  /** Webhook de entrada do portal CRMThink (REST dos SPAs). */
  CRMTHINK_WEBHOOK_URL: z.string().optional().default(''),
  /** `application_token` do webhook de saída do portal CRMThink (eventos dos SPAs). */
  CRMTHINK_APPLICATION_TOKEN: z.string().optional().default(''),
  /** Caminho de um JSON que sobrescreve IDs de SPA, campos e enums (ver `spa-config.ts`). */
  SPA_CONFIG_FILE: z.string().optional().default(''),

  BITRIX_TLS_REJECT_UNAUTHORIZED: bool(true),
  INSTALLER_TIMEOUT_MS: int(60_000),
  WEBHOOK_TIMEOUT_MS: int(10_000),
  CREDENTIAL_ROTATION_GRACE_HOURS: int(24),
  EVENT_RETRY_WINDOW_HOURS: int(24),
  /** Desliga crons do worker (útil em teste local). */
  WORKER_DISABLE_SCHEDULES: bool(false),
})

export type Env = ReturnType<typeof buildEnv>

function databaseUrl(raw: z.infer<typeof schema>): string {
  if (raw.DATABASE_URL) return raw.DATABASE_URL
  if (!raw.DATABASE_HOST || !raw.DATABASE_NAME) return ''
  const user = encodeURIComponent(raw.DATABASE_USER)
  const password = encodeURIComponent(raw.DATABASE_PASSWORD)
  return `mysql://${user}:${password}@${raw.DATABASE_HOST}:${raw.DATABASE_PORT}/${raw.DATABASE_NAME}`
}

/**
 * `sk_live_`/`rk_live_` ⇒ conta de produção. Derivado da própria chave para que o
 * price id lido e a conta chamada não possam divergir (mesma regra do hub-core).
 */
export function resolveStripeEnvironment(
  secretKey: string | undefined,
): PlatformEnvironment {
  return /^(sk|rk)_live_/.test(secretKey ?? '') ? 'production' : 'homolog'
}

/** `appCode=https://a,https://b;outro=https://c` → mapa appCode → origens. */
export function parseSessionCorsOrigins(raw: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const entry of raw.split(';')) {
    const [appCode, origins] = entry.split('=')
    if (!appCode?.trim() || !origins) continue
    const set = new Set(
      origins
        .split(',')
        .map(origin => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    )
    result.set(appCode.trim(), set)
  }
  return result
}

export function buildEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(issue => `${issue.path.join('.') || '(env)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Configuração inválida: ${detail}`)
  }
  const raw = parsed.data

  return {
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    lokiUrl: raw.LOKI_URL,
    publicBaseUrl: raw.PUBLIC_BASE_URL,
    platformEnvironment: raw.PLATFORM_ENVIRONMENT,
    databaseUrl: databaseUrl(raw),
    redisUrl: raw.REDIS_URL,
    queuePrefix: raw.QUEUE_PREFIX,
    tokenEncryptionKey: raw.TOKEN_ENCRYPTION_KEY,
    jwt: {
      bootstrapPrivateKey: raw.JWT_SIGNING_PRIVATE_KEY,
      issuer: raw.JWT_ISSUER || raw.PUBLIC_BASE_URL,
      ttlSeconds: raw.JWT_TTL_SECONDS,
    },
    adminApiTokens: raw.ADMIN_API_TOKENS,
    sessionCorsOrigins: parseSessionCorsOrigins(raw.SESSION_CORS_ORIGINS),
    stripe: {
      secretKey: raw.STRIPE_SECRET_KEY,
      webhookSecret: raw.STRIPE_WEBHOOK_SECRET,
      environment: resolveStripeEnvironment(raw.STRIPE_SECRET_KEY),
    },
    crmthink: {
      webhookUrl: raw.CRMTHINK_WEBHOOK_URL,
      applicationToken: raw.CRMTHINK_APPLICATION_TOKEN,
    },
    spaConfigFile: raw.SPA_CONFIG_FILE,
    bitrixTlsRejectUnauthorized: raw.BITRIX_TLS_REJECT_UNAUTHORIZED,
    installerTimeoutMs: raw.INSTALLER_TIMEOUT_MS,
    webhookTimeoutMs: raw.WEBHOOK_TIMEOUT_MS,
    credentialRotationGraceMs: raw.CREDENTIAL_ROTATION_GRACE_HOURS * 3600_000,
    eventRetryWindowMs: raw.EVENT_RETRY_WINDOW_HOURS * 3600_000,
    workerDisableSchedules: raw.WORKER_DISABLE_SCHEDULES,
  }
}

let cached: Env | null = null

/** Env do processo, validada na primeira leitura. Lança com a lista de problemas. */
export function env(): Env {
  cached ??= buildEnv()
  return cached
}

/** @internal testes */
export function resetEnvForTests(): void {
  cached = null
}
