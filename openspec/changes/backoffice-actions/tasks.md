## 1. API

- [ ] 1.1 Adicionar `highImpact` ao mapa de metadados por operação, a leitura de `X-Admin-Reason` (1–500 caracteres, sem quebra de linha) no middleware de auditoria e a recusa 400 `REASON_REQUIRED` antes do handler; registrar `REASON_REQUIRED` em `src/docs/errors.ts`; verificar com testes HTTP dos cenários "Rotação sem motivo" e "Motivo gravado" e com o teste de paridade garantindo que as seis operações de alto impacto estão marcadas
- [ ] 1.2 Estender `resendSchema` e `EventDelivery.resend` com `installationId`, `dryRun` (`{ matched, sample }`) e limite de 5000 (422 `RESEND_TOO_LARGE`); verificar com testes dos cenários "Ver o impacto antes de reenviar" e "Reenvio de uma instalação", do limite e de que o dry-run não exige motivo
- [ ] 1.3 Criar `TokenVault.forceRefresh` e `POST /admin/installations/:id/token/refresh` (409 `INSTALLATION_NOT_ACTIVE`, 502 `TOKEN_REFRESH_FAILED` com motivo, sem token na resposta); verificar com testes usando o Bitrix falso dos cenários "Token renovado pelo suporte técnico" e "Bitrix recusa"
- [ ] 1.4 Atualizar `src/docs/openapi/operations.ts` (header `X-Admin-Reason`, `dryRun`, `installationId`, rota nova, papel e alto impacto na descrição), rodar `yarn docs:openapi` e regerar `docs/technical/error-codes.md`; verificar que `yarn test src/docs` passa
- [ ] 1.5 Atualizar `docs/operations/runbook.md` (`X-Admin-Reason` nos exemplos de `curl` das ações de alto impacto; tela correspondente em cada procedimento) e `docs/technical/security.md` (motivo na auditoria); verificar lendo o diff

## 2. Base de ações no web

- [ ] 2.1 Rodar `yarn gen:api` no web e criar `ActionDialog` (alvo, efeito, motivo, confirmação por digitação) e `useAdminAction` (header de motivo, `toast`, invalidação por mapa, erro mantendo o diálogo aberto); verificar com testes MSW: botão travado até digitar o texto, motivo enviado no header e diálogo aberto com os dados após erro
- [ ] 2.2 Criar `SecretRevealDialog` (copiar, aviso, fechar só por "Guardei", resultado fora do cache) e o QR code local do `otpauth://`; verificar com testes de que o segredo não fica no cache do QueryClient depois de fechar, de que não há chamada de rede ao gerar o QR e de que `Esc` não fecha o diálogo

## 3. Ações por tela

- [ ] 3.1 Detalhe da instalação: "Conceder trial", "Renovar token" e "Reenviar eventos desta instalação" (com dry-run); verificar com testes dos cenários "Trial concedido" e "Suporte não vê ações"
- [ ] 3.2 Eventos: "Reenviar este" e "Reenviar todos do filtro" (dry-run, `REENVIAR <n>`, mensagem de limite); verificar com teste do cenário "Reenvio dos dead de um app" e do erro `RESEND_TOO_LARGE`
- [ ] 3.3 Apps: formulário de cadastro com exibição única dos segredos, edição com diff dos campos, segredo do Bitrix só de escrita, erros da API por campo, pré-visualização do tema com teste de deriva do CSS, ativar ou desativar e rotacionar chave e segredo com confirmação por `appCode`; verificar com testes dos cenários "Cadastro de app", "Erro da API no campo" e "Rotação de chave de API"
- [ ] 3.4 Tela "Sistema": rodar varreduras Stripe e SPA com o resultado e rotacionar a chave do JWT (confirmação `ROTACIONAR`); verificar com testes MSW do resultado da varredura e da confirmação
- [ ] 3.5 Tela "Operadores": lista com bloqueio, criar, trocar papel, ativar ou desativar e redefinir acesso (senha e QR code uma vez), sem opções sobre a própria conta e com a mensagem de `LAST_OPERATOR`; verificar com testes dos cenários "Redefinir acesso de operador" e "Tentar rebaixar a si mesmo"

## 4. Integração

- [ ] 4.1 Rodar lint, tipos, testes e build da API e do web limpos, e `openspec validate backoffice-actions --strict`
- [ ] 4.2 Em staging, como `operator`: cadastrar um app de teste, rotacionar a chave, conceder trial, renovar token, reenviar em lote eventos `dead` de teste, rodar as duas varreduras e criar e redefinir um `viewer`; conferir na auditoria cada ação com ator e motivo e, como `viewer`, conferir que nenhum controle aparece
