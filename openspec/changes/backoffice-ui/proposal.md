## Why

`backoffice-foundation` entrega identidade, papéis, auditoria e a API de leitura, mas dev e suporte ainda dependem de `curl` para consultar uma instalação, entender por que um app não recebeu um evento ou ver quem fez uma ação. Esta mudança cria a interface web de leitura do backoffice sobre essa API.

## What Changes

- Novo app React em `web/backoffice/` (Vite, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query), com cliente HTTP tipado gerado de `docs/api/openapi-admin.json`.
- Servido pela própria API em `/backoffice`, no mesmo host de `/admin/*`: o cookie de sessão funciona sem CORS. Os headers de segurança são próprios da rota (CSP sem scripts de terceiros, `frame-ancestors 'none'`).
- Telas de acesso: login (e-mail, senha e TOTP), troca obrigatória de senha provisória, troca da própria senha, logout e volta ao login quando a sessão expira.
- Telas de leitura:
  - **Painel**: contadores do `GET /admin/overview`.
  - **Instalações**: busca e filtros; detalhe com resumo, saúde dos tokens, assinatura e abas de timeline, eventos e tentativas.
  - **Eventos enviados aos apps**: filtros e detalhe com as tentativas de entrega.
  - **Eventos Stripe**: lista; o payload só aparece para `operator`.
  - **Apps**: lista e detalhe da configuração, sem segredos.
  - **Auditoria**: filtros por ator, ação, alvo e período.
- Filtros e paginação ficam na URL. O suporte pode mandar o link de uma busca ou de uma instalação.
- Interface em pt-br, datas no fuso `America/Sao_Paulo`, tema claro e escuro, uso em tela de notebook.
- A imagem Docker passa a compilar o backoffice. O CI passa a rodar lint, tipos, testes e build do app web e a checar a deriva dos tipos gerados.
- Esta mudança não traz ações de escrita, exceto as da própria conta (login, logout e senha). As ações ficam em `backoffice-actions`.

## Capabilities

### New Capabilities
- `backoffice-web`: interface web do backoffice: acesso, navegação, telas de leitura, comportamento por papel, estado na URL, entrega pela API e headers de segurança.

### Modified Capabilities
<!-- Nenhuma: as rotas e regras de acesso consumidas já estão em `operator-auth`, `admin-audit` e `admin-read-api` (backoffice-foundation). -->

## Impact

- **Código novo**: `web/backoffice/` (package e lockfile próprios, fora das dependências da API).
- **API**: `src/app.ts` monta a entrega estática de `/backoffice`, com fallback para `index.html` nas rotas do SPA e headers próprios.
- **Build/CI**: `Dockerfile` ganha um estágio para compilar o web e copia `dist` para a imagem. `.github/workflows/ci.yml` ganha o job do web.
- **Config**: `BACKOFFICE_ORIGINS` (de `backoffice-foundation`) passa a incluir o host da API em cada ambiente.
- **Dependência**: requer `backoffice-foundation` implantada.
- **Docs**: `README.md` (desenvolvimento do web) e `docs/technical/architecture.md` (o terceiro componente servido pela API).
