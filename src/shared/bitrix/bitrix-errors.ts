/**
 * Erro devolvido pela REST do Bitrix com o **código** preservado.
 *
 * `error_description` é localizada pelo idioma do portal e não serve para decidir
 * nada em código; `code` (`error`) é estável.
 */
export class BitrixApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
    readonly description: string | undefined,
    readonly httpStatus?: number,
  ) {
    super(`Bitrix ${method}: ${description ?? code}`)
    this.name = 'BitrixApiError'
  }

  get isExpiredToken(): boolean {
    return this.code.toLowerCase() === 'expired_token'
  }

  get isInvalidToken(): boolean {
    const code = this.code.toLowerCase()
    return code === 'invalid_token' || code === 'wrong_client'
  }
}

/** Bitrix fora do ar, timeout, erro de rede ou 5xx: recuperável. */
export class BitrixUnavailableError extends Error {
  constructor(
    readonly method: string,
    detail: string,
  ) {
    super(`Bitrix ${method} indisponível: ${detail}`)
    this.name = 'BitrixUnavailableError'
  }
}

export function isBitrixApiError(error: unknown): error is BitrixApiError {
  return error instanceof BitrixApiError
}
