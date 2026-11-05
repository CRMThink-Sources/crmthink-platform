## Purpose

Registrar quem fez o quê na operação da plataforma, por sessão de operador ou por token de script, e permitir consultar esse histórico pelo backoffice.

## ADDED Requirements

### Requirement: Registro de ações de operador
Toda requisição a `/admin/*` com método diferente de `GET`, `HEAD` ou `OPTIONS` MUST gerar um registro de auditoria com: ator (id do operador ou `token:<prefixo>`), papel, ação (método e rota sem os valores dos parâmetros, ex.: `POST /admin/apps/:appCode/rotate-api-key`), alvo (tipo e id, quando a rota tem um), resultado (status HTTP e código de erro, se houver), IP, user-agent, request id e data. O registro MUST ser gravado também quando a requisição falha, inclusive em 403 por papel. O registro MUST NOT conter senhas, códigos TOTP, segredos gerados, chaves de API nem o corpo cru da requisição. Ele MAY conter um resumo dos campos alterados, com os valores sensíveis mascarados.

#### Scenario: Rotação de chave registrada sem o segredo
- **WHEN** um `operator` rotaciona a chave de API do app `crmthink.gptmaker`
- **THEN** existe um registro com ator, ação `POST /admin/apps/:appCode/rotate-api-key`, alvo `app:crmthink.gptmaker` e status 200, e o registro não contém a chave nova

#### Scenario: Tentativa negada registrada
- **WHEN** um `viewer` chama `POST /admin/sweeps/spa`
- **THEN** existe um registro com resultado 403 `FORBIDDEN_ROLE`

### Requirement: Registro de eventos de acesso
O sistema MUST registrar na auditoria: login bem-sucedido, login com falha (com o e-mail informado, sem a senha), bloqueio de conta, logout, troca de senha e expiração de sessão detectada numa requisição. O registro de falha MUST NOT revelar ao cliente se o e-mail existe, mas MUST guardar internamente se a conta existe.

#### Scenario: Falha de login
- **WHEN** alguém tenta entrar com `suporte@connectthink.com.br` e senha errada
- **THEN** existe um registro `auth.login_failed` com o e-mail, o IP e a data, sem a senha

### Requirement: Imutabilidade e retenção
Os registros de auditoria MUST NOT ser alterados nem apagados por nenhuma rota. O sistema MUST manter os registros por pelo menos 365 dias. Uma rotina periódica MAY apagar os mais antigos que o prazo configurado.

#### Scenario: Sem rota de edição
- **WHEN** um `operator` procura uma rota para editar ou apagar registros de auditoria
- **THEN** não existe rota `PATCH`, `PUT` ou `DELETE` em `/admin/audit`

### Requirement: Consulta da auditoria
`GET /admin/audit` MUST listar registros do mais recente para o mais antigo, com paginação por cursor e filtros por ator, ação, tipo e id do alvo, resultado (sucesso ou falha) e período. A consulta MUST estar disponível para `viewer` e `operator`.

#### Scenario: Ações sobre um app
- **WHEN** um operador consulta `GET /admin/audit?targetType=app&targetId=crmthink.gptmaker`
- **THEN** recebe só os registros desse app, do mais recente para o mais antigo, e um `nextCursor` quando há mais páginas
