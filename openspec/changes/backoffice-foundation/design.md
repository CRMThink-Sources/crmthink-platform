## Context

- `/admin/*` é montado em `src/modules/registry/http/admin-routes.ts` atrás de `adminAuth(tokens)`, que só compara um Bearer com `ADMIN_API_TOKENS`. O Caddy ainda restringe `/admin/*` por IP (`ADMIN_ALLOWED_IPS`).
- As leituras atuais usam `findMany({ take: 100 })` direto no Prisma, sem cursor.
- Não existe histórico de assinatura no banco. `SubscriptionVersion` e `ItemVersion` guardam só a última versão e o último snapshot, e o estado vive no SPA do portal CRMThink. O histórico de assinatura que temos é o outbox: cada mudança gera um `OutboxEvent` (`subscription.*`) por instalação. `StripeEvent` não tem `installationId`, só `appCode`.
- O billing já lê a assinatura corrente por `subscriptions.current(app, installationId)`. É a mesma resposta que o app recebe em `GET /v1/installations/{id}/subscription`.
- Infra disponível: MySQL (Prisma 7), Redis (`ioredis`, `src/shared/infra/redis.ts`), cifra `v1:` (`src/shared/crypto/token-cipher.ts`) e comparação em tempo constante (`timing-safe.ts`).
- O requisito "Esquemas de segurança descritos" de `api-reference` está sendo alterado também por `trial-contact-request`, ainda não arquivada. O delta desta mudança parte do texto daquela.

## Goals / Non-Goals

**Goals:**
- Identidade por pessoa e papel em toda requisição `/admin/*`, sem quebrar os scripts que usam token.
- Auditoria gravada no mesmo ponto em que a autorização acontece, para nenhuma rota escapar.
- Leituras que o backoffice consome sem precisar de N chamadas por tela.

**Non-Goals:**
- Interface React (`backoffice-ui`) e novas ações de escrita na interface (`backoffice-actions`).
- SSO, WebAuthn e recuperação de senha por e-mail. A recuperação é feita por outro `operator` ou pelo script.
- Histórico de assinatura além do que o outbox já registra. Não vamos criar tabela de versões.
- Associar `StripeEvent` a instalações. Eles continuam na listagem própria.

## Decisions

### 1. Módulo `backoffice` separado de `registry`
Novo `src/modules/backoffice/` com `operators`, `sessions`, `audit` e `reads`. O middleware de autenticação de operador sai de `registry/http/auth.ts` e vai para esse módulo. `adminRoutes` continua no `registry`, mas recebe o middleware pronto. As leituras usam o Prisma diretamente, como as rotas admin de hoje, porque são consultas de operador e não regras de domínio. A assinatura corrente é a exceção: vem pela porta do billing.
- Alternativa: tudo em `registry`. Recusada porque `registry` é o cadastro de apps, e auth de pessoas e auditoria não têm relação com isso.

### 2. Um middleware único: autenticar → autorizar → auditar
```
/admin/auth/login ─► rateLimit ─► handler (audita login)
/admin/*          ─► resolveActor (cookie | Bearer)
                     ├─ nenhum            → 401
                     ├─ mustChangePassword→ 403 (exceto /admin/auth/*)
                     ├─ Origin (só cookie, só mutação) → 403 ORIGIN_NOT_ALLOWED
                     ├─ requireRole(rota)  → 403 FORBIDDEN_ROLE
                     └─ audit on res.finish (mutações, inclusive negadas)
```
O papel mínimo é declarado junto da rota, num mapa ao lado do registro de operações do OpenAPI (`src/docs/openapi/operations.ts`). Assim um teste garante que toda operação admin tem um papel e que o contrato descreve o mesmo papel que o middleware aplica. Regra padrão: `GET` pede `viewer` e o resto pede `operator`. Exceções explícitas: `/admin/auth/*` vale para qualquer sessão, e `GET /admin/stripe-events/:eventId` e `GET /admin/operators` pedem `operator`.
- A auditoria grava no `finish` da resposta, com o status real, e usa o padrão da rota (`req.route.path`), nunca a URL com valores. O alvo sai de um extrator por rota (`:appCode` vira `app:<code>`, `:id` em installations vira `installation:<id>`). A gravação falhando não derruba a resposta: o erro vai para log `error` e para a métrica `admin_audit_write_failures_total`.

