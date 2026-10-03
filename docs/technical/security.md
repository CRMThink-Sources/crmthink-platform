# Segurança

Código: `src/shared/crypto/*`, `src/modules/registry/http/auth.ts`,
`src/modules/registry/app-registry.ts`, `src/modules/installations/application/signing-keys.ts`,
`src/modules/installations/application/bitrix-auth-verifier.ts`,
`src/shared/observability/logger.ts`.

## Credenciais emitidas pela plataforma

| Credencial | Formato | Como é guardada | Onde é usada |
| --- | --- | --- | --- |
| Chave de API do app | `cp_<32 bytes base64url>` | Só o hash SHA-256 (`app.api_key_hash`) | `Authorization: Bearer` nas rotas servidor-a-servidor |
| Segredo de webhook | `whsec_<32 bytes base64url>` | Cifrado (`app.webhook_secret_enc`) | HMAC dos eventos e do instalador |
| Token de operador | livre | Variável `ADMIN_API_TOKENS` (lista) | `/admin/*` (inclui o trial manual, `/admin/installations/{id}/trial`) |

Chave e segredo aparecem **uma única vez**, na resposta do cadastro ou da rotação. SHA-256
simples é suficiente para a chave de API: ela tem 256 bits aleatórios, então hash lento não
acrescenta resistência, e a busca por hash é direta (índice único).

### Rotação com carência

`POST /admin/apps/{appCode}/rotate-api-key` e `/rotate-webhook-secret` geram a credencial
nova e mantêm a anterior válida até `previousValidUntil` (`CREDENTIAL_ROTATION_GRACE_HOURS`,
padrão 24 h):

- chave de API: `previous_api_key_hash` é aceito até `previous_api_key_until`;
- segredo de webhook: durante a carência o header de assinatura leva **dois** `v1=`, um por
  segredo — o app aceita se qualquer um conferir e troca a variável sem janela de falha.

## Cifragem em repouso

`TOKEN_ENCRYPTION_KEY` (32 bytes, base64) alimenta AES-256-GCM (`token-cipher.ts`). Formato:
`v1:<base64(iv | authTag | ciphertext)>` — IV aleatório por valor, tag de autenticação de
16 bytes, prefixo de versão para permitir troca de algoritmo.

Campos cifrados:

| Tabela | Campo |
| --- | --- |
| `app` | `bitrix_client_secret_enc`, `webhook_secret_enc`, `previous_webhook_secret_enc` |
| `credential` | `access_token_enc`, `refresh_token_enc` |
| `application_token` | `token_enc` |
| `signing_key` | `private_key_enc` |

Sem a chave (ou com tamanho errado) o processo **não sobe**: gravar tokens em texto puro e
descobrir isso na primeira instalação seria tarde. Gerar: `yarn admin:generate-encryption-key`.

## Assinatura dos webhooks para os apps (HMAC)

`shared/crypto/hmac-signature.ts`, usado nos eventos (`EventDelivery`) e no instalador
(`InstallerClient`):

```
X-Platform-Signature: t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo))>
```

O app deve usar o corpo cru, rejeitar `|agora − t| > 300 s` (proteção contra replay) e comparar
em tempo constante. SDK: `sdk/typescript` (`verifyPlatformSignature`).

## Verificações de entrada

### Bitrix24 (instalação, retry e sessão)

A plataforma **nunca confia no corpo**: o token enviado pelo navegador é conferido no próprio
Bitrix (`bitrix-auth-verifier.ts`).

- **Instalação**: troca/valida o token no OAuth do Bitrix, confirma que o `client_id` é o do app
  (`TOKEN_APP_MISMATCH`), que `member_id` e domínio batem (`MEMBER_ID_MISMATCH`,
  `DOMAIN_MISMATCH`) e que o usuário é administrador (`NOT_PORTAL_ADMIN`). Escopos diferentes do
  cadastro geram alerta, sem bloquear.
- **Sessão**: identidade e admin vêm de `user.current`/`user.admin` com o próprio token; campos
  extras do corpo (ex.: `isAdmin`) são descartados pelo schema.
- **Eventos de instalação** (`/bitrix/events/{appCode}`): `ONAPPINSTALL` só grava o
  `application_token` depois de provar que o `access_token` do evento é deste app naquele
  domínio (senão um terceiro plantaria um token e depois forjaria a desinstalação).
  `ONAPPUNINSTALL` compara o `application_token` com o guardado em tempo constante; sem token
  guardado, só é aceito se o portal já recusa o token da instalação.

### Stripe

`/webhooks/stripe` verifica `Stripe-Signature` sobre os bytes crus com `STRIPE_WEBHOOK_SECRET`
(`stripe.webhooks.constructEvent`). Assinatura inválida: 400 e métrica
`platform_stripe_webhook_failures_total`.

A conta usada é deduzida do prefixo da chave (`sk_live_`/`rk_live_` → produção), e o *price id*
lido do SPA é o do mesmo ambiente — nunca o do outro como fallback (seria cobrar na conta errada).

### Portal CRMThink (SPAs)

`/bitrix/spa-events` exige `auth[application_token]` igual a `CRMTHINK_APPLICATION_TOKEN`
(comparação em tempo constante). Sem a variável, a rota responde 503.

## JWT da sessão do iframe

RS256 com chaves em `signing_key` (privada cifrada). O `kid` vai no header; o JWKS público
(`/.well-known/jwks.json`) publica a chave ativa, a próxima e as aposentadas ainda dentro da
validade dos tokens emitidos. Claims: `iss` (`JWT_ISSUER` ou `PUBLIC_BASE_URL`), `aud` (appCode),
`sub` (id do usuário no Bitrix), `installationId`, `memberId`, `domain`, `isAdmin`, `name`,
`departmentIds`, `exp` (`JWT_TTL_SECONDS`, padrão 15 min). Detalhes em
[iframe-session.md](iframe-session.md).

## CORS de `POST /v1/sessions`

Só origens de `SESSION_CORS_ORIGINS` (`appCode=https://a,https://b;outro=https://c`), e cada
app só com as suas: o preflight aceita qualquer origem configurada (o corpo ainda não é
conhecido), mas a resposta real só leva `Access-Control-Allow-Origin` se a origem pertence ao
`appCode` pedido — senão 403 `ORIGIN_NOT_ALLOWED` e o navegador bloqueia. As demais rotas não
emitem cabeçalhos CORS (são servidor-a-servidor).

## O que nunca vai para o log

O logger (pino) censura por caminho (`REDACT_PATHS`): `authorization`, `cookie`, `token`,
`accessToken`, `refreshToken`, `applicationToken`, `access_token`, `refresh_token`,
`application_token`, `client_secret`, `clientSecret`, `secret`, `apiKey`, `webhookSecret`,
`privateKey` (e as variantes aninhadas `*.x`). Mensagens de erro passam por `scrubSecrets`, que
remove `auth=`/tokens de URLs (o REST do Bitrix leva o token na query). Respostas com token
(`/token`, `/token/refresh`) saem com `Cache-Control: no-store`.

## Outros cuidados

- Comparações de segredo usam `safeEqual` (`timing-safe.ts`) — tempo constante e sem vazar tamanho.
- `BITRIX_TLS_REJECT_UNAUTHORIZED=false` só em desenvolvimento; em produção o boot recusa.
- `x-powered-by` desligado; `trust proxy` ligado (a API roda atrás de proxy TLS).
- Consultas de app são sempre filtradas pelo `appCode` da chave; recurso alheio é 404.
