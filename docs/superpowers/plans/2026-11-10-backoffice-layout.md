# Backoffice: layout no estilo do gpt-maker-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o web do backoffice (`web/backoffice`) com a tipografia, o menu lateral e a estrutura das telas do backoffice do `gpt-maker-core`, sem mexer na API nem nas cores.

**Architecture:** Mudança só de apresentação. A fonte vira a do sistema; `ui/table.tsx` passa a desenhar a tabela como cartão; `PageHeader` ganha descrição; a moldura (`app/layout.tsx`) é dividida em `app/nav.ts` (dados do menu), `app/sidebar.tsx` (menu lateral com usuário no rodapé) e `app/layout.tsx` (grade, barra fina e gaveta no celular, reaproveitando `ui/sheet.tsx`).

**Tech Stack:** React 19, react-router, Tailwind 4 + shadcn (`components/ui`), lucide-react, vitest + Testing Library + MSW.

**Spec:** aprovada em conversa (sem documento de design). Descrição aprovada no fim deste arquivo ("Descrição aprovada"). Referência visual: o backoffice do `gpt-maker-core` (`frontend/src/app/admin/admin-provider.tsx`, `components/ui.tsx`).

## Global Constraints

- Só `web/backoffice`. Nenhuma mudança na API, no contrato OpenAPI ou em rotas.
- Texto da interface em pt-BR. Cores e tokens neutros atuais (`index.css`) não mudam; tema claro/escuro/sistema continua (`app/theme.tsx`).
- Sem cor fixa nos componentes novos: só tokens do tema (`bg-card`, `border`, `text-muted-foreground`, `bg-sidebar`, `bg-sidebar-accent`…), para o modo escuro continuar certo. Nada de `zinc-*` nem hexadecimal.
- Fonte do sistema: `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` (a mesma pilha do gpt-maker-core). `@fontsource-variable/geist` sai das dependências.
- Papéis como hoje: `Sistema` e `Operadores` só para `operator` (`operatorOnly`); `Auditoria` e o resto, para todos.
- Nomes dos grupos do menu: `Operação` (Instalações, Eventos, Eventos Stripe, Apps), `Acesso` (Auditoria, Operadores), `Plataforma` (Sistema). `Painel` fica sozinho, sem título, no topo. Grupo sem itens visíveis não aparece.
- Marca no menu: quadrado com a inicial `C`, texto `CRMThink` e selo `Backoffice`.
- Os testes existentes continuam valendo: botão do usuário com o nome (`/Suporte/`), item de menu `Sair`, `navigation` de nome `Principal` e `Trilha`.
- Comandos (em `web/backoffice`): `yarn test <arquivo>`, `yarn check-types`, `yarn eslint --max-warnings 0 --rule '{"prettier/prettier":["error",{"endOfLine":"auto"}]}' src` (o `yarn lint` acusa CRLF de checkout Windows). Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Branch novo `feat/backoffice-layout`, criado a partir de `develop`.

## Review Focus

