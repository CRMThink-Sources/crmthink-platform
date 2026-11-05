## MODIFIED Requirements

### Requirement: Segurança e dados
A documentação técnica MUST descrever os mecanismos de segurança (hash da chave de API, tokens de operador, contas de operador com hash argon2id e TOTP, sessão de operador por cookie e suas expirações, checagem de `Origin`, limite de tentativas e bloqueio de login, papéis `viewer` e `operator`, trilha de auditoria e o que ela nunca guarda, cifragem AES-256-GCM e formato `v1:`, HMAC dos webhooks e janela de 5 minutos, rotação com carência, assinatura e verificação do JWT, verificação do Stripe, CORS da sessão, o que nunca é logado) e o modelo de dados (cada modelo Prisma, propósito, relações e dados sensíveis cifrados), com diagrama entidade-relacionamento.

#### Scenario: Auditoria de segredos
- **WHEN** um auditor pergunta onde e como `client_secret` e tokens do Bitrix são guardados
- **THEN** o documento de segurança indica os campos cifrados, o algoritmo, a origem da chave (`TOKEN_ENCRYPTION_KEY`) e o comportamento sem chave

#### Scenario: Acesso de operador
- **WHEN** um auditor pergunta como alguém entra no backoffice e como saber quem fez uma ação
- **THEN** o documento de segurança descreve login com senha e TOTP, sessão, bloqueio, papéis, o uso dos tokens de script e onde consultar a trilha de auditoria
