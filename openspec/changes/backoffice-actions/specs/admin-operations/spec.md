## Purpose

Ajustes na API de operador para que as ações do backoffice sejam seguras e rastreáveis: motivo registrado, pré-visualização do reenvio, reenvio por instalação e renovação forçada de token.

## ADDED Requirements

### Requirement: Motivo da ação
Toda mutação em `/admin/*` MUST aceitar o header `X-Admin-Reason` (texto de 1 a 500 caracteres, sem quebra de linha), e o registro de auditoria da requisição MUST guardar esse motivo. As ações de alto impacto MUST exigir o motivo e MUST responder 400 `REASON_REQUIRED` sem ele, sem executar nada. As ações de alto impacto são: rotação de chave de API, rotação de segredo de webhook, desativação de app, reenvio em lote, rotação da chave do JWT e redefinição de acesso de operador.

#### Scenario: Rotação sem motivo
- **WHEN** um `operator` chama `POST /admin/apps/crmthink.gptmaker/rotate-api-key` sem `X-Admin-Reason`
- **THEN** o sistema responde 400 `REASON_REQUIRED`, a chave não muda e o registro de auditoria mostra a tentativa com esse erro

#### Scenario: Motivo gravado
- **WHEN** um `operator` reenvia um evento com `X-Admin-Reason: cliente relatou webhook perdido`
- **THEN** o registro de auditoria da ação contém esse motivo

### Requirement: Pré-visualização e filtro por instalação no reenvio
`POST /admin/events/resend` MUST aceitar `installationId` no seletor por filtro, como alternativa ou complemento de `appCode`. Com `dryRun: true`, a rota MUST responder `{ matched, sample }` (quantidade e até 5 `eventId`) sem alterar nenhum evento. Um reenvio em lote sem `dryRun` MUST recusar com 422 `RESEND_TOO_LARGE` um seletor que encontre mais de 5000 eventos. O dry-run MUST NOT exigir motivo.

#### Scenario: Ver o impacto antes de reenviar
- **WHEN** um `operator` envia `{ appCode: "crmthink.gptmaker", from, to, onlyDead: true, dryRun: true }`
- **THEN** o sistema responde `{ matched: 37, sample: [...] }` e os 37 eventos continuam `dead`

#### Scenario: Reenvio de uma instalação
- **WHEN** um `operator` reenvia com `{ installationId: 1234, from, to, onlyDead: true }` e um motivo
- **THEN** só os eventos `dead` da instalação 1234 nesse período voltam a `pending`, e a resposta traz a quantidade

### Requirement: Renovação forçada de token
`POST /admin/installations/{id}/token/refresh` MUST renovar o token do Bitrix da instalação, com a mesma trava usada na renovação agendada, e MUST responder com a nova expiração e a saúde do token, sem o token. Para instalação que não está ativa, MUST responder 409 `INSTALLATION_NOT_ACTIVE`. Se o Bitrix recusar a renovação, a rota MUST responder 502 `TOKEN_REFRESH_FAILED` com o motivo, e a falha MUST contar nas falhas de renovação da credencial como na renovação agendada.

#### Scenario: Token renovado pelo suporte técnico
- **WHEN** um `operator` força a renovação de uma instalação ativa com `refresh_failing`
- **THEN** o sistema renova, zera as falhas, responde com a nova `expiresAt` e saúde `ok` e não devolve o token

#### Scenario: Bitrix recusa
- **WHEN** o Bitrix responde `invalid_grant` na renovação forçada
- **THEN** o sistema responde 502 `TOKEN_REFRESH_FAILED` com o motivo e incrementa as falhas da credencial
