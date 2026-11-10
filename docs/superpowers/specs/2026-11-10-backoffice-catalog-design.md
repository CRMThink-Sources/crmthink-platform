# Catálogo no backoffice: produtos e planos — design

## Intenção e porquê

Produtos (SPA 1134) e planos (SPA 1138) moram no portal Bitrix da CRMThink. A plataforma só os **lê** (`CatalogRepository`, com cache). Hoje, para cadastrar um app o operador digita os **ids** dos produtos (`productSpaIds`), e para criar ou ajustar um produto ou plano precisa entrar no Bitrix e editar o SPA à mão, inclusive colando o id do preço do Stripe no campo certo. Isso gera erro (id errado, plano sem preço que a plataforma então não oferece) e não deixa rastro.

O backoffice passa a ser o lugar de **ver, criar, editar, desativar e excluir** produtos e planos, e o cadastro do app passa a **escolher** os produtos numa lista.

## Metas

- Seleção de produtos no cadastro e na edição do app, no lugar dos ids digitados.
- CRUD de produtos e planos no backoffice, gravando nos SPAs 1134 e 1138.
- Cada alteração é auditada como as outras ações do backoffice: autor, rota, alvo (`product`/`plan` e o id), motivo e o corpo da requisição mascarado. **Não** há antes/depois: a auditoria de hoje não guarda isso, e estendê-la mexeria em todas as rotas de `/admin` (fora do escopo; minha decisão).
- Nunca perder dado: o que está em uso não é excluído, só desativado.

## Não-metas

- Criar ou validar o preço no Stripe. O operador cria o preço no Stripe e **cola o id** (`price_...`) no formulário do plano. Não há chamada ao Stripe.
- Mexer na definição dos campos ou dos enums dos SPAs (isso continua sendo do dono do portal; a conferência de campos no boot, `spa-field-guards`, segue valendo).
- Importação em lote, histórico de versões, restaurar o que foi excluído, mover um plano para outro produto.
- Validar na API de apps se os ids de produto existem (hoje não valida; fica como está).

## Antimetas (falha mesmo funcionando)

- Excluir produto ou plano com assinatura, app ou instalação dependendo dele.
- Plano pago que a plataforma não oferece por falta de preço sem que o operador seja avisado.
- Escrita "bem-sucedida" no Bitrix que na verdade descartou o campo (o `crm.item.update` aceita campo desconhecido em silêncio).

## O que ficou decidido (pelo dono)

- **Estrutura B:** um item novo **Catálogo** no menu, grupo Operação. A tela é a lista de **produtos**; cada produto mostra seus **planos** logo abaixo, com "Novo plano neste produto". Ações por linha (editar, desativar, excluir).
- **Cadastro do app:** a seleção de produtos é uma lista com caixas de marcar (nome, id, tipo da cobrança, estado), com "Criar produto" que abre o cadastro sem sair do formulário.
- **Preço do plano:** campos para **colar** o id do preço do Stripe, um de homologação e outro de produção.
- **Exclusão:** o que está em uso **não se exclui**; a tela mostra o que o usa e oferece **desativar**. O que nunca foi usado se exclui digitando o nome para confirmar e informando o motivo.
- **Escrita só na produção.** Homologação e produção dividem o portal e os SPAs, mas cada instância tem o seu banco, e os vínculos "app usa produto" e o plano de trial de cada app ficam no banco da própria instância: uma exclusão feita na homologação não enxergaria o uso na produção. Por isso o catálogo só **grava** quando `PLATFORM_ENVIRONMENT=production`; na homologação ele **só lê** (lista, uso, seleção no cadastro do app). Qualquer escrita lá responde 409 `CATALOG_READ_ONLY` e a tela mostra um aviso no lugar dos botões.
- **Item em uso: três edições bloqueadas** (409, com o que usa e a orientação "crie um plano novo e desative este"):
  - trocar ou apagar o id de preço do Stripe de um plano com assinaturas;
  - ligar ou desligar a chave de trial de um plano em uso (com assinaturas, ou como plano de trial de um app);
  - mudar o modelo de cobrança de um produto que tem planos.
  Continuam livres: nome, valor de referência e estado (desativar segue sendo ação de alto impacto).
- Aprovados no mockup: formulário de plano (nome, valor de referência, intervalo, chave de trial, os dois preços, ativo), formulário de produto curto (nome, modelo de cobrança, ativo), e os dois avisos de exclusão.

## Decisões minhas (a conferir)

