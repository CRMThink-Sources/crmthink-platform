# Design

## Context

Motivação em `proposal.md`; requisitos em `specs/`. Estado atual relevante:

- `appendEvent` grava o evento em `outbox_event` **dentro da transação da decisão**; o estado da entrega (`pending`/`delivered`/`dead`) e as tentativas (`event_delivery`) pertencem ao evento e ao app dono dele (`webhook_url` único por app).
- `EventDelivery` é um relay por polling (`deliver-events`, a cada 5 s): pega o evento pendente mais antigo de cada instalação, só entrega se não houver mais antigo pendente, usa o lock `delivery:<app>:<instalação>` e reagenda com backoff de 30 s dobrando até 1 h, com dead-letter ao passar da janela (`EVENT_RETRY_WINDOW_HOURS`).
- A assinatura é `X-Platform-Signature: t=<unix>,v1=<hmac>` (um `v1` por segredo vigente), com `X-Platform-Event-Id` e `X-Platform-Event-Type`. O segredo do app é cifrado (`TokenCipher`), rotaciona com convivência (`credentialRotationGraceMs`) e a chave de API do app já segue o padrão "mostrada uma vez" que a parte 2 reaproveitou.
- A URL do app só é validada como `z.string().url()`, e o `fetch` segue redirecionamentos.
- Os padrões de operador (rotas atrás de `adminGate`, motivo em `X-Admin-Reason`, auditoria, `policy.ts`, contrato OpenAPI) vêm das partes 1 e 2.

## Goals / Non-Goals

**Goals:**
- Entregar os mesmos eventos dos apps a destinatários cadastrados, sem alterar o que os apps recebem nem arriscar a entrega a eles.
- Reaproveitar o envelope, a assinatura, o backoff e a janela, para o integrador ter um contrato só.

**Non-Goals:**
- Backfill do histórico, transformação do corpo, limite de taxa ou janela por destinatário, evento de teste, mTLS, lista de IPs.
- Alterar o relay dos apps (`EventDelivery`) ou a tela de Eventos.

## Decisions

