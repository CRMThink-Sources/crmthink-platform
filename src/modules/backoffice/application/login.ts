import z from 'zod'
import { Prisma } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { generateTotpSecret, totpUri, verifyTotp } from '@/shared/crypto/totp'
import type { RateCounter } from '@/shared/infra/rate-counter'
import { HttpError, TooManyRequestsError } from '@/shared/http/errors'
import { metrics } from '@/shared/observability/metrics'
import { emailSchema, type OperatorView } from '../domain/operator'
import type { AdminAudit } from './audit'
import type { LoginChallenges } from './login-challenges'
import { invalidCredentials, toOperatorView } from './operators'
import {
  burnPasswordCheck,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './passwords'
import type { AdminSessions } from './sessions'
import type { TrustedDevices } from './trusted-devices'

export const loginSchema = z.object({
  email: z.string().max(255),
  password: z.string().max(200),
})

export const totpSchema = z.object({
  challenge: z.string().min(1).max(200),
  code: z.string().max(10),
  rememberDevice: z.boolean().default(false),
})

export const LOGIN_WINDOW_MS = 15 * 60_000
export const MAX_ACCOUNT_FAILURES = 5
export const MAX_IP_ATTEMPTS = 20
export const LOCK_MS = 15 * 60_000

export type LoginMeta = {
  ip: string | null
  userAgent: string | null
  requestId: string | null
}

/** Resultado da primeira etapa: falta o código, falta cadastrar o autenticador ou já entrou. */
export type LoginStep =
  | { step: 'totp'; challenge: string; trustedDeviceDays: number }
  | {
      step: 'totp-setup'
      challenge: string
      secret: string
      otpauthUri: string
      trustedDeviceDays: number
    }
  | {
      step: 'authenticated'
      operator: OperatorView
      token: string
      expiresAt: Date
    }

export type VerifyResult = {
  operator: OperatorView
  token: string
  sessionId: number
  expiresAt: Date
  /** Só quando o operador pediu para lembrar o navegador. */
  device?: { token: string; expiresAt: Date }
}

type OperatorRow = Prisma.AdminOperatorGetPayload<object>

type FailureReason =
  'unknown_account' | 'inactive' | 'locked' | 'bad_password' | 'bad_totp'

export const challengeExpired = () =>
  new HttpError(
    401,
    'CHALLENGE_EXPIRED',
    'O tempo para digitar o código acabou. Entre de novo.',
  )

/**
 * Login do backoffice em duas etapas. `login` confere e-mail e senha (argon2id) e devolve
 * um desafio; `verifyCode` confere o código TOTP do desafio e abre a sessão. Conta sem
 * autenticador recebe o segredo no desafio e só o grava quando o primeiro código fecha.
 * Toda falha de credencial sai como o mesmo `INVALID_CREDENTIALS` — o motivo real só vai
 * para a auditoria.
 *
 * Limites (janela de 15 min): mais de 20 tentativas por IP (somando as duas etapas) → 429;
 * 5 falhas seguidas na mesma conta (senha ou código) → conta bloqueada por 15 min (até
 * credenciais corretas falham).
 */
export class LoginService {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly sessions: AdminSessions,
    private readonly counters: RateCounter,
    private readonly audit: AdminAudit,
    private readonly clock: Clock,
    private readonly challenges: LoginChallenges,
    private readonly devices: TrustedDevices,
    private readonly totpIssuer: string,
  ) {}

  async login(
    input: unknown,
    meta: LoginMeta,
    deviceToken: string | null,
  ): Promise<LoginStep> {
    await this.limitByIp(meta)

    const body = loginSchema.parse(input)
    const email = emailSchema.safeParse(body.email)
    const normalized = email.success
      ? email.data
      : body.email.trim().toLowerCase()
    const operator = email.success
      ? await this.db.adminOperator.findUnique({ where: { email: email.data } })
      : null
    const now = this.clock.now()

    if (!operator) {
      await burnPasswordCheck(body.password)
      return this.fail(null, normalized, 'unknown_account', meta)
    }

    const passwordOk = await verifyPassword(
      operator.passwordHash,
      body.password,
    )
    if (!operator.active)
      return this.fail(operator, normalized, 'inactive', meta)
    if (operator.lockedUntil && operator.lockedUntil > now) {
      return this.fail(operator, normalized, 'locked', meta)
    }
    if (!passwordOk) {
      return this.fail(operator, normalized, 'bad_password', meta)
    }
    if (needsRehash(operator.passwordHash)) {
      await this.db.adminOperator.update({
        where: { id: operator.id },
        data: { passwordHash: await hashPassword(body.password) },
      })
    }

    const trustedDeviceDays = this.devices.enabled ? this.devices.days : 0

    if (
      operator.totpSecretEnc &&
      (await this.devices.isTrusted(deviceToken, operator.id))
    ) {
      await this.counters.reset(this.accountKey(operator.email))
      const updated = await this.db.adminOperator.update({
        where: { id: operator.id },
        data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
      })
      const session = await this.openSession(operator, meta, {
        // Não chamar de `totp`: `maskSummary` mascara toda chave com esse nome.
        secondFactor: 'skipped_trusted_device',
      })
      return {
        step: 'authenticated',
        operator: toOperatorView(updated),
        token: session.token,
        expiresAt: session.expiresAt,
      }
    }

    if (operator.totpSecretEnc) {
      const challenge = await this.challenges.create(operator.id)
      return { step: 'totp', challenge, trustedDeviceDays }
    }

    const secret = generateTotpSecret()
    const challenge = await this.challenges.create(operator.id, secret)
    return {
      step: 'totp-setup',
      challenge,
      secret,
      otpauthUri: totpUri({
        secret,
        account: operator.email,
        issuer: this.totpIssuer,
      }),
      trustedDeviceDays,
    }
  }

  async verifyCode(input: unknown, meta: LoginMeta): Promise<VerifyResult> {
    await this.limitByIp(meta)

    const body = totpSchema.parse(input)
    const challenge = await this.challenges.peek(body.challenge)
    if (!challenge) throw challengeExpired()

    const operator = await this.db.adminOperator.findUnique({
      where: { id: challenge.operatorId },
    })
    if (!operator) {
      await this.challenges.consume(body.challenge)
      return this.fail(null, '', 'unknown_account', meta)
    }
    if (!operator.active) {
      await this.challenges.consume(body.challenge)
      return this.fail(operator, operator.email, 'inactive', meta)
    }
    if (operator.lockedUntil && operator.lockedUntil > this.clock.now()) {
      return this.fail(operator, operator.email, 'locked', meta)
    }

    const setup = challenge.setupSecret !== undefined
    const secret =
      challenge.setupSecret ??
      (operator.totpSecretEnc
        ? this.cipher.decrypt(operator.totpSecretEnc)
        : null)
    if (secret === null) {
      await this.challenges.consume(body.challenge)
      throw challengeExpired()
    }

    const now = this.clock.now()
    const step = verifyTotp(
      secret,
      body.code.trim(),
      now,
      operator.lastTotpStep,
    )
    if (step === null) {
      await this.challenges.fail(body.challenge)
      return this.fail(operator, operator.email, 'bad_totp', meta)
    }

    // Reivindica o passo (e, no cadastro, o segredo) numa escrita condicional: dois pedidos
    // com o mesmo código, ou dois cadastros abertos, não passam os dois.
    const claimed = await this.db.adminOperator.updateMany({
      where: {
        id: operator.id,
        lastTotpStep: { lt: step },
        ...(setup ? { totpSecretEnc: null } : {}),
      },
      data: {
        lastTotpStep: step,
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: now,
        ...(setup ? { totpSecretEnc: this.cipher.encrypt(secret) } : {}),
      },
    })
    if (claimed.count === 0) {
      if (setup) {
        await this.challenges.consume(body.challenge)
        throw challengeExpired()
      }
      await this.challenges.fail(body.challenge)
      return this.fail(operator, operator.email, 'bad_totp', meta)
    }

    await this.challenges.consume(body.challenge)
    await this.counters.reset(this.accountKey(operator.email))
    if (setup) {
      await this.audit.record({
        ...this.auditBase(meta),
        actor: `operator:${operator.id}`,
        actorRole: operator.role,
        action: 'auth.totp_configured',
        targetType: 'operator',
        targetId: String(operator.id),
        statusCode: 200,
      })
    }

    const device =
      body.rememberDevice && this.devices.enabled
        ? await this.devices.trust(operator.id, meta)
        : undefined
    const session = await this.openSession(
      operator,
      meta,
      device ? { rememberDevice: true } : undefined,
    )
    const updated = await this.db.adminOperator.findUnique({
      where: { id: operator.id },
    })
    return { operator: toOperatorView(updated!), ...session, device }
  }

  private async openSession(
    operator: OperatorRow,
    meta: LoginMeta,
    summary?: Record<string, unknown>,
  ) {
    const session = await this.sessions.create(operator.id, meta)
    await this.audit.record({
      ...this.auditBase(meta),
      actor: `operator:${operator.id}`,
      actorRole: operator.role,
      action: 'auth.login_succeeded',
      targetType: 'operator',
      targetId: String(operator.id),
      statusCode: 200,
      summary: summary ?? null,
    })
    return session
  }

  private async limitByIp(meta: LoginMeta): Promise<void> {
    const ipHit = await this.counters.hit(
      `login:ip:${meta.ip ?? 'unknown'}`,
      LOGIN_WINDOW_MS,
    )
    if (ipHit.count > MAX_IP_ATTEMPTS) {
      metrics.adminLoginFailures.inc({ reason: 'ip_limit' })
      throw new TooManyRequestsError(Math.ceil(ipHit.resetMs / 1000))
    }
  }

  private accountKey(email: string) {
    return `login:acct:${email}`
  }

  private async fail(
    operator: { id: number; email: string; role: string } | null,
    email: string,
    reason: FailureReason,
    meta: LoginMeta,
  ): Promise<never> {
    metrics.adminLoginFailures.inc({ reason })
    await this.audit.record({
      ...this.auditBase(meta),
      actor: 'anonymous',
      action: 'auth.login_failed',
      targetType: operator ? 'operator' : null,
      targetId: operator ? String(operator.id) : null,
      statusCode: 401,
      errorCode: 'INVALID_CREDENTIALS',
      summary: { email, accountExists: operator !== null, reason },
    })

    // Bloqueio só conta tentativas contra conta ativa e ainda não bloqueada.
    if (operator && (reason === 'bad_password' || reason === 'bad_totp')) {
      const hit = await this.counters.hit(
        this.accountKey(operator.email),
        LOGIN_WINDOW_MS,
      )
      const locked = hit.count >= MAX_ACCOUNT_FAILURES
      await this.db.adminOperator.update({
        where: { id: operator.id },
        data: {
          failedLogins: hit.count,
          ...(locked
            ? {
                lockedUntil: new Date(this.clock.now().getTime() + LOCK_MS),
              }
            : {}),
        },
      })
      if (locked) {
        await this.counters.reset(this.accountKey(operator.email))
        metrics.adminLoginFailures.inc({ reason: 'account_locked' })
        await this.audit.record({
          ...this.auditBase(meta),
          actor: 'anonymous',
          action: 'auth.account_locked',
          targetType: 'operator',
          targetId: String(operator.id),
          summary: { email, failures: hit.count },
        })
      }
    }
    throw invalidCredentials()
  }

  private auditBase(meta: LoginMeta) {
    return {
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    }
  }
}
