import express from 'express'
import { describe, expect, it } from 'vitest'
import {
  createSessionVerifier,
  PlatformClient,
  PlatformError,
  shouldApply,
  verifyPlatformSignature,
  type PlatformEvent,
} from '../src/index.js'

/**
 * Os exemplos do README.md e de docs/apps-integration.md, como código: se deixarem de
 * compilar (`yarn check-types`), a documentação ficou errada.
 */
const platform = new PlatformClient({
  platformUrl: 'https://p.test',
  apiKey: 'cp_key',
  timeoutMs: 10_000,
})
const app = express()
const state = { seen: () => false, lastVersion: () => null }
declare function notifyOverdue(id: number, url: string | null): Promise<void>
declare function addCredits(id: number, quantity: number): Promise<void>

async function checkout(installationId: number, planId: number) {
  try {
    const { clientSecret } = await platform.createCheckoutSession({
      installationId,
      planId,
      intent: 'subscribe',
    })
    return clientSecret
  } catch (error) {
    if (
      error instanceof PlatformError &&
      error.code === 'SUBSCRIPTION_ALREADY_EXISTS'
    ) {
      return null
    } else throw error
  }
}

async function callBitrix(
  installationId: number,
  method: string,
  params: object,
) {
  const send = async (accessToken: string, endpoint: string) => {
    const response = await fetch(`${endpoint}${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, auth: accessToken }),
    })
    return (await response.json()) as { error?: string; result?: unknown }
  }
  const token = await platform.getInstallationToken(installationId)
  const endpoint = token.clientEndpoint ?? `https://${token.domain}/rest/`
  const first = await send(token.accessToken, endpoint)
  if (first.error !== 'expired_token') return first
  const renewed = await platform.refreshInstallationToken(
    installationId,
    token.accessToken,
  )
  return send(renewed.accessToken, endpoint)
}

app.post(
  '/platform/events',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const check = verifyPlatformSignature({
      header: req.header('X-Platform-Signature'),
      rawBody: req.body,
      secrets: [process.env.PLATFORM_WEBHOOK_SECRET!],
    })
    if (!check.ok) return res.status(401).end()
    const event = JSON.parse(req.body.toString('utf8')) as PlatformEvent
    void event
    res.status(200).end()
  },
)

async function handle(event: PlatformEvent) {
  if (!shouldApply(event, state)) return
  switch (event.type) {
    case 'subscription.past_due':
      await notifyOverdue(event.installationId, event.data.hostedInvoiceUrl)
      break
    case 'purchase.paid':
      await addCredits(event.installationId, event.data.quantity)
      break
  }
}

async function session(bearerToken: string) {
  const verifySession = createSessionVerifier({
    platformUrl: 'https://p.test',
    appCode: 'crmthink.gptmaker',
  })
  return verifySession(bearerToken)
}

describe('SDK: exemplos da documentação', () => {
  it('compilam', () => {
    expect([checkout, callBitrix, handle, session]).toHaveLength(4)
  })
})