### 3. Sessão no MySQL, contadores no Redis
- Tabela `admin_session`: `idHash` (SHA-256 do valor do cookie), `operatorId`, `createdAt`, `lastSeenAt`, `expiresAt`, `revokedAt`, `ip`, `userAgent`. Revogar todas as sessões de uma conta vira um `UPDATE`. A sessão sobrevive a um flush do Redis e cada sessão fica rastreável.
- `lastSeenAt` só é atualizado quando passou mais de 60 s desde a última atualização, para não escrever no banco a cada requisição.
- O limite de tentativas usa contadores com TTL no Redis (`login:ip:<ip>`, `login:acct:<email>`). O bloqueio da conta também é gravado no banco (`lockedUntil`) para ficar visível na gestão e na auditoria.
- Alternativa: sessão só no Redis. Recusada porque revogar por conta exige índice secundário, e a sessão não deixaria rastro após expirar.

### 4. Hash e TOTP
- Senha: argon2id com `@node-rs/argon2`, que tem binário pré-compilado e funciona no Dockerfile atual sem toolchain. Parâmetros iniciais: `m=19456, t=2, p=1` (mínimo da OWASP). O hash guarda os parâmetros, então dá para subir depois e fazer rehash no login.
- Para não revelar quais e-mails existem, o login com e-mail inexistente também roda uma verificação argon2 contra um hash fixo, com tempo equivalente.
- TOTP: RFC 6238 com `node:crypto` (HMAC-SHA1, 6 dígitos, 30 s), mais ou menos 1 passo. O segredo tem 20 bytes, é cifrado com o `token-cipher` (`v1:`) e guardado em `totpSecretEnc`. Contra replay, guardamos `lastTotpStep` e só aceitamos um passo maior que esse.
- Alternativa: a lib `otplib`. Recusada porque são ~30 linhas sem dependência e fáceis de testar com os vetores da RFC.

### 5. Token de script como ator
`token:<sha256(token)[0..8]>`. O prefixo é estável entre deploys e identifica qual token foi usado sem expor o token. Ele aparece na auditoria e em `GET /admin/auth/me`. A documentação vai recomendar um token por script ou rotina.

### 6. Paginação por cursor
O cursor é `base64url(JSON)` com a chave de ordenação da listagem: `seq` em `outbox_event`, `(receivedAt, eventId)` em `stripe_event`, `(installedAt, id)` em `installation` e `id` em `admin_audit_log`. A validação usa zod e um cursor malformado vira `VALIDATION_ERROR`. Não vamos assinar o cursor, porque adulterá-lo só muda a página lida e todas as linhas estão disponíveis ao mesmo papel.
- Compatibilidade: `/admin/events` e `/admin/stripe-events` mantêm `items` e passam a ter `nextCursor`. O padrão de 50 itens reduz o que hoje vem em 100. Isso vai no aviso **BREAKING** e no runbook.

### 7. Timeline como merge em memória de fontes paginadas
Para uma página de tamanho `L` antes de um cursor `(occurredAt, kind, id)`, o servidor busca até `L` linhas de cada fonte com `occurredAt <= cursor`, junta, ordena e corta em `L`. O cursor final é o último item. As fontes são:

| kind | fonte | occurredAt | índice |
|---|---|---|---|
| `install_attempt` | `install_attempt` | `createdAt` | `(installationId, createdAt)` existe |
| `event` | `outbox_event` + últimas 5 `event_delivery` | `createdAt` | novo `(installationId, createdAt)` |
| `purchase` | `purchase` | `createdAt` | novo `(installationId, createdAt)` |
| `admin_action` | `admin_audit_log` com alvo `installation:<id>` | `createdAt` | `(targetType, targetId, createdAt)` |

