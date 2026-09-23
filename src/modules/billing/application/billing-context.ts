import { conflict, notFound } from '@/shared/http/errors'
import { withLock, type LockStore } from '@/shared/infra/redis'
import type {
  InstallationDirectory,
  InstallationView,
} from '@/modules/installations/ports'
import type { Subscription } from '../domain/entities'
import type { SubscriptionRepository } from '../infra/spa/subscription-repository'

/**
 * Peças comuns aos casos de uso do billing: resolver a instalação do app (404 para
 * a de outro app) e serializar decisões por instalação.
 *
 * O lock por instalação é o que torna seguro processar em paralelo webhooks do
 * Stripe, eventos do SPA, varreduras e chamadas dos apps: duas decisões sobre a mesma
 * assinatura nunca leem o mesmo estado ao mesmo tempo.
 */
export class BillingContext {
  constructor(
    readonly installations: InstallationDirectory,
    readonly subscriptions: SubscriptionRepository,
    private readonly locks: LockStore,
  ) {}

  async ownedInstallation(
    appCode: string,
    installationId: number,
  ): Promise<InstallationView> {
    const installation = await this.installations.get(installationId)
    if (
      !installation ||
      installation.appCode !== appCode ||
      installation.spaItemId === null
    ) {
      throw notFound('INSTALLATION_NOT_FOUND')
    }
    return installation
  }

  /** Assinatura do app (via instalação dona do parent), ou 404. */
  async ownedSubscription(
    appCode: string,
    subscriptionId: number,
  ): Promise<{ installation: InstallationView; subscription: Subscription }> {
    const subscription = await this.subscriptions.get(subscriptionId)
    if (!subscription) throw notFound('SUBSCRIPTION_NOT_FOUND')
    const installation = await this.installations.findBySpaItemId(
      subscription.installationSpaItemId,
    )
    if (!installation || installation.appCode !== appCode)
      throw notFound('SUBSCRIPTION_NOT_FOUND')
    return { installation, subscription }
  }

  async installationOf(
    subscription: Subscription,
  ): Promise<InstallationView | null> {
    return this.installations.findBySpaItemId(
      subscription.installationSpaItemId,
    )
  }

  withInstallationLock<T>(
    installationId: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withLock(
      this.locks,
      `billing:installation:${installationId}`,
      { ttlMs: 60_000, waitMs: 30_000 },
      fn,
    ).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'LockTimeoutError') {
        throw conflict(
          'BILLING_BUSY',
          'Outra operação de cobrança desta instalação está em andamento',
        )
      }
      throw error
    })
  }
}
