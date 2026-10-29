import z from 'zod'
import {
  BILLING_EVENT_TYPES,
  INSTALLATION_EVENT_TYPES,
  type EventType,
} from '@/modules/events/domain/event'
import { SESSION_COOKIE } from '@/modules/backoffice/http/cookies'
import { roleOf } from '@/modules/backoffice/http/policy'
import { ERROR_CATALOG, type ErrorCode } from '../errors'
import {
  EVENT_DATA,
  eventEnvelopeSchema,
  installerPayloadSchema,
  SIGNATURE_DESCRIPTION,
} from './events'
import {
  ADMIN_TAG,
  OPERATIONS,
  type Named,
  type Operation,
  type Security,
  type Tag,
} from './operations'

/**
 * Monta o documento OpenAPI 3.1 a partir de `OPERATIONS`, dos schemas zod e do
 * catálogo de erros. Saída determinística: mesma entrada, mesmos bytes.
 */

export type Audience = 'public' | 'admin'
type Json = Record<string, unknown>

export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z
      .string()
      .describe('Código estável; decida por ele, nunca pela mensagem'),
    message: z.string().optional(),
    details: z
      .unknown()
      .optional()
      .describe('Em `VALIDATION_ERROR`: `[{ path, message }]`'),
  }),
})

const ERROR_REF = 'Error'
const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` })

const TAGS: Array<{ name: Tag; description: string }> = [
  {
    name: 'Instalação',
    description: 'Instalação do app no Bitrix24 e eventos de instalação',
  },
  { name: 'Sessão', description: 'Login do iframe: JWT da plataforma e JWKS' },
  {
    name: 'Tokens',
    description: 'Instalações do app e cofre de tokens do Bitrix',
  },
  {
    name: 'Cobrança',
    description: 'Planos, assinaturas, checkout, portal e itens',
  },
  {
    name: 'Webhooks recebidos',
    description: 'Chamadas do Stripe e do portal CRMThink',
  },
  { name: 'Infraestrutura', description: 'Saúde, métricas e este contrato' },
  { name: ADMIN_TAG, description: 'Rotas de operador (`ADMIN_API_TOKENS`)' },
]

const INFO_DESCRIPTION = `API da plataforma CRMThink: instalação no Bitrix24, cofre de tokens, sessão do iframe e cobrança (Stripe + SPAs) para as aplicações.

**Erros** seguem sempre \`{ "error": { "code", "message", "details"? } }\`. Decida pelo \`code\`.

**Rastreio**: toda resposta leva \`X-Request-Id\` (o enviado pelo cliente, ou um gerado). Informe-o ao reportar problemas.

**Eventos** para o app estão na seção *Webhooks*. Guia de integração: \`docs/apps-integration.md\`.`

const SECURITY_SCHEMES: Json = {
  appApiKey: {
    type: 'http',
    scheme: 'bearer',
    description:
      'Chave de API do app (`Authorization: Bearer <apiKey>`). Emitida no cadastro e na rotação; vale só para as instalações do próprio app.',
  },
  adminSession: {
    type: 'apiKey',
    in: 'cookie',
    name: SESSION_COOKIE,
    description:
      'Sessão de operador do backoffice, criada em `POST /admin/auth/login` (e-mail, senha e TOTP). Mutações exigem `Origin` de `BACKOFFICE_ORIGINS`.',
  },
  adminToken: {
    type: 'http',
    scheme: 'bearer',
    description:
      'Credencial de script (`ADMIN_API_TOKENS`), vale como papel `operator` e aparece na auditoria como `token:<prefixo>`. Nunca a chave de um app.',
  },
  stripeSignature: {
    type: 'apiKey',
    in: 'header',
    name: 'Stripe-Signature',
    description:
      'Assinatura do Stripe sobre o corpo cru (`STRIPE_WEBHOOK_SECRET`).',
  },
}

