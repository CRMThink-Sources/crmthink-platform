## Why

Hoje o operador digita e-mail, senha e código numa tela só, e o segredo do TOTP nasce junto com a conta: quem cria o operador (CLI ou gestão) precisa repassar senha provisória **e** `otpauth://`. Isso expõe dois segredos a quem cria a conta, não deixa o operador cadastrar o próprio autenticador e obriga a digitar o código em todo login, mesmo no computador de sempre. O backoffice do `gpt-maker-core` já resolve isso com login em duas etapas, cadastro do autenticador por QR code no primeiro acesso e "lembrar este navegador". Queremos o mesmo fluxo aqui.

## What Changes

- **Login em duas etapas.** `POST /admin/auth/login` confere e-mail e senha e responde com um desafio de curta duração (5 min, até 5 códigos errados). Um novo `POST /admin/auth/totp` recebe o desafio e o código e só então abre a sessão.
- **Cadastro do autenticador no primeiro acesso.** Conta sem TOTP recebe um desafio de cadastro com segredo e `otpauth://`. A interface mostra o QR code (gerado no navegador). O segredo só é gravado depois do primeiro código válido.
- **Lembrar este navegador.** Na etapa do código o operador pode marcar a opção; um cookie próprio dispensa o código nos próximos logins daquele navegador por `ADMIN_TRUSTED_DEVICE_DAYS` (padrão 30). A senha continua obrigatória.
- **Criação e redefinição sem TOTP.** Criar operador (CLI e gestão) e redefinir acesso passam a devolver só a senha provisória. A redefinição apaga o TOTP e o operador cadastra de novo no próximo login.
- **Revogação.** Trocar a senha, desativar a conta, trocar o papel e redefinir o acesso também esquecem os navegadores lembrados.
- Mantidos: bloqueio da conta após 5 falhas, limite por IP, erro único `INVALID_CREDENTIALS`, `mustChangePassword`, código TOTP que não vale duas vezes, sessão em cookie `httpOnly`, auditoria.
- **BREAKING** (contrato da API): `POST /admin/auth/login` deixa de receber `code` e passa a devolver um passo (`totp`, `totp-setup` ou `authenticated`). Scripts de operador que usam login por sessão precisam migrar; scripts com `ADMIN_API_TOKENS` não mudam.
- **BREAKING** (coluna): `admin_operator.totp_secret_enc` passa a aceitar nulo. Contas existentes mantêm o segredo atual.

## Capabilities

### New Capabilities
<!-- Nenhuma: o comportamento entra em capabilities existentes. -->

### Modified Capabilities
- `operator-auth`: login em duas etapas com desafio; cadastro do TOTP no primeiro acesso; navegador lembrado; criação e redefinição de contas sem TOTP no retorno; revogação dos navegadores lembrados.
- `backoffice-web`: tela de login em duas etapas, com QR code de cadastro e opção "lembrar este navegador".

## Impact

- **Código (API)**: `src/modules/backoffice/application/login.ts` (divide em senha e código), `operators.ts` (criação e redefinição sem TOTP), `sessions.ts` e novo armazenamento de desafios e navegadores lembrados, `http/routes.ts` e `http/cookies.ts` (rota `/admin/auth/totp`, cookie do navegador lembrado), `create-operator-cli.ts`, `src/config/env.ts` (`ADMIN_TRUSTED_DEVICE_DAYS`).
- **Banco**: migração em `prisma/schema.prisma` (`totpSecretEnc` opcional; nova tabela de navegadores lembrados).
- **Web**: `web/backoffice/src/features/auth` (login em duas etapas, QR code com a dependência `qrcode` que já existe).
- **Contrato**: `docs/api/openapi-admin.json`, tipos regerados no web, SDK se expuser o login.
- **Docs**: `docs/technical/security.md` e `docs/operations/runbook.md` (recuperar acesso passa a ser "redefinir", sem repassar TOTP).
- **Dependência entre changes**: `backoffice-actions` (implementado, ainda não arquivado) mostra senha provisória **e** QR code do TOTP na criação e na redefinição. Esse trecho precisa ser ajustado para só a senha; está tratado nas tarefas desta change.
- **Fora do escopo**: unificar o backoffice com o do `gpt-maker-core` e identidade compartilhada entre os dois.
