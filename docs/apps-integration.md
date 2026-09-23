# Integração de apps com o crmthink-platform

Guia para o time de cada aplicação (GPTMaker primeiro). A plataforma cuida de instalação
no Bitrix24, tokens, login do iframe e cobrança; o app cuida dos próprios binds, da
política de acesso e do produto.

SDKs prontos:

| Linguagem | Onde | O que tem |
| --- | --- | --- |
| TypeScript | `sdk/typescript/index.ts` | `verifyPlatformSignature`, `createSessionVerifier`, `PlatformTokenClient`, `shouldApply` |
| Java 17+ | `sdk/java/src/main/java/br/com/crmthink/platform/` | `PlatformSignature` (só JDK), `PlatformSessionVerifier` (nimbus-jose-jwt 9.37+) |

Os dois SDKs são testados contra a implementação real da plataforma
(`sdk/typescript/index.test.ts`; `PlatformSignatureTest.java` com o vetor gerado pelo Node).

---

## 1. Cadastro

Um operador registra o app (`POST /admin/apps`) com `client_id`/`client_secret` do app
Bitrix, escopos, `installerUrl`, `webhookUrl`, produtos do SPA 1134, trial e tema da
página de instalação. A resposta traz **uma única vez**:

- `apiKey` — `Authorization: Bearer <apiKey>` em toda chamada servidor-a-servidor;
- `webhookSecret` — segredo HMAC dos eventos e do instalador.

No app Bitrix24 (staging e produção são apps distintos):

- **URL de instalação**: `https://<plataforma>/install/<appCode>`
- **Handler de eventos de instalação**: `https://<plataforma>/bitrix/events/<appCode>`

Rotação: `POST /admin/apps/<appCode>/rotate-api-key` e `/rotate-webhook-secret`. A
credencial anterior continua valendo por 24h (`CREDENTIAL_ROTATION_GRACE_HOURS`);
durante a transição os webhooks levam **duas** assinaturas `v1=`.

## 2. Assinatura dos webhooks (eventos e instalador)

```
X-Platform-Signature: t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo))>
```

Regras: use o **corpo cru**; rejeite `t` com mais de 5 minutos de diferença; aceite se
qualquer `v1=` conferir com qualquer segredo vigente seu.

TypeScript (Express):

```ts
import express from 'express'
import { verifyPlatformSignature } from './platform-sdk'

app.post('/platform/events', express.raw({ type: 'application/json' }), (req, res) => {
  const check = verifyPlatformSignature({
    header: req.header('X-Platform-Signature'),
    rawBody: req.body,
    secrets: [process.env.PLATFORM_WEBHOOK_SECRET!],
  })
  if (!check.ok) return res.status(401).end()
  // persistir e responder 2xx; processar assíncrono
})
```

Java (Spring):

```java
@PostMapping(value = "/platform/events", consumes = "application/json")
public ResponseEntity<Void> events(@RequestHeader("X-Platform-Signature") String signature,
                                   @RequestBody byte[] rawBody) {
    var result = PlatformSignature.verify(signature, rawBody, List.of(webhookSecret));
    if (result != PlatformSignature.Result.OK) return ResponseEntity.status(401).build();
    // persistir e responder 2xx; processar assíncrono
    return ResponseEntity.ok().build();
}
```

## 3. Instalador do app

Durante a instalação a plataforma chama **sincronamente** (timeout 60s):

```
POST <installerUrl>
X-Platform-Signature: ...
{"installationId":1001,"memberId":"...","domain":"empresa.bitrix24.com.br","appCode":"crmthink.gptmaker","isReinstall":false}
```

O instalador faz os binds do app (chatbot, eventos, placements, robôs) usando o token da
plataforma (seção 4) e responde **2xx** quando terminou. Erro ou timeout ⇒ a instalação
fica `INSTALL_PENDING` e o admin do portal vê "tentar novamente", que chama **só** o
instalador de novo. Por isso ele precisa ser **idempotente** (reinstalação e nova
tentativa chamam o mesmo endpoint).

## 4. Tokens do Bitrix

```
GET  /v1/installations/{id}/token            → {accessToken, expiresAt, domain, clientEndpoint}
POST /v1/installations/{id}/token/refresh    {staleAccessToken} → mesmo formato
```

- Guarde em cache até `expiresAt - 5 min` e chame o Bitrix direto (`clientEndpoint`).
- Se o Bitrix responder `expired_token`, chame `/token/refresh` com o token recusado. A
  plataforma faz **uma** renovação mesmo com vários processos pedindo juntos.
- **Nunca** renove no `oauth.bitrix.info`: o Bitrix rotaciona o refresh token e só a
  plataforma o tem — renovar por fora derruba a instalação.
- `410` = instalação desinstalada. `409 AUTH_ERROR` = credencial inválida (o portal
  precisa reinstalar). `404` = instalação não é do seu app (ou foi desvinculada).

`PlatformTokenClient` (TypeScript) já implementa cache + refresh.

Outras consultas: `GET /v1/installations/{id}` (inclui `applicationToken`, para validar
eventos do Bitrix que o seu app recebe) e `GET /v1/installations?memberId=`.

## 5. Sessão do iframe

1. Frontend do app, dentro do Bitrix: `BX24.getAuth()` e
   `POST https://<plataforma>/v1/sessions` com `{appCode, accessToken, domain, memberId}`.
   A origem do frontend precisa estar em `SESSION_CORS_ORIGINS` para o `appCode`.
2. A plataforma confere usuário e admin no Bitrix (`user.current`, `user.admin`) — nada
   que o navegador mande sobre identidade é aceito — e devolve
   `{token, expiresAt, installationId, user}`.
