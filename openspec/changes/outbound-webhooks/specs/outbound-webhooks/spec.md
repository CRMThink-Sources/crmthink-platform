# Spec Delta

## Purpose

Permitir que sistemas que não são apps (ERP, financeiro, automações) recebam os eventos da plataforma em URLs cadastradas pelo operador, com entrega assinada, ordenada e independente da entrega aos apps.

## ADDED Requirements

### Requirement: Cadastro de destinatários de eventos
O operador MUST poder criar, listar, editar, desativar, reativar e rotacionar o segredo de destinatários de eventos em `/admin/webhook-endpoints`. Cada destinatário MUST ter nome (1 a 200 caracteres), URL, ao menos um tipo de evento e, opcionalmente, uma lista de apps; lista de apps vazia MUST significar todos os apps. Os tipos MUST ser os tipos de evento que a plataforma já emite; tipo desconhecido MUST ser recusado com `400` de validação e app inexistente com `400 WEBHOOK_APP_UNKNOWN`. Listar MUST estar disponível para `viewer` e `operator`; as demais ações MUST exigir `operator` e o motivo em `X-Admin-Reason` (a edição de nome e de filtros e a reativação, não). Toda mutação MUST ser auditada com alvo `webhook_endpoint`, sem o segredo no registro.

#### Scenario: Criar destinatário
- **WHEN** um `operator` cria o destinatário "ERP" com a URL `https://erp.example.com/hooks`, os tipos `subscription.renewed` e `subscription.past_due` e nenhum app, informando o motivo
- **THEN** a resposta traz o segredo completo uma única vez, e a lista passa a mostrar o destinatário com os dois tipos e "todos os apps"

#### Scenario: Tipo de evento inexistente
- **WHEN** o corpo traz o tipo `subscription.renovada`
- **THEN** a resposta é `400` de validação e nada é criado

#### Scenario: Viewer não gerencia
- **WHEN** um `viewer` tenta criar ou rotacionar
- **THEN** a resposta é `403 FORBIDDEN_ROLE`

### Requirement: URL permitida
A URL do destinatário MUST ser `https`, ter no máximo 500 caracteres, MUST NOT conter usuário e senha e MUST NOT apontar para `localhost`, para endereço de loopback, de rede privada ou de link-local informados como IP literal; caso contrário a resposta MUST ser `422 WEBHOOK_URL_NOT_ALLOWED`. A plataforma MUST NOT seguir redirecionamentos ao entregar: uma resposta `3xx` MUST contar como falha da entrega.

#### Scenario: URL interna
- **WHEN** o operador cadastra `https://192.168.0.10/hook` ou `https://localhost/hook`
- **THEN** a resposta é `422 WEBHOOK_URL_NOT_ALLOWED`

#### Scenario: URL com usuário e senha
- **WHEN** o operador cadastra `https://usuario:senha@erp.example.com/hook`
- **THEN** a resposta é `422 WEBHOOK_URL_NOT_ALLOWED`

#### Scenario: URL sem HTTPS
- **WHEN** o operador cadastra `http://erp.example.com/hook`
- **THEN** a resposta é `422 WEBHOOK_URL_NOT_ALLOWED`

#### Scenario: Redirecionamento
- **WHEN** o destinatário responde `302` a uma entrega
- **THEN** a tentativa é registrada como falha (`HTTP 302`) e a plataforma não chama o endereço do redirecionamento

### Requirement: Uma entrega por evento e destinatário
Quando um evento é gravado no outbox, a plataforma MUST criar, na mesma transação, uma entrega para cada destinatário ativo cujo filtro de tipos inclua o tipo do evento e cujo filtro de apps inclua o app do evento (ou esteja vazio). Um destinatário criado depois do evento MUST NOT receber esse evento. Evento que não é gravado (aplicação inativa ou decisão repetida) MUST NOT gerar entrega. A entrega ao app MUST NOT depender de nenhuma entrega a destinatário.

#### Scenario: Evento com dois destinatários interessados
- **WHEN** `subscription.renewed` é gravado e há um destinatário que quer esse tipo e outro que quer só `charge.refunded`
- **THEN** existe uma entrega pendente para o primeiro, nenhuma para o segundo, e a entrega ao app segue normal

#### Scenario: Destinatário novo não recebe o passado
- **WHEN** um destinatário é criado depois de eventos já gravados
- **THEN** ele só recebe os eventos gravados a partir da criação

#### Scenario: Filtro por app
- **WHEN** o destinatário só quer o app `crmthink.gptmaker` e um evento do app `crmthink.extrator` é gravado
- **THEN** não há entrega para esse destinatário

### Requirement: Entrega assinada
A plataforma MUST entregar a cada destinatário o mesmo envelope JSON que os apps recebem, por `POST` na URL cadastrada, com os cabeçalhos `X-Platform-Signature` (formato `t=<unix>,v1=<hmac-sha256(segredo, t + "." + corpo)>`), `X-Platform-Event-Id` e `X-Platform-Event-Type`. A assinatura MUST usar o segredo do destinatário, e durante a convivência de uma rotação MUST levar uma assinatura `v1=` por segredo vigente. A resposta `2xx` MUST marcar a entrega como entregue; qualquer outra resposta, erro de rede ou tempo esgotado MUST contar como falha. O envelope MUST NOT conter token, chave de API nem segredo.

