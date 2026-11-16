# Assinaturas manuais e bonificação no backoffice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operador cria, no backoffice, uma assinatura `manual` (cobrança por boleto/contrato) ou uma bonificação para uma instalação, gravando no SPA 1142 e emitindo `subscription.activated`.

**Architecture:** Serviço novo `ManualSubscriptionService` no módulo de billing. Sob o lock da instalação, valida, escreve no SPA 1142 pelo `SubscriptionWriter` (mesmo caminho da ativação Stripe), relê o item para conferir, emite o evento e encerra o trial vigente. Rota `POST /admin/installations/:id/subscriptions` atrás do `adminGate`; diálogo "Nova assinatura" no detalhe da instalação.

**Tech Stack:** TypeScript, Express, zod 4, Prisma (FakePrisma nos testes), Vitest; web: React, react-hook-form, openapi-fetch, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-manual-subscriptions-design.md`

## Global Constraints

- Uma assinatura vigente por instalação (decisão do dono). `active` ou `past_due` bloqueia; `trialing` é substituída; `cancelled`/`trial_expired` não bloqueiam.
- Assinatura criada: `modality = manual`, `status = active`, com marcador anti-loop (via `SubscriptionWriter`).
- Fim do período obrigatório, no máximo **24 meses** após o início; início padrão = hoje.
- Escrita só com `PLATFORM_ENVIRONMENT=production`; fora dela, 409.
- Papel `operator` cria; `viewer` não. `X-Admin-Reason` obrigatório nos dois tipos (`highImpact: true`).
- Bonificação: título `Bonificação — <plano> — <domínio>`; responsável obrigatório. Cobrança manual: título `<app> — <domínio>`.
- Plano: ativo, de produto ativo vinculado a um app da instalação, `type = subscription`, `isTrial = false`. Não exige preço do Stripe.
- Nenhum campo novo no SPA 1142. O rastro da bonificação é título, comentário na linha do tempo da assinatura e auditoria.
- Não editar `.claude/worktrees/` (cópia antiga do repositório).
- Mensagens e docs em pt-br; commits no padrão `feat(billing): ...` com o trailer de coautoria do projeto.

## Review Focus

1. Segunda criação na mesma instalação (ou com `past_due` existente): deve dar 409 `SUBSCRIPTION_ALREADY_EXISTS`, nunca duas assinaturas vigentes. Teste na Task 1.
2. Período ruim: fim igual ou antes do início, mais de 24 meses, data inexistente (`2026-02-31`). Deve ser recusado sem escrever nada. Teste na Task 1.
3. Plano que não deveria servir: de outro app, inativo, de trial, compra única. Teste na Task 1.
4. Bitrix aceita a criação e a releitura diverge: nenhum evento sai, erro 502 traz o id do item criado. Teste na Task 1.
5. Falha só no comentário da linha do tempo: a assinatura continua criada e a resposta é 201. Instalação não `ACTIVE`: recusada. Teste na Task 1.

---

### Task 1: Serviço `ManualSubscriptionService`

**Files:**
- Create: `src/modules/billing/application/manual-subscription-service.ts`
- Create: `src/modules/billing/manual-subscription.test.ts`
- Modify: `src/container.ts` (instanciar após `trials`, ~linha 227, e expor `manualSubscriptions` no objeto devolvido)
- Modify: `src/docs/errors.ts` (3 códigos novos; ajustar `SUBSCRIPTION_ALREADY_EXISTS`)

**Interfaces:**
- Consumes: `BillingContext` (`installations.get`, `subscriptions`, `withInstallationLock`), `SubscriptionWriter.create/update`, `AppRegistry.getOrThrow`, `CatalogRepository.getPlan/getProduct`, `Clock`, `isOpenSubscription`, helpers de data em `infra/spa/spa-calendar-date.ts` (`parseSpaCalendarDate`, `startOfCalendarDay`, `formatCalendarDate`).
- Produces:
  ```ts
  export const createManualSubscriptionSchema: z.ZodType<CreateManualSubscription>
  export type CreateManualSubscription = {
    planId: number
    kind: 'manual' | 'bonus'
    periodStart?: string // 'YYYY-MM-DD'
    periodEnd: string // 'YYYY-MM-DD'
    approvedBy?: string // obrigatório quando kind = 'bonus'
  }
  export type ManualSubscriptionWho = { actor: string; reason: string }
  export class ManualSubscriptionService {
    constructor(deps: {
      context: BillingContext
      writer: SubscriptionWriter
      registry: AppRegistry
      catalog: CatalogRepository
      clock: Clock
      environment: PlatformEnvironment
    })
    create(
      installationId: number,
      input: CreateManualSubscription,
      who: ManualSubscriptionWho,
    ): Promise<Subscription>
  }
  ```

- [ ] **Step 1: Criar o branch.** `git switch -c feat/manual-subscriptions` a partir de `develop`.

- [ ] **Step 2: Escrever os testes que falham** em `manual-subscription.test.ts`, com `createHarness({ env: { PLATFORM_ENVIRONMENT: 'production' } })` e `installedGptMaker` (o GPTMaker semeado tem trial automático de 14 dias no plano 500; planos: 501 Básico e 502 Pro pagos, 510 compra única). Chamam `h.container.manualSubscriptions.create(installationId, input, { actor: 'operator:1', reason: 'contrato 123' })`. Testes (nomes exatos):
  - `cria cobrança manual: item active/manual no SPA, título "GPTMaker — cliente.bitrix24.com.br", um subscription.activated` — confere `spaSubscriptions(h)` (planId 501, modality manual, status active, início = hoje, fim = informado) e `outbox(h)` com um evento `subscription.activated`, `data.previousSubscriptionId` igual ao id do trial e `dedupeKey` `activated:<id>`.
  - `bonificação: título "Bonificação — Básico — cliente.bitrix24.com.br" e comentário com motivo e responsável` — confere o comentário gravado no `FakeCrm` (se o dublê não registra comentários, estender `FakeCrm.addTimelineComment` para guardá-los).
  - `schema: bonificação sem approvedBy é recusada; cobrança manual sem approvedBy passa`.
  - `instalação em trial: o trial vira cancelled e não gera evento próprio` (`outbox` não tem `subscription.ended` e tem exatamente um `subscription.activated`).
  - `instalação sem trial (trialOnInstall: false): previousSubscriptionId é null`.
  - `assinatura vigente (active ou past_due) bloqueia: 409 SUBSCRIPTION_ALREADY_EXISTS com details {subscriptionId, modality, status}` — cria uma, tenta outra; depois coloca a primeira em `past_due` pelo `h.crm` e tenta de novo.
  - `assinatura cancelada ou trial_expired não bloqueia`.
  - `período: fim <= início, fim > início + 24 meses e data inexistente são INVALID_PERIOD sem escrita; início omitido vale hoje`.
  - `plano inválido: de outro app ⇒ 404 PLAN_NOT_FOUND; inativo ⇒ 422 PLAN_INACTIVE; trial (500) e compra única (510) ⇒ 400 PLAN_TYPE_MISMATCH`.
  - `fora da produção: 409 SUBSCRIPTIONS_READ_ONLY` (`PLATFORM_ENVIRONMENT: 'homolog'`).
  - `instalação inexistente ⇒ 404 INSTALLATION_NOT_FOUND; não ACTIVE ⇒ 409 INSTALLATION_NOT_ACTIVE`.
  - `releitura diverge: 502 SUBSCRIPTION_WRITE_FAILED com details {id, created: true} e nenhum evento` — usar a mesma técnica de `catalog-admin-writes.test.ts` para o `FakeCrm` descartar um campo.
  - `falha no comentário não derruba a criação` (o `FakeCrm` lança em `addTimelineComment`; a assinatura existe e o resultado é a assinatura).
  - `anti-loop: depois de criar, ManualLifecycle.apply(id) não emite mais nada` (`h.container.manual.apply`).

- [ ] **Step 3: Rodar e ver falhar.** `yarn vitest run src/modules/billing/manual-subscription.test.ts` ⇒ FAIL (módulo inexistente).

- [ ] **Step 4: Implementar o serviço.** Ordem de `create`:
  1. `environment !== 'production'` ⇒ `conflict('SUBSCRIPTIONS_READ_ONLY', ...)`.
  2. Instalação (`context.installations.get`): inexistente ou sem `spaItemId` ⇒ `notFound('INSTALLATION_NOT_FOUND')`; `status !== 'ACTIVE'` ⇒ `conflict('INSTALLATION_NOT_ACTIVE', ...)`.
  3. App (`registry.getOrThrow`), plano e produto (`catalog.getPlan/getProduct`): plano ausente ou fora de `app.productSpaIds` ⇒ `notFound('PLAN_NOT_FOUND')`; plano ou produto inativo ⇒ `unprocessable('PLAN_INACTIVE')`; `plan.type !== 'subscription'` ou `plan.isTrial` ⇒ `badRequest('PLAN_TYPE_MISMATCH', ...)`.
  4. Datas: converter com `parseSpaCalendarDate`/`startOfCalendarDay`; `periodEnd` precisa ser depois do início e até início + 24 meses (mesmo dia do mês; 29/02 cai em 28/02), senão `unprocessable('INVALID_PERIOD', ...)`. O início padrão vem de `clock.now()`.
  5. Dentro de `context.withInstallationLock(installation.installationId, ...)`: ler `subscriptions.currentOf`; `active`/`past_due` ⇒ `new HttpError(409, 'SUBSCRIPTION_ALREADY_EXISTS', msg, { subscriptionId, modality, status })`. Trials `trialing` da instalação (`listByInstallation`) viram `previousSubscriptionId` (o primeiro) e são cancelados no fim.
  6. `writer.create(installation, write, [])`, sem evento, com `status: 'active'`, `modality: 'manual'`, `cancelAtPeriodEnd: false`, título conforme as Global Constraints.
  7. Reler com `context.subscriptions.get(created.id)` e comparar plano, status, modalidade e período com o pedido; divergência ou item ausente ⇒ `new HttpError(502, 'SUBSCRIPTION_WRITE_FAILED', msg, { id: created.id, created: true })`, sem evento.
  8. `writer.update(installation, created, {}, [{ type: 'subscription.activated', data: { previousSubscriptionId }, dedupeKey: \`activated:${created.id}\` }])` (mesmo segundo passo de `StripeLifecycle.activate`); depois `writer.update(..., { status: 'cancelled', canceledAt: clock.now() }, [])` em cada trial.
  9. Comentário via `context.subscriptions.comment(id, texto)`, **fora** do caminho crítico: erro vai para `logger().warn`. Texto: tipo (cobrança manual ou bonificação), `who.actor`, `who.reason` e, se houver, `approvedBy`.

- [ ] **Step 5: Registrar os códigos em `src/docs/errors.ts`:** `SUBSCRIPTIONS_READ_ONLY` (409), `INVALID_PERIOD` (422), `SUBSCRIPTION_WRITE_FAILED` (502), no formato das entradas vizinhas (`meaning`, `action`, `origin`). Em `SUBSCRIPTION_ALREADY_EXISTS`, trocar o texto para "assinatura vigente (Stripe ou manual)" e acrescentar o novo arquivo em `origin`.

- [ ] **Step 6: Fiar no `container.ts`:** `new ManualSubscriptionService({ context: billingContext, writer, registry, catalog, clock, environment: env.platformEnvironment })`, exposto como `manualSubscriptions`.

- [ ] **Step 7: Rodar.** `yarn vitest run src/modules/billing/manual-subscription.test.ts` ⇒ PASS. Depois `yarn vitest run src/modules/billing` ⇒ PASS (nada quebrou).

- [ ] **Step 8: Commit.** `git add` dos arquivos acima; mensagem `feat(billing): serviço de assinatura manual e bonificação`.

---

### Task 2: Rota, política e contrato OpenAPI

**Files:**
- Create: `src/modules/billing/http/admin-subscription-routes.ts`
- Create: `src/modules/billing/manual-subscription-http.test.ts`
- Modify: `src/app.ts:147` (montar logo abaixo de `catalogAdminRoutes`)
- Modify: `src/modules/backoffice/http/policy.ts` (entrada nova)
- Modify: `src/docs/openapi/operations.ts`, `src/docs/openapi/responses.ts`
- Regenerate: `docs/api/openapi-admin.json` (e `docs/api/openapi.json` se o gerador alterar)

**Interfaces:**
- Consumes: `ManualSubscriptionService.create`, `createManualSubscriptionSchema` (Task 1); `findActor` de `@/modules/backoffice/http/actor`; `res.locals.auditReason` (preenchido pelo gate).
- Produces: `POST /admin/installations/{id}/subscriptions` ⇒ `201 { subscriptionId: number, status: 'active', modality: 'manual', planId: number, periodStart: string, periodEnd: string }` (datas ISO). Schema de resposta `manualSubscriptionCreatedSchema` em `responses.ts`.

- [ ] **Step 1: Escrever os testes que falham** em `manual-subscription-http.test.ts`, no formato de `catalog-http.test.ts` (`setup({ PLATFORM_ENVIRONMENT: 'production' })`, `seedGptMaker`, instalar com `POST /v1/install`, `login`, `operator`). Nomes:
  - `operator cria e recebe 201 com o corpo do contrato; a auditoria registra a rota, alvo installation, o motivo e o corpo`.
  - `viewer: 403 FORBIDDEN_ROLE`.
  - `sem X-Admin-Reason: 400 REASON_REQUIRED` e nada é escrito.
  - `bonificação sem approvedBy: 400 de validação`; `campo desconhecido no corpo: 400` (schema estrito).
  - `homologação: 409 SUBSCRIPTIONS_READ_ONLY`; `instalação inexistente ou id não numérico: 404 INSTALLATION_NOT_FOUND`.
  - `a linha do tempo da instalação mostra a ação` (a auditoria usa `targetType: 'installation'`).

- [ ] **Step 2: Rodar e ver falhar.** `yarn vitest run src/modules/billing/manual-subscription-http.test.ts` ⇒ FAIL.

- [ ] **Step 3: Implementar `adminSubscriptionRoutes(deps: { manualSubscriptions: ManualSubscriptionService }): Router`.** Valida o corpo com `createManualSubscriptionSchema.parse`, usa `intParam(req.params.id, 'INSTALLATION_NOT_FOUND')`, passa `{ actor: findActor(res).id, reason: res.locals.auditReason }` e responde 201. Montar em `app.ts` com `admin.use(adminSubscriptionRoutes({ manualSubscriptions: container.manualSubscriptions }))`.

- [ ] **Step 4: Política.** Em `policy.ts`: `'POST /admin/installations/:id/subscriptions': { role: 'operator', target: installation, highImpact: true }`. **Decisão minha, diferente do spec:** o alvo da auditoria é a instalação, não a assinatura, porque a linha do tempo da instalação (`installation-reads.ts`) lê a auditoria por `targetType: 'installation'`; com alvo `subscription` a ação sumiria dali. O id da assinatura fica no comentário do SPA e na resposta.

- [ ] **Step 5: Contrato.** Em `operations.ts`, operação `createManualSubscription` (tag `Operador`, `security: 'admin'`, `pathParams: installationId`, corpo `named('CreateManualSubscription', createManualSubscriptionSchema)`, resposta `201: json('Assinatura criada', res.manualSubscriptionCreated)`, erros: `INSTALLATION_NOT_FOUND`, `INSTALLATION_NOT_ACTIVE`, `PLAN_NOT_FOUND`, `PLAN_INACTIVE`, `PLAN_TYPE_MISMATCH`, `INVALID_PERIOD`, `SUBSCRIPTION_ALREADY_EXISTS`, `SUBSCRIPTIONS_READ_ONLY`, `SUBSCRIPTION_WRITE_FAILED`, `BILLING_BUSY`). Descrever as regras (uma assinatura por instalação, trial substituído, só produção, fim máximo de 24 meses).

- [ ] **Step 6: Regenerar e rodar.** `yarn docs:openapi`; `yarn vitest run src/modules/billing src/modules/backoffice src/docs` ⇒ PASS (o teste de política exige entrada para toda operação de operador; `openapi.test.ts` confere contrato e catálogo de erros).

- [ ] **Step 7: Commit.** `feat(backoffice): rota para criar assinatura manual e bonificação`.

---

### Task 3: Diálogo "Nova assinatura" no backoffice web

**Files:**
- Create: `web/backoffice/src/features/installation-detail/manual-subscription-dialog.tsx`
- Create: `web/backoffice/src/features/installation-detail/manual-subscription-dialog.test.tsx`
- Modify: `web/backoffice/src/features/installation-detail/actions.tsx` (botão "Nova assinatura" e estado `'subscription'` em `Open`)
- Regenerate: `web/backoffice/src/api/schema.d.ts` (`yarn gen:api` em `web/backoffice`)

**Interfaces:**
- Consumes: `POST /admin/installations/{id}/subscriptions` (Task 2), `GET /admin/catalog/products` (planos aninhados), `GET /admin/apps/{appCode}` (`productSpaIds`); `INVALIDATES.installation`, `useAdminAction`, `RoleGate`; modelo de formulário em `features/catalog/plan-dialog.tsx` (`DialogFrame`, `FormField`, `ReasonField`, `ServerErrorAlert`, `applyFieldErrors`, `useReason`, exportados por `product-dialog.tsx`).
- Produces: `ManualSubscriptionDialog({ open, onOpenChange, installation }: { open: boolean; onOpenChange: (open: boolean) => void; installation: InstallationDetail })`.

- [ ] **Step 1: Regenerar os tipos** (`yarn gen:api`) e conferir que `Schemas['CreateManualSubscription']` existe.

- [ ] **Step 2: Escrever os testes que falham** (`manual-subscription-dialog.test.tsx`, no estilo de `actions.test.tsx` e `catalog/forms.test.tsx`):
  - `operador vê "Nova assinatura" em instalação ACTIVE; viewer e instalação não ACTIVE não veem`.
  - `lista só planos ativos, pagos e de assinatura dos produtos do app` (exclui trial e compra única).
  - `tipo bonificação mostra e exige o responsável; cobrança manual não mostra`.
  - `envia POST com planId, kind, periodStart, periodEnd, approvedBy e o header X-Admin-Reason`; após sucesso invalida a instalação e mostra o toast `Assinatura criada`.
  - `validação no cliente: fim obrigatório, fim depois do início, até 24 meses` (mesmas mensagens do servidor).
  - `409 SUBSCRIPTION_ALREADY_EXISTS e 409 SUBSCRIPTIONS_READ_ONLY aparecem no alerta do diálogo; INVALID_PERIOD vai para o campo Fim`.

- [ ] **Step 3: Rodar e ver falhar.** `yarn vitest run manual-subscription-dialog` em `web/backoffice` ⇒ FAIL.

- [ ] **Step 4: Implementar o diálogo e ligar em `actions.tsx`.** Campos: Plano (select), Tipo (cobrança manual | bonificação), Início (data, padrão hoje), Fim (data), Responsável (só bonificação), Motivo. Rótulos e textos em pt-br; efeito descrito ao operador: "Cria a assinatura no SPA, avisa o app e encerra o trial vigente, se houver."

- [ ] **Step 5: Rodar tudo do web.** `yarn lint`, `yarn check-types`, `yarn test`, `yarn check:api` em `web/backoffice` ⇒ PASS.

- [ ] **Step 6: Commit.** `feat(backoffice-web): diálogo para criar assinatura manual e bonificação`.

---

### Task 4: Documentação e verificação final

**Files:**
- Modify: `docs/technical/billing.md` (seção "Assinatura manual")
- Modify: `docs/operations/runbook.md` (como criar bonificação/assinatura manual; o que fazer no 502 `SUBSCRIPTION_WRITE_FAILED`)
- Modify: `openspec/specs/backoffice-web/spec.md` (só se listar as ações da instalação: acrescentar a nova)

- [ ] **Step 1: Atualizar os docs.** Em `billing.md`: o backoffice cria assinatura manual/bonificação; regra de uma assinatura por instalação; trial substituído; só em produção; o rastro da bonificação (título, comentário, auditoria). No runbook: passo a passo da tela e o tratamento do 502 (item criado no SPA sem evento: conferir o item pelo id em `details`, corrigir ou excluir no Bitrix e repetir).

- [ ] **Step 2: Gates do backend.** `yarn lint`, `yarn check-types`, `yarn test` ⇒ PASS. `yarn docs:openapi` não deixa diff.

- [ ] **Step 3: Conferência no portal real (manual, com o dono do portal).** Chamar `crm.item.fields` para o `entityTypeId` 1142 e confirmar que não existe outro campo obrigatório para criar o item além dos que o `SpaMappers.subscriptionFields` já grava, e que o webhook de entrada pode criar itens. Se houver campo obrigatório extra, ou se o webhook não puder criar, **parar e avisar o dono** antes de ir para produção.

- [ ] **Step 4: Commit.** `docs(billing): assinatura manual e bonificação pelo backoffice`.
