# Tasks

## 1. Dados e destinatários

- [x] 1.1 Criar o branch `feat/outbound-webhooks` a partir de `develop` atualizado e verificar com `git branch --show-current`
- [x] 1.2 Acrescentar os modelos `WebhookEndpoint` (nome, URL, segredo cifrado e o anterior com validade, tipos e apps em JSON, ativo, datas), `WebhookDelivery` (destinatário, evento, `event_seq`, `installation_id`, `app_code`, `event_type`, estado `pending`/`delivered`/`dead`, tentativas, `next_attempt_at`, `window_started_at`, `delivered_at`, `dead_at`; único por destinatário + evento; índices por estado/horário e por destinatário/estado) e `WebhookDeliveryAttempt` (entrega, tentativa, status HTTP, erro, próxima tentativa, entregue em, criação) em `prisma/schema.prisma`, gerar a migração aditiva e os três modelos em `src/test/fake-prisma.ts`; verificar com `yarn check-types` e que a migração só tem `CREATE TABLE`/chaves novos (migração gerada pelo Prisma a partir da diferença dos schemas; aplicá-la num MySQL real fica a cargo do job `migrations` do CI)
- [x] 1.3 Escrever os testes do serviço de destinatários (criar guarda o segredo cifrado e o devolve uma vez; listar nunca mostra segredo; validar URL: `http`, `localhost`, IP privado/loopback/link-local em IPv4 e IPv6, mais de 500 caracteres, e HTTPS público aceito; tipos desconhecidos e app inexistente recusados; editar nome, filtros e URL; desativar e reativar; rotacionar mantém o anterior válido até o fim da convivência; destinatário inexistente) e verificar que falham
- [x] 1.4 Implementar `WebhookEndpoints` em `src/modules/events/webhook-endpoints.ts` (inclui a lista dos 18 tipos de evento exportada de `domain/event.ts`) e ligá-lo em `container.ts`, mais os códigos `WEBHOOK_ENDPOINT_NOT_FOUND`, `WEBHOOK_URL_NOT_ALLOWED` e `WEBHOOK_APP_UNKNOWN` em `src/docs/errors.ts`; verificar que os testes da 1.3 passam

## 2. Fan-out e entrega aos destinatários

- [x] 2.1 Escrever os testes do fan-out em `appendEvent` (uma entrega por destinatário ativo interessado; filtro por tipo e por app, com apps vazios valendo todos; destinatário inativo ou criado depois não recebe; evento repetido por `dedupeKey` ou de app inativo não gera entrega; as colunas copiadas do evento; a entrega ao app inalterada) e verificar que falham
- [x] 2.2 Implementar o fan-out em `src/modules/events/outbox.ts` e verificar que os testes da 2.1 passam e que `yarn vitest run src/modules/events src/modules/billing` continua passando
- [x] 2.3 Escrever os testes do relay de destinatários (entrega com envelope idêntico ao do evento, cabeçalhos e assinatura verificável com o segredo; duas assinaturas durante a rotação; `2xx` entrega; `4xx`/`5xx`/rede/tempo esgotado reagendam com o backoff; `3xx` conta como falha sem seguir o redirecionamento; dead-letter com alerta ao passar da janela; destinatário fora do ar não atrasa a entrega ao app nem a outro destinatário; ordem por instalação e destinatário, com `dead` não bloqueando e outras instalações seguindo; destinatário desativado não recebe e retoma ao reativar; reenviar uma entrega e reenviar as mortas, com `dryRun` e o limite de 5000) e verificar que falham
- [x] 2.4 Implementar `WebhookDelivery` em `src/modules/events/webhook-delivery.ts` (`dispatchDue`, `deliver`, `resend`, `resendDead`, contagens), ligá-lo em `container.ts`, registrar o job `deliver-webhooks` (5 s) em `src/worker.ts`, e acrescentar a métrica `platform_webhook_deliveries_total{outcome}`, os gauges de pendentes e mortas (atualizados no job `gauges`) e o alerta `webhook.dead_letter`; verificar que os testes da 2.3 passam
- [x] 2.5 Documentar em `docs/technical/async-processing.md` a fila, o relay e o job novos (estados, ordem, backoff, janela e a independência do relay dos apps) e verificar que o job e as métricas citados existem no código

