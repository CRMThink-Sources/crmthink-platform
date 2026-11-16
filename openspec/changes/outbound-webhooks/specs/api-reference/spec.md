# Spec Delta

## ADDED Requirements

### Requirement: Destinatários de eventos no contrato
O contrato MUST documentar as rotas `/admin/webhook-endpoints` e `/admin/webhook-deliveries`, com os esquemas de operador, o papel mínimo, a exigência de motivo de cada operação e os códigos de erro que podem devolver, e MUST declarar o segredo como exibido uma única vez nas respostas de criação e de rotação. O contrato MUST documentar, na seção `webhooks`, o que um destinatário recebe: o mesmo envelope e os mesmos cabeçalhos de assinatura dos eventos dos apps, a verificação do HMAC e a resposta esperada (`2xx`). Os códigos novos MUST constar no catálogo de erros.

#### Scenario: Operação documentada
- **WHEN** o contrato é gerado
- **THEN** as rotas de destinatários e de entregas aparecem com os papéis e os códigos `WEBHOOK_ENDPOINT_NOT_FOUND`, `WEBHOOK_DELIVERY_NOT_FOUND`, `WEBHOOK_URL_NOT_ALLOWED` e `WEBHOOK_APP_UNKNOWN`

#### Scenario: O que o destinatário recebe
- **WHEN** um integrador abre a seção `webhooks` do contrato
- **THEN** encontra o envelope, os cabeçalhos `X-Platform-*` e como verificar a assinatura com o segredo do destinatário
