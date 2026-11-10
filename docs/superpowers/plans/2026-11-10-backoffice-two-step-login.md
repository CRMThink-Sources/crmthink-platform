# Backoffice: login em duas etapas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o login de tela única do backoffice por e-mail+senha seguido do código TOTP via desafio, com cadastro do autenticador por QR no primeiro acesso e "lembrar este navegador".

**Architecture:** `LoginService` se divide em `login` (senha → desafio, cadastro ou sessão direta por navegador lembrado) e `verifyCode` (desafio + código → sessão). O desafio vive no `JsonCache` (Redis) com o segredo de cadastro cifrado; o navegador lembrado vive no MySQL (`admin_trusted_device`), revogado junto com as sessões. A web vira uma máquina de passos.

**Tech Stack:** TypeScript, Express 4, Prisma 7 (MariaDB), ioredis via `JsonCache`, vitest + supertest + `FakePrisma`; web React/Vite, react-query, MSW, `qrcode`.

**Spec:** `openspec/changes/backoffice-two-step-login/` (`proposal.md`, `design.md`, `specs/operator-auth/spec.md`, `specs/backoffice-web/spec.md`, `tasks.md`). Ler os cenários antes de cada tarefa: os testes abaixo os espelham.

## Global Constraints

- Desafio: validade 5 min (`CHALLENGE_TTL_SECONDS = 300`), uso único, no máximo 5 códigos errados (`CHALLENGE_MAX_ATTEMPTS = 5`); desafio vencido, usado, esgotado ou desconhecido → 401 `CHALLENGE_EXPIRED`.
- Toda falha de credencial → 401 `INVALID_CREDENTIALS`, igual para e-mail inexistente, conta inativa, senha errada e código errado. Bloqueio: 5 falhas em 15 min bloqueiam a conta por 15 min; 21ª tentativa por IP em 15 min → 429 com `Retry-After`. Os limites (já em `login.ts`: `MAX_ACCOUNT_FAILURES`, `MAX_IP_ATTEMPTS`, `LOCK_MS`, `LOGIN_WINDOW_MS`) não mudam.
- TOTP: 6 dígitos, passo de 30 s, ±1 passo, um código não vale duas vezes (`lastTotpStep`).
- Navegador lembrado: cookie `cp_admin_device`, 256 bits aleatórios, só o SHA-256 no banco, `HttpOnly; SameSite=Strict; Path=/admin` (+ `Secure` quando `cookieSecure`), validade fixa `ADMIN_TRUSTED_DEVICE_DAYS` (padrão 30; `0` desliga), só dispensa o código com senha certa, conta com TOTP e cookie da **mesma** conta.
- O segredo do cadastro e o `otpauth://` nunca vão para auditoria, log, cache de consultas, storage ou URL. Segredo em repouso (Redis) sempre cifrado com `TokenCipher`.
- `create`/`resetAccess` de operador não geram nem devolvem TOTP; `resetAccess` zera `totpSecretEnc` e `lastTotpStep` e revoga sessões **e** navegadores lembrados. Trocar senha, desativar e trocar papel também revogam os navegadores.
- Mensagens ao usuário em pt-BR. Padrão de código do repo: sem ponto e vírgula, aspas simples, `@/` para imports, Prettier via `yarn lint`.
- Comandos: API `yarn test <arquivo>`, `yarn check-types`, `yarn lint`; web `cd web/backoffice && yarn test <arquivo>`, `yarn check-types`, `yarn gen:api`.

## Review Focus

