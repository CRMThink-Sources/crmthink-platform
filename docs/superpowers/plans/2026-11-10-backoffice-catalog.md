# Catálogo no backoffice (produtos e planos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listar, criar, editar, desativar e excluir produtos (SPA 1134) e planos (SPA 1138) pelo backoffice, e trocar os ids digitados no cadastro do app por uma seleção de produtos.

**Architecture:** Serviço novo `CatalogAdmin` (módulo billing) lê os SPAs direto do Bitrix (sem o cache de 5 min), aplica as regras de "em uso" e escreve com `BitrixRestClient.addItem/updateItem/deleteItem`, relendo o item para confirmar. Rotas `/admin/catalog/*` ficam atrás do `adminGate` (papéis em `policy.ts`, contrato em `src/docs/openapi`). No web, a tela `Catálogo` mostra produtos com planos aninhados, diálogos reaproveitam `ActionDialog`/`useAdminAction`, e um `ProductPicker` substitui o campo de ids do formulário de app.

**Tech Stack:** TypeScript, Express 4, Prisma 7 (MariaDB), `BitrixRestClient`, zod 4, vitest + supertest + `FakePrisma`/`FakeCrm`; web React 19, react-query, react-hook-form + zod, shadcn, MSW.

**Spec:** `docs/superpowers/specs/2026-11-10-backoffice-catalog-design.md` (ler inteiro antes de cada tarefa).

## Global Constraints

- **Escrita só na produção:** `env.platformEnvironment === 'production'`. Fora dela toda escrita responde 409 `CATALOG_READ_ONLY` e nada vai ao Bitrix; leitura, uso e seleção funcionam.
- **Papéis:** `GET` = `viewer`; escrever = `operator`. Excluir e desativar (`PATCH` com `active:false`) são `highImpact` (exigem `X-Admin-Reason`, 400 `REASON_REQUIRED` sem ele). Auditoria com alvo `product`/`plan` e o id; sem antes/depois.
- **Em uso (produto):** vinculado a algum app (`app_product`) ou com qualquer plano. **Em uso (plano):** com qualquer assinatura (SPA 1142, campo `config.subscription.plan`, contando todos os ambientes) ou usado como `trialPlanId` de um app.
- **Bloqueios com 409** (`PLAN_IN_USE`/`PRODUCT_IN_USE`, corpo com o que usa e a orientação "crie um plano novo e desative este"): excluir item em uso; trocar ou apagar o id de preço de plano com assinaturas; ligar/desligar trial de plano em uso; mudar o intervalo de plano com assinaturas; mudar o modelo de cobrança de produto que tem planos; excluir produto com planos. **Livres:** nome, valor de referência, estado, e **preencher** um preço que estava vazio.
- **Valores:** o valor do plano trafega em **centavos** na API (`Plan.amount`); o formulário digita em reais. Preço Stripe: `^price_[A-Za-z0-9]+$`, um para homologação e outro para produção (`config.plan.gatewayIdHomolog`/`gatewayIdProduction`); plano de trial = sem preço nos dois e a API recusa trial com preço. Produto de compra única só aceita plano **sem** intervalo; os demais exigem intervalo (`monthly`, `quarterly`, `semiannual`, `yearly`). O produto de um plano não muda.
- **Escrita no Bitrix:** usar só códigos de campo e ids de enum de `SpaConfig`. `crm.item.update` descarta campo desconhecido em silêncio: depois de gravar, **reler** o item e conferir os campos; divergência → 502 `CATALOG_WRITE_FAILED` (a mensagem traz o id criado, quando houve). Depois de gravar, `catalog.invalidateProduct/invalidatePlan`.
- Mensagens de interface em pt-BR; web: só tokens do tema (sem cor fixa); sem pontos e vírgulas nem aspas duplas no TS (Prettier do repo).
- Comandos: API (raiz) `yarn test <arquivo>`, `yarn check-types`, `yarn eslint --max-warnings 0 --rule '{"prettier/prettier":["error",{"endOfLine":"auto"}]}' src` (o `yarn lint` acusa CRLF de checkout Windows); web (`web/backoffice`) `yarn test <arquivo>`, `yarn check-types`, `yarn gen:api` e o mesmo eslint. Contrato: `yarn docs:openapi && yarn sdk:types`. Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; **use caminhos explícitos no `git add`**.
- Branch: `feat/backoffice-catalog` (já criado a partir da `develop`).

