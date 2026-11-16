# Tasks

## 1. Dados e credenciais das integrações

- [x] 1.1 Criar o branch `feat/payment-webhook-intake` (a partir de `feat/manual-subscriptions`, pois a parte 1 ainda não está em `develop`) e verificar com `git branch --show-current`
- [x] 1.2 Acrescentar os modelos `PaymentIntegration` (nome, hash e prefixo da chave, ativo, último uso, criação) e `PaymentNotice` (integração, `externalId`, assinatura, instalação, período, `paidAt`, estado `pending`/`applied`, datas; único por integração + `externalId`) em `prisma/schema.prisma`, gerar a migração aditiva e os dois modelos em `src/test/fake-prisma.ts`; verificar com `yarn check-types` e que `yarn prisma:migrate` aplica a migração num banco limpo (migração gerada pelo Prisma a partir da diferença dos schemas; aplicá-la num banco limpo não foi verificado localmente)
- [x] 1.3 Escrever os testes do serviço de integrações (criar devolve a chave uma vez e guarda só o hash, listar mostra só o prefixo, rotacionar invalida a antiga na hora, desativar bloqueia, autenticar registra o último uso, chave desconhecida e integração inexistente) e verificar que falham
- [x] 1.4 Implementar `PaymentIntegrations` em `src/modules/billing/application/payment-integrations.ts` e ligá-lo em `container.ts`, mais os códigos `PAYMENT_INTEGRATION_NOT_FOUND` e `INTEGRATION_INACTIVE` em `src/docs/errors.ts`; verificar que os testes da 1.3 passam

## 2. API de operador das integrações

- [x] 2.1 Escrever os testes HTTP de `/admin/payment-integrations` (viewer lista e não escreve, criar exige motivo e devolve a chave uma vez, rotacionar e desativar exigem motivo, renomear e reativar não, 404 inexistente, a auditoria tem alvo `payment_integration` e não contém a chave) e verificar que falham
- [x] 2.2 Implementar `admin-payment-integration-routes.ts`, montá-la em `app.ts`, acrescentar as entradas em `policy.ts` e em `reason.test.ts`, e declarar operações, schemas e erros em `src/docs/openapi`; rodar `yarn docs:openapi` e `yarn sdk:types` e verificar que `yarn vitest run src/docs src/modules/backoffice src/modules/billing sdk` passa

## 3. Serviço de aviso de pagamento

- [x] 3.1 Escrever os testes do serviço (renovação calculada por mensal, trimestral, semestral e anual; `periodEnd` informado; `past_due` volta a `active`; por `installationId`; um único `subscription.renewed`; duplicado devolve `duplicate: true` sem nova escrita; `externalId` reaproveitado; reenvio depois de queda entre a escrita e a marcação conclui o período já decidido; assinatura Stripe, cancelada, trial e inexistente; fim não posterior, mais de 24 meses e plano sem intervalo sem `periodEnd`; fora da produção; comentário falho não desfaz; anti-loop com `ManualLifecycle.apply`) e verificar que falham
- [x] 3.2 Implementar `PaymentNoticeService` em `src/modules/billing/application/payment-notice-service.ts` com o registro `pending` antes da escrita, ligá-lo em `container.ts` e acrescentar `NOT_MANUAL_SUBSCRIPTION`, `SUBSCRIPTION_NOT_RENEWABLE` e `EXTERNAL_ID_REUSED` em `src/docs/errors.ts`; verificar que os testes da 3.1 passam

## 4. Rota pública `POST /webhooks/payments`

- [x] 4.1 Escrever os testes HTTP da rota (200 com o corpo do contrato, 401 sem chave e com chave de app ou de operador, 403 `INTEGRATION_INACTIVE`, 400 para corpo inválido ou com campo desconhecido, os erros 404/409/422 do serviço, o último uso da integração, a chave ausente dos logs) e verificar que falham
- [x] 4.2 Implementar o middleware de autenticação por chave de integração e `payment-webhook-routes.ts` (JSON de até 16 KB), montá-los em `app.ts` fora do `adminGate` e do `appAuth`, e acrescentar a métrica `platform_payment_notices_total{outcome}` em `src/shared/observability/metrics.ts`; verificar que os testes da 4.1 passam
- [x] 4.3 Declarar a operação e o esquema `paymentIntegrationKey` no contrato, rodar `yarn docs:openapi` e `yarn sdk:types`, e atualizar `docs/technical/billing.md`, `docs/technical/security.md` e `docs/operations/runbook.md` (como criar a integração, o que enviar, o significado de `externalId`, o aviso sobre editar o SPA à mão, como achar avisos `pending`); verificar que `yarn vitest run src/docs sdk` passa e que os códigos citados batem com `docs/api/openapi.json`

## 5. Tela "Integrações de pagamento"

- [x] 5.1 Rodar `yarn gen:api` em `web/backoffice` e verificar que os schemas das integrações existem em `src/api/schema.d.ts` e que `yarn check:api` passa
- [x] 5.2 Escrever os testes da tela (item no menu para todos os papéis, lista sem ações para `viewer`, criação com a chave exibida uma vez e ausente do cache depois de fechar, rotação, desativação com motivo obrigatório, erros no diálogo) e verificar que falham
- [x] 5.3 Implementar a feature `payment-integrations` (página, diálogos, rota `/payment-integrations`, item em `nav.ts`, `INVALIDATES` e descrição da página); verificar com `yarn test`, `yarn check-types` e o ESLint dos arquivos novos em `web/backoffice`

## 6. Integração

- [x] 6.1 Rodar `yarn check-types`, `yarn test` e o ESLint dos arquivos alterados na raiz, mais `yarn docs:openapi` e `yarn sdk:types` sem diff, e verificar que tudo passa
- [x] 6.2 Rodar `openspec validate payment-webhook-intake --strict` e verificar que não há erros
- [ ] 6.3 Em produção, criar uma integração de teste, enviar um aviso para uma instalação de teste com assinatura manual e verificar o período novo no SPA, o `subscription.renewed` no app, o comentário na assinatura e a repetição com `duplicate: true`; só então entregar a chave ao remetente real
