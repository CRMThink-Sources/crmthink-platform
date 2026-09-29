## Context

`sdk/typescript/index.ts` é um arquivo único (≈250 linhas) com `verifyPlatformSignature`, `shouldApply`, `createSessionVerifier` e `PlatformTokenClient`, e tipos escritos à mão (`PlatformEvent.data` é `Record<string, unknown>`). O teste `sdk/typescript/index.test.ts` valida o SDK contra a implementação real da plataforma (importa `@/shared/crypto/...`, `SigningKeys`, `FakePrisma`), então precisa continuar rodando no vitest da raiz. O repositório não usa workspaces: `jose` já está nas dependências da raiz, e `tsconfig.json`/`vitest.config.mts` incluem `sdk/**`.

O contrato público está em `docs/api/openapi.json` (OpenAPI 3.1, gerado por `yarn docs:openapi` e protegido por testes de deriva em `src/docs/openapi/openapi.test.ts`). Ele declara 13 operações com `security: appApiKey` (tags *Tokens* e *Cobrança*), `components.schemas` para requisições, respostas e cada evento (`SubscriptionRenewedEvent`, ...), e `webhooks` para os 18 tipos de evento e o `installer`. O envelope de erro é `components.schemas.Error`.

## Goals / Non-Goals

**Goals:**
- Tipos do SDK nunca escritos à mão para o que o contrato já descreve.
- API atual do SDK preservada: quem copiou a pasta troca pelo pacote sem reescrever código.
- Pacote sem nenhum import da plataforma, verificável no build.

**Non-Goals:**
- Helper de navegador para `POST /v1/sessions` (o SDK usa `node:crypto`; o frontend segue com `fetch` direto, como no guia).
- Rotas de operador (`/admin/*`, trial manual), instalação e webhooks recebidos: não são chamadas por apps.
- Retentativas automáticas, circuit breaker ou fila no cliente.
- Suporte a CommonJS ou Node < 20.

## Decisions

### 1. Tipos gerados com `openapi-typescript`
`yarn sdk:types` roda `openapi-typescript` sobre `docs/api/openapi.json` e grava `sdk/typescript/src/generated/openapi.ts` (versionado, fora do lint e do prettier). Os tipos públicos do SDK são aliases desse arquivo (`components['schemas']['CurrentSubscription']`, corpo de requisição de `paths[...]`), e `PlatformEvent` é a união dos schemas `*Event`.
- *Alternativa*: gerar direto dos schemas zod da plataforma. Rejeitada: acoplaria o pacote ao código da plataforma, e o `openapi.json` já é a fonte oficial para apps.
- *Alternativa*: cliente gerado (`openapi-fetch`, orval). Rejeitada: acrescenta dependência de execução e esconde o cache/refresh de token e o tratamento de erro, que são o valor do SDK.

### 2. Tabela de operações como fonte do cliente
`client.ts` declara `OPERATIONS = { listPlans: { method: 'GET', path: '/v1/plans' }, ... } as const satisfies Record<string, { method; path: keyof paths }>`, com chave igual ao `operationId`. Cada método do `PlatformClient` usa a sua entrada, então caminho inexistente no contrato não compila, e o teste de deriva compara a tabela com as operações `appApiKey` do `openapi.json` (conjunto de `operationId`, método e caminho). Nomes dos métodos = `operationId`, o que liga o SDK à referência em `/docs` sem tradução.

### 3. `PlatformClient` com opções em objeto
`new PlatformClient({ platformUrl, apiKey, fetch?, now?, timeoutMs? })`, `timeoutMs` padrão de 10 s via `AbortSignal.timeout`. Um `request` interno monta URL (parâmetros de caminho e query), Bearer, JSON, e trata `204`. Erros:
- `PlatformError` (já existe) ganha `details`; `code` vem do envelope ou `HTTP_<status>`.
- `PlatformRequestError` novo, com `kind: 'timeout' | 'network'`, para falhas sem resposta HTTP.
Tokens: mesmo cache até `expiresAt − 5 min` e `refresh` pela plataforma; `get` concorrente da mesma instalação passa a compartilhar a mesma promessa em voo, para não disparar N buscas no arranque do app. `PlatformTokenClient` vira um invólucro fino com o construtor posicional atual.

### 4. Layout e build do pacote
`sdk/typescript/` passa a ter `package.json` (`@crmthink/platform-sdk`, `type: module`, `exports` → `dist/index.js` + `dist/index.d.ts`, `files: ["dist"]`, `engines.node >= 20`, `dependencies: { jose }`, `publishConfig` do GitHub Packages), `README.md`, `tsconfig.build.json` (`NodeNext`, `declaration`, `rootDir: src`, exclui `*.test.ts`) e `src/` dividido em `signature.ts`, `session.ts`, `events.ts`, `client.ts`, `index.ts` e `generated/`. Imports relativos com extensão `.js`. Testes ficam em `sdk/typescript/test/` e continuam no vitest da raiz, podendo importar a plataforma. O build de `tsc -p sdk/typescript/tsconfig.build.json` falha se algo em `src/` importar `@/`, porque o `tsconfig` do pacote não conhece o alias.
- *Alternativa*: workspaces do yarn. Rejeitada por ora: muda instalação, Docker e CI da plataforma por um pacote com uma dependência.

### 5. Versão e publicação
Primeira versão publicada `1.0.0` (a união de eventos tipada já é incompatível com quem atribui `type` livre). Publicação por workflow disparado em tag `sdk-v<versão>`, que confere tag = `version` do `package.json`, roda testes do SDK, build e `npm publish` no GitHub Packages da organização `CRMThink-Sources` com o `GITHUB_TOKEN`.

## Risks / Trade-offs

- [Mudança no contrato quebra apps ao atualizar o pacote] → versão maior em mudança incompatível; o teste de tipos desatualizados obriga a regenerar no mesmo PR que muda o contrato, então a quebra aparece na revisão.
- [Saída do `openapi-typescript` muda entre versões e dispara o teste de deriva] → versão fixa (sem `^`) na devDependency.
- [Tipos gerados ficam verbosos para o usuário] → aliases nomeados exportados por `index.ts`; o arquivo gerado não é importado diretamente pelos apps.
- [GitHub Packages exige token até para instalar] → documentar `.npmrc` com `@crmthink:registry` e token de leitura no guia de integração.

## Migration Plan

1. Mesclar com o pacote em `1.0.0` e publicar a tag `sdk-v1.0.0`.
2. GPTMaker instala `@crmthink/platform-sdk`, apaga a pasta copiada e ajusta imports; nomes atuais continuam existindo.
3. Rollback: o app volta à versão anterior do pacote ou à pasta copiada; nada muda na plataforma.
