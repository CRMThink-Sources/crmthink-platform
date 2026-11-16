# Spec Delta

## ADDED Requirements

### Requirement: Webhook de pagamento e integrações no contrato
O contrato MUST documentar `POST /webhooks/payments` com o esquema de segurança `paymentIntegrationKey` (Bearer com a chave de uma integração de pagamento), o corpo e a resposta de sucesso, e os códigos de erro que a rota pode devolver, e MUST documentar as rotas `/admin/payment-integrations` com os esquemas de operador, o papel mínimo e a exigência de motivo de cada operação. A resposta de criação e a de rotação MUST declarar o campo da chave como exibido uma única vez. Os códigos novos MUST constar no catálogo de erros.

#### Scenario: Operação documentada
- **WHEN** o contrato é gerado
- **THEN** `POST /webhooks/payments` aparece com `paymentIntegrationKey` e os códigos `INTEGRATION_INACTIVE`, `NOT_MANUAL_SUBSCRIPTION`, `SUBSCRIPTION_NOT_RENEWABLE`, `EXTERNAL_ID_REUSED` e `INVALID_PERIOD`

#### Scenario: Contrato em dia
- **WHEN** a rota ou o catálogo de erros mudam sem regenerar os arquivos versionados
- **THEN** os testes falham, como nas demais operações
