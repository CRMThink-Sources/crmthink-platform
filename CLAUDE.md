# CLAUDE.md

## Visão geral

Serviço único que padroniza, para todos os apps CRMThink (GPTMaker, ThinkZap…), a instalação no Bitrix24 (cofre de tokens, sessão de iframe via JWT, desinstalação) e a cobrança (Stripe + SPAs do portal CRMThink). Dois processos com a mesma imagem: `api` (HTTP) e `worker` (filas BullMQ e agendamentos). Inclui o backoffice (React) para dev/suporte e um SDK TypeScript para os apps.

## Stack

- Node 20 (API/worker), TypeScript 5.9 `strict` + `noUncheckedIndexedAccess`, CommonJS, Express 4, zod 4.
- Prisma 7 com MySQL 8.4 (adapter `mariadb`); Redis 7 + BullMQ; pino (+ Loki); prom-client; Stripe; jose (JWT).
- Testes: vitest 4 + supertest. Gerenciador: **yarn** (`yarn.lock`).
- `web/backoffice`: projeto separado (Node 22, Vite, React 19, Tailwind, shadcn/ui, TanStack Query), com `package.json` e `yarn.lock` próprios.
- `sdk/typescript`: pacote `@crmthink-sources/platform-sdk`.

## Comandos

```bash
docker compose up -d mysql redis        # MySQL :3307, Redis :6380
cp .env.example .env                    # preencher JWT_SIGNING_PRIVATE_KEY (TOKEN_ENCRYPTION_KEY: yarn admin:generate-encryption-key)
yarn install
yarn prisma:migrate                     # prisma migrate deploy
yarn dev:api                            # :4100
yarn dev:worker

yarn test                               # vitest run (src/**/*.test.ts e sdk/**/*.test.ts)
yarn vitest run src/modules/billing/billing.test.ts -t "trecho do nome"   # teste isolado
yarn lint                               # prisma generate + eslint --max-warnings 0
yarn check-types                        # prisma generate + tsc --noEmit
yarn build                              # tsc + tsc-alias -> dist/
yarn docs:openapi                       # regera docs/api/*.json e docs/technical/error-codes.md
yarn sdk:types && yarn sdk:build        # tipos do SDK a partir de docs/api/openapi.json; build do pacote
yarn admin:create-operator --email x --name y --role operator   # operador do backoffice
```

Backoffice (dentro de `web/backoffice`, `yarn install` próprio): `yarn dev` (:5173, proxy de `/admin` → :4100; exige `BACKOFFICE_ORIGINS=http://localhost:5173` e `ADMIN_COOKIE_INSECURE=true` no `.env` da API), `yarn test`, `yarn lint`, `yarn check-types`, `yarn build`, `yarn gen:api` / `yarn check:api`.

## Arquitetura

- `src/api.ts`, `src/worker.ts` → `bootstrap()` (valida env, logger, Prisma/Redis, chave JWT) → `buildContainer()` em `src/container.ts` (injeção por construtor; **só** `container` e `bootstrap` leem `env()`).
- `src/app.ts`: monta o Express; **a ordem das rotas é deliberada** (sem `express.json()` global: Stripe exige corpo cru; Bitrix manda form-urlencoded). Rotas não casadas passam por `appAuth` (sem chave = 401, com chave = 404).
- `src/modules/<módulo>/{domain,application,infra,http,ports}`:
  - `registry` (apps, chaves de API, auth de app e operador), `installations` (instalação, eventos Bitrix, cofre de tokens, JWT), `billing` (planos, assinaturas, Stripe, SPAs, trial, itens, compras), `events` (outbox e entrega), `backoffice` (rotas `/admin/*`, operadores, auditoria).
  - `billing` só enxerga `installations` pelas portas em `installations/ports.ts`; Stripe fica atrás de `billing/ports/payment-gateway.ts`.
- `src/shared/`: `bitrix` (clientes REST/OAuth), `crypto`, `http` (erros, `asyncHandler`), `infra` (prisma, redis, fila), `observability` (log, métricas).
- `src/docs/`: catálogo de erros e contrato OpenAPI (fonte de `docs/api/*.json`). `src/config/`: `env.ts` e `spa-config.ts` (IDs dos SPAs/campos UF).
- `web/backoffice`: servido pela API em `/backoffice` (mesma origem de `/admin/*`); só o `dist` entra na imagem Docker.
- Fonte de verdade comercial: SPAs do portal Bitrix (produtos 1134, planos 1138, instalações 1060, assinaturas 1142, itens 1146); MySQL guarda o estado técnico.

Fluxo típico de rota: parser da rota → auth (`appAuth`/`adminAuth`/token Bitrix) → schema zod do serviço → serviço em `application/` → `HttpError` → `errorMiddleware` → `{ error: { code, message, details } }`.

