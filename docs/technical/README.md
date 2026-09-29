# Documentação técnica do crmthink-platform

Para quem **mantém e opera** a plataforma. Times de app começam por
[`docs/apps-integration.md`](../apps-integration.md) e pela referência da API.

## Referência da API

- Navegável: `https://<plataforma>/docs` (servida pela própria API).
- Arquivos: [`docs/api/openapi.json`](../api/openapi.json) (apps) e
  [`docs/api/openapi-admin.json`](../api/openapi-admin.json) (completo, com rotas de operador;
  não é servido pela API).
- Gerados por `yarn docs:openapi` a partir de `src/docs/`. Testes falham se uma rota, um
  código de erro, um tipo de evento ou uma variável de ambiente ficar sem documentação, ou se
  os arquivos versionados estiverem desatualizados. Ver [Manter a documentação](#manter-a-documentação).

## Ordem de leitura

| # | Documento | Resumo |
| --- | --- | --- |
| 1 | [architecture.md](architecture.md) | Processos `api` e `worker`, módulos, portas, `bootstrap` e `container` |
| 2 | [request-lifecycle.md](request-lifecycle.md) | Caminho de uma requisição HTTP: request id, parsers, autenticação, erros |
| 3 | [security.md](security.md) | Credenciais, cifragem, assinaturas HMAC, JWT, CORS, o que nunca vai para o log |
| 4 | [data-model.md](data-model.md) | Tabelas (Prisma/MySQL), relações e o que mora nos SPAs do portal CRMThink |
| 5 | [installation-and-tokens.md](installation-and-tokens.md) | Instalação no Bitrix24, instalador do app, desinstalação e cofre de tokens |
| 6 | [iframe-session.md](iframe-session.md) | `POST /v1/sessions`, JWT, JWKS e rotação de chave |
| 7 | [billing.md](billing.md) | Checkout, webhooks Stripe, espelho nos SPAs, trial, itens, compras, reembolsos, varreduras |
| 8 | [async-processing.md](async-processing.md) | Filas BullMQ, agendamentos, outbox e entrega de eventos aos apps |
| 9 | [observability.md](observability.md) | Logs, métricas, health checks e alertas |
| 10 | [configuration.md](configuration.md) | Todas as variáveis de ambiente |
| 11 | [error-codes.md](error-codes.md) | Catálogo de códigos de erro (gerado) |

Procedimentos de operação (provisionamento, TLS, incidentes) estão em
[`docs/operations/runbook.md`](../operations/runbook.md).

## Manter a documentação

| Mudança | O que atualizar |
| --- | --- |
| Rota nova ou alterada | Entrada em `src/docs/openapi/operations.ts` (+ schema de resposta em `responses.ts`); `yarn docs:openapi` |
| Campo novo em resposta | Schema em `src/docs/openapi/responses.ts` (são `strictObject`: o teste de integração acusa o campo) |
| Código de erro novo | `src/docs/errors.ts` + `errors` da operação; `yarn docs:openapi` |
| Tipo de evento novo | `EVENT_DATA` em `src/docs/openapi/events.ts`; `yarn docs:openapi` (+ `EVENT_TYPES` em `sdk/typescript/test/contract.test.ts`) |
| Rota nova com chave de app | Além do contrato, entrada em `OPERATIONS` e método em `sdk/typescript/src/client.ts` |
| Qualquer mudança em `docs/api/openapi.json` | `yarn sdk:types` no mesmo PR (o teste de deriva do SDK falha sem isso) |
| Variável de ambiente nova | Tabela em [configuration.md](configuration.md) |
| Fluxo ou decisão de arquitetura | Documento correspondente desta pasta |

Os testes em `src/docs/openapi/*.test.ts` fazem a conferência; além deles, toda chamada
`http(h)` dos testes de integração confere a resposta com o contrato (`src/test/app.ts`).
