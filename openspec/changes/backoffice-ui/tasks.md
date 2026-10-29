## 1. Projeto web

- [ ] 1.1 Criar `web/backoffice/` com Vite + React + TypeScript estrito, Tailwind v4, ESLint e Prettier no padrão da raiz, `package.json` e `yarn.lock` próprios; verificar com `yarn --cwd web/backoffice build` gerando `dist/index.html`
- [ ] 1.2 Inicializar o shadcn/ui (`components.json`, tokens de tema claro e escuro, componentes base: button, input, table, tabs, badge, card, sheet, dialog, dropdown-menu, tooltip, skeleton, sonner) e instalar `lucide-react`, React Router, TanStack Query e Table, `date-fns`/`date-fns-tz` e `zod`; verificar que o build passa e o bundle não referencia origens externas (`grep -r "https://" dist` sem URLs de fontes ou CDN)
- [ ] 1.3 Configurar Vitest + Testing Library + MSW e o proxy do `vite dev` para `/admin` → `:4100`; verificar com um teste de exemplo passando e documentar o fluxo de desenvolvimento no `README.md`

## 2. Cliente da API

- [ ] 2.1 Criar `yarn gen:api` (openapi-typescript sobre `../../docs/api/openapi-admin.json` → `src/api/schema.d.ts`) e o teste ou script de deriva usado no CI; verificar que alterar o contrato sem regerar faz a checagem falhar
- [ ] 2.2 Criar o cliente `openapi-fetch` com `credentials: 'same-origin'`, `ApiError` e o interceptador de 401 (limpar cache e ir para `/login?next=`) e de 403 `PASSWORD_CHANGE_REQUIRED`; verificar com testes MSW dos dois redirecionamentos e do formato de `ApiError`
- [ ] 2.3 Criar `useSearchState(schema)` e o helper de lista paginada por cursor (tabela com Anterior/Próxima e `useInfiniteQuery` para "Carregar mais"); verificar com teste que mudar um filtro atualiza a URL, limpa o cursor e que voltar no histórico restaura o filtro anterior

## 3. Acesso e layout

- [ ] 3.1 Criar as telas `/login` (e-mail, senha, TOTP de 6 dígitos, mensagem genérica, tempo de espera em 429) e `/password` (troca obrigatória e voluntária); verificar com testes de sucesso, falha genérica, 429 com `Retry-After`, senha provisória levando a `/password` e volta ao `next` após o login
- [ ] 3.2 Criar o layout (barra lateral, cabeçalho com operador, papel, tema e "Sair", breadcrumbs), o guard de rotas por `GET /admin/auth/me` e o `RoleGate`; verificar com testes de que sem sessão vai ao login, de que o `viewer` não vê controles marcados como `operator` e de que 403 aparece como "sem permissão"
- [ ] 3.3 Criar os componentes compartilhados: data com tooltip absoluta em `America/Sao_Paulo`, badges de status (instalação, evento, Stripe, saúde de token), estados de carregamento, vazio e erro com "Tentar novamente"; verificar com testes de formatação de data no fuso e dos três estados

## 4. Telas de leitura

- [ ] 4.1 Painel com os contadores de `/admin/overview` e links para as listas filtradas; verificar com teste MSW do cenário "Do contador para a lista"
- [ ] 4.2 Lista de instalações (busca, filtros por app e status, saúde dos tokens) e detalhe (resumo, contato, assinatura com aviso de indisponível, saúde dos tokens, abas na URL); verificar com testes dos cenários "Suporte investiga um cliente" e "Assinatura indisponível"
- [ ] 4.3 Linha do tempo (ícone e cor por `kind`, filtro por tipo, "Carregar mais", tentativas de entrega dentro dos eventos, erro isolado na aba); verificar com testes da ordem, do filtro e do cenário "Linha do tempo falha"
- [ ] 4.4 Eventos enviados aos apps (filtros e painel lateral com envelope e entregas) e eventos Stripe (filtros; payload só para `operator` via `GET /admin/stripe-events/:eventId`); verificar com teste do cenário "Suporte abre um evento Stripe"
- [ ] 4.5 Apps (lista e detalhe sem segredos) e auditoria (filtros e links para instalação ou app); verificar com teste do cenário "Do registro de auditoria para a instalação" e com teste de que o detalhe do app não renderiza nenhum campo de chave ou segredo

## 5. Entrega pela API

- [ ] 5.1 Montar `/backoffice` em `src/app.ts` (estáticos de `web/backoffice/dist`, fallback para `index.html`, cache `immutable` em `assets/*`, `no-store` no `index.html`, CSP e headers só nesse router, 404 explicativo sem `dist`) e excluir `/backoffice` da paridade rotas × contrato; verificar com testes supertest dos cenários "Link direto para uma instalação" e dos headers, e com `yarn test src/docs` passando
- [ ] 5.2 Adicionar o estágio `web` ao `Dockerfile` e copiar `dist` para o runner; verificar com `docker build` e `docker run` respondendo `GET /backoffice/` com o `index.html`
- [ ] 5.3 Adicionar o job `web` ao `.github/workflows/ci.yml` (install, lint, tipos, testes, build e deriva de `schema.d.ts`) e incluir `web/backoffice` no Dependabot, se configurado; verificar com o CI verde num PR
- [ ] 5.4 Atualizar `docs/technical/architecture.md` (backoffice servido pela API, mesma origem, CSP) e `docs/technical/configuration.md` (`BACKOFFICE_ORIGINS` com o host de cada ambiente); verificar lendo o diff

## 6. Integração

- [ ] 6.1 Em staging, com `backoffice-foundation` implantada: entrar como `operator` e como `viewer`, percorrer todas as telas, abrir um link compartilhado em outra aba, deixar a sessão expirar e conferir a volta ao mesmo endereço; verificar também no console do navegador que não há violação de CSP
