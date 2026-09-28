import pino, { type Logger } from 'pino'
import { getLogContext } from './log-context'

/**
 * Logs JSON (pino → stdout; → Loki quando `LOKI_URL` está definido).
 *
 * Tokens nunca vão ao log: os caminhos abaixo cobrem os nomes usados no código e nos
 * payloads do Bitrix/Stripe, e erros são reduzidos a tipo/mensagem/stack porque um
 * erro de HTTP cru carrega a URL com `auth=<token>`.
 */

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'authorization',
  'token',
  'accessToken',
  'refreshToken',
  'applicationToken',
  'access_token',
  'refresh_token',
  'application_token',
  'client_secret',
  'clientSecret',
  'secret',
  'apiKey',
  'webhookSecret',
  'privateKey',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.applicationToken',
  '*.access_token',
  '*.refresh_token',
  '*.application_token',
  '*.client_secret',
  '*.clientSecret',
  '*.secret',
  '*.apiKey',
  '*.webhookSecret',
  '*.privateKey',
]

const AUTH_IN_URL =
  /([?&](?:auth|access_token|refresh_token|client_secret)=)[^&\s"]+/gi

/** Remove credenciais que vêm embutidas em URL/mensagem de erro. */
export function scrubSecrets(text: string): string {
  return text.replace(AUTH_IN_URL, '$1[REDACTED]')
}

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      type: value.name,
      message: scrubSecrets(value.message),
      stack: value.stack ? scrubSecrets(value.stack) : undefined,
    }
  }
  return value
}

export type LoggerOptions = {
  service: 'crmthink-platform-api' | 'crmthink-platform-worker' | 'test'
  level?: string
  lokiUrl?: string
  environment?: string
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? 'info'
  const base = {
    level,
    base: { service: options.service, env: options.environment },
    mixin: () => getLogContext(),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: { err: serializeError, error: serializeError },
  }
  if (!options.lokiUrl) return pino(base)

  return pino(
    base,
    pino.transport({
      targets: [
        { target: 'pino/file', options: { destination: 1 }, level },
        {
          target: 'pino-loki',
          level,
          options: {
            host: options.lokiUrl,
            labels: {
              service: options.service,
              env: options.environment ?? '',
            },
            propsToLabels: ['appCode'],
            batching: true,
            interval: 5,
          },
        },
      ],
    }),
  )
}

let current: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  serializers: { err: serializeError, error: serializeError },
  mixin: () => getLogContext(),
})

/** Logger do processo. Configurado no boot por `configureLogger`. */
export function logger(): Logger {
  return current
}

export function configureLogger(options: LoggerOptions): Logger {
  current = createLogger(options)
  return current
}