## Review Focus

- Escrita na homologação: 409 `CATALOG_READ_ONLY` e **nenhuma** chamada ao Bitrix (`FakeCrm.calls` vazio). Task 3 e 4.
- `crm.item.update` que descarta um campo: a releitura detecta, responde 502 e não deixa o catálogo "salvo" na tela. Task 3.
- Plano com assinatura de outro ambiente: trocar o preço continua 409 (a contagem vê todas). Task 3.
- Item mal cadastrado no portal: aparece na lista marcado com o problema, sem derrubar a listagem. Task 2.
- App com id de produto que o catálogo não acha: o formulário preserva o id e mostra "produto #id (não encontrado)". Task 9.
- Corrida entre checar o uso e excluir: o uso é conferido de novo imediatamente antes do `deleteItem`. Task 3.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/config/spa-config.ts` | ids de enum do modelo de cobrança (`product.billingModelIds`) |
| `src/shared/bitrix/bitrix-rest.client.ts` | `itemFields` expõe `isRequired` |
| `scripts/check-catalog-portal.ts` (novo) | confere campos obrigatórios dos SPAs 1134/1138 |
| `src/modules/billing/infra/spa/spa-mappers.ts` | `productFields`, `planFields` (escrita) |
| `src/modules/billing/infra/spa/subscription-repository.ts` | `countByPlan` |
| `src/modules/billing/application/catalog-admin.ts` (novo) | leitura fresca, uso, escritas e regras |
| `src/modules/billing/http/admin-catalog-routes.ts` (novo) | rotas `/admin/catalog/*` |
| `src/modules/backoffice/http/policy.ts`, `src/app.ts`, `src/container.ts` | papéis, montagem |
| `src/docs/**`, `docs/**`, `sdk/**`, `web/backoffice/src/api/schema.d.ts` | contrato e erros |
| `web/backoffice/src/features/catalog/*` (novo) | tela, diálogos, seletor |
| `web/backoffice/src/app/nav.ts`, `routes.tsx`, `features/actions/use-admin-action.ts`, `features/apps/app-form-*` | menu, rota, invalidação, seletor no app |

---

### Task 1: Pré-checagem do portal e configuração

**Files:**
- Modify: `src/config/spa-config.ts`, `src/shared/bitrix/bitrix-rest.client.ts`
- Create: `scripts/check-catalog-portal.ts`
- Test: `src/config/spa-config.test.ts` (o existente; senão o teste de config mais próximo)

**Interfaces:**
- Produces: `SpaConfig.product.billingModelIds: { standard: string; perUnit: string; oneTime: string }` (padrão `13605`, `13607`, `14455`; com `.default(...)` no schema para arquivos de `SPA_CONFIG_FILE` antigos continuarem válidos); `BitrixRestClient.itemFields` devolve também `isRequired?: boolean` por campo.

- [ ] **Step 1: Teste que falha.** `DEFAULT_SPA_CONFIG.product.billingModelIds` é `{ standard: '13605', perUnit: '13607', oneTime: '14455' }` e `oneTimeBillingModelIds` continua `['14455']`; um arquivo de configuração sem `billingModelIds` carrega com o padrão.
- [ ] **Step 2:** `yarn test src/config` → Expected: FAIL.
- [ ] **Step 3:** Implementar em `spa-config.ts` (schema com default) e alargar o tipo de `itemFields` com `isRequired`.
- [ ] **Step 4:** `scripts/check-catalog-portal.ts`: com as variáveis do `.env`, chama `itemFields` dos SPAs 1134 e 1138 e imprime, por SPA, os campos com `isRequired` que **não** estão em `SpaConfig`. Rodar `yarn tsx scripts/check-catalog-portal.ts`. Sem `.env` com o webhook do portal, **não pare**: registre no ledger `Ruling: pré-checagem do portal não executada (sem credenciais)`, siga com os formulários do desenho e deixe a pendência na mensagem final. Se houver campo obrigatório extra, registre-o e trate na Task 3 (valor padrão ou campo novo) avisando o dono.
- [ ] **Step 5:** `yarn test`, `yarn check-types` limpos. **Commit** `feat(billing): ids de enum do modelo de cobrança e checagem do portal`.

---

### Task 2: Mapeamento de escrita, contagem de assinaturas e leitura do catálogo

**Files:**
- Modify: `src/modules/billing/infra/spa/spa-mappers.ts`, `src/modules/billing/infra/spa/subscription-repository.ts`, `src/container.ts`
- Create: `src/modules/billing/application/catalog-admin.ts` (só leitura nesta tarefa)
- Test: `src/modules/billing/catalog-admin.test.ts` (novo), `src/modules/billing/infra/spa/spa-mappers.test.ts` (existente)

**Interfaces:**
- Produces (`spa-mappers.ts`):
  - `type ProductWrite = { name: string; billingModel: 'standard' | 'per_unit' | 'one_time'; active: boolean }`
  - `type PlanWrite = { name: string; amount: number; interval: PlanInterval | null; priceHomolog: string | null; priceProduction: string | null; active: boolean }` (`amount` em centavos; produto vem à parte)
  - `SpaMappers.productFields(input: ProductWrite): Record<string, unknown>` — `title`, `billingModel` (id de enum de `billingModelIds`), `active` `'Y'`/`'N'`
  - `SpaMappers.planFields(input: PlanWrite, productId?: number): Record<string, unknown>` — `title`, valor, intervalo (id de enum de `invertEnum(intervalEnum)`; ausente/vazio em compra única), `gatewayIdHomolog`/`gatewayIdProduction` (`''` quando `null`), `active`, e o produto só na criação
- Produces (`subscription-repository.ts`): `countByPlan(planId: number): Promise<{ total: number; active: number }>` — `total` = itens brutos do filtro `[config.subscription.plan]: planId`; `active` = assinaturas mapeadas com status diferente de `cancelled` e `trial_expired`.
- Produces (`catalog-admin.ts`):
  - `CatalogPlanView = { id: number; productId: number; name: string; amount: number; interval: PlanInterval | null; isTrial: boolean; active: boolean; priceHomolog: string | null; priceProduction: string | null; valid: boolean; problems: string[] }`
  - `CatalogProductView = { id: number; name: string; billingModel: string; kind: 'subscription' | 'one_time' | null; active: boolean; valid: boolean; problems: string[]; apps: string[]; plans: CatalogPlanView[] }`
  - `CatalogView = { writable: boolean; products: CatalogProductView[] }`
  - `ProductUsage = { apps: string[]; plans: number }`; `PlanUsage = { subscriptions: { total: number; active: number }; trialOfApps: string[] }`
  - `class CatalogAdmin { constructor(deps: { crm: BitrixRestClient; config: SpaConfig; mappers: SpaMappers; catalog: CatalogRepository; subscriptions: SubscriptionRepository; db: Db; environment: PlatformEnvironment }); list(): Promise<CatalogView>; productUsage(id: number): Promise<ProductUsage>; planUsage(id: number): Promise<PlanUsage> }`
- `container.ts` expõe `catalogAdmin`.

- [ ] **Step 1: Testes que falham** (`FakeCrm`, `FakePrisma`, `createHarness`; semeie SPAs com `h.crm.seed`): (a) `productFields` e `planFields` geram os códigos de `SpaConfig` e os ids de enum certos (compra única sem intervalo, `null` vira `''`); (b) `countByPlan` conta bruto e ativas; (c) `list()` devolve produtos **e planos inativos**, com `apps` do `app_product`, `writable` verdadeiro só em `production`, e os dois ids de preço crus; (d) item mal cadastrado (plano sem intervalo em produto de assinatura; produto sem modelo) aparece com `valid:false` e `problems` em pt-BR, sem lançar; (e) `productUsage` e `planUsage` (inclui `trialPlanId` de app).
- [ ] **Step 2:** `yarn test src/modules/billing/catalog-admin.test.ts src/modules/billing/infra/spa/spa-mappers.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar** os mapeadores de escrita, `countByPlan` e `CatalogAdmin` (leitura via `crm.listItems(entityType, {})`, mapeando com `mappers.product`/`plan` e `InvalidSpaItemError` → `valid:false`; preços lidos de `raw[config.plan.gatewayId...]`); ligar em `container.ts` (`env.platformEnvironment`).
- [ ] **Step 4:** testes, `yarn check-types` e eslint limpos. **Commit** `feat(billing): leitura do catálogo para o backoffice`.

---

### Task 3: Escritas do catálogo e regras de uso

**Files:**
- Modify: `src/modules/billing/application/catalog-admin.ts`
- Test: `src/modules/billing/catalog-admin-writes.test.ts` (novo)

**Interfaces:**
- Consumes: Task 2.
- Produces (em `CatalogAdmin`):
  - `createProduct(input: ProductWrite): Promise<CatalogProductView>`; `updateProduct(id: number, patch: Partial<ProductWrite>): Promise<CatalogProductView>`; `deleteProduct(id: number): Promise<void>`
  - `createPlan(productId: number, input: PlanInput): Promise<CatalogPlanView>`; `updatePlan(id: number, patch: Partial<PlanInput>): Promise<CatalogPlanView>`; `deletePlan(id: number): Promise<void>`
  - `type PlanInput = PlanWrite & { trial: boolean }` (`trial:true` exige `priceHomolog` e `priceProduction` nulos)
  - Erros (`@/shared/http/errors`): `conflict('CATALOG_READ_ONLY')`, `conflict('PLAN_IN_USE', msg)` e `conflict('PRODUCT_IN_USE', msg)` com o uso nos `details`, `notFound('PRODUCT_NOT_FOUND')`/`notFound('PLAN_NOT_FOUND')`, `unprocessable('PLAN_INVALID_FOR_PRODUCT')` (intervalo × compra única, trial com preço), `upstream('CATALOG_WRITE_FAILED', msg)`.

- [ ] **Step 1: Testes que falham**, um por regra: fora da produção toda escrita → `CATALOG_READ_ONLY` e `h.crm.calls` vazio; criar produto/plano grava os campos certos e invalida o cache (próxima leitura do catálogo público vê o novo); plano de trial grava sem preços e recusa trial com preço; compra única recusa intervalo e assinatura exige; **bloqueios** (cada um com plano/produto em uso e depois sem uso): excluir, trocar/apagar preço, ligar/desligar trial, trocar intervalo, mudar modelo de cobrança com planos, excluir produto com planos ou com app vinculado; **livres:** renomear, mudar valor, desativar, preencher preço vazio mesmo em uso; releitura: um `FakeCrm.updateItem` que descarta um campo → `CATALOG_WRITE_FAILED` e o erro de criação traz o id; o uso é conferido de novo imediatamente antes do `deleteItem` (teste: assinatura criada entre a primeira checagem e a exclusão bloqueia).
- [ ] **Step 2:** `yarn test src/modules/billing/catalog-admin-writes.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar** as escritas com as regras das Global Constraints; cada gravação: monta campos com `mappers.*Fields`, escreve, relê com `crm.getItem`, confere cada campo enviado, invalida cache, devolve a visão.
- [ ] **Step 4:** testes, tipos e eslint limpos. **Commit** `feat(billing): criar, editar, desativar e excluir produtos e planos`.

---

### Task 4: Rotas, papéis e montagem

**Files:**
- Create: `src/modules/billing/http/admin-catalog-routes.ts`
- Modify: `src/modules/backoffice/http/policy.ts`, `src/app.ts`
- Test: `src/modules/billing/catalog-http.test.ts` (novo; use `src/modules/backoffice/test-support.ts`: `setup`, `operator`, `login`, `ORIGIN`)

**Interfaces:**
- Produces: `catalogAdminRoutes(deps: { catalog: CatalogAdmin }): Router` com `GET /admin/catalog/products` → `CatalogView`; `POST /admin/catalog/products` (201 produto); `GET /admin/catalog/products/:id/usage` → `ProductUsage`; `PATCH`/`DELETE /admin/catalog/products/:id`; `POST /admin/catalog/products/:id/plans` (201 plano); `GET /admin/catalog/plans/:id/usage` → `PlanUsage`; `PATCH`/`DELETE /admin/catalog/plans/:id` (`DELETE` → 204). Esquemas zod: `productSchema` (`name` 1–200, `billingModel`, `active`), `planSchema` (`name` 1–200, `amount` inteiro ≥ 0, `interval` ou `null`, `trial`, preços `null` ou `^price_[A-Za-z0-9]+$`, `active`), `PATCH` parcial. `policy.ts`: papéis e `highImpact` das Global Constraints, helpers `product`/`plan` para `target` (`{ type: 'product' | 'plan', id }`).

- [ ] **Step 1: Testes que falham** (HTTP): `viewer` lê a lista e o uso e recebe 403 `FORBIDDEN_ROLE` ao escrever; `operator` cria, edita, desativa e exclui; desativar e excluir sem `X-Admin-Reason` → 400 `REASON_REQUIRED`; corpo inválido → 400/422 de validação; escrita com `PLATFORM_ENVIRONMENT=homolog` → 409 `CATALOG_READ_ONLY`; `PLAN_IN_USE`/`PRODUCT_IN_USE` chegam como 409 com o uso; auditoria grava `product`/`plan`, id e motivo, sem preço nem corpo sensível além do mascarado.
- [ ] **Step 2:** `yarn test src/modules/billing/catalog-http.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementar** o roteador, as entradas em `policy.ts` e a montagem em `app.ts` (`admin.use(catalogAdminRoutes({ catalog: container.catalogAdmin }))`, depois das rotas de app).
- [ ] **Step 4:** testes (incluir `yarn test src/docs`: o teste de paridade pode falhar até a Task 5; **não** commite com ele vermelho: faça a Task 5 junto se necessário e registre a decisão no ledger). **Commit** `feat(backoffice): rotas do catálogo`.

---

### Task 5: Contrato OpenAPI e erros

**Files:**
- Modify: `src/docs/openapi/operations.ts`, `src/docs/openapi/responses.ts`, `src/docs/errors.ts`
- Regenerar: `docs/api/openapi-admin.json`, `docs/technical/error-codes.md`, `sdk/typescript/src/generated/openapi.ts`
- Test: `src/docs` (existente)

**Interfaces:** uma operação por rota da Task 4 (`security: 'admin'`, `tag: 'Operador'`), `CatalogView`/`ProductUsage`/`PlanUsage`/corpos como componentes nomeados; erros novos em `ERROR_CATALOG` (`status`, `meaning`, `action`, `origin`): `CATALOG_READ_ONLY` 409, `PRODUCT_IN_USE` 409, `PLAN_IN_USE` 409, `PRODUCT_NOT_FOUND` 404, `PLAN_INVALID_FOR_PRODUCT` 422, `CATALOG_WRITE_FAILED` 502 (`PLAN_NOT_FOUND` já existe: reutilize na rota de plano).

- [ ] **Step 1:** `yarn test src/docs` e a checagem de contrato de `http()` falham para as rotas novas → Expected: FAIL.
- [ ] **Step 2:** Documentar, listando `errors` de cada operação; `yarn docs:openapi && yarn sdk:types`.
- [ ] **Step 3:** `yarn test` inteiro (API) → PASS, tipos e eslint limpos. **Commit** `docs(api): contrato do catálogo`.

---

### Task 6: Tela Catálogo (leitura), menu e rota

**Files:**
- Create: `web/backoffice/src/features/catalog/page.tsx`, `catalog-queries.ts`, `web/backoffice/src/lib/money.ts`
- Modify: `web/backoffice/src/app/nav.ts`, `routes.tsx`, `features/page-descriptions.test.tsx`, `app/nav.test.ts`, `features/actions/use-admin-action.ts`, `web/backoffice/src/api/schema.d.ts` (gerado)
- Test: `web/backoffice/src/features/catalog/catalog.test.tsx` (novo), `lib/money.test.ts`

**Interfaces:**
- Produces: `CatalogPage` (rota `/catalog`, `handle: { crumb: 'Catálogo' }`); `catalogQuery` (`queryKey ['catalog']`, `GET /admin/catalog/products`); `INVALIDATES.catalog = (): QueryKey[] => [['catalog'], ['apps'], ['audit']]`; `centsToReais(cents: number): string` (`19900` → `199,00`) e `reaisToCents(text: string): number | null` (aceita `199`, `199,5`, `199,50`, `1.990,00`; vazio ou inválido → `null`).
- Menu: item `Catálogo` (`to: '/catalog'`, ícone `Package`, **visível a `viewer`**) no grupo `Operação`, depois de `Apps`. Descrição do `PageHeader`: `Produtos e planos cobrados no portal CRMThink.`

- [ ] **Step 1:** `cd web/backoffice && yarn gen:api`. **Testes que falham:** `money.test.ts` (conversões e rejeições); `nav.test.ts` atualizado (grupo `Operação` com `Catálogo` em quinto lugar, também para `viewer`); `page-descriptions.test.tsx` com a linha do catálogo; `catalog.test.tsx` (MSW): lista produtos com planos logo abaixo (nome em destaque, `#id`, modelo, estado, valor `R$ 199,00`, "usado por N apps"), plano sem preço do ambiente mostra o aviso, item `valid:false` mostra o problema, `writable:false` mostra o aviso "Somente leitura fora da produção" e **nenhum** botão de ação, `viewer` não vê botões, estado vazio e erro.
- [ ] **Step 2:** `yarn test src/features/catalog src/lib src/app/nav.test.ts src/features/page-descriptions.test.tsx` → Expected: FAIL.
- [ ] **Step 3: Implementar** (tabela em cartão com planos aninhados em linhas recuadas, `RoleGate role="operator"` para os botões, `PageHeader` com descrição, `LoadingState`/`ErrorState`/`EmptyState` existentes).
- [ ] **Step 4:** testes, `yarn check-types`, eslint limpos. **Commit** `feat(backoffice-web): tela Catálogo`.

---

### Task 7: Formulários de produto e plano

**Files:**
- Create: `web/backoffice/src/features/catalog/product-dialog.tsx`, `plan-dialog.tsx`
- Modify: `features/catalog/page.tsx`
- Test: `web/backoffice/src/features/catalog/forms.test.tsx` (novo)

**Interfaces:**
- Produces: `ProductDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; product?: CatalogProduct; onSaved?: (product: CatalogProduct) => void })` (`CatalogProduct = Schemas['CatalogProduct']`); `PlanDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; product: CatalogProduct; plan?: CatalogPlan })`. Criar = `POST`; editar = `PATCH` só com os campos alterados.
- Campos: produto — `Nome`, `Modelo de cobrança` (`Padrão`, `Por unidade`, `Compra única`), `Ativo`. Plano — `Nome`, `Valor de referência (R$)`, `Intervalo` (esconde em compra única), chave `Plano de trial (sem cobrança)` (esconde os preços), `ID do preço no Stripe: homologação`, `ID do preço no Stripe: produção`, `Ativo`, aviso de plano sem o preço do ambiente em uso; erros de validação da API nos campos; 409 de uso mostrado como alerta com o que usa.

- [ ] **Step 1: Testes que falham** (MSW): criar produto envia `{ name, billingModel, active }`; criar plano envia `amount` em centavos (`199,00` → `19900`), `interval`, preços, e com trial envia preços `null`; compra única esconde o intervalo; formato de preço inválido bloqueia o envio com mensagem; editar envia só o alterado; 409 `PLAN_IN_USE` ao trocar o preço aparece como alerta; campos de preço já preenchidos ficam editáveis mas a tela explica o bloqueio quando em uso.
- [ ] **Step 2:** `yarn test src/features/catalog/forms.test.tsx` → Expected: FAIL.
- [ ] **Step 3: Implementar** com `useAdminAction` (`invalidates: INVALIDATES.catalog`) e `react-hook-form` + zod no padrão de `features/apps/app-form-*`; ligar os botões `Novo produto`, `Novo plano neste produto` e `Editar` da página.
- [ ] **Step 4:** testes, tipos e eslint limpos. **Commit** `feat(backoffice-web): cadastro e edição de produtos e planos`.

---

### Task 8: Desativar e excluir com o aviso de uso

**Files:**
- Create: `web/backoffice/src/features/catalog/delete-dialog.tsx`
- Modify: `features/catalog/page.tsx`
- Test: `web/backoffice/src/features/catalog/delete.test.tsx` (novo)

**Interfaces:**
- Produces: `DeleteDialog(props: { kind: 'product' | 'plan'; item: { id: number; name: string }; onClose: () => void })`. Ao abrir, busca `GET .../usage`. **Em uso:** mostra o que usa (assinaturas totais e ativas, apps) e oferece `Desativar` (`PATCH active:false`, motivo obrigatório); sem botão de excluir. **Sem uso:** `ActionDialog` com `confirmText` = nome do item e `reasonRequired`, e então `DELETE`. Ação `Desativar` também no menu da linha (alto impacto, com motivo). Erro 409 de corrida (`*_IN_USE` no `DELETE`) volta ao aviso de uso.

- [ ] **Step 1: Testes que falham:** plano em uso mostra "12 assinaturas (4 ativas)" e o app do trial, e só oferece `Desativar`; produto com planos mostra "tem N planos: exclua-os primeiro"; item sem uso exige digitar o nome e o motivo (botão travado até os dois) e envia `DELETE` com `X-Admin-Reason`; `Desativar` envia `PATCH { active:false }` com o motivo; um `409` no `DELETE` reabre o aviso de uso.
- [ ] **Step 2:** `yarn test src/features/catalog/delete.test.tsx` → Expected: FAIL.
- [ ] **Step 3: Implementar** e ligar ao menu de ações das linhas.
- [ ] **Step 4:** testes, tipos e eslint limpos. **Commit** `feat(backoffice-web): excluir e desativar com aviso de uso`.

---

### Task 9: Seleção de produtos no cadastro do app

**Files:**
- Create: `web/backoffice/src/features/catalog/product-picker.tsx`
- Modify: `web/backoffice/src/features/apps/app-form-page.tsx`
- Test: `web/backoffice/src/features/catalog/product-picker.test.tsx` (novo); ajustar `features/apps/apps-actions.test.tsx` onde digitam ids

**Interfaces:**
- Produces: `ProductPicker(props: { value: string; onChange: (value: string) => void })`, onde `value` é a lista de ids separada por vírgula que o formulário já usa (`productSpaIds` de `app-form-schema.ts` **não muda**: diff, validação e `toFields` seguem iguais). Lista com caixa de marcar, nome, `#id`, tipo da cobrança e estado, lida de `catalogQuery`; id que o catálogo não encontra aparece marcado como `produto #<id> (não encontrado)` e **é preservado**; `Criar produto` (só `operator` e só com `writable`) abre `ProductDialog`, e o produto criado já vem marcado. No formulário, substitui o `Field` `productSpaIds` (`Produtos (SPA 1134)`).

- [ ] **Step 1: Testes que falham:** marcar e desmarcar atualiza o `value` (`"10, 11"`); ids existentes na edição já vêm marcados; id desconhecido fica marcado com o aviso e continua no valor enviado; produto inativo aparece marcado/desmarcável com o selo; criar produto pelo seletor marca o novo; na homologação (`writable:false`) não há `Criar produto`; o formulário de app envia `productSpaIds` como antes (cenário de cadastro e de edição com diff).
- [ ] **Step 2:** `yarn test src/features/catalog/product-picker.test.tsx src/features/apps` → Expected: FAIL.
- [ ] **Step 3: Implementar** o seletor e trocá-lo no formulário; atualizar os testes antigos que digitavam ids sem enfraquecer o que verificam.
- [ ] **Step 4:** `yarn test` (web) inteiro, tipos e eslint limpos. **Commit** `feat(backoffice-web): seleção de produtos no cadastro do app`.

---

### Task 10: Documentação e verificação final

**Files:** `docs/operations/runbook.md`, `docs/technical/security.md`, `openspec` (uma change `backoffice-catalog` arquivada em outro momento: **não** criar agora)

- [ ] **Step 1:** `runbook.md`: como o catálogo é gerido agora (tela Catálogo, só a produção escreve, o que bloqueia, "crie um plano novo e desative este", como preencher o preço faltante); `security.md`: o catálogo é escrita no portal Bitrix por `operator`, com motivo e auditoria, e o que fica de fora (sem antes/depois).
- [ ] **Step 2:** `yarn lint`-equivalente, `yarn check-types`, `yarn test` na raiz e em `web/backoffice`, `yarn build` do web → Expected: tudo verde.
- [ ] **Step 3:** Conferência manual (se houver ambiente): na produção, criar um produto e um plano de teste, editar, desativar e excluir; na homologação, ver só leitura. Sem ambiente, registrar que **não foi feita** e que a escrita real no Bitrix (permissão do webhook, campos obrigatórios) fica por confirmar.
- [ ] **Step 4: Commit** `docs(backoffice): catálogo de produtos e planos`.

---

## Self-Review

- **Cobertura do design:** seleção no app (T9); CRUD de produtos e planos (T2, T3, T4, T6–T8); preço colado, dois ambientes (T3, T7); excluir/desativar com uso (T3, T8); escrita só na produção (T3, T4, T6); três bloqueios mais intervalo (T3); auditoria sem antes/depois (T4); pré-checagem do portal (T1); contrato (T5); docs (T10).
- **Consistência de tipos:** `ProductWrite`, `PlanWrite`, `PlanInput`, `CatalogView`/`CatalogProductView`/`CatalogPlanView`, `ProductUsage`/`PlanUsage` e os nomes dos métodos de `CatalogAdmin` são os mesmos nas Tasks 2–4; no web, `Schemas['CatalogProduct']`/`['CatalogPlan']` vêm da Task 5.
- **Chamadas minhas (a confirmar na revisão):** ids de enum do modelo de cobrança entram na config (`billingModelIds`); `countByPlan` conta bruto para não subcontar item inválido; o seletor guarda a lista como texto para não mexer no esquema do formulário; `Catálogo` visível ao `viewer` em leitura; o plano de trial de app continua sendo campo numérico (fora do escopo).
