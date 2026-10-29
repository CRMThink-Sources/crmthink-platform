/**
 * Gerado por `yarn gen:api` a partir de `docs/api/openapi-admin.json`. Não edite à mão.
 */
export interface paths {
    "/.well-known/jwks.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Chaves públicas do JWT de sessão
         * @description Inclui a chave ativa, a próxima (rotação agendada) e as anteriores ainda válidas. Cache de 5 minutos.
         */
        get: operations["getJwks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/apps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar aplicações cadastradas
         * @description **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["listApps"];
        put?: never;
        /**
         * Cadastrar aplicação
         * @description **`apiKey` e `webhookSecret` só aparecem nesta resposta.** A chave é guardada só como hash; o segredo e o `client_secret` ficam cifrados.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["createApp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/apps/{appCode}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalhes de uma aplicação
         * @description **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["getApp"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Alterar aplicação
         * @description **Papel mínimo:** `operator`.
         */
        patch: operations["updateApp"];
        trace?: never;
    };
    "/admin/apps/{appCode}/rotate-api-key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotacionar chave de API
         * @description A chave anterior vale até `previousValidUntil` (`CREDENTIAL_ROTATION_GRACE_HOURS`). A nova só aparece nesta resposta.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["rotateApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/apps/{appCode}/rotate-webhook-secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotacionar segredo de webhook
         * @description Durante a carência os webhooks levam duas assinaturas `v1=`. O novo segredo só aparece nesta resposta.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["rotateWebhookSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Trilha de auditoria do backoffice, paginada
         * @description Do mais recente para o mais antigo. Registra toda mutação em `/admin/*` (inclusive as negadas) e os eventos de acesso (`auth.*`). Os registros não podem ser alterados nem apagados.
         *
         *     **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["listAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Entrar no backoffice (e-mail, senha e TOTP)
         * @description Define o cookie de sessão `cp_admin_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/admin`). Qualquer falha responde `INVALID_CREDENTIALS`, sem dizer qual fator falhou. Após 5 falhas em 15 min a conta fica bloqueada por 15 min; mais de 20 tentativas por IP em 15 min respondem 429 com `Retry-After`. Com `Origin`, ele precisa estar em `BACKOFFICE_ORIGINS`.
         */
        post: operations["operatorLogin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sair (revoga a sessão)
         * @description **Papel mínimo:** qualquer sessão de operador.
         */
        post: operations["operatorLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Quem está autenticado (operador da sessão ou token de script)
         * @description **Papel mínimo:** qualquer sessão de operador.
         */
        get: operations["whoAmI"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/auth/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Trocar a própria senha
         * @description Exige a senha atual; a nova tem ao menos 12 caracteres. Libera a conta com senha provisória e derruba as outras sessões dela.
         *
         *     **Papel mínimo:** qualquer sessão de operador.
         */
        post: operations["changeOwnPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Eventos enviados aos apps (outbox), paginados
         * @description Do mais recente para o mais antigo, com as 3 tentativas de entrega mais recentes de cada evento.
         *
         *     **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["listOutboxEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/events/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reenviar eventos (um `eventId` ou uma janela por app)
         * @description Reabre a janela de reenvio de 24 h dos eventos selecionados.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["resendEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/installations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Instalações de todos os apps, paginadas
         * @description **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["listAdminInstallations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/installations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalhe da instalação (contato, saúde do token, eventos e assinatura)
         * @description Nunca devolve tokens. A assinatura vem do portal CRMThink: se ele falhar ou passar de 3 s, `subscription` vem com `available: false` e o motivo, e o resto sai normalmente.
         *
         *     **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["getAdminInstallation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/installations/{id}/attempts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Passos registrados da instalação (50 mais recentes)
         * @description **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["listInstallAttempts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/installations/{id}/timeline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Linha do tempo da instalação, paginada
         * @description Junta, do mais recente para o mais antigo: tentativas de instalação, eventos enviados ao app (com as 5 últimas entregas), compras avulsas e ações de operador sobre a instalação. Sem payload completo dos eventos.
         *
         *     **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["getInstallationTimeline"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/installations/{id}/trial": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Iniciar trial manualmente
         * @description Casos excepcionais. Com trial vigente responde `TRIAL_ALREADY_USED`. O contato é opcional; quando enviado, é gravado como na solicitação do app.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["startTrial"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/operators": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar operadores
         * @description **Papel mínimo:** `operator`.
         */
        get: operations["listOperators"];
        put?: never;
        /**
         * Criar operador
         * @description **`temporaryPassword` e `totpUri` só aparecem nesta resposta.** O operador troca a senha no primeiro login.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["createOperator"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/operators/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Trocar papel ou ativar/desativar operador
         * @description Derruba as sessões da conta. Ninguém desativa nem rebaixa a própria conta, e sempre resta ao menos um `operator` ativo.
         *
         *     **Papel mínimo:** `operator`.
         */
        patch: operations["updateOperator"];
        trace?: never;
    };
    "/admin/operators/{id}/reset-access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Redefinir senha e TOTP de um operador
         * @description **`temporaryPassword` e `totpUri` só aparecem nesta resposta.** Desbloqueia a conta e derruba as sessões dela.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["resetOperatorAccess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Contadores do painel do backoffice
         * @description Calculado só com o banco, no máximo a cada 60 s (`computedAt`). Trials que terminam em 7 dias vêm dos eventos `subscription.trial_started` sem ativação ou fim posterior.
         *
         *     **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["getOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/signing-keys/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Gerar nova chave de assinatura do JWT
         * @description A chave entra no JWKS já, mas só passa a assinar após `leadMinutes` — tempo para os apps atualizarem o cache do JWKS.
         *
         *     **Papel mínimo:** `operator`.
         */
        post: operations["rotateSigningKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/stripe-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Eventos Stripe recebidos, paginados (sem payload)
         * @description **Papel mínimo:** `viewer` (leitura).
         */
        get: operations["listStripeEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/stripe-events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Evento Stripe com o payload cru
         * @description **Papel mínimo:** `operator`.
         */
        get: operations["getStripeEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/sweeps/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rodar varredura de reconciliação agora
         * @description **Papel mínimo:** `operator`.
         */
        post: operations["runSweep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/bitrix/events/{appCode}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Eventos de instalação do app Bitrix (`ONAPPINSTALL`, `ONAPPUNINSTALL`)
         * @description Handler cadastrado no app Bitrix. `ONAPPINSTALL` só guarda o `application_token` depois de provar que o `access_token` do evento é deste app no portal; `ONAPPUNINSTALL` compara o `application_token` em tempo constante.
         */
        post: operations["receiveBitrixAppEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/bitrix/spa-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Eventos dos SPAs do portal CRMThink (`ONCRMDYNAMICITEM*`)
         * @description Autenticado pelo `auth[application_token]` do evento (`CRMTHINK_APPLICATION_TOKEN`). Evento reconhecido vai para a fila do worker.
         */
        post: operations["receiveSpaEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/docs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Referência navegável deste contrato */
        get: operations["docsPage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Processo no ar (liveness) */
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Pronto para tráfego (readiness)
         * @description Confere banco, Redis, chave de assinatura ativa e configuração dos SPAs. 503 se qualquer um falhar.
         */
        get: operations["readiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/install/{appCode}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Página de instalação do app no Bitrix24
         * @description URL de instalação cadastrada no app Bitrix. A página lê a autenticação via `BX24.getAuth()` e chama `POST /v1/install`.
         */
        get: operations["getInstallPage"];
        put?: never;
        /**
         * Página de instalação (aberta pelo Bitrix via POST)
         * @description O Bitrix abre o app com POST de formulário; o corpo é ignorado e a resposta é a mesma do GET.
         */
        post: operations["postInstallPage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Métricas Prometheus */
        get: operations["metrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Este contrato (sem rotas de operador) */
        get: operations["openapi"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing-portal-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Link do Customer Portal do Stripe */
        post: operations["createBillingPortalSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/checkout-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Criar sessão do Checkout embutido do Stripe
         * @description `intent=subscribe` para plano `subscription`, `intent=purchase` para plano `one_time` (exige assinatura ativa ou em trial). A conclusão chega pelo evento `subscription.activated`/`purchase.paid`, não pelo navegador.
         */
        post: operations["createCheckoutSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Instalar o app no portal
         * @description Chamado pela página de instalação. Verifica o token no Bitrix (administrador, app e portal corretos), registra a instalação no SPA 1060, guarda os tokens cifrados, registra `ONAPPINSTALL` e `ONAPPUNINSTALL` e chama o instalador do app. Idempotente: repetir retoma sem duplicar. Se o instalador do app falhar, responde `INSTALL_PENDING` com `error`.
         */
        post: operations["install"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/install/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refazer a chamada ao instalador do app
         * @description Só para instalação `INSTALL_PENDING`; exige administrador do portal.
         */
        post: operations["retryInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/installations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Instalação do app em um portal */
        get: operations["listInstallations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/installations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Detalhes de uma instalação do app */
        get: operations["getInstallation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/installations/{id}/subscription": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Assinatura vigente da instalação */
        get: operations["getSubscription"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/installations/{id}/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Access token do Bitrix para a instalação
         * @description Só a plataforma renova tokens. Token a menos de 60 s de vencer é renovado antes de ser entregue. `Cache-Control: no-store`.
         */
        get: operations["getInstallationToken"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/installations/{id}/token/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Renovar o token quando o Bitrix recusou o atual
         * @description Envie o token recusado em `staleAccessToken`. Se outro processo já renovou, devolve o novo sem nova troca (single-flight).
         */
        post: operations["refreshInstallationToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/installations/{id}/trial": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Solicitar trial com dados de contato
         * @description O contato (nome, e-mail, telefone, empresa e cargo) é gravado na instalação e no SPA 1060, e o e-mail passa a ser usado no checkout. Sem trial anterior, cria o trial (201, evento `subscription.trial_started`). Com trial vigente, como o criado por `trial_on_install`, só grava o contato e devolve o trial atual (200). Nos 409 o contato também fica gravado.
         */
        post: operations["requestTrial"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Planos ativos dos produtos do app
         * @description Plano pago sem preço Stripe no ambiente atual não é listado.
         */
        get: operations["listPlans"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Trocar a autenticação do iframe por um JWT da plataforma
         * @description Chamado pelo frontend do app dentro do Bitrix. CORS restrito às origens de `SESSION_CORS_ORIGINS` do `appCode` pedido (o preflight `OPTIONS` aceita qualquer origem configurada). Identidade e admin vêm do Bitrix com o próprio token; campos extras do corpo são descartados. Valide o JWT com o JWKS e `aud` = appCode.
         */
        post: operations["createSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/subscriptions/{id}/change-plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Trocar o plano da assinatura
         * @description Upgrade: imediato, com fatura proporcional; o evento `subscription.plan_changed` sai quando ela é paga. Downgrade: agendado para o próximo ciclo.
         */
        post: operations["changePlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/subscriptions/{id}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Itens da assinatura (SPA 1146) */
        get: operations["listItems"];
        put?: never;
        /**
         * Criar item da assinatura (idempotente por `externalRef`)
         * @description 201 quando cria; 200 com o item existente quando o `externalRef` já existe. Itens `billable` ativos definem a quantidade cobrada no Stripe.
         */
        post: operations["createItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/subscriptions/{id}/items/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remover item (remoção lógica: `status=cancelled`) */
        delete: operations["removeItem"];
        options?: never;
        head?: never;
        /** Alterar item da assinatura */
        patch: operations["updateItem"];
        trace?: never;
    };
    "/webhooks/stripe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Webhook do Stripe
         * @description Corpo cru: a assinatura `Stripe-Signature` é HMAC sobre os bytes. O evento é gravado e processado de forma assíncrona pelo worker.
         */
        post: operations["receiveStripeWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface webhooks {
    "installation.created": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * App instalado no portal pela primeira vez (`subscription: null`).
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.installation.created"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "installation.reinstalled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * App reinstalado em portal que já tinha instalação.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.installation.reinstalled"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "installation.removed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * App removido do portal (`ONAPPUNINSTALL` verificado). Tokens deixam de ser entregues.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.installation.removed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "installation.auth_error": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Renovação do token falhou repetidamente; a instalação vai para `AUTH_ERROR` e precisa ser reinstalada.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.installation.auth_error"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "installation.auth_restored": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reinstalação recuperou uma instalação em `AUTH_ERROR`.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.installation.auth_restored"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.trial_started": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Trial iniciado (na instalação ou manualmente pelo operador).
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.trial_started"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.activated": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assinatura paga ativa (checkout concluído ou manual marcada ativa).
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.activated"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.renewed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Novo período pago.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.renewed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.plan_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Plano trocado (upgrade imediato ou downgrade no próximo ciclo).
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.plan_changed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.past_due": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pagamento da renovação falhou; carência e corte são decisão do app.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.past_due"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.recovered": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pagamento em atraso regularizado.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.recovered"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.cancel_scheduled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancelamento agendado para o fim do período.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.cancel_scheduled"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.ended": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assinatura encerrada.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.ended"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.period_ending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Aviso de fim de período de assinatura `manual` (3, 2 e 1 dia antes).
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.period_ending"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "subscription.item_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Item alterado por uma pessoa no SPA 1146 (alterações via API não geram evento).
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.subscription.item_changed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "purchase.paid": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Compra avulsa paga.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.purchase.paid"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "charge.refunded": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cobrança reembolsada (total ou parcial).
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.charge.refunded"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "charge.disputed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cliente abriu disputa (chargeback) no cartão.
         * @description Entregue em `POST <webhookUrl>`. Pelo menos uma vez, em ordem por instalação; reenvio com backoff por até 24 h, depois dead-letter. Persista, responda 2xx e processe assíncrono; deduplique por `eventId`.
         */
        post: operations["event.charge.disputed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    installer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Instalador do app (chamada síncrona durante a instalação)
         * @description Entregue em `POST <installerUrl>` durante `POST /v1/install`, assinado como os eventos. O app faz os próprios binds no portal usando `GET /v1/installations/{id}/token` e responde 2xx. Falha ou timeout (`INSTALLER_TIMEOUT_MS`) deixa a instalação em `INSTALL_PENDING` até o retry.
         */
        post: operations["installer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface components {
    schemas: {
        AdminInstallation: {
            id: number;
            appCode: string;
            domain: string;
            memberId: string;
            /** @enum {string} */
            status: "INSTALLING" | "INSTALL_PENDING" | "ACTIVE" | "UNINSTALLED" | "AUTH_ERROR";
            /** Format: date-time */
            installedAt: string;
            activatedAt: string | null;
            uninstalledAt: string | null;
            trialUsed: boolean;
            /**
             * @description `missing`: sem credencial; `refresh_failing`: a última renovação falhou
             * @enum {string}
             */
            tokenHealth: "ok" | "refresh_failing" | "missing";
            app: {
                appCode: string;
                name: string;
                active: boolean;
            } | null;
            spaItemId: number | null;
            contact: unknown | null;
            everActivated: boolean;
            pendingReinstall: boolean;
            /** Format: date-time */
            updatedAt: string;
            token: {
                /**
                 * @description `missing`: sem credencial; `refresh_failing`: a última renovação falhou
                 * @enum {string}
                 */
                health: "ok" | "refresh_failing" | "missing";
                /** Format: date-time */
                expiresAt: string;
                refreshFailures: number;
                lastRefreshError: string | null;
                clientEndpoint: string | null;
                /** Format: date-time */
                updatedAt: string;
            } | {
                /** @constant */
                health: "missing";
            };
            events: {
                pending: number;
                delivered: number;
                dead: number;
            };
            subscription: {
                /** @constant */
                available: true;
                /** @description `null`: instalação sem assinatura vigente */
                current: components["schemas"]["CurrentSubscription"] | null;
            } | {
                /** @constant */
                available: false;
                reason: string;
            };
        };
        AdminInstallationPage: {
            items: {
                id: number;
                appCode: string;
                domain: string;
                memberId: string;
                /** @enum {string} */
                status: "INSTALLING" | "INSTALL_PENDING" | "ACTIVE" | "UNINSTALLED" | "AUTH_ERROR";
                /** Format: date-time */
                installedAt: string;
                activatedAt: string | null;
                uninstalledAt: string | null;
                trialUsed: boolean;
                /**
                 * @description `missing`: sem credencial; `refresh_failing`: a última renovação falhou
                 * @enum {string}
                 */
                tokenHealth: "ok" | "refresh_failing" | "missing";
            }[];
            /** @description Envie em `cursor` para a próxima página; `null` na última */
            nextCursor: string | null;
        };
        ApiKeyRotated: {
            apiKey: string;
            /** Format: date-time */
            previousValidUntil: string;
        };
        App: {
            appCode: string;
            name: string;
            logoUrl: string | null;
            installTheme: {
                primaryColor?: string;
                backgroundColor?: string;
                textColor?: string;
                title?: string;
                welcomeText?: string;
                /** Format: uri */
                termsUrl?: string;
                termsText?: string;
            } | null;
            bitrixClientId: string;
            bitrixAppCode: string | null;
            scopes: string[];
            installerUrl: string | null;
            webhookUrl: string | null;
            trialDays: number;
            trialOnInstall: boolean;
            trialPlanId: number | null;
            productSpaIds: number[];
            active: boolean;
        };
        AppCreated: {
            app: components["schemas"]["App"];
            credentials: {
                apiKey: string;
                webhookSecret: string;
            };
            notice: string;
        };
        AppList: {
            items: components["schemas"]["App"][];
        };
        AuditPage: {
            items: {
                id: number;
                /** @description `operator:<id>`, `token:<prefixo>` ou `anonymous` */
                actor: string;
                actorRole: string | null;
                action: string;
                targetType: string | null;
                targetId: string | null;
                statusCode: number | null;
                errorCode: string | null;
                /** @description Resumo com campos sensíveis mascarados */
                summary: unknown;
                ip: string | null;
                userAgent: string | null;
                requestId: string | null;
                /** Format: date-time */
                createdAt: string;
            }[];
            /** @description Envie em `cursor` para a próxima página; `null` na última */
            nextCursor: string | null;
        };
        BillingPortalRequest: {
            installationId: number;
            /** Format: uri */
            returnUrl: string;
        };
        BillingPortalSession: {
            /**
             * Format: uri
             * @description Abrir em aba nova
             */
            url: string;
        };
        BitrixAppEvent: {
            event?: string;
            auth?: {
                application_token?: string;
                member_id?: string;
                domain?: string;
                access_token?: string;
            };
        };
        BitrixAppEventResult: {
            /** @enum {string} */
            handled: "application-token-stored" | "application-token-pending" | "uninstalled" | "already-uninstalled" | "app-inactive" | "ignored";
        };
        ChangePasswordRequest: {
            currentPassword: string;
            newPassword: string;
        };
        ChangePlanRequest: {
            planId: number;
        };
        ChangePlanResult: {
            subscriptionId: number;
            planId: number;
            /** @constant */
            effective: "immediate";
            /** @description Fração restante do período, base da cobrança proporcional */
            remainingFraction: number;
        } | {
            subscriptionId: number;
            planId: number;
            /** @constant */
            effective: "next_period";
            /** Format: date-time */
            effectiveAt: string;
        };
        ChargeDisputedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "charge.disputed";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                chargeId: string;
                disputeId: string;
                /** @enum {string} */
                source: "purchase" | "invoice";
                /** @description Quando `source=purchase` */
                purchaseId?: number;
                /** @description Quando `source=invoice` */
                invoiceId?: string | null;
                amount: number;
                reason: string;
            };
        };
        ChargeRefundedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "charge.refunded";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                chargeId: string;
                /** @enum {string} */
                source: "purchase" | "invoice";
                /** @description Quando `source=purchase` */
                purchaseId?: number;
                /** @description Quando `source=invoice` */
                invoiceId?: string | null;
                /** @description Centavos reembolsados */
                amountRefunded: number;
                /** @description Centavos da cobrança */
                amount: number;
            };
        };
        CheckoutRequest: {
            installationId: number;
            planId: number;
            /** @enum {string} */
            intent: "subscribe" | "purchase";
            quantity?: number;
        };
        CheckoutSession: {
            /** @description Para `initEmbeddedCheckout({ clientSecret })` no frontend */
            clientSecret: string;
            sessionId: string;
            /** @description Só em `intent=purchase` */
            purchaseId?: number;
        };
        CreateAppRequest: {
            appCode: string;
            name: string;
            logoUrl?: string | null;
            installTheme?: {
                primaryColor?: string;
                backgroundColor?: string;
                textColor?: string;
                title?: string;
                welcomeText?: string;
                /** Format: uri */
                termsUrl?: string;
                termsText?: string;
            } | null;
            bitrixClientId: string;
            bitrixClientSecret: string;
            bitrixAppCode?: string | null;
            /** @default [] */
            scopes?: string[];
            installerUrl?: string | null;
            webhookUrl?: string | null;
            /** @default [] */
            productSpaIds?: number[];
            /** @default 0 */
            trialDays?: number;
            /** @default false */
            trialOnInstall?: boolean;
            trialPlanId?: number | null;
            /** @default true */
            active?: boolean;
        };
        CreateItemRequest: {
            externalRef: string;
            title: string;
            metadata?: {
                [key: string]: unknown;
            };
            /** @default false */
            billable?: boolean;
        };
        CreateOperatorRequest: {
            email: string;
            name: string;
            /** @enum {string} */
            role: "viewer" | "operator";
        };
        CurrentSubscription: {
            subscriptionId: number;
            /** @enum {string} */
            status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
            /** @enum {string} */
            modality: "stripe" | "manual";
            plan: {
                id: number;
                name: string;
                interval: ("monthly" | "quarterly" | "semiannual" | "yearly") | null;
                /** @enum {string} */
                type: "subscription" | "one_time";
                amount: number;
            } | {
                id: number;
            };
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
            cancelAtPeriodEnd: boolean;
            trial: {
                used: boolean;
                endsAt: string | null;
            };
            /** @description Cresce a cada decisão; compare com `subscription.version` dos eventos */
            version: number;
        };
        Error: {
            error: {
                /** @description Código estável; decida por ele, nunca pela mensagem */
                code: string;
                message?: string;
                /** @description Em `VALIDATION_ERROR`: `[{ path, message }]` */
                details?: unknown;
            };
        };
        Health: {
            /** @constant */
            status: "ok";
        };
        InstallAttemptList: {
            items: ({
                id: number;
                installationId: number;
                step: string;
                status: string;
                error: string | null;
                /** Format: date-time */
                createdAt: string;
            } & {
                [key: string]: unknown;
            })[];
        };
        InstallOutcome: {
            installationId: number;
            /** @enum {string} */
            status: "ACTIVE" | "INSTALL_PENDING";
            /** @description Motivo quando o instalador do app falhou (`INSTALL_PENDING`) */
            error?: string;
        };
        InstallRequest: {
            appCode: string;
            auth: {
                accessToken: string;
                refreshToken: string;
                expiresIn?: number;
                memberId: string;
                domain: string;
            };
            /** @constant */
            acceptedTerms: true;
        };
        InstallRetryRequest: {
            appCode: string;
            auth: {
                accessToken: string;
                memberId: string;
                domain: string;
            };
        };
        Installation: {
            installationId: number;
            appCode: string;
            memberId: string;
            domain: string;
            /** @enum {string} */
            status: "INSTALLING" | "INSTALL_PENDING" | "ACTIVE" | "UNINSTALLED" | "AUTH_ERROR";
            /** @description `application_token` do Bitrix, para validar eventos que o app recebe */
            applicationToken: string | null;
        };
        InstallationAuthErrorEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "installation.auth_error";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: null;
            data: {
                lastError: string;
                failures: number;
            };
        };
        InstallationAuthRestoredEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "installation.auth_restored";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: null;
            data: Record<string, never>;
        };
        InstallationCreatedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "installation.created";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: null;
            data: Record<string, never>;
        };
        InstallationList: {
            items: components["schemas"]["Installation"][];
        };
        InstallationReinstalledEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "installation.reinstalled";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: null;
            data: Record<string, never>;
        };
        InstallationRemovedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "installation.removed";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: null;
            data: Record<string, never>;
        };
        InstallationTimeline: {
            items: {
                /** @enum {string} */
                kind: "install_attempt" | "event" | "purchase" | "admin_action";
                /** Format: date-time */
                occurredAt: string;
                summary: string;
                ref: {
                    type: string;
                    id: string;
                };
                /** @description Campos do tipo: etapa e erro, tipo e entregas do evento, compra, ação */
                data: {
                    [key: string]: unknown;
                };
            }[];
            /** @description Envie em `cursor` para a próxima página; `null` na última */
            nextCursor: string | null;
        };
        InstallerPayload: {
            installationId: number;
            memberId: string;
            domain: string;
            appCode: string;
            isReinstall: boolean;
        };
        IssuedOperatorAccess: {
            operator: components["schemas"]["Operator"];
            /** @description Senha provisória. Só aparece nesta resposta. */
            temporaryPassword: string;
            /** @description URI `otpauth://` para o app autenticador. Só aparece nesta resposta. */
            totpUri: string;
        };
        Jwks: {
            keys: {
                /** @constant */
                kty: "RSA";
                kid: string;
                /** @constant */
                alg: "RS256";
                /** @constant */
                use?: "sig";
                n: string;
                e: string;
            }[];
        };
        Operator: {
            id: number;
            email: string;
            name: string;
            /** @enum {string} */
            role: "viewer" | "operator";
            active: boolean;
            /** @description Senha provisória: só `POST /admin/auth/password` é permitido */
            mustChangePassword: boolean;
            lockedUntil: string | null;
            lastLoginAt: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        OperatorList: {
            items: components["schemas"]["Operator"][];
        };
        OperatorLoginRequest: {
            email: string;
            password: string;
            code: string;
        };
        OperatorLoginResult: {
            operator: components["schemas"]["Operator"];
            /**
             * Format: date-time
             * @description Fim da validade máxima da sessão; antes disso ela expira após o tempo de inatividade
             */
            expiresAt: string;
        };
        OutboxEventList: {
            items: ({
                eventId: string;
                seq: number;
                appCode: string;
                type: string;
                installationId: number;
                /** @enum {string} */
                status: "pending" | "delivered" | "dead";
                attempts: number;
                /** @description Envelope entregue ao app */
                payload: unknown;
                /** @description Até as 3 tentativas mais recentes */
                deliveries: ({
                    attempt: number;
                    statusCode: number | null;
                    error: string | null;
                } & {
                    [key: string]: unknown;
                })[];
            } & {
                [key: string]: unknown;
            })[];
            /** @description Envie em `cursor` para a próxima página; `null` na última */
            nextCursor: string | null;
        };
        Overview: {
            /** Format: date-time */
            computedAt: string;
            installations: {
                appCode: string;
                status: string;
                count: number;
            }[];
            events: {
                byApp: {
                    appCode: string;
                    pending: number;
                    dead: number;
                }[];
                oldestPendingAt: string | null;
            };
            stripeEvents: {
                failed: number;
                dead: number;
            };
            credentialsRefreshFailing: number;
            trialsEndingSoon: {
                count: number;
                items: {
                    installationId: number;
                    appCode: string;
                    subscriptionId: number | null;
                    /** Format: date-time */
                    trialEndsAt: string;
                }[];
            };
            sweeps: {
                kind: string;
                /** Format: date-time */
                startedAt: string;
                finishedAt: string | null;
                fixed: number;
                errors: number;
            }[];
        };
        PasswordChanged: {
            operator: components["schemas"]["Operator"];
        };
        PlanList: {
            items: {
                id: number;
                productId: number;
                productName: string;
                name: string;
                /** @description Centavos, como cadastrado no CRM (o valor cobrado vem do Stripe) */
                amount: number;
                interval: ("monthly" | "quarterly" | "semiannual" | "yearly") | null;
                /** @enum {string} */
                type: "subscription" | "one_time";
                trial: boolean;
            }[];
        };
        PurchasePaidEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "purchase.paid";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                purchaseId: number;
                planId: number;
                quantity: number;
                chargeId: string | null;
                /** @description Centavos cobrados */
                amount: number;
            };
        };
        Readiness: {
            ok: boolean;
            /** @description `"ok"` ou a mensagem de erro de cada dependência */
            checks: {
                database: string;
                redis?: string;
                signingKey: string;
                spaConfig: {
                    ok: boolean;
                    checkedAt: string | null;
                    problems?: unknown[];
                };
            };
        };
        ResendEventsRequest: {
            /** Format: uuid */
            eventId: string;
        } | {
            appCode: string;
            /** Format: date-time */
            from: string;
            /** Format: date-time */
            to: string;
            onlyDead?: boolean;
            type?: string;
        };
        ResendResult: {
            /** @description Eventos recolocados na fila */
            requeued: number;
        };
        RotateSigningKeyRequest: {
            /** @default 10 */
            leadMinutes?: number;
        };
        Session: {
            /** @description JWT RS256; validar com o JWKS, `aud` = appCode */
            token: string;
            /** Format: date-time */
            expiresAt: string;
            installationId: number;
            user: {
                id: string;
                name: string;
                isAdmin: boolean;
            };
        };
        SessionRequest: {
            appCode: string;
            accessToken: string;
            domain: string;
            memberId: string;
        };
        SigningKeyRotated: {
            kid: string;
            /** Format: date-time */
            activatesAt: string;
        };
        SpaEvent: {
            event?: string;
            data?: {
                FIELDS?: {
                    ID?: string | number;
                    ENTITY_TYPE_ID?: string | number;
                };
            };
            auth?: {
                application_token?: string;
            };
        };
        SpaEventResult: {
            handled: boolean;
        };
        /** @description Evento Stripe, corpo cru assinado */
        StripeEvent: {
            [key: string]: unknown;
        };
        StripeEventDetail: {
            eventId: string;
            type: string;
            appCode: string | null;
            status: string;
            attempts: number;
            error: string | null;
            /** Format: date-time */
            receivedAt: string;
            processedAt: string | null;
            /** @description Evento cru do Stripe */
            payload: unknown;
        };
        StripeEventList: {
            items: {
                eventId: string;
                type: string;
                appCode: string | null;
                status: string;
                attempts: number;
                error: string | null;
                /** Format: date-time */
                receivedAt: string;
                processedAt: string | null;
            }[];
            /** @description Envie em `cursor` para a próxima página; `null` na última */
            nextCursor: string | null;
        };
        StripeWebhookResult: {
            /** @constant */
            received: true;
            /** @enum {string} */
            outcome: "queued" | "duplicate" | "ignored";
        };
        SubscriptionActivatedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.activated";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                /** @description Trial encerrado pela ativação, se havia */
                previousSubscriptionId: number | null;
            };
        };
        SubscriptionCancelScheduledEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.cancel_scheduled";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                /** Format: date-time */
                effectiveAt: string;
            };
        };
        SubscriptionEndedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.ended";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                /** @enum {string} */
                reason: "cancelled" | "trial_expired" | "deleted";
            };
        };
        SubscriptionItem: {
            itemId: number;
            subscriptionId: number;
            externalRef: string | null;
            title: string;
            /** @enum {string} */
            status: "active" | "cancelled";
            billable: boolean;
            metadata: {
                [key: string]: unknown;
            };
            deletedAt: string | null;
        };
        SubscriptionItemChangedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.item_changed";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                /** @enum {string} */
                change: "created" | "updated" | "removed";
                item: components["schemas"]["SubscriptionItem"];
            };
        };
        SubscriptionItemList: {
            items: components["schemas"]["SubscriptionItem"][];
        };
        SubscriptionPastDueEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.past_due";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                invoiceId: string | null;
                /** @description Link da fatura para o cliente pagar */
                hostedInvoiceUrl: string | null;
            };
        };
        SubscriptionPeriodEndingEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.period_ending";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                daysLeft: 3 | 2 | 1;
                /** Format: date-time */
                periodEnd: string;
            };
        };
        SubscriptionPlanChangedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.plan_changed";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                previousPlanId: number;
                planId: number;
                /** @enum {string} */
                effective: "immediate" | "next_period";
                /** @description Só em `immediate`: fração do período cobrada proporcionalmente */
                remainingFraction?: number;
            };
        };
        SubscriptionRecoveredEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.recovered";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: Record<string, never>;
        };
        SubscriptionRenewedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.renewed";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                /** @description `null` em assinatura manual */
                invoiceId: string | null;
                /** Format: date-time */
                previousPeriodEnd: string;
            };
        };
        SubscriptionTrialStartedEvent: {
            /**
             * Format: uuid
             * @description Deduplique por este id
             */
            eventId: string;
            /** @constant */
            type: "subscription.trial_started";
            appCode: string;
            installationId: number;
            memberId: string;
            /** Format: date-time */
            occurredAt: string;
            subscription: {
                id: number;
                /** @enum {string} */
                status: "trialing" | "active" | "past_due" | "cancelled" | "trial_expired";
                /** @enum {string} */
                modality: "stripe" | "manual";
                planId: number;
                /** Format: date-time */
                periodStart: string;
                /** Format: date-time */
                periodEnd: string;
                /** @description Ignore eventos com `version` menor que a última aplicada */
                version: number;
            } | null;
            data: {
                /** Format: date-time */
                trialEndsAt: string;
                trialDays: number;
            };
        };
        SweepResult: {
            fixed: number;
            errors: number;
            /** @description Só na varredura `stripe` */
            checked?: number;
            /** @description `{checked}` na `stripe`; `{since}` (início da janela) na `spa` */
            detail: {
                checked: number;
            } | {
                /** Format: date-time */
                since: string;
            };
        };
        Token: {
            accessToken: string;
            /** Format: date-time */
            expiresAt: string;
            domain: string;
            /** @description Endpoint REST do portal (`https://<domínio>/rest/`) */
            clientEndpoint: string | null;
        };
        TokenRefreshRequest: {
            staleAccessToken: string;
        };
        TrialRequest: {
            name: string;
            /** Format: email */
            email: string;
            phone: string;
            company: string;
            role: string;
        };
        TrialStarted: {
            subscriptionId: number;
            /** Format: date-time */
            trialEndsAt: string;
        };
        UpdateAppRequest: {
            name?: string;
            logoUrl?: string | null;
            installTheme?: {
                primaryColor?: string;
                backgroundColor?: string;
                textColor?: string;
                title?: string;
                welcomeText?: string;
                /** Format: uri */
                termsUrl?: string;
                termsText?: string;
            } | null;
            bitrixClientId?: string;
            bitrixAppCode?: string | null;
            /** @default [] */
            scopes?: string[];
            installerUrl?: string | null;
            webhookUrl?: string | null;
            /** @default [] */
            productSpaIds?: number[];
            /** @default 0 */
            trialDays?: number;
            /** @default false */
            trialOnInstall?: boolean;
            trialPlanId?: number | null;
            /** @default true */
            active?: boolean;
            bitrixClientSecret?: string;
        };
        UpdateItemRequest: {
            /** @enum {string} */
            status?: "active" | "cancelled";
            title?: string;
            metadata?: {
                [key: string]: unknown;
            };
        };
        UpdateOperatorRequest: {
            /** @enum {string} */
            role?: "viewer" | "operator";
            active?: boolean;
        };
        WebhookSecretRotated: {
            webhookSecret: string;
            /** Format: date-time */
            previousValidUntil: string;
        };
        WhoAmI: {
            /** @constant */
            kind: "operator";
            /** @description `operator:<id>`, como na auditoria */
            actor: string;
            /** @enum {string} */
            role: "viewer" | "operator";
            operator: components["schemas"]["Operator"];
        } | {
            /** @constant */
            kind: "token";
            /** @description `token:<prefixo>`, como na auditoria */
            actor: string;
            /** @constant */
            role: "operator";
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getJwks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description JWKS */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Jwks"];
                };
            };
        };
    };
    listApps: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Aplicações */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AppList"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createApp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAppRequest"];
            };
        };
        responses: {
            /** @description Aplicação e credenciais */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AppCreated"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             *     - `TRIAL_CONFIG_INVALID`: `trialOnInstall` sem `trialDays` > 0 ou sem `trialPlanId`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `APP_ALREADY_EXISTS`: Já existe aplicação com este appCode.
             *     - `BITRIX_CLIENT_ID_IN_USE`: O client_id do Bitrix já pertence a outra aplicação cadastrada.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getApp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Código do app */
                appCode: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Aplicação */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["App"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `APP_NOT_FOUND`: appCode não cadastrado ou inativo.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateApp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Código do app */
                appCode: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateAppRequest"];
            };
        };
        responses: {
            /** @description Aplicação atualizada */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["App"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             *     - `TRIAL_CONFIG_INVALID`: `trialOnInstall` sem `trialDays` > 0 ou sem `trialPlanId`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `APP_NOT_FOUND`: appCode não cadastrado ou inativo.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `BITRIX_CLIENT_ID_IN_USE`: O client_id do Bitrix já pertence a outra aplicação cadastrada.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    rotateApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Código do app */
                appCode: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Nova chave */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyRotated"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `APP_NOT_FOUND`: appCode não cadastrado ou inativo.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    rotateWebhookSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Código do app */
                appCode: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Novo segredo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookSecretRotated"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `APP_NOT_FOUND`: appCode não cadastrado ou inativo.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listAudit: {
        parameters: {
            query?: {
                /** @description Itens por página (1 a 200, padrão 50) */
                limit?: number;
                /** @description `nextCursor` da página anterior */
                cursor?: string;
                /** @description `operator:<id>`, `token:<prefixo>` ou `anonymous` */
                actor?: string;
                /** @description Ex.: `POST /admin/apps/:appCode/rotate-api-key` ou `auth.login_failed` */
                action?: string;
                /** @description Ex.: `app`, `installation`, `operator` */
                targetType?: string;
                /** @description Id do alvo */
                targetId?: string;
                /** @description Só sucessos ou só falhas */
                result?: "success" | "failure";
                /** @description Início (ISO 8601 ou `AAAA-MM-DD`) */
                from?: string;
                /** @description Fim (ISO 8601, ou `AAAA-MM-DD` incluindo o dia inteiro) */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Registros */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditPage"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    operatorLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OperatorLoginRequest"];
            };
        };
        responses: {
            /** @description Operador e validade da sessão */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatorLoginResult"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `INVALID_CREDENTIALS`: Login do backoffice recusado: e-mail, senha ou código TOTP errados, conta inativa ou bloqueada. O motivo não é revelado.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Muitas requisições
             *     - `TOO_MANY_REQUESTS`: Limite de tentativas de login por IP excedido (20 em 15 min).
             */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    operatorLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sessão revogada e cookie apagado */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /**
             * @description Requisição inválida
             *     - `SESSION_REQUIRED`: Rota exclusiva de sessão de operador chamada com token de script.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    whoAmI: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ator */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WhoAmI"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    changeOwnPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePasswordRequest"];
            };
        };
        responses: {
            /** @description Operador atualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordChanged"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             *     - `SESSION_REQUIRED`: Rota exclusiva de sessão de operador chamada com token de script.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             *     - `INVALID_CREDENTIALS`: Login do backoffice recusado: e-mail, senha ou código TOTP errados, conta inativa ou bloqueada. O motivo não é revelado.
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listOutboxEvents: {
        parameters: {
            query?: {
                /** @description Itens por página (1 a 200, padrão 50) */
                limit?: number;
                /** @description `nextCursor` da página anterior */
                cursor?: string;
                /** @description Filtra por status */
                status?: "pending" | "delivered" | "dead";
                /** @description Filtra por app */
                appCode?: string;
                /** @description Tipo do evento (ex.: `subscription.renewed`) */
                type?: string;
                /** @description Filtra por instalação */
                installationId?: number;
                /** @description Início (ISO 8601 ou `AAAA-MM-DD`) */
                from?: string;
                /** @description Fim (ISO 8601, ou `AAAA-MM-DD` incluindo o dia inteiro) */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Eventos com as últimas tentativas */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OutboxEventList"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    resendEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResendEventsRequest"];
            };
        };
        responses: {
            /** @description Quantidade reenfileirada */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResendResult"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listAdminInstallations: {
        parameters: {
            query?: {
                /** @description Itens por página (1 a 200, padrão 50) */
                limit?: number;
                /** @description `nextCursor` da página anterior */
                cursor?: string;
                /** @description Filtra por app */
                appCode?: string;
                /** @description Filtra por status da instalação */
                status?: string;
                /** @description Trecho do domínio ou `memberId` exato; só dígitos busca id da instalação ou `memberId` */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Instalações */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminInstallationPage"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAdminInstallation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Instalação */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminInstallation"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listInstallAttempts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tentativas */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstallAttemptList"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `NOT_FOUND`: Rota ou recurso inexistente.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getInstallationTimeline: {
        parameters: {
            query?: {
                /** @description Itens por página (1 a 200, padrão 50) */
                limit?: number;
                /** @description `nextCursor` da página anterior */
                cursor?: string;
                /** @description Tipos separados por vírgula: `install_attempt`, `event`, `purchase`, `admin_action` */
                kind?: string;
                /** @description Início (ISO 8601 ou `AAAA-MM-DD`) */
                from?: string;
                /** @description Fim (ISO 8601, ou `AAAA-MM-DD` incluindo o dia inteiro) */
                to?: string;
            };
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Itens */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstallationTimeline"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    startTrial: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["TrialRequest"];
            };
        };
        responses: {
            /** @description Trial iniciado */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrialStarted"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             *     - `APP_NOT_FOUND`: appCode não cadastrado ou inativo.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `TRIAL_ALREADY_USED`: A instalação já usou o trial (na rota de operador, também quando o trial está vigente).
             *     - `SUBSCRIPTION_ALREADY_EXISTS`: A instalação já tem assinatura paga vigente.
             *     - `BILLING_BUSY`: Outra operação de cobrança da mesma instalação está em andamento.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `TRIAL_NOT_CONFIGURED`: O app não tem trial configurado.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listOperators: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Operadores */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatorList"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createOperator: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOperatorRequest"];
            };
        };
        responses: {
            /** @description Operador e acesso */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssuedOperatorAccess"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `OPERATOR_EMAIL_TAKEN`: Já existe operador com este e-mail (sem diferenciar maiúsculas).
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateOperator: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id do operador */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateOperatorRequest"];
            };
        };
        responses: {
            /** @description Operador atualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operator"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `OPERATOR_NOT_FOUND`: Operador inexistente.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `LAST_OPERATOR`: A mudança deixaria a plataforma sem nenhum `operator` ativo.
             *     - `OPERATOR_SELF_CHANGE`: Um operador não pode desativar nem rebaixar a própria conta.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    resetOperatorAccess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id do operador */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Operador e acesso novo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssuedOperatorAccess"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `OPERATOR_NOT_FOUND`: Operador inexistente.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contadores */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Overview"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    rotateSigningKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RotateSigningKeyRequest"];
            };
        };
        responses: {
            /** @description Chave criada */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SigningKeyRotated"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listStripeEvents: {
        parameters: {
            query?: {
                /** @description Itens por página (1 a 200, padrão 50) */
                limit?: number;
                /** @description `nextCursor` da página anterior */
                cursor?: string;
                /** @description Filtra por status */
                status?: string;
                /** @description Tipo do evento Stripe */
                type?: string;
                /** @description App roteado */
                appCode?: string;
                /** @description Início (ISO 8601 ou `AAAA-MM-DD`) */
                from?: string;
                /** @description Fim (ISO 8601, ou `AAAA-MM-DD` incluindo o dia inteiro) */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Eventos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StripeEventList"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getStripeEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id do evento no Stripe (`evt_...`) */
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Evento */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StripeEventDetail"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `NOT_FOUND`: Rota ou recurso inexistente.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    runSweep: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description `stripe` ou `spa` */
                kind: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Resultado da varredura */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SweepResult"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `PASSWORD_CHANGE_REQUIRED`: A conta está com senha provisória: só a troca de senha é permitida.
             *     - `FORBIDDEN_ROLE`: O papel do operador não permite esta rota (`viewer` só lê).
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `NOT_FOUND`: Rota ou recurso inexistente.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    receiveBitrixAppEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Código do app */
                appCode: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/x-www-form-urlencoded": components["schemas"]["BitrixAppEvent"];
            };
        };
        responses: {
            /** @description Evento tratado ou ignorado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BitrixAppEventResult"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    receiveSpaEvent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/x-www-form-urlencoded": components["schemas"]["SpaEvent"];
            };
        };
        responses: {
            /** @description `handled=false` quando o evento não é de interesse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpaEventResult"];
                };
            };
            /** @description `application_token` inválido */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpaEventResult"];
                };
            };
            /** @description `CRMTHINK_APPLICATION_TOKEN` não configurado */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpaEventResult"];
                };
            };
        };
    };
    docsPage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página HTML */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": unknown;
                };
            };
        };
    };
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sempre `ok` enquanto o processo responde */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    readiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tudo ok */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Readiness"];
                };
            };
            /** @description Alguma dependência falhou; ver `checks` */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Readiness"];
                };
            };
        };
    };
    getInstallPage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Código do app (ex.: `crmthink.gptmaker`) */
                appCode: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página HTML com o tema do app */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": unknown;
                };
            };
            /** @description App inexistente ou inativo (HTML) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": unknown;
                };
            };
        };
    };
    postInstallPage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Código do app */
                appCode: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página HTML com o tema do app */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": unknown;
                };
            };
            /** @description App inexistente ou inativo (HTML) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": unknown;
                };
            };
        };
    };
    metrics: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Formato de exposição Prometheus */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": unknown;
                };
            };
        };
    };
    openapi: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Documento OpenAPI 3.1 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    createBillingPortalSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BillingPortalRequest"];
            };
        };
        responses: {
            /** @description URL do portal */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillingPortalSession"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `NO_GATEWAY_SUBSCRIPTION`: Assinatura sem cobrança Stripe ativa (trial, manual ou encerrada).
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createCheckoutSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CheckoutRequest"];
            };
        };
        responses: {
            /** @description Sessão criada */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckoutSession"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             *     - `PLAN_TYPE_MISMATCH`: Plano de assinatura com `intent=purchase` ou avulso com `intent=subscribe`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             *     - `PLAN_NOT_FOUND`: Plano inexistente ou de produto não vinculado ao app.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `INSTALLATION_NOT_ACTIVE`: Sem instalação `ACTIVE` do app no portal (sessão: 403; checkout: 409).
             *     - `SUBSCRIPTION_ALREADY_EXISTS`: A instalação já tem assinatura paga vigente.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `PLAN_INACTIVE`: Plano ou produto inativo.
             *     - `PLAN_NOT_PURCHASABLE`: Plano sem preço Stripe no ambiente atual.
             *     - `NO_ACTIVE_SUBSCRIPTION`: Compra avulsa exige assinatura ativa ou em trial.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Falha em serviço externo
             *     - `GATEWAY_ERROR`: O Stripe recusou ou falhou na operação.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Indisponível
             *     - `PAYMENTS_UNAVAILABLE`: Stripe não configurado neste ambiente.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    install: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallRequest"];
            };
        };
        responses: {
            /** @description Instalação ativa ou pendente do instalador */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstallOutcome"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `NOT_PORTAL_ADMIN`: Instalar ou refazer instalação exige administrador do portal.
             *     - `MEMBER_ID_MISMATCH`: memberId informado não é o do portal dono do token.
             *     - `DOMAIN_MISMATCH`: Domínio informado não é o do portal dono do token.
             *     - `BITRIX_TOKEN_REJECTED`: O Bitrix recusou o access token enviado.
             *     - `TOKEN_APP_MISMATCH`: O access token pertence a outro app Bitrix (`CODE` do `app.info` diferente do `bitrixClientId` e do `bitrixAppCode`).
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `APP_NOT_FOUND`: appCode não cadastrado ou inativo.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Falha em serviço externo
             *     - `EVENT_BIND_FAILED`: Falha ao registrar `ONAPPINSTALL`/`ONAPPUNINSTALL` no portal (503 se o portal não respondeu).
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Indisponível
             *     - `BITRIX_UNAVAILABLE`: O portal Bitrix24 não respondeu a tempo.
             *     - `CRMTHINK_UNAVAILABLE`: O portal CRMThink (SPAs) não respondeu durante a instalação.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    retryInstall: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallRetryRequest"];
            };
        };
        responses: {
            /** @description Resultado do novo chamado ao instalador */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstallOutcome"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `NOT_PORTAL_ADMIN`: Instalar ou refazer instalação exige administrador do portal.
             *     - `BITRIX_TOKEN_REJECTED`: O Bitrix recusou o access token enviado.
             *     - `TOKEN_APP_MISMATCH`: O access token pertence a outro app Bitrix (`CODE` do `app.info` diferente do `bitrixClientId` e do `bitrixAppCode`).
             *     - `INSTALLATION_MISMATCH`: Retry de instalação para portal diferente do registrado.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `APP_NOT_FOUND`: appCode não cadastrado ou inativo.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `INSTALLATION_NOT_PENDING`: Retry pedido para instalação que não está `INSTALL_PENDING`.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Indisponível
             *     - `BITRIX_UNAVAILABLE`: O portal Bitrix24 não respondeu a tempo.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listInstallations: {
        parameters: {
            query: {
                /** @description `member_id` do portal */
                memberId: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Zero ou uma instalação */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstallationList"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `MEMBER_ID_REQUIRED`: Query `memberId` ausente.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getInstallation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Instalação */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Installation"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Assinatura */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentSubscription"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             *     - `NO_SUBSCRIPTION`: A instalação não tem assinatura vigente.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getInstallationToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Token válido */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Token"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `AUTH_ERROR`: Credencial do Bitrix inválida; é preciso reinstalar o app.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Removido
             *     - `INSTALLATION_UNINSTALLED`: O app foi removido do portal; não há mais token.
             */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Falha em serviço externo
             *     - `TOKEN_REFRESH_FAILED`: O OAuth do Bitrix falhou ao renovar o token.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Indisponível
             *     - `TOKEN_REFRESH_BUSY`: Outra renovação do mesmo token está em andamento.
             *     - `BITRIX_UNAVAILABLE`: O portal Bitrix24 não respondeu a tempo.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    refreshInstallationToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TokenRefreshRequest"];
            };
        };
        responses: {
            /** @description Token renovado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Token"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `AUTH_ERROR`: Credencial do Bitrix inválida; é preciso reinstalar o app.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Removido
             *     - `INSTALLATION_UNINSTALLED`: O app foi removido do portal; não há mais token.
             */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Falha em serviço externo
             *     - `TOKEN_REFRESH_FAILED`: O OAuth do Bitrix falhou ao renovar o token.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Indisponível
             *     - `TOKEN_REFRESH_BUSY`: Outra renovação do mesmo token está em andamento.
             *     - `BITRIX_UNAVAILABLE`: O portal Bitrix24 não respondeu a tempo.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    requestTrial: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da instalação (`installationId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TrialRequest"];
            };
        };
        responses: {
            /** @description Trial já vigente; contato gravado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrialStarted"];
                };
            };
            /** @description Trial iniciado */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrialStarted"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `INSTALLATION_NOT_FOUND`: Instalação inexistente, de outro app ou desvinculada do SPA 1060.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `TRIAL_ALREADY_USED`: A instalação já usou o trial (na rota de operador, também quando o trial está vigente).
             *     - `SUBSCRIPTION_ALREADY_EXISTS`: A instalação já tem assinatura paga vigente.
             *     - `BILLING_BUSY`: Outra operação de cobrança da mesma instalação está em andamento.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `TRIAL_NOT_CONFIGURED`: O app não tem trial configurado.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listPlans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Planos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanList"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionRequest"];
            };
        };
        responses: {
            /** @description JWT e usuário */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `ORIGIN_NOT_ALLOWED`: Origem do navegador não autorizada: para o appCode (`SESSION_CORS_ORIGINS`) na sessão do iframe, ou fora de `BACKOFFICE_ORIGINS` numa mutação com sessão de operador (proteção contra requisição forjada).
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             *     - `INSTALLATION_NOT_ACTIVE`: Sem instalação `ACTIVE` do app no portal (sessão: 403; checkout: 409).
             *     - `BITRIX_TOKEN_REJECTED`: O Bitrix recusou o access token enviado.
             *     - `TOKEN_APP_MISMATCH`: O access token pertence a outro app Bitrix (`CODE` do `app.info` diferente do `bitrixClientId` e do `bitrixAppCode`).
             *     - `BITRIX_USER_UNKNOWN`: O Bitrix não devolveu o usuário do token.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Indisponível
             *     - `BITRIX_UNAVAILABLE`: O portal Bitrix24 não respondeu a tempo.
             */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    changePlan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da assinatura (`subscriptionId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePlanRequest"];
            };
        };
        responses: {
            /** @description Troca aplicada ou agendada */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangePlanResult"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             *     - `SAME_PLAN`: A assinatura já está no plano pedido.
             *     - `PLAN_TYPE_MISMATCH`: Plano de assinatura com `intent=purchase` ou avulso com `intent=subscribe`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `SUBSCRIPTION_NOT_FOUND`: Assinatura inexistente ou de instalação de outro app.
             *     - `PLAN_NOT_FOUND`: Plano inexistente ou de produto não vinculado ao app.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `MANUAL_SUBSCRIPTION`: Assinatura manual: plano é alterado no SPA pelo time comercial.
             *     - `NO_GATEWAY_SUBSCRIPTION`: Assinatura sem cobrança Stripe ativa (trial, manual ou encerrada).
             *     - `PLAN_INACTIVE`: Plano ou produto inativo.
             *     - `PLAN_NOT_PURCHASABLE`: Plano sem preço Stripe no ambiente atual.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listItems: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da assinatura (`subscriptionId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Itens, inclusive removidos */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionItemList"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `SUBSCRIPTION_NOT_FOUND`: Assinatura inexistente ou de instalação de outro app.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da assinatura (`subscriptionId`) */
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateItemRequest"];
            };
        };
        responses: {
            /** @description Item já existia com este `externalRef` */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionItem"];
                };
            };
            /** @description Item criado */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionItem"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `SUBSCRIPTION_NOT_FOUND`: Assinatura inexistente ou de instalação de outro app.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `BILLING_BUSY`: Outra operação de cobrança da mesma instalação está em andamento.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `SUBSCRIPTION_ENDED`: Assinatura cancelada ou com trial expirado não aceita itens.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Falha em serviço externo
             *     - `GATEWAY_ERROR`: O Stripe recusou ou falhou na operação.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removeItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da assinatura (`subscriptionId`) */
                id: number;
                /** @description Id do item */
                itemId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Item removido */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionItem"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `SUBSCRIPTION_NOT_FOUND`: Assinatura inexistente ou de instalação de outro app.
             *     - `ITEM_NOT_FOUND`: Item inexistente ou de outra assinatura.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `BILLING_BUSY`: Outra operação de cobrança da mesma instalação está em andamento.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `SUBSCRIPTION_ENDED`: Assinatura cancelada ou com trial expirado não aceita itens.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Falha em serviço externo
             *     - `GATEWAY_ERROR`: O Stripe recusou ou falhou na operação.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da assinatura (`subscriptionId`) */
                id: number;
                /** @description Id do item */
                itemId: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateItemRequest"];
            };
        };
        responses: {
            /** @description Item atualizado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionItem"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `VALIDATION_ERROR`: Corpo ou parâmetros fora do schema; `details` lista `{path, message}`.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não autenticado
             *     - `UNAUTHORIZED`: Credencial ausente ou inválida (chave de API, token de operador, sessão do backoffice ausente ou expirada, ou auth do evento).
             */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Proibido
             *     - `APP_INACTIVE`: Aplicação desativada ou inexistente.
             */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não encontrado
             *     - `SUBSCRIPTION_NOT_FOUND`: Assinatura inexistente ou de instalação de outro app.
             *     - `ITEM_NOT_FOUND`: Item inexistente ou de outra assinatura.
             */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Conflito
             *     - `BILLING_BUSY`: Outra operação de cobrança da mesma instalação está em andamento.
             */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Não processável
             *     - `SUBSCRIPTION_ENDED`: Assinatura cancelada ou com trial expirado não aceita itens.
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description Falha em serviço externo
             *     - `GATEWAY_ERROR`: O Stripe recusou ou falhou na operação.
             */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    receiveStripeWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": components["schemas"]["StripeEvent"];
            };
        };
        responses: {
            /** @description Recebido */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StripeWebhookResult"];
                };
            };
            /**
             * @description Requisição inválida
             *     - `INVALID_SIGNATURE`: Assinatura `Stripe-Signature` inválida ou ausente.
             */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "event.installation.created": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "installation.created";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallationCreatedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.installation.reinstalled": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "installation.reinstalled";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallationReinstalledEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.installation.removed": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "installation.removed";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallationRemovedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.installation.auth_error": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "installation.auth_error";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallationAuthErrorEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.installation.auth_restored": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "installation.auth_restored";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallationAuthRestoredEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.trial_started": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.trial_started";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionTrialStartedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.activated": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.activated";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionActivatedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.renewed": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.renewed";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionRenewedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.plan_changed": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.plan_changed";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionPlanChangedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.past_due": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.past_due";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionPastDueEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.recovered": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.recovered";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionRecoveredEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.cancel_scheduled": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.cancel_scheduled";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionCancelScheduledEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.ended": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.ended";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionEndedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.period_ending": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.period_ending";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionPeriodEndingEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.subscription.item_changed": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "subscription.item_changed";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionItemChangedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.purchase.paid": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "purchase.paid";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PurchasePaidEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.charge.refunded": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "charge.refunded";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChargeRefundedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    "event.charge.disputed": {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
                "X-Platform-Event-Id": string;
                "X-Platform-Event-Type": "charge.disputed";
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChargeDisputedEvent"];
            };
        };
        responses: {
            /** @description Recebido. Qualquer outra resposta, ou timeout, gera reenvio. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    installer: {
        parameters: {
            query?: never;
            header: {
                /** @description `t=<unix>,v1=<hex(hmac-sha256(webhookSecret, t + "." + corpo cru))>`. Rejeite `t` com mais de 5 minutos de diferença; durante rotação do segredo chegam dois `v1=` — aceite se qualquer um conferir. */
                "X-Platform-Signature": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallerPayload"];
            };
        };
        responses: {
            /** @description Instalação do app concluída */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
