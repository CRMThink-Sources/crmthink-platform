# Segurança

Código: `src/shared/crypto/*`, `src/modules/registry/http/auth.ts`,
`src/modules/backoffice/` (operadores, sessão, `http/gate.ts`, `http/policy.ts`, auditoria),
`src/modules/registry/app-registry.ts`, `src/modules/installations/application/signing-keys.ts`,
`src/modules/installations/application/bitrix-auth-verifier.ts`,
`src/shared/observability/logger.ts`.

## Credenciais emitidas pela plataforma

| Credencial | Formato | Como é guardada | Onde é usada |
| --- | --- | --- | --- |
| Chave de API do app | `cp_<32 bytes base64url>` | Só o hash SHA-256 (`app.api_key_hash`) | `Authorization: Bearer` nas rotas servidor-a-servidor |
| Segredo de webhook | `whsec_<32 bytes base64url>` | Cifrado (`app.webhook_secret_enc`) | HMAC dos eventos e do instalador |
| Token de operador (scripts) | livre | Variável `ADMIN_API_TOKENS` (lista) | `/admin/*` como papel `operator`; na auditoria aparece como `token:<8 hex do SHA-256>`. Recomendado um token por script ou rotina |
| Senha de operador | escolhida pela pessoa (≥ 12 caracteres) | Hash argon2id (`admin_operator.password_hash`, `m=19456,t=2,p=1`) | Login do backoffice |
| Segredo TOTP do operador | 20 bytes, base32 | Cifrado (`admin_operator.totp_secret_enc`) | 2º fator do login do backoffice |
| Sessão do backoffice | 32 bytes base64url | Só o SHA-256 (`admin_session.id_hash`) | Cookie `cp_admin_session` em `/admin/*` |

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

## Backoffice: operadores, sessão e auditoria

Cada pessoa que opera a plataforma (dev e suporte) tem conta própria em `admin_operator`.
Não existe cadastro público: a primeira conta nasce pelo comando `src/cli/create-operator.ts`
(`node dist/src/cli/create-operator.js` no container; `yarn admin:create-operator` em dev); as demais,
por um `operator` em `POST /admin/operators`. Senha provisória e URI `otpauth://` só aparecem
na resposta da criação ou da redefinição de acesso.

- **Login** (`POST /admin/auth/login`, `backoffice/application/login.ts`): e-mail, senha
  (argon2id) e código TOTP (RFC 6238, 6 dígitos, 30 s, ±1 passo, `shared/crypto/totp.ts`). Um
  código aceito não vale de novo (`last_totp_step`). Toda falha responde o mesmo
  `INVALID_CREDENTIALS`; e-mail inexistente também roda uma verificação argon2 contra um hash
  fixo, para o tempo de resposta não revelar quais contas existem.
- **Limite de tentativas** (contadores no Redis): mais de 20 tentativas por IP em 15 min → 429
  `TOO_MANY_REQUESTS` com `Retry-After`; 5 falhas seguidas na mesma conta em 15 min → conta
  bloqueada por 15 min (`locked_until`), quando até credenciais corretas falham. Sucesso zera a
  contagem; redefinir o acesso desbloqueia.
- **Senha provisória**: com `must_change_password`, a sessão só acessa `/admin/auth/*`; o resto
  responde 403 `PASSWORD_CHANGE_REQUIRED`.
- **Sessão** (`backoffice/application/sessions.ts`): cookie `cp_admin_session` com `HttpOnly`,
  `Secure` (fora só com `ADMIN_COOKIE_INSECURE=true`, aceito apenas em `NODE_ENV=development`),
  `SameSite=Strict` e `Path=/admin`. Expira após `ADMIN_SESSION_IDLE_MINUTES` sem uso e após
  `ADMIN_SESSION_MAX_HOURS` desde o login. Logout revoga; desativar a conta, trocar o papel ou
  redefinir o acesso revogam todas as sessões dela; trocar a própria senha revoga as outras.
- **Proteção contra requisição forjada**: mutação com sessão exige `Origin` de
  `BACKOFFICE_ORIGINS` (403 `ORIGIN_NOT_ALLOWED`). Tokens de script não exigem `Origin`.
- **Papéis** (`backoffice/http/policy.ts`, aplicados por `backoffice/http/gate.ts`): `viewer`
  (suporte) só lê; `operator` (dev) lê e age; `self` são as rotas da própria sessão. Papel
  insuficiente → 403 `FORBIDDEN_ROLE`. A política é a fonte do papel mostrado no contrato, e um
  teste garante que toda operação de operador tem política.
- **Ordem no `adminGate`**: casa a política → agenda a auditoria (mutações) → autentica (Bearer
  inválido não cai para o cookie) → senha provisória → `Origin` → papel.

### Trilha de auditoria

`admin_audit_log` (`backoffice/application/audit.ts`) registra toda mutação em `/admin/*`,
inclusive as negadas por papel ou origem, com ator (`operator:<id>` ou `token:<prefixo>`),
papel, ação (método e rota sem valores, ex.: `POST /admin/apps/:appCode/rotate-api-key`), alvo,
status, código de erro, IP, user-agent e request id. Também registra os eventos de acesso:
`auth.login_succeeded`, `auth.login_failed` (com o e-mail tentado e, só internamente, se a conta
existe e o motivo), `auth.account_locked`, `auth.logout`, `auth.password_changed`,
`auth.password_change_failed` e `auth.session_expired`. Requisição sem credencial válida (401)
não gera registro.

A auditoria **nunca** guarda senha, código TOTP, segredo gerado, chave de API nem corpo cru: o
resumo é o corpo com chaves sensíveis mascaradas (`secret`, `password`, `token`, `apiKey`,
`totp`, `code`), textos cortados em 200 caracteres e no máximo 2 KB. Não há rota que altere ou
apague registros; a rotina `purge-admin-audit` apaga só o que passou de
`ADMIN_AUDIT_RETENTION_DAYS` (mínimo 365). Falha ao gravar não bloqueia a ação: vai para log
`error` e para `admin_audit_write_failures_total`. Consulta: `GET /admin/audit` (filtros por
ator, ação, alvo, resultado e período).

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
