import z from 'zod'

/**
 * Operador do backoffice. `viewer` (suporte) só lê; `operator` (dev) lê e age.
 * Tokens de `ADMIN_API_TOKENS` valem como `operator` (ver `actor.ts`).
 */
export const OPERATOR_ROLES = ['viewer', 'operator'] as const
export type OperatorRole = (typeof OPERATOR_ROLES)[number]

export const roleSchema = z.enum(OPERATOR_ROLES)

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(255))

export const PASSWORD_MIN_LENGTH = 12
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200)

/** O que sai do serviço: nunca hash, segredo ou contadores internos de login. */
export type OperatorView = {
  id: number
  email: string
  name: string
  role: OperatorRole
  active: boolean
  mustChangePassword: boolean
  lockedUntil: string | null
  lastLoginAt: string | null
  createdAt: string
}

/** Senha provisória e TOTP novos: aparecem só na resposta da criação/redefinição. */
export type IssuedAccess = {
  operator: OperatorView
  temporaryPassword: string
  totpUri: string
}

/** Nome no app autenticador: deixa homologação e produção lado a lado sem confusão. */
export function totpIssuer(environment: 'production' | 'homolog'): string {
  return environment === 'production'
    ? 'CRMThink Backoffice'
    : 'CRMThink Backoffice (homolog)'
}
