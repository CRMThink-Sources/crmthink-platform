## 1. Banco e configuração

- [x] 1.1 Tornar `AdminOperator.totpSecretEnc` opcional, criar o modelo `AdminTrustedDevice` (`idHash` único, `operatorId`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt`, `userAgent`, cascade pelo operador) e gerar a migração aditiva; verificar aplicando a migração num banco com operadores existentes e confirmando que os segredos atuais seguem intactos
- [x] 1.2 Adicionar `ADMIN_TRUSTED_DEVICE_DAYS` (padrão 30, `0` desliga) em `src/config/env.ts`, no objeto de configuração do backoffice e no `.env.example`/docs de variáveis (o emissor do QR já vem de `totpIssuer(env.platformEnvironment)`); verificar com teste da validação de ambiente

## 2. API: desafio, cadastro e navegador lembrado

- [x] 2.1 Criar `LoginChallenges` (`create`, `peek`, `fail`, `consume`; validade de 5 min e teto de 5 falhas) sobre o `JsonCache` existente (Redis em produção, `MemoryJsonCache` nos testes), cifrando o `setupSecret` com `TokenCipher` antes de gravar; verificar com testes de TTL, uso único, teto de tentativas e de que o segredo não aparece em claro no valor gravado
- [x] 2.2 Criar `TrustedDevices` (`trust`, `resolve` por operador, `revokeAll`) sobre `AdminTrustedDevice`, com hash SHA-256 do valor do cookie e validade fixa; verificar com testes de cookie de outra conta, vencido, revogado e de `ADMIN_TRUSTED_DEVICE_DAYS=0`
- [x] 2.3 Dividir `LoginService.login` em `login` (limite por IP, conta, bloqueio, senha, depois desafio `totp`, `totp-setup` ou sessão direta por navegador lembrado) e `verifyCode` (desafio, bloqueio da conta, TOTP contra o segredo da conta ou o `setupSecret`, anti-reuso, gravação do segredo na confirmação, sessão, dispositivo), mantendo `fail()` e o erro único `INVALID_CREDENTIALS`; `CHALLENGE_EXPIRED` para desafio vencido, usado ou esgotado; verificar com testes HTTP de todos os cenários de "Login com senha e TOTP", "Cadastro do autenticador no primeiro acesso" e "Navegador lembrado", incluindo conta bloqueada no meio do desafio e que nada de TOTP vai à auditoria
- [x] 2.4 Auditar `auth.totp_configured` e marcar `summary.secondFactor = 'skipped_trusted_device'` no login sem código; verificar que o segredo e o URI não aparecem em nenhum registro (`audit.test.ts`)
- [x] 2.5 Criar `POST /admin/auth/totp` e ajustar `POST /admin/auth/login` e `http/cookies.ts` (cookie `cp_admin_device` com `Max-Age`, mesmos atributos da sessão; limpar ao revogar); manter a checagem de `Origin` nas duas rotas e o limite por IP; verificar com testes de rota, de cookies e de `Origin` não permitida
- [x] 2.6 Remover o TOTP de `OperatorService.create` e `resetAccess` (o retorno perde `totpUri`; a redefinição zera `totpSecretEnc` e `lastTotpStep`), incluir `totpConfigured` em `OperatorView`, revogar dispositivos lembrados ao trocar senha, desativar, trocar papel e redefinir; verificar com testes de cada gatilho e da lista de operadores
- [x] 2.7 Ajustar `create-operator-cli.ts` para imprimir só a senha provisória; verificar com o teste do CLI
- [x] 2.8 Atualizar `src/docs/openapi/operations.ts` (login em dois passos, `/admin/auth/totp`, `OperatorView.totpConfigured`, retorno sem `totpUri`, `CHALLENGE_EXPIRED` em `src/docs/errors.ts`), rodar `yarn docs:openapi` e regerar `docs/technical/error-codes.md`; verificar que `yarn test src/docs` passa

## 3. Web

- [x] 3.1 Rodar `yarn gen:api` no web e reescrever `features/auth/login-page.tsx` como passos (`credentials`, `code`, `setup`), com o desafio só em memória; verificar com testes MSW de cada passo, do navegador lembrado entrando direto, da mensagem genérica, do 429 e do desafio vencido voltando ao passo 1
- [x] 3.2 Tela de cadastro do autenticador com QR gerado localmente (`qr-code.tsx`), segredo em texto para digitação manual e a caixa "Lembrar este navegador" desmarcada, com o número de dias; verificar com testes de que não há chamada de rede ao gerar o QR e de que o segredo não fica no cache do QueryClient, no storage nem na URL
- [x] 3.3 Ajustar a tela de operadores e o diálogo de criação e redefinição para mostrar só a senha provisória (sem QR), e a coluna que indica quem ainda não cadastrou o autenticador; verificar atualizando os testes de `operators.test.tsx` e `actions.test.tsx`

## 4. Documentação e fechamento

- [x] 4.1 Atualizar `docs/technical/security.md` (duas etapas, navegador lembrado, revogação, segredo do cadastro) e `docs/operations/runbook.md` (recuperar acesso é redefinir e o operador recadastra o autenticador; como desligar o navegador lembrado); verificar lendo o diff
- [x] 4.2 Rodar `yarn typecheck`, `yarn lint`, `yarn test` na API e no web, e um teste manual no ambiente de dev com `scripts/seed-dev.ts` (ajustar o seed para criar operadores sem segredo e com segredo); verificar a saída limpa e o fluxo completo no navegador: primeiro acesso com QR, login com código, lembrar navegador, redefinir acesso
