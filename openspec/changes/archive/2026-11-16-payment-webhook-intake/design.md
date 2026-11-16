# Design

## Context

Motivação em `proposal.md`; requisitos em `specs/`. Estado atual relevante:

- A renovação manual hoje é uma edição humana no SPA 1142; `ManualLifecycle` a traduz em `subscription.renewed` comparando com o último estado (`subscription_version.last_snapshot`). A chave de dedupe é `renewed:<id>:<início>:<fim>`.
- `SubscriptionWriter.update` é o caminho único de escrita + evento (SPA só com o que mudou, marcador anti-loop, versão e outbox na mesma transação), sob o lock de cobrança da instalação.
- A parte 1 criou `ManualSubscriptionService`, `SUBSCRIPTIONS_READ_ONLY` (escrita só em produção) e o padrão de rotas de operador com motivo e auditoria.
- Credenciais de entrada existentes: assinatura do Stripe, token de aplicação do Bitrix, chave de API do app (hash SHA-256, `hashApiKey`) e tokens de operador. Nenhuma serve a um sistema financeiro.
- Homologação e produção compartilham os SPAs mas têm bancos distintos; a escrita de assinatura só acontece na produção.

## Goals / Non-Goals

**Goals:**
- Renovar pelo mesmo caminho e com o mesmo evento da renovação manual, sem criar tipo de evento novo.
- Garantir que um aviso nunca renove duas vezes, inclusive com queda do processo no meio.
- Credencial isolada: só serve a esta rota, é revogável por integração e não fica legível depois da criação.

**Non-Goals:**
- Avisos de atraso, estorno ou cancelamento; adaptadores de banco ou provedor; pagamento parcial; reconciliação com o extrato.
- Detectar que o financeiro também editou o SPA à mão para o mesmo pagamento.

## Decisions

