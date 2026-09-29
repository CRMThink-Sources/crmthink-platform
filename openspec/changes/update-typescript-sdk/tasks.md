## 1. Estrutura do pacote

- [ ] 1.1 Mover `sdk/typescript/index.ts` para `src/` dividido em `signature.ts`, `events.ts`, `session.ts`, `client.ts` e `index.ts` (imports relativos com `.js`), e `index.test.ts` para `sdk/typescript/test/`; verificar que `yarn test sdk` passa sem mudar nenhuma asserção
- [ ] 1.2 Criar `sdk/typescript/package.json` (`@crmthink/platform-sdk` 1.0.0, ESM, `exports`, `files: ["dist"]`, `engines`, `jose`, `publishConfig`) e `tsconfig.build.json`; adicionar `yarn sdk:build` e verificar que gera `dist/index.js` e `dist/index.d.ts` sem testes
- [ ] 1.3 Adicionar teste que empacota (`npm pack --dry-run --json`) e confere que só há `dist/`, `package.json` e `README.md`, e que nenhum arquivo de `src/` importa `@/`; verificar que falha ao colocar um import `@/` de propósito

## 2. Tipos do contrato

- [ ] 2.1 Adicionar `openapi-typescript` com versão fixa e `yarn sdk:types`, gerando `sdk/typescript/src/generated/openapi.ts`; excluir o arquivo de eslint/prettier e verificar que `yarn check-types` passa
- [ ] 2.2 Trocar os tipos escritos à mão (`PlatformToken`, `PlatformSubscription`, `SessionClaims` onde couber) por aliases do arquivo gerado e exportar os tipos de planos, assinatura, checkout, portal, itens e instalação; verificar com `yarn check-types`
- [ ] 2.3 Definir `PlatformEvent` como união discriminada dos schemas `*Event` e tipar `InstallerPayload`; adicionar teste de tipos (`expectTypeOf`) mostrando o estreitamento de `data` em `subscription.renewed` e verificar que `shouldApply` continua passando
- [ ] 2.4 Teste de deriva: regenerar os tipos em memória e comparar com o arquivo versionado (mensagem indicando `yarn sdk:types`), e conferir que todo tipo de evento de `webhooks` está na união; verificar que falha ao editar o arquivo gerado

## 3. PlatformClient

- [ ] 3.1 Implementar `request` interno (caminho e query, Bearer, JSON, `204`, `timeoutMs` padrão 10 s), `PlatformError` com `details` e `PlatformRequestError` (`timeout`/`network`); testar com `fetch` falso os cenários de envelope, corpo não-JSON (`HTTP_502`), tempo esgotado e falha de rede
- [ ] 3.2 Declarar a tabela `OPERATIONS` (chave = `operationId`, `satisfies` sobre `paths`) e os métodos de instalações e cobrança (`listInstallations`, `getInstallation`, `listPlans`, `getSubscription`, `createCheckoutSession`, `createBillingPortalSession`, `changePlan`, `listItems`, `createItem`, `updateItem`, `removeItem`); testar contra `createApp` via servidor HTTP real (como o teste atual de tokens) pelo menos planos, checkout, erro `SUBSCRIPTION_ALREADY_EXISTS` e remoção de item com `204`
- [ ] 3.3 Mover cache/refresh de tokens para `PlatformClient` (`getInstallationToken`, `refreshInstallationToken`, `forgetInstallationToken`) com promessa compartilhada para `get` concorrente, e manter `PlatformTokenClient` como invólucro com o construtor atual; verificar que os testes atuais de token passam e que dois `get` simultâneos fazem uma só requisição
- [ ] 3.4 Teste de deriva de operações: comparar `OPERATIONS` com as operações `appApiKey` de `docs/api/openapi.json` (operationId, método, caminho) em ambos os sentidos; verificar que falha nomeando a operação ao remover uma entrada

## 4. Documentação e distribuição

- [ ] 4.1 Escrever `sdk/typescript/README.md` (instalação com `.npmrc` do GitHub Packages, exemplos de assinatura, sessão, tokens, checkout e eventos tipados) e atualizar `docs/apps-integration.md` (seções 2, 4, 5 e cobrança usando o pacote) e `README.md`; verificar que os exemplos compilam copiando-os para um teste de tipos
- [ ] 4.2 Adicionar `yarn sdk:build` ao job de testes do `.github/workflows/ci.yml` e criar workflow de publicação em tag `sdk-v*` (confere tag = versão, testes do SDK, build, `npm publish`); verificar com `act` ou execução a seco do `npm publish --dry-run`

## 5. Integração

- [ ] 5.1 Rodar `yarn lint`, `yarn check-types`, `yarn test` e `yarn sdk:build` limpos; instalar o `.tgz` de `npm pack` num projeto vazio em `scratchpad`, importar `PlatformClient` e `verifyPlatformSignature` e verificar que compila e executa com Node 20
