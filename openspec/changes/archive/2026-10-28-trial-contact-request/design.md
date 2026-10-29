## Context

- `TrialService.start` (`billing/application/trial-service.ts`) cria o trial sob `withInstallationLock`. Ele já devolve `TRIAL_ALREADY_USED` e `SUBSCRIPTION_ALREADY_EXISTS`, e é usado pelo trial automático (`startTrialOnInstall`) e pela rota de operador em `registry/http/admin-routes.ts`. Hoje `TRIAL_ALREADY_USED` é checado **antes** de olhar o trial vigente. Por isso uma instalação com trial `trialing` responde `TRIAL_ALREADY_USED`.
- As rotas do app ficam em `billing/http/routes.ts` (`appBillingRoutes`), atrás de `appAuth`. A posse da instalação é conferida por `BillingContext.ownedInstallation(appCode, id)`, que responde 404 para a instalação de outro app.
- O contato já tem lugar nos dois armazenamentos, mas ninguém escreve nele:
  - no banco, a coluna `installation.contact` (`Json?`, tipo `InstallationContact { email, name, phone, company }`). Ela só é preenchida pela importação do hub-core e é lida pelo checkout (`customerEmail`);
  - no SPA 1060, `spa-config.ts` já tem os códigos `installation.name|email|phone|company`. Só falta o cargo.
- O billing só enxerga a instalação pela porta `InstallationDirectory` (D1). Hoje essa porta não tem escrita de contato.

## Goals / Non-Goals

**Goals:**
- Um único caminho de domínio para a solicitação de trial, com as variações por chamador. O app pode receber 200 "trial já vigente" e o operador recebe 409.
- O banco continua sendo a fonte de verdade do contato. O SPA 1060 recebe uma cópia para leitura do comercial.

**Non-Goals:**
- Criar ou vincular um Contato/Empresa no CRM do Bitrix.
- Mudar o trial automático, a expiração ou a conversão em assinatura paga.
- Coletar contato em qualquer outro ponto, como a instalação ou o checkout.
- Deduplicar ou validar telefone além de "não vazio". O formato varia demais (WhatsApp, ramal, internacional).

## Decisions

1. **Rota do app reutiliza o caminho `POST /v1/installations/{id}/trial`, e a rota de operador vai para `/admin/installations/{id}/trial`.** O guard `adminAuth` do mesmo caminho é removido de `admin-routes.ts`. Assim o caminho público fica com o nome natural para o app, e a rota de operador cai sob o prefixo `/admin` já protegido e já excluído de `openapi.json`. *Alternativa:* aceitar as duas credenciais no mesmo caminho. Foi descartada porque mistura os esquemas de segurança numa operação, confunde o contrato e obrigaria o `appAuth` a deixar passar tokens de operador.

2. **`TrialService.request(appCode | null, installationId, contact | undefined, mode)`** substitui o uso direto de `start` nas rotas:
   - A posse é checada com `ownedInstallation` quando há `appCode`, e com `installations.get` no operador.
   - Dentro do lock da instalação, a ordem é:
     1. gravar o contato (banco), se houver;
     2. ver se existe assinatura aberta. Se for `trialing`: o app recebe `{ created: false, subscription }` e o operador, `TRIAL_ALREADY_USED`, como hoje. O trial também é marcado como usado, se ainda não estava. Se for outra assinatura aberta, responde `SUBSCRIPTION_ALREADY_EXISTS`;
     3. se `trialUsed`, responde `TRIAL_ALREADY_USED`;
     4. criar o trial.
   - A rota traduz `created` em 201 ou 200.
   - Gravar o contato antes das checagens garante que ele fica salvo nos casos 409.
   - `TRIAL_NOT_CONFIGURED` é checado antes do lock e antes de gravar qualquer coisa: um app sem trial não deve coletar contato por esta rota.
   - `startTrialOnInstall` continua chamando a criação sem contato.
   - *Alternativa:* endpoint separado `PUT /v1/installations/{id}/contact`, com o app chamando os dois. Foi descartada porque o pedido é "contato para ativar o trial", e duas chamadas abrem espaço para trial sem contato.

3. **A escrita do contato no banco entra pela porta `InstallationDirectory.saveContact(installationId, contact)`**, que mantém a fronteira D1. A gravação substitui o objeto inteiro, porque o último contato informado vale. `InstallationContact` ganha `role?: string`. Não precisa de migração do Prisma: a coluna é JSON.

4. **A cópia no SPA 1060 é feita depois do lock, sem bloquear.** `InstallationSpa.updateContact(itemId, contact)` grava os campos `name`, `email`, `phone`, `company` e `role`, e uma falha só gera log `warn` com `installationId`. Segue o mesmo padrão de `markTrialUsed`. Valores vazios nunca são enviados (regra já documentada na classe), mas a validação já impede que eles cheguem aqui. *Alternativa:* fila/outbox para reprocessar. Ficou fora porque é volume baixo e o operador consegue corrigir à mão a partir do banco; dá para revisitar se o log mostrar falhas frequentes.

5. **Novo campo `installation.role` em `spa-config.ts`**, com o código UF definido no onboarding (ex.: `ufCrm55Role`). Ele entra na conferência de `crm.item.fields` do boot (`bootstrap.ts`) como os demais campos novos da plataforma.

6. **Schema zod `trialRequestSchema`** em `billing/application/trial-service.ts`, junto do serviço, como os demais schemas de entrada, e reaproveitado pelo registro do OpenAPI. As strings passam por `trim` e `min(1)`, o e-mail é validado com `z.email()` e há um limite de tamanho (ex.: 200) para não estourar os campos do SPA. Na rota de operador o mesmo schema só é aplicado quando há corpo: corpo vazio ou ausente conta como "sem contato".

7. **O evento `subscription.trial_started` não ganha os dados de contato.** O app já os tem, porque foi ele que enviou, e manter dados pessoais fora dos eventos evita que eles se espalhem pelos webhooks e logs de entrega.

## Risks / Trade-offs

- [Scripts de operador chamando o caminho antigo passam a receber 401 do `appAuth`] → avisar na nota de versão e no `docs/technical/billing.md`. O uso é raro e interno.
- [Campo de cargo inexistente no portal no momento do deploy faz a checagem de boot falhar] → criar o campo no SPA 1060 (homologação e produção) antes do deploy. É a primeira tarefa do plano.
- [Cópia no SPA falha em silêncio e o comercial não vê o contato] → log `warn` com `installationId`. O banco tem o dado para conferência.
- [O app pode reenviar o contato quantas vezes quiser e sobrescrever o anterior] → aceitável: o último contato informado é o válido. Há rate limit geral da API.
- [Dados pessoais (LGPD) gravados em mais um lugar] → só o banco e o SPA já previstos para isso. Nada em eventos nem em logs (o log de falha não inclui o corpo).

## Migration Plan

1. Criar o campo UF de cargo no SPA 1060 (homologação e produção) e registrar o código em `spa-config.ts` ou no arquivo `SPA_CONFIG_FILE`.
2. Fazer o deploy da plataforma. A rota do app passa a existir e a de operador muda de caminho.
3. Publicar a versão nova do SDK com `requestTrial` e avisar os times dos apps (GPTMaker primeiro).
4. Rollback: reverter o deploy. O contato já gravado em `installation.contact` e no SPA continua válido, e o campo de cargo pode ficar no portal.
