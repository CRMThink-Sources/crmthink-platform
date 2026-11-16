# payment-webhook Specification

## Purpose

Permitir que um sistema externo (banco, cobrança, automação) avise a plataforma de que um pagamento foi feito, para que ela renove a assinatura manual sozinha, de forma autenticada e idempotente, e permitir que o operador gerencie as credenciais dessas integrações.

## Requirements

### Requirement: Autenticação por chave de integração
`POST /webhooks/payments` MUST exigir `Authorization: Bearer <chave>` com a chave de uma integração de pagamento ativa. Sem chave ou com chave desconhecida a resposta MUST ser `401`; com a integração desativada MUST ser `403 INTEGRATION_INACTIVE`. A chave de um app, a de operador e a sessão de operador MUST NOT autenticar esta rota, e a chave de integração MUST NOT autenticar nenhuma outra rota. A plataforma MUST registrar o último uso da integração.

#### Scenario: Chave de integração válida
- **WHEN** um sistema chama a rota com a chave de uma integração ativa e um aviso válido
- **THEN** o aviso é processado e a integração passa a mostrar o horário do último uso

#### Scenario: Chave de app na rota de pagamento
- **WHEN** um app chama a rota com a própria chave de API
- **THEN** a resposta é `401` e nada é renovado

#### Scenario: Integração desativada
- **WHEN** uma integração desativada chama a rota com a chave que tinha
- **THEN** a resposta é `403 INTEGRATION_INACTIVE`

### Requirement: Renovação da assinatura manual por aviso de pagamento
O corpo MUST informar `externalId` (texto de 1 a 200 caracteres) e exatamente um entre `subscriptionId` (id do item no SPA 1142) e `installationId` (a assinatura vigente da instalação); MAY informar `paidAt` (data) e `periodEnd` (data `AAAA-MM-DD`). Campos desconhecidos MUST ser recusados com `400`, e um corpo que não seja JSON válido MUST ser recusado com `400 INVALID_JSON` e um corpo maior que 16 KB com `413 PAYLOAD_TOO_LARGE` (nunca com erro `500`, para o remetente não repetir o mesmo aviso indefinidamente). O aviso MUST renovar uma assinatura `manual` em status `active` ou `past_due`: o status passa a `active`, o novo início é o fim do período anterior e o novo fim é `periodEnd`, quando informado, ou o fim anterior mais o intervalo do plano (mensal 1, trimestral 3, semestral 6, anual 12 meses). O app MUST receber um único `subscription.renewed` por renovação. A resposta de sucesso MUST ser `200` com o id da assinatura, o status, o novo período e `duplicate: false`.

#### Scenario: Renovação calculada pelo plano
- **WHEN** chega um aviso para uma assinatura manual ativa de plano trimestral, sem `periodEnd`
- **THEN** o fim do período avança três meses, o status continua `active` e o app recebe `subscription.renewed`

#### Scenario: Pagamento depois do atraso
- **WHEN** chega um aviso para uma assinatura manual em `past_due`
- **THEN** ela volta a `active` com o período estendido e o app recebe `subscription.renewed`

#### Scenario: Fim do período informado
- **WHEN** o aviso traz `periodEnd` posterior ao fim atual
- **THEN** o novo fim é o informado, e não o calculado pelo plano

#### Scenario: Corpo que não é JSON
- **WHEN** o remetente envia um corpo malformado
- **THEN** a resposta é `400 INVALID_JSON` e nada é renovado

#### Scenario: Instalação em vez de assinatura
- **WHEN** o aviso traz `installationId` de uma instalação com assinatura manual vigente
- **THEN** essa assinatura é a renovada

### Requirement: Validação do aviso
A assinatura MUST existir (`404 SUBSCRIPTION_NOT_FOUND`, ou `404 INSTALLATION_NOT_FOUND` quando a instalação não existe) e ser de modalidade `manual` (`422 NOT_MANUAL_SUBSCRIPTION`). O status MUST ser `active` ou `past_due`; os demais, inclusive `trialing`, `cancelled` e `trial_expired`, MUST ser recusados com `409 SUBSCRIPTION_NOT_RENEWABLE`. O novo fim MUST ser posterior ao fim atual e ficar no máximo 24 meses depois de hoje; caso contrário a resposta MUST ser `422 INVALID_PERIOD`. Plano sem intervalo e aviso sem `periodEnd` MUST ser recusados com `422 INVALID_PERIOD`. Fora de `PLATFORM_ENVIRONMENT=production` a resposta MUST ser `409 SUBSCRIPTIONS_READ_ONLY`. Nenhum aviso recusado pode alterar o SPA nem emitir evento.

