/**
 * Teste de integração com o Stripe real (test mode) via Stripe CLI — task 15.3.
 *
 * Pré-requisitos:
 *   1. Plataforma rodando (local ou staging) com STRIPE_SECRET_KEY=sk_test_… e
 *      STRIPE_WEBHOOK_SECRET do `stripe listen`.
 *   2. `stripe listen --events <lista abaixo> --forward-to <PLATFORM_URL>/webhooks/stripe`
 *      em outro terminal (o CLI novo exige `--events`): checkout.session.completed,
 *      checkout.session.expired, customer.subscription.created,
 *      customer.subscription.updated, customer.subscription.deleted, invoice.paid,
 *      invoice.payment_failed, charge.refunded, charge.dispute.created, customer.created
 *   3. Um app cadastrado e uma instalação ACTIVE (ex.: portal de teste do GPTMaker).
 *
 * Variáveis:
 *   PLATFORM_URL, ADMIN_TOKEN, E2E_APP_CODE, E2E_INSTALLATION_ID, E2E_PLAN_ID,
 *   E2E_PACK_PLAN_ID (plano one_time), E2E_PRICE_ID (price recorrente do plano),
 *   STRIPE_SECRET_KEY (sk_test_)
 *
 * Uso: `yarn test:stripe`. Para cada evento tratado, dispara `stripe trigger` com os
 * metadados da plataforma e confere em `/admin/stripe-events` que o evento chegou,
 * passou pela assinatura e foi processado (ou ignorado, quando é o esperado).
 *
 * As fixtures de `invoice.*` do CLI criam fatura avulsa, sem assinatura — que a
 * plataforma ignora de propósito. Esses dois casos criam uma assinatura real pelo SDK
 * (cartão aprovado ⇒ `invoice.paid`; cartão recusado ⇒ `invoice.payment_failed`).
 */
import { execFileSync } from 'node:child_process'
import Stripe from 'stripe'

const env = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Defina ${name}`)
  return value
}

const PLATFORM_URL = env('PLATFORM_URL').replace(/\/+$/, '')
const ADMIN_TOKEN = env('ADMIN_TOKEN')
const APP = env('E2E_APP_CODE')
const INSTALLATION = env('E2E_INSTALLATION_ID')
const PLAN = env('E2E_PLAN_ID')
const PACK_PLAN = env('E2E_PACK_PLAN_ID')
const PRICE = env('E2E_PRICE_ID')
const SECRET_KEY = env('STRIPE_SECRET_KEY')
if (!SECRET_KEY.startsWith('sk_test_'))
  throw new Error('STRIPE_SECRET_KEY precisa ser de test mode (sk_test_)')
const stripe = new Stripe(SECRET_KEY)

type Case = {
  event: string
  /** `--add` do Stripe CLI: metadados da plataforma no objeto certo. */
  add: string[]
  /** Em vez de `stripe trigger`, gera o evento pelo SDK. */
  run?: () => Promise<void>
  /** Status esperado em `stripe_event`. */
  expect: Array<'processed' | 'ignored'>
}

const meta = (
  object: string,
  planId: string,
  intent: 'subscribe' | 'purchase',
) => [
  `${object}:metadata.appCode=${APP}`,
  `${object}:metadata.installationId=${INSTALLATION}`,
  `${object}:metadata.planId=${planId}`,
  `${object}:metadata.intent=${intent}`,
]

/** Assinatura do plano com os metadados da plataforma, paga com `paymentMethod`. */
async function subscribeWith(paymentMethod: string): Promise<void> {
  const customer = await stripe.customers.create({
    payment_method: paymentMethod,
    invoice_settings: { default_payment_method: paymentMethod },
  })
  await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: PRICE }],
    payment_behavior: 'allow_incomplete',
    metadata: {
      appCode: APP,
      installationId: INSTALLATION,
      planId: PLAN,
      intent: 'subscribe',
    },
  })
}

const CASES: Case[] = [
  {
    event: 'checkout.session.completed',
    add: meta('checkout_session', PACK_PLAN, 'purchase'),
    expect: ['processed'],
  },
  {
    event: 'checkout.session.expired',
    add: meta('checkout_session', PACK_PLAN, 'purchase'),
    expect: ['processed'],
  },
  {
    event: 'customer.subscription.created',
    add: meta('subscription', PLAN, 'subscribe'),
    expect: ['ignored'],
  },
  {
    event: 'customer.subscription.updated',
    add: meta('subscription', PLAN, 'subscribe'),
    expect: ['processed'],
  },
  {
    event: 'invoice.paid',
    add: [],
    run: () => subscribeWith('pm_card_visa'),
    expect: ['processed'],
  },
  {
    event: 'invoice.payment_failed',
    add: [],
    run: () => subscribeWith('pm_card_chargeCustomerFail'),
    expect: ['processed'],
  },
  {
    event: 'customer.subscription.deleted',
    add: meta('subscription', PLAN, 'subscribe'),
    expect: ['processed'],
  },
  { event: 'charge.refunded', add: [], expect: ['processed'] },
  { event: 'charge.dispute.created', add: [], expect: ['processed'] },
  // Fora da lista tratada: 200 sem efeito.
  { event: 'customer.created', add: [], expect: ['ignored'] },
]

type StripeEventRow = {
  eventId: string
  type: string
  status: string
  error: string | null
  receivedAt: string
}

async function recentEvents(): Promise<StripeEventRow[]> {
  const res = await fetch(`${PLATFORM_URL}/admin/stripe-events`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  })
  if (!res.ok) throw new Error(`admin/stripe-events: HTTP ${res.status}`)
  return ((await res.json()) as { items: StripeEventRow[] }).items
}

async function waitFor(
  type: string,
  since: number,
  expected: string[],
): Promise<StripeEventRow> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const match = (await recentEvents()).find(
      row =>
        row.type === type &&
        Date.parse(row.receivedAt) >= since &&
        row.status !== 'received',
    )
    // Status final (processed/ignored/dead): devolve já, esperado ou não.
    if (match) return match
    if (Date.now() > deadline)
      throw new Error(`timeout esperando ${type} (${expected.join('|')})`)
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
}

async function main(): Promise<void> {
  const failures: string[] = []
  for (const test of CASES) {
    const since = Date.now() - 2000
    if (test.run) {
      process.stdout.write(`→ ${test.event} via SDK\n`)
      await test.run()
    } else {
      const args = [
        'trigger',
        test.event,
        ...test.add.flatMap(value => ['--add', value]),
      ]
      process.stdout.write(`→ stripe ${args.join(' ')}\n`)
      execFileSync('stripe', args, { stdio: 'inherit' })
    }
    try {
      const row = await waitFor(test.event, since, test.expect)
      const ok = test.expect.includes(row.status as 'processed')
      process.stdout.write(
        `  ${ok ? '✓' : '✗'} ${test.event}: ${row.status}${row.error ? ` (${row.error})` : ''}\n`,
      )
      if (!ok) failures.push(`${test.event}: ${row.status}`)
    } catch (error) {
      failures.push(
        `${test.event}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (failures.length) {
    console.error(`\nFalhas:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log('\nTodos os eventos tratados chegaram e foram processados.')
}

void main()