Com 4 fontes, o custo é limitado a `4·L` linhas por página. `PeriodNotice` fica de fora, porque é chaveado por `subscriptionSpaId` e o aviso já aparece como evento `subscription.period_ending` no outbox.
- Alternativa: tabela de timeline materializada, alimentada em cada escrita. Recusada porque exige tocar todos os pontos de escrita e duplica dados. Pode ser revista se a timeline ficar lenta.

### 8. Detalhe com assinatura tolerante a falha
`GET /admin/installations/:id` lê o banco e chama `subscriptions.current` com timeout de 3 s. Se der erro ou timeout, a resposta traz `subscription: { available: false, reason }`. A assinatura vem do SPA do portal, e o suporte precisa ver o resto mesmo com o Bitrix fora do ar.

### 9. Overview com cache de 60 s no Redis
São consultas agregadas (`groupBy`) calculadas sob demanda e guardadas em `cache.ts` por 60 s com `computedAt`. Trials que terminam em 7 dias vêm do outbox, não do SPA, para o painel não depender do Bitrix. A regra é: último `subscription.trial_started` de cada instalação com `payload.data.trialEndsAt` nos próximos 7 dias e sem evento posterior `subscription.activated` ou `subscription.ended` para a mesma `subscriptionId`.

### 10. Origens do backoffice
Nova env `BACKOFFICE_ORIGINS` (lista separada por vírgula). Em produção, a origem do próprio host da API, porque a UI vai ser servida em `/backoffice` no mesmo host. Em desenvolvimento, `http://localhost:5173`. O cookie usa `Secure`. Em dev sem TLS, a flag `ADMIN_COOKIE_INSECURE=true` só é aceita com `NODE_ENV=development`, e o boot falha se ela aparecer em produção.

## Risks / Trade-offs

- [Superfície exposta à internet sem a allowlist] → TOTP obrigatório, bloqueio por conta, limite por IP, mensagens de erro iguais, auditoria de falhas e alerta Prometheus para `admin_login_failures_total` alto. A allowlist sai só depois do deploy desta mudança com pelo menos um operador criado (ver Migration Plan).
- [Token de script vazado vale como `operator` sem 2º fator] → um token por uso, rotação documentada e auditoria por prefixo. Restringir tokens a rotas específicas fica para o futuro.
- [Auditoria perdida se a gravação falhar] → métrica e log `error`. Não bloqueamos a ação, porque falha de auditoria não pode travar a operação. É uma escolha consciente.
- [Timeline lenta em instalações com muitos eventos] → índices novos e custo limitado a `4·L`. Se ficar lenta, materializar (decisão 7).
- [Conflito de delta em `api-reference` com `trial-contact-request`] → arquivar `trial-contact-request` antes desta mudança. O delta daqui já parte do texto dela.
- [Bloqueio de conta usado para negar acesso a um operador conhecido] → o bloqueio dura só 15 min e outro `operator` pode desbloquear redefinindo o acesso. O limite por IP reduz o volume de tentativas.

## Migration Plan

1. Deploy com a migração Prisma (tabelas `admin_operator`, `admin_session`, `admin_audit_log` e índices novos). A allowlist do Caddy continua. Os tokens continuam funcionando, agora auditados.
2. Rodar `yarn admin:create-operator` em staging e produção para os primeiros `operator`, e cadastrar o TOTP.
3. Validar login, papéis e auditoria em staging.
4. Remover o bloco `@admin` do `Caddyfile` e `ADMIN_ALLOWED_IPS` do deploy, e recarregar o Caddy.
5. Rollback: recolocar o bloco `@admin` no Caddy (só infra). Reverter o código não exige reverter a migração, porque as tabelas novas são aditivas e as colunas antigas não mudam.

## Open Questions

- Prazo de retenção da auditoria acima do mínimo de 365 dias (env `ADMIN_AUDIT_RETENTION_DAYS`). Pode ser definido no deploy.
