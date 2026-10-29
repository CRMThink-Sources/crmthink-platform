## Purpose

Permitir que um `operator` execute pela interface do backoffice as ações de operação da plataforma, com confirmação, motivo, pré-visualização de impacto e exibição segura de segredos.

## ADDED Requirements

### Requirement: Controles só para operador
Os controles de ação MUST aparecer só para `operator`. Cada ação MUST abrir um diálogo de confirmação com o alvo, o efeito descrito em pt-br e um campo de motivo. O motivo é obrigatório nas ações de alto impacto e opcional nas outras. Ele é enviado em `X-Admin-Reason`.

#### Scenario: Suporte não vê ações
- **WHEN** um `viewer` abre o detalhe de uma instalação
- **THEN** a tela não mostra "Conceder trial" nem "Renovar token"

### Requirement: Confirmação por digitação nas ações de alto impacto
Rotação de chave de API, rotação de segredo de webhook, desativação de app, reenvio em lote, rotação da chave do JWT e redefinição de acesso de operador MUST exigir que o operador digite o identificador do alvo (o `appCode`, o e-mail do operador, a palavra `REENVIAR` com a quantidade, ou `ROTACIONAR`) antes de liberar o botão de confirmar.

#### Scenario: Rotação de chave de API
- **WHEN** um `operator` abre "Rotacionar chave de API" do app `crmthink.gptmaker`
- **THEN** o botão de confirmar só fica ativo depois de digitar `crmthink.gptmaker` e preencher o motivo

### Requirement: Exibição única de segredos
Chave de API, segredo de webhook, senha provisória e QR code do TOTP devolvidos pela API MUST ser mostrados uma única vez num diálogo com botão de copiar, um aviso de que não serão exibidos de novo e uma confirmação "Guardei" para fechar. Eles MUST NOT ser gravados em cache de consultas, armazenamento do navegador, URL ou logs do console. O QR code MUST ser gerado no navegador, sem enviar o URI `otpauth://` a outro serviço.

#### Scenario: Cadastro de app
- **WHEN** um `operator` cadastra um app
- **THEN** a interface mostra a chave de API e o segredo de webhook uma vez e, depois de fechar o diálogo, o detalhe do app não mostra nenhum dos dois

#### Scenario: Redefinir acesso de operador
- **WHEN** um `operator` redefine o acesso de um `viewer`
- **THEN** a interface mostra a senha provisória e o QR code do novo TOTP uma vez, gerado localmente

### Requirement: Pré-visualização do reenvio em lote
O reenvio em lote MUST primeiro chamar o reenvio com `dryRun` e mostrar a quantidade e uma amostra dos eventos. A confirmação MUST exigir digitar `REENVIAR <quantidade>`. Se a API recusar por excesso, a interface MUST mostrar o limite e sugerir reduzir o período.

#### Scenario: Reenvio dos dead de um app
- **WHEN** um `operator` filtra a lista por `status=dead` e `appCode=crmthink.gptmaker` e escolhe "Reenviar todos"
- **THEN** a interface mostra "37 eventos serão reenviados", pede `REENVIAR 37` e o motivo e, após confirmar, mostra a quantidade reenviada e atualiza a lista

### Requirement: Formulários de app
O cadastro e a edição de app MUST validar no navegador com as mesmas regras da API (campos obrigatórios, URLs, trial com plano quando `trialOnInstall`) e MUST mostrar os erros de validação devolvidos pela API no campo correspondente. A edição MUST enviar só os campos alterados. O tema da página de instalação MUST ter pré-visualização ao lado do formulário. O segredo do cliente Bitrix MUST ser um campo só de escrita, vazio na edição, que só é enviado se preenchido.

#### Scenario: Erro da API no campo
- **WHEN** a API responde `VALIDATION_ERROR` com `details: [{ path: "webhookUrl", message }]`
- **THEN** a interface mostra a mensagem abaixo do campo "URL de webhook"

### Requirement: Atualização após a ação
Depois de uma ação bem-sucedida, a interface MUST mostrar uma notificação com o resultado e MUST atualizar as telas afetadas (por exemplo, o detalhe e a linha do tempo da instalação, a lista de eventos e o painel). Em caso de erro, MUST mostrar o código e a mensagem da API e manter o diálogo aberto com os dados preenchidos.

#### Scenario: Trial concedido
- **WHEN** um `operator` concede trial a uma instalação
- **THEN** a notificação mostra a data de fim do trial e a linha do tempo passa a exibir a ação de operador e o evento `subscription.trial_started`

### Requirement: Gestão de operadores na interface
A tela "Operadores" MUST listar contas com nome, e-mail, papel, estado e bloqueio, e MUST permitir criar, trocar papel, ativar ou desativar e redefinir acesso. A interface MUST NOT oferecer desativar nem rebaixar a própria conta, e MUST mostrar a mensagem de `LAST_OPERATOR` quando a API recusar.

#### Scenario: Tentar rebaixar a si mesmo
- **WHEN** um `operator` abre a própria linha na lista de operadores
- **THEN** as opções "Desativar" e "Trocar papel" não estão disponíveis
