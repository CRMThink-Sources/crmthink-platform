# Configuração

Código: `src/config/env.ts` (schema e defaults), `src/config/spa-config.ts`, `.env.example`.

A configuração é validada **uma vez no boot**, em `api` e `worker`. Valor inválido ou
obrigatório ausente derruba o processo com a lista de problemas (`Configuração inválida: ...`).
Um teste (`src/docs/openapi/openapi.test.ts`) falha se uma variável do schema não estiver
nesta página.

Booleanos aceitam `true`/`false`; inteiros, dígitos. Vazio conta como ausente (usa o padrão).

## Processo

| Variável | Obrigatória | Padrão | Efeito |
| --- | --- | --- | --- |
| `NODE_ENV` | não | `development` | `production` bloqueia `BITRIX_TLS_REJECT_UNAUTHORIZED=false` |
| `PORT` | não | `4100` | Porta HTTP (`api`) ou de métricas/health (`worker`) |
| `LOG_LEVEL` | não | `info` | Nível do pino (`silent` nos testes) |
| `LOKI_URL` | não | — | Com valor, envia logs ao Loki |
| `PUBLIC_BASE_URL` | **sim** | — | URL pública (barra final removida). Base da página de instalação, do handler de eventos do Bitrix, do `servers` do `/openapi.json` e do `iss` do JWT |
| `PLATFORM_ENVIRONMENT` | **sim** | — | `production` ou `homolog`. Cada instância só enxerga itens dos SPAs 1060/1142/1146 do próprio ambiente (o portal CRMThink é único); rótulo `env` dos logs |

## Banco e Redis

| Variável | Obrigatória | Padrão | Efeito |
| --- | --- | --- | --- |
| `DATABASE_URL` | sim\* | — | `mysql://usuario:senha@host:porta/base`. Tem precedência sobre as variáveis abaixo |
| `DATABASE_HOST` | sim\* | — | Com `DATABASE_NAME`, monta a URL (usuário e senha são codificados) |
| `DATABASE_PORT` | não | `3306` | |
| `DATABASE_USER` | não | — | |
| `DATABASE_PASSWORD` | não | — | |
| `DATABASE_NAME` | sim\* | — | |
| `REDIS_URL` | **sim** | — | Filas, locks, cache dos SPAs, `application_token` pendente |
| `QUEUE_PREFIX` | não | `crmthink-platform` | Prefixo das filas e chaves no Redis (separe ambientes no mesmo Redis) |

\* `DATABASE_URL` **ou** `DATABASE_HOST` + `DATABASE_NAME`.

## Segurança

| Variável | Obrigatória | Padrão | Efeito |
| --- | --- | --- | --- |
| `TOKEN_ENCRYPTION_KEY` | **sim** | — | 32 bytes em base64 (`yarn admin:generate-encryption-key`). Chave AES-256-GCM de tokens e segredos. **Trocar invalida tudo que está cifrado** |
| `JWT_SIGNING_PRIVATE_KEY` | no 1º boot | — | PEM PKCS#8 RSA (`\n` literais são aceitos). Só semeia a primeira chave de assinatura quando o banco não tem nenhuma ativa; depois a rotação é por `POST /admin/signing-keys/rotate` |
| `JWT_ISSUER` | não | `PUBLIC_BASE_URL` | Claim `iss` do JWT de sessão |
| `JWT_TTL_SECONDS` | não | `900` | Validade do JWT de sessão; também define por quanto tempo uma chave aposentada fica no JWKS |
| `ADMIN_API_TOKENS` | não | — | Tokens de operador separados por vírgula. Vazio: rotas `/admin/*` sempre 401 |
| `SESSION_CORS_ORIGINS` | não | — | `appCode=https://a,https://b;outro=https://c`. Origens que podem chamar `POST /v1/sessions`, por app |
| `BACKOFFICE_ORIGINS` | não | — | Origens do backoffice, separadas por vírgula (ex.: `https://platform.crmthink.com.br,http://localhost:5173`). Mutações em `/admin/*` com sessão de operador exigem `Origin` desta lista; vazio recusa todas (`ORIGIN_NOT_ALLOWED`) |
| `ADMIN_SESSION_IDLE_MINUTES` | não | `30` | Sessão de operador expira após este tempo sem requisição |
| `ADMIN_SESSION_MAX_HOURS` | não | `12` | Validade máxima da sessão de operador desde o login |
| `ADMIN_COOKIE_INSECURE` | não | `false` | `true` tira o `Secure` do cookie de sessão (dev sem TLS). Recusado no boot fora de `NODE_ENV=development` |
| `ADMIN_AUDIT_RETENTION_DAYS` | não | `365` | Registros de auditoria mais antigos que isto são apagados pela rotina diária. Mínimo `365` |
| `CREDENTIAL_ROTATION_GRACE_HOURS` | não | `24` | Validade da chave de API e do segredo de webhook anteriores após a rotação |
| `BITRIX_TLS_REJECT_UNAUTHORIZED` | não | `true` | `false` desliga a verificação TLS (só desenvolvimento; recusado com `NODE_ENV=production`) |

## Stripe

| Variável | Obrigatória | Padrão | Efeito |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | para cobrar | — | Chave da conta. Prefixo `sk_live_`/`rk_live_` ⇒ conta de produção e *price ids* de produção dos planos; outro ⇒ homologação. Vazia: checkout responde 503 `PAYMENTS_UNAVAILABLE` |
| `STRIPE_WEBHOOK_SECRET` | para webhooks | — | Segredo do endpoint `/webhooks/stripe` (`whsec_...`) |

## Portal CRMThink (SPAs)

| Variável | Obrigatória | Padrão | Efeito |
| --- | --- | --- | --- |
| `CRMTHINK_WEBHOOK_URL` | **sim** em uso real | — | Webhook de entrada do portal (REST dos SPAs). Vazio: instalação e cobrança falham e `/health/ready` acusa `spaConfig` |
| `CRMTHINK_APPLICATION_TOKEN` | para eventos | — | `application_token` do webhook de saída do portal; autentica `/bitrix/spa-events`. Vazio: a rota responde 503 |
| `SPA_CONFIG_FILE` | não | — | JSON que sobrescreve IDs de SPA, campos UF e IDs de enum (padrões em `src/config/spa-config.ts`) |

## Tempos e janelas

| Variável | Obrigatória | Padrão | Efeito |
| --- | --- | --- | --- |
| `INSTALLER_TIMEOUT_MS` | não | `60000` | Timeout da chamada ao instalador do app; estourado ⇒ `INSTALL_PENDING` |
| `WEBHOOK_TIMEOUT_MS` | não | `10000` | Timeout de cada entrega de evento aos apps |
| `EVENT_RETRY_WINDOW_HOURS` | não | `24` | Janela de reenvio de um evento antes do dead-letter |
| `WORKER_DISABLE_SCHEDULES` | não | `false` | `true` não registra os agendamentos do worker (filas continuam) |
