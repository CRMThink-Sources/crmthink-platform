import type { Redis } from 'ioredis'
import type { Db } from '@/shared/infra/prisma'
import { logger } from '@/shared/observability/logger'
import type { SpaProblem } from '@/modules/billing/infra/spa/spa-field-guards'

/**
 * Estado de saúde do processo (14.1). `ready` falha (503) se banco ou Redis caem, se
 * não há chave de assinatura ativa, ou se a configuração dos SPAs não bate com o
 * portal (campo UF ausente, enum inexistente) — indicando SPA e campo.
 */
export class HealthState {
  spaProblems: SpaProblem[] = []
  spaCheckedAt: Date | null = null

  constructor(
    private readonly db: Db,
    private readonly redis: Pick<Redis, 'ping'> | null,
  ) {}

  setSpaProblems(problems: SpaProblem[]): void {
    this.spaProblems = problems
    this.spaCheckedAt = new Date()
    if (problems.length) {
      logger().error(
        { problems },
        'configuração dos SPAs incompatível com o portal CRMThink',
      )
    }
  }

  async check(): Promise<{ ok: boolean; checks: Record<string, unknown> }> {
    const checks: Record<string, unknown> = {}
    let ok = true

    try {
      await this.db.$queryRawUnsafe('SELECT 1')
      checks.database = 'ok'
    } catch (error) {
      ok = false
      checks.database = error instanceof Error ? error.message : 'erro'
    }

    if (this.redis) {
      try {
        await this.redis.ping()
        checks.redis = 'ok'
      } catch (error) {
        ok = false
        checks.redis = error instanceof Error ? error.message : 'erro'
      }
    }

    try {
      const active = await this.db.signingKey.count({
        where: { activatedAt: { lte: new Date() } },
      })
      checks.signingKey = active > 0 ? 'ok' : 'nenhuma chave ativa'
      if (!active) ok = false
    } catch {
      checks.signingKey = 'indisponível'
      ok = false
    }

    checks.spaConfig = this.spaProblems.length
      ? { ok: false, checkedAt: this.spaCheckedAt, problems: this.spaProblems }
      : { ok: true, checkedAt: this.spaCheckedAt }
    if (this.spaProblems.length) ok = false

    return { ok, checks }
  }
}
