## Context

- A API é Express e não tem frontend. O único HTML servido hoje é a página de instalação (`/install/:appCode`), renderizada no servidor.
- O SDK em `sdk/typescript` não tem `package.json` de dependências próprio no build: usa as dependências da raiz e gera tipos com `openapi-typescript` a partir de `docs/api/openapi.json`, com teste de deriva.
- O `Dockerfile` faz `yarn install --production` na raiz para o runtime. Qualquer dependência de frontend na raiz entraria na imagem ou exigiria `devDependencies`.
- O cookie de sessão de `backoffice-foundation` tem `Path=/admin` e `SameSite=Strict`, e as mutações exigem `Origin` em `BACKOFFICE_ORIGINS`.

## Goals / Non-Goals

**Goals:**
- Mesma origem da API em todos os ambientes, sem CORS e sem cookie de terceiro.
- Tipos da API gerados do contrato, com falha de CI quando divergirem.
- O backoffice não muda as dependências nem o tamanho do runtime da API, além do `dist` estático.

**Non-Goals:**
- Ações de escrita sobre recursos (`backoffice-actions`).
- Testes end-to-end com navegador real. Ficam para quando as ações existirem.
- Internacionalização além do pt-br.

## Decisions

### 1. Pacote isolado em `web/backoffice/`
O pacote tem `package.json` e `yarn.lock` próprios e não usa workspaces. A instalação e o build do web não tocam o `node_modules` da API, e o `yarn install --production` da imagem continua igual.
- Alternativa: workspaces do Yarn. Recusada porque mudaria o lockfile e o fluxo de instalação de toda a API e do CI só para isolar um app estático.

### 2. Stack
- Vite + React 19 + TypeScript estrito.
- Tailwind v4 + shadcn/ui. Os componentes são copiados para `src/components/ui`, sem dependência de runtime de terceiros.
- React Router (data router, `basename: '/backoffice'`).
- TanStack Query para todas as leituras. TanStack Table para as listas. `date-fns` + `date-fns-tz` para as datas.
- Fontes e ícones (`lucide-react`) vão no bundle, porque a CSP proíbe outras origens.

### 3. Cliente tipado
`openapi-typescript` gera `src/api/schema.d.ts` a partir de `../../docs/api/openapi-admin.json`, e `openapi-fetch` é o cliente (`credentials: 'same-origin'`). Um script `yarn gen:api` regera os tipos e o CI falha se o arquivo versionado divergir, no mesmo padrão do SDK. Um interceptador trata as respostas assim:
- 401 → limpa o cache do Query e vai para `/login?next=<url atual>`;
- 403 `PASSWORD_CHANGE_REQUIRED` → vai para a troca de senha;
- outros erros → `ApiError { status, code, message }` para os componentes.

### 4. Estado na URL
Cada tela de lista define um schema zod dos search params (filtros, `cursor`, `tab`). Um hook `useSearchState(schema)` lê e escreve a URL. A query key do TanStack Query é derivada desses params, então URL e cache não divergem. Paginação por cursor usa `useInfiniteQuery` com "Carregar mais" na linha do tempo e páginas "Anterior/Próxima" nas tabelas. Nas tabelas, a pilha de cursores vai na URL (`cursor` atual) e o histórico do navegador cuida do "Anterior".

### 5. Entrega em `/backoffice`
`src/app.ts` monta `express.static` de `web/backoffice/dist` sob `/backoffice`, antes do fallback 404:
- `assets/*`: `Cache-Control: public, max-age=31536000, immutable`;
- demais caminhos: `index.html` com `no-store`;
- headers de segurança só nesse router, sem afetar a página de instalação nem a API.

Se `dist` não existir (dev da API sem build do web), a rota responde 404 com uma mensagem que indica o comando de build. A paridade rotas × contrato do `api-reference` ignora `/backoffice`, porque não é API. O teste de paridade ganha essa exceção explícita.
- Alternativa: o Caddy serve os estáticos. Recusada porque exigiria volume compartilhado entre o build e o Caddy em cada ambiente e separaria a versão da UI da versão da API.

### 6. Desenvolvimento
`vite dev` em `:5173` com proxy de `/admin` para `:4100`. Assim o cookie e o `Origin` funcionam com `ADMIN_COOKIE_INSECURE=true` e `BACKOFFICE_ORIGINS=http://localhost:5173`.

### 7. Estrutura de telas
```
/login  /password
/                    painel
/installations       lista  →  /installations/:id?tab=timeline|events|attempts
/events              lista  →  painel lateral com o detalhe e as entregas
/stripe-events       lista  →  painel lateral (payload só para operator)
/apps                lista  →  /apps/:appCode
/audit               lista
```
O layout tem barra lateral, cabeçalho com o operador, o papel, o tema e "Sair", e breadcrumbs. Um componente `<RoleGate role="operator">` esconde controles. A API continua sendo a barreira real.

### 8. Testes
Vitest + Testing Library + MSW, com handlers montados a partir dos tipos gerados. Cobrem: o fluxo de login (sucesso, erro genérico, 429, senha provisória), o redirecionamento em 401 com `next`, o `RoleGate`, o estado na URL de uma lista e o merge visual da linha do tempo. Na API, um teste de supertest cobre a entrega de `/backoffice` (fallback, cache e CSP).

### 9. Build e CI
- `Dockerfile`: novo estágio `web` (`node:20-alpine`, `yarn install --frozen-lockfile` e `yarn build` em `web/backoffice`). O runner copia `web/backoffice/dist`.
- CI: novo job `web` com `yarn --cwd web/backoffice install --frozen-lockfile`, lint, `check-types`, `test`, `build` e a checagem de deriva de `schema.d.ts`.

## Risks / Trade-offs

- [Dois lockfiles para manter] → o Dependabot e o CI cobrem `web/backoffice`. É o preço de manter o runtime da API limpo.
- [shadcn copia componentes, sem atualização automática] → os componentes ficam versionados e são atualizados com o CLI do shadcn quando preciso.
- [CSP estrita quebra libs que injetam estilo inline] → `style-src 'self' 'unsafe-inline'` só se algum componente exigir, avaliado na tarefa de headers. Scripts continuam sem `unsafe-inline`.
- [Imagem maior e build mais lento] → o `dist` estático tem poucos MB. O estágio `web` fica em cache do Docker quando `web/` não muda.

## Migration Plan

1. Implantar depois de `backoffice-foundation` (incluindo os operadores criados).
2. Adicionar o host de cada ambiente a `BACKOFFICE_ORIGINS`.
3. O rollback é reimplantar a imagem anterior. Nenhuma migração de dados.
