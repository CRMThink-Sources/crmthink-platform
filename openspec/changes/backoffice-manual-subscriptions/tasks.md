# Tasks

Passo a passo detalhado, com assinaturas e nomes de teste: `docs/superpowers/plans/2026-11-16-manual-subscriptions.md`.

## 1. Serviço de criação

- [x] 1.1 Criar o branch `feat/manual-subscriptions` a partir de `develop` e verificar com `git branch --show-current`
- [x] 1.2 Escrever os testes do serviço em `src/modules/billing/manual-subscription.test.ts` (criação manual e bonificação, trial substituído, bloqueio por `active`/`past_due`, período, plano inválido, só produção, instalação inválida, releitura divergente, falha de comentário, anti-loop) e verificar que falham por o serviço não existir
- [x] 1.3 Implementar `ManualSubscriptionService` e o schema do corpo na ordem do design (validar, lock, criar sem evento, reler, emitir `subscription.activated`, cancelar trial, comentar) e verificar que `yarn vitest run src/modules/billing/manual-subscription.test.ts` passa
- [x] 1.4 Registrar `SUBSCRIPTIONS_READ_ONLY`, `INVALID_PERIOD` e `SUBSCRIPTION_WRITE_FAILED` em `src/docs/errors.ts`, ajustar `SUBSCRIPTION_ALREADY_EXISTS` e fiar o serviço em `src/container.ts`; verificar com `yarn vitest run src/modules/billing` e `yarn check-types`

## 2. Rota, política e contrato

- [x] 2.1 Escrever `src/modules/billing/manual-subscription-http.test.ts` (201 e corpo do contrato, `viewer` 403, sem motivo 400, bonificação sem responsável 400, corpo com campo extra 400, homologação 409, instalação inexistente 404, auditoria com alvo `installation` e ação na linha do tempo) e verificar que falha
- [x] 2.2 Implementar `adminSubscriptionRoutes`, montá-la em `src/app.ts` e adicionar a entrada `POST /admin/installations/:id/subscriptions` em `policy.ts` (`operator`, alvo instalação, alto impacto); verificar que o teste da 2.1 passa
- [x] 2.3 Adicionar a operação `createManualSubscription` e o schema de resposta ao contrato, rodar `yarn docs:openapi` e verificar que `yarn vitest run src/docs src/modules/backoffice src/modules/billing` passa (política, contrato e catálogo de erros em dia)
- [x] 2.4 Atualizar `docs/technical/billing.md` (seção "Assinatura manual") e `docs/operations/runbook.md` (como criar, e o que fazer no `502 SUBSCRIPTION_WRITE_FAILED`) e verificar que os códigos e a rota citados batem com `docs/api/openapi-admin.json`

## 3. Diálogo no backoffice web

- [x] 3.1 Rodar `yarn gen:api` em `web/backoffice` e verificar que `Schemas['CreateManualSubscription']` existe em `src/api/schema.d.ts` e que `yarn check:api` passa
- [x] 3.2 Escrever `manual-subscription-dialog.test.tsx` (visibilidade por papel e estado, lista de planos filtrada, campo de responsável só na bonificação, envio com cabeçalho de motivo, validação do período no cliente, tratamento dos erros 409 e `INVALID_PERIOD`) e verificar que falha
- [x] 3.3 Implementar `manual-subscription-dialog.tsx` e ligar o botão em `installation-detail/actions.tsx`; verificar com `yarn test`, `yarn lint` e `yarn check-types` em `web/backoffice`

## 4. Integração

- [x] 4.1 Rodar `yarn lint`, `yarn check-types` e `yarn test` na raiz e verificar que passam e que `yarn docs:openapi` não deixa diff
- [ ] 4.2 Com o dono do portal, chamar `crm.item.fields` no SPA 1142 e verificar que não há outro campo obrigatório além dos gravados pelo mapeador e que o webhook de entrada pode criar itens; se houver, parar e registrar o achado antes de produção
- [x] 4.3 Rodar `openspec validate backoffice-manual-subscriptions --strict` e verificar que não há erros
