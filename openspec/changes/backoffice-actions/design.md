## Context

- As rotas de ação já existem em `/admin/*` (apps, rotação de chaves, trial, reenvio, varreduras, chave do JWT) e, com `backoffice-foundation`, também a gestão de operadores, os papéis e a auditoria. Esta mudança acrescenta pouco à API e põe a interface sobre ela.
- `EventDelivery.resend` faz `updateMany` direto, sem contagem prévia nem limite. O seletor por filtro exige `appCode`.
- `TokenVault` renova sob demanda só a partir de um token recusado (`refreshOnDemand`) e em lote pelos vencidos (`refreshDue`), ambos com trava por instalação (`refreshLocked`).

## Goals / Non-Goals

**Goals:**
- Nenhuma ação sem confirmação e nenhuma ação de alto impacto sem motivo, nos dois lados: a API recusa e a interface pede.
- Segredos devolvidos pela API aparecem uma vez e não ficam em lugar nenhum do navegador.

**Non-Goals:**
- Fluxo de aprovação por dois operadores (quatro olhos).
- Editar dados de cobrança ou assinatura. A fonte da verdade continua no Stripe e nos SPAs.
- Reprocessar `StripeEvent` pela interface. Fica para depois, se o volume pedir.
- Desfazer ações.

## Decisions

### 1. Motivo por header, gravado pela auditoria
`X-Admin-Reason` é lido pelo middleware de auditoria (`backoffice-foundation`) e salvo no `summary.reason`. O header vale para qualquer mutação, sem mudar o corpo das rotas existentes nem o SDK. A obrigatoriedade fica no mesmo mapa de metadados por operação que define o papel (`highImpact: true`). O middleware recusa com 400 `REASON_REQUIRED` antes do handler, e o teste de paridade garante que toda operação marcada no contrato também é aplicada.
- Alternativa: campo `reason` no corpo. Recusada porque mudaria o schema de todas as rotas e misturaria metadado de auditoria com dado de domínio.

### 2. Reenvio com `dryRun` e limite
`resend` passa a montar o `where` uma vez e:
- com `dryRun`, roda `count` e `findMany({ take: 5, select: eventId })`;
- sem `dryRun`, roda `count` e, acima de 5000, recusa com 422 `RESEND_TOO_LARGE`; abaixo, segue com o `updateMany` atual.

O seletor por filtro passa a ser `appCode` e/ou `installationId` (pelo menos um), validado no zod. O limite fica em constante, não em env: é proteção e não ajuste fino.

### 3. Renovação forçada reutilizando a trava
Novo `TokenVault.forceRefresh(installationId)`, que chama `refreshLocked` sem a checagem de token recusado e conta falhas como a renovação agendada. A resposta usa o mesmo cálculo de saúde da leitura (`ok`, `refresh_failing`, `missing`), sem token. O erro do Bitrix vira 502 `TOKEN_REFRESH_FAILED`, com `details.reason` vindo da resposta OAuth (ex.: `invalid_grant`).

### 4. Padrão de ação no web
Um hook `useAdminAction({ mutation, invalidates, highImpact, confirmText })` cuida de:
- abrir o `ActionDialog` (shadcn `AlertDialog`) com alvo, efeito, motivo e confirmação por digitação;
- enviar `X-Admin-Reason`;
- em sucesso, `toast` e `queryClient.invalidateQueries` das chaves afetadas (detalhe, timeline, listas, overview);
- em erro, manter o diálogo aberto e mostrar `ApiError`.

O mapa ação × queries invalidadas fica junto do hook, para ser revisado num lugar só.

### 5. Segredos fora do cache
As mutações que devolvem segredo usam `useMutation` com `gcTime: 0` e o resultado vai só para o estado local do `SecretRevealDialog`, que é desmontado ao fechar. O dialog bloqueia fechar por clique fora ou `Esc` até "Guardei". Nada passa por `console.*`. Um lint (`no-console`) já cobre isso no web. O QR code é gerado com uma biblioteca local (ex.: `qrcode`, para canvas/SVG), sem rede, e é compatível com a CSP de `backoffice-ui`.

### 6. Formulários de app
`react-hook-form` + `zodResolver`, com schemas escritos no web a partir dos tipos gerados. Não compartilhamos o zod da API porque o web é um pacote isolado. Para evitar divergência de regras, a API continua sendo a validação final, e os `details` de `VALIDATION_ERROR` são mapeados por `path` para os campos. A edição calcula o diff com os valores iniciais e envia só os campos alterados no `PATCH`. A pré-visualização do tema reusa o mesmo CSS da página de instalação, copiado em `web/backoffice/src/features/apps/install-preview.css` com um teste de deriva contra o template do servidor.

### 7. Onde cada ação aparece
```
Instalação (detalhe)   Conceder trial · Renovar token · Reenviar eventos desta instalação
Eventos (lista/painel) Reenviar este · Reenviar todos do filtro (dry-run → confirmar)
Apps (detalhe)         Editar · Ativar/Desativar · Rotacionar chave · Rotacionar segredo
Apps (lista)           Cadastrar app
Sistema (nova tela)    Rodar varredura Stripe/SPA · Rotacionar chave do JWT
Operadores (nova tela) Criar · Trocar papel · Ativar/Desativar · Redefinir acesso
```

## Risks / Trade-offs

- [Reenvio em lote dispara muitos webhooks para um app] → dry-run obrigatório na interface, limite de 5000 e confirmação com a quantidade. A entrega continua com o ritmo e as tentativas do worker.
- [Validação duplicada web × API diverge] → a API é a regra final e os erros dela aparecem no campo. A divergência só piora a experiência, não a segurança.
- [Cópia do CSS da página de instalação para a pré-visualização] → teste de deriva. Se o tema crescer, extrair para um pacote comum.
- [Renovação forçada repetida conta como falhas e pode marcar a instalação] → a renovação usa a mesma trava e as mesmas regras da agendada, e a ação fica auditada.

## Migration Plan

1. Implantar depois de `backoffice-ui`. As mudanças de API são aditivas. `REASON_REQUIRED` passa a valer também para scripts que chamam ações de alto impacto: o runbook ganha o header nos exemplos de `curl`.
2. O rollback é a imagem anterior. Nenhuma migração de dados.