## Convenções

- Prettier: sem `;`, aspas simples, `trailingComma: all`, `arrowParens: avoid`, 80 colunas.
- Imports com alias `@/` (= `src/`) e `@/prisma/*` (= `prisma/generated/prisma/*`).
- Erros: serviços lançam `HttpError` via atalhos (`badRequest`, `notFound`, `conflict`, `upstream`…) de `src/shared/http/errors.ts`. O `code` é estável e é o contrato com os apps; nunca decida por mensagem.
- Corpos validados com schemas zod exportados pelos serviços; handlers async dentro de `asyncHandler`.
- Consultas de app sempre filtradas pelo `appCode` da chave; recurso alheio responde 404.
- Testes ao lado do código (`*.test.ts`), de integração via `http(h)` (`src/test/app.ts`) com `harness` e dublês em memória (`FakePrisma`, `FakeCrm`, `FakeGateway`, relógio controlado); não há banco real nos testes. Cada resposta JSON é conferida contra o OpenAPI e falha no `afterEach`.
- Comentários e mensagens em português. Commits no estilo Conventional Commits em português (`feat(billing): …`, `fix(backoffice): …`).

## Regras importantes

- Nunca commitar `.env` (ignorado) nem segredos. Perder `TOKEN_ENCRYPTION_KEY` = perder todos os tokens guardados.
- Nunca editar `prisma/generated/` (ignorado, gerado) nem `sdk/typescript/src/generated/openapi.ts` (use `yarn sdk:types`).
- Não editar à mão `docs/api/*.json` nem `docs/technical/error-codes.md`: rode `yarn docs:openapi`. Testes falham se estiverem defasados.
- Migrations: nunca alterar as já existentes em `prisma/migrations/`; crie nova. O CI aplica todas num MySQL real e falha se `schema.prisma` divergir (`prisma migrate diff --exit-code`).
- Rota nova, campo de resposta, código de erro, evento ou variável de ambiente exigem atualizar o contrato/docs (tabela "Manter a documentação" em `docs/technical/README.md`). Respostas são `strictObject`: campo não declarado quebra o teste.
- Mudou `docs/api/openapi.json` → rode `yarn sdk:types` no mesmo PR. Mudou `openapi-admin.json` → `yarn gen:api` em `web/backoffice`.
- Nunca logar token, chave, cookie, segredo ou corpo cru (ver `REDACT_PATHS` e `docs/technical/security.md`). Segredo/TOTP não vai para auditoria.
- Comparação de segredo: `safeEqual`. O prefixo de `STRIPE_SECRET_KEY` (`sk_live_`/`rk_live_`) decide qual campo de preço do SPA 1138 vale; nunca usar o preço do outro ambiente como fallback.
- `BITRIX_TLS_REJECT_UNAUTHORIZED=false` só em dev (o boot recusa em produção).
- Dependências do `web/backoffice` não entram na raiz (e vice-versa).
- Não chamar Stripe/portal Bitrix reais nem criar registros em contas de teste/produção sem confirmação do usuário.
- Mudanças de comportamento seguem o fluxo OpenSpec (`openspec/changes/…`, comandos `/opsx:*`); specs vigentes em `openspec/specs/`.

## Como verificar antes de dar a tarefa por pronta

```bash
yarn lint && yarn check-types && yarn test
yarn docs:openapi    # se mexeu em rotas/erros/eventos/env; conferir git diff dos arquivos gerados
yarn sdk:build       # se mexeu em docs/api ou no SDK (o CI roda)
# se mexeu em web/backoffice, dentro dele:
yarn check:api && yarn lint && yarn check-types && yarn test && yarn build
```

CI (`.github/workflows/ci.yml`): jobs `ci` (lint, tipos, `sdk:build`, testes), `web`, `migrations` e, em push, build da imagem e deploy. Push em `develop` → staging; em `main` → produção. Não dê push sem pedido explícito.

## Pontos a confirmar

- Como gerar migration nova em dev: só existe `prisma:migrate` (`migrate deploy`); presumo `npx prisma migrate dev --name …`, mas não está documentado.
- `yarn lint`/`check-types` da raiz não cobrem `web/` (excluído do eslint); o CI roda separado. Confirmar se é intencional.
- Versões de Node diferem (API 20, web 22); confirmar qual usar localmente para os dois.
- `next-day.md` (ignorado no git) parece anotação pessoal; não é referência do projeto.
- Se `main` e `develop` exigem PR (os commits recentes sugerem PR de `feat/*` → `develop`).
- `.env.example` contém um valor preenchido em `TOKEN_ENCRYPTION_KEY`; confirmar se é chave só de dev.
