# Design

## Decisões

- **Os três idiomas vão na própria página** e a troca é no navegador: não há recarregamento nem nova rota. O idioma do portal só é conhecido pelo `BX24.getLang()`.
- **HTML inicial em inglês**, o padrão para quem não é de portal em português. Portal em português vê inglês por um instante, até o `BX24.init`.
- **`installTheme.translations`** em vez de transformar cada texto em mapa por idioma: compatível com o que está gravado.
- **Sem tradução cai no padrão do idioma**, não no texto em português do app, para não misturar idiomas.
- **Erros pelo `code`** na página; a API não muda.
