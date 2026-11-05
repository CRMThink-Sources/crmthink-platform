## MODIFIED Requirements

### Requirement: Esquemas de segurança descritos
O contrato MUST declarar os esquemas de segurança e aplicá-los por operação: `appApiKey` (Bearer com chave de API do app) nas rotas servidor-a-servidor, incluindo `POST /v1/installations/{id}/trial`, `adminToken` (Bearer de operador) em `/admin/*`, incluindo `POST /admin/installations/{id}/trial`, verificação por `Stripe-Signature` no webhook do Stripe, autenticação do Bitrix (`auth` do evento) nos eventos do Bitrix, e ausência de autenticação (com a restrição de origem CORS descrita) em `POST /v1/sessions`, página de instalação, `POST /v1/install`, JWKS e health.

#### Scenario: Rota servidor-a-servidor
- **WHEN** um leitor consulta `GET /v1/installations/{id}/token` no contrato
- **THEN** a operação exige `appApiKey` e lista as respostas 401 (`UNAUTHORIZED`), 403 (`APP_INACTIVE`) e 404 (`INSTALLATION_NOT_FOUND`)

#### Scenario: Rota de operador
- **WHEN** um leitor consulta `POST /admin/apps`
- **THEN** a operação exige `adminToken`, consta apenas em `openapi-admin.json` e a descrição avisa que `apiKey` e `webhookSecret` só aparecem nessa resposta

#### Scenario: Solicitação de trial pelo app
- **WHEN** um leitor consulta `POST /v1/installations/{id}/trial` em `openapi.json`
- **THEN** a operação exige `appApiKey`, descreve o corpo de contato com os campos obrigatórios e lista as respostas 201, 200, 404 (`INSTALLATION_NOT_FOUND`), 409 (`TRIAL_ALREADY_USED`, `SUBSCRIPTION_ALREADY_EXISTS`), 422 (`TRIAL_NOT_CONFIGURED`) e 400 (`VALIDATION_ERROR`)

#### Scenario: Trial pelo operador
- **WHEN** um leitor consulta `POST /admin/installations/{id}/trial`
- **THEN** a operação exige `adminToken`, consta apenas em `openapi-admin.json` e aceita o corpo de contato como opcional
