## ADDED Requirements

### Requirement: Idiomas da página de instalação
A página `/install/{appCode}` MUST oferecer português, inglês e espanhol, com um seletor para trocar de idioma. O idioma inicial MUST ser português quando `BX24.getLang()` for `br` ou `pt` e inglês em qualquer outro caso. A escolha feita no seletor MUST prevalecer sobre o idioma do portal. Todos os textos da página, inclusive estados e erros, MUST acompanhar o idioma escolhido. Os textos do tema do app MUST valer para o português e as traduções cadastradas para os outros idiomas; sem tradução, a página MUST usar o padrão da plataforma naquele idioma.

#### Scenario: Portal em português
- **WHEN** o Bitrix abre a página num portal `br`
- **THEN** a página aparece em português

#### Scenario: Portal em outro idioma
- **WHEN** o Bitrix abre a página num portal `la`, `en` ou `de`
- **THEN** a página aparece em inglês e o usuário pode escolher espanhol ou português

#### Scenario: App sem tradução
- **WHEN** o app só tem textos em português e o usuário vê a página em inglês
- **THEN** a página mostra os textos padrão em inglês

#### Scenario: Erro na instalação
- **WHEN** a instalação é recusada com um `code` conhecido numa página em espanhol
- **THEN** a página mostra a mensagem em espanhol
