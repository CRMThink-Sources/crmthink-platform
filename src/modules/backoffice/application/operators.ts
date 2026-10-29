import z from 'zod'
import { Prisma } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { generateTotpSecret, totpUri } from '@/shared/crypto/totp'
import { badRequest, conflict, HttpError, notFound } from '@/shared/http/errors'
import {
  emailSchema,
  passwordSchema,
  roleSchema,
  type IssuedAccess,
  type OperatorRole,
  type OperatorView,
} from '../domain/operator'
import {
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from './passwords'

export const createOperatorSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(200),
  role: roleSchema,
})

export const updateOperatorSchema = z
  .object({ role: roleSchema, active: z.boolean() })
  .partial()
  .refine(value => value.role !== undefined || value.active !== undefined, {
    message: 'Informe role ou active',
  })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
})

export type CreateOperatorInput = z.infer<typeof createOperatorSchema>
export type UpdateOperatorInput = z.infer<typeof updateOperatorSchema>

type OperatorRow = Prisma.AdminOperatorGetPayload<object>

export function toOperatorView(row: OperatorRow): OperatorView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as OperatorRole,
    active: row.active,
    mustChangePassword: row.mustChangePassword,
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas')

/**
 * Contas de operador do backoffice. Não há cadastro público: a primeira conta nasce
 * pelo script (`yarn admin:create-operator`) e as demais por um `operator`.
 *
 * Senha provisória e segredo TOTP saem só na resposta da criação/redefinição; depois
 * existem apenas como hash argon2id e segredo cifrado.
 */
export class OperatorService {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly totpIssuer: string,
    /** Revoga as sessões abertas da conta (todas, ou todas menos `exceptSessionId`). */
    private readonly revokeSessions: (
      operatorId: number,
      exceptSessionId?: number,
    ) => Promise<void>,
  ) {}

  async list(): Promise<OperatorView[]> {
    const rows = await this.db.adminOperator.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toOperatorView)
  }

  async get(id: number): Promise<OperatorRow> {
    const row = await this.db.adminOperator.findUnique({ where: { id } })
    if (!row) throw notFound('OPERATOR_NOT_FOUND', 'Operador não encontrado')
    return row
  }

  async create(input: CreateOperatorInput): Promise<IssuedAccess> {
    const data = createOperatorSchema.parse(input)
    const access = await this.newAccess(data.email)
    try {
      const row = await this.db.adminOperator.create({
        data: {
          email: data.email,
          name: data.name,
          role: data.role,
          passwordHash: access.passwordHash,
          totpSecretEnc: access.totpSecretEnc,
          mustChangePassword: true,
        },
      })
      return this.issued(row, access)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw conflict(
          'OPERATOR_EMAIL_TAKEN',
          'Já existe um operador com este e-mail',
        )
      }
      throw error
    }
  }

  /**
   * Troca papel e/ou estado. Nunca deixa zero `operator` ativos e não deixa o operador
   * desativar nem rebaixar a própria conta. Qualquer mudança derruba as sessões da conta.
   */
  async update(
    id: number,
    input: UpdateOperatorInput,
    actingOperatorId: number | null,
  ): Promise<OperatorView> {
    const change = updateOperatorSchema.parse(input)
    const row = await this.get(id)
    const nextRole = change.role ?? (row.role as OperatorRole)
    const nextActive = change.active ?? row.active
    const losesOperator =
      row.role === 'operator' &&
      row.active &&
      (nextRole !== 'operator' || !nextActive)

    if (losesOperator) {
      const others = await this.db.adminOperator.count({
        where: { role: 'operator', active: true, id: { not: id } },
      })
      if (others === 0) {
        throw conflict(
          'LAST_OPERATOR',
          'Deve existir ao menos um operator ativo',
        )
      }
    }
    if (
      actingOperatorId === id &&
      (!nextActive || (row.role === 'operator' && nextRole !== 'operator'))
    ) {
      throw conflict(
        'OPERATOR_SELF_CHANGE',
        'Não é possível desativar nem rebaixar a própria conta',
      )
    }

    const updated = await this.db.adminOperator.update({
      where: { id },
      data: {
        role: nextRole,
        active: nextActive,
        // Reativar libera a conta de um bloqueio antigo.
        ...(nextActive && !row.active
          ? { failedLogins: 0, lockedUntil: null }
          : {}),
      },
    })
    if (nextRole !== row.role || nextActive !== row.active) {
      await this.revokeSessions(id)
    }
    return toOperatorView(updated)
  }

  /** Nova senha provisória e novo TOTP (ex.: perdeu o celular). Derruba as sessões e desbloqueia. */
  async resetAccess(id: number): Promise<IssuedAccess> {
    const row = await this.get(id)
    const access = await this.newAccess(row.email)
    const updated = await this.db.adminOperator.update({
      where: { id },
      data: {
        passwordHash: access.passwordHash,
        totpSecretEnc: access.totpSecretEnc,
        lastTotpStep: 0,
        mustChangePassword: true,
        failedLogins: 0,
        lockedUntil: null,
      },
    })
    await this.revokeSessions(id)
    return this.issued(updated, access)
  }

  /** Troca da própria senha. Mantém a sessão atual e derruba as outras. */
  async changePassword(
    id: number,
    input: z.input<typeof changePasswordSchema>,
    currentSessionId?: number,
  ): Promise<OperatorView> {
    const { currentPassword, newPassword } = changePasswordSchema.parse(input)
    const row = await this.get(id)
    if (!(await verifyPassword(row.passwordHash, currentPassword))) {
      throw invalidCredentials()
    }
    if (currentPassword === newPassword) {
      throw badRequest(
        'VALIDATION_ERROR',
        'A nova senha deve ser diferente da atual',
        [
          {
            path: 'newPassword',
            message: 'A nova senha deve ser diferente da atual',
          },
        ],
      )
    }
    const updated = await this.db.adminOperator.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      },
    })
    await this.revokeSessions(id, currentSessionId)
    return toOperatorView(updated)
  }

  private async newAccess(email: string) {
    const temporaryPassword = generateTemporaryPassword()
    const secret = generateTotpSecret()
    return {
      temporaryPassword,
      passwordHash: await hashPassword(temporaryPassword),
      totpSecretEnc: this.cipher.encrypt(secret),
      totpUri: totpUri({ secret, account: email, issuer: this.totpIssuer }),
    }
  }

  private issued(
    row: OperatorRow,
    access: { temporaryPassword: string; totpUri: string },
  ): IssuedAccess {
    return {
      operator: toOperatorView(row),
      temporaryPassword: access.temporaryPassword,
      totpUri: access.totpUri,
    }
  }
}
