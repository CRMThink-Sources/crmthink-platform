## Context

O login atual (`LoginService.login`) faz tudo numa chamada: limite por IP, conta, senha argon2id, TOTP com anti-reuso (`lastTotpStep`), bloqueio por 5 falhas, sessão e auditoria. O segredo TOTP é obrigatório na conta (`totpSecretEnc` não nulo) e nasce na criação. Sessões ficam no MySQL (`AdminSession`, hash do cookie); contadores de tentativa ficam no Redis (`RateCounter`, com `MemoryRateCounter` nos testes). Motivação e escopo: ver `proposal.md`.

Referência: `gpt-maker-core` (`admin-auth.service.ts`) divide o login em `login` e `verify`, guarda o desafio no Redis e o navegador lembrado em Redis com TTL. Aqui o que já existe pesa mais que a cópia: manter argon2id, auditoria, bloqueio e `mustChangePassword`, e trazer só o desenho em duas etapas.

## Goals / Non-Goals

**Goals:**
- Login em duas etapas, cadastro do autenticador por QR no primeiro acesso, navegador lembrado.
- Nenhum segredo TOTP passa por quem cria ou redefine a conta.
- Nenhuma regressão de segurança: mesmo erro genérico, mesmo bloqueio, mesmo anti-reuso.

**Non-Goals:**
- Unificar com o backoffice do `gpt-maker-core` ou compartilhar identidade entre os dois.
- Códigos de recuperação, WebAuthn, SSO.
- Tela de "meus navegadores lembrados" (só revogação em massa).

## Decisions

**D1. Duas rotas, desafio opaco.** `POST /admin/auth/login` (e-mail e senha) devolve `{ step: 'totp' | 'totp-setup', challenge, ... }` ou `{ step: 'authenticated', operator, expiresAt }`; `POST /admin/auth/totp` (`challenge`, `code`, `rememberDevice`) devolve operador e define o cookie. O desafio é 256 bits aleatórios; só o SHA-256 vira chave. Alternativa descartada: manter uma rota e deixar a tela pedir tudo junto. Não permite cadastro por QR sem revelar o segredo antes de provar a senha.

**D2. Desafio no Redis, não no MySQL.** Vive 5 min, é de uso único e tem contador de tentativas. Em vez de um port novo, `LoginChallenges` usa o `JsonCache` que o container já injeta (Redis em produção, `MemoryJsonCache` nos testes); como o cache em memória ignora o TTL, o valor guarda o próprio `expiresAt` e é comparado com o `Clock`. Redis já é dependência obrigatória da API. O estado guardado: `operatorId`, `attempts` e, no cadastro, o `setupSecret` em claro por no máximo 5 min (o Redis não é persistente para isso e o TTL curto limita a exposição; cifrar com `TokenCipher` antes de gravar, para o segredo não ficar legível em dump do Redis).

