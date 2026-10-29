## Purpose

Dar ao backoffice as leituras de operador que faltam: instalações com detalhe e histórico, painel de contadores e listagens de eventos paginadas e filtráveis.

## ADDED Requirements

### Requirement: Paginação por cursor
As listagens de operador (`/admin/installations`, `/admin/installations/{id}/timeline`, `/admin/events`, `/admin/stripe-events`, `/admin/audit`) MUST responder `{ items, nextCursor }`, com `nextCursor` nulo na última página. Elas MUST aceitar `limit` de 1 a 200, com padrão 50, e `cursor` opaco. O cursor MUST manter a ordem estável mesmo quando entram registros novos durante a navegação. Cursor inválido MUST responder 400 `VALIDATION_ERROR`.

#### Scenario: Navegar sem repetir itens
- **WHEN** um operador lê a primeira página de `/admin/events`, um evento novo é criado e o operador pede a página seguinte com `nextCursor`
- **THEN** a segunda página não repete nenhum item da primeira e o evento novo não aparece nela

#### Scenario: Cursor adulterado
- **WHEN** a requisição envia `cursor=abc`
- **THEN** o sistema responde 400 `VALIDATION_ERROR`

### Requirement: Listagem de instalações
`GET /admin/installations` MUST listar instalações da mais recente para a mais antiga, com filtros por `appCode`, `status` e `q`. O filtro `q` busca por trecho do domínio ou `memberId` exato; um `q` só com dígitos busca o id da instalação ou o `memberId` exatos, sem olhar o domínio. Cada item MUST trazer id, app, domínio, `memberId`, status, datas de instalação, ativação e remoção, `trialUsed` e um indicador de saúde dos tokens (`ok`, `refresh_failing` ou `missing`).

#### Scenario: Buscar cliente pelo domínio
- **WHEN** o suporte consulta `GET /admin/installations?q=acme`
- **THEN** recebe as instalações cujo domínio contém `acme`, de todos os apps

### Requirement: Detalhe da instalação
`GET /admin/installations/{id}` MUST devolver os dados da instalação, o contato registrado, o app, o item do SPA 1060, a saúde dos tokens (expiração, falhas de renovação seguidas e último erro, sem os tokens), a assinatura corrente com o mesmo formato que o app recebe, a contagem de eventos por status e a reinstalação pendente. Se não for possível ler a assinatura no portal, a resposta MUST trazer o restante e marcar a assinatura como indisponível com o motivo, em vez de falhar inteira. Instalação inexistente MUST responder 404 `INSTALLATION_NOT_FOUND`.

#### Scenario: Instalação com renovação de token falhando
- **WHEN** o suporte abre uma instalação cujo token falhou na renovação 3 vezes seguidas
- **THEN** o detalhe mostra a saúde `refresh_failing`, 3 falhas, o último erro e a data de expiração, sem nenhum token

#### Scenario: Portal indisponível
- **WHEN** o Bitrix do portal CRMThink não responde durante a leitura da assinatura
- **THEN** o detalhe responde 200 com `subscription: { available: false, reason }` e os demais campos preenchidos

### Requirement: Timeline da instalação
`GET /admin/installations/{id}/timeline` MUST devolver, do mais recente para o mais antigo, uma lista única com: tentativas de instalação (etapa, status, erro), eventos enviados ao app (tipo, status, versão e as tentativas de entrega com status HTTP e erro), compras avulsas (status, valor, reembolso) e ações de operador cujo alvo é a instalação. Cada item MUST ter `kind`, `occurredAt`, um resumo legível e uma referência à entidade de origem. A timeline MUST aceitar filtro por `kind` e por período, e MUST NOT incluir tokens, segredos nem o payload completo dos eventos.

#### Scenario: Investigar reclamação de app que não recebeu evento
- **WHEN** o suporte abre a timeline de uma instalação cujo evento `subscription.renewed` ficou `dead`
- **THEN** a timeline mostra o evento com status `dead` e cada tentativa de entrega com status HTTP, erro e data

#### Scenario: Filtrar só ações de operador
- **WHEN** a consulta usa `kind=admin_action`
- **THEN** a resposta traz só as ações de operador sobre essa instalação, como trial concedido e eventos reenviados

### Requirement: Painel de contadores
`GET /admin/overview` MUST devolver: instalações por app e status; eventos `pending` e `dead` por app; o mais antigo evento `pending`; eventos Stripe `failed` e `dead`; credenciais com renovação falhando; trials que terminam nos próximos 7 dias; e a última execução de cada varredura. A resposta MUST ser calculada no máximo a cada 60 segundos e informar quando foi calculada.

#### Scenario: Eventos parados
- **WHEN** existem 12 eventos `dead` do app `crmthink.gptmaker`
- **THEN** o painel mostra `dead: 12` para esse app

### Requirement: Filtros nas listagens de eventos
`GET /admin/events` MUST aceitar filtros por `appCode`, `status`, `type`, `installationId` e período (`from`, `to`). Cada item MUST trazer as tentativas de entrega mais recentes. `GET /admin/stripe-events` MUST aceitar filtros por `status`, `type`, `appCode` e período, e MUST continuar sem o payload. `GET /admin/stripe-events/{eventId}` MUST devolver um evento com o payload, só para `operator`.

#### Scenario: Eventos dead de um app numa janela
- **WHEN** um operador consulta `GET /admin/events?appCode=crmthink.gptmaker&status=dead&from=2026-10-01&to=2026-10-07`
- **THEN** recebe só os eventos `dead` desse app criados nesse intervalo, paginados

#### Scenario: Suporte não vê payload do Stripe
- **WHEN** um `viewer` chama `GET /admin/stripe-events/evt_123`
- **THEN** o sistema responde 403 `FORBIDDEN_ROLE`
