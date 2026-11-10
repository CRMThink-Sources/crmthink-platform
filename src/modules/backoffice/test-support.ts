import { expect } from 'vitest'
import { generateTotpSecret, totpCode, totpStep } from '@/shared/crypto/totp'
import { http } from '@/test/app'
import { createHarness, type Harness } from '@/test/harness'

/** Apoio dos testes HTTP do backoffice: operadores, códigos TOTP e login em duas etapas. */

export const ORIGIN = 'https://platform.test'
export const PASSWORD = 'senha-definitiva-123'
export const MINUTE = 60_000
export const SESSION_COOKIE = 'cp_admin_session'
export const DEVICE_COOKIE = 'cp_admin_device'

export function setup(env: Record<string, string> = {}) {
  return createHarness({ env: { BACKOFFICE_ORIGINS: ORIGIN, ...env } })
}

export type TestOperator = {
  id: number
  email: string
  password: string
  /** Segredo já gravado na conta; `null` quando o operador ainda não cadastrou o autenticador. */
  secret: string | null
}

/**
 * Cria o operador. `ready` (padrão) já troca a senha provisória; `enrolled` (padrão) já
 * grava um segredo TOTP, e `enrolled: false` deixa a conta no primeiro acesso.
 */
export async function operator(
  h: Harness,
  email: string,
  role: 'viewer' | 'operator',
  options: { ready?: boolean; enrolled?: boolean } = {},
): Promise<TestOperator> {
  const issued = await h.container.operators.create({
    email,
    name: email.split('@')[0]!,
    role,
  })
  const secret = options.enrolled === false ? null : generateTotpSecret()
  await h.db.asDb().adminOperator.update({
    where: { id: issued.operator.id },
    data: {
      totpSecretEnc: secret ? h.container.cipher.encrypt(secret) : null,
      lastTotpStep: 0,
    },
  })
  let password = issued.temporaryPassword
  if (options.ready !== false) {
    await h.container.operators.changePassword(issued.operator.id, {
      currentPassword: password,
      newPassword: PASSWORD,
    })
    password = PASSWORD
  }
  return { id: issued.operator.id, email, password, secret }
}

export const code = (h: Harness, secret: string) =>
  totpCode(secret, totpStep(h.clock.now()))

type Headers = { cookie?: string; origin?: string | null }

/** Primeira etapa: e-mail e senha. */
export function firstStep(
  h: Harness,
  account: { email: string; password: string },
  headers: Headers = {},
) {
  const request = http(h).post('/admin/auth/login')
  if (headers.origin !== null) request.set('Origin', headers.origin ?? ORIGIN)
  if (headers.cookie) request.set('Cookie', headers.cookie)
  return request.send({ email: account.email, password: account.password })
}

/** Segunda etapa: desafio e código. */
export function secondStep(
  h: Harness,
  body: { challenge: string; code: string; rememberDevice?: boolean },
  headers: Headers = {},
) {
  const request = http(h).post('/admin/auth/totp')
  if (headers.origin !== null) request.set('Origin', headers.origin ?? ORIGIN)
  if (headers.cookie) request.set('Cookie', headers.cookie)
  return request.send(body)
}

export function setCookies(response: { headers: Record<string, unknown> }) {
  return (response.headers['set-cookie'] as string[] | undefined) ?? []
}

/** `nome=valor` do cookie `name`, como o navegador o devolveria. */
export function cookieOf(
  response: { headers: Record<string, unknown> },
  name = SESSION_COOKIE,
): string {
  const line = setCookies(response).find(c => c.startsWith(`${name}=`))
  if (!line) throw new Error(`sem cookie ${name}`)
  return line.split(';')[0]!
}

/** Login completo (senha e código); devolve o cookie de sessão e deixa um passo TOTP novo à frente. */
export async function login(h: Harness, account: TestOperator) {
  const first = await firstStep(h, account)
  expect(first.status).toBe(200)
  const body = first.body as { step: string; challenge: string }
  expect(body.step).toBe('totp')
  const second = await secondStep(h, {
    challenge: body.challenge,
    code: code(h, account.secret!),
  })
  expect(second.status).toBe(200)
  // O próximo login precisa de um passo TOTP novo (o atual já foi usado).
  h.clock.advance(30_000)
  return cookieOf(second)
}

type OperatorModel = {
  findUnique: (args: { where?: { id?: number } }) => Promise<unknown>
}

/**
 * Segura as buscas de operador por id (as da 2ª etapa) até `parties` pedidos chegarem a
 * elas, ou até 25 ms depois da primeira (pedidos que o servidor recusa antes da busca nunca
 * chegam): força o pior intercalamento, em que todos passam pelas checagens iniciais antes
 * de qualquer um registrar uma falha ou abrir a sessão.
 */
export function holdLookups(h: Harness, parties: number) {
  const model = (h.db as unknown as { adminOperator: OperatorModel })
    .adminOperator
  const original = model.findUnique.bind(model)
  let arrived = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  model.findUnique = async args => {
    if (args.where?.id !== undefined) {
      arrived += 1
      if (arrived === 1) setTimeout(release, 25)
      if (arrived >= parties) release()
      await gate
    }
    return original(args)
  }
}

export const audit = (h: Harness) =>
  h.db.rows('adminAuditLog') as Array<Record<string, any>>
