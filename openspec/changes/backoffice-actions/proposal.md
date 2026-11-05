## Why

Com `backoffice-ui`, dev e suporte enxergam o estado da plataforma, mas qualquer correção ainda exige `curl` com o token de script: reenviar eventos, conceder trial, rodar varreduras, cadastrar ou ajustar um app, rotacionar chaves e gerir operadores. Fazer isso pela interface, com confirmação, motivo registrado e pré-visualização do impacto, reduz erro operacional e deixa cada ação rastreável por pessoa.

## What Changes

- Ações na interface, todas só para `operator`, com confirmação:
  - **Eventos**: reenviar um evento; reenviar em lote por filtro (app, período, tipo, só `dead`), com pré-visualização da quantidade antes de confirmar.
  - **Instalações**: conceder trial; forçar a renovação do token do Bitrix.
  - **Varreduras**: rodar a reconciliação do Stripe ou dos SPAs e ver o resultado.
  - **Apps**: cadastrar app (chave de API e segredo de webhook mostrados uma única vez, com cópia); editar a configuração (nome, logo, URLs, escopos, produtos, trial, tema da página de instalação com pré-visualização); ativar ou desativar; rotacionar a chave de API e o segredo de webhook.
  - **Chave de assinatura do JWT**: rotacionar.
  - **Operadores**: listar, criar (senha provisória e QR code do TOTP mostrados uma vez), trocar papel, ativar ou desativar, redefinir acesso.
- Ações de alto impacto (rotação de chave de API, desativação de app, reenvio em lote, rotação da chave do JWT) exigem digitar o identificador do alvo para confirmar.
- Toda ação pede um **motivo** em texto livre, enviado no header `X-Admin-Reason`. Ele é obrigatório nas ações de alto impacto e é gravado no registro de auditoria.
- API, alterações aditivas:
  - `POST /admin/events/resend` aceita `dryRun: true`, que devolve quantos eventos seriam reenviados sem alterar nada, e o filtro `installationId`.
  - Nova `POST /admin/installations/{id}/token/refresh`, que força a renovação e devolve só a nova expiração.
  - A auditoria passa a guardar o motivo.

## Capabilities

### New Capabilities
- `admin-operations`: ações de operador na API que esta mudança acrescenta ou altera: motivo da ação, pré-visualização e filtro por instalação no reenvio, renovação forçada de token e exigência de motivo nas ações de alto impacto.
- `backoffice-web-actions`: ações na interface: controles por tela, confirmações, exibição única de segredos, pré-visualização de impacto e atualização das telas após a ação.

### Modified Capabilities
<!-- Nenhuma em `openspec/specs/`. As capabilities de `backoffice-foundation` e `backoffice-ui` ainda não estarão arquivadas. Os comportamentos novos ficam nas capabilities acima, que referenciam aquelas. -->

## Impact

- **Código (API)**:
  - `src/modules/registry/http/admin-routes.ts` (reenvio com `dryRun` e `installationId`; rota de renovação);
  - `src/modules/events/event-delivery.ts` (contagem sem efeito);
  - `src/modules/installations/application/token-vault.ts` (renovação forçada pelo operador);
  - auditoria de `backoffice-foundation` (motivo).
- **Código (web)**: `web/backoffice/src` (diálogos, formulários de app e de operador, QR code gerado localmente).
- **Contrato**: `docs/api/openapi-admin.json`, tipos regerados no web.
- **Dependência web**: biblioteca de QR code sem chamadas de rede e `react-hook-form` com zod para os formulários.
- **Dependências entre changes**: requer `backoffice-foundation` e `backoffice-ui`.
- **Docs**: `docs/operations/runbook.md` (os procedimentos passam a apontar a tela antes do `curl`) e `docs/technical/security.md` (motivo na auditoria).
