# Onboarding do GPTMaker (primeiro consumidor)

Roteiro das tasks 17.1–17.5. Os passos dependem de acesso ao portal CRMThink, ao Stripe
e aos apps Bitrix — a plataforma só lê e valida o que for configurado aqui.

## 17.1 Campos novos nos SPAs (dono do portal)

Criar com **exatamente** estes `FIELD_NAME` (o nome de leitura camelCase deriva dele; os
códigos esperados estão em `src/config/spa-config.ts` e podem ser sobrescritos por
`SPA_CONFIG_FILE`). Campos marcados "texto" **não** podem ser lista: lista devolve id de
enum e a leitura nunca reconhece o valor.

| SPA | FIELD_NAME | Leitura | Tipo |
| --- | --- | --- | --- |
| 1060 Instalações | `UF_CRM_55_ENVIRONMENT` | `ufCrm55Environment` | lista `production`/`homolog` (ou texto) |
| 1060 | `UF_CRM_55_TRIAL_USED` | `ufCrm55TrialUsed` | sim/não |
| 1142 Assinaturas | `UF_CRM_91_ENVIRONMENT` | `ufCrm91Environment` | lista `production`/`homolog` (ou texto) |
| 1142 | `UF_CRM_91_VERSION` | `ufCrm91Version` | texto |
| 1142 | `UF_CRM_91_CANCEL_AT_PERIOD_END` | `ufCrm91CancelAtPeriodEnd` | sim/não |
| 1142 | `UF_CRM_91_MODALITY` (se ainda não existe) | `ufCrm91Modality` | texto (`stripe`/`manual`) |
| 1146 Itens | `UF_CRM_93_ENVIRONMENT` | `ufCrm93Environment` | lista `production`/`homolog` (ou texto) |
| 1146 | `UF_CRM_93_BILLABLE` | `ufCrm93Billable` | sim/não |
| 1146 | `UF_CRM_93_EXTERNAL_REFERENCE` | `ufCrm93ExternalReference` | texto |
| 1146 | `UF_CRM_93_METADATA` | `ufCrm93Metadata` | texto (JSON) |
| 1146 | `UF_CRM_93_VERSION` | `ufCrm93Version` | texto |

Se Ambiente for **lista**, registrar os IDs de enum em `SPA_CONFIG_FILE`:

```json
{ "environmentValues": { "production": "<id>", "homolog": "<id>" } }
```

Remover STATUS e TRIAL_* do SPA 1060 (a plataforma não os lê nem escreve).

Conferência: `GET /health/ready` → `checks.spaConfig.ok = true`.

## 17.2 Produtos e planos

- SPA 1134: produto **GPTMaker** (modelo de cobrança "Padrão") e **Créditos GPTMaker**
  (modelo novo **"Compra única"** em `ufCrm87BillingModel`). No portal CRMThink o ID de enum de
  "Compra única" é `14455`, já no padrão de `src/config/spa-config.ts`; outro portal usa
  `SPA_CONFIG_FILE` → `{"product": {"oneTimeBillingModelIds": ["<id>"]}}`.
- SPA 1138: plano de trial (sem price, R$ 0, intervalo mensal) e planos pagos do GPTMaker
  com intervalo; um plano por pacote de créditos no produto "Créditos GPTMaker", sem
  intervalo.
- Stripe (test e live): um price recorrente por plano de assinatura e um price de
  pagamento único por pacote, BRL. Price id de produção em `UF_CRM_89_GATEWAY_ID`, de
  homologação em `UF_CRM_89_GATEWAY_ID_HOMOLOG`.

## 17.3 Apps Bitrix do GPTMaker (staging e produção)

Dois apps (local ou marketplace), cada um com seu `client_id`:

- URL do app/instalação: `https://<host do ambiente>/install/crmthink.gptmaker`
- Handler de eventos de instalação: `https://<host do ambiente>/bitrix/events/crmthink.gptmaker`
- Escopos: os que o GPTMaker usa (ex.: `crm`, `imbot`, `imopenlines`, `im`, `user_brief`,
  `placement`) — os mesmos vão no cadastro (17.4).

## 17.4 Cadastro na plataforma

```bash
curl -X POST https://<host>/admin/apps \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "appCode": "crmthink.gptmaker",
    "name": "GPTMaker",
    "logoUrl": "https://…/gptmaker.png",
    "installTheme": {
      "primaryColor": "#6d28d9",
      "title": "Instalar GPTMaker",
      "welcomeText": "Agentes de IA no seu Bitrix24.",
      "termsUrl": "https://…/termos",
      "termsText": "termos de uso do GPTMaker"
    },
    "bitrixClientId": "<client_id do app Bitrix>",
    "bitrixClientSecret": "<client_secret>",
    "bitrixAppCode": "<CODE do app.info, só se o client_id for app.…>",
    "scopes": ["crm", "imbot", "imopenlines", "im", "user_brief", "placement"],
    "installerUrl": "https://<backend GPTMaker>/platform/installer",
    "webhookUrl": "https://<backend GPTMaker>/platform/events",
    "productSpaIds": [<id GPTMaker>, <id Créditos GPTMaker>],
    "trialDays": 14,
    "trialOnInstall": true,
    "trialPlanId": <id do plano de trial>
  }'
```

Guardar `credentials.apiKey` e `credentials.webhookSecret` no cofre do backend GPTMaker
(aparecem uma única vez). Adicionar a origem do frontend do GPTMaker em
`SESSION_CORS_ORIGINS` (`crmthink.gptmaker=https://…`) e redeploy.

## 17.5 Teste ponta a ponta em staging

Num portal de teste, marcando o resultado:

- [ ] Instalação pela página: tema do GPTMaker, termos obrigatórios, instalador do
      GPTMaker chamado (assinatura válida), `ACTIVE`, `installFinish`.
- [ ] Item no SPA 1060 com Ambiente `homolog`; `installation.created` e
      `subscription.trial_started` (14 dias) recebidos pelo GPTMaker.
- [ ] Instalador fora do ar ⇒ `INSTALL_PENDING` ⇒ "tentar novamente" conclui.
- [ ] Sessão do iframe: `POST /v1/sessions` da origem do GPTMaker; `isAdmin` correto para
      admin e não admin; JWT validado pelo backend (JWKS).
- [ ] Token: `GET /token`, uso no Bitrix; `expired_token` ⇒ `/token/refresh`; job renova
      antes de vencer.
- [ ] Trial ⇒ checkout `subscribe` embutido (cartão de teste) ⇒ `subscription.activated`;
      trial encerrado.
- [ ] Renovação: `stripe test clock` avançando um ciclo ⇒ `subscription.renewed`.
- [ ] Pacote: checkout `purchase` ⇒ `purchase.paid` (uma vez).
- [ ] Falha de pagamento (cartão `4000 0000 0000 0341`) ⇒ `subscription.past_due` com
      link; pagamento regularizado ⇒ `subscription.recovered`.
- [ ] Estorno de pacote no dashboard ⇒ `charge.refunded` `source=purchase`.
- [ ] Customer Portal: cancelar ⇒ `subscription.cancel_scheduled`; fim do período ⇒
      `subscription.ended`.
- [ ] Desinstalação no portal ⇒ `installation.removed`, token 410, assinatura intacta.
- [ ] Reinstalação ⇒ mesmo `installationId`, `isReinstall=true`,
      `installation.reinstalled`, sem trial novo.
- [ ] `yarn test:stripe` (scripts/stripe-trigger-e2e.ts) com `stripe listen` apontando
      para staging.