- Papel `viewer`: sem `Sistema` e `Operadores`, e o grupo `Plataforma` nem aparece (título solto seria defeito). Teste na Task 5.
- Tela estreita: o menu inteiro precisa estar acessível pela gaveta, e ela fecha ao navegar. Teste na Task 5.
- Domínio ou nome muito longo na primeira célula não pode estourar a tabela. Teste na Task 4.
- Modo escuro: nada de cor fixa no cartão da tabela nem no menu. Testes nas Tasks 2 e 5.
- Rota aninhada (`/installations/1234`): o item `Instalações` continua marcado; só `Painel` usa `end`. Teste na Task 5.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/index.css`, `package.json`, `yarn.lock` | fonte do sistema; sem Geist |
| `src/components/ui/table.tsx` | tabela como cartão (borda, fundo, cabeçalho pequeno e cinza) |
| `src/components/filters.tsx` | `PageHeader` com `description` |
| `src/features/*/page.tsx` | descrição de cada tela; primeira célula com destaque (Instalações, Apps) |
| `src/app/nav.ts` (novo) | grupos e itens do menu; `visibleGroups` |
| `src/app/sidebar.tsx` (novo) | marca, navegação em grupos, usuário no rodapé |
| `src/app/layout.tsx` | grade, barra fina (menu no celular, trilha, tema), gaveta, `RequireSession` |

---

### Task 1: Fonte do sistema

**Files:**
- Modify: `web/backoffice/src/index.css`, `web/backoffice/package.json`, `web/backoffice/yarn.lock`
- Test: `web/backoffice/src/app/typography.test.ts` (novo)

**Interfaces:** nenhuma.

- [ ] **Step 1: Teste que falha.** `typography.test.ts` lê `src/index.css` e `package.json` com `node:fs` (caminhos por `import.meta.dirname`): `it('usa a fonte do sistema, sem Geist')` — a linha `--font-sans:` contém `system-ui` e `'Segoe UI'`; o CSS não contém `geist` (sem diferenciar caixa); `package.json` não contém `@fontsource-variable/geist`.
- [ ] **Step 2:** `cd web/backoffice && yarn test src/app/typography.test.ts` → Expected: FAIL.
- [ ] **Step 3:** Em `index.css`, apagar `@import "@fontsource-variable/geist";` e trocar `--font-sans` pela pilha das Global Constraints; `yarn remove @fontsource-variable/geist`.
- [ ] **Step 4:** o teste passa; `yarn check-types` e `yarn build` sem erro (Expected: build termina com `built in`).
- [ ] **Step 5: Commit** `feat(backoffice-web): fonte do sistema no lugar do Geist`.

---

### Task 2: Tabelas como cartão

**Files:**
- Modify: `web/backoffice/src/components/ui/table.tsx`
- Test: `web/backoffice/src/components/ui/table.test.tsx` (novo)

**Interfaces:** nenhuma assinatura muda; `Table`, `TableHeader`, `TableHead`… seguem iguais para quem as usa.

- [ ] **Step 1: Teste que falha.** Renderiza `<Table><TableHeader><TableRow><TableHead>Nome</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>x</TableCell></TableRow></TableBody></Table>`. `it('desenha a tabela como cartão')`: o elemento `[data-slot="table-container"]` tem as classes `rounded-lg`, `border`, `bg-card`; `it('cabeçalho pequeno e cinza')`: `columnheader` "Nome" tem `text-xs` e `text-muted-foreground`; `it('sem cor fixa')`: o `innerHTML` do container não casa `/zinc-|#[0-9a-f]{3,6}/i`.
- [ ] **Step 2:** `yarn test src/components/ui/table.test.tsx` → Expected: FAIL.
- [ ] **Step 3:** No container, `rounded-lg border bg-card` além do que já tem; em `TableHead`, `text-xs text-muted-foreground` no lugar de `text-foreground` (manter altura e padding). Só classes de token.
- [ ] **Step 4:** o teste passa; `yarn test` inteiro (as telas com tabela seguem verdes).
- [ ] **Step 5: Commit** `feat(backoffice-web): tabelas como cartão`.

---

### Task 3: Título com descrição em cada tela

**Files:**
- Modify: `web/backoffice/src/components/filters.tsx`; `features/overview/page.tsx`, `installations/page.tsx`, `events/page.tsx`, `stripe-events/page.tsx`, `apps/page.tsx`, `audit/page.tsx`, `system/page.tsx`, `operators/page.tsx`
- Test: `web/backoffice/src/components/shared.test.tsx` (existente), `web/backoffice/src/features/page-descriptions.test.tsx` (novo)

**Interfaces:**
- Produces: `PageHeader(props: { title: string; description?: string; children?: ReactNode })`. Com `description`, ela aparece num `<p>` logo abaixo do `<h1>`; `children` (ações) ficam à direita, alinhadas ao topo.

- [ ] **Step 1: Testes que falham.** Em `shared.test.tsx`: `PageHeader` com `description="Texto"` mostra o `<h1>` e o `<p>` com `Texto` e `text-muted-foreground`; sem `description`, não há `<p>`. Em `page-descriptions.test.tsx` (padrão de handlers e `renderApp` de `features/pages.test.tsx`), um `it.each` abre cada rota como `operator` e espera o texto:

| Rota | Descrição |
|---|---|
| `/` | `Resumo do estado da plataforma.` |
| `/installations` | `Portais Bitrix24 com o app instalado: status, token e data da instalação.` |
| `/events` | `Entregas de eventos aos apps, com reenvio dos que falharam.` |
| `/stripe-events` | `Eventos recebidos do Stripe e o resultado do processamento.` |
| `/apps` | `Apps cadastrados na plataforma: estado, trial e escopos.` |
| `/audit` | `Registro de quem fez o quê no backoffice.` |
| `/system` | `Varreduras e chave de assinatura dos tokens.` |
| `/operators` | `Contas de quem opera a plataforma.` |

- [ ] **Step 2:** `yarn test src/components/shared.test.tsx src/features/page-descriptions.test.tsx` → Expected: FAIL.
- [ ] **Step 3:** Implementar `PageHeader` com a assinatura acima (`items-start`, título e descrição num `div`); passar `description` nas oito telas com os textos da tabela. As telas de detalhe e de formulário de app não ganham descrição.
- [ ] **Step 4:** os testes passam; `yarn test` inteiro.
- [ ] **Step 5: Commit** `feat(backoffice-web): descrição no título das telas`.

---

### Task 4: Primeira célula com destaque (Instalações e Apps)

**Files:**
- Modify: `web/backoffice/src/features/installations/page.tsx`, `web/backoffice/src/features/apps/page.tsx`
- Test: `web/backoffice/src/features/pages.test.tsx` (existente; ajustar o que assumir as colunas antigas)

**Interfaces:** nenhuma.

- [ ] **Step 1: Testes que falham** (fixtures e handlers de `pages.test.tsx`):
  - Instalações: colunas `Instalação`, `Status`, `Token`, `Instalada` (somem `Id`, `Domínio` e `App`). A primeira célula tem o domínio como link para `/installations/<id>` com `font-medium` e `break-all`, e embaixo, em `text-xs text-muted-foreground`, `#<id> · <appCode>`.
  - Apps: colunas `App`, `Estado`, `Trial`, `Escopos` (some `appCode`). A primeira célula tem o nome como link para `/apps/<appCode>` com `font-medium` e `break-all`, e embaixo, em `<code className="text-xs text-muted-foreground">`, o `appCode`.
  - Os dois: um domínio e um nome de 80 caracteres sem espaço renderizam sem erro e o link tem `break-all` (não estoura o cartão).
- [ ] **Step 2:** `yarn test src/features/pages.test.tsx` → Expected: FAIL nos casos novos; anotar os testes antigos que dependem das colunas removidas.
- [ ] **Step 3:** Implementar as duas tabelas e atualizar os testes antigos afetados para as colunas novas (sem enfraquecer o que verificam: o link continua levando ao detalhe e o status continua visível).
- [ ] **Step 4:** `yarn test` inteiro → PASS.
- [ ] **Step 5: Commit** `feat(backoffice-web): nome em destaque e código em cinza nas listas`.

---

### Task 5: Menu lateral em grupos, usuário no rodapé e gaveta no celular

**Files:**
- Create: `web/backoffice/src/app/nav.ts`, `web/backoffice/src/app/sidebar.tsx`
- Modify: `web/backoffice/src/app/layout.tsx`
- Test: `web/backoffice/src/app/nav.test.ts` (novo), `web/backoffice/src/features/auth/auth.test.tsx` (bloco `layout e papéis`)

**Interfaces:**
- Produces (`nav.ts`):
  - `type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; operatorOnly?: boolean }`
  - `type NavGroup = { title?: string; items: NavItem[] }`
  - `const NAV_GROUPS: NavGroup[]` (grupos e itens das Global Constraints; ícones lucide: Painel `LayoutDashboard`, Instalações `Boxes`, Eventos `Send`, Eventos Stripe `CreditCard`, Apps `Activity`, Auditoria `ScrollText`, Operadores `Users`, Sistema `Settings`)
  - `function visibleGroups(isOperator: boolean): NavGroup[]` — tira os itens `operatorOnly` de quem não é `operator` e descarta grupos que ficaram vazios.
- Produces (`sidebar.tsx`): `function Sidebar(props: { navLabel: string; onNavigate?: () => void }): JSX.Element` — marca (link para `/`), `<nav aria-label={navLabel}>` com os grupos, e o menu do usuário no rodapé.
- `layout.tsx` mantém exportados `AppLayout`, `RequireSession` e `RouteHandle`.

- [ ] **Step 1: Testes que falham.**
  - `nav.test.ts`: `visibleGroups(false)` tem os títulos `[undefined, 'Operação', 'Acesso']`, o grupo `Acesso` só com `Auditoria`, e nenhum item `Sistema` nem `Operadores`; `visibleGroups(true)` tem `[undefined, 'Operação', 'Acesso', 'Plataforma']` com `Operadores` e `Sistema`; `Painel` é o único item com `end`.
  - `auth.test.tsx`, bloco `layout e papéis` (mesmos helpers `renderApp`, `meHandler`): (a) como `operator`, a `navigation` `Principal` mostra os títulos `Operação`, `Acesso`, `Plataforma` e os oito links; (b) como `viewer`, não há `Plataforma`, `Sistema` nem `Operadores`, e há `Auditoria`; (c) em `/installations/1234` o link `Instalações` tem `aria-current="page"` e `Painel` não; (d) a marca mostra `CRMThink` e o selo `Backoffice`; (e) o botão do usuário (nome e papel) está dentro da `complementary` (menu lateral) e abre `Trocar senha` e `Sair`; (f) botão `Abrir menu` abre a gaveta com uma `navigation` de nome `Menu` que tem os mesmos links, e clicar num link fecha a gaveta e navega; (g) o `innerHTML` do menu não casa `/zinc-|#[0-9a-f]{3,6}/i`; (h) a barra de cima mantém a `navigation` `Trilha` e o botão de tema (`Tema claro (trocar)`, `Tema escuro (trocar)` ou `Tema do sistema (trocar)`). Os testes de `Trilha` e `Principal` que já existem continuam.
- [ ] **Step 2:** `yarn test src/app/nav.test.ts src/features/auth/auth.test.tsx` → Expected: FAIL nos novos.
- [ ] **Step 3: `nav.ts`** com os tipos, `NAV_GROUPS` e `visibleGroups` acima.
- [ ] **Step 4: `sidebar.tsx`.** Marca: link com quadrado `bg-primary text-primary-foreground` com `C`, texto `CRMThink` e selo `Backoffice` em maiúsculas pequenas. Grupos: título em `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`; item em `NavLink` com ícone `size-4`, `rounded-lg px-2 py-2 text-sm font-medium`, ativo em `bg-sidebar-accent text-sidebar-accent-foreground`, inativo `text-muted-foreground hover:bg-sidebar-accent`; cada link chama `onNavigate`. Rodapé: o `UserMenu` que hoje está em `layout.tsx` (mover, sem mudar o comportamento de `Trocar senha` e `Sair`), com avatar de inicial, nome e papel no botão, e o menu abrindo para cima (`side="top"`).
- [ ] **Step 5: `layout.tsx`.** Grade `lg:grid-cols-[240px_1fr]`; `aside` `hidden lg:block` fixo na altura da tela (`sticky top-0 h-svh border-r bg-sidebar text-sidebar-foreground`) com `<Sidebar navLabel="Principal" />`; barra de cima `h-12 border-b`: à esquerda botão `Abrir menu` (`lg:hidden`) e `Breadcrumbs`, à direita `ThemeToggle`; gaveta com `Sheet` (`side="left"`, título acessível `Menu` em `sr-only`) com `<Sidebar navLabel="Menu" onNavigate={fechar} />`. `Breadcrumbs`, `ThemeToggle` e `RequireSession` não mudam de comportamento.
- [ ] **Step 6:** os testes passam; `yarn test`, `yarn check-types` e o eslint (comando das Global Constraints) sem erro.
- [ ] **Step 7: Commit** `feat(backoffice-web): menu lateral em grupos com usuário no rodapé e gaveta no celular`.

---

### Task 6: Verificação final

**Files:** nenhum arquivo novo; ajustes só se algo falhar.

- [ ] **Step 1:** `cd web/backoffice && yarn test && yarn check-types && yarn build` → Expected: todos os testes passam, tipos limpos, `built in`.
- [ ] **Step 2:** `grep -ril geist web/backoffice/dist web/backoffice/src web/backoffice/package.json docs README.md` → Expected: sem resultado (ajustar a doc que citar o Geist, se houver).
- [ ] **Step 3:** Eslint nos arquivos tocados com o comando das Global Constraints → Expected: sem saída.
- [ ] **Step 4:** Conferir no navegador (`yarn dev` em `web/backoffice` com a API local ou o `build` servido pela API): menu em grupos no desktop, gaveta abaixo de 1024 px, tema claro e escuro, uma lista com tabela e uma tela de detalhe. Registrar o que viu; sem API local, dizer que não foi feito.
- [ ] **Step 5: Commit** só se houve ajuste (`fix(backoffice-web): ...`).

---

## Descrição aprovada

Fonte do sistema no lugar do Geist. Menu lateral fixo no desktop e gaveta no celular, com logo e selo "Backoffice" no topo, itens com ícone em grupos de título maiúsculo (Operação, Acesso, Plataforma; Painel sozinho no topo), item ativo em destaque suave e usuário com Trocar senha e Sair no rodapé do menu. Barra de cima fina com trilha à esquerda e seletor de tema à direita. Telas com título e descrição, busca ou filtros acima e tabela dentro de um cartão; em Instalações e Apps o nome é o destaque e o código vai em cinza embaixo. Cores neutras como hoje; a cor de destaque fica para depois.

## Self-Review

- **Cobertura:** tipografia (T1); tabela em cartão (T2); título com descrição (T3); nome em destaque e código em cinza (T4); menu em grupos, usuário no rodapé, gaveta, trilha e tema mantidos (T5); verificação, incluindo ausência de Geist no build (T6).
- **Consistência:** `visibleGroups`, `NAV_GROUPS`, `Sidebar(navLabel, onNavigate)` e `PageHeader(description)` têm o mesmo nome nas tarefas que os citam; `navLabel` `Principal` (desktop) e `Menu` (gaveta) evitam duas navegações com o mesmo nome.
- **Chamadas minhas (a confirmar na revisão):** a marca é um quadrado com `C` (sem logo oficial); os textos das descrições; `Auditoria` continua visível ao `viewer`; as colunas `Id` e `App` das Instalações e `appCode` dos Apps são fundidas na primeira célula.
