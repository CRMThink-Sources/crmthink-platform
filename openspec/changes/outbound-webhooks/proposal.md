# Proposal

## Why

Os eventos de cobrança e de instalação só chegam ao `webhookUrl` do próprio app. Um sistema que não é app (o ERP, o financeiro, uma automação) não tem como acompanhar renovações, atrasos, cancelamentos, compras e estornos sem consultar o Bitrix. A parte 2 deixou entrar o pagamento; esta parte 3 de 3 deixa sair o que a plataforma decide, para um destinatário cadastrado no backoffice, sem depender de um app e sem arriscar a entrega aos apps.

## What Changes

- Novos **destinatários de eventos** (`webhook_endpoint`), cadastrados no backoffice: nome, URL HTTPS, segredo próprio, **tipos de evento** desejados e **apps** de interesse (vazio = todos).
- A cada evento gravado no outbox, a plataforma cria **uma entrega por destinatário interessado**, na mesma transação (`webhook_delivery`). Cada entrega tem estado, retentativa e dead-letter **independentes**: um destinatário fora do ar não atrasa nem mata a entrega ao app.
- Um relay novo (`deliver-webhooks`, a cada 5 s) entrega o mesmo envelope dos apps, assinado com o segredo do destinatário (`X-Platform-Signature`, mesmos cabeçalhos), em ordem por instalação e por destinatário, com o mesmo backoff e a mesma janela de reenvio.
- Rotação de segredo com período de convivência, como no app. O segredo aparece uma vez, na criação e na rotação.
- Consulta das entregas de um destinatário (com as tentativas) e reenvio de uma entrega ou de todas as mortas do destinatário.
- Tela "Destinatários de eventos" no backoffice, com o detalhe das entregas.
- Métricas e alerta de dead-letter próprios.
- Três tabelas novas e nenhuma alteração nas existentes: `webhook_endpoint`, `webhook_delivery`, `webhook_delivery_attempt`.
- Códigos de erro novos: `WEBHOOK_ENDPOINT_NOT_FOUND`, `WEBHOOK_DELIVERY_NOT_FOUND`, `WEBHOOK_URL_NOT_ALLOWED` e `WEBHOOK_APP_UNKNOWN`.

Fora do escopo: reenviar o histórico a um destinatário novo, transformar ou filtrar o corpo, limite de taxa ou retentativa configurável por destinatário, evento de teste (ping), mTLS ou lista de IPs, e eventos de outros tipos que não os 18 que já existem.

## Capabilities

### New Capabilities
- `outbound-webhooks`: cadastro de destinatários, entrega assinada e independente dos eventos, rotação de segredo, consulta e reenvio das entregas.

### Modified Capabilities
- `backoffice-web`: tela "Destinatários de eventos" (lista, cadastro, edição, rotação, detalhe com entregas e reenvio).
- `api-reference`: o contrato documenta as rotas `/admin/webhook-endpoints` e o formato do que os destinatários recebem.

## Impact

- Código: `src/modules/events/` (fan-out em `appendEvent`, relay novo), `src/modules/backoffice/http/policy.ts`, `src/container.ts`, `src/app.ts`, `src/worker.ts` (job novo), `src/shared/observability/metrics.ts`, `src/docs/`, `prisma/schema.prisma` e migração, `src/test/fake-prisma.ts`, `web/backoffice/`.
- API: contratos `openapi.json` e `openapi-admin.json` ganham operações e erros; SDK regenerado.
- Dados: migração aditiva; cada evento passa a gerar uma linha por destinatário interessado (custo de escrita proporcional ao número de destinatários).
- Segurança e privacidade: a plataforma passa a chamar URLs cadastradas por operadores e a enviar dados de clientes (`memberId`, assinatura) a terceiros; por isso a URL é só HTTPS e sem hosts internos, redirecionamentos não são seguidos, o segredo fica cifrado e as mutações são auditadas.
- Depende de: partes 1 e 2 (já em produção); não depende delas tecnicamente, mas os eventos `subscription.renewed` das duas passam a ser entregues.
