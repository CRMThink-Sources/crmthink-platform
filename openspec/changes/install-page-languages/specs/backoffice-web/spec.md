## ADDED Requirements

### Requirement: Traduções do tema de instalação
O cadastro e a edição de app MUST permitir informar título, texto de boas-vindas e texto dos termos em inglês e em espanhol. Campos vazios MUST NOT ser enviados, e um tema sem nenhum campo preenchido MUST ser enviado como `null`.

#### Scenario: Adicionar uma tradução
- **WHEN** o operador preenche o texto de boas-vindas em espanhol e salva
- **THEN** o tema é enviado com a tradução, preservando os demais textos