#### Scenario: Assinatura Stripe
- **WHEN** o aviso aponta para uma assinatura de modalidade `stripe`
- **THEN** a resposta é `422 NOT_MANUAL_SUBSCRIPTION` e nada muda

#### Scenario: Assinatura cancelada
- **WHEN** o aviso aponta para uma assinatura `cancelled`
- **THEN** a resposta é `409 SUBSCRIPTION_NOT_RENEWABLE` e nada muda

#### Scenario: Avanço exagerado
- **WHEN** o novo fim ficaria mais de 24 meses depois de hoje
- **THEN** a resposta é `422 INVALID_PERIOD` e nada muda

### Requirement: Idempotência por externalId
Um aviso repetido com o mesmo `externalId` da mesma integração MUST NOT renovar de novo: a resposta MUST ser `200` com o resultado original e `duplicate: true`, sem nova escrita no SPA e sem novo evento. O mesmo `externalId` com outra assinatura MUST ser recusado com `409 EXTERNAL_ID_REUSED`. A plataforma MUST registrar o período decidido antes de escrever no SPA, de modo que a repetição de um aviso interrompido no meio conclua exatamente o período já decidido, nunca um período a mais. `externalId` iguais de integrações diferentes MUST ser independentes. Avisos simultâneos para a mesma instalação MUST ser processados um por vez.

#### Scenario: Aviso repetido
- **WHEN** o mesmo sistema reenvia o aviso com o mesmo `externalId` depois de ter sido processado
- **THEN** a resposta é `200` com `duplicate: true`, o período não avança e nenhum evento novo sai

#### Scenario: Processo interrompido no meio
- **WHEN** o processamento cai depois de escrever no SPA e antes de concluir, e o sistema reenvia o aviso
- **THEN** a assinatura termina com o período decidido da primeira vez, com um único `subscription.renewed`

#### Scenario: externalId reaproveitado
- **WHEN** o mesmo `externalId` chega para outra assinatura
- **THEN** a resposta é `409 EXTERNAL_ID_REUSED` e nada muda

### Requirement: Rastro do pagamento
Cada aviso aceito MUST ficar registrado com a integração, o `externalId`, a assinatura, o período aplicado, `paidAt` e o horário. A plataforma MUST adicionar à linha do tempo da assinatura um comentário com a integração, o `externalId` e o período; uma falha ao gravar o comentário MUST NOT desfazer a renovação. A chave da integração MUST NOT aparecer em logs, em comentários nem em registros.

#### Scenario: Comentário na assinatura
- **WHEN** um aviso é aceito
- **THEN** a linha do tempo da assinatura no Bitrix mostra o nome da integração, o `externalId` e o novo período

### Requirement: Gestão das integrações pelo operador
O operador MUST poder criar, listar, renomear, desativar, reativar e rotacionar a chave de integrações de pagamento em `/admin/payment-integrations`. Listar MUST estar disponível para `viewer` e `operator`; as demais ações MUST exigir `operator` e o motivo no header `X-Admin-Reason` (a renomeação e a reativação, não). A chave MUST ser devolvida só na criação e na rotação, uma única vez, e MUST NOT ser recuperável depois; a lista MUST mostrar só os primeiros caracteres para identificação, o estado, o último uso e a criação. A rotação MUST invalidar a chave anterior imediatamente. Desativar MUST bloquear a integração sem apagar o histórico. Toda mutação MUST ser auditada com alvo `payment_integration`, sem a chave no registro.

#### Scenario: Criar integração
- **WHEN** um `operator` cria a integração "Banco X" informando o motivo
- **THEN** a resposta traz a chave completa uma única vez e a lista passa a mostrar a integração só com o prefixo

#### Scenario: Rotacionar a chave
- **WHEN** um `operator` rotaciona a chave de uma integração
- **THEN** a chave nova é devolvida uma vez e a antiga deixa de autenticar na hora

#### Scenario: Viewer não gerencia
- **WHEN** um `viewer` tenta criar ou rotacionar
- **THEN** a resposta é `403 FORBIDDEN_ROLE` e nada muda

#### Scenario: Integração inexistente
- **WHEN** um `operator` altera uma integração que não existe
- **THEN** a resposta é `404 PAYMENT_INTEGRATION_NOT_FOUND`
