import z from 'zod'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { verifyTotp } from '@/shared/crypto/totp'
import type { RateCounter } from '@/shared/infra/rate-counter'
import { TooManyRequestsError } from '@/shared/http/errors'
import { metrics } from '@/shared/observability/metrics'
import { emailSchema, type OperatorView } from '../domain/operator'
import type { AdminAudit } from './audit'
import { invalidCredentials, toOperatorView } from './operators'
import {
  burnPasswordCheck,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './passwords'
import type { AdminSessions } from './sessions'

export const loginSchema = z.object({
  email: z.string().max(255),
  password: z.string().max(200),
  code: z.string().max(10),
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

export type LoginResult = {
  operator: OperatorView
  token: string
  sessionId: number
  expiresAt: Date
}

type FailureReason =
  'unknown_account' | 'inactive' | 'locked' | 'bad_password' | 'bad_totp'

/**
 * Login do backoffice: e-mail, senha (argon2id) e TOTP. Toda falha sai como o mesmo
 * `INVALID_CREDENTIALS` — o motivo real só vai para a auditoria.
 *
 * Limites (janela de 15 min): mais de 20 tentativas por IP → 429; 5 falhas seguidas
 * na mesma conta → conta bloqueada por 15 min (até credenciais corretas falham).
 */
export class LoginService {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly sessions: AdminSessions,
    private readonly counters: RateCounter,
    private readonly audit: AdminAudit,
    private readonly clock: Clock,
  ) {}

  async login(input: unknown, meta: LoginMeta): Promise<LoginResult> {
    const ipHit = await this.counters.hit(
      `login:ip:${meta.ip ?? 'unknown'}`,
      LOGIN_WINDOW_MS,
    )
    if (ipHit.count > MAX_IP_ATTEMPTS) {
      metrics.adminLoginFailures.inc({ reason: 'ip_limit' })
      throw new TooManyRequestsError(Math.ceil(ipHit.resetMs / 1000))
    }

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
    const step = verifyTotp(
      this.cipher.decrypt(operator.totpSecretEnc),
      body.code.trim(),
      now,
      operator.lastTotpStep,
    )
    if (step === null) return this.fail(operator, normalized, 'bad_totp', meta)

    await this.counters.reset(this.accountKey(operator.email))
    const updated = await this.db.adminOperator.update({
      where: { id: operator.id },
      data: {
        lastTotpStep: step,
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: now,
        ...(needsRehash(operator.passwordHash)
          ? { passwordHash: await hashPassword(body.password) }
          : {}),
      },
    })
    const session = await this.sessions.create(operator.id, meta)
    await this.audit.record({
      ...this.auditBase(meta),
      actor: `operator:${operator.id}`,
      actorRole: operator.role,
      action: 'auth.login_succeeded',
      targetType: 'operator',
      targetId: String(operator.id),
      statusCode: 200,
    })
    return { operator: toOperatorView(updated), ...session }
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
