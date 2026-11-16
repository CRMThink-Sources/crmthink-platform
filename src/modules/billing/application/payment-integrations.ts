import type { Clock } from '@/shared/clock'
import { generatePaymentKey, hashApiKey } from '@/shared/crypto/api-key'
import { forbidden, notFound, unauthorized } from '@/shared/http/errors'
import type { Db } from '@/shared/infra/prisma'

/** Quantos caracteres da chave aparecem na lista, só para identificá-la. */
const KEY_PREFIX_LENGTH = 8

/** O que o operador vê: nunca a chave nem o hash. */
export type PaymentIntegrationView = {
  id: number
  name: string
  keyPrefix: string
  active: boolean
  lastUsedAt: Date | null
  createdAt: Date
}

type Row = {
  id: number
  name: string
  keyPrefix: string
  active: boolean
  lastUsedAt: Date | null
  createdAt: Date
}

const view = (row: Row): PaymentIntegrationView => ({
  id: row.id,
  name: row.name,
  keyPrefix: row.keyPrefix,
  active: row.active,
  lastUsedAt: row.lastUsedAt,
  createdAt: row.createdAt,
})

const missing = () =>
  notFound(
    'PAYMENT_INTEGRATION_NOT_FOUND',
    'Integração de pagamento não encontrada',
  )

/**
 * Integrações que avisam pagamentos (`POST /webhooks/payments`). Cada uma tem a própria
 * chave, que só existe como hash (SHA-256: 256 bits aleatórios dispensam hash lento) e só
 * é devolvida na criação e na rotação. A rotação invalida a chave anterior na hora.
 */
export class PaymentIntegrations {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<PaymentIntegrationView[]> {
    const rows = await this.db.paymentIntegration.findMany({
      orderBy: { id: 'asc' },
    })
    return rows.map(view)
  }

  async create(
    name: string,
  ): Promise<{ integration: PaymentIntegrationView; apiKey: string }> {
    const apiKey = generatePaymentKey()
    const row = await this.db.paymentIntegration.create({
      data: {
        name: name.trim(),
        keyHash: hashApiKey(apiKey),
        keyPrefix: apiKey.slice(0, KEY_PREFIX_LENGTH),
      },
    })
    return { integration: view(row), apiKey }
  }

  async update(
    id: number,
    patch: { name?: string; active?: boolean },
  ): Promise<PaymentIntegrationView> {
    await this.get(id)
    const row = await this.db.paymentIntegration.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      },
    })
    return view(row)
  }

  async rotateKey(
    id: number,
  ): Promise<{ integration: PaymentIntegrationView; apiKey: string }> {
    await this.get(id)
    const apiKey = generatePaymentKey()
    const row = await this.db.paymentIntegration.update({
      where: { id },
      data: {
        keyHash: hashApiKey(apiKey),
        keyPrefix: apiKey.slice(0, KEY_PREFIX_LENGTH),
      },
    })
    return { integration: view(row), apiKey }
  }

  /** Resolve a chave de um aviso de pagamento: 401 se desconhecida, 403 se desativada. */
  async authenticate(apiKey: string): Promise<PaymentIntegrationView> {
    if (!apiKey) throw unauthorized('Chave de integração ausente')
    const row = await this.db.paymentIntegration.findUnique({
      where: { keyHash: hashApiKey(apiKey) },
    })
    if (!row) throw unauthorized('Chave de integração inválida')
    if (!row.active)
      throw forbidden('INTEGRATION_INACTIVE', 'Integração desativada')
    const used = await this.db.paymentIntegration.update({
      where: { id: row.id },
      data: { lastUsedAt: this.clock.now() },
    })
    return view(used)
  }

  private async get(id: number): Promise<Row> {
    const row = await this.db.paymentIntegration.findUnique({ where: { id } })
    if (!row) throw missing()
    return row
  }
}
