# backoffice-web Specification

## Purpose

Interface web em que dev e suporte entram com a própria conta e consultam apps, instalações, histórico, eventos, cobrança e auditoria da plataforma, sem usar `curl`.

## Requirements

### Requirement: Entrega pela API
A API MUST servir o backoffice em `/backoffice`, devolvendo `index.html` para qualquer caminho de `/backoffice/*` que não seja um arquivo, e os arquivos com hash no nome com cache longo e `immutable`. `index.html` MUST ser servido sem cache. As respostas de `/backoffice` MUST trazer `Content-Security-Policy` com `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'` e `base-uri 'none'`, além de `X-Content-Type-Options: nosniff` e `Referrer-Policy: same-origin`. O backoffice MUST NOT carregar scripts, fontes ou estilos de outra origem.

#### Scenario: Link direto para uma instalação
- **WHEN** o suporte abre `https://<host>/backoffice/installations/1234` numa aba nova
- **THEN** a API devolve `index.html` e a interface abre o detalhe da instalação 1234, ou o login se não houver sessão

#### Scenario: Tentativa de embutir em iframe
- **WHEN** uma página de outro domínio tenta abrir `/backoffice` num iframe
- **THEN** o navegador bloqueia por causa do `frame-ancestors 'none'`

### Requirement: Acesso e sessão
A interface MUST exigir login antes de qualquer tela, em duas etapas: primeiro e-mail e senha, depois o código do app autenticador. Quando a conta ainda não tem autenticador, a segunda etapa MUST mostrar o QR code do `otpauth://` (gerado no navegador, sem enviar o segredo a outro serviço), o segredo em texto para digitação manual e o campo do primeiro código. A segunda etapa MUST oferecer a opção "Lembrar este navegador" e MUST informar por quantos dias. Quando o navegador já está lembrado, a interface MUST pular a segunda etapa. O segredo e o QR code MUST NOT ser gravados em cache de consultas, armazenamento do navegador, URL ou logs do console. A interface MUST mostrar uma única mensagem genérica para qualquer falha de login, MUST mostrar o tempo de espera quando a resposta for 429 e, com o desafio vencido, MUST voltar à primeira etapa avisando que o tempo acabou. Com senha provisória, MUST levar o operador direto à troca de senha e MUST NOT liberar outras telas antes disso. Qualquer resposta 401 da API MUST levar ao login, preservando o endereço de origem para voltar a ele depois de entrar. O operador MUST poder sair e trocar a própria senha.

#### Scenario: Sessão expira no meio do uso
- **WHEN** a sessão expira e o operador clica num filtro da lista de instalações
- **THEN** a interface vai para o login e, depois de entrar, volta para a lista com o mesmo filtro

#### Scenario: Primeiro acesso
- **WHEN** um operador criado pelo script entra pela primeira vez com a senha provisória
- **THEN** a interface mostra o QR code para cadastrar o autenticador, pede o primeiro código e, depois dele, mostra só a troca de senha e libera o painel quando ela for feita

#### Scenario: Login com autenticador já cadastrado
- **WHEN** o operador envia e-mail e senha corretos
- **THEN** a interface mostra só o campo do código, com a opção "Lembrar este navegador"

#### Scenario: Navegador lembrado
- **WHEN** o operador volta ao mesmo navegador dentro do prazo e envia e-mail e senha corretos
- **THEN** a interface entra direto, sem pedir o código

#### Scenario: Tempo do código esgotado
- **WHEN** o operador demora mais de 5 minutos para digitar o código
- **THEN** a interface volta para e-mail e senha com o aviso de que o tempo acabou

### Requirement: Comportamento por papel
A interface MUST mostrar o nome e o papel do operador logado. Para `viewer`, ela MUST NOT exibir controles de ações exclusivas de `operator` e MUST NOT exibir o payload de eventos Stripe. A interface MUST NOT ser a única barreira: respostas 403 da API MUST aparecer como "sem permissão", sem quebrar a tela.

#### Scenario: Suporte abre um evento Stripe
- **WHEN** um `viewer` abre um evento Stripe da lista
- **THEN** a interface mostra tipo, status, app, tentativas e erro, sem a área de payload

