# @crmthink-sources/platform-sdk

SDK TypeScript para apps que falam com o crmthink-platform: assinatura dos webhooks,
sessão do iframe, tokens do Bitrix e cobrança. ESM, Node ≥ 20, só depende de `jose`.

O guia do fluxo (cadastro, instalador, eventos, cobrança) está em
[`docs/apps-integration.md`](../../docs/apps-integration.md). Campos, tipos e códigos de
erro de cada rota: `https://<plataforma>/docs`. Os tipos do SDK são gerados desse mesmo
contrato.

## Instalação

O pacote está no GitHub Packages da organização. No `.npmrc` do app:

```
@crmthink-sources:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` precisa de `read:packages` (no CI do app, o token do workflow com
`packages: read`).

```sh
yarn add @crmthink-sources/platform-sdk
```

## Cliente da plataforma

```ts
import { PlatformClient } from '@crmthink-sources/platform-sdk'

const platform = new PlatformClient({
  platformUrl: process.env.PLATFORM_URL!,
  apiKey: process.env.PLATFORM_API_KEY!,
  timeoutMs: 10_000, // padrão
})
```

Um método por rota com chave de app, com o nome do `operationId` em `/docs`:

| Método | Rota |
| --- | --- |
| `listInstallations(memberId)` | `GET /v1/installations?memberId=` |
| `getInstallation(id)` | `GET /v1/installations/{id}` |
| `getInstallationToken(id)` | `GET /v1/installations/{id}/token` (com cache) |
| `refreshInstallationToken(id, tokenRecusado)` | `POST /v1/installations/{id}/token/refresh` |
| `forgetInstallationToken(id)` | descarta o token do cache |
| `listPlans()` | `GET /v1/plans` |
| `getSubscription(installationId)` | `GET /v1/installations/{id}/subscription` |
| `createCheckoutSession(body)` | `POST /v1/checkout-sessions` |
| `createBillingPortalSession(body)` | `POST /v1/billing-portal-sessions` |
| `changePlan(subscriptionId, body)` | `POST /v1/subscriptions/{id}/change-plan` |
| `listItems(subscriptionId)` | `GET /v1/subscriptions/{id}/items` |
| `createItem(subscriptionId, body)` | `POST /v1/subscriptions/{id}/items` |
| `updateItem(subscriptionId, itemId, body)` | `PATCH /v1/subscriptions/{id}/items/{itemId}` |
| `removeItem(subscriptionId, itemId)` | `DELETE /v1/subscriptions/{id}/items/{itemId}` |

O cliente não repete requisições por conta própria.

### Erros

- `PlatformError`: a plataforma respondeu com erro. Tem `status`, `code` (estável; decida
  por ele, nunca pela mensagem), `message` e `details`. Corpo fora do envelope vira
  `code: 'HTTP_<status>'`.
- `PlatformRequestError`: sem resposta HTTP. `kind: 'timeout'` (passou de `timeoutMs`) ou
  `'network'`.

```ts
import { PlatformError } from '@crmthink-sources/platform-sdk'

try {
  const { clientSecret } = await platform.createCheckoutSession({
    installationId,
    planId,
    intent: 'subscribe',
  })
  // frontend: initEmbeddedCheckout({ clientSecret })
} catch (error) {
  if (error instanceof PlatformError && error.code === 'SUBSCRIPTION_ALREADY_EXISTS') {
    // já assinante: mostrar o portal (createBillingPortalSession)
  } else throw error
}
```

### Tokens do Bitrix

O token de cada instalação fica em cache até `expiresAt - 5 min`, e pedidos simultâneos
da mesma instalação compartilham uma requisição. Quando o Bitrix responder
`expired_token`, peça a renovação **à plataforma** com o token recusado. Nunca renove no
`oauth.bitrix.info`: o refresh token é rotacionado e só a plataforma o tem.

```ts
async function callBitrix(installationId: number, method: string, params: object) {
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
  const renewed = await platform.refreshInstallationToken(installationId, token.accessToken)
  return send(renewed.accessToken, endpoint)
}
```

`PlatformTokenClient` (`get`, `refresh`, `forget`) continua exportado para quem já o usa e
delega ao `PlatformClient`.

## Webhooks: eventos e instalador

Verifique o `X-Platform-Signature` com o **corpo cru**. Durante a rotação do segredo,
passe os dois segredos vigentes.

```ts
import express from 'express'
import {
  shouldApply,
  verifyPlatformSignature,
  type PlatformEvent,
} from '@crmthink-sources/platform-sdk'

app.post('/platform/events', express.raw({ type: 'application/json' }), (req, res) => {
  const check = verifyPlatformSignature({
    header: req.header('X-Platform-Signature'),
    rawBody: req.body,
    secrets: [process.env.PLATFORM_WEBHOOK_SECRET!],
  })
  if (!check.ok) return res.status(401).end()
  const event = JSON.parse(req.body.toString('utf8')) as PlatformEvent
  // persistir e responder 2xx; processar assíncrono
  res.status(200).end()
})
```

`PlatformEvent` é uma união discriminada por `type`: testar o tipo estreita o `data`.

```ts
async function handle(event: PlatformEvent) {
  if (!shouldApply(event, state)) return // duplicado ou versão antiga
  switch (event.type) {
    case 'subscription.past_due':
      await notifyOverdue(event.installationId, event.data.hostedInvoiceUrl)
      break
    case 'purchase.paid':
      await addCredits(event.installationId, event.data.quantity)
      break
  }
}
```

`PlatformEventOf<'purchase.paid'>` dá o tipo de um evento só; `InstallerPayload` é o
corpo da chamada do instalador (verificada pela mesma assinatura).

## Sessão do iframe

O frontend troca o auth do BX24 por um JWT (`POST /v1/sessions`, direto com `fetch`); o
backend do app valida localmente pelo JWKS:

```ts
import { createSessionVerifier } from '@crmthink-sources/platform-sdk'

const verifySession = createSessionVerifier({
  platformUrl: process.env.PLATFORM_URL!,
  appCode: 'crmthink.gptmaker',
})
const claims = await verifySession(bearerToken) // lança se inválido, expirado ou de outro app
```

## Desenvolvimento (no repositório da plataforma)

| Comando | O que faz |
| --- | --- |
| `yarn sdk:types` | Regrava `src/generated/openapi.ts` a partir de `docs/api/openapi.json` |
| `yarn sdk:build` | Compila para `dist/` |
| `yarn test sdk` | Testes do SDK, contra a implementação real da plataforma |

Mudou o contrato? `yarn docs:openapi && yarn sdk:types` no mesmo PR; o teste de deriva
falha se esquecer. Publicação: tag `sdk-v<versão>` igual à `version` do `package.json`.
Mudança incompatível na API do SDK aumenta a versão maior.
