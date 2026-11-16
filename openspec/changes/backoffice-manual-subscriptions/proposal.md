# Proposal

## Why

O financeiro trata muitos clientes com bonificação e cobrança por boleto ou contrato. Esses casos são assinaturas `manual`, que hoje o comercial cria à mão no SPA 1142 do Bitrix, sem validação, sem auditoria e sem garantia de que a assinatura aponta para a instalação e o plano certos. Uma assinatura criada errada só aparece quando o app deixa de liberar o acesso. É a parte 1 de 3; as partes seguintes (webhook de entrada de pagamento e webhook de saída cadastrável) têm propostas próprias.

## What Changes

- Nova rota de operador `POST /admin/installations/{id}/subscriptions` que cria uma assinatura `manual` (cobrança manual ou bonificação) no SPA 1142, já `active`, e emite `subscription.activated` para o app.
- Regra de **uma assinatura vigente por instalação**: `active` ou `past_due` bloqueia a criação; um trial em andamento é substituído (cancelado) e o evento traz `previousSubscriptionId`.
- A criação relê o item do SPA para confirmar que os campos foram gravados; se divergir, não emite evento e devolve erro com o id do item criado.
- A escrita só roda em produção (`PLATFORM_ENVIRONMENT=production`), como o catálogo.
- Bonificação exige o responsável que a autorizou; o rastro dela é o título, um comentário na linha do tempo da assinatura e a auditoria. Nenhum campo novo no SPA.
- Detalhe da instalação no backoffice ganha o botão e o diálogo "Nova assinatura" (só `operator`).
- Três códigos de erro novos: `SUBSCRIPTIONS_READ_ONLY`, `INVALID_PERIOD`, `SUBSCRIPTION_WRITE_FAILED`.

Fora do escopo: mais de uma assinatura por instalação, trocar Stripe por manual (ou o contrário), renovar/editar/cancelar manual pela tela, campo novo no SPA, emitir boleto.

## Capabilities

### New Capabilities
- `manual-subscriptions`: criação, regras e rastro de assinaturas manuais e bonificações pelo backoffice (rota, validações, evento, auditoria, ambiente).

### Modified Capabilities
- `backoffice-web`: novo requisito para a ação "Nova assinatura" no detalhe da instalação (visibilidade por papel e estado, formulário e tratamento de erros).

## Impact

- Código: `src/modules/billing/application/` (serviço novo), `src/modules/billing/http/` (rota nova), `src/modules/backoffice/http/policy.ts`, `src/container.ts`, `src/app.ts`, `src/docs/` (OpenAPI e catálogo de erros), `web/backoffice/src/features/installation-detail/`.
- API: contrato `openapi-admin.json` ganha uma operação; o catálogo de erros ganha três códigos e `SUBSCRIPTION_ALREADY_EXISTS` passa a cobrir também assinatura manual.
- Sistemas: escreve no SPA 1142 do Bitrix. Antes de ir à produção é preciso confirmar com `crm.item.fields` que não há outro campo obrigatório no SPA.
- Docs: `docs/technical/billing.md` e `docs/operations/runbook.md`.
- Referências: `docs/superpowers/specs/2026-11-16-manual-subscriptions-design.md` e `docs/superpowers/plans/2026-11-16-manual-subscriptions.md`.
