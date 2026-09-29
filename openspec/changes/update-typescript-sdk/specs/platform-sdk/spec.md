# Spec Delta

## Purpose

SDK TypeScript oficial com que os apps falam com a plataforma: valida o que a plataforma envia (assinaturas, sessões, eventos), chama as rotas servidor-a-servidor com tipos derivados do contrato OpenAPI e é distribuído como pacote versionado.

## ADDED Requirements

### Requirement: Cliente das rotas servidor-a-servidor
O SDK MUST oferecer um cliente configurado com a URL da plataforma e a chave de API do app que expõe um método para cada operação do contrato público autenticada por chave de app (instalações, tokens e cobrança). Cada método MUST usar o método HTTP e o caminho da operação no contrato, enviar `Authorization: Bearer <chave>`, serializar o corpo em JSON quando houver e devolver o corpo de sucesso já tipado. Respostas `204` MUST resolver sem valor.

#### Scenario: Consulta de planos
- **WHEN** o app chama o método de listar planos
- **THEN** o SDK faz `GET /v1/plans` com o Bearer do app e devolve a lista de planos do contrato

#### Scenario: Criação de checkout
- **WHEN** o app chama o método de checkout com `installationId`, `planId` e `intent`
- **THEN** o SDK faz `POST /v1/checkout-sessions` com esse corpo em JSON e devolve a sessão de checkout

#### Scenario: Remoção de item
- **WHEN** o app remove um item de assinatura
- **THEN** o SDK faz `DELETE /v1/subscriptions/{id}/items/{itemId}` e devolve o item removido, com `deletedAt` preenchido

### Requirement: Erros da plataforma
Toda resposta não-2xx MUST virar um erro com o status HTTP, o `code` estável do envelope `{ error: { code, message, details } }`, a mensagem e os `details`. Quando o corpo não for o envelope, o `code` MUST ser `HTTP_<status>`. Falha de rede ou tempo esgotado MUST virar erro distinguível dos erros da plataforma. O cliente MUST aceitar um tempo máximo por requisição e MUST NOT repetir requisições automaticamente, exceto a renovação de token descrita abaixo.

#### Scenario: Código estável
- **WHEN** o checkout responde `409` com `SUBSCRIPTION_ALREADY_EXISTS`
- **THEN** o erro lançado tem `status` 409 e `code` `SUBSCRIPTION_ALREADY_EXISTS`

#### Scenario: Corpo fora do envelope
- **WHEN** a plataforma responde `502` com corpo que não é JSON
- **THEN** o erro lançado tem `status` 502 e `code` `HTTP_502`

#### Scenario: Tempo esgotado
- **WHEN** a plataforma não responde dentro do tempo configurado
- **THEN** a requisição é abortada e o erro indica tempo esgotado, sem `status` HTTP

### Requirement: Tokens do Bitrix com cache e renovação única
O cliente MUST guardar o token de cada instalação até 5 minutos antes de `expiresAt` e só então buscá-lo de novo. A renovação MUST ser feita pela rota de refresh da plataforma com o token recusado pelo Bitrix, atualizando o cache; o SDK MUST NOT renovar direto no OAuth do Bitrix. O app MUST poder descartar o token de uma instalação do cache. A API anterior de cliente de tokens MUST continuar disponível com o mesmo comportamento.

#### Scenario: Token em cache
- **WHEN** o app pede o token de uma instalação duas vezes e o token vale por mais de 5 minutos
- **THEN** só a primeira chamada vai à plataforma

#### Scenario: Token perto de expirar
- **WHEN** o token em cache expira em menos de 5 minutos
- **THEN** o próximo pedido busca um token novo na plataforma

#### Scenario: Renovação após expired_token
- **WHEN** o app chama a renovação com o token recusado
- **THEN** o SDK faz `POST /v1/installations/{id}/token/refresh` com `staleAccessToken` e passa a devolver o token novo do cache

### Requirement: Tipos derivados do contrato
Os tipos de requisição e resposta do SDK MUST ser derivados do `docs/api/openapi.json` versionado, a partir de um arquivo gerado e versionado no próprio SDK. Os eventos MUST formar uma união discriminada por `type` com o `data` específico de cada tipo de evento do contrato, e o payload da chamada do instalador MUST ter tipo próprio.

#### Scenario: Estreitamento por tipo de evento
- **WHEN** o código do app testa `event.type === 'subscription.renewed'`
- **THEN** o compilador conhece os campos do `data` desse evento

#### Scenario: Campo removido do contrato
- **WHEN** um campo de resposta usado pelo app deixa de existir no contrato e os tipos são regenerados
- **THEN** o código do app que usa o campo deixa de compilar

### Requirement: Verificação do que a plataforma envia
O SDK MUST manter a verificação do header `X-Platform-Signature` (corpo cru, tolerância de 300 s, vários segredos durante rotação, comparação em tempo constante), a validação local do JWT da sessão pelo JWKS (RS256, `iss`, `aud` = `appCode`, `exp`, recarga ao ver `kid` desconhecido) e a regra de consumo de eventos (deduplicar por `eventId`, ignorar evento de assinatura com `version` menor ou igual à última aplicada), com o mesmo comportamento atual.

#### Scenario: Assinatura válida
- **WHEN** o app verifica um corpo assinado pela plataforma com um segredo vigente
- **THEN** a verificação é aceita

#### Scenario: Evento de versão antiga
- **WHEN** chega um evento de assinatura com `version` menor que a última aplicada
- **THEN** a regra de consumo indica que ele não deve ser aplicado

### Requirement: Pacote versionado
O SDK MUST ser distribuído como pacote `@crmthink-sources/platform-sdk` ESM para Node ≥ 20, com declarações de tipo, versão semântica e `jose` como única dependência de execução. O pacote MUST NOT importar código da plataforma nem incluir testes. Mudança incompatível na API pública do SDK MUST aumentar a versão maior.

#### Scenario: Instalação no app
- **WHEN** um app TypeScript instala o pacote e importa o cliente
- **THEN** compila e executa sem nenhum arquivo da plataforma

#### Scenario: Conteúdo do pacote
- **WHEN** o pacote é gerado
- **THEN** contém só o código compilado, as declarações, o `package.json` e o README, sem testes

### Requirement: Sem deriva entre SDK e contrato
O repositório MUST ter testes automáticos que falham quando: uma operação autenticada por chave de app do contrato público não tem método no SDK, ou um método do SDK aponta para método HTTP e caminho inexistentes no contrato; o arquivo de tipos gerado difere do que o `openapi.json` versionado produz; um tipo de evento do contrato não está na união de eventos do SDK. O pacote MUST ser compilado na integração contínua.

#### Scenario: Rota nova sem método
- **WHEN** uma rota com chave de app é adicionada ao contrato e o SDK não ganha método
- **THEN** o teste de deriva falha nomeando a operação

#### Scenario: Tipos desatualizados
- **WHEN** o `openapi.json` muda e os tipos do SDK não são regenerados
- **THEN** o teste falha indicando o comando de geração
