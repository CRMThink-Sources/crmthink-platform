## Purpose

Identificar cada pessoa que opera a plataforma (dev e suporte) com contas locais, senha e TOTP, e autorizar o acesso a `/admin/*` por papel, mantendo os tokens de script.

## ADDED Requirements

### Requirement: Contas de operador
O sistema MUST manter contas de operador com e-mail único (comparado sem diferença de maiúsculas), nome, papel (`viewer` ou `operator`), estado ativo/inativo, senha guardada só como hash argon2id e segredo TOTP cifrado com `TOKEN_ENCRYPTION_KEY`. O sistema MUST NOT oferecer cadastro público. O primeiro operador MUST ser criado por script de linha de comando, que também serve para recuperar o acesso de um operador.

#### Scenario: Criar o primeiro operador pelo script
- **WHEN** alguém com acesso ao servidor roda o comando de criação de operador (`node dist/src/cli/create-operator.js` no container da API, ou `yarn admin:create-operator` em desenvolvimento) com `--email dev@connectthink.com.br --name "Dev" --role operator`
- **THEN** o sistema cria a conta ativa, mostra uma vez a senha provisória e o URI `otpauth://` para cadastrar o TOTP e grava só o hash da senha e o segredo cifrado

#### Scenario: E-mail repetido
- **WHEN** o script ou a rota de gestão tenta criar uma conta com `Dev@ConnectThink.com.br` e já existe `dev@connectthink.com.br`
- **THEN** o sistema recusa com `OPERATOR_EMAIL_TAKEN` e não altera a conta existente

### Requirement: Login com senha e TOTP
O sistema MUST autenticar o operador em `POST /admin/auth/login` com e-mail, senha e código TOTP de 6 dígitos (passo de 30 s, tolerância de um passo antes e depois). Um código TOTP já aceito MUST NOT ser aceito de novo para a mesma conta. Qualquer falha MUST devolver o mesmo erro `INVALID_CREDENTIALS`, sem revelar se o e-mail existe, se a conta está inativa ou qual fator falhou. Conta com `mustChangePassword` MUST receber uma sessão que só permite trocar a senha.

#### Scenario: Login válido
- **WHEN** um operador ativo envia e-mail, senha e código TOTP corretos
- **THEN** o sistema responde 200 com nome, e-mail e papel, cria uma sessão e define o cookie de sessão

#### Scenario: Código TOTP errado
- **WHEN** a senha está correta e o código TOTP não
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS` e não cria sessão

#### Scenario: Código TOTP reutilizado
- **WHEN** um código já usado num login bem-sucedido é reenviado dentro da janela de validade
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS`