/** Traduz `Date` (ex.: `z.coerce.date()`) para string `date-time`. */
function jsonSchemas(
  entries: Named[],
  io: 'input' | 'output',
): Record<string, Json> {
  const registry = z.registry<{ id: string }>()
  const seen = new Map<z.ZodType, string>()
  for (const { id, schema } of entries) {
    const existing = seen.get(schema)
    if (existing && existing !== id) {
      throw new Error(`schema registrado com dois nomes: ${existing} e ${id}`)
    }
    if (existing) continue
    seen.set(schema, id)
    registry.add(schema, { id })
  }
  const out = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
    uri: id => `#/components/schemas/${id}`,
    override: ctx => {
      const def = (
        ctx.zodSchema as unknown as { _zod: { def: { type: string } } }
      )._zod.def
      const schema = ctx.jsonSchema
      if (def.type === 'date') {
        schema.type = 'string'
        schema.format = 'date-time'
      }
      // O `format` já diz tudo; a regex que o zod gera só pesa no arquivo.
      if (schema.format && schema.pattern) delete schema.pattern
      // Limites implícitos de `.int()` (inteiro seguro do JS) não informam nada.
      if (schema.minimum === Number.MIN_SAFE_INTEGER) delete schema.minimum
      if (schema.maximum === Number.MAX_SAFE_INTEGER) delete schema.maximum
    },
  }) as { schemas: Record<string, Json> }
  const result: Record<string, Json> = {}
  for (const [id, schema] of Object.entries(out.schemas)) {
    const { $schema: _s, $id: _i, ...rest } = schema
    result[id] = rest
  }
  return result
}

const eventSchemaId = (type: EventType) =>
  `${type
    .split(/[._]/)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join('')}Event`

export const EVENT_TYPES: EventType[] = [
  ...INSTALLATION_EVENT_TYPES,
  ...BILLING_EVENT_TYPES,
]

function eventSchemas(): Named[] {
  return EVENT_TYPES.map(type => ({
    id: eventSchemaId(type),
    schema: eventEnvelopeSchema(type, EVENT_DATA[type].data),
  }))
}

function errorCodesOf(
  operation: Operation,
): Array<{ code: ErrorCode; status: number }> {
  const codes: Array<ErrorCode | [ErrorCode, number]> = []
  if (operation.security === 'appApiKey')
    codes.push('UNAUTHORIZED', 'APP_INACTIVE')
  if (operation.security === 'admin') {
    const role = roleOf(operation.method, operation.path)
    codes.push('UNAUTHORIZED')
    if (role !== 'self') codes.push('PASSWORD_CHANGE_REQUIRED')
    if (role === 'operator') codes.push('FORBIDDEN_ROLE')
    if (operation.method !== 'get') codes.push('ORIGIN_NOT_ALLOWED')
  }
  if (
    (operation.body && operation.body.contentType === undefined) ||
    // Query das listagens de operador é validada (filtros, `limit`, `cursor`).
    (operation.security === 'admin' && operation.query?.length)
  )
    codes.push('VALIDATION_ERROR')
  codes.push(...(operation.errors ?? []))
  const result = new Map<ErrorCode, number>()
  for (const entry of codes) {
    const [code, status] = Array.isArray(entry)
      ? entry
      : [entry, ERROR_CATALOG[entry].status]
    result.set(code, status)
  }
  return [...result].map(([code, status]) => ({ code, status }))
}

/** Códigos declarados, com o status em que cada um sai. Usado pela checagem de contrato. */
export function declaredErrors(operation: Operation): Map<string, number> {
  return new Map(
    errorCodesOf(operation).map(({ code, status }) => [code, status]),
  )
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Proibido',
  404: 'Não encontrado',
  409: 'Conflito',
  410: 'Removido',
  422: 'Não processável',
  429: 'Muitas requisições',
  502: 'Falha em serviço externo',
  503: 'Indisponível',
}

function errorResponses(operation: Operation): Json {
  const byStatus = new Map<number, ErrorCode[]>()
  for (const { code, status } of errorCodesOf(operation)) {
    byStatus.set(status, [...(byStatus.get(status) ?? []), code])
  }
  const responses: Json = {}
  for (const status of [...byStatus.keys()].sort((a, b) => a - b)) {
    const codes = byStatus.get(status)!
    responses[String(status)] = {
      description: [
        STATUS_TEXT[status] ?? 'Erro',
        ...codes.map(code => `- \`${code}\`: ${ERROR_CATALOG[code].meaning}`),
      ].join('\n'),
      'x-error-codes': codes,
      content: {
        'application/json': {
          schema: ref(ERROR_REF),
          examples: Object.fromEntries(
            codes.map(code => [
              code,
              {
                value: {
                  error: { code, message: ERROR_CATALOG[code].meaning },
                },
              },
            ]),
          ),
        },
      },
    }
  }
  return responses
}

