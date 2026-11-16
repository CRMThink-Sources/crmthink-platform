# Spec Delta

## ADDED Requirements

### Requirement: Integrações de pagamento
O backoffice MUST oferecer a tela "Integrações de pagamento" no grupo Operação do menu, com a lista de integrações (nome, prefixo da chave, estado, último uso, criação). `viewer` MUST ver a lista sem controles de ação; `operator` MUST poder criar, renomear, desativar, reativar e rotacionar a chave, com motivo obrigatório na criação, na rotação e na desativação. A chave completa MUST ser exibida só na resposta da criação e da rotação, num diálogo que avisa que ela não aparecerá de novo e que permite copiá-la, e MUST NOT ser gravada em cache de consultas, armazenamento do navegador, URL ou logs do console. Erros da API MUST aparecer no diálogo, que MUST permanecer aberto.

#### Scenario: Criar e copiar a chave
- **WHEN** um `operator` cria a integração "Banco X" com motivo
- **THEN** a interface mostra a chave completa com o aviso de que ela não será exibida de novo e, ao fechar o diálogo, a lista mostra só o prefixo

#### Scenario: Suporte só consulta
- **WHEN** um `viewer` abre "Integrações de pagamento"
- **THEN** vê a lista e não vê botões de criar, rotacionar nem desativar

#### Scenario: Desativar exige motivo
- **WHEN** um `operator` desativa uma integração sem informar o motivo
- **THEN** a interface bloqueia o envio e pede o motivo
