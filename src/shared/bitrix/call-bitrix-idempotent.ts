import { logger } from '@/shared/observability/logger'
import { isBitrixApiError } from './bitrix-errors'
import type { BitrixCaller, BitrixParams } from './bitrix-rest.client'

/**
 * Códigos que significam "este registro já existe no portal". Por **código**, nunca
 * por trecho da mensagem (localizada). Portado de `call-bitrix-idempotent.ts` do
 * hub-core — ver lá o histórico de cada código.
 */
export const IDEMPOTENT_ERROR_CODES = new Set([
  'ERROR_EVENT_BINDING_EXISTS',
  'ERROR_HANDLER_ALREADY_BINDED',
  'ERROR_PLACEMENT_ALREADY_BINDED',
  'ERROR_PLACEMENT_ALREADY_BOUND',
  'ERROR_ACTIVITY_ALREADY_INSTALLED',
  'ERROR_ACTIVITY_ALREADY_EXISTS',
  'ERROR_CONNECTOR_ALREADY_EXISTS',
  'CONNECTOR_ALREADY_EXIST',
  'ERROR_FIELD_ALREADY_EXISTS',
])

/** Rede de segurança quando o código não está na lista (não cobre portal em russo). */
const IDEMPOTENT_MESSAGE_MARKERS = [
  'already binded',
  'already bound',
  'already exist',
  'already installed',
  'duplicate',
]

function idempotentCodeOf(error: unknown): string | null {
  if (!isBitrixApiError(error)) return null
  const code = error.code.toUpperCase()
  if (IDEMPOTENT_ERROR_CODES.has(code)) return code
  const text = `${error.description ?? ''} ${error.message}`.toLowerCase()
  return IDEMPOTENT_MESSAGE_MARKERS.some(marker => text.includes(marker))
    ? code
    : null
}

/**
 * Executa um registro no portal tratando "já existe" como sucesso — o que permite a
 * instalação ser fail-fast sem quebrar reinstalação. Qualquer outro erro propaga.
 */
export async function callBitrixIdempotent(
  client: BitrixCaller,
  method: string,
  params: BitrixParams,
): Promise<void> {
  try {
    await client.call(method, params)
  } catch (error) {
    const code = isBitrixApiError(error) ? error.code : null
    logger().warn({ method, code, err: error }, 'bitrix install call failed')
    const idempotentCode = idempotentCodeOf(error)
    if (!idempotentCode) throw error
    logger().info(
      { method, code: idempotentCode },
      'bitrix install call already applied, skipping',
    )
  }
}
