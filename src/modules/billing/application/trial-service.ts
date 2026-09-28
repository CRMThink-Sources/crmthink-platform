import type { Clock } from '@/shared/clock'
import {
  conflict,
  HttpError,
  notFound,
  unprocessable,
} from '@/shared/http/errors'
import { logger } from '@/shared/observability/logger'
import type { AppRegistry } from '@/modules/registry/app-registry'
import type { InstallationSpa } from '@/modules/installations/infra/installation-spa'
import type {
  InstallationView,
  TrialStarter,
} from '@/modules/installations/ports'
import { isOpenSubscription, type Subscription } from '../domain/entities'
import type { BillingContext } from './billing-context'
import type { SubscriptionWriter } from './subscription-writer'

/**
 * Trial (D9): assinatura `trialing` sem gateway, uma vez por instalação, com fim em
 * agora + `trial_days` do app. Criado automaticamente quando a instalação fica
 * `ACTIVE` pela primeira vez (`trial_on_install`); a rota administrativa cobre casos
 * excepcionais. Créditos e limites do trial são do app.
 *
 * Modalidade `manual`: o comercial pode converter o trial em assinatura paga fora do
 * Stripe mudando o status no SPA.
 */
export class TrialService implements TrialStarter {
  constructor(
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly registry: AppRegistry,
    private readonly installationSpa: InstallationSpa,
    private readonly clock: Clock,
  ) {}

  async startTrialOnInstall(installationId: number): Promise<void> {
    try {
      await this.start(installationId)
    } catch (error) {
      // Reinstalação com trial usado, ou já com assinatura: nada a criar.
      if (
        error instanceof HttpError &&
        (error.code === 'TRIAL_ALREADY_USED' ||
          error.code === 'SUBSCRIPTION_ALREADY_EXISTS')
      ) {
        return
      }
      throw error
    }
  }

  /** Rota administrativa e trial automático. Lança `TRIAL_ALREADY_USED`. */
  async start(installationId: number): Promise<Subscription> {
    const installation = await this.context.installations.get(installationId)
    if (!installation || installation.spaItemId === null)
      throw notFound('INSTALLATION_NOT_FOUND')
    const app = await this.registry.getOrThrow(installation.appCode)
    if (!app.trialDays || !app.trialPlanId) {
      throw unprocessable('TRIAL_NOT_CONFIGURED', 'App sem trial configurado')
    }

    return this.context.withInstallationLock(
      installation.installationId,
      async () => {
        const fresh = (await this.context.installations.get(
          installationId,
        )) as InstallationView
        if (fresh.trialUsed)
          throw conflict('TRIAL_ALREADY_USED', 'A instalação já usou o trial')

        const current = await this.context.subscriptions.currentOf(
          fresh.spaItemId as number,
        )
        if (current && isOpenSubscription(current)) {
          // Trial criado e processo caiu antes de marcar: marca agora.
          if (current.status === 'trialing')
            await this.context.installations.markTrialUsed(fresh.installationId)
          throw conflict(
            'SUBSCRIPTION_ALREADY_EXISTS',
            'A instalação já tem assinatura vigente',
          )
        }

        const now = this.clock.now()
        const trialEndsAt = new Date(now.getTime() + app.trialDays * 86_400_000)
        const subscription = await this.writer.create(
          fresh,
          {
            title: `Trial ${app.name} — ${fresh.domain}`,
            installationSpaItemId: fresh.spaItemId as number,
            planId: app.trialPlanId as number,
            status: 'trialing',
            modality: 'manual',
            periodStart: now,
            periodEnd: trialEndsAt,
            cancelAtPeriodEnd: false,
          },
          [
            {
              type: 'subscription.trial_started',
              data: {
                trialEndsAt: trialEndsAt.toISOString(),
                trialDays: app.trialDays,
              },
              dedupeKey: `trial:${fresh.installationId}`,
            },
          ],
        )

        await this.context.installations.markTrialUsed(fresh.installationId)
        try {
          await this.installationSpa.markTrialUsed(fresh.spaItemId as number)
        } catch (error) {
          // O banco é quem impede o segundo trial; o campo no SPA é informativo.
          logger().warn(
            { err: error },
            'não foi possível marcar trial usado no SPA 1060',
          )
        }
        return subscription
      },
    )
  }

  /** Job: trials vencidos sem assinatura paga ⇒ `trial_expired` + `subscription.ended`. */
  async expireDue(): Promise<number> {
    const now = this.clock.now()
    let expired = 0
    for (const subscription of await this.context.subscriptions.listByStatus(
      'trialing',
    )) {
      if (subscription.periodEnd > now) continue
      const installation = await this.context.installationOf(subscription)
      if (!installation) continue
      await this.context.withInstallationLock(
        installation.installationId,
        async () => {
          const current = await this.context.subscriptions.get(subscription.id)
          if (
            !current ||
            current.status !== 'trialing' ||
            current.periodEnd > this.clock.now()
          )
            return
          await this.writer.update(
            installation,
            current,
            { status: 'trial_expired' },
            [
              {
                type: 'subscription.ended',
                data: { reason: 'trial_expired' },
                dedupeKey: `ended:${current.id}`,
              },
            ],
          )
          expired++
        },
      )
    }
    return expired
  }
}
