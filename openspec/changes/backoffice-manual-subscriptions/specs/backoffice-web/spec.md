# Spec Delta

## ADDED Requirements

### Requirement: Nova assinatura na instalação
O detalhe de uma instalação `ACTIVE` MUST oferecer ao `operator` a ação "Nova assinatura", que abre um diálogo com: plano, tipo (cobrança manual ou bonificação), início (padrão hoje), fim, responsável (só na bonificação, obrigatório) e motivo (obrigatório). A lista de planos MUST mostrar só planos ativos, de assinatura e não de trial, dos produtos vinculados ao app da instalação. A interface MUST validar antes de enviar que o fim existe, é posterior ao início e fica no máximo 24 meses depois dele, com as mesmas mensagens da API. Para `viewer` e para instalação que não esteja `ACTIVE`, a ação MUST NOT aparecer. Depois de criar, a interface MUST atualizar o detalhe e avisar o sucesso. Os erros `SUBSCRIPTION_ALREADY_EXISTS` e `SUBSCRIPTIONS_READ_ONLY` MUST aparecer no próprio diálogo com a mensagem da API, `INVALID_PERIOD` MUST aparecer junto ao campo de fim, e o diálogo MUST permanecer aberto para correção.

#### Scenario: Operador cria bonificação
- **WHEN** um `operator` abre "Nova assinatura", escolhe bonificação, preenche plano, fim, responsável e motivo e confirma
- **THEN** a interface envia a criação com o motivo no cabeçalho, mostra o aviso de sucesso e o detalhe passa a exibir a assinatura corrente

#### Scenario: Viewer não vê a ação
- **WHEN** um `viewer` abre o detalhe de uma instalação
- **THEN** a ação "Nova assinatura" não é exibida

#### Scenario: Instalação já com assinatura
- **WHEN** a API responde `409 SUBSCRIPTION_ALREADY_EXISTS`
- **THEN** o diálogo continua aberto e mostra a mensagem do erro

#### Scenario: Fim fora do limite
- **WHEN** o operador informa um fim mais de 24 meses depois do início
- **THEN** a interface mostra o erro no campo de fim e não envia a requisição