function securityOf(security: Security): Json[] {
  if (security === 'none') return []
  if (security === 'admin') return [{ adminSession: [] }, { adminToken: [] }]
  return [{ [security]: [] }]
}

const ROLE_TEXT = {
  public: 'sem autenticação',
  self: 'qualquer sessão de operador',
  viewer: '`viewer` (leitura)',
  operator: '`operator`',
} as const

/** Descrição com o papel mínimo da política (`backoffice/http/policy.ts`). */
function descriptionOf(operation: Operation): string | undefined {
  const role =
    operation.security === 'admin'
      ? roleOf(operation.method, operation.path)
      : null
  const parts = [
    operation.description,
    role ? `**Papel mínimo:** ${ROLE_TEXT[role]}.` : undefined,
  ].filter(Boolean)
  return parts.length ? parts.join('\n\n') : undefined
}

function parametersOf(operation: Operation): Json[] {
  const params: Json[] = []
  for (const [name, description] of Object.entries(
    operation.pathParams ?? {},
  )) {
    params.push({
      name,
      in: 'path',
      required: true,
      description,
      // `{eventId}` é o id do Stripe (`evt_...`), texto; os demais `*id` são numéricos.
      schema:
        /id$/i.test(name) && name !== 'eventId'
          ? { type: 'integer', minimum: 1 }
          : { type: 'string' },
    })
  }
  for (const query of operation.query ?? []) {
    params.push({
      name: query.name,
      in: 'query',
      required: query.required ?? false,
      description: query.description,
      schema: {
        type: query.type ?? 'string',
        ...(query.enum ? { enum: query.enum } : {}),
      },
    })
  }
  return params
}

function operationObject(operation: Operation): Json {
  const responses: Json = {}
  for (const status of Object.keys(operation.responses)
    .map(Number)
    .sort((a, b) => a - b)) {
    const doc = operation.responses[status]!
    const contentType = doc.contentType ?? 'application/json'
    responses[String(status)] = {
      description: doc.description,
      ...(doc.schema || contentType !== 'application/json'
        ? {
            content: {
              [contentType]: doc.schema ? { schema: ref(doc.schema.id) } : {},
            },
          }
        : {}),
    }
  }
  Object.assign(responses, errorResponses(operation))

  const params = parametersOf(operation)
  return {
    operationId: operation.operationId,
    tags: [operation.tag],
    summary: operation.summary,
    ...(descriptionOf(operation)
      ? { description: descriptionOf(operation) }
      : {}),
    security: securityOf(operation.security),
    ...(params.length ? { parameters: params } : {}),
    ...(operation.body
      ? {
          requestBody: {
            required: operation.body.required ?? true,
            ...(operation.body.description
              ? { description: operation.body.description }
              : {}),
            content: {
              [operation.body.contentType ?? 'application/json']: {
                schema: ref(operation.body.schema.id),
              },
            },
          },
        }
      : {}),
    responses,
  }
}

const SIGNATURE_HEADERS: Json[] = [
  {
    name: 'X-Platform-Signature',
    in: 'header',
    required: true,
    description: SIGNATURE_DESCRIPTION,
    schema: { type: 'string' },
  },
]

function webhooks(): Json {
  const result: Json = {}
  for (const type of EVENT_TYPES) {
    result[type] = {
      post: {
        operationId: `event.${type}`,
        tags: ['Eventos'],
        summary: EVENT_DATA[type].summary,
        description:
          'Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.',
        parameters: [
          ...SIGNATURE_HEADERS,
          {
            name: 'X-Platform-Event-Id',
            in: 'header',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'X-Platform-Event-Type',
            in: 'header',
            required: true,
            schema: { type: 'string', const: type },
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ref(eventSchemaId(type)) } },
        },
        responses: {
          '2XX': {
            description:
              'Recebido. Qualquer outra resposta, ou timeout, gera reenvio.',
          },
        },
      },
    }
  }
  result.installer = {
    post: {
      operationId: 'installer',
      tags: ['Eventos'],
      summary: 'Instalador do app (chamada síncrona durante a instalação)',
      description:
        'Entregue em `POST <installerUrl>` durante `POST /v1/install`, assinado como os eventos. O app faz os próprios binds no portal usando `GET /v1/installations/{id}/token` e responde 2xx. Falha ou timeout (`INSTALLER_TIMEOUT_MS`) deixa a instalação em `INSTALL_PENDING` até o retry.',
      parameters: SIGNATURE_HEADERS,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: ref('InstallerPayload') } },
      },
      responses: { '2XX': { description: 'Instalação do app concluída' } },
    },
  }
  return result
}

