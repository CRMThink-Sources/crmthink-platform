# crmthink-platform

Serviço único que padroniza, para todas as aplicações CRMThink, a **instalação no
Bitrix24** (página de instalação, verificação no servidor, cofre de tokens, sessão do
iframe, desinstalação) e a **cobrança** (Stripe + Smart Processes do portal CRMThink).
Especificação: `openspec/changes/crmthink-platform/`.

- **api** (`src/api.ts`): HTTP — página `/install/{appCode}`, `/v1/*`, JWKS, eventos do
  Bitrix, webhook Stripe, `/health`, `/metrics`.
- **worker** (`src/worker.ts`): filas (Stripe, SPAs) e agendamentos (renovação de tokens,
  entrega de eventos aos apps, trials, avisos de fim de período, varreduras).
- Módulos: `registry` (apps, chaves), `installations`, `billing`, `events` (outbox e
  entrega). O `billing` só enxerga instalações pela porta `InstallationDirectory`.

Stack: Node 20, TypeScript, Express, zod, Prisma 7 (MySQL), BullMQ/Redis, pino/Loki,
vitest.

## Desenvolvimento

```bash
docker compose up -d mysql redis
cp .env.example .env            # preencher TOKEN_ENCRYPTION_KEY e JWT_SIGNING_PRIVATE_KEY
yarn install
yarn prisma:migrate
yarn dev:api                    # :4100
yarn dev:worker
```

| Script | |
| --- | --- |
| `yarn test` | testes (unitários e de fluxo com Prisma, Bitrix, Stripe e apps em memória) |
| `yarn lint` / `yarn check-types` | |
| `yarn build` | `dist/` |
| `yarn test:stripe` | integração com Stripe CLI contra uma instância rodando |
| `yarn docs:openapi` | regera `docs/api/*.json` e `docs/technical/error-codes.md` |
| `yarn admin:generate-encryption-key` | chave AES-256 para `TOKEN_ENCRYPTION_KEY` |
| `yarn admin:rotate-signing-key` | nova chave do JWT (também por `POST /admin/signing-keys/rotate`) |
| `yarn tsx scripts/import-hub-core.ts` | importação de instalações do hub-core (dry-run por padrão) |

## Documentação

- **Referência da API** (OpenAPI 3.1): `GET /docs` (navegável) e `GET /openapi.json` na
  própria API; arquivos em `docs/api/openapi.json` (apps) e `docs/api/openapi-admin.json`
  (com rotas de operador). Gerados de `src/docs/` por `yarn docs:openapi` — os testes falham
  se ficarem desatualizados.
- `docs/technical/` — documentação técnica: arquitetura, ciclo da requisição, segurança,
  modelo de dados, fluxos, filas, observabilidade, configuração e catálogo de erros.
- `docs/apps-integration.md` — contrato para os apps (instalador, eventos, tokens,
  sessão, cobrança) e SDK em `sdk/typescript`.
- `docs/operations/runbook.md` — provisionamento, TLS, webhook do portal, alertas,
  procedimentos. Regras Prometheus em `ops/prometheus-alerts.yml`.
- `docs/onboarding/gptmaker.md` — campos dos SPAs, produtos, apps Bitrix, cadastro e
  roteiro ponta a ponta.
- `docs/migration/hub-core.md` — mapeamento, importação, corte e checklist de segurança.