#### Scenario: Conta inativa
- **WHEN** uma conta desativada envia credenciais corretas
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS`

#### Scenario: Senha provisória
- **WHEN** um operador criado pelo script faz login pela primeira vez
- **THEN** a sessão só permite `POST /admin/auth/password` e as outras rotas `/admin/*` respondem 403 `PASSWORD_CHANGE_REQUIRED`

### Requirement: Limite de tentativas e bloqueio
O sistema MUST limitar tentativas de login por IP e por e-mail. Após 5 falhas seguidas para a mesma conta em 15 minutos, a conta MUST ficar bloqueada por 15 minutos, e nesse período até credenciais corretas recebem `INVALID_CREDENTIALS`. Mais de 20 tentativas por IP em 15 minutos MUST receber 429 `TOO_MANY_REQUESTS` com `Retry-After`. Um login bem-sucedido MUST zerar a contagem da conta.

#### Scenario: Bloqueio por falhas seguidas
- **WHEN** uma conta acumula 5 falhas em 15 minutos e em seguida envia credenciais corretas
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS`, não cria sessão e registra o bloqueio na auditoria

#### Scenario: Excesso por IP
- **WHEN** um mesmo IP faz a 21ª tentativa de login em 15 minutos
- **THEN** o sistema responde 429 `TOO_MANY_REQUESTS` com o header `Retry-After`

### Requirement: Sessão de operador
A sessão MUST ser identificada por um valor aleatório de pelo menos 256 bits, enviado só em cookie `httpOnly`, `Secure`, `SameSite=Strict`, com `Path=/admin`. Só o hash desse valor MUST ser guardado. A sessão MUST expirar após 30 minutos sem uso e após 12 horas desde o login, valores configuráveis. `POST /admin/auth/logout` MUST revogar a sessão. Desativar a conta, trocar o papel ou redefinir a senha MUST revogar todas as sessões da conta. `GET /admin/auth/me` MUST devolver o operador da sessão.

#### Scenario: Inatividade
- **WHEN** uma sessão fica 31 minutos sem requisição e então chama `GET /admin/installations`
- **THEN** o sistema responde 401 `UNAUTHORIZED` e a sessão não volta a valer

#### Scenario: Desativação derruba sessões
- **WHEN** um `operator` desativa a conta de um `viewer` que está com sessão aberta
- **THEN** a próxima requisição do `viewer` recebe 401 `UNAUTHORIZED`

#### Scenario: Logout
- **WHEN** o operador chama `POST /admin/auth/logout`
- **THEN** o sistema revoga a sessão, apaga o cookie e responde 204

### Requirement: Proteção contra requisição forjada
Toda requisição autenticada por sessão com método diferente de `GET`, `HEAD` ou `OPTIONS` MUST trazer o header `Origin` igual a uma das origens configuradas do backoffice. Sem isso, o sistema MUST responder 403 `ORIGIN_NOT_ALLOWED`. Requisições autenticadas por token de script MUST NOT exigir `Origin`.

#### Scenario: Mutação de outra origem
- **WHEN** uma página de outro domínio envia `POST /admin/events/resend` com o cookie da sessão
- **THEN** o sistema responde 403 `ORIGIN_NOT_ALLOWED` e nada é reenviado

### Requirement: Papéis e autorização
Toda rota `/admin/*`, exceto `POST /admin/auth/login`, MUST exigir sessão válida ou token de `ADMIN_API_TOKENS`. O papel `viewer` MUST acessar só leituras (`GET`) e as rotas da própria sessão (`/admin/auth/*`). O papel `operator` MUST acessar todas as rotas. Um token de `ADMIN_API_TOKENS` MUST valer como `operator`, com ator `token:<primeiros 8 caracteres do SHA-256 do token>`. Acesso negado por papel MUST responder 403 `FORBIDDEN_ROLE`.

#### Scenario: Suporte tenta uma ação
- **WHEN** um `viewer` chama `POST /admin/events/resend`
- **THEN** o sistema responde 403 `FORBIDDEN_ROLE` e nada é reenviado

#### Scenario: Suporte consulta
- **WHEN** um `viewer` chama `GET /admin/installations/1234/timeline`
- **THEN** o sistema responde 200 com a timeline

#### Scenario: Script com token
- **WHEN** um script chama `POST /admin/sweeps/stripe` com `Authorization: Bearer <token de ADMIN_API_TOKENS>` e sem cookie
- **THEN** a varredura roda e o registro de auditoria tem ator `token:<prefixo>`

### Requirement: Gestão de operadores
Um `operator` MUST poder listar contas (`GET /admin/operators`, sem hash nem segredo), criar contas, trocar o papel, ativar ou desativar e redefinir senha e TOTP. A criação e a redefinição MUST devolver a senha provisória e o URI `otpauth://` só nessa resposta. Um operador MUST NOT poder desativar a própria conta nem rebaixar o próprio papel. O sistema MUST recusar com `LAST_OPERATOR` qualquer mudança que deixe zero contas `operator` ativas. Qualquer operador MUST poder trocar a própria senha em `POST /admin/auth/password`, informando a senha atual e uma nova com pelo menos 12 caracteres.

#### Scenario: Redefinir acesso de quem perdeu o celular
- **WHEN** um `operator` redefine senha e TOTP da conta de um `viewer`
- **THEN** o sistema gera nova senha provisória e novo segredo TOTP, revoga as sessões dessa conta e devolve os dois uma única vez

#### Scenario: Último operador
- **WHEN** o único `operator` ativo tenta mudar o próprio papel para `viewer`
- **THEN** o sistema responde 409 `LAST_OPERATOR` e não altera a conta
