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

| Situação | Ação |
| --- | --- |
| Evento em dead-letter | `GET /admin/events?status=dead` → corrigir o app → `POST /admin/events/resend {"eventId"}` ou `{"appCode","from","to","onlyDead":true}` |
| Evento Stripe `dead` | `GET /admin/stripe-events?status=dead`; corrigir causa; `POST /admin/sweeps/stripe` reconcilia o SPA e emite o que faltou |
| Instalação `INSTALL_PENDING` | `GET /admin/installations/{id}/attempts` (erro do instalador); o admin do portal clica "tentar novamente" |
| Instalação `AUTH_ERROR` | O cliente reinstala o app (volta a `ACTIVE` e emite `installation.auth_restored`) |
| Rotação da chave do JWT | `POST /admin/signing-keys/rotate {"leadMinutes":10}` — publicada já, assina após 10 min |
| Rotação de credencial de app | `POST /admin/apps/{appCode}/rotate-api-key` ou `/rotate-webhook-secret` (24h de transição) |
| SPA divergente | `POST /admin/sweeps/spa` e `/admin/sweeps/stripe` |
| Investigar um cliente | `GET /admin/installations?q=<trecho do domínio>` → `GET /admin/installations/{id}` (saúde do token, eventos, assinatura) → `GET /admin/installations/{id}/timeline` |
| Quem fez uma ação | `GET /admin/audit?targetType=app&targetId=<appCode>` (ou `targetType=installation`, `actor=operator:<id>`, `result=failure`) |
| Conta de operador bloqueada | Espera 15 min, ou outro `operator` redefine o acesso (`POST /admin/operators/{id}/reset-access`), o que também desbloqueia |
| Alerta `AdminLoginFailuresHigh` | `GET /admin/audit?action=auth.login_failed`: IPs e e-mails tentados. Se for ataque, bloquear o IP no Caddy/firewall |
| Rollback | redeploy da imagem anterior (`PLATFORM_IMAGE=…:<sha>`); outbox e tokens permanecem no banco |

## Operadores do backoffice

As listagens `/admin/events`, `/admin/stripe-events`, `/admin/installations`,
`/admin/installations/{id}/timeline` e `/admin/audit` são paginadas: 50 itens por padrão
(`limit` até 200) e `nextCursor` na resposta, que vai em `cursor` na próxima chamada. Antes
desta mudança `/admin/events` e `/admin/stripe-events` devolviam até 100 itens de uma vez:
scripts que liam só `items` continuam funcionando, mas veem só a primeira página.

Cada pessoa entra com a própria conta (e-mail, senha e TOTP). Não há cadastro público.

- **Primeiro operador** (ou quando ninguém consegue entrar): no droplet, dentro do container
  da API (os comandos ficam em `dist/src/cli`; em desenvolvimento, `yarn admin:create-operator`):

  ```bash
  docker exec -it <COMPOSE_PROJECT>-api node dist/src/cli/create-operator.js     --email dev@connectthink.com.br --name "Dev" --role operator
  ```

  Alternativa sem shell no droplet: `POST /admin/operators` com um token de
  `ADMIN_API_TOKENS` (fica na auditoria como `token:<prefixo>`). A saída mostra a senha provisória e o URI `otpauth://` **uma única vez**: cadastre o
  URI no app autenticador (Google Authenticator, 1Password, etc.; na entrada manual, só o
  valor de `secret=`; para QR code, `qrencode -t ansiutf8 '<uri>'`, nunca um gerador online)
  e entregue a senha por canal privado. No primeiro login a troca de senha é obrigatória.
- **Demais contas**: um `operator` cria pela rota `POST /admin/operators` (ou pelo
  backoffice). Papéis: `viewer` (suporte, só leitura) e `operator` (dev, leitura e ações).
- **Perdeu o celular ou a senha**: outro `operator` usa `POST /admin/operators/{id}/reset-access`.
  Sem nenhum `operator` disponível:
  `docker exec -it <COMPOSE_PROJECT>-api node dist/src/cli/create-operator.js --email <e-mail> --reset`.
  A redefinição derruba as sessões abertas da conta e desfaz o bloqueio.

