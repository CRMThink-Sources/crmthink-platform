# Spec Delta

## Purpose

Permitir que o operador crie, pelo backoffice, assinaturas manuais (boleto, contrato) e bonificações para uma instalação, com validação, aviso ao app e rastro de auditoria, no lugar da digitação direta no SPA do Bitrix.

## ADDED Requirements

### Requirement: Criação de assinatura manual pelo operador
`POST /admin/installations/{id}/subscriptions` MUST criar uma assinatura de modalidade `manual` com status `active` para a instalação, gravando-a no SPA 1142. O corpo MUST informar o plano (`planId`), o tipo (`kind`: `manual` ou `bonus`) e o fim do período (`periodEnd`, data `AAAA-MM-DD`); MAY informar o início (`periodStart`), que por padrão é o dia da criação, e o responsável (`approvedBy`). Campos desconhecidos no corpo MUST ser recusados. A resposta de sucesso MUST ser `201` com o id da assinatura, o status, a modalidade, o plano e o período. A rota MUST exigir o papel `operator` e o motivo no header `X-Admin-Reason`.

#### Scenario: Cobrança manual criada
- **WHEN** um `operator` envia `kind: manual`, um plano pago do app da instalação e um fim de período válido, com motivo
- **THEN** a resposta é `201`, existe no SPA 1142 uma assinatura `manual` e `active` com o plano e o período informados, e o título é `<nome do app> — <domínio da instalação>`

#### Scenario: Papel insuficiente ou motivo ausente
- **WHEN** um `viewer` chama a rota, ou um `operator` chama sem `X-Admin-Reason`
- **THEN** a resposta é `403 FORBIDDEN_ROLE` no primeiro caso e `400 REASON_REQUIRED` no segundo, e nada é gravado no SPA

### Requirement: Bonificação
Quando `kind` for `bonus`, o corpo MUST informar `approvedBy` (quem autorizou a bonificação); sem ele, a requisição MUST ser recusada com erro de validação. A assinatura criada MUST ter o título `Bonificação — <nome do plano> — <domínio da instalação>`. O sistema MUST registrar na linha do tempo da assinatura um comentário com o tipo, o operador, o motivo e o responsável. Uma falha ao gravar esse comentário MUST NOT desfazer nem falhar a criação. O sistema MUST NOT criar campo novo no SPA 1142 para a bonificação.

#### Scenario: Bonificação sem responsável
- **WHEN** um `operator` envia `kind: bonus` sem `approvedBy`
- **THEN** a resposta é `400` de validação e nenhuma assinatura é criada

#### Scenario: Bonificação criada
- **WHEN** um `operator` envia `kind: bonus` com `approvedBy`, plano válido e motivo
- **THEN** a assinatura é criada com o título de bonificação e a linha do tempo dela mostra o motivo e o responsável

### Requirement: Uma assinatura vigente por instalação
A criação MUST ser recusada com `409 SUBSCRIPTION_ALREADY_EXISTS` quando a instalação já tiver assinatura `active` ou `past_due`, seja Stripe ou manual; os `details` MUST informar o id, a modalidade e o status da existente. Assinaturas `cancelled` ou `trial_expired` MUST NOT bloquear. Quando a instalação tiver um trial em andamento, a criação MUST ser permitida, MUST cancelar esse trial e o evento de ativação MUST trazer o id do trial em `previousSubscriptionId`; o cancelamento do trial MUST NOT gerar evento próprio. Duas criações simultâneas para a mesma instalação MUST NOT resultar em duas assinaturas vigentes.

#### Scenario: Instalação já com assinatura ativa
- **WHEN** um `operator` cria uma assinatura numa instalação que já tem assinatura `active`
- **THEN** a resposta é `409 SUBSCRIPTION_ALREADY_EXISTS` com o id, a modalidade e o status da existente

#### Scenario: Instalação em trial
- **WHEN** um `operator` cria uma assinatura numa instalação com trial em andamento
- **THEN** a assinatura é criada, o trial fica `cancelled` e o app recebe `subscription.activated` com `previousSubscriptionId` igual ao id do trial