## 3. API de operador, contrato e docs

- [x] 3.1 Escrever os testes HTTP das rotas (`viewer` lista e consulta e não escreve; criar exige motivo e devolve o segredo uma vez sem cache; editar nome, filtros e reativar sem motivo e desativar com motivo; rotacionar e reenvio em lote exigem motivo; `dryRun` do reenvio em lote não exige; as entregas paginadas por cursor com filtro por estado e sem o corpo do evento; 404 de destinatário e de entrega; auditoria com alvo `webhook_endpoint` e sem o segredo) e verificar que falham
- [x] 3.2 Implementar `admin-webhook-endpoint-routes.ts`, montá-las em `app.ts`, acrescentar as entradas em `policy.ts` e em `reason.test.ts`, e declarar operações, schemas, erros e `WEBHOOK_DELIVERY_NOT_FOUND` no contrato; verificar que os testes da 3.1 passam
- [x] 3.3 Documentar no contrato, na seção `webhooks`, o que um destinatário recebe (envelope, cabeçalhos, verificação da assinatura, resposta `2xx`), rodar `yarn docs:openapi` e `yarn sdk:types`, e atualizar `docs/technical/security.md` (URL permitida, redirecionamento, segredo, dados que saem) e `docs/operations/runbook.md` (cadastrar, filtros, rotação, investigar entrega morta e reenviar, o que acontece ao desativar, sem backfill, crescimento sem retenção); verificar que `yarn vitest run src/docs sdk` passa e que os códigos citados batem com `docs/api/openapi.json`

## 4. Tela: lista e cadastro

- [x] 4.1 Rodar `yarn gen:api` em `web/backoffice` e verificar que os schemas dos destinatários existem em `src/api/schema.d.ts` e que `yarn check:api` passa
- [x] 4.2 Escrever os testes da lista e do cadastro (item no menu para todos os papéis; lista sem ações para `viewer`; criação com tipos agrupados, apps opcionais e URL sem HTTPS barrada no cliente; segredo exibido uma vez e ausente do cache e do armazenamento; edição; desativar com motivo obrigatório e reativar sem; rotação com motivo; erros no diálogo com o diálogo aberto; colunas de pendentes e mortas) e verificar que falham
- [x] 4.3 Implementar a feature `webhook-endpoints` (página de lista, diálogos, rota `/webhook-endpoints`, item em `nav.ts`, `INVALIDATES` e descrição da página) e verificar com `yarn test`, `yarn check-types` e o ESLint dos arquivos novos em `web/backoffice`

## 5. Tela: entregas do destinatário

- [x] 5.1 Escrever os testes do detalhe (rota `/webhook-endpoints/:id`; lista de entregas com tipo, instalação, estado e tentativas; filtro por estado e cursor na URL; carregar mais; reenviar uma entrega; reenviar mortas com prévia e motivo; `viewer` sem botões; erro com "Tentar novamente") e verificar que falham
- [x] 5.2 Implementar a página de detalhe, a rota e o link da lista para ela; verificar com `yarn test`, `yarn check-types` e o ESLint dos arquivos novos

## 6. Integração

- [x] 6.1 Rodar `yarn check-types`, `yarn test` e o ESLint dos arquivos alterados na raiz e no web, mais `yarn docs:openapi` e `yarn sdk:types` sem diff, e verificar que tudo passa
- [x] 6.2 Rodar `openspec validate outbound-webhooks --strict` e verificar que não há erros
- [x] 6.3 Em produção, cadastrar um destinatário de teste (uma URL de captura), provocar um evento numa instalação de teste, e verificar a entrega, a assinatura recalculada com o segredo, a ordem, e que uma falha provocada gera retentativa sem afetar a entrega ao app; só então cadastrar o destinatário real
