# Assinaturas manuais e bonificação no backoffice — design (parte 1 de 3)

Este é o primeiro de três trabalhos combinados, nesta ordem: **(1) janela de criação**, (2) webhook de entrada de pagamento (boleto pago renova a assinatura manual), (3) webhook de saída cadastrável. Cada um tem seu próprio design; este cobre só o (1).

## Intenção e porquê

O financeiro trata muitos clientes com **bonificação** e cobrança por **boleto/contrato**. A modalidade `manual` já existe: hoje o comercial cria a assinatura **à mão no SPA 1142** do Bitrix, sem validação, sem auditoria e sem garantia de vínculo correto com a instalação. A plataforma só reage depois (`ManualLifecycle`). O backoffice passa a ter uma **janela de criação** que grava a assinatura no SPA 1142 com as mesmas garantias do catálogo: validada, auditada e com motivo.

## Metas

- Janela "Nova assinatura manual" no backoffice: escolher instalação, plano do catálogo, tipo (**cobrança manual** ou **bonificação**), início e fim.
- Gravar no SPA 1142 com `modality = manual`, status `active`, e a plataforma emitir `subscription.activated` pelo caminho já existente.
- Bonificação e cobrança manual são distinguíveis no rastro (auditoria e comentário na linha do tempo da assinatura).
- Cada criação é auditada: autor, rota, alvo (`subscription` e o id), motivo e corpo mascarado.

## Não-metas

- Permitir **mais de uma assinatura por instalação**. Decisão do dono: continua **uma só**.
- Migrar assinatura Stripe para manual (ou o contrário). Exige cancelar a do Stripe antes; fora do escopo.
- Renovar, editar e cancelar assinatura manual pela janela. Hoje seguem no SPA; a renovação por boleto é o assunto da parte 2.
- Criar campo novo no SPA 1142 (por exemplo "bonificação" ou "motivo"). A definição dos campos é do dono do portal.
- Cobrar ou emitir boleto. A plataforma só registra.

## Antimetas (falha mesmo funcionando)

- Criar assinatura numa instalação que já tem assinatura **paga vigente** (Stripe ou manual): duas fontes cobrando a mesma instalação.
- Escrita "bem-sucedida" no Bitrix que descartou campo em silêncio (como no catálogo: reler e conferir).
- Assinatura criada sem evento para o app (o app não libera o acesso).

## Restrições

- O SPA 1142 exige fim de período (`periodEnd`): **não existe "sem fim"** hoje.
- O Bitrix não é transacional: se a releitura falhar depois de criar, o item fica órfão; o erro devolve o id criado.
- A escrita só roda com `PLATFORM_ENVIRONMENT=production` (homologação e produção dividem os SPAs); na homologação a tela é só leitura, como o catálogo (`409`, mesmo padrão).
- O banco de cada instância guarda `subscription_version`; o evento e a versão seguem as regras de `docs/technical/billing.md`.

## Abordagens consideradas

- **A (escolhida pelo dono): o backoffice grava no SPA 1142.** O SPA segue como fonte de verdade comercial; renovação, aviso de fim e atraso continuam nas rotinas atuais; o comercial continua vendo tudo no Bitrix.
- B: tabela própria na plataforma. Descartada: duas fontes de verdade e o comercial perde a visão no Bitrix.

## O que ficou decidido (pelo dono)

- Escolha A.
- Uma assinatura por instalação.
- A ordem 1, 2, 3.

## Decisões minhas (a conferir)

- **Regra de criação:** a instalação precisa estar ativa. Se tem assinatura `active` ou `past_due`: `409 SUBSCRIPTION_ALREADY_EXISTS` (mesmo código do checkout), com o id e a modalidade da existente. Se está em **trial**, a criação é permitida e encerra o trial, emitindo `subscription.activated {previousSubscriptionId}`, igual à ativação paga.
- **Plano:** só planos ativos, pagos e do produto de um app da instalação. Plano de trial é recusado. Não exige preço do Stripe (a cobrança não passa por lá).
- **Bonificação:** modalidade `manual`, título "Bonificação — <plano>", motivo e responsável obrigatórios, comentário na linha do tempo da assinatura. Sem campo novo no SPA, "bonificada" só aparece no título, no comentário e na auditoria. Se isso não bastar para relatório, vira um pedido de campo ao dono do portal.
- **Fim obrigatório:** início padrão = hoje, fim = informado, máximo de 24 meses (palpite meu). Quem precisa estender continua editando o SPA até a parte 2.
- **Permissão:** `operator` cria; `viewer` só vê. Motivo obrigatório (`X-Admin-Reason`) nos dois tipos.
- **Ponto de escrita:** um serviço novo no módulo de billing usando `SubscriptionRepository.create` e `SubscriptionWriter`, sob o lock da instalação (`BILLING_BUSY` se ocupado), com marcador anti-loop.
- **API:** `POST /admin/installations/{id}/subscriptions` (contrato em `src/docs/openapi`). **Tela:** botão "Nova assinatura" no detalhe da instalação, diálogo reaproveitando `ActionDialog`/`useAdminAction`.

## Fica com quem constrói

Nomes de rotas e componentes, mensagens de erro, o desenho fino do diálogo, e conferir com `crm.item.fields` no SPA 1142 se há outro campo obrigatório para criar o item.
