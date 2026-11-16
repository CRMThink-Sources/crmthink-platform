# Proposal

## Why

Hoje, quando um cliente paga o boleto de uma assinatura manual, uma pessoa do financeiro precisa editar o SPA 1142 no Bitrix para estender o período. Enquanto não faz isso, a assinatura vence, o app pode cortar o acesso de quem pagou e o financeiro vira gargalo. A parte 1 (`backoffice-manual-subscriptions`) já cria a assinatura manual pelo backoffice; esta parte 2 de 3 deixa um sistema avisar o pagamento e a plataforma renovar sozinha. A parte 3 (webhook de saída) tem proposta própria.

## What Changes

- Novo endpoint público `POST /webhooks/payments`, autenticado por **chave própria de integração**, que recebe o aviso de um pagamento e renova a assinatura `manual` pelo mesmo caminho de escrita e de evento da renovação feita à mão (`subscription.renewed` ao app).
- O aviso traz um `externalId` (por exemplo, o id do boleto) que o torna **idempotente**: repetir o aviso não renova duas vezes, mesmo que o processo caia no meio.
- O aviso identifica a assinatura por `subscriptionId` ou `installationId` e pode informar o novo fim do período; sem ele, a plataforma calcula pelo intervalo do plano.
- Novas **integrações de pagamento** gerenciadas no backoffice: criar, listar, renomear, desativar e rotacionar a chave. A chave aparece uma única vez e é guardada só como hash.
- Duas tabelas novas: `payment_integration` e `payment_notice` (registro e idempotência de cada aviso).
- Tela "Integrações de pagamento" no backoffice (grupo Operação).
- Novos códigos de erro: `SUBSCRIPTION_NOT_FOUND` já existe e é reaproveitado; entram `NOT_MANUAL_SUBSCRIPTION`, `SUBSCRIPTION_NOT_RENEWABLE`, `EXTERNAL_ID_REUSED`, `INTEGRATION_INACTIVE` e `PAYMENT_INTEGRATION_NOT_FOUND`.

Fora do escopo: avisar atraso ou estorno, emitir boleto, adaptador de banco ou provedor específico, pagamento parcial, assinatura Stripe, webhook de saída (parte 3).

## Capabilities

### New Capabilities
- `payment-webhook`: recebimento autenticado e idempotente de avisos de pagamento, renovação da assinatura manual e gestão das integrações (chaves) pelo operador.

### Modified Capabilities
- `backoffice-web`: nova tela "Integrações de pagamento" (lista, criação com chave exibida uma vez, rotação, desativação).
- `api-reference`: o contrato passa a documentar `POST /webhooks/payments` e as rotas `/admin/payment-integrations`, com o esquema de segurança da chave de integração.

## Impact

- Código: `src/modules/billing/` (serviço de aviso, serviço de integrações, rotas pública e de operador), `src/modules/backoffice/http/policy.ts`, `src/container.ts`, `src/app.ts`, `src/docs/`, `prisma/schema.prisma` e migração, `src/test/fake-prisma.ts`, `web/backoffice/`.
- API: contrato `openapi.json` e `openapi-admin.json` ganham operações e erros; SDK TypeScript regenerado.
- Dados: migração aditiva (duas tabelas novas, sem alterar as existentes).
- Segurança: nova credencial de entrada; só o hash é guardado e a chave nunca volta em respostas, logs nem auditoria.
- Sistemas: escreve no SPA 1142 do Bitrix (mesmo caminho da parte 1).
- Depende de: `backoffice-manual-subscriptions` (já em produção).
