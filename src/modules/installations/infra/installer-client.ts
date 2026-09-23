import type { Fetch } from '@/shared/bitrix/bitrix-rest.client'
import {
  buildSignatureHeader,
  SIGNATURE_HEADER,
} from '@/shared/crypto/hmac-signature'
import { scrubSecrets } from '@/shared/observability/logger'

export type InstallerPayload = {
  installationId: number
  memberId: string
  domain: string
  appCode: string
  isReinstall: boolean
}

export type InstallerResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number | null; error: string }

/**
 * Chamada síncrona ao instalador do app (`POST <installer_url>`), assinada com o
 * mesmo esquema HMAC dos eventos. O app faz os próprios binds usando a API de tokens
 * durante esta chamada.
 */
export class InstallerClient {
  constructor(
    private readonly timeoutMs: number,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async call(
    url: string,
    secrets: string[],
    payload: InstallerPayload,
  ): Promise<InstallerResult> {
    const body = JSON.stringify(payload)
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: buildSignatureHeader(secrets, body),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (response.ok) return { ok: true, statusCode: response.status }
      const text = (await response.text().catch(() => '')).slice(0, 500)
      return {
        ok: false,
        statusCode: response.status,
        error: `HTTP ${response.status}${text ? `: ${text}` : ''}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return {
        ok: false,
        statusCode: null,
        error: timedOut
          ? `timeout após ${this.timeoutMs}ms`
          : scrubSecrets(message),
      }
    }
  }
}