- Chute paralelo de código: 20 requisições simultâneas ao mesmo desafio. Esperado: a conta trava em 5 falhas e nenhuma sessão abre com código errado (teste na Task 3).
- Dois `verifyCode` simultâneos com o mesmo código correto. Esperado: no máximo uma sessão (anti-reuso por `lastTotpStep`) (Task 3).
- Cookie de navegador lembrado de conta desativada ou de conta cujo TOTP foi redefinido. Esperado: `INVALID_CREDENTIALS` para a primeira; `totp-setup` para a segunda (Task 3).
- Desafio de cadastro reutilizado depois de o operador já ter gravado o segredo por outro desafio. Esperado: o segredo do segundo desafio não sobrescreve o primeiro (Task 3).
- Resposta da API de login com `code` no corpo (cliente antigo). Esperado: ignorado, nunca autentica (Task 3).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20261110000000_backoffice_two_step_login/migration.sql` | `totpSecretEnc` opcional; modelo `AdminTrustedDevice` |
| `src/config/env.ts` | `ADMIN_TRUSTED_DEVICE_DAYS` → `env.backoffice.trustedDeviceDays` |
| `src/modules/backoffice/application/trusted-devices.ts` (novo) | `TrustedDevices` |
| `src/modules/backoffice/application/login-challenges.ts` (novo) | `LoginChallenges` |
| `src/modules/backoffice/application/login.ts` | `LoginService.login` e `.verifyCode` |
| `src/modules/backoffice/application/operators.ts`, `domain/operator.ts`, `create-operator-cli.ts` | contas sem TOTP, `totpConfigured` |
| `src/modules/backoffice/http/{routes,cookies,policy}.ts` | rota `/admin/auth/totp`, cookie do dispositivo |
| `src/container.ts` | montagem |
| `src/test/fake-prisma.ts` | modelo `adminTrustedDevice` |
| `src/docs/**`, `docs/**`, `web/backoffice/src/api/schema.d.ts` | contrato e docs |
| `web/backoffice/src/features/auth/{login-page,credentials-step,code-step,totp-setup-step}.tsx` | login em passos |

---

### Task 1: Navegador lembrado (banco, config, `TrustedDevices`)

**Files:**
- Modify: `prisma/schema.prisma`, `src/config/env.ts`, `src/test/fake-prisma.ts`
- Create: `prisma/migrations/20261110000000_backoffice_two_step_login/migration.sql`, `src/modules/backoffice/application/trusted-devices.ts`
- Test: `src/modules/backoffice/trusted-devices.test.ts`, `src/config/env.test.ts` (o existente, se houver; senão o teste de env mais próximo)

**Interfaces:**
- Produces:
  - `env.backoffice.trustedDeviceDays: number`
  - `class TrustedDevices { constructor(db: Db, clock: Clock, config: { trustedDeviceDays: number }); get enabled(): boolean; trust(operatorId: number, meta?: { userAgent?: string | null }): Promise<{ token: string; expiresAt: Date }>; isTrusted(token: string | null, operatorId: number): Promise<boolean>; revokeAll(operatorId: number): Promise<void> }`
  - modelo Prisma `AdminTrustedDevice` (`adminTrustedDevice` no client)

- [ ] **Step 1: Escrever os testes que falham** em `trusted-devices.test.ts`, com `FakePrisma` e `FakeClock`: `trust` devolve token e `expiresAt = agora + dias`; `isTrusted(token, id)` verdadeiro; falso para token nulo, desconhecido, de outro operador, após `expiresAt` (avançar o relógio `days + 1`), após `revokeAll`; com `trustedDeviceDays: 0`, `enabled` é falso, `trust` não grava e `isTrusted` é sempre falso; nenhuma linha guarda o token em claro (`idHash` ≠ token, 64 hex). No teste de env: `ADMIN_TRUSTED_DEVICE_DAYS` ausente → 30; `'0'` → 0; `'-1'` rejeitado.
- [ ] **Step 2: Rodar e ver falhar:** `yarn test src/modules/backoffice/trusted-devices.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Schema e migração.** Em `schema.prisma`: `AdminOperator.totpSecretEnc String? @map("totp_secret_enc") @db.Text` e `trustedDevices AdminTrustedDevice[]`; criar `AdminTrustedDevice` espelhando `AdminSession` (`id`, `idHash` único `VarChar(64)`, `operatorId`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt?`, `userAgent? VarChar(500)`, `@@map("admin_trusted_device")`, FK com `onDelete: Cascade`, índice em `operatorId`). Gerar o SQL com `yarn prisma migrate diff --from-schema-datasource --to-schema prisma/schema.prisma --script` (ou o fluxo do repo para `prisma.config.ts`) e salvar na pasta de migração acima; conferir que contém `MODIFY totp_secret_enc ... NULL` e o `CREATE TABLE`. Rodar `yarn prisma:generate`.
- [ ] **Step 4: `src/config/env.ts`:** `ADMIN_TRUSTED_DEVICE_DAYS: int(30)` junto das outras `ADMIN_*`, e `trustedDeviceDays` no objeto `backoffice`. Documentar a variável onde as demais `ADMIN_*` estão documentadas (`.env.example`/README, o que existir).
- [ ] **Step 5: `FakePrisma`:** registrar `adminTrustedDevice` (pk `id`, autoincrement, `unique: [['idHash']]`, defaults `createdAt/lastUsedAt: now()`, `revokedAt: null`, `userAgent: null`), igual a `adminSession`.
- [ ] **Step 6: Implementar `TrustedDevices`** em `trusted-devices.ts`: token `randomBytes(32).toString('base64url')`, hash `createHash('sha256')` (reusar `hashSessionToken` de `sessions.ts`); `isTrusted` confere hash, `operatorId`, `revokedAt === null`, `expiresAt > clock.now()` e atualiza `lastUsedAt`; `revokeAll` faz `updateMany` com `revokedAt: now` nos ativos.
- [ ] **Step 7: Rodar:** `yarn test src/modules/backoffice/trusted-devices.test.ts` e o teste de env → PASS; `yarn check-types` limpo **exceto** erros de `totpSecretEnc` possivelmente nulo em `login.ts`/`operators.ts`: corrigir só com uma guarda mínima em `login.ts` (`if (!operator.totpSecretEnc) return this.fail(operator, normalized, 'bad_totp', meta)`), que a Task 3 substitui.
- [ ] **Step 8: Commit** `feat(backoffice): tabela e serviço de navegadores lembrados`.

---

### Task 2: Desafio de login (`LoginChallenges`)

**Files:**
- Create: `src/modules/backoffice/application/login-challenges.ts`
- Test: `src/modules/backoffice/login-challenges.test.ts`

**Interfaces:**
- Consumes: `JsonCache` (`src/shared/infra/cache.ts`), `Clock` (`src/shared/clock`), `TokenCipher` (`encrypt(plain): string`, `decrypt(enc): string`)
- Produces:
  - `export const CHALLENGE_TTL_SECONDS = 300`, `CHALLENGE_MAX_ATTEMPTS = 5`
  - `export type LoginChallenge = { operatorId: number; attempts: number; setupSecret?: string }` (segredo já em claro, decifrado por `peek`)
  - `class LoginChallenges { constructor(cache: JsonCache, clock: Clock, cipher: TokenCipher); create(operatorId: number, setupSecret?: string): Promise<string>; peek(token: string): Promise<LoginChallenge | null>; fail(token: string): Promise<void>; consume(token: string): Promise<void> }`

- [ ] **Step 1: Testes que falham** (com `MemoryJsonCache`, `FakeClock`, `TokenCipher` de teste de `testEnv`/fakes): `create` devolve token ≥ 43 caracteres e `peek` devolve o estado; `peek` nulo após `advance(5 min + 1 s)`; `consume` torna `peek` nulo; `fail` incrementa `attempts` e na 5ª apaga o desafio; `peek` de token desconhecido é nulo; o valor bruto em `cache.store` não contém o `setupSecret` em claro nem o token em claro (chave usa SHA-256).
- [ ] **Step 2: Rodar:** `yarn test src/modules/backoffice/login-challenges.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `LoginChallenges`: chave `login-challenge:<sha256 hex do token>`; valor `{ operatorId, attempts, setupSecretEnc?, expiresAt: number }`; `set` com TTL = segundos restantes (mínimo 1) e checagem de `expiresAt` contra `clock.now()` em `peek`; `fail` regrava com o TTL restante.
- [ ] **Step 4: Rodar** → PASS. **Step 5: Commit** `feat(backoffice): desafio de login com validade e teto de tentativas`.

---

### Task 3: Login em duas etapas (serviço, rotas, cookies, auditoria)

**Files:**
- Modify: `src/modules/backoffice/application/login.ts`, `src/modules/backoffice/http/routes.ts`, `http/cookies.ts`, `http/policy.ts`, `src/container.ts`
- Modify (testes existentes a adaptar): `src/modules/backoffice/backoffice-http.test.ts`, `sessions.test.ts`, `operators.test.ts` (só os trechos que fazem login)
- Test: `src/modules/backoffice/login-two-step.test.ts` (novo), adaptações acima

**Interfaces:**
- Consumes: `LoginChallenges`, `TrustedDevices` (Tasks 1 e 2); `totpUri({ secret, account, issuer }): string` e `generateTotpSecret(): string` de `@/shared/crypto/totp`; `totpIssuer(environment)` de `domain/operator`
- Produces:
  - `loginSchema = z.object({ email: z.string().max(255), password: z.string().max(200) })` (o campo `code` sai)
  - `totpSchema = z.object({ challenge: z.string().min(1).max(200), code: z.string().max(10), rememberDevice: z.boolean().default(false) })`
  - ```ts
    export type LoginStep =
      | { step: 'totp'; challenge: string; trustedDeviceDays: number }
      | { step: 'totp-setup'; challenge: string; secret: string; otpauthUri: string; trustedDeviceDays: number }
      | { step: 'authenticated'; operator: OperatorView; token: string; expiresAt: Date }
    export type VerifyResult = { operator: OperatorView; token: string; sessionId: number; expiresAt: Date; device?: { token: string; expiresAt: Date } }
    ```
  - `LoginService` constructor: `(db, cipher, sessions, counters, audit, clock, challenges: LoginChallenges, devices: TrustedDevices, issuer: string)`; `login(input: unknown, meta: LoginMeta, deviceToken: string | null): Promise<LoginStep>`; `verifyCode(input: unknown, meta: LoginMeta): Promise<VerifyResult>`
  - `cookies.ts`: `DEVICE_COOKIE = 'cp_admin_device'`, `setDeviceCookie(res, token, expiresAt: Date, secure: boolean)` (com `Max-Age` até `expiresAt`), `readDeviceCookie(req): string | null`
  - Rotas: `POST /admin/auth/login` → `{ step: 'totp' | 'totp-setup', ... }` ou `{ step: 'authenticated', operator, expiresAt }` com cookie de sessão (token nunca no corpo); `POST /admin/auth/totp` → `{ step: 'authenticated', operator, expiresAt }` com cookie de sessão e, se pedido, do dispositivo; ambas com a checagem de `Origin` que `/login` já tem e `policy.ts` com `'POST /admin/auth/totp': { role: 'public', auditedByHandler: true }`
  - `CHALLENGE_EXPIRED`: `new HttpError(401, 'CHALLENGE_EXPIRED', 'O tempo para digitar o código acabou. Entre de novo.')`

- [ ] **Step 1: Escrever os testes que falham** em `login-two-step.test.ts` (helper próprio: cria operador com `h.container.operators.create`, grava o segredo direto na conta com `h.container.cipher.encrypt(segredo)` via `h.db`, troca a senha provisória; usa `totpCode`/`totpStep` com avanço de 30 s entre usos). Um teste por cenário das specs `operator-auth` ("Login com senha e TOTP", "Cadastro do autenticador no primeiro acesso", "Navegador lembrado") e `Limite de tentativas`:
  - senha certa com TOTP → `{ step: 'totp' }`, **sem** `Set-Cookie`;
  - `totp` com código certo → 200, cookie de sessão `HttpOnly; Secure; SameSite=Strict; Path=/admin`;
  - código errado → 401 `INVALID_CREDENTIALS`, sem cookie; 5 erros no mesmo desafio e depois o código certo → 401 `CHALLENGE_EXPIRED`; desafio vencido (avançar 6 min) → `CHALLENGE_EXPIRED`; desafio usado de novo → `CHALLENGE_EXPIRED`; código reutilizado → `INVALID_CREDENTIALS`;
  - e-mail inexistente, conta inativa e senha errada: respostas idênticas (status, código, mensagem) em `/login`;
  - conta sem segredo: `login` devolve `totp-setup` com `secret` base32 e `otpauthUri` começando em `otpauth://totp/`, e a conta continua com `totpSecretEnc` nulo; `totp` com código do `secret` grava o segredo cifrado, abre a sessão e audita `auth.totp_configured`; abandonar e entrar de novo devolve outro `secret`, e um código do primeiro não vale;
  - nenhum registro de `adminAuditLog` contém o segredo nem o URI (varrer `JSON.stringify` das linhas);
  - lembrar: `rememberDevice: true` define `cp_admin_device` com `Max-Age` = dias × 86400; novo `login` com o cookie e a senha certa → `{ step: 'authenticated' }` com cookie de sessão e auditoria `summary.totp === 'skipped_trusted_device'`; senha errada com o cookie → 401 e conta a falha; cookie da conta A na conta B → `step: 'totp'`; conta com TOTP redefinido (segredo nulo) + cookie antigo → `totp-setup`; `ADMIN_TRUSTED_DEVICE_DAYS=0` → `rememberDevice` ignorado, sem cookie de dispositivo;
  - bloqueio: 4 senhas erradas + 1 código errado trava a conta, e o código certo seguinte → `INVALID_CREDENTIALS` e `auth.account_locked` auditado; a 21ª tentativa por IP somando `/login` e `/totp` → 429 com `Retry-After`; conta bloqueada no meio do desafio não entra;
  - `Origin` fora de `BACKOFFICE_ORIGINS` nas duas rotas → 403 `ORIGIN_NOT_ALLOWED`;
  - Review Focus: 20 `POST /totp` simultâneos com códigos errados → a conta termina bloqueada e nenhuma resposta traz cookie; dois `POST /totp` simultâneos com o mesmo código certo → no máximo um 200; corpo de `/login` com `code` válido continua devolvendo `step: 'totp'`, nunca sessão; dois desafios `totp-setup` abertos, o primeiro confirmado → o segundo recebe `CHALLENGE_EXPIRED` ou `INVALID_CREDENTIALS` e o segredo gravado é o do primeiro.
- [ ] **Step 2: Rodar e ver falhar:** `yarn test src/modules/backoffice/login-two-step.test.ts` → FAIL.
- [ ] **Step 3: `cookies.ts` e `policy.ts`:** adicionar as funções e a política acima; `readDeviceCookie` segue o laço de `readSessionCookie`.
- [ ] **Step 4: `LoginService.login`:** mesmo começo de hoje (limite por IP, parse, busca, `burnPasswordCheck`, `verifyPassword`, inativa, bloqueada, senha errada → `fail`). Com a senha certa: se `needsRehash`, regravar o hash. **Não** zerar o contador da conta aqui (só no sucesso final). Se há `totpSecretEnc` e `devices.isTrusted(deviceToken, operator.id)`: zerar contador, atualizar `failedLogins: 0, lockedUntil: null, lastLoginAt`, criar sessão, auditar `auth.login_succeeded` com `summary: { totp: 'skipped_trusted_device' }` e devolver `authenticated`. Se há segredo: `challenges.create(operator.id)` → `{ step: 'totp', challenge }`. Sem segredo: `secret = generateTotpSecret()`, `challenges.create(operator.id, secret)` → `totp-setup` com `otpauthUri = totpUri({ secret, account: operator.email, issuer })`.
- [ ] **Step 5: `LoginService.verifyCode`:** limite por IP; parse com `totpSchema`; `challenges.peek` nulo → `CHALLENGE_EXPIRED`; carregar operador (ausente ou inativo → `consume` e `fail(..., 'inactive')`); bloqueado → `fail(..., 'locked')`; segredo = `challenge.setupSecret ?? decrypt(totpSecretEnc)` (nenhum dos dois → `CHALLENGE_EXPIRED`); `verifyTotp(secret, code.trim(), now, operator.lastTotpStep)`; nulo → `challenges.fail(token)` e `fail(operator, email, 'bad_totp', meta)`. Sucesso: `challenges.consume`; zerar contador; `update` com `lastTotpStep`, `failedLogins: 0`, `lockedUntil: null`, `lastLoginAt` e, no cadastro, `totpSecretEnc: cipher.encrypt(secret)` **só se a conta ainda estiver sem segredo** (recarregar a linha dentro do `update` com `where: { id, totpSecretEnc: null }` para o cadastro; se não casar, `CHALLENGE_EXPIRED`); criar sessão; `devices.trust` se `rememberDevice && devices.enabled`; auditar `auth.login_succeeded` e, no cadastro, `auth.totp_configured` (sem segredo).
- [ ] **Step 6: Rotas e container.** `routes.ts`: `/login` chama `login(req.body, requestMeta(...), readDeviceCookie(req))`; se `authenticated`, `setSessionCookie` e responder `{ step, operator, expiresAt }`; senão responder o passo. Nova `POST /admin/auth/totp` com a checagem de `Origin`, `verifyCode`, cookies de sessão e dispositivo. `container.ts`: criar `LoginChallenges(cache, clock, cipher)` e `TrustedDevices(db, clock, env.backoffice)`, passar ao `LoginService` e ao `BackofficeRoutesDeps` o que as rotas precisarem.
- [ ] **Step 7: Adaptar os testes existentes** (`backoffice-http.test.ts`, `sessions.test.ts`, `operators.test.ts`): o helper `login` passa a fazer as duas chamadas; a obtenção do segredo continua por `issued.totpUri` até a Task 4.
- [ ] **Step 8: Rodar** `yarn test src/modules/backoffice` → PASS; `yarn check-types` e `yarn lint` limpos.
- [ ] **Step 9: Commit** `feat(backoffice): login em duas etapas com cadastro do autenticador e navegador lembrado`.

---

### Task 4: Contas sem TOTP e revogação dos navegadores lembrados

**Files:**
- Modify: `src/modules/backoffice/application/operators.ts`, `domain/operator.ts`, `application/create-operator-cli.ts`, `src/cli/create-operator.ts`, `src/container.ts`, `scripts/seed-dev.ts`
- Test: `src/modules/backoffice/operators.test.ts`, teste do CLI existente, `login-two-step.test.ts` (revogação)

**Interfaces:**
- Produces:
  - `OperatorView` ganha `totpConfigured: boolean`; `IssuedAccess` perde `totpUri` (`{ operator; temporaryPassword }`)
  - `OperatorService` constructor perde o parâmetro `totpIssuer`; o callback `revokeSessions` passado no container passa a revogar também os navegadores: `(id, except) => Promise.all([adminSessions.revokeAll(id, except), trustedDevices.revokeAll(id)]).then(() => undefined)`
  - `src/cli/create-operator.ts` e `container.ts` ajustados à nova assinatura

- [ ] **Step 1: Testes que falham** em `operators.test.ts`: `create` devolve só `temporaryPassword` (sem `totpUri`) e grava `totpSecretEnc` nulo; `list` mostra `totpConfigured: false` e, depois de a conta ter segredo, `true`; `resetAccess` zera `totpSecretEnc` e `lastTotpStep`; nos três gatilhos (`changePassword`, `update` de `active`/`role`, `resetAccess`) um navegador lembrado criado antes deixa de valer (`devices.isTrusted` falso). Saída do CLI: só a senha, sem linha `TOTP`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar:** em `newAccess` remover o segredo e o `totpUri`; `create` não grava `totpSecretEnc`; `resetAccess` grava `totpSecretEnc: null, lastTotpStep: 0`; `toOperatorView` inclui `totpConfigured: row.totpSecretEnc !== null`; limpar imports e o parâmetro `totpIssuer`; ajustar `container.ts` (o `totpIssuer` agora só vai ao `LoginService`), `src/cli/create-operator.ts`, `create-operator-cli.ts` (remover a linha do TOTP e o texto "TOTP novos") e `seed-dev.ts` (operadores de dev sem segredo, mais um já com segredo gravado pelo `cipher` para testar os dois caminhos; imprimir o segredo desse só no log do seed de dev).
- [ ] **Step 4: Atualizar helpers dos testes** da Task 3 que liam `issued.totpUri` (gravar o segredo direto, como no helper novo). Rodar `yarn test` → tudo PASS; `yarn check-types`, `yarn lint`.
- [ ] **Step 5: Commit** `feat(backoffice): criar e redefinir operador sem repassar TOTP`.

---

### Task 5: Contrato OpenAPI e erros

**Files:**
- Modify: `src/docs/openapi/operations.ts`, `src/docs/openapi/responses.ts`, `src/docs/errors.ts`, `src/docs/openapi/build.ts` (só se a lista de erros por operação exigir)
- Regenerar: `docs/api/openapi-admin.json`, `docs/api/openapi.json`, `docs/technical/error-codes.md`, `sdk/typescript/src/generated/openapi.ts`
- Test: `src/docs/openapi/contract-smoke.test.ts` (existente) e a paridade política × operação

**Interfaces:** o schema de `POST /admin/auth/login` (corpo sem `code`; resposta união `step`), nova operação `POST /admin/auth/totp`, `OperatorView.totpConfigured`, `IssuedAccess` sem `totpUri`; erro `CHALLENGE_EXPIRED` (`status: 401`, `meaning`, `action`, `origin: 'backoffice/application/login.ts'`).

- [ ] **Step 1:** Rodar `yarn test src/docs` e ver as falhas de paridade (política nova sem operação).
- [ ] **Step 2:** Atualizar `operations.ts` seguindo a entrada existente de `POST /admin/auth/login` (resposta como `oneOf` com discriminador `step`), adicionar `/admin/auth/totp`, `totpConfigured` e remover `totpUri`; registrar `CHALLENGE_EXPIRED` em `errors.ts` e nas respostas de login e totp.
- [ ] **Step 3:** `yarn docs:openapi`, `yarn sdk:types`; conferir o diff dos gerados. **Step 4:** `yarn test src/docs` → PASS. **Step 5: Commit** `docs(api): contrato do login em duas etapas`.

---

### Task 6: Web: login em passos com QR e "lembrar navegador"

**Files:**
- Modify: `web/backoffice/src/features/auth/login-page.tsx`, `web/backoffice/src/api/schema.d.ts` (gerado), `auth.test.tsx`
- Create: `credentials-step.tsx`, `code-step.tsx`, `totp-setup-step.tsx` (mesma pasta)
- Reuse: `features/actions/qr-code.tsx` (`QrCode({ value, label })`)

**Interfaces:**
- Consumes: `api.POST('/admin/auth/login' | '/admin/auth/totp')`, `meQueryKey`, `safeNext`, `loginErrorMessage` (mantido e exportado)
- Produces: `LoginPage` com estado `type Step = { kind: 'credentials' } | { kind: 'code'; challenge: string; trustedDeviceDays: number } | { kind: 'setup'; challenge: string; secret: string; otpauthUri: string; trustedDeviceDays: number }` só em `useState` do componente; o desafio e o segredo não vão a `queryClient`, storage nem URL. A caixa "Lembrar este navegador por N dias" só aparece quando `trustedDeviceDays > 0`.

- [ ] **Step 1:** `cd web/backoffice && yarn gen:api`. Reescrever em `auth.test.tsx` (MSW) os testes de login: `credentials` envia só `{ email, password }`; resposta `totp` mostra o campo do código e a caixa "Lembrar este navegador" desmarcada; enviar o código chama `/admin/auth/totp` com `{ challenge, code, rememberDevice }` e navega para `next`; resposta `authenticated` na etapa 1 entra direto; resposta `totp-setup` mostra o QR (`role="img"` com o rótulo), o segredo em texto e o campo do código; código errado → "E-mail, senha ou código inválidos." e limpa o código; 429 → mensagem com minutos; `CHALLENGE_EXPIRED` volta ao passo 1 com "O tempo para digitar o código acabou. Entre de novo."; `mustChangePassword` continua indo para `/password?next=`; durante o cadastro, nenhuma requisição além das duas rotas e `queryClient.getQueryCache().getAll()` sem o segredo.
- [ ] **Step 2:** Rodar `yarn test src/features/auth` → FAIL.
- [ ] **Step 3:** Implementar os três componentes de passo e o `LoginPage` que os orquestra; `onError` de `/totp` com `ApiError` de código `CHALLENGE_EXPIRED` volta ao passo 1; manter `AuthEventsBridge` como está.
- [ ] **Step 4:** `yarn test`, `yarn check-types`, `yarn lint` → limpos. **Step 5: Commit** `feat(backoffice-web): login em duas etapas com QR e navegador lembrado`.

---

### Task 7: Web: operadores sem QR de TOTP

**Files:**
- Modify: `web/backoffice/src/features/operators/page.tsx`, `features/actions/secret-reveal-dialog.tsx`, `features/operators/operators.test.tsx`, `features/actions/actions.test.tsx`

**Interfaces:** `SecretRevealDialog` deixa de receber/exibir `otpauth` para operadores (a prop de URI fica opcional e sem uso aqui); a tabela mostra "Autenticador pendente" quando `!totpConfigured`.

- [ ] **Step 1:** Ajustar os testes: criar e redefinir operador mostram só a senha provisória (sem `role="img"` de QR), e a lista mostra "Autenticador pendente" para `totpConfigured: false`. **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** `yarn test`, `yarn check-types`, `yarn lint` → limpos. **Step 5: Commit** `feat(backoffice-web): operadores sem QR de TOTP`.

---

### Task 8: Documentação e verificação final

**Files:** `docs/technical/security.md`, `docs/operations/runbook.md`, `openspec/changes/backoffice-two-step-login/tasks.md` (marcar), `openspec/changes/backoffice-actions/` (nota do ajuste, sem reabrir tarefas)

- [ ] **Step 1:** `security.md`: duas etapas, desafio de 5 min, navegador lembrado (o que dispensa, o que não), revogações, segredo do cadastro. `runbook.md`: recuperar acesso = redefinir (senha provisória) e o operador recadastra o autenticador; como desligar com `ADMIN_TRUSTED_DEVICE_DAYS=0`.
- [ ] **Step 2:** Verificação completa: `yarn lint && yarn check-types && yarn test` na raiz e em `web/backoffice`; esperado: zero falhas e zero avisos.
- [ ] **Step 3:** Teste manual no dev (`yarn seed:dev`, `yarn dev:api`, `cd web/backoffice && yarn dev`): primeiro acesso com QR (escanear e entrar), login com código, "lembrar navegador" (segundo login sem código), trocar a senha (volta a pedir o código), redefinir acesso de outra conta (ela recadastra). Registrar o resultado.
- [ ] **Step 4:** `openspec validate backoffice-two-step-login --strict` → válido; marcar as tarefas do `tasks.md`. **Step 5: Commit** `docs(backoffice): login em duas etapas`.

---

## Self-Review

- **Cobertura da spec:** `operator-auth` — contas sem TOTP (T4), login em duas etapas e erros (T3), cadastro (T3), navegador lembrado (T1, T3, T4), gestão sem TOTP e redefinição (T4); `backoffice-web` — passos, QR local, caixa, desafio vencido, navegador lembrado direto, `mustChangePassword` (T6), operadores (T7); contrato e docs (T5, T8).
- **Consistência de tipos:** `LoginStep.otpauthUri`, `VerifyResult.device`, `TrustedDevices.trust/isTrusted/revokeAll`, `LoginChallenges.create/peek/fail/consume` iguais em T1–T6. O nome `otpauthUri` é decisão nossa (a spec diz "URI `otpauth://`"); `totpUri` do `totp.ts` é a função que o gera.
- **Chamadas nossas:** (1) desafio sobre `JsonCache`, não port novo; (2) cadastro só grava o segredo se a conta ainda estiver sem ele (`where totpSecretEnc: null`); (3) contador de falhas da conta só zera no sucesso final; (4) os passos `totp` e `totp-setup` devolvem `trustedDeviceDays` para a web mostrar o prazo (e esconder a caixa quando for 0); (5) o texto de login com `code` no corpo é ignorado pelo schema.
