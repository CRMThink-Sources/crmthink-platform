# operator-auth Specification

## Purpose

Identificar cada pessoa que opera a plataforma (dev e suporte) com contas locais, senha e TOTP, e autorizar o acesso a `/admin/*` por papel, mantendo os tokens de script.

## Requirements

### Requirement: Contas de operador
O sistema MUST manter contas de operador com e-mail único (comparado sem diferença de maiúsculas), nome, papel (`viewer` ou `operator`), estado ativo/inativo, senha guardada só como hash argon2id e segredo TOTP cifrado com `TOKEN_ENCRYPTION_KEY`, ou ausente enquanto o operador não cadastrou o autenticador. O sistema MUST NOT oferecer cadastro público. O primeiro operador MUST ser criado por script de linha de comando, que também serve para recuperar o acesso de um operador. A criação MUST NOT gerar nem devolver segredo TOTP: o operador cadastra o autenticador no primeiro login.

#### Scenario: Criar o primeiro operador pelo script
- **WHEN** alguém com acesso ao servidor roda o comando de criação de operador (`node dist/src/cli/create-operator.js` no container da API, ou `yarn admin:create-operator` em desenvolvimento) com `--email dev@connectthink.com.br --name "Dev" --role operator`
- **THEN** o sistema cria a conta ativa sem segredo TOTP, mostra uma vez a senha provisória e grava só o hash da senha

#### Scenario: E-mail repetido
- **WHEN** o script ou a rota de gestão tenta criar uma conta com `Dev@ConnectThink.com.br` e já existe `dev@connectthink.com.br`
- **THEN** o sistema recusa com `OPERATOR_EMAIL_TAKEN` e não altera a conta existente

### Requirement: Login com senha e TOTP
O sistema MUST autenticar o operador em duas etapas. Em `POST /admin/auth/login`, com e-mail e senha, MUST responder 200 com um desafio e MUST NOT criar sessão nem definir o cookie de sessão. Em `POST /admin/auth/totp`, com o desafio e o código TOTP de 6 dígitos (passo de 30 s, tolerância de um passo antes e depois), MUST criar a sessão, definir o cookie e responder 200 com nome, e-mail e papel. O desafio MUST valer por 5 minutos, ser de uso único e aceitar no máximo 5 códigos errados. Um código TOTP já aceito MUST NOT ser aceito de novo para a mesma conta. Qualquer falha MUST devolver o mesmo erro `INVALID_CREDENTIALS`, sem revelar se o e-mail existe, se a conta está inativa ou qual fator falhou; desafio vencido, já usado ou desconhecido MUST devolver `CHALLENGE_EXPIRED`. Conta com `mustChangePassword` MUST receber uma sessão que só permite trocar a senha.

#### Scenario: Senha correta, conta com autenticador
- **WHEN** um operador ativo com TOTP cadastrado envia e-mail e senha corretos
- **THEN** o sistema responde 200 com o passo `totp` e um desafio, sem sessão e sem cookie

#### Scenario: Login válido
- **WHEN** um operador ativo envia e-mail e senha corretos e, em seguida, o desafio com o código TOTP correto em `POST /admin/auth/totp`
- **THEN** o sistema responde 200 com nome, e-mail e papel, cria uma sessão e define o cookie de sessão

#### Scenario: Conta inativa
- **WHEN** uma conta desativada envia credenciais corretas
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS` em `POST /admin/auth/login` e não cria desafio nem sessão

#### Scenario: Código TOTP errado
- **WHEN** o operador envia o desafio e um código errado
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS`, não cria sessão e conta uma falha para a conta

#### Scenario: Desafio esgotado
- **WHEN** o operador erra o código 5 vezes com o mesmo desafio e envia o código correto em seguida
- **THEN** o sistema responde 401 `CHALLENGE_EXPIRED` e exige novo login com senha

#### Scenario: Desafio vencido
- **WHEN** o operador envia o código 6 minutos depois de ter passado a senha
- **THEN** o sistema responde 401 `CHALLENGE_EXPIRED`

#### Scenario: Código TOTP reutilizado
- **WHEN** um código já usado num login bem-sucedido é reenviado dentro da janela de validade
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS`

#### Scenario: Senha errada ou conta inativa
- **WHEN** a senha está errada, o e-mail não existe ou a conta está inativa
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS` em `POST /admin/auth/login`, igual nos três casos

#### Scenario: Senha provisória
- **WHEN** um operador criado pelo script conclui o primeiro login
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
Toda rota `/admin/*`, exceto `POST /admin/auth/login` e `POST /admin/auth/totp` (as duas etapas do login), MUST exigir sessão válida ou token de `ADMIN_API_TOKENS`. O papel `viewer` MUST acessar só leituras (`GET`) e as rotas da própria sessão (`/admin/auth/*`). O papel `operator` MUST acessar todas as rotas. Um token de `ADMIN_API_TOKENS` MUST valer como `operator`, com ator `token:<primeiros 8 caracteres do SHA-256 do token>`. Acesso negado por papel MUST responder 403 `FORBIDDEN_ROLE`.

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
Um `operator` MUST poder listar contas (`GET /admin/operators`, sem hash nem segredo, com a indicação de TOTP cadastrado ou não), criar contas, trocar o papel, ativar ou desativar e redefinir o acesso. A criação e a redefinição MUST devolver a senha provisória só nessa resposta e MUST NOT devolver segredo TOTP. A redefinição MUST apagar o segredo TOTP da conta, para que o operador cadastre o autenticador no próximo login. Um operador MUST NOT poder desativar a própria conta nem rebaixar o próprio papel. O sistema MUST recusar com `LAST_OPERATOR` qualquer mudança que deixe zero contas `operator` ativas. Qualquer operador MUST poder trocar a própria senha em `POST /admin/auth/password`, informando a senha atual e uma nova com pelo menos 12 caracteres.

