import z from 'zod'
import { badRequest, notFound, unprocessable } from '@/shared/http/errors'
import type { Clock } from '@/shared/clock'
import type { RegisteredApp } from '@/modules/registry/domain/app'
import type { PaymentGateway } from '../ports/payment-gateway'
import type { CatalogRepository } from '../infra/spa/catalog-repository'
import type { BillingContext } from './billing-context'
import type { PlanCatalog } from './plan-catalog'
import type { SubscriptionWriter } from './subscription-writer'

export const portalRequestSchema = z.object({
  installationId: z.number().int().positive(),
  returnUrl: z.string().url(),
})

export const changePlanSchema = z.object({
  planId: z.number().int().positive(),
})

/**
 * Leituras da assinatura (`GET /v1/installations/{id}/subscription`), Customer Portal
 * e troca de plano.
 */
export class SubscriptionQueries {
  constructor(
    private readonly context: BillingContext,
    private readonly writer: SubscriptionWriter,
    private readonly catalog: CatalogRepository,
    private readonly plans: PlanCatalog,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
  ) {}

  async current(app: RegisteredApp, installationId: number) {
    const installation = await this.context.ownedInstallation(
      app.appCode,
      installationId,
    )
    const subscription = await this.context.subscriptions.currentOf(
      installation.spaItemId as number,
    )
    if (!subscription)
      throw notFound('NO_SUBSCRIPTION', 'Instalação sem assinatura vigente')
    const plan = await this.catalog.getPlan(subscription.planId)
    const version = await this.writer.currentVersion(subscription.id)
    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      modality: subscription.modality,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            interval: plan.interval,
            type: plan.type,
            amount: plan.amount,
          }
        : { id: subscription.planId },
      periodStart: subscription.periodStart.toISOString(),
      periodEnd: subscription.periodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trial: {
        used: installation.trialUsed,
        endsAt:
          subscription.status === 'trialing'
            ? subscription.periodEnd.toISOString()
            : null,
      },
      version,
    }
  }

  async billingPortal(
    app: RegisteredApp,
    installationId: number,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const installation = await this.context.ownedInstallation(
      app.appCode,
      installationId,
    )
    const subscription = await this.context.subscriptions.currentOf(
      installation.spaItemId as number,
    )
    if (
      !subscription ||
      subscription.modality !== 'stripe' ||
      !subscription.gatewaySubscriptionId
    ) {
      throw unprocessable(
        'NO_GATEWAY_SUBSCRIPTION',
        'Instalação sem assinatura Stripe',
      )
    }
    return this.gateway.createBillingPortalSession(
      subscription.gatewaySubscriptionId,
      returnUrl,
    )
  }

  /**
   * Upgrade: efeito imediato com `always_invoice`; o SPA muda e o evento sai quando a
   * fatura proporcional é paga (webhook). Downgrade: agendado para o próximo ciclo.
   */
  async changePlan(app: RegisteredApp, subscriptionId: number, planId: number) {
    const { subscription } = await this.context.ownedSubscription(
      app.appCode,
      subscriptionId,
    )
    if (subscription.modality === 'manual') {
      throw unprocessable(
        'MANUAL_SUBSCRIPTION',
        'Troca de plano de assinatura manual é feita no SPA',
      )
    }
    if (
      !subscription.gatewaySubscriptionId ||
      subscription.status !== 'active'
    ) {
      throw unprocessable(
        'NO_GATEWAY_SUBSCRIPTION',
        'Assinatura sem cobrança Stripe ativa',
      )
    }
    if (subscription.planId === planId)
      throw badRequest('SAME_PLAN', 'A assinatura já está neste plano')

    const target = await this.plans.planForCheckout(app, planId, 'subscribe')
    const currentPlan = await this.catalog.getPlan(subscription.planId)
    const upgrade = !currentPlan || target.amount > currentPlan.amount

    if (upgrade) {
      const now = this.clock.now().getTime()
      const start = subscription.periodStart.getTime()
      const end = subscription.periodEnd.getTime()
      const fraction = Math.min(
        1,
        Math.max(0, (end - now) / Math.max(1, end - start)),
      )
      await this.gateway.upgrade(
        subscription.gatewaySubscriptionId,
        target.gatewayPriceId,
        `immediate:${target.id}:${fraction.toFixed(4)}`,
      )
      return {
        subscriptionId,
        planId: target.id,
        effective: 'immediate' as const,
        remainingFraction: Number(fraction.toFixed(4)),
      }
    }
    await this.gateway.scheduleDowngrade(
      subscription.gatewaySubscriptionId,
      target.gatewayPriceId,
      `next_period:${target.id}`,
    )
    return {
      subscriptionId,
      planId: target.id,
      effective: 'next_period' as const,
      effectiveAt: subscription.periodEnd.toISOString(),
    }
  }
}