#### Scenario: Assinatura anterior encerrada
- **WHEN** a única assinatura da instalação está `cancelled`
- **THEN** a criação é aceita

### Requirement: Validação de plano, instalação e período
O plano MUST existir, estar ativo, pertencer a um produto ativo vinculado a um app da instalação, ser de assinatura (não compra única) e não ser plano de trial; caso contrário a resposta MUST ser `404 PLAN_NOT_FOUND` (plano de outro app ou inexistente), `422 PLAN_INACTIVE` (plano ou produto inativo) ou `400 PLAN_TYPE_MISMATCH` (trial ou compra única). A instalação MUST existir (`404 INSTALLATION_NOT_FOUND`) e estar `ACTIVE` (`409 INSTALLATION_NOT_ACTIVE`). O fim do período MUST ser posterior ao início e no máximo 24 meses depois dele; caso contrário a resposta MUST ser `422 INVALID_PERIOD`. Datas inexistentes MUST ser recusadas. O plano MUST NOT precisar de preço do Stripe.

#### Scenario: Plano de trial
- **WHEN** um `operator` cria uma assinatura com o plano de trial do app
- **THEN** a resposta é `400 PLAN_TYPE_MISMATCH` e nada é gravado

#### Scenario: Período maior que 24 meses
- **WHEN** o fim do período fica mais de 24 meses depois do início
- **THEN** a resposta é `422 INVALID_PERIOD` e nada é gravado

#### Scenario: Fim antes do início
- **WHEN** o fim do período é igual ou anterior ao início
- **THEN** a resposta é `422 INVALID_PERIOD` e nada é gravado

### Requirement: Evento e conferência da gravação
Depois de gravar a assinatura, o sistema MUST reler o item do SPA e conferir plano, status, modalidade e período. Se a releitura divergir ou o item não for encontrado, a resposta MUST ser `502 SUBSCRIPTION_WRITE_FAILED` com o id do item criado em `details`, e nenhum evento MUST ser emitido. Quando a conferência passar, o sistema MUST emitir exatamente um evento `subscription.activated` ao app, com a mesma versão e proteção contra duplicidade das demais decisões de assinatura. Uma mudança posterior do próprio SPA que repita o estado gravado MUST NOT gerar novo evento.

#### Scenario: Gravação confere
- **WHEN** a assinatura é criada e a releitura bate com o pedido
- **THEN** o app recebe um único `subscription.activated`, e o reprocessamento do evento do SPA dessa assinatura não gera outro

#### Scenario: Releitura diverge
- **WHEN** o Bitrix aceita a criação mas a releitura mostra um campo diferente do pedido
- **THEN** a resposta é `502 SUBSCRIPTION_WRITE_FAILED` com o id do item em `details` e nenhum evento sai

### Requirement: Escrita só em produção
A criação MUST ser recusada com `409 SUBSCRIPTIONS_READ_ONLY` quando `PLATFORM_ENVIRONMENT` não for `production`, porque homologação e produção compartilham os SPAs e a regra de uma assinatura por instalação só é conferível no banco da produção.

#### Scenario: Chamada na homologação
- **WHEN** um `operator` chama a rota num ambiente de homologação
- **THEN** a resposta é `409 SUBSCRIPTIONS_READ_ONLY` e nada é gravado no SPA

### Requirement: Auditoria da criação
Toda chamada à rota MUST gerar registro de auditoria com alvo do tipo `installation` e o id da instalação, o motivo informado e o corpo da requisição, inclusive quando a chamada falha. O registro MUST aparecer na linha do tempo da instalação.

#### Scenario: Criação na linha do tempo
- **WHEN** um `operator` cria uma assinatura para a instalação 1234
- **THEN** a linha do tempo da instalação 1234 mostra a ação `POST /admin/installations/:id/subscriptions` com o ator e o resultado