3. O frontend envia `Authorization: Bearer <token>` ao backend do app, que valida
   **localmente** pelo JWKS (`/.well-known/jwks.json`): assinatura RS256, `iss`, `aud` =
   seu `appCode`, `exp`.
4. Token expira em 15 min: o frontend cria outra sessão com o auth atual do BX24.

Claims: `sub` (id do usuário Bitrix), `installationId`, `memberId`, `domain`, `isAdmin`,
`name`, `departmentIds`, `iss`, `aud`, `exp`. Permissões finas são do app, a partir disso.

TypeScript:

```ts
import { createSessionVerifier } from './platform-sdk'
const verifySession = createSessionVerifier({ platformUrl: process.env.PLATFORM_URL!, appCode: 'crmthink.gptmaker' })
const claims = await verifySession(bearerToken) // lança se inválido/expirado/de outro app
```

Java (`com.nimbusds:nimbus-jose-jwt:9.40`):

```java
var verifier = new PlatformSessionVerifier(platformUrl, "crmthink.gptmaker");
PlatformSessionVerifier.Session session = verifier.verify(bearerToken);
```

Rotação de chaves: a chave nova aparece no JWKS antes de assinar (10 min de antecedência)
e a antiga continua publicada até expirarem os tokens dela. Os verificadores recarregam o
JWKS ao ver um `kid` desconhecido; não é preciso configurar nada.

## 6. Eventos

`POST <webhookUrl>` com o envelope:

```json
{
  "eventId": "uuid",
  "type": "subscription.renewed",
  "appCode": "crmthink.gptmaker",
  "installationId": 1001,
  "memberId": "…",
  "occurredAt": "2026-09-01T12:00:00.000Z",
  "subscription": { "id": 3001, "status": "active", "modality": "stripe", "planId": 501,
                    "periodStart": "…", "periodEnd": "…", "version": 7 },
  "data": { "invoiceId": "in_…", "previousPeriodEnd": "…" }
}
```

Headers: `X-Platform-Signature`, `X-Platform-Event-Id`, `X-Platform-Event-Type`.

| Tipo | `data` |
| --- | --- |
| `installation.created` / `.reinstalled` / `.removed` | `{}` (`subscription: null`) |
| `installation.auth_error` | `{lastError, failures}` |
| `installation.auth_restored` | `{}` |
| `subscription.trial_started` | `{trialEndsAt, trialDays}` |
| `subscription.activated` | `{previousSubscriptionId}` (trial encerrado, se havia) |
| `subscription.renewed` | `{invoiceId, previousPeriodEnd}` |
| `subscription.plan_changed` | `{previousPlanId, planId, effective: immediate\|next_period, remainingFraction?}` |
| `subscription.past_due` | `{invoiceId, hostedInvoiceUrl}` |
| `subscription.recovered` | `{}` |
| `subscription.cancel_scheduled` | `{effectiveAt}` |
| `subscription.ended` | `{reason: cancelled\|trial_expired\|deleted}` |
| `subscription.period_ending` | `{daysLeft: 3\|2\|1, periodEnd}` (só `manual`) |
| `subscription.item_changed` | `{change: created\|updated\|removed, item}` (alteração humana no SPA 1146) |
| `purchase.paid` | `{purchaseId, planId, quantity, chargeId, amount}` |
| `charge.refunded` | `{chargeId, source: purchase\|invoice, purchaseId\|invoiceId, amountRefunded, amount}` |
| `charge.disputed` | `{chargeId, disputeId, source, purchaseId\|invoiceId, amount, reason}` |

Garantias e obrigações do app:

- **Pelo menos uma vez**: persista e responda 2xx; deduplique por `eventId`.
- **Ordem**: ignore evento de assinatura com `subscription.version` menor que a última
  aplicada (`shouldApply` no SDK TS). A plataforma entrega em ordem por instalação, mas
  reenvios manuais podem chegar depois.
- Reenvio com backoff por até 24h; depois dead-letter e reenvio manual pelo operador.
- Carência, corte de acesso, créditos e limites são decisão do app: a plataforma só
  informa.

## 7. Cobrança

| Rota | Uso |
| --- | --- |
| `GET /v1/plans` | Planos ativos dos produtos do app (`type: subscription\|one_time`, `trial`) |
| `GET /v1/installations/{id}/subscription` | Assinatura vigente, `cancelAtPeriodEnd`, trial e `version` |
| `POST /v1/checkout-sessions` | `{installationId, planId, intent: subscribe\|purchase, quantity?}` → `{clientSecret, sessionId}` para o **Checkout embutido** |
| `POST /v1/billing-portal-sessions` | `{installationId, returnUrl}` → URL do Customer Portal (abrir em aba nova) |
| `POST /v1/subscriptions/{id}/change-plan` | `{planId}`: upgrade imediato (fatura proporcional) ou downgrade no próximo ciclo |
| `POST/PATCH/DELETE /v1/subscriptions/{id}/items[/{itemId}]` | Itens no SPA 1146, idempotentes por `externalRef`; `billable` sincroniza quantidade no Stripe |

Códigos de erro estáveis: `PLAN_TYPE_MISMATCH`, `SUBSCRIPTION_ALREADY_EXISTS`,
`NO_ACTIVE_SUBSCRIPTION`, `NO_GATEWAY_SUBSCRIPTION`, `MANUAL_SUBSCRIPTION`,
`TRIAL_ALREADY_USED`, `INSTALLATION_NOT_FOUND`, `AUTH_ERROR`. Decida pelo `code`, nunca
pela mensagem.

O frontend monta o Checkout com `@stripe/stripe-js` (`initEmbeddedCheckout({ clientSecret })`);
a conclusão chega ao backend pelo evento `subscription.activated`/`purchase.paid`, não
pelo callback do navegador.
