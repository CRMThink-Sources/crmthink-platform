## Why

O comercial precisa dos dados de contato de quem testa um app para acompanhar o trial e converter em assinatura, mas a instalação não coleta dados (regra do marketplace do Bitrix) e hoje o trial só nasce sozinho na instalação ou pela rota de operador `POST /v1/installations/{id}/trial`, que não recebe corpo. Na prática, só instalações migradas do hub-core têm contato, e o checkout fica sem `customerEmail` para as demais.

## What Changes

- **BREAKING (operador)**: `POST /v1/installations/{id}/trial` deixa de ser rota de operador e passa a ser rota do app (`appApiKey`), restrita às instalações do próprio app. O corpo traz o contato obrigatório: nome, e-mail, telefone/WhatsApp, empresa e cargo.
- A solicitação grava o contato e:
  - inicia o trial quando a instalação nunca usou trial e não tem assinatura aberta (`201`);
  - só registra o contato quando já existe trial `trialing`, por exemplo o criado por `trial_on_install` (`200`, devolvendo o trial corrente);
  - registra o contato e responde `TRIAL_ALREADY_USED` ou `SUBSCRIPTION_ALREADY_EXISTS` quando não cabe trial.
- O contato é gravado nos campos do item da instalação no SPA 1060, que já existem (nome, e-mail, telefone e empresa), mais um campo novo de cargo. Também vai para a coluna `installation.contact` do banco, que o checkout já usa para preencher o e-mail no Stripe.
- A rota de operador muda para `POST /admin/installations/{id}/trial`, com o mesmo comportamento de hoje e corpo de contato opcional.
- O trial automático na instalação (`trial_on_install`) continua igual.
- O SDK ganha o método `requestTrial`, e o contrato OpenAPI, o catálogo de erros e a documentação são atualizados.

## Capabilities

### New Capabilities
- `trial-request`: solicitação de trial pelo app com dados de contato. Cobre a validação do contato, a gravação no SPA 1060 e no banco, a convivência com o trial automático e a rota de operador em `/admin`.

### Modified Capabilities
- `api-reference`: o requisito "Esquemas de segurança descritos" passa a exigir `appApiKey` em `POST /v1/installations/{id}/trial`. O `adminToken` passa a valer só em `/admin/*`, o que inclui o novo `POST /admin/installations/{id}/trial`.

O requisito "Trial" de `subscription-lifecycle` ainda vive na mudança em andamento `crmthink-platform` e diz que a rota "MUST existir apenas como rota administrativa". Esse texto precisa ser ajustado lá (tarefa desta mudança) antes de arquivar as duas.

## Impact

- **Código**:
  - `src/modules/registry/http/admin-routes.ts`: rota de operador vai para `/admin/installations/:id/trial`.
  - `src/modules/billing/http/routes.ts`: nova rota do app.
  - `src/modules/billing/application/trial-service.ts`: solicitação com contato.
  - `src/modules/installations/infra/installation-spa.ts`: grava o contato.
  - Diretório de instalações: grava `contact`.
  - `src/config/spa-config.ts`: campo `role` (cargo).
- **Portal CRMThink**: criar o campo UF de cargo no SPA 1060 e confirmar o código dele na configuração. Esse campo também entra na checagem de `crm.item.fields` no boot.
- **API/SDK**: `docs/api/openapi.json`, `docs/api/openapi-admin.json`, `sdk/typescript` (tipos gerados e `requestTrial`) e uma versão nova do pacote.
- **Operação**: scripts ou rotinas que chamam a rota de operador antiga precisam trocar para `/admin/installations/{id}/trial`.
- **Docs**: `docs/technical/billing.md`, `docs/apps-integration.md`, `docs/technical/error-codes.md`, `docs/technical/security.md`.