### Requirement: Painel
A tela inicial MUST mostrar os contadores de `GET /admin/overview`: instalações por app e status, eventos `pending` e `dead` por app, idade do evento `pending` mais antigo, eventos Stripe com falha, credenciais com renovação falhando, trials terminando em 7 dias e a última execução de cada varredura, com o horário do cálculo. Cada contador com destino MUST levar à lista correspondente já filtrada.

#### Scenario: Do contador para a lista
- **WHEN** o operador clica em "12 eventos dead" do app `crmthink.gptmaker`
- **THEN** a interface abre a lista de eventos com `appCode=crmthink.gptmaker` e `status=dead` na URL

### Requirement: Instalações
A interface MUST listar instalações com busca (domínio, `memberId` ou id), filtros por app e status, paginação e indicação da saúde dos tokens. O detalhe MUST mostrar o resumo, o contato, a assinatura corrente (ou o aviso de indisponível com o motivo), a saúde dos tokens e as abas "Linha do tempo", "Eventos" e "Tentativas de instalação". A linha do tempo MUST mostrar os itens em ordem do mais recente para o mais antigo, com ícone e cor por tipo, filtro por tipo, carregamento de mais itens e, nos eventos, as tentativas de entrega com status HTTP e erro.

#### Scenario: Suporte investiga um cliente
- **WHEN** o suporte busca `acme`, abre a instalação e vai para "Linha do tempo"
- **THEN** vê, em ordem, as tentativas de instalação, os eventos enviados ao app com as entregas, as compras e as ações de operador dessa instalação

#### Scenario: Assinatura indisponível
- **WHEN** o detalhe retorna `subscription.available = false`
- **THEN** a interface mostra o restante normalmente e um aviso "Assinatura indisponível no momento" com o motivo

### Requirement: Eventos, Stripe, apps e auditoria
A interface MUST oferecer: lista de eventos enviados aos apps (filtros por app, status, tipo, instalação e período; detalhe com o envelope sem segredos e as tentativas de entrega); lista de eventos Stripe (filtros por status, tipo, app e período); lista e detalhe de apps (configuração, escopos, produtos, trial, URLs e datas de rotação, sem chave de API nem segredos); e lista de auditoria (filtros por ator, ação, alvo, resultado e período, com link para o alvo quando ele for uma instalação ou um app).

#### Scenario: Do registro de auditoria para a instalação
- **WHEN** o operador clica no alvo `installation:1234` de um registro de auditoria
- **THEN** a interface abre o detalhe da instalação 1234

### Requirement: Estado na URL
Filtros, busca, aba ativa e cursor de paginação de cada tela MUST ficar na URL. Recarregar a página ou abrir o mesmo link em outro navegador com sessão válida MUST mostrar a mesma visão. Voltar no navegador MUST desfazer a última mudança de filtro.

#### Scenario: Compartilhar uma busca
- **WHEN** um dev copia o endereço da lista de eventos filtrada por `status=dead` e manda para o suporte
- **THEN** o suporte abre o link e vê a mesma lista filtrada

### Requirement: Estados de carregamento, vazio e erro
Toda tela de dados MUST ter estado de carregamento, estado vazio com o filtro aplicado descrito e estado de erro com o código de erro da API e uma opção de tentar de novo. Erros de uma área do detalhe (por exemplo, a linha do tempo) MUST NOT esconder as outras áreas.

#### Scenario: Linha do tempo falha
- **WHEN** `GET /admin/installations/1234/timeline` responde 500
- **THEN** a aba mostra o erro com "Tentar novamente" e o resumo da instalação continua visível

### Requirement: Idioma, fuso e tema
A interface MUST estar em pt-br, MUST mostrar datas no fuso `America/Sao_Paulo` com a data e hora completas disponíveis ao passar o mouse sobre datas relativas, e MUST oferecer tema claro e escuro, seguindo o sistema por padrão.

#### Scenario: Data relativa
- **WHEN** o operador passa o mouse sobre "há 3 horas" na linha do tempo
- **THEN** a interface mostra a data e hora completas em `America/Sao_Paulo`
