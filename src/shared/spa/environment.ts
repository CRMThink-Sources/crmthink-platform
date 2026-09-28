import type { PlatformEnvironment } from '@/config/env'
import type { SpaConfig } from '@/config/spa-config'

/**
 * Campo **Ambiente** dos SPAs 1060/1142/1146 (D11): o portal é único para produção e
 * homologação, e cada instância só enxerga o próprio ambiente.
 *
 * Item sem ambiente conta como `production`, para o comercial não precisar preencher
 * em assinatura manual real; item de teste tem que ser marcado `homolog`.
 */
export class SpaEnvironment {
  constructor(
    readonly current: PlatformEnvironment,
    private readonly values: SpaConfig['environmentValues'],
  ) {}

  /** Valor a gravar no campo. */
  get writeValue(): string {
    return this.values[this.current]
  }

  /** Ambiente de um valor lido (id de enum ou rótulo). */
  resolve(raw: unknown): PlatformEnvironment {
    if (raw === undefined || raw === null || raw === '') return 'production'
    const value =
      typeof raw === 'string' || typeof raw === 'number'
        ? String(raw)
        : JSON.stringify(raw)
    if (value === this.values.homolog || value.toLowerCase() === 'homolog') {
      return 'homolog'
    }
    return 'production'
  }

  /** O item é deste ambiente? */
  owns(item: Record<string, unknown>, field: string): boolean {
    return this.resolve(item[field]) === this.current
  }
}
