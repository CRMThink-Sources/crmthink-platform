## Why

Com o GPTMaker migrado para TypeScript, `sdk/typescript` passou a ser o único SDK da plataforma, mas ele só cobre assinatura HMAC, sessão do iframe e tokens do Bitrix. As rotas servidor-a-servidor de instalações e cobrança (planos, assinatura, checkout, portal, troca de plano, itens) e o `data` de cada evento não têm cliente nem tipos: cada app escreve `fetch` à mão e lê `docs/api/openapi.json` para descobrir campos, e nada avisa quando o contrato muda. O SDK também só existe como pasta para copiar, sem versão.

## What Changes

- Cliente `PlatformClient` com um método por operação autenticada por chave de app do contrato público: `listInstallations`, `getInstallation`, `getInstallationToken`/`refreshInstallationToken` (com o cache e a renovação única que já existem), `listPlans`, `getSubscription`, `createCheckoutSession`, `createBillingPortalSession`, `changePlan`, `listItems`, `createItem`, `updateItem`, `removeItem`.
- Erros da plataforma como `PlatformError` com `status`, `code` estável, `message` e `details`; timeout configurável por requisição.
- Tipos de requisição, resposta e eventos derivados do `docs/api/openapi.json`, gerados em arquivo versionado. `PlatformEvent` vira união discriminada por `type`, com o `data` tipado de cada evento; o payload do instalador também ganha tipo.
- `PlatformTokenClient` continua exportado, delegando ao `PlatformClient`, para não quebrar quem já copiou o SDK.
- Empacotamento como `@crmthink-sources/platform-sdk`: `package.json` próprio (ESM, Node ≥ 20, `jose` como única dependência), build para `dist/` com declarações, versão semântica e publicação no GitHub Packages da organização.
- Testes de deriva: toda operação `appApiKey` do contrato público tem método no SDK e vice-versa (mesmo método HTTP e caminho); os tipos gerados batem com o `openapi.json` versionado; todo tipo de evento do contrato está na união `PlatformEvent`.
- `docs/apps-integration.md` passa a documentar a instalação do pacote e o uso do `PlatformClient` nas seções de tokens e cobrança.

Nenhuma mudança nas rotas da plataforma.

## Capabilities

### New Capabilities
- `platform-sdk`: SDK TypeScript oficial para apps — verificação de assinatura, sessão do iframe, cliente das rotas servidor-a-servidor, tipos do contrato e dos eventos, empacotamento e garantias de que não diverge do contrato OpenAPI.

### Modified Capabilities
<!-- Nenhuma: o comportamento da API não muda; `api-reference` segue sendo a fonte dos tipos. -->

## Impact

- **Código**: `sdk/typescript/` (reorganizado em `src/`, `package.json`, `tsconfig` de build, tipos gerados), script `yarn sdk:types` e `yarn sdk:build`.
- **Dependências**: `openapi-typescript` como devDependency da raiz, só para gerar tipos.
- **CI**: `ci.yml` passa a compilar o pacote; novo workflow de publicação por tag `sdk-v*`.
- **Apps**: GPTMaker troca a pasta copiada pelo pacote; API existente do SDK mantida.
- **Docs**: `docs/apps-integration.md`, `README.md`.
