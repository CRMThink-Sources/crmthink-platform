# Proposal

## Why

A página de instalação só existe em português. Portais Bitrix24 em outros idiomas veem uma tela que não entendem.

## What Changes

- A página `/install/{appCode}` ganha textos em português, inglês e espanhol, com seletor PT/EN/ES.
- Idioma inicial: português quando o portal é `br`/`pt`; inglês nos demais.
- `installTheme` aceita `translations.en` e `translations.es` (`title`, `welcomeText`, `termsText`); os campos atuais continuam sendo o português. Sem migration (coluna JSON).
- O backoffice edita as traduções.
- Erros da instalação são traduzidos na página pelo `code`.

Fora do escopo: `termsUrl` por idioma, outros idiomas, pré-visualização traduzida no backoffice e mensagens da API em outros idiomas.

## Capabilities

### Modified Capabilities
- `bitrix-installation`: idiomas da página de instalação.
- `backoffice-web`: edição das traduções do tema.

## Impact

`install-page.ts`, novo `install-texts.ts`, `installThemeSchema`, contrato OpenAPI, tipos do SDK e do backoffice, formulário de app. Apps sem traduções cadastradas passam a mostrar os textos padrão em inglês e espanhol, não os seus em português.
