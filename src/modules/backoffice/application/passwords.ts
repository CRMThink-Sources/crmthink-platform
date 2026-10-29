import { randomBytes } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

/**
 * Senhas de operador: argon2id com o mínimo recomendado pela OWASP. O hash (PHC)
 * carrega os parâmetros, então subir `PARAMS` depois só exige rehash no próximo login
 * (`needsRehash`).
 */

const ARGON2ID = 2
export const PARAMS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID, ...PARAMS })
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | null = null

/**
 * Verificação contra um hash fixo, para o login com e-mail inexistente levar o mesmo
 * tempo que um com e-mail válido e não revelar quais contas existem.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  await verifyPassword(await dummyHash, password)
}

export function needsRehash(passwordHash: string): boolean {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(
    passwordHash,
  )
  if (!match) return true
  return (
    Number(match[1]) !== PARAMS.memoryCost ||
    Number(match[2]) !== PARAMS.timeCost ||
    Number(match[3]) !== PARAMS.parallelism
  )
}

/** Senha provisória: 18 caracteres base64url (~108 bits). */
export function generateTemporaryPassword(): string {
  return randomBytes(14).toString('base64url').slice(0, 18)
}