function collectRefs(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into)
    return
  }
  if (!node || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      into.add(value.replace('#/components/schemas/', ''))
    } else {
      collectRefs(value, into)
    }
  }
}

/** Só os componentes alcançáveis a partir de `roots` (o público não leva schemas de operador). */
function prune(
  schemas: Record<string, Json>,
  roots: unknown,
): Record<string, Json> {
  const reachable = new Set<string>()
  collectRefs(roots, reachable)
  const queue = [...reachable]
  while (queue.length) {
    const id = queue.pop()!
    const found = new Set<string>()
    collectRefs(schemas[id], found)
    for (const next of found) {
      if (!reachable.has(next)) {
        reachable.add(next)
        queue.push(next)
      }
    }
  }
  return Object.fromEntries(
    Object.keys(schemas)
      .filter(id => reachable.has(id))
      .sort()
      .map(id => [id, schemas[id]!]),
  )
}

export function operationsFor(audience: Audience): Operation[] {
  return audience === 'admin'
    ? OPERATIONS
    : OPERATIONS.filter(operation => operation.tag !== ADMIN_TAG)
}

export function buildOpenApi(options: {
  audience: Audience
  serverUrl?: string
}): Json {
  const operations = operationsFor(options.audience)

  const paths: Record<string, Json> = {}
  for (const operation of [...operations].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    paths[operation.path] = {
      ...paths[operation.path],
      [operation.method]: operationObject(operation),
    }
  }

  const inputs = OPERATIONS.flatMap(operation =>
    operation.body ? [operation.body.schema] : [],
  )
  const outputs = [
    { id: ERROR_REF, schema: errorEnvelopeSchema },
    { id: 'InstallerPayload', schema: installerPayloadSchema },
    ...OPERATIONS.flatMap(operation =>
      Object.values(operation.responses).flatMap(doc =>
        doc.schema ? [doc.schema] : [],
      ),
    ),
    ...eventSchemas(),
  ]
  const input = jsonSchemas(inputs, 'input')
  const output = jsonSchemas(outputs, 'output')
  for (const id of Object.keys(input)) {
    if (id in output) throw new Error(`componente duplicado: ${id}`)
  }

  const hooks = webhooks()
  const tags = TAGS.filter(tag =>
    operations.some(operation => operation.tag === tag.name),
  )

  return {
    openapi: '3.1.0',
    info: {
      title:
        options.audience === 'admin'
          ? 'CRMThink Platform API (completa, com operador)'
          : 'CRMThink Platform API',
      version: '1.0.0',
      description: INFO_DESCRIPTION,
    },
    servers: [
      options.serverUrl
        ? { url: options.serverUrl }
        : {
            url: 'https://{host}',
            description: 'Host da plataforma no ambiente (`PUBLIC_BASE_URL`)',
            variables: {
              host: { default: 'platform-staging.crmthink.com.br' },
            },
          },
    ],
    tags: [
      ...tags,
      { name: 'Eventos', description: 'Chamadas da plataforma para o app' },
    ],
    paths,
    webhooks: hooks,
    components: {
      securitySchemes: Object.fromEntries(
        Object.entries(SECURITY_SCHEMES).filter(
          ([name]) =>
            options.audience === 'admin' ||
            (name !== 'adminToken' && name !== 'adminSession'),
        ),
      ),
      schemas: prune(
        { ...input, ...output },
        { paths, hooks, error: ref(ERROR_REF) },
      ),
    },
  }
}

export const serializeOpenApi = (document: Json): string =>
  `${JSON.stringify(document, null, 2)}\n`
