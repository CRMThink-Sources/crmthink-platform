# Operação do crmthink-platform

## Provisionamento (16.1)

Staging e produção rodam no mesmo droplet (DigitalOcean, Ubuntu 22.04/24.04), com MySQL,
Redis e Caddy compartilhados em `ops/droplet` (ver [Droplet](#droplet)).

Por ambiente (`staging` a partir de `develop`, `production` a partir de `main`):

1. **Banco**: MySQL 8.4 do droplet (`crmthink-mysql`), database própria
   (`crmthink_platform_staging` / `crmthink_platform`) e usuário com DDL (as migrações
   rodam no deploy). O bootstrap cria os dois.
2. **Redis**: instância do droplet (`crmthink-redis`), DB `1` em staging e `0` em
   produção, `QUEUE_PREFIX` diferente por ambiente.
3. **Segredos** — gerar e guardar no cofre da equipe **antes** do primeiro deploy:
   - `TOKEN_ENCRYPTION_KEY`: `yarn admin:generate-encryption-key`. Perdê-la = perder todos
     os tokens (clientes reinstalam). Nunca reutilizar a do hub-core.
   - `JWT_SIGNING_PRIVATE_KEY`: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`.
     Só semeia a primeira chave; depois, rotação pela API.
   - `ADMIN_API_TOKENS`: `openssl rand -base64 32` (um por operador).
   - `STRIPE_SECRET_KEY` (staging: `sk_test_…`/`rk_test_…`; produção: `…_live_…`) e
     `STRIPE_WEBHOOK_SECRET` do endpoint criado no passo 4.
   - `CRMTHINK_WEBHOOK_URL` e `CRMTHINK_APPLICATION_TOKEN` (16.3).
4. **Endpoint Stripe da plataforma** (test mode em staging, live em produção):
   `https://<host>/webhooks/stripe` com os eventos `checkout.session.completed`,
   `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`,
   `charge.dispute.created`. O endpoint do hub-core continua existindo até cada app migrar.
   Customer Portal habilitado (cancelamento no fim do período, atualização de cartão).
5. **GitHub Environments** `staging` e `production`. O deploy monta o `.env` a partir
   deles (`.github/workflows/ci.yml`, passo "Montar .env"); item vazio fica fora do `.env`
   e vale o padrão de `src/config/env.ts`. \* = obrigatório.

   Deploy:

   |                                    | staging                                  | production                                  |
   | ---------------------------------- | ---------------------------------------- | ------------------------------------------- |
   | var `DEPLOY_HOST`\*                | IP do droplet                            | IP do droplet                               |
   | var `DEPLOY_USER`\*                | `deploy`                                 | `deploy`                                    |
   | var `DEPLOY_DIR`\*                 | `/home/deploy/crmthink-platform-staging` | `/home/deploy/crmthink-platform-production` |
   | var `COMPOSE_PROJECT`\*            | `crmthink-platform-staging`              | `crmthink-platform-production`              |
   | var `API_PORT`\*                   | `4101`                                   | `4100`                                      |
   | var `WORKER_METRICS_PORT`\*        | `9465`                                   | `9464`                                      |
   | secret `DEPLOY_SSH_KEY`\*          | chave privada do CI                      | chave privada do CI                         |
   | secret `DEPLOY_SSH_KEY_PASSPHRASE` | só se a chave tiver senha                | idem                                        |

   Plataforma:

   |                                                             | staging                                                      | production                         |
   | ----------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
   | var `PUBLIC_BASE_URL`\*                                     | `https://platform-staging.crmthink.com.br`                   | `https://platform.crmthink.com.br` |
   | var `PLATFORM_ENVIRONMENT`\*                                | `homolog`                                                    | `production`                       |
   | var `QUEUE_PREFIX`\*                                        | `crmthink-platform-staging`                                  | `crmthink-platform-production`     |
   | var `SESSION_CORS_ORIGINS`                                  | `crmthink.gptmaker=https://gptmaker-staging.crmthink.com.br` | origem de produção do GPTMaker     |
   | var `BACKOFFICE_ORIGINS`                                    | `https://platform-staging.crmthink.com.br`                   | `https://platform.crmthink.com.br` |
   | secret `DATABASE_URL`\*                                     | impressa pelo bootstrap                                      | impressa pelo bootstrap            |
   | secret `REDIS_URL`\*                                        | impressa pelo bootstrap (`/1`)                               | impressa pelo bootstrap (`/0`)     |
   | secret `TOKEN_ENCRYPTION_KEY`\*                             | `openssl rand -base64 32`                                    | outra, nunca a de staging          |
   | secret `JWT_SIGNING_PRIVATE_KEY`\*                          | PEM com quebras de linha, colado como está                   | outra                              |
   | secret `ADMIN_API_TOKENS`                                   | `openssl rand -hex 32` (vírgula entre operadores)            | outros                             |
   | secret `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`         | test mode                                                    | live                               |
   | secret `CRMTHINK_WEBHOOK_URL`, `CRMTHINK_APPLICATION_TOKEN` | 16.3                                                         | 16.3                               |

   Ajustes opcionais, como var: `LOG_LEVEL`, `LOKI_URL`, `JWT_ISSUER`, `JWT_TTL_SECONDS`,
   `BITRIX_TLS_REJECT_UNAUTHORIZED`, `INSTALLER_TIMEOUT_MS`, `WEBHOOK_TIMEOUT_MS`,
   `CREDENTIAL_ROTATION_GRACE_HOURS`, `EVENT_RETRY_WINDOW_HOURS`, `WORKER_DISABLE_SCHEDULES`.
   Variável nova da plataforma precisa entrar na lista do passo "Montar .env".

   `DEPLOY_DIR` é caminho absoluto (`~` não expande). `COMPOSE_PROJECT` tem que ser
   exatamente esse: o Caddyfile faz proxy para `<COMPOSE_PROJECT>-api`. As portas ficam só
   em `127.0.0.1` (Prometheus local). O GitHub não devolve secrets: `TOKEN_ENCRYPTION_KEY`
   e `ADMIN_API_TOKENS` ficam também no cofre.

6. Push em `develop` ⇒ CI ⇒ imagem `ghcr.io/<org>/crmthink-platform:<sha>` ⇒
   `prisma migrate deploy` ⇒ `docker compose -f docker-compose.deploy.yml up -d`.
7. Conferir `GET /health/ready` (banco, Redis, chave JWT e **configuração dos SPAs**: o
   relatório lista SPA e campo que faltam).

## Droplet

Uma vez por droplet, a partir da raiz do repositório:

1. Chave SSH do CI (sem senha), só para o usuário `deploy`:
   `ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ~/.ssh/crmthink-deploy`. A privada
   (`~/.ssh/crmthink-deploy`) vai no secret `DEPLOY_SSH_KEY` dos dois Environments.
2. Copiar e rodar o bootstrap como root:

   ```sh
   scp -r ops/droplet root@<ip>:/root/
   ssh root@<ip> \
     DEPLOY_PUBKEY="'$(cat ~/.ssh/crmthink-deploy.pub)'" \
     STAGING_HOST=platform-staging.crmthink.com.br \
     PRODUCTION_HOST=platform.crmthink.com.br \
     ACME_EMAIL=<email> \
     bash /root/droplet/bootstrap.sh
   ```

   Ele instala Docker, cria o usuário `deploy` (grupo `docker`), liga o UFW (22/80/443),
   cria swap, a rede `crmthink` e sobe `/opt/crmthink-infra` (MySQL, Redis, Caddy). As
   senhas geradas ficam em `/opt/crmthink-infra/.env` (guardar no cofre). O script é
   idempotente, então dá para rodar de novo para atualizar hosts e o Caddyfile.

3. DNS: registro A dos dois hosts para o IP do droplet. O Caddy emite o TLS sozinho.
4. Backups: ativar os Backups do droplet na DigitalOcean. Para restauração lógica:
   `docker exec crmthink-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --databases crmthink_platform crmthink_platform_staging' > dump.sql`.

## Domínio e TLS (16.2)

Um host por ambiente (ex.: `platform-staging.crmthink.com.br`, `platform.crmthink.com.br`)
com TLS válido — o Bitrix24 recusa handler sem HTTPS. Proxy reverso na VPS para a porta
`API_PORT`. Precisam estar públicos: `/install/*`, `/v1/*`, `/.well-known/jwks.json`,
`/bitrix/*`, `/webhooks/stripe`, `/health` e `/admin/*` (protegido pela própria API: sessão
de operador com senha e TOTP, papéis, limite de tentativas e auditoria; ou token de
`ADMIN_API_TOKENS`, que deve ser longo e aleatório). **Não** expor: `/metrics` (só a rede do
Prometheus).

No droplet, o Caddy (`ops/droplet/Caddyfile`) faz exatamente isso: `/metrics` → 404 e o
resto vai para `<COMPOSE_PROJECT>-api:4100` na rede `crmthink`. A antiga allowlist de IP de
`/admin/*` (`ADMIN_ALLOWED_IPS`) saiu: estava em `0.0.0.0/0 ::/0`, sem efeito. A linha que
sobrar em `/opt/crmthink-infra/.env` pode ser apagada.

`PUBLIC_BASE_URL` = `https://<host>` (entra no `iss` do JWT e nos handlers registrados no
Bitrix: trocar depois exige reinstalação).

## Webhook de saída do portal CRMThink (16.3)

No portal CRMThink: Desenvolvedores → Outros → Webhook de saída.

- URL: `https://<host>/bitrix/spa-events`
- Eventos: `onCrmDynamicItemAdd`, `onCrmDynamicItemUpdate`, `onCrmDynamicItemDelete`
- O `application_token` gerado vai em `CRMTHINK_APPLICATION_TOKEN`.

Webhook de entrada (REST dos SPAs) com escopo `crm`: URL em `CRMTHINK_WEBHOOK_URL`.

O mesmo portal serve produção e homologação: cada instância só processa itens do próprio
Ambiente (item sem Ambiente = produção).

## Monitoramento e alertas (16.4)

- Prometheus: scrape `api:4100/metrics` e `worker:9464/metrics`; regras em
  `ops/prometheus-alerts.yml` (plataforma fora, API de tokens lenta, falhas de renovação,
  `AUTH_ERROR`, instalações pendentes, dead-letter, fila de eventos, webhook Stripe,
  varreduras).
- Loki: toda linha de alerta tem `alert=<tipo>` — ex.:
  `{service=~"crmthink-platform-.*"} | json | alert != ""`.
- **Monitoramento externo** (UptimeRobot/Better Stack) a cada 1 min em
  `GET https://<host>/health` e `GET https://<host>/.well-known/jwks.json`, com alerta
  imediato: a plataforma fora do ar por mais que a validade do token (~1h) quebra as
  chamadas dos apps ao Bitrix.

## Procedimentos

Cada procedimento pode ser feito no backoffice (tela indicada) ou pela API. **Ações de alto
impacto exigem o motivo** (1 a 500 caracteres, uma linha) no header `X-Admin-Reason`; sem ele a
resposta é 400 `REASON_REQUIRED` e nada é executado. São elas: rotação de chave de API,
rotação de segredo de webhook, consulta do segredo de webhook, desativação de app (`PATCH` com
`active:false`), reenvio em lote, rotação da chave do JWT, redefinição de acesso de operador e exclusão e desativação de produto
ou plano do catálogo. Nas demais mutações o motivo é
opcional, mas fica na auditoria quando enviado. Scripts que chamam essas ações precisam passar
o header, por exemplo:

```bash
curl -X POST "$PLATFORM/admin/apps/<appCode>/rotate-api-key" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Reason: chave vazou em um print"
```

| Situação                                  | Ação                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evento em dead-letter                     | Tela **Eventos** (filtro `status=dead` → "Reenviar este" ou "Reenviar todos"). API: `GET /admin/events?status=dead` → corrigir o app → `POST /admin/events/resend {"eventId"}` ou, em lote, `{"appCode","from","to","onlyDead":true}` com `X-Admin-Reason`. Antes de um lote, `"dryRun":true` devolve `{matched, sample}` sem alterar nada (e sem motivo); também aceita `"installationId"`; acima de 5000 eventos responde 422 `RESEND_TOO_LARGE` (reduza o período) |
| Evento Stripe `dead`                      | `GET /admin/stripe-events?status=dead`; corrigir causa; `POST /admin/sweeps/stripe` reconcilia o SPA e emite o que faltou                                                                                                                                                                                                                                                                                                                                             |
| Instalação `INSTALL_PENDING`              | `GET /admin/installations/{id}/attempts` (erro do instalador); o admin do portal clica "tentar novamente"                                                                                                                                                                                                                                                                                                                                                             |
| Instalação `AUTH_ERROR`                   | O cliente reinstala o app (volta a `ACTIVE` e emite `installation.auth_restored`)                                                                                                                                                                                                                                                                                                                                                                                     |
| Token da instalação com `refresh_failing` | Detalhe da instalação → "Renovar token". API: `POST /admin/installations/{id}/token/refresh` (só instalação `ACTIVE`; devolve a validade e a saúde, nunca o token). Se o Bitrix recusar, 502 `TOKEN_REFRESH_FAILED` com `details.reason` (ex.: `invalid_grant` pede reinstalar o app)                                                                                                                                                                                 |
| Rotação da chave do JWT                   | Tela **Sistema** → "Rotacionar chave do JWT". API: `POST /admin/signing-keys/rotate {"leadMinutes":10}` com `X-Admin-Reason` — publicada já, assina após 10 min                                                                                                                                                                                                                                                                                                       |
| Rotação de credencial de app              | Detalhe do app na tela **Apps** → "Rotacionar chave" ou "Rotacionar segredo". API: `POST /admin/apps/{appCode}/rotate-api-key` ou `/rotate-webhook-secret` com `X-Admin-Reason` (24h de transição)                                                                                                                                                                                                                                                                    |
| Perdeu o segredo de webhook de um app     | Detalhe do app → "Mostrar e copiar" (pede o motivo). API: `POST /admin/apps/{appCode}/reveal-webhook-secret` com `X-Admin-Reason`; a consulta fica na auditoria e a resposta não é guardada em cache. A **chave de API** não tem consulta (só existe o hash): quem a perde rotaciona                                                                                                                                                                                  |
| SPA divergente                            | Tela **Sistema** → varreduras Stripe e SPA. API: `POST /admin/sweeps/spa` e `/admin/sweeps/stripe`                                                                                                                                                                                                                                                                                                                                                                    |
| Investigar um cliente                     | `GET /admin/installations?q=<trecho do domínio>` → `GET /admin/installations/{id}` (saúde do token, eventos, assinatura) → `GET /admin/installations/{id}/timeline`                                                                                                                                                                                                                                                                                                   |
| Quem fez uma ação                         | `GET /admin/audit?targetType=app&targetId=<appCode>` (ou `targetType=installation`, `actor=operator:<id>`, `result=failure`)                                                                                                                                                                                                                                                                                                                                          |
| Conta de operador bloqueada               | Espera 15 min, ou outro `operator` redefine o acesso (tela **Operadores** → "Redefinir acesso", ou `POST /admin/operators/{id}/reset-access` com `X-Admin-Reason`), o que também desbloqueia                                                                                                                                                                                                                                                                          |
| Alerta `AdminLoginFailuresHigh`           | `GET /admin/audit?action=auth.login_failed`: IPs e e-mails tentados. Se for ataque, bloquear o IP no Caddy/firewall                                                                                                                                                                                                                                                                                                                                                   |
| Rollback                                  | redeploy da imagem anterior (`PLATFORM_IMAGE=…:<sha>`); outbox e tokens permanecem no banco                                                                                                                                                                                                                                                                                                                                                                           |

## Catálogo de produtos e planos

A tela **Catálogo** (grupo Operação) gere os produtos (SPA 1134) e os planos (SPA 1138) do portal
CRMThink, com os planos aninhados em cada produto. API: `/admin/catalog/*`. `viewer` só lê;
`operator` cria, edita, desativa e exclui. **Excluir e desativar (`active:false`) exigem o motivo**
(`X-Admin-Reason`, como nos demais procedimentos acima).

- **Só a produção escreve.** Os dois ambientes compartilham o portal e os SPAs, mas cada instância
  tem o próprio banco (vínculos app-produto e planos de trial dos apps ficam no banco da
  instância). Fora de `PLATFORM_ENVIRONMENT=production` a tela só lê e a API responde 409
  `CATALOG_READ_ONLY`. Altere o catálogo sempre pela produção.
- **O que bloqueia** (409 `PRODUCT_IN_USE` / `PLAN_IN_USE`, com o uso em `details`): excluir
  produto ou plano em uso; trocar ou limpar o id de preço Stripe de plano com assinaturas; ligar
  ou desligar o trial de plano em uso; trocar o intervalo de plano com assinaturas; trocar o
  modelo de cobrança de produto que tem planos; excluir produto com planos ou apps vinculados.
  "Em uso" conta assinaturas de **todos** os ambientes (SPA 1142) e o plano de trial de apps; para
  produto, apps vinculados ou qualquer plano. Livres: nome, valor de referência, ativo (desativar exige motivo) e
  **preencher** um preço que estava vazio em plano que já é pago. A tela mostra o uso antes de excluir.
- **Como contornar:** "crie um plano novo e desative este". O plano antigo continua servindo as
  assinaturas existentes; o novo vale para as próximas.
- **Preço faltante:** o id do preço é criado à mão no Stripe e colado no plano (formato
  `price_...`, um para homologação e outro para produção). O valor é digitado em reais e gravado
  em centavos (pela API, o valor vai em centavos). Plano pago (sem trial) exige ao menos um id de
  preço, senão 422 `PLAN_INVALID_FOR_PRODUCT`: sem preço em nenhum ambiente a plataforma o trata
  como trial gratuito. Para preencher o preço que falta num ambiente de um plano que já tem preço
  no outro, edite o plano e cole o id (livre). Preencher o preço de um plano que não tem nenhum
  o transforma de trial em pago: a edição também precisa enviar `trial:false` (na tela, é a chave
  de trial) e segue a regra do trial, ou seja, 409 `PLAN_IN_USE` se o plano tem assinaturas ou é
  o plano de trial de um app (nesse caso, crie um plano novo). Produto
  de cobrança única recebe planos sem intervalo.
- **Id de preço não se repete:** um id `price_...` não pode estar em dois planos no mesmo ambiente
  nem ser o mesmo na homologação e na produção de um plano (422 `PRICE_ALREADY_USED`, com o plano
  e o campo em `details`); reenviar o próprio preço sem mudança não conflita.
- **502 `CATALOG_WRITE_FAILED`:** a escrita no portal não foi confirmada (o Bitrix descarta
  campos desconhecidos em silêncio, então o item é relido depois de criar ou editar).
  - **Ao criar:** a mensagem traz o id do item, que pode ter ficado **meio criado**: abra-o no SPA
    1134 (produto) ou 1138 (plano), exclua ou complete os campos e repita a operação. Se a
    própria criação falhou, não há id e nada foi criado.
  - **Ao editar:** o item já existia. Confira no portal os campos citados na mensagem e reaplique
    a edição. **Não exclua** o item.
- **Primeira escrita real em produção:** faça com um produto e um plano de teste e exclua em
  seguida, para confirmar a permissão do webhook e os campos obrigatórios do portal.
- **Limites conhecidos:** a API de apps ainda não valida se os ids de produto existem; o plano de
  trial do app continua um campo numérico (sem seletor); a auditoria guarda o corpo mascarado e o
  motivo, sem antes/depois.

## Assinatura manual e bonificação

No detalhe da instalação, **Nova assinatura** cria uma assinatura `manual` (boleto, contrato) ou uma
**bonificação** no SPA 1142, em vez de digitá-la no Bitrix. API:
`POST /admin/installations/{id}/subscriptions`. Só `operator`; o **motivo** (`X-Admin-Reason`) é
sempre obrigatório. O app recebe `subscription.activated`.

- **Preencha:** plano (ativo, pago, de assinatura, de um produto do app), tipo, fim do período
  (obrigatório, até 24 meses depois do início; o início é hoje se não informado) e, na bonificação,
  o **responsável** (quem autorizou). O motivo e o responsável ficam no comentário da linha do
  tempo da assinatura e na auditoria; a bonificação também aparece no título
  (`Bonificação — <plano> — <domínio>`). Não há campo próprio no SPA para ela.
- **Uma assinatura por instalação.** 409 `SUBSCRIPTION_ALREADY_EXISTS` se já houver assinatura
  `active` ou `past_due`, de qualquer modalidade (`details` traz a existente). Para trocar de
  modalidade, cancele a atual antes. Um **trial em andamento** é cancelado e o evento traz o id dele
  em `previousSubscriptionId`.
- **Só a produção escreve:** nos demais ambientes, 409 `SUBSCRIPTIONS_READ_ONLY`.
- **Renovar, editar e cancelar** a assinatura manual continuam sendo feitos no SPA 1142 (a
  plataforma reage ao evento do SPA).
- **502 `SUBSCRIPTION_WRITE_FAILED`:** o Bitrix aceitou a criação, mas a releitura não bate com o
  pedido (`details.id` é o item criado, `details.lost` o que divergiu). **Nenhum evento foi
  enviado.** Abra o item `details.id` no SPA 1142: corrija os campos ou exclua o item, e repita a
  criação.
- **Primeira criação real em produção:** faça com uma instalação de teste, para confirmar a
  permissão do webhook e os campos obrigatórios do SPA 1142 (`crm.item.fields`).

## Avisos de pagamento (boleto pago)

A tela **Integrações de pagamento** (grupo Operação) gere as chaves dos sistemas que avisam
pagamentos em `POST /webhooks/payments` (API: `/admin/payment-integrations`). `viewer` só lê;
`operator` cria, renomeia, desativa, reativa e rotaciona. **Criar, rotacionar e desativar exigem o
motivo** (`X-Admin-Reason`).

- **Criar a integração e entregar a chave.** Crie uma integração por sistema remetente. A chave
  completa (`pay_...`) aparece **uma única vez**: copie e entregue por canal seguro; depois só o
  prefixo fica visível. Perdeu a chave: **rotacione** (a antiga deixa de valer na hora, então
  atualize o remetente em seguida) ou crie outra integração.
- **O que o remetente envia**, com `Authorization: Bearer <chave>` e JSON de até 16 KB:
  `externalId` (**o id do pagamento**, por exemplo o id do boleto), `subscriptionId` **ou**
  `installationId`, e opcionalmente `paidAt` e `periodEnd` (`AAAA-MM-DD`). Sem `periodEnd`, o fim
  avança pelo intervalo do plano.
- **`externalId` é por pagamento.** Repetir o mesmo aviso é seguro (`duplicate: true`, nada é
  renovado de novo). Mas enviar o mesmo `externalId` para pagamentos diferentes faz o segundo ser
  tratado como repetido e **ignorado**: use o id do boleto, não o da assinatura.
- **Escolha um só caminho por cliente.** Se o aviso renova e o financeiro também edita o SPA à
  mão para o mesmo pagamento, o período avança duas vezes: a plataforma não distingue os dois.
- **Só a produção aceita** (`SUBSCRIPTIONS_READ_ONLY` nos demais ambientes). Cada instância tem as
  próprias integrações: uma criada na produção só vale no endereço da produção.
- **Erros que o remetente verá:** 401 (chave ausente ou inválida), 403 `INTEGRATION_INACTIVE`,
  404 `SUBSCRIPTION_NOT_FOUND`/`INSTALLATION_NOT_FOUND`, 422 `NOT_MANUAL_SUBSCRIPTION` (assinatura
  Stripe), 409 `SUBSCRIPTION_NOT_RENEWABLE` (cancelada, encerrada ou em trial), 409
  `EXTERNAL_ID_REUSED`, 422 `INVALID_PERIOD`, 400 `INVALID_JSON`, 413 `PAYLOAD_TOO_LARGE`.
- **Aviso `pending`.** Se o processo cair no meio, o aviso fica `pending` em `payment_notice`
  (o SPA pode já ter sido estendido) e o evento ao app ainda não saiu. O reenvio do mesmo aviso
  conclui exatamente o período já decidido. Para achar os pendentes:
  `SELECT * FROM payment_notice WHERE status = 'pending'`.
- **Métrica:** `platform_payment_notices_total{outcome}` com `applied`, `duplicate`, `rejected`
  (recusado por corpo ou regra) e `failed` (falha nossa, como o Bitrix fora do ar).
- **Primeiro uso em produção:** crie uma integração de teste, envie um aviso para uma instalação
  de teste com assinatura manual e confira o período no SPA, o `subscription.renewed` no app e o
  comentário na assinatura; repita o mesmo aviso para ver `duplicate: true`. Só então entregue a
  chave ao remetente real.

## Destinatários de eventos (webhook de saída)

A tela **Destinatários de eventos** (grupo Operação) cadastra URLs que recebem os eventos da
plataforma (renovação, atraso, cancelamento, compra, estorno, instalação...), além do app dono do
evento. API: `/admin/webhook-endpoints`. `viewer` só lê; `operator` cria, edita, desativa,
reativa, rotaciona o segredo e reenvia. **Criar, rotacionar, desativar e reenviar em lote exigem
o motivo** (`X-Admin-Reason`).

- **Cadastrar.** Nome, URL **HTTPS pública** (sem localhost nem IP interno), os **tipos de
  evento** desejados e, opcionalmente, os **apps** (vazio = todos). O segredo completo (`whsec_...`)
  aparece **uma única vez**: entregue ao responsável pelo destinatário por canal seguro, para
  verificar `X-Platform-Signature` (`t=<unix>,v1=<hmac-sha256(segredo, t + "." + corpo)>`, o mesmo
  contrato dos apps). Perdeu o segredo: **rotacione** (o anterior continua valendo em paralelo
  durante a convivência) e atualize o destinatário.
- **O que ele recebe.** O mesmo envelope JSON dos apps, com `X-Platform-Event-Id` (deduplique por
  ele: a entrega é pelo menos uma vez) e `X-Platform-Event-Type`. Responder `2xx` = entregue;
  qualquer outra resposta, `3xx` inclusive (redirecionamento não é seguido), erro de rede ou
  tempo esgotado = falha, com nova tentativa (30 s dobrando até 1 h) por até
  `EVENT_RETRY_WINDOW_HOURS` (24 h); depois a entrega vira **dead** e dispara o alerta
  `webhook.dead_letter`.
- **Sem histórico.** Um destinatário novo recebe só os eventos gravados **depois** do cadastro. Não
  há backfill nesta versão.
- **Ordem.** Para cada instalação, o destinatário recebe os eventos na ordem em que foram
  gravados: uma entrega antiga em retentativa segura as seguintes **daquele par** (destinatário e
  instalação), até entregar ou morrer. Outras instalações e outros destinatários não são
  afetados, **nem a entrega ao app**.
- **Desativar** para as tentativas: as entregas pendentes esperam e retomam na reativação, mas
  continuam sujeitas à janela de 24 h (passada ela, viram `dead` e podem ser reenviadas).
- **Investigar uma entrega que não chega.** No detalhe do destinatário (ou em
  `GET /admin/webhook-endpoints/{id}/deliveries?status=dead`) veja o tipo, a instalação e as
  tentativas (status HTTP e erro). Erro `HTTP 5xx`/timeout: problema do destinatário; `HTTP 3xx`:
  a URL cadastrada redireciona (cadastre a URL final); `HTTP 401/403`: o destinatário recusa a
  assinatura (confira o segredo).
- **Reenviar.** Uma entrega: `POST /admin/webhook-deliveries/{id}/resend`. Todas as mortas do
  destinatário: `POST /admin/webhook-endpoints/{id}/resend-dead` (use `dryRun` para ver quantas;
  acima de 5000, `422 RESEND_TOO_LARGE`).
- **Crescimento.** `webhook_delivery` e `webhook_delivery_attempt` crescem sem retenção, como o
  `outbox_event`; acompanhe pelas métricas e trate quando o volume pedir um job de expurgo.
- **Métricas:** `platform_webhook_deliveries_total{outcome}` (`delivered`, `failed`, `dead`),
  `platform_webhook_deliveries_pending` e `platform_webhook_deliveries_dead`.
- **Primeiro uso em produção:** cadastre um destinatário de teste (uma URL de captura sua),
  provoque um evento numa instalação de teste e confira a entrega, a assinatura recalculada com o
  segredo e, derrubando a URL de propósito, a retentativa. Só então cadastre o destinatário real.

## Operadores do backoffice

As listagens `/admin/events`, `/admin/stripe-events`, `/admin/installations`,
`/admin/installations/{id}/timeline` e `/admin/audit` são paginadas: 50 itens por padrão
(`limit` até 200) e `nextCursor` na resposta, que vai em `cursor` na próxima chamada. Antes
desta mudança `/admin/events` e `/admin/stripe-events` devolviam até 100 itens de uma vez:
scripts que liam só `items` continuam funcionando, mas veem só a primeira página.

Cada pessoa entra com a própria conta (e-mail e senha, depois o código do app autenticador). Não há cadastro público.

- **Primeiro operador** (ou quando ninguém consegue entrar): no droplet, dentro do container
  da API (os comandos ficam em `dist/src/cli`; em desenvolvimento, `yarn admin:create-operator`):

  ```bash
  docker exec -it <COMPOSE_PROJECT>-api node dist/src/cli/create-operator.js     --email dev@connectthink.com.br --name "Dev" --role operator
  ```

  Alternativa sem shell no droplet: `POST /admin/operators` com um token de
  `ADMIN_API_TOKENS` (fica na auditoria como `token:<prefixo>`). A saída mostra a senha provisória **uma única vez**: entregue-a por canal privado.
  A conta nasce sem autenticador: no primeiro login a pessoa digita e-mail e senha, a tela
  mostra o QR code (e o segredo em texto) para ler no app (Google Authenticator, 1Password, etc.)
  e o primeiro código de 6 dígitos conclui o cadastro. Depois disso a troca de senha é obrigatória.

- **Demais contas**: um `operator` cria pela rota `POST /admin/operators` (ou pelo
  backoffice). Papéis: `viewer` (suporte, só leitura) e `operator` (dev, leitura e ações).
- **Perdeu o celular ou a senha**: outro `operator` usa `POST /admin/operators/{id}/reset-access`.
  Sem nenhum `operator` disponível:
  `docker exec -it <COMPOSE_PROJECT>-api node dist/src/cli/create-operator.js --email <e-mail> --reset`.
  A redefinição gera uma senha provisória nova, **apaga o autenticador** (a pessoa cadastra o app
  de novo no próximo login, com QR code), derruba as sessões abertas e os navegadores lembrados e
  desfaz o bloqueio.
- **"Lembrar este navegador"**: dispensa o código por `ADMIN_TRUSTED_DEVICE_DAYS` (padrão 30) naquele
  navegador; a senha continua obrigatória. Para desligar o recurso, `ADMIN_TRUSTED_DEVICE_DAYS=0`.
  Trocar a senha, desativar a conta, trocar o papel ou redefinir o acesso esquecem os navegadores
  lembrados da conta.
- **Rollback do login em duas etapas**: a migração `20261110000000_backoffice_two_step_login` torna
  `admin_operator.totp_secret_enc` nulável. A imagem antiga trata a coluna como obrigatória e falha
  ao ler uma linha com `NULL` (isso derruba até a listagem de operadores). Antes de subir a imagem
  antiga, resolva as contas sem autenticador (criadas ou redefinidas depois do deploy):
  `SELECT id, email FROM admin_operator WHERE totp_secret_enc IS NULL;` e, para cada uma, ou
  `DELETE FROM admin_operator WHERE id = <id>` (conta que nunca entrou) ou grave um segredo
  qualquer com o CLI antigo depois do rollback (`--reset`) — nesse caso o `UPDATE` a seguir, só para
  destravar a leitura, é necessário antes: `UPDATE admin_operator SET totp_secret_enc = 'v1:invalido'
  WHERE totp_secret_enc IS NULL;`. A conta volta a entrar só depois do `--reset` com a imagem antiga.
