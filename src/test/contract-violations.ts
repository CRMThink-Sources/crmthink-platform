import type { ContractViolation } from '@/docs/openapi/contract-check'

/**
 * Respostas que divergiram do contrato OpenAPI durante o teste corrente. Preenchido
 * por `http(h)` e esvaziado (com falha) no `afterEach` de `setup-env.ts`.
 */
export const contractViolations: ContractViolation[] = []

export function takeContractViolations(): ContractViolation[] {
  return contractViolations.splice(0, contractViolations.length)
}
