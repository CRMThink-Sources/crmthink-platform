import type { InstallationStatus } from '@/prisma/client'

/**
 * Fronteira entre os módulos (D1): o `billing` só enxerga a instalação por esta
 * porta, e o `installations` só aciona o billing pelo `TrialStarter`.
 */

export type InstallationView = {
  installationId: number
  appCode: string
  memberId: string
  domain: string
  status: InstallationStatus
  /** Item atual do SPA 1060; `null` se foi removido à mão (desvinculado). */
  spaItemId: number | null
  trialUsed: boolean
  contact: InstallationContact | null
}

/**
 * Contato do cliente. A instalação não coleta dados (regra do marketplace do Bitrix):
 * vem da solicitação de trial feita pelo app ou, nas instalações migradas, do hub-core.
 */
export type InstallationContact = {
  email?: string
  name?: string
  phone?: string
  company?: string
  role?: string
}

export interface InstallationDirectory {
  get(installationId: number): Promise<InstallationView | null>
  findBySpaItemId(spaItemId: number): Promise<InstallationView | null>
  markTrialUsed(installationId: number): Promise<void>
  /** Substitui o contato inteiro: vale o último informado. */
  saveContact(
    installationId: number,
    contact: InstallationContact,
  ): Promise<void>
}

export interface TrialStarter {
  /** Cria o trial se a instalação nunca usou. Idempotente. */
  startTrialOnInstall(installationId: number): Promise<void>
}
