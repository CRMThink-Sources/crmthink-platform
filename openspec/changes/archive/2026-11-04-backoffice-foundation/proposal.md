## Why

A plataforma só é operada por `curl` contra `/admin/*`, com um token estático compartilhado e uma allowlist de IP no Caddy. Assim não dá para saber quem fez cada ação, o suporte não tem acesso e faltam leituras básicas: não existe listagem nem detalhe de instalações, nem histórico por cliente, e as listagens atuais param em 100 itens sem paginação. Esta mudança é a base do backoffice em React (mudanças seguintes `backoffice-ui` e `backoffice-actions`): identidade por pessoa, papéis, auditoria e a API de leitura que a interface vai consumir.

## What Changes

- Contas de operador locais: login com e-mail, senha e TOTP obrigatório. A conta tem papel `viewer` (suporte, só leitura) ou `operator` (dev, leitura e ações). O primeiro operador é criado por script de linha de comando. Não existe cadastro público.
- Sessão por cookie (`httpOnly`, `Secure`, `SameSite=Strict`) com expiração por inatividade e por tempo máximo. Mutações exigem `Origin` da própria plataforma. Login tem limite de tentativas e bloqueio temporário da conta.
- Gestão de operadores em `/admin/operators` (só `operator`): criar, desativar, trocar papel, redefinir senha e TOTP.
- `/admin/*` passa a aceitar dois tipos de credencial: a sessão de operador, ou um token de `ADMIN_API_TOKENS` para scripts. O token conta como ator `token:<prefixo>` com papel `operator`.
- **BREAKING (operação)**: sai a allowlist de IP (`ADMIN_ALLOWED_IPS`) de `/admin/*` no Caddy. A proteção passa a ser credencial, papel, limite de tentativas e auditoria.
- Trilha de auditoria: toda mutação em `/admin/*` e todo evento de login (sucesso, falha, bloqueio, logout) gera um registro com ator, ação, alvo, resultado, IP e data. Segredos nunca entram no registro. Consulta em `GET /admin/audit`.
- API de leitura nova, com paginação por cursor:
  - `GET /admin/installations`, com filtros por app, status e domínio;
  - `GET /admin/installations/{id}`, com detalhe, saúde dos tokens e assinatura corrente;
  - `GET /admin/installations/{id}/timeline`, com histórico da instalação: tentativas de instalação, eventos enviados ao app com as entregas, compras e ações de operador;
  - `GET /admin/overview`, com contadores para o painel.
- **BREAKING (operação)**: `GET /admin/events` e `GET /admin/stripe-events` trocam o limite fixo de 100 por paginação por cursor (`items` + `nextCursor`) e ganham filtros (período, tipo, instalação). Quem lê só `items` continua funcionando.
- Contrato de operador (`openapi-admin.json`) documenta o novo esquema de segurança por sessão e as novas rotas.

## Capabilities

### New Capabilities
- `operator-auth`: contas de operador, login com senha e TOTP, sessão, limite de tentativas, papéis e autorização por papel em `/admin/*`, convivência com os tokens de script e gestão de operadores.
- `admin-audit`: registro e consulta da trilha de auditoria de ações e logins de operador.
- `admin-read-api`: leituras de operador para o backoffice: instalações (lista, detalhe e timeline), painel de contadores e paginação das listagens de eventos.

### Modified Capabilities
- `api-reference`: o requisito "Esquemas de segurança descritos" passa a declarar o esquema `adminSession` (cookie de sessão de operador) ao lado de `adminToken` em `/admin/*`. As rotas de login ficam sem autenticação e com limite de tentativas.
- `technical-documentation`: o requisito de segurança passa a exigir a descrição das contas de operador (hash de senha, TOTP, sessão, limite de tentativas, papéis) e da auditoria.

## Impact

- **Código**:
  - `src/modules/registry/http/auth.ts` (`adminAuth` com sessão ou token e com papel);
  - `src/modules/registry/http/admin-routes.ts` (paginação, autorização por papel);
  - novo módulo `src/modules/backoffice/` (operadores, sessão, auditoria, leituras);
  - `src/app.ts` (montagem das rotas);
  - `src/config/env.ts` (tempos de sessão, limites de login, origem do backoffice).
- **Banco**: tabelas novas de operador, sessão e auditoria (migração Prisma), mais índices de leitura onde a timeline e os filtros precisam.
- **Dependências**: biblioteca de hash argon2id com binário pré-compilado. O TOTP usa `node:crypto`, sem dependência nova.
- **Infra**: remover o bloco `@admin` do `ops/droplet/Caddyfile` e `ADMIN_ALLOWED_IPS` do deploy.
- **Operação**: novo script `yarn admin:create-operator`. O runbook ganha a criação de operadores, a recuperação de TOTP e a consulta da auditoria.
- **Docs**: `docs/api/openapi-admin.json`, `docs/technical/security.md`, `docs/technical/data-model.md`, `docs/technical/configuration.md`, `docs/operations/runbook.md`.
