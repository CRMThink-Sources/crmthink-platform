## MODIFIED Requirements

### Requirement: Esquemas de segurança descritos
O contrato MUST declarar os esquemas de segurança e aplicá-los por operação: `appApiKey` (Bearer com chave de API do app) nas rotas servidor-a-servidor, incluindo `POST /v1/installations/{id}/trial`; em `/admin/*`, os esquemas alternativos `adminSession` (cookie de sessão de operador) e `adminToken` (Bearer de operador), incluindo `POST /admin/installations/{id}/trial`, com o papel mínimo (`viewer` ou `operator`) indicado na descrição de cada operação; verificação por `Stripe-Signature` no webhook do Stripe; autenticação do Bitrix (`auth` do evento) nos eventos do Bitrix; e ausência de autenticação em `POST /admin/auth/login` (com o limite de tentativas descrito) e, com a restrição de origem CORS descrita, em `POST /v1/sessions`, página de instalação, `POST /v1/install`, JWKS e health.

#### Scenario: Rota servidor-a-servidor
- **WHEN** um leitor consulta `GET /v1/installations/{id}/token` no contrato
- **THEN** a operação exige `appApiKey` e lista as respostas 401 (`UNAUTHORIZED`), 403 (`APP_INACTIVE`) e 404 (`INSTALLATION_NOT_FOUND`)

#### Scenario: Rota de operador
- **WHEN** um leitor consulta `POST /admin/apps`
- **THEN** a operação aceita `adminSession` ou `adminToken`, indica o papel `operator`, lista 403 (`FORBIDDEN_ROLE`, `ORIGIN_NOT_ALLOWED`), consta apenas em `openapi-admin.json` e a descrição avisa que `apiKey` e `webhookSecret` só aparecem nessa resposta

#### Scenario: Solicitação de trial pelo app
- **WHEN** um leitor consulta `POST /v1/installations/{id}/trial` em `openapi.json`
- **THEN** a operação exige `appApiKey`, descreve o corpo de contato com os campos obrigatórios e lista as respostas 201, 200, 404 (`INSTALLATION_NOT_FOUND`), 409 (`TRIAL_ALREADY_USED`, `SUBSCRIPTION_ALREADY_EXISTS`), 422 (`TRIAL_NOT_CONFIGURED`) e 400 (`VALIDATION_ERROR`)

#### Scenario: Trial pelo operador
- **WHEN** um leitor consulta `POST /admin/installations/{id}/trial`
- **THEN** a operação aceita `adminSession` ou `adminToken`, indica o papel `operator`, consta apenas em `openapi-admin.json` e aceita o corpo de contato como opcional

#### Scenario: Login de operador
- **WHEN** um leitor consulta `POST /admin/auth/login` em `openapi-admin.json`
- **THEN** a operação não exige autenticação, descreve o cookie de sessão definido na resposta e lista 401 (`INVALID_CREDENTIALS`) e 429 (`TOO_MANY_REQUESTS`)
