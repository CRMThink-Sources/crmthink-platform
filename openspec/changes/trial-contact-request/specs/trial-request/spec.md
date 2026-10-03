## Purpose

Permite que o app solicite o trial de uma instalação enviando os dados de contato do cliente, para que o comercial tenha nome, e-mail, telefone, empresa e cargo de quem está testando e possa acompanhar a conversão.

## ADDED Requirements

### Requirement: Solicitação de trial com contato
O sistema MUST expor `POST /v1/installations/{id}/trial`, autenticada pela chave de API do app, aceita apenas para instalações do próprio app (as demais respondem `INSTALLATION_NOT_FOUND`). O corpo MUST trazer `name`, `email` (formato de e-mail), `phone`, `company` e `role`, todos obrigatórios e não vazios depois de remover espaços. Um corpo inválido MUST responder `VALIDATION_ERROR` sem gravar nada. Um app sem trial configurado MUST receber `TRIAL_NOT_CONFIGURED` sem gravar nada.

#### Scenario: Corpo incompleto
- **WHEN** o app envia a solicitação sem `phone`
- **THEN** a resposta é 400 `VALIDATION_ERROR` com `details` apontando `phone`, e nem o banco nem o SPA 1060 são alterados

#### Scenario: Instalação de outro app
- **WHEN** o app GPTMaker solicita trial para uma instalação do Extrator
- **THEN** a resposta é 404 `INSTALLATION_NOT_FOUND`

### Requirement: Resultado da solicitação
Com corpo válido, o sistema MUST gravar o contato na instalação e então:
- se a instalação nunca usou trial e não tem assinatura aberta, MUST iniciar o trial com as mesmas regras do trial automático (fim em agora + duração de trial do app, uma vez por instalação, evento `subscription.trial_started`) e responder 201 com `subscriptionId` e `trialEndsAt`;
- se já existe assinatura `trialing`, MUST responder 200 com `subscriptionId` e `trialEndsAt` dessa assinatura, sem criar outra nem emitir evento;
- se o trial já foi usado e não está vigente, MUST responder 409 `TRIAL_ALREADY_USED`;
- se há assinatura aberta que não é trial, MUST responder 409 `SUBSCRIPTION_ALREADY_EXISTS`.

Nos casos 409, o contato MUST continuar gravado.

#### Scenario: Primeira solicitação
- **WHEN** uma instalação do GPTMaker sem trial (app com trial de 14 dias e sem `trial_on_install`) recebe uma solicitação válida
- **THEN** o contato é gravado, a assinatura `trialing` é criada com fim em 14 dias, `subscription.trial_started` é emitido e a resposta é 201

#### Scenario: Trial automático já criado
- **WHEN** uma instalação cujo trial nasceu por `trial_on_install` recebe uma solicitação válida
- **THEN** o contato é gravado e a resposta é 200 com o `subscriptionId` e o `trialEndsAt` do trial existente, sem novo evento

#### Scenario: Trial expirado
- **WHEN** uma instalação com trial `trial_expired` recebe uma solicitação válida
- **THEN** o contato é gravado e a resposta é 409 `TRIAL_ALREADY_USED`

#### Scenario: Solicitações simultâneas
- **WHEN** duas solicitações válidas para a mesma instalação sem trial chegam ao mesmo tempo
- **THEN** só um trial é criado: uma resposta é 201 e a outra é 200 com o mesmo `subscriptionId`

### Requirement: Armazenamento do contato
O contato MUST ser gravado na instalação no banco, onde substitui o contato anterior e passa a ser o e-mail usado no checkout, e nos campos de nome, e-mail, telefone, empresa e cargo do item da instalação no SPA 1060. Uma falha ao gravar no SPA 1060 MUST NOT impedir o trial nem a resposta ao app. O sistema MUST registrar a falha em log para reprocessamento manual.

#### Scenario: Checkout após solicitação
- **WHEN** o app cria uma sessão de checkout para uma instalação que solicitou trial com `email = ana@cliente.com`
- **THEN** a sessão do Stripe é criada com `customerEmail = ana@cliente.com`

#### Scenario: SPA indisponível
- **WHEN** a atualização do item no SPA 1060 falha durante a solicitação
- **THEN** o contato fica gravado no banco, o trial segue as regras normais, a resposta ao app não muda e a falha aparece no log

### Requirement: Trial pelo operador
O sistema MUST expor `POST /admin/installations/{id}/trial` com credencial de operador para casos excepcionais, para qualquer instalação. A rota MUST aceitar o mesmo corpo de contato como opcional, gravando-o quando enviado, e MUST manter o comportamento atual: 201 ao criar, `TRIAL_ALREADY_USED` ou `SUBSCRIPTION_ALREADY_EXISTS` quando não cabe trial, inclusive se já houver trial vigente. A rota MUST NOT ser publicada no contrato público.

#### Scenario: Operador sem contato
- **WHEN** um operador chama a rota sem corpo para uma instalação sem trial
- **THEN** o trial é criado (201) e o contato existente da instalação não é alterado

#### Scenario: Chave de app na rota de operador
- **WHEN** um app chama `POST /admin/installations/{id}/trial` com a própria chave de API
- **THEN** a resposta é 401 `UNAUTHORIZED`
