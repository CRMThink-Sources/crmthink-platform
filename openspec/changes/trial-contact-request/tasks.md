## 1. Pré-requisitos e configuração

- [ ] 1.1 Criar o campo UF de cargo no SPA 1060 do portal CRMThink (homologação e produção) e anotar o código de leitura; verificar com `crm.item.fields` (entityTypeId 1060) que o campo aparece nos dois ambientes
- [x] 1.2 Adicionar `installation.role` ao schema e aos padrões de `src/config/spa-config.ts` e incluí-lo na conferência de campos (`validateSpaConfig`, exposta em `/health/ready`); verificar com teste que campo ausente ou criado como lista aparece nos problemas do SPA 1060
- [x] 1.3 Ajustar o requisito "Trial" de `openspec/changes/crmthink-platform/specs/subscription-lifecycle/spec.md`: tirar "apenas como rota administrativa", apontar a rota de operador para `/admin/installations/{id}/trial` e citar a solicitação pelo app (`trial-request`); verificar com `openspec validate crmthink-platform` e `openspec validate trial-contact-request`

## 2. Gravação do contato

- [x] 2.1 Adicionar `role?: string` a `InstallationContact` e `saveContact(installationId, contact)` à porta `InstallationDirectory`, com implementação Prisma (substitui `contact` inteiro) e no `fake-prisma` de testes; verificar com teste que grava e relê o contato via `get`
- [x] 2.2 Adicionar `InstallationSpa.updateContact(itemId, contact)` gravando nome, e-mail, telefone, empresa e cargo (sem enviar vazios); verificar com teste usando o cliente Bitrix falso que o `updateItem` recebe os cinco códigos de campo esperados
- [x] 2.3 Atualizar o comentário de `ports.ts` ("só existe em instalações migradas") e a seção de dados em `docs/technical/data-model.md` para descrever a origem do contato (importação do hub-core ou solicitação de trial); verificar lendo o diff

## 3. Serviço de solicitação

- [x] 3.1 Criar `trialRequestSchema` (zod: `name`, `email`, `phone`, `company`, `role`, com `trim`, `min(1)`, `max(200)` e e-mail válido) em `billing/application/trial-service.ts`; verificar com testes HTTP cobrindo campo ausente, vazio só com espaços e e-mail inválido
- [x] 3.2 Implementar `TrialService.request` conforme o design (posse por app ou operador, `TRIAL_NOT_CONFIGURED` antes de gravar, dentro do lock: gravar contato → trial vigente (200 no app, `TRIAL_ALREADY_USED` no operador) → `TRIAL_ALREADY_USED` → criar), seguido da cópia no SPA com log `warn` sem o corpo em caso de falha; manter `startTrialOnInstall` funcionando; verificar com os testes de `billing.test.ts` atuais do trial passando
- [x] 3.3 Testes do serviço em `billing.test.ts` para cada cenário de `specs/trial-request/spec.md`: primeira solicitação (201 + evento), trial automático já criado (200, sem evento), trial expirado (409 com contato gravado), assinatura paga (409 com contato gravado), app sem trial (422 sem gravar), instalação de outro app (404), duas solicitações simultâneas (um 201 e um 200 com o mesmo `subscriptionId`), falha do SPA (resposta inalterada e log)

## 4. Rotas e contrato

- [x] 4.1 Mover a rota de operador para `POST /admin/installations/:id/trial` em `admin-routes.ts` (removendo o guard do caminho antigo), com corpo de contato opcional; verificar com testes HTTP: operador sem corpo cria trial (201), chave de app em `/admin/...` recebe 401, token de operador em `/v1/installations/{id}/trial` recebe 401
- [x] 4.2 Adicionar `POST /v1/installations/:id/trial` em `appBillingRoutes` (201/200 conforme `created`); verificar com teste HTTP de ponta a ponta com chave de app, incluindo `VALIDATION_ERROR` com `details` apontando o campo
- [x] 4.3 Atualizar o registro de operações (`src/docs/openapi/operations.ts`): operação pública com `appApiKey`, corpo `trialRequestSchema`, respostas 201/200/400/404/409/422, e operação de operador em `/admin/installations/{id}/trial`; atualizar `openapi.test.ts` e `contract-smoke.test.ts`; rodar `yarn docs:openapi` e verificar que `yarn test src/docs` passa e que a operação de operador só aparece em `openapi-admin.json`
- [x] 4.4 Revisar `src/docs/errors.ts` (origem e ação de `TRIAL_ALREADY_USED`, `SUBSCRIPTION_ALREADY_EXISTS`, `TRIAL_NOT_CONFIGURED` agora incluem a rota do app) e regenerar `docs/technical/error-codes.md`; verificar que o teste do catálogo de erros passa

## 5. SDK

- [x] 5.1 Rodar `yarn sdk:types`, adicionar `requestTrial(installationId, contact)` ao `PlatformClient` (entrada na tabela `OPERATIONS`) devolvendo `{ subscriptionId, trialEndsAt }` e se foi criado ou não (201 vs 200), e subir a versão minor do pacote; verificar que o teste de deriva de operações e um teste do método contra `createApp` passam
- [x] 5.2 Documentar `requestTrial` no `sdk/typescript/README.md` e em `docs/apps-integration.md` (quando chamar, campos obrigatórios, tratamento de 200/201/409), e atualizar `docs/technical/billing.md` e `docs/technical/security.md` com a rota do app e o novo caminho da rota de operador; verificar que os exemplos compilam no teste de tipos dos exemplos

## 6. Integração

- [ ] 6.1 Rodar `yarn lint`, `yarn check-types`, `yarn test` e `yarn sdk:build` limpos e `openspec validate trial-contact-request --strict`; em homologação, solicitar trial para uma instalação de teste e verificar o item no SPA 1060 com os cinco campos preenchidos e o checkout com o e-mail informado
