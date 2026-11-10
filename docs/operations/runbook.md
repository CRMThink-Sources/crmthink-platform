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
`active:false`), reenvio em lote, rotação da chave do JWT e redefinição de acesso de operador. Nas demais mutações o motivo é
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
  produto, apps vinculados ou qualquer plano. Livres: nome, valor de referência, ativo e
  **preencher** um preço que estava vazio. A tela mostra o uso antes de excluir.
- **Como contornar:** "crie um plano novo e desative este". O plano antigo continua servindo as
  assinaturas existentes; o novo vale para as próximas.
- **Preço faltante:** o id do preço é criado à mão no Stripe e colado no plano (formato
  `price_...`, um para homologação e outro para produção). O valor é digitado em reais e gravado
  em centavos. Plano pago (sem trial) exige ao menos um id de preço, senão 422
  `PLAN_INVALID_FOR_PRODUCT`: sem preço em nenhum ambiente a plataforma o trata como trial
  gratuito. Para preencher um preço vazio, edite o plano e cole o id (não é bloqueado). Produto
  de cobrança única recebe planos sem intervalo.
- **502 `CATALOG_WRITE_FAILED`:** a escrita no portal não foi confirmada (o Bitrix descarta
  campos desconhecidos em silêncio, então o item é relido depois de gravar). A mensagem traz o id
  do item, que pode ter ficado **meio criado** no portal: abra-o no SPA 1134 (produto) ou 1138
  (plano) e exclua ou complete os campos, depois repita a operação.
- **Primeira escrita real em produção:** faça com um produto e um plano de teste e exclua em
  seguida, para confirmar a permissão do webhook e os campos obrigatórios do portal.
- **Limites conhecidos:** a API de apps ainda não valida se os ids de produto existem; o plano de
  trial do app continua um campo numérico (sem seletor); a auditoria guarda o corpo mascarado e o
  motivo, sem antes/depois.

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