**D3. Navegador lembrado no MySQL.** Nova tabela `admin_trusted_device` (`idHash` único, `operatorId`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt`, `userAgent`), no mesmo desenho de `AdminSession`. Motivos: revogar por conta é um `UPDATE`, o registro deixa rastro para auditoria e a validade é de dias (Redis só com TTL perderia o histórico). Validade fixa, sem renovar a cada uso. O cookie `cp_admin_device` usa `Path=/admin`, `HttpOnly`, `SameSite=Strict`, `Secure` e `Max-Age` da validade (ao contrário da sessão, precisa sobreviver ao fechar o navegador). `ADMIN_TRUSTED_DEVICE_DAYS` padrão 30; `0` desliga.

**D4. Pular o código exige senha certa e TOTP já cadastrado.** No `login`, depois de senha, conta ativa e conta não bloqueada, se há segredo e o cookie resolve para um dispositivo ativo **da mesma conta**, abre a sessão direto. Conta sem segredo ignora o cookie (cai em `totp-setup`). A auditoria grava `auth.login_succeeded` com `summary.secondFactor = 'skipped_trusted_device'` (a chave não pode se chamar `totp`: a auditoria mascara qualquer chave com esse nome), para distinguir de login com código.

**D5. Falhas contam igual nas duas etapas.** Senha errada no `login` e código errado no `totp` passam pelo mesmo `fail()` (mesma chave `login:acct:<email>`, mesmas razões de auditoria `bad_password`/`bad_totp`, mesmo bloqueio de 15 min). A etapa 2 também confere `lockedUntil`, então uma conta bloqueada no meio do desafio não entra. O limite por IP conta as duas rotas. O desafio tem seu próprio teto de 5 códigos errados, que o descarta (`CHALLENGE_EXPIRED`). Escolha: o desafio esgotado pede novo login com senha, o que impede adivinhar o código sem passar pela senha de novo.

**D6. Cadastro: o segredo só é gravado na confirmação.** `totp-setup` gera o segredo, guarda no desafio e devolve segredo e URI. Em `totp`, `verifyTotp` roda contra `setupSecret`; só com código válido o segredo é cifrado e gravado e o desafio é consumido. Mesma proteção contra reuso (`lastTotpStep`). Abandonar não deixa estado na conta. O emissor do QR é o `totpIssuer(env.platformEnvironment)` que já existe (homologação e produção lado a lado no app); o rótulo é o e-mail.

**D7. Criação e redefinição sem TOTP.** `OperatorService.create`/`resetAccess` deixam de gerar segredo e `totpUri` sai do retorno. `resetAccess` zera `totpSecretEnc` e `lastTotpStep` e revoga sessões **e** dispositivos lembrados. `trocar senha`, `desativar` e `trocar papel` também revogam dispositivos. O CLI imprime só a senha. O campo `totpConfigured` entra em `OperatorView`, para a lista mostrar quem ainda não cadastrou.

**D8. Migração do banco.** `totp_secret_enc` vira `NULL`able; contas existentes ficam como estão e passam pelo passo `totp`. Migração aditiva (`ALTER ... NULL` e `CREATE TABLE`), sem janela de indisponibilidade. A API antiga e a nova não convivem na mesma chamada de login (BREAKING), então web e API saem juntos; a API serve o `index.html` do web, o que já garante isso.

**D9. Web.** `login-page.tsx` vira uma máquina de passos (`credentials` → `code` | `setup` → sessão) com o desafio só em memória do componente. QR com a dependência `qrcode` que já existe no web, gerado localmente; o desafio, o segredo e o URI não vão a cache de consultas, storage nem URL. Desafio vencido volta ao passo 1 com aviso. O `rememberDevice` é uma caixa desmarcada por padrão.

**D10. Ajuste no `backoffice-actions`.** Esse change (implementado, ainda não arquivado) mostra senha provisória e QR do TOTP no diálogo de criação e redefinição de operador. Passa a mostrar só a senha. O diálogo de segredo (`secret-reveal-dialog.tsx`) e o `qr-code.tsx` seguem usados, agora pela tela de login.

## Risks / Trade-offs

- **Navegador lembrado reduz o segundo fator.** Quem roubar o cookie do dispositivo ainda precisa da senha, e o cookie é `httpOnly`/`SameSite=Strict`; a opção é desmarcada por padrão, tem validade fixa e cai em qualquer troca de senha, desativação, troca de papel ou redefinição. `ADMIN_TRUSTED_DEVICE_DAYS=0` desliga por ambiente.
- **Segredo do cadastro passa pelo navegador e pelo Redis.** Mitigação: 5 min de TTL, segredo cifrado no Redis, nada em log/auditoria, QR gerado localmente.
- **Conta nova fica sem TOTP até o primeiro login.** Quem souber a senha provisória pode cadastrar o próprio autenticador. A senha provisória já é segredo de uso único entregue ao operador, e `mustChangePassword` força a troca logo depois; o risco é equivalente ao de hoje, em que a mesma pessoa receberia senha e URI.
- **Contrato quebra para quem usa login por sessão em script.** Nenhum script conhecido faz isso (scripts usam `ADMIN_API_TOKENS`); registrar no changelog do contrato.
- **Redis fora do ar** impede o login (como já impede hoje o limite por IP). Sem mudança.

## Migration Plan

1. Migração Prisma: `totp_secret_enc` nulável e `admin_trusted_device`.
2. Deploy de API e web juntos. Operadores com sessão aberta seguem logados; o próximo login usa o fluxo novo.
3. Rollback: reverter o deploy. A coluna nulável e a tabela nova são ignoradas pelo código antigo; contas sem segredo (criadas depois do deploy) não conseguem entrar no código antigo e precisam de `--reset` pelo CLI antigo ou do reenvio do segredo.

## Open Questions

- Padrão de 30 dias para `ADMIN_TRUSTED_DEVICE_DAYS`: valor escolhido por nós, confirmar na revisão.
