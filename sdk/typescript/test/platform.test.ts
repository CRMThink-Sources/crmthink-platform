import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { HealthState } from '@/health'
import {
  installedGptMaker,
  spaSubscriptions,
  stripeEvent,
  stripeSubscription,
} from '@/test/billing-helpers'
import { createHarness, GPTMAKER, type Harness } from '@/test/harness'
import { PlatformClient } from '../src/index.js'

/** O cliente é validado contra as rotas reais da plataforma, por HTTP. */
describe('SDK: PlatformClient contra a plataforma', () => {
  let h: Harness
  let server: Server
  let platform: PlatformClient
  let installationId: number

  beforeEach(async () => {
    h = createHarness()
    const installed = await installedGptMaker(h)
    installationId = installed.installationId
    server = createServer(
      createApp(h.container, new HealthState(h.container.db, null)),
    )
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    platform = new PlatformClient({
      platformUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      apiKey: installed.apiKey,
      now: () => h.clock.now().getTime(),
    })
  })

  afterEach(() => {
    server.close()
  })

  async function activate(): Promise<number> {
    stripeSubscription(h, { id: 'sub_1', installationId })
    await stripeEvent(h, {
      type: 'checkout.completed',
      sessionId: 'cs_1',
      mode: 'subscription',
      paid: true,
      metadata: {
        appCode: GPTMAKER,
        installationId,
        planId: 501,
        intent: 'subscribe',
      },
      gatewaySubscriptionId: 'sub_1',
      paymentIntentId: null,
      amountTotal: 9900,
    })
    return spaSubscriptions(h).find(
      x => x[h.config.subscription.gatewayId] === 'sub_1',
    )!.id as number
  }

  it('instalação e planos', async () => {
    const installation = await platform.getInstallation(installationId)
    expect(installation).toMatchObject({ installationId, appCode: GPTMAKER })
    const list = await platform.listInstallations(installation.memberId)
    expect(list.items.map(item => item.installationId)).toEqual([
      installationId,
    ])

    const plans = await platform.listPlans()
    expect(plans.items.map(plan => plan.id).sort()).toEqual([
      500, 501, 502, 510,
    ])
  })

  it('checkout, assinatura atual e SUBSCRIPTION_ALREADY_EXISTS', async () => {
    const checkout = await platform.createCheckoutSession({
      installationId,
      planId: 501,
      intent: 'subscribe',
    })
    expect(checkout.clientSecret).toMatch(/^cs_secret_/)

    await activate()
    const current = await platform.getSubscription(installationId)
    expect(current).toMatchObject({ status: 'active', plan: { id: 501 } })

    await expect(
      platform.createCheckoutSession({
        installationId,
        planId: 502,
        intent: 'subscribe',
      }),
    ).rejects.toMatchObject({
      name: 'PlatformError',
      status: 409,
      code: 'SUBSCRIPTION_ALREADY_EXISTS',
    })
  })

  it('solicitação de trial: trial já vigente e TRIAL_ALREADY_USED', async () => {
    const contact = {
      name: 'Ana Souza',
      email: 'ana@cliente.com',
      phone: '+55 11 99999-0000',
      company: 'Cliente Ltda',
      role: 'Diretora comercial',
    }
    // O GPTMaker cria o trial na instalação: a solicitação só grava o contato.
    const current = await platform.requestTrial(installationId, contact)
    expect(current.created).toBe(false)
    expect(current.trialEndsAt).toBeTruthy()

    h.clock.advance(15 * 86_400_000)
    await h.container.trials.expireDue()
    await expect(
      platform.requestTrial(installationId, contact),
    ).rejects.toMatchObject({ status: 409, code: 'TRIAL_ALREADY_USED' })
  })

  it('itens: cria, lista, altera e remove', async () => {
    const subscriptionId = await activate()
    const created = await platform.createItem(subscriptionId, {
      externalRef: 'agent-1',
      title: 'Agente 1',
    })
    expect(created).toMatchObject({ status: 'active', billable: false })

    const updated = await platform.updateItem(subscriptionId, created.itemId, {
      title: 'Agente 1 (vendas)',
    })
    expect(updated.title).toBe('Agente 1 (vendas)')
    expect((await platform.listItems(subscriptionId)).items).toHaveLength(1)

    const removed = await platform.removeItem(subscriptionId, created.itemId)
    expect(removed.status).toBe('cancelled')
    expect(removed.deletedAt).toBeTruthy()
  })

  it('token do Bitrix pela plataforma', async () => {
    const token = await platform.getInstallationToken(installationId)
    expect(token.accessToken).toBeTruthy()
    expect(await platform.getInstallationToken(installationId)).toBe(token)
  })
})