1. **Escrever pelo `SubscriptionWriter`, não pelo eco do SPA.** O aviso aplica `{ status: 'active', periodStart, periodEnd }` com o evento `subscription.renewed` e a dedupe `renewed:<id>:<início>:<fim>`, a mesma fórmula do `ManualLifecycle`. O snapshot gravado faz o eco do SPA não gerar segundo evento. Alternativa descartada: só editar o SPA e deixar o ciclo emitir o evento, que dependeria da fila `spa-events` e da varredura e não devolveria ao remetente o resultado real.
2. **Período contíguo.** Início = dia do fim anterior; fim = `periodEnd` informado ou fim anterior + intervalo do plano (1, 3, 6 ou 12 meses; dia do mês preservado, ou o último dia se não existir). Pagar atrasado ou adiantado não desloca o calendário, como no Stripe. O novo fim precisa ser posterior ao atual e ficar a no máximo 24 meses de hoje, o que limita o estrago de avisos repetidos com `externalId` diferentes.
3. **Aviso registrado antes da escrita (`payment_notice`, único por `integration_id` + `external_id`).** Dentro do lock da instalação: se já há registro, `applied` devolve o resultado com `duplicate: true` e `pending` reaplica o período **já gravado**; se não há, valida, grava `pending` com o período decidido, escreve no SPA e marca `applied`. Se o processo cair entre a escrita e a marcação, o reenvio conclui o mesmo período em vez de calcular outro a partir do fim já estendido. O `externalId` com outra assinatura ou instalação é `EXTERNAL_ID_REUSED`. A checagem de duplicidade vem antes da de status, para o reenvio de um aviso antigo continuar respondendo `200`.
4. **Processamento síncrono, sem fila.** O volume é de um boleto por vez e o remetente precisa saber se a validação passou para corrigir ou reenviar. Custo: a resposta espera as chamadas ao Bitrix; o remetente que expirar o tempo reenvia com o mesmo `externalId` com segurança. Alternativa descartada: fila estilo Stripe, que esconderia erros de validação.
5. **Credencial própria em tabela (`payment_integration`).** Chave `pay_` + 32 bytes aleatórios em base64url, guardada só como hash (`hashApiKey`), com `key_prefix` (8 primeiros caracteres) para identificação, `active`, `last_used_at`. Autenticação por `Authorization: Bearer`, como a chave de app. Alternativas descartadas: `ADMIN_API_TOKENS` (poder de operador demais), segredo único em variável de ambiente (sem revogar nem auditar por integração) e assinatura HMAC do corpo (remetentes genéricos costumam não assinar). A rotação invalida a chave antiga na hora, sem janela de convivência como a dos apps: o remetente de pagamento reenvia com a mesma `externalId`, então um 401 curto é recuperável; a janela exigiria colunas e regras a mais.
6. **Onde mora o código.** Serviços `payment-notice-service.ts` e `payment-integrations.ts` em `billing/application/`; rotas `payment-webhook-routes.ts` (pública, `express.json` com limite de 16 KB, montada fora do `adminGate` e do `appAuth`) e `admin-payment-integration-routes.ts`. Na rota pública, corpo JSON malformado ou grande vira 400 `INVALID_JSON` / 413 `PAYLOAD_TOO_LARGE`, porque o tratamento global os devolveria como 500 e o remetente repetiria o aviso. Política em `policy.ts` (`GET` viewer; criar, rotacionar e desativar de alto impacto; renomear e reativar não; alvo `payment_integration`, com o id da criação em `auditTargetId`).
7. **Rastro.** Comentário na linha do tempo da assinatura (melhor esforço, como na parte 1), o próprio `payment_notice` e a métrica `platform_payment_notices_total{outcome}` (`applied`, `duplicate`, `rejected` para recusa por corpo ou regra, `failed` para falha nossa). A auditoria de operador cobre só a gestão das integrações, não os avisos (que não vêm de operador).
8. **Escrita só em produção**, com o mesmo `SUBSCRIPTIONS_READ_ONLY`; cada instância tem a própria tabela de integrações, então uma integração criada na produção só vale no endereço da produção.
9. **Tela.** Feature `payment-integrations` no web, rota `/payment-integrations`, item "Integrações de pagamento" no grupo Operação (o `viewer` vê a lista). A exibição da chave reaproveita o padrão de `secret-reveal-dialog.tsx` (sem cache de consulta, sem armazenamento do navegador).

## Risks / Trade-offs

- [O remetente usa um `externalId` que se repete entre pagamentos (por exemplo, o id da assinatura)] → o segundo pagamento seria tratado como duplicado e ignorado; o contrato e o runbook dizem que o id é do **pagamento** (id do boleto); `duplicate: true` na resposta deixa o remetente perceber.
- [O financeiro edita o SPA à mão e o webhook também renova] → o período avança duas vezes; o runbook manda escolher um só caminho por cliente. A plataforma não consegue distinguir os dois.
- [Aviso `pending` que nunca é reenviado] → a renovação fica incompleta até o reenvio; o `externalId` é idempotente, então o remetente reenvia sem risco; o runbook mostra como achar avisos pendentes.
- [Latência do Bitrix maior que o tempo do remetente] → ele reenvia e recebe o resultado do primeiro processamento.
- [Chave vazada] → desativar a integração ou rotacionar; a chave só autentica esta rota e entropia de 256 bits dispensa limitador por IP.
- [401 curto na rotação] → aceito; o reenvio idempotente recupera.

## Migration Plan

1. Migração aditiva (`payment_integration`, `payment_notice`); nada existente muda.
2. Deploy do backend e depois do web (a tela depende dos tipos do contrato).
3. Em produção: criar uma integração de teste, enviar um aviso para uma instalação de teste com assinatura manual, conferir o período, o evento ao app, o comentário e a repetição com `duplicate: true`; só então entregar a chave ao remetente real.
4. Reversão: desativar as integrações (a rota passa a responder 403) e reverter o deploy; as tabelas novas podem ficar.