#### Scenario: Redefinir acesso de quem perdeu o celular
- **WHEN** um `operator` redefine o acesso da conta de um `viewer`
- **THEN** o sistema gera nova senha provisória, apaga o segredo TOTP, revoga as sessões e os navegadores lembrados dessa conta e devolve só a senha, uma única vez

#### Scenario: Último operador
- **WHEN** o único `operator` ativo tenta mudar o próprio papel para `viewer`
- **THEN** o sistema responde 409 `LAST_OPERATOR` e não altera a conta

### Requirement: Cadastro do autenticador no primeiro acesso
Quando a senha confere e a conta não tem segredo TOTP, `POST /admin/auth/login` MUST responder 200 com o passo `totp-setup`, o desafio, um segredo novo e o URI `otpauth://` correspondente. O sistema MUST gravar o segredo na conta só depois de receber, em `POST /admin/auth/totp`, um código válido para esse segredo. Até lá a conta MUST continuar sem segredo, e abandonar o cadastro MUST NOT deixar a conta com segredo parcial. O segredo e o URI MUST NOT ser registrados na auditoria. O cadastro concluído MUST ser auditado como `auth.totp_configured`.

#### Scenario: Primeiro acesso
- **WHEN** um operador sem TOTP envia e-mail e senha corretos
- **THEN** o sistema responde com o passo `totp-setup`, o segredo e o URI `otpauth://`, e a conta continua sem segredo gravado

#### Scenario: Cadastro confirmado
- **WHEN** o operador cadastra o segredo no app e envia o primeiro código válido com o desafio
- **THEN** o sistema grava o segredo cifrado, abre a sessão e registra `auth.totp_configured` sem o segredo

#### Scenario: Cadastro abandonado
- **WHEN** o operador recebe o segredo, fecha a página e entra de novo mais tarde
- **THEN** o sistema responde de novo com `totp-setup` e um segredo novo, e o anterior não vale mais

### Requirement: Navegador lembrado
Em `POST /admin/auth/totp` o operador MUST poder pedir para lembrar o navegador. Nesse caso o sistema MUST definir um cookie próprio (aleatório de pelo menos 256 bits, `httpOnly`, `Secure`, `SameSite=Strict`, `Path=/admin`) com validade fixa de `ADMIN_TRUSTED_DEVICE_DAYS` e guardar só o hash dele, ligado à conta. Em `POST /admin/auth/login`, se a senha confere, a conta tem TOTP e o cookie vale para essa conta, o sistema MUST abrir a sessão direto, sem desafio, e registrar na auditoria que o código foi dispensado. A senha MUST continuar obrigatória, o limite por IP e o bloqueio da conta MUST continuar valendo, e o cookie MUST NOT abrir sessão sozinho nem valer para outra conta. O sistema MUST esquecer os navegadores lembrados da conta ao trocar a senha, desativar a conta, trocar o papel ou redefinir o acesso. Ao desativar o recurso, `ADMIN_TRUSTED_DEVICE_DAYS=0` MUST fazer o sistema ignorar a opção.

#### Scenario: Lembrar na etapa do código
- **WHEN** o operador envia um código válido com a opção de lembrar o navegador
- **THEN** o sistema abre a sessão e define o cookie do navegador lembrado com a validade configurada

#### Scenario: Próximo login no mesmo navegador
- **WHEN** o operador volta dentro da validade e envia e-mail e senha corretos com o cookie do navegador lembrado
- **THEN** o sistema responde 200 já autenticado, define o cookie de sessão e registra que o código foi dispensado

#### Scenario: Senha errada com navegador lembrado
- **WHEN** o cookie do navegador lembrado vale mas a senha está errada
- **THEN** o sistema responde 401 `INVALID_CREDENTIALS` e conta a falha

#### Scenario: Cookie de outra conta
- **WHEN** o cookie do navegador lembrado foi criado para a conta A e a conta B faz login nesse navegador
- **THEN** o sistema responde com o passo `totp` e exige o código

#### Scenario: Troca de senha esquece os navegadores
- **WHEN** o operador troca a própria senha
- **THEN** o próximo login em qualquer navegador antes lembrado exige o código

#### Scenario: Conta sem TOTP ignora o cookie
- **WHEN** a conta teve o TOTP redefinido e entra com o cookie antigo do navegador lembrado
- **THEN** o sistema responde com o passo `totp-setup`