- **Permissão:** `viewer` vê o catálogo e não vê botões; escrever é `operator`. Toda escrita é auditada com alvo `product`/`plan`. Excluir e desativar são ações de alto impacto (exigem motivo, `X-Admin-Reason`); criar e editar sem desativar, não.
- **Valor do plano:** o operador digita em reais; grava em **centavos** (como o portal já guarda, `Plan.amount`). É só referência: quem cobra é o preço do Stripe.
- **Trial:** chave "Plano de trial (sem cobrança)" que esconde os preços e grava o plano **sem preço nos dois ambientes**, que é como a plataforma reconhece trial (`isTrial`).
- **Compra única:** produto com modelo "Compra única" só aceita planos **sem intervalo**; os demais exigem intervalo (mensal, trimestral, semestral, anual). O produto de um plano não muda depois de criado.
- **Produto com planos** não se exclui: primeiro os planos.
- **Em uso**, para decidir se pode excluir:
  - produto: vinculado a algum app (`app_product`) ou com qualquer plano;
  - plano: com qualquer assinatura (SPA 1142, campo `ufCrm91Plan`), ou usado como `trialPlanId` de um app.
- Na mesma lógica dos três bloqueios, **mudar o intervalo** de um plano com assinaturas também é bloqueado. E **preencher** um preço que estava vazio (por exemplo, o de produção que ainda faltava) é sempre permitido, mesmo com o plano em uso.
- "Em uso" conta as assinaturas (SPA 1142) de **todos** os ambientes; as telas mostram o total e quantas estão ativas.
- O formato do id do preço é validado (`price_` + letras e números); a existência no Stripe não.
- A leitura do catálogo para o backoffice vem **direto do Bitrix**, sem o cache de 5 minutos, e mostra também planos e produtos **inativos** e os **mal cadastrados** (marcados com o problema, em vez de sumirem como no catálogo público).

## Como funciona (esboço)

- **API** (em `/admin`, rotas e papéis em `backoffice/http/policy.ts`, contrato em `src/docs/openapi`):
  - `GET /admin/catalog/products`: produtos com seus planos aninhados, "usado por N apps" no produto.
  - `POST /admin/catalog/products`, `PATCH /admin/catalog/products/:id`, `DELETE /admin/catalog/products/:id`.
  - `POST /admin/catalog/products/:productId/plans`, `PATCH /admin/catalog/plans/:id`, `DELETE /admin/catalog/plans/:id`.
  - `GET /admin/catalog/plans/:id/usage` e `GET /admin/catalog/products/:id/usage`: o que usa o item (assinaturas totais e ativas, apps), para a tela explicar por que não dá para excluir.
  - A lista devolve `writable` (falso fora da produção) para a tela esconder os botões e mostrar o aviso (minha decisão; o builder pode escolher outro jeito de a tela saber).
  - Erros novos: `PRODUCT_IN_USE`, `PLAN_IN_USE` (409, com o que usa; valem para excluir **e** para as edições bloqueadas), `CATALOG_READ_ONLY` (409), `PLAN_INVALID_FOR_PRODUCT` (intervalo x compra única), e falha de escrita no Bitrix (502).
- **Escrita:** serviço novo no módulo de billing usando `BitrixRestClient.addItem/updateItem/deleteItem` com os códigos de campo e ids de enum de `SpaConfig` (modelo de cobrança 13605 Padrão, 13607 Por unidade, 14455 Compra única; intervalo 13609 a 13615). Depois de gravar, **relê o item** para confirmar que os campos pegaram, e invalida o cache do catálogo (`invalidateProduct`/`invalidatePlan`) na hora.
- **Web** (`web/backoffice`): item `Catálogo` no menu, rota `/catalog`, tabela de produtos com planos aninhados e diálogos de produto, plano e exclusão reaproveitando `ActionDialog`/`useAdminAction`; no formulário de app, o campo de ids vira seleção. App com id de produto que o catálogo não encontra mostra "produto #id (não encontrado)" e **preserva** o id.
- **Docs:** contrato OpenAPI e catálogo de erros regerados, runbook (como o catálogo é gerido agora).

## Restrições

- O Bitrix não é transacional: criar plano e depois falhar na releitura deixa um item órfão; a resposta de erro diz o id criado.
- Limites de taxa do Bitrix: a listagem do catálogo é pequena e sem paginação na tela.
- Ambientes: homologação e produção usam o **mesmo portal e os mesmos SPAs**; os dois campos de preço existem para isso. A escrita só roda na produção (ver "O que ficou decidido"); quem testar na homologação testa a leitura, a seleção e os avisos, e a escrita contra o portal só na produção ou com um portal de teste.

## Antes de congelar os formulários (primeira tarefa de quem constrói)

Os formulários aprovados trazem só os campos que a plataforma lê. Quem constrói confere no portal, com uma chamada `crm.item.fields` em cada SPA, se existe **outro campo obrigatório** (responsável, estágio, categoria, moeda, algo próprio do modelo "Por unidade") e se o webhook de entrada pode **criar e excluir** itens nos SPAs 1134 e 1138. Se houver, ajusta os formulários (valor padrão ou campo novo) e avisa o dono; se o webhook não puder escrever, para e avisa antes de seguir.

## Fica com quem constrói

Nomes exatos de rotas e de componentes, o desenho fino dos diálogos, como agrupar as leituras do Bitrix para a listagem, e a mensagem exata dos erros.