1. **Uma entrega por evento e destinatário (`webhook_delivery`), criada no `appendEvent`.** Na mesma transação do evento, carrega os destinatários **ativos**, filtra em código por tipo e por app (a tabela é pequena e filtro em coluna JSON seria frágil no Prisma) e insere uma linha `pending` por interessado. A linha repete `event_seq`, `installation_id`, `app_code` e `event_type` do evento: o relay ordena e filtra sem junção, e a ordem por instalação não depende do id autoincremental da entrega (transações concorrentes podem inverter ids e `seq`). Alternativa descartada: um cursor por destinatário sobre o outbox, que daria ordem de graça mas não permite retentativa, dead-letter e reenvio por entrega.
2. **Relay próprio (`WebhookDelivery`, job `deliver-webhooks` a cada 5 s), espelhando o dos apps.** Mesma lógica de "cabeça por par": o par agora é (destinatário, instalação), com o lock `webhook:<destinatário>:<instalação>`. Só entram destinatários ativos; entregas `dead` não bloqueiam. Reaproveita `nextBackoffMs`, `WEBHOOK_TIMEOUT_MS` e `EVENT_RETRY_WINDOW_HOURS`. Mantém o relay dos apps intocado: a independência pedida vem de ele não saber que o outro existe.
3. **Mesmo envelope, mesmos cabeçalhos, segredo do destinatário.** O corpo é o `payload` do evento no outbox, byte a byte, e a assinatura usa `buildSignatureHeader` com os segredos vigentes do destinatário. O integrador usa a mesma verificação documentada para apps.
4. **Segredo por destinatário, `whsec_`, cifrado, mostrado uma vez.** Rotação com convivência igual à do app (`previous_secret_enc` e `previous_secret_until`). Sem rota de "revelar": quem perdeu o segredo rotaciona. Reduz a superfície e dispensa mais uma ação de alto impacto.
5. **Tentativas em `webhook_delivery_attempt`, tabela separada.** `event_delivery` é indexada por `event_id` e usada pelas telas de eventos dos apps; misturar as tentativas dos destinatários ali exigiria filtrar em todas as leituras. A tabela nova guarda status HTTP e erro por tentativa, como a existente, e serve a lista de entregas do destinatário.
6. **URL só HTTPS, sem host interno, sem redirecionamento.** Na criação e na edição: `https`, até 500 caracteres, sem usuário e senha embutidos (vazariam em logs e na auditoria da URL), e recusa de `localhost`, loopback, redes privadas (0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, multicast e reservado, e os equivalentes IPv6: `::1`, `fc00::/7`, `fe80::/10` e IPv4 mapeado) **quando informados como IP literal**. A entrega usa `redirect: 'manual'` e trata `3xx` como falha, para a URL cadastrada não virar um salto para dentro da rede. Limite conhecido: não resolve DNS (um nome público que aponte para IP interno passa); o cadastro é restrito a `operator` e auditado, e a verificação por DNS fica como evolução.
7. **API.** `GET/POST /admin/webhook-endpoints`, `PATCH /admin/webhook-endpoints/{id}` (nome, URL, tipos, apps, `active`), `POST .../rotate-secret`, `GET .../deliveries`, `POST /admin/webhook-deliveries/{id}/resend` e `POST .../resend-dead` (com `dryRun` e o limite de 5000 já usado no reenvio de eventos). Política: criar, rotacionar, desativar e reenviar em lote são de alto impacto; editar e reativar não; reenvio de uma entrega não exige motivo. A lista de destinatários traz as contagens de entregas pendentes e mortas, calculadas por consulta (poucos destinatários).
8. **Observabilidade.** Métricas `platform_webhook_deliveries_total{outcome}` e gauges de pendentes e mortas, atualizados no job `gauges`; alerta `webhook.dead_letter` ao morrer uma entrega. Sem rótulo por destinatário, para não multiplicar séries.
9. **Tela.** Feature `webhook-endpoints` no web: lista e formulário (tipos agrupados, apps, URL validada) num grupo de tarefas, e o detalhe `/webhook-endpoints/:id` com as entregas (filtro e cursor na URL) em outro. A exibição do segredo reaproveita `SecretRevealDialog`.
10. **Códigos de erro novos:** `WEBHOOK_ENDPOINT_NOT_FOUND`, `WEBHOOK_DELIVERY_NOT_FOUND`, `WEBHOOK_URL_NOT_ALLOWED`, `WEBHOOK_APP_UNKNOWN`; o excesso no reenvio em lote reaproveita `RESEND_TOO_LARGE`.

## Risks / Trade-offs

- [Amplificação de escrita: cada evento gera uma linha por destinatário interessado] → poucos destinatários esperados; o filtro por tipo e app é o controle; a medição vem das gauges.
- [Crescimento sem limite de `webhook_delivery` e das tentativas, como já ocorre com `outbox_event`] → sem retenção nesta mudança; fica registrado no runbook e é o próximo candidato a um job de expurgo.
- [Dados de clientes (`memberId`, assinatura) saem para terceiros] → só `operator` cadastra, a mutação é auditada, o envelope não carrega token nem chave, e a URL é restrita.
- [Destinatário lento ou fora do ar segura a fila da instalação dele por até 24 h] → o bloqueio é só entre as entregas dele (por par destinatário e instalação) e a janela termina em dead-letter com alerta; reenvio disponível.
- [Verificação de URL sem DNS] → ver decisão 6.
- [Destinatário desativado acumula pendentes que podem vencer a janela] → aceito e documentado: reativar a tempo retoma, depois disso viram `dead` e são reenviáveis.

## Migration Plan

1. Migração aditiva (três tabelas); nada existente muda e, sem destinatários, o `appendEvent` não cria nenhuma linha extra.
2. Deploy do backend (o worker passa a rodar o job `deliver-webhooks`) e depois do web.
3. Em produção: cadastrar um destinatário de teste (por exemplo, uma URL de captura), provocar um evento (uma renovação numa instalação de teste), conferir a entrega, a assinatura e a repetição após falha provocada; só então cadastrar o destinatário real.
4. Reversão: desativar os destinatários (o relay os ignora) e reverter o deploy; as tabelas podem ficar.
