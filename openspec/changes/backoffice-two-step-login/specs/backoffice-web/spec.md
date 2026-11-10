## MODIFIED Requirements

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