#### Scenario: Entrega bem-sucedida
- **WHEN** o destinatário responde `200`
- **THEN** a entrega fica `delivered` e a tentativa registra o status HTTP

#### Scenario: Assinatura verificável
- **WHEN** o destinatário recalcula o HMAC com o segredo que recebeu no cadastro
- **THEN** o valor coincide com o `v1=` do cabeçalho

### Requirement: Retentativa e dead-letter independentes
Uma entrega com falha MUST ser reagendada com o mesmo backoff exponencial das entregas aos apps (30 s dobrando até 1 h) e MUST virar `dead` quando a próxima tentativa passaria da janela de reenvio configurada, gerando alerta de operação. O estado, as tentativas e o atraso de um destinatário MUST NOT afetar a entrega a outro destinatário nem a entrega ao app.

#### Scenario: Destinatário fora do ar
- **WHEN** o destinatário responde `503` a todas as tentativas durante a janela
- **THEN** a entrega vira `dead` com alerta, e a entrega do mesmo evento ao app já tinha sido concluída normalmente

### Requirement: Ordem por instalação e destinatário
Para cada par (destinatário, instalação), a plataforma MUST entregar as entregas pendentes na ordem em que os eventos foram gravados: uma entrega só sai quando não há entrega pendente mais antiga do mesmo par. Entregas `dead` MUST NOT bloquear as seguintes. Destinatário desativado MUST NOT receber tentativas; as entregas pendentes MUST ficar à espera e retomar na reativação, sujeitas à mesma janela de reenvio.

#### Scenario: Evento antigo em retentativa
- **WHEN** `installation.created` falha e `subscription.trial_started` da mesma instalação já está pendente para o mesmo destinatário
- **THEN** `subscription.trial_started` só é tentado depois que `installation.created` for entregue ou morrer

#### Scenario: Instalações diferentes
- **WHEN** a entrega de uma instalação está em retentativa
- **THEN** as entregas de outras instalações do mesmo destinatário seguem normalmente

### Requirement: Rotação do segredo
`POST /admin/webhook-endpoints/{id}/rotate-secret` MUST gerar um segredo novo, devolvê-lo uma única vez e manter o anterior válido, junto com o novo, pelo período de convivência de credenciais configurado. O segredo MUST ficar cifrado em repouso e MUST NOT ser recuperável depois da criação ou da rotação.

#### Scenario: Convivência
- **WHEN** o operador rotaciona o segredo
- **THEN** as entregas seguintes levam duas assinaturas `v1=`, até o fim da convivência, e depois só a do segredo novo

### Requirement: Consulta e reenvio das entregas
`GET /admin/webhook-endpoints/{id}/deliveries` MUST listar as entregas do destinatário, da mais recente para a mais antiga, com paginação por cursor, filtro por estado (`pending`, `delivered`, `dead`) e, em cada uma, o tipo do evento, a instalação, o estado e as tentativas (status HTTP e erro); MUST estar disponível para `viewer` e `operator` e MUST NOT mostrar o corpo do evento. `POST /admin/webhook-deliveries/{id}/resend` MUST devolver uma entrega a `pending` com janela nova. `POST /admin/webhook-endpoints/{id}/resend-dead` MUST fazer o mesmo com todas as entregas `dead` do destinatário, aceitar `dryRun` para só contar e recusar com `422 RESEND_TOO_LARGE` acima de 5000. O reenvio MUST exigir `operator` e o motivo em `X-Admin-Reason` quando for em lote.

#### Scenario: Reenviar uma entrega morta
- **WHEN** um `operator` reenvia uma entrega `dead`
- **THEN** ela volta a `pending` com janela nova e é entregue no próximo ciclo se o destinatário estiver ativo

#### Scenario: Reenvio em lote com prévia
- **WHEN** um `operator` chama `resend-dead` com `dryRun`
- **THEN** a resposta traz quantas entregas seriam reenviadas e nada muda

#### Scenario: Destinatário inexistente
- **WHEN** a rota recebe o id de um destinatário que não existe
- **THEN** a resposta é `404 WEBHOOK_ENDPOINT_NOT_FOUND`

### Requirement: Observabilidade das entregas
A plataforma MUST expor a métrica `platform_webhook_deliveries_total{outcome}` (`delivered`, `failed`, `dead`) e os indicadores de entregas pendentes e mortas, e MUST registrar o alerta `webhook.dead_letter` quando uma entrega morrer.

#### Scenario: Dead-letter
- **WHEN** uma entrega esgota a janela
- **THEN** o contador `dead` aumenta e o alerta `webhook.dead_letter` é registrado com o tipo do evento e o último erro
