# Spec Delta

## ADDED Requirements

### Requirement: Destinatários de eventos
O backoffice MUST oferecer a tela "Destinatários de eventos" no grupo Operação do menu, com a lista de destinatários (nome, URL, tipos, apps, estado, última entrega, entregas pendentes e mortas). `viewer` MUST ver a lista e o detalhe sem controles de ação; `operator` MUST poder criar, editar, desativar, reativar e rotacionar o segredo, com motivo obrigatório na criação, na rotação e na desativação. O formulário MUST oferecer os tipos de evento agrupados (instalação, assinatura, compra e estorno) e a seleção de apps, com "todos os apps" quando nenhum for marcado, e MUST recusar antes de enviar a URL sem HTTPS. O segredo completo MUST ser exibido só na resposta da criação e da rotação, num diálogo que avisa que ele não aparecerá de novo, e MUST NOT ser gravado em cache de consultas, armazenamento do navegador, URL ou logs do console. Erros da API MUST aparecer no diálogo, que MUST permanecer aberto.

#### Scenario: Criar e copiar o segredo
- **WHEN** um `operator` cria o destinatário "ERP" com URL HTTPS, tipos de assinatura e motivo
- **THEN** a interface mostra o segredo completo com o aviso de que não será exibido de novo e, ao fechar, a lista mostra o destinatário sem o segredo

#### Scenario: URL sem HTTPS
- **WHEN** o operador digita `http://erp.example.com/hook`
- **THEN** a interface mostra o erro no campo e não envia a requisição

#### Scenario: Suporte só consulta
- **WHEN** um `viewer` abre "Destinatários de eventos"
- **THEN** vê a lista e o detalhe e não vê botões de criar, editar, rotacionar, desativar nem reenviar

### Requirement: Entregas de um destinatário
O detalhe de um destinatário MUST listar as entregas com filtro por estado, o tipo do evento, a instalação, o estado e as tentativas (status HTTP e erro de cada uma), com carregamento de mais itens. `operator` MUST poder reenviar uma entrega e reenviar em lote as entregas mortas, este último com a prévia da quantidade e o motivo obrigatório. O estado, os filtros e o cursor MUST ficar na URL.

#### Scenario: Reenviar as mortas
- **WHEN** um `operator` escolhe "Reenviar mortas" e a prévia mostra 12 entregas
- **THEN** a interface pede o motivo, envia o reenvio e mostra que 12 entregas voltaram para a fila

#### Scenario: Filtrar por estado
- **WHEN** o operador filtra por `dead`
- **THEN** a lista mostra só as entregas mortas e o endereço da página guarda o filtro
