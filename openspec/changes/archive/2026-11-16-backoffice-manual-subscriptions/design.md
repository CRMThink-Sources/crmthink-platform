# Design

## Context

Motivação em `proposal.md`; requisitos em `specs/`. Estado atual relevante:

- Assinatura manual já existe: o SPA 1142 é editado à mão e `ManualLifecycle` traduz a mudança em evento comparando com o último estado registrado (`subscription_version.last_snapshot`).
- `SubscriptionWriter` é o único caminho de escrita de assinatura + evento: escreve no SPA só o que mudou, com marcador de versão, e grava versão e evento do outbox na mesma transação.
- A plataforma assume **uma assinatura vigente por instalação** (`currentOf`); o checkout recusa com `SUBSCRIPTION_ALREADY_EXISTS` se houver `active` ou `past_due`.
- O catálogo do backoffice já estabeleceu os padrões reaproveitados aqui: escrita só em produção, releitura para confirmar a gravação, `X-Admin-Reason` para ações de alto impacto, auditoria pelo `adminGate`.
- A linha do tempo da instalação lê a auditoria por `targetType = 'installation'`.

Documentos de trabalho: `docs/superpowers/specs/2026-11-16-manual-subscriptions-design.md` (design aprovado) e `docs/superpowers/plans/2026-11-16-manual-subscriptions.md` (plano passo a passo).

## Goals / Non-Goals

**Goals:**
- Reaproveitar o caminho de escrita e de evento existente; nenhum evento novo, nenhuma tabela nova.
- Falhar fechado: qualquer dúvida na gravação impede o evento.

**Non-Goals:**
- Renovar, editar ou cancelar manual pelo backoffice (parte 2 automatiza a renovação por boleto).
- Mudar a regra de uma assinatura por instalação.

## Decisions

1. **Serviço novo no módulo de billing, não extensão do `TrialService`.** Ele cria assinatura manual como o trial, mas com regras, eventos e substituição de trial próprios. Alternativa descartada: parametrizar `TrialService`, que misturaria contato, `trial_used` e expiração com cobrança.
2. **SPA 1142 continua fonte de verdade (abordagem A).** O backoffice grava no SPA e a rotina existente cuida de renovação, aviso de fim e atraso. Alternativa descartada: tabela própria na plataforma, que criaria duas fontes de verdade e esconderia a assinatura do comercial no Bitrix.
3. **Criar sem evento, conferir, depois emitir.** `writer.create` sem evento → releitura → `writer.update` com `subscription.activated`. É o mesmo desdobramento em dois passos da ativação Stripe (o evento precisa do id) e garante que item divergente nunca gere evento. A dedupe é `activated:<id>`.
4. **Trial substituído, não bloqueante.** O trial vigente é cancelado depois do evento, sem evento próprio, como na ativação Stripe; `previousSubscriptionId` informa o app.
5. **Lock da instalação.** A criação roda dentro do lock de cobrança da instalação (`BILLING_BUSY` se ocupado), o que serializa criações simultâneas e a checagem de assinatura vigente.
6. **Alvo da auditoria é a instalação** (diverge do design aprovado, que dizia `subscription`). A linha do tempo da instalação filtra por esse alvo; com alvo `subscription` a ação sumiria dali. O id da assinatura fica na resposta e no comentário do SPA.
7. **`approvedBy` como campo de corpo.** O operador que clicou já está na auditoria; o responsável da bonificação é quem autorizou no financeiro e não dá para deduzir.
8. **Comentário da linha do tempo fora do caminho crítico.** É informativo; falha vai para o log e não desfaz uma assinatura já gravada e anunciada ao app.
9. **Sem `writable` na tela.** O catálogo expõe esse indicador para esconder botões; aqui o diálogo mostra o 409 do servidor. Menos uma chamada e uma fonte de verdade a manter.

## Risks / Trade-offs

- [SPA 1142 pode ter outro campo obrigatório que o formulário não preenche] → conferir com `crm.item.fields` e com o dono do portal antes de produção; a criação falharia com erro do Bitrix, não com dado errado.
- [Bitrix não é transacional: item criado e releitura falha deixa item órfão] → `502 SUBSCRIPTION_WRITE_FAILED` com o id; o runbook explica corrigir ou excluir no Bitrix e repetir.
- [Cancelar o trial depois do evento pode falhar e deixar dois itens abertos] → a próxima execução da regra vê assinatura `active` e o trial `trialing` vencerá por `expire-trials`; aceito, igual à ativação Stripe.
- [Bonificação só se distingue por título, comentário e auditoria] → relatório por tipo exigiria campo novo no SPA, decisão do dono do portal; fora desta mudança.
- [Instalação com Stripe e boleto ao mesmo tempo] → intencionalmente bloqueada; quem precisa trocar de modalidade cancela a atual antes.
