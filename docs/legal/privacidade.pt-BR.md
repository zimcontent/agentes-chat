# Política de Privacidade

> [!warning] Rascunho, sujeito à revisão jurídica
> Este documento é um rascunho e precisa ser revisado por advogado antes de ser usado com clientes. Os campos entre colchetes, `[a preencher]`, são dados da empresa que ainda não foram informados.

Atualizado em 18 de novembro de 2026.

## 1. Visão geral e papéis

Esta Política explica quais dados pessoais o DougBot trata, para quê, por quanto tempo, com quem são compartilhados e como cada pessoa pode exercer os seus direitos, conforme a Lei nº 13.709/2018 (LGPD).

Há dois papéis, e eles precisam ficar claros:

- **A empresa cliente é a controladora** dos dados que as pessoas e os agentes colocam no workspace: mensagens, arquivos, tarefas, wiki, memória dos agentes, registros de uso e tudo o mais que pertence ao workspace. Ela decide o que é tratado, para quê e por quem entra.
- **O Prestador é o operador** desses dados: trata o conteúdo do workspace apenas para operar a instalação, seguindo as instruções da empresa cliente e o Acordo de Tratamento de Dados do Anexo I.
- **O Prestador é o controlador** dos dados da conta que ele mesmo cria e mantém para dar acesso ao Serviço (nome, e-mail, credenciais, sessões), e dos dados de segurança e de operação da instalação.

Cada instalação pertence a um Cliente e fica no servidor dele, em {{serverLocation}}. Os dados de um Cliente não se misturam com os de outro.

## 2. Dados que tratamos

**Dados da conta, de que o Prestador é controlador:**

- nome, endereço de e-mail, hash da senha (a senha em si nunca é guardada), foto de perfil e, quando a pessoa entra com Google, Apple ou GitHub, o nome, o e-mail e o identificador que aquele provedor devolve
- idioma, fuso horário preferido e as preferências de uso guardadas para a pessoa
- sessões de login, com o endereço IP, o navegador ou o aplicativo e as datas de início e de expiração
- tokens de notificação dos aparelhos em que a pessoa entra (celular e navegador)
- registros de segurança, como tentativas de entrada, códigos enviados por e-mail e bloqueios

**Dados do workspace, de que a empresa cliente é controladora e o Prestador é operador:**

- mensagens em canais, conversas e mensagens diretas, e os arquivos, imagens, áudios e vídeos que elas carregam
- tarefas, wiki, eventos do calendário, rotinas, quadros e os widgets dos painéis
- agentes: as instruções, as configurações, a memória, as habilidades e o que cada agente escreve e faz, com o histórico das ferramentas que usou
- o que os agentes leem e gravam nos conectores, nos bancos de dados e nos computadores que o workspace conecta
- aprovações, decisões, registros de auditoria e registros de uso de modelos (modelo, tokens e custo, com o workspace e o agente)
- mensagens de voz: o áudio gravado e as palavras transcritas

**Dados necessários para operar e proteger a instalação:**

- registros técnicos (logs) de requisições, erros e tarefas em segundo plano, sem o conteúdo das mensagens
{{#if svc.telemetry}}
- um relatório diário de uso anônimo (contagens e tamanhos, nunca mensagens, nomes, arquivos ou endereços), descrito no item 11
{{/if}}
{{#if svc.support}}
- o relato que a pessoa manda ao suporte, com o nome e o e-mail dela, o nome do workspace, o agente que o escreveu, o código desta instalação e a versão do servidor, descritos no item 5
{{/if}}
{{#if companyRequests}}
- o que uma empresa preenche no formulário público de lista de espera, descrito no item 12
{{/if}}

## 3. Como usamos os dados, e com que base legal

Tratamos dados pessoais com base nas seguintes hipóteses da LGPD:

- **Execução de contrato** (art. 7º, V): criar e manter a conta, dar acesso ao workspace, operar os agentes, cobrar pela implantação quando houver cobrança.
- **Cumprimento de obrigação legal ou regulatória** (art. 7º, II): guardar documentos fiscais, atender ordens judiciais e administrativas, manter registros de acesso exigidos por lei.
- **Legítimo interesse** (art. 7º, IX): manter a segurança da instalação, prevenir abuso e fraude, corrigir falhas e medir o funcionamento do Serviço, o que inclui o relatório de uso anônimo do item 11. O interesse é o de manter o Serviço seguro e funcionando, o relatório leva só contagens e tamanhos, e a pessoa pode se opor desligando-o, como o item 11 explica.
- **Consentimento** (art. 7º, I): quando a empresa cliente ou a pessoa escolhe ligar uma funcionalidade opcional que envolva dados pessoais, como a transcrição de voz por um serviço externo ou uma conta de modelo conectada, e quando uma empresa se inscreve na lista de espera (item 12). O consentimento pode ser retirado a qualquer momento pelo próprio ajuste que o ligou.
- **Proteção da vida ou da tutela da saúde** (art. 7º, VII) e **exercício regular de direitos** (art. 7º, VI): apenas quando uma situação concreta exigir, como responder a uma emergência ou defender um direito em processo.

Não vendemos dados pessoais e o Prestador não usa o conteúdo do workspace para treinar modelos de inteligência artificial. O que cada provedor de modelo faz com o que recebe, inclusive treino, segue os termos e as configurações de cada um, que a empresa cliente escolhe: confira-os antes de conectar uma conta (item 4).

## 4. O que os agentes enviam a modelos de inteligência artificial

Os agentes usam as contas de inteligência artificial da empresa cliente, contratadas por ela diretamente com cada provedor{{#if svc.platformKey}}, ou a chave de modelo da própria plataforma, quando o servidor a define e o workspace não tem uma chave sua{{/if}}. Para responder, o agente envia ao provedor o trecho de conversa, o contexto do workspace e o resultado das ferramentas de que precisa naquele turno.

O que o provedor faz com o que recebe, inclusive se guarda ou usa para treino, segue os termos e as configurações de privacidade dele, e não desta Política. A empresa cliente escolhe quais provedores usar e pode ver e trocar essa escolha no próprio Serviço.

{{#if svc.platformKey}}
Nesta instalação, o servidor define uma chave de modelo da plataforma (Anthropic). Um workspace sem chave própria pode usá-la, e o roteador usa o modelo pequeno dela quando o workspace não tem chave com um. O que o agente envia é o mesmo do parágrafo acima, o uso é registrado por workspace e o provedor trata o que recebe pelos termos dele.
{{/if}}

Chaves de API e credenciais dos provedores ficam cifradas na instalação, nunca são devolvidas ao navegador nem aos aplicativos, e todo uso é registrado com o workspace e o agente a que pertence.

## 5. Serviços externos opcionais

Além dos provedores de modelo, a instalação pode usar serviços externos. Cada um é ligado por uma configuração da instalação (uma variável de ambiente), e um serviço que não foi ligado não recebe nada. Esta seção traz apenas os que estão ligados nesta instalação; o Anexo II mostra, um a um, se cada serviço está ligado ou desligado.

{{#if svc.jev}}
- **Roteador Jev**, da TypeSafe (ou pela OpenRouter, quando a chave é dela), ligado pela chave do servidor. Para decidir quem responde a uma mensagem que não chamou ninguém, ele recebe o texto das mensagens recentes da conversa, o canal e o tópico. Também ajuda a organizar a memória dos agentes e a achar o que eles procuram na tela, e recebe os trechos de que precisa para isso.
{{/if}}
{{#if svc.giphy}}
- **GIPHY**, para buscar GIFs. O servidor faz a busca e entrega cada GIF: navegadores e aplicativos nunca falam com o GIPHY, que só recebe o termo buscado, de uma pessoa ou de um agente, vindo do servidor.
{{/if}}
{{#if svc.whatsapp}}
- **WhatsApp, por um gateway Evolution Go**, ligado pela empresa cliente. O gateway guarda apenas as sessões do WhatsApp, em bancos de dados próprios, fora da cópia de segurança do item 8. As conversas ficam no banco de dados da instalação. O gateway fala com os servidores do WhatsApp, e o uso do WhatsApp segue os termos dele. Uma conta pode ser banida por esse uso.
{{/if}}
{{#if svc.email}}
- **Envio de e-mails**, por um provedor de e-mail transacional ou por um servidor SMTP escolhido pela instalação, para convites, redefinição de senha, códigos, avisos de orçamento e aprovações. O provedor recebe o endereço e o nome de quem recebe e o texto do e-mail.
{{/if}}
{{#if svc.support}}
- **Suporte por e-mail**. Quando uma pessoa pede ajuda com a própria instalação, o agente pode mandar um resumo ao endereço de suporte da instalação (a ferramenta `contact_support`). O e-mail leva o relato que o agente escreveu, o nome e o e-mail da pessoa (o endereço dela fica como destinatário de resposta), o nome do workspace, o agente que o escreveu, o código desta instalação e a versão do servidor, e sai pelo provedor de e-mail acima. Só uma pessoa o pede, nunca uma rotina, e cada pessoa manda no máximo 10 por hora. Quem recebe é a equipe de suporte do Prestador, que o usa para atender o pedido.
{{/if}}
{{#if storageS3}}
- **Armazenamento de arquivos** em um serviço compatível com S3, configurado pela instalação, que recebe os arquivos do Drive, os anexos, as fotos e as gravações.
{{/if}}
{{#if storageDisk}}
- **Armazenamento de arquivos** em uma pasta do disco do próprio servidor.
{{/if}}
{{#if storageDatabase}}
- **Armazenamento de arquivos** no banco de dados da instalação, sem serviço externo.
{{/if}}
{{#if svc.driveBackup}}
- **Cópia de vídeos finais no Google Drive**. Cada vídeo final que um editor entrega é copiado para uma pasta do Google Drive indicada pela instalação.
{{/if}}
{{#if svc.media}}
- **Geração de imagens e vídeos** por um serviço de mídia pago em créditos (Zim Mídia). Ele recebe o pedido e as referências enviadas, e guarda as chaves dos provedores e a carteira de créditos do workspace.
{{/if}}
{{#if svc.speech}}
- **Transcrição de voz** por um serviço de fala configurado pela instalação (AssemblyAI, ElevenLabs, Soniox, Groq, OpenAI ou DeepInfra, na ordem em que a instalação os tenta). Ele recebe o áudio da mensagem de voz. Os agentes que falam no WhatsApp com a ElevenLabs enviam a ela o texto que vão dizer. Um servidor de fala da própria instalação, na mesma rede, não manda nada para fora.
{{/if}}
{{#if svc.push}}
- **Notificações no celular**, com o texto do aviso e o token do aparelho, enviadas{{#if svc.pushDirect}} diretamente ao Firebase Cloud Messaging (Android) e ao Apple Push Notification service (iPhone), com as credenciais da instalação{{/if}}{{#if svc.pushRelay}}{{#if svc.pushDirect}}, e, onde a instalação não tem as credenciais de uma plataforma,{{/if}} pelo relay de notificações do projeto agentes.chat, por onde passa o texto de cada aviso{{/if}}.
{{/if}}
- **Notificações no navegador** (Web Push), cifradas e entregues pelo serviço de notificações do próprio navegador (Google, Mozilla ou Apple), com a chave que o servidor gera.
{{#if svc.composio}}
- **Integrador de serviços (Composio)**, para conectar caixas de e-mail e outros aplicativos. Recebe o que a chamada do conector precisa, e o conteúdo que o conector lê ou envia (por exemplo, e-mails) passa por ele.
{{/if}}
- **Conectores e integrações** escolhidos pela empresa cliente, como servidores MCP, GitHub, Google, Microsoft, caixas de e-mail e bancos de dados. Cada um recebe só o que a chamada daquele conector precisa e segue os termos do serviço conectado.
{{#if svc.embeddings}}
- **Busca por significado (embeddings)**, por um serviço de vetores configurado pela instalação (Voyage AI ou um servidor compatível com a API de embeddings da OpenAI), que recebe os trechos indexados. Se o serviço não responde, a busca usa só as palavras.
{{/if}}
{{#if svc.errors}}
- **Relatórios de erro** para um servidor compatível com Sentry configurado pela instalação, do servidor e, se houver um endereço para eles, dos navegadores. O relatório leva o erro, a pilha, a versão e identificadores internos, nunca o conteúdo das mensagens, os e-mails, os IPs, os cookies ou os tokens.
{{/if}}
{{#if svc.billing}}
- **Cobrança**, por um serviço à parte. Quando uma pessoa abre a página de plano e cobrança, o servidor entrega a ele, por um link assinado, o nome e o identificador do workspace, o identificador, o nome, o e-mail, o papel e o idioma da pessoa e contagens de uso (membros, agentes, mensagens, canais, arquivos, armazenamento). O DougBot não guarda números de cartão.
{{/if}}
- **Hospedagem**: o servidor onde a instalação roda, contratado pelo Prestador ou pela empresa cliente, em {{serverLocation}}.
{{#if svc.telemetry}}
- **Relatório de uso anônimo** ao projeto agentes.chat, descrito no item 11.
{{/if}}

Os suboperadores que tratam dados em nome do Cliente estão no Anexo II, com o serviço, a finalidade e o estado de cada um.

## 6. Quem vê o conteúdo do workspace

O conteúdo do workspace é visto pelas pessoas que dele participam, conforme os papéis e as permissões que a empresa cliente define, e pelos agentes que ela autoriza.

A equipe do Prestador acessa a instalação apenas para operá-la e mantê-la: diagnosticar falhas, restaurar cópias de segurança, aplicar uma atualização ou cumprir uma obrigação legal. Esse acesso é restrito às pessoas que precisam dele e fica registrado. Nenhum desses acessos é usado para montar perfis, fazer publicidade ou treinar modelos.

## 7. Por quanto tempo guardamos

- **Dados da conta:** enquanto a conta existir. Quando a pessoa pede para excluir a conta no próprio Serviço, as sessões e os aparelhos saem na hora e o resto é apagado 7 dias depois, a menos que ela restaure a conta antes disso. As cópias de segurança somem no prazo do item 8.
- **Conteúdo do workspace:** enquanto o workspace existir, e antes disso quando alguém apaga um conteúdo específico. Quando o proprietário pede para excluir o workspace, ele fecha para todos na hora e o conteúdo é apagado 7 dias depois, a menos que um proprietário o restaure antes disso. Os arquivos do workspace (Drive, habilidades, ícones de conectores e logotipo) saem do armazenamento da instalação por uma tarefa em segundo plano logo depois; os arquivos de um bucket que o próprio workspace trouxe ficam nesse bucket, que é dele, e as fotos de perfil de uma conta excluída saem da mesma forma. A exclusão fica esperando, passada a data, enquanto o workspace estiver suspenso, retido por um motivo que não seja cobrança, ou sob uma retenção legal que o operador da instalação colocou (para guardar provas), e acontece quando a retenção sai.
- **Mensagens de voz:** {{#if voiceDays}}o áudio é apagado depois de {{voiceRetentionDays}} dias. A mensagem e as palavras transcritas continuam.{{else}}esta instalação não define prazo para o áudio: ele é guardado até ser apagado, com a mensagem e as palavras transcritas.{{/if}}
- **Registros de uso de modelos** (tokens e custo): enquanto o workspace existir, porque orçamentos e relatórios de uso dependem deles.
- **Registro de auditoria:** enquanto o workspace existir, porque é ele que mostra quem fez o quê.
- **Registros técnicos (logs):** {{#if logRetention}}por {{logRetention}}, o prazo configurado na instalação{{else}}pelo tempo que o servidor e o coletor de logs da instalação os mantêm, que esta instalação não informou{{/if}}.
- **Códigos enviados por e-mail:** valem por 10 minutos e as linhas já usadas saem um dia depois.

Depois desses prazos os dados são apagados ou anonimizados, ressalvado o que a lei obrigar a guardar, como documentos fiscais e registros de acesso, e o que for necessário para defender um direito em processo, hipótese do art. 16, I e II, da LGPD.

## 8. Cópias de segurança

{{#if backup}}
A instalação faz uma cópia de segurança do banco de dados por dia, guardada em um bucket separado. {{#if backupDays}}As cópias são mantidas por {{backupRetentionDays}} dias e depois apagadas automaticamente.{{else}}Esta instalação não informou o prazo: o serviço de cópias apaga as mais antigas que o prazo configurado nele (14 dias, se nada for configurado).{{/if}} Quando a empresa cliente opta por cifrar as cópias, a chave de leitura fica fora do servidor.

A cópia é só do banco de dados. Os arquivos que ficam em um bucket ou em uma pasta do servidor{{#if svc.whatsapp}} e os bancos do gateway do WhatsApp (as sessões do número){{/if}} não entram nela. Os arquivos guardados no próprio banco de dados entram.

Um dado apagado pelo Serviço pode continuar em uma cópia de segurança até o prazo acima. Ele não é usado para nada e sai com a expiração da cópia.
{{else}}
Esta instalação não tem cópia de segurança do banco de dados configurada. Se o Prestador ou a empresa cliente guardar cópias por outro meio, o contrato diz como e por quanto tempo.
{{/if}}

## 9. Segurança

O tráfego entre o navegador ou o aplicativo e o servidor é cifrado por TLS. Os dados ficam no disco do servidor contratado, cifrado quando a infraestrutura contratada oferece cifragem em repouso. As credenciais de modelos, conectores e bancos de dados são cifradas com chave derivada do segredo da instalação, com envelope por credencial, e nunca são devolvidas aos clientes. O acesso à instalação é restrito e registrado.

Se o Prestador souber de um incidente de segurança que possa acarretar risco ou dano relevante às pessoas, ele comunica a empresa cliente e as pessoas afetadas, e a Autoridade Nacional de Proteção de Dados (ANPD), nos prazos que a LGPD e a regulamentação exigem.

## 10. Transferência internacional

A instalação fica em {{serverLocation}}. Os provedores de modelo e os serviços do item 5 podem tratar dados em outros países, sob os termos e as salvaguardas deles. Quando a transferência sair do Brasil, ela se apoia nas hipóteses do art. 33 da LGPD, em especial as cláusulas contratuais específicas, as cláusulas-padrão ou as normas corporativas globais do fornecedor.

## 11. Relatório de uso anônimo

{{#if svc.telemetry}}
A instalação envia uma vez por dia um relatório de uso anônimo para o endereço de telemetria do projeto agentes.chat, do qual o DougBot deriva. O relatório leva contagens e tamanhos: quantas pessoas, agentes e computadores existem, quais modelos foram usados e quantos tokens, o tamanho das máquinas e o quanto os navegadores dos agentes trafegaram. Ele nunca leva mensagens, arquivos, nomes, e-mails, endereços, caminhos ou identificadores de pessoas, de workspaces ou de computadores. O único identificador é um número aleatório criado na primeira inicialização da instalação.

O envio vem **ligado por padrão** (é uma opção de saída, e não depende de consentimento), e a base legal é o legítimo interesse do art. 7º, IX, da LGPD: o do projeto em saber como o software funciona para mantê-lo e corrigi-lo, com dados que não identificam ninguém.
{{#if telemetryForced}}
Nos servidores do próprio agentes.chat o relatório não pode ser desligado.
{{else}}
Para desligá-lo, o proprietário da instalação define `TELEMETRY=off` na configuração do servidor ou usa o interruptor em Configurações › Geral. Desligado, nada é enviado. O comando `agentes telemetry` mostra exatamente o que seria enviado.
{{/if}}
{{else}}
Esta instalação não envia relatório de uso: o envio está desligado por configuração (`TELEMETRY=off`).
{{/if}}

## 12. Lista de espera de empresas

{{#if companyRequests}}
Esta instalação tem um formulário público em que uma empresa pede para entrar na lista de espera. O formulário coleta o nome da pessoa, o e-mail, o WhatsApp, a empresa, o tamanho do time, os interesses e o recado que ela escrever, e só vale com o consentimento dado ali mesmo (art. 7º, I). O pedido só é registrado depois que a pessoa confirma pelo e-mail que recebe.

O Prestador é o controlador desses dados e os usa apenas para responder ao pedido e combinar a contratação. Eles são guardados por {{companyRequestsRetentionDays}} dias e depois apagados. Quem enviou pode apagar o pedido a qualquer momento pelo botão de apagar do e-mail de confirmação, ou pedir ao encarregado ({{dpoEmailLink}}), e pode retirar o consentimento da mesma forma.
{{else}}
Esta instalação não tem formulário de lista de espera, e nada é coletado dessa forma.
{{/if}}

## 13. Cookies e armazenamento local

O Serviço usa um cookie de sessão para manter a pessoa conectada. O navegador e os aplicativos guardam no próprio aparelho preferências como o idioma, o tema, o ícone do aplicativo e os rascunhos de mensagens ainda não enviadas. Não usamos cookies de publicidade nem de rastreamento entre sites.

## 14. Direitos de quem tem dados tratados

A LGPD garante à pessoa, entre outros, os direitos de confirmação de tratamento, acesso, correção, anonimização, bloqueio ou eliminação, portabilidade, informação sobre compartilhamento, informação sobre a possibilidade de não consentir e revogação do consentimento, além de petição à ANPD.

Como exercer cada um:

- **Confirmação e acesso:** o Serviço mostra o perfil e as preferências em Configurações › Sua conta, e o conteúdo do workspace a que a pessoa tem acesso. Para uma cópia organizada do que a instalação guarda sobre a pessoa, escreva para o encarregado, {{dpoEmailLink}}.
- **Correção:** nome, foto, fuso horário e idioma se corrigem em Configurações › Sua conta. A troca de e-mail tem um passo de confirmação por código.
- **Eliminação:** a pessoa exclui a própria conta em Configurações › Sua conta, e o proprietário exclui o workspace nas mesmas configurações. Os dois podem ser restaurados até a exclusão se completar, 7 dias depois. Dados em cópias de segurança saem no prazo do item 8, e a exclusão de um workspace espera enquanto ele estiver suspenso ou sob retenção legal (item 7). Para apagar um conteúdo específico, use o próprio Serviço.
- **Portabilidade:** peça ao encarregado a exportação dos dados da pessoa, que será entregue em um formato legível por máquina.
- **Informação sobre compartilhamento:** esta Política e o Anexo II dizem com quem os dados são compartilhados. Um pedido específico pode ser feito ao encarregado.
- **Revogação do consentimento e oposição:** escreva para o encarregado, ou desligue no próprio Serviço a funcionalidade que dependia do consentimento.
- **Reclamação:** a pessoa pode reclamar à ANPD (https://www.gov.br/anpd).

Quando o pedido for sobre conteúdo do workspace, o Prestador encaminha à empresa cliente, que é a controladora, e a auxilia a responder, como o Anexo I prevê. O Prestador responde aos pedidos de que é controlador no prazo que a LGPD fixa.

## 15. Encarregado pelo tratamento de dados

O encarregado (DPO) do Prestador é {{dpo}}, e o contato é {{dpoEmailLink}}. Também é por esse endereço que se fala sobre esta Política e sobre o Acordo de Tratamento de Dados.

## 16. Crianças e adolescentes

O Serviço é para maiores de 18 anos. Não coletamos intencionalmente dados de crianças ou adolescentes. Se isso acontecer, avise o encarregado, e os dados serão apagados.

## 17. Alterações desta Política

O Prestador pode alterar esta Política. Uma alteração relevante é avisada com antecedência razoável pelos canais do Serviço, e a versão publicada nesta página é sempre a vigente. A data no topo diz quando ela mudou.

## 18. Contato

Dúvidas, pedidos e reclamações vão para o encarregado: {{dpo}}, {{dpoEmailLink}}.

## Anexo I: Acordo de Tratamento de Dados (DPA)

Este Anexo integra os Termos de Uso. Ele vale para todo dado pessoal que o Prestador tratar em nome da empresa cliente (o "Controlador") ao operar a instalação do DougBot.

**1. Objeto.** O Prestador trata dados pessoais apenas para fornecer, operar, manter, atualizar, proteger e fazer cópia de segurança da instalação do DougBot, e para prestar o suporte contratado.

**2. Natureza e finalidade.** O tratamento inclui armazenar, organizar, consultar, transmitir, cifrar, copiar e apagar dados, conforme as instruções do Controlador e o uso que ele faz do Serviço. O Prestador não usa os dados para finalidade própria, não os vende e não os usa para treinar modelos.

**3. Tipos de dados e titulares.** Os dados são os do item 2 desta Política, do grupo "dados do workspace", e os titulares são as pessoas do workspace, os clientes do Controlador e as pessoas que aparecem no conteúdo que ele coloca no Serviço.

**4. Instruções.** O Prestador segue as instruções documentadas do Controlador, incluindo as que constam dos Termos e das configurações do Serviço. Se uma instrução violar a LGPD, o Prestador avisa o Controlador e pode recusá-la.

**5. Confidencialidade.** Quem acessa os dados em nome do Prestador está sujeito a dever de confidencialidade e acessa apenas o necessário para a sua função.

**6. Segurança.** O Prestador aplica as medidas técnicas e administrativas do item 9 desta Política, e outras que o contrato prever. As medidas são revistas quando o risco muda.

**7. Suboperadores.** O Controlador autoriza o Prestador a usar os serviços do Anexo II, que recebem só o necessário para a finalidade indicada. O Prestador mantém a lista atualizada, informa o Controlador antes de incluir um suboperador novo que trate dados pessoais e responde pelos deveres de cada um perante o Controlador.

**8. Direitos dos titulares.** O Prestador auxilia o Controlador a responder aos pedidos dos titulares, pelos meios técnicos do Serviço e pelo suporte, e encaminha ao Controlador os pedidos que receber sobre o conteúdo do workspace.

**9. Incidentes.** O Prestador comunica ao Controlador, sem demora injustificada, qualquer incidente de segurança que envolva dados pessoais tratados em seu nome, com a descrição do ocorrido, dos dados e dos titulares afetados e das medidas tomadas, e colabora com as comunicações que o Controlador precisar fazer.

**10. Avaliação de impacto.** Quando o Controlador precisar de uma avaliação de impacto à proteção de dados, o Prestador fornece as informações de que dispõe sobre o tratamento que realiza.

**11. Término.** Encerrado o contrato, o Prestador devolve ou apaga os dados pessoais conforme a escolha do Controlador, ressalvadas as cópias de segurança pelo prazo do item 8 desta Política e o que a lei obrigar a guardar. Encerrado o contrato de uma instalação, ela é desligada e os dados são eliminados como o item 7 desta Política descreve.

**12. Auditoria.** O Prestador fornece ao Controlador as informações razoavelmente necessárias para demonstrar o cumprimento deste Anexo, incluindo relatórios e respostas a questionários, e permite auditorias combinadas com antecedência, sem prejuízo da segurança da instalação e dos outros clientes.

**13. Transferência internacional.** Quando o tratamento envolver transferência para fora do Brasil, valem as salvaguardas do item 10 desta Política.

## Anexo II: Suboperadores desta instalação

A tabela mostra, para cada serviço, se ele está ligado nesta instalação, conforme as configurações do servidor. Um serviço desligado não recebe nada. O que o Cliente conecta pelos próprios ajustes (provedores de modelo, conectores, voz ao vivo) depende das contas dele e não aparece como ligado ou desligado aqui. O interruptor do proprietário em Configurações › Geral também pode desligar o relatório, o que esta tabela não vê. Uma chave que o proprietário põe nos ajustes do Serviço (a do roteador Jev ou a do GIPHY, por exemplo) não é vista por esta tabela, que lê só as configurações do servidor.

| Serviço | Para quê | O que recebe | Estado |
| --- | --- | --- | --- |
| Provedores de modelo do Cliente | Responder, resumir e rotear as mensagens | O trecho de conversa e o contexto do turno | Conforme as contas do Cliente |
| Chave de modelo da plataforma | Responder, quando o workspace não tem chave | O trecho de conversa e o contexto do turno | {{on:svc.platformKey}} |
| Roteador Jev (TypeSafe ou OpenRouter) | Escolher quem responde, organizar a memória | O texto das mensagens recentes, o canal e o tópico | {{on:svc.jev}} |
| GIPHY | Buscar GIFs | O termo buscado | {{on:svc.giphy}} |
| Gateway do WhatsApp | Ler e enviar mensagens de WhatsApp | As conversas do número | {{on:svc.whatsapp}} |
| Provedor de e-mail | Enviar convites, códigos, avisos e relatos ao suporte | E-mail e nome de quem recebe, e o texto | {{on:svc.email}} |
| Suporte por e-mail | Atender pedidos de ajuda | O relato, o nome e o e-mail de quem pediu | {{on:svc.support}} |
| Armazenamento S3 | Guardar os arquivos do Drive e os anexos | Os arquivos do workspace | {{on:storageS3}} |
| Pasta do servidor | Guardar os arquivos do Drive e os anexos | Os arquivos do workspace | {{on:storageDisk}} |
| Cópia de vídeos no Google Drive | Guardar uma cópia dos vídeos finais | Os vídeos finais aprovados | {{on:svc.driveBackup}} |
| Serviço de mídia (Zim Mídia) | Gerar imagens e vídeos | O pedido e as referências enviadas | {{on:svc.media}} |
| Transcrição de voz | Transformar áudio em texto | O áudio da mensagem de voz | {{on:svc.speech}} |
| Voz ao vivo | Falar em uma chamada | O áudio da chamada | Conforme a chave do workspace |
| Firebase e Apple (notificações) | Entregar o aviso no aparelho | O texto do aviso e o token do aparelho | {{on:svc.pushDirect}} |
| Relay de notificações do agentes.chat | Entregar o aviso no aparelho | O texto do aviso e o token do aparelho | {{on:svc.pushRelay}} |
| Notificações no navegador | Entregar o aviso no navegador | O aviso, cifrado | Sempre |
| Integrador de serviços (Composio) | Conectar e-mail e outros aplicativos | O que a chamada do conector precisa | {{on:svc.composio}} |
| Busca por significado | Encontrar textos por sentido | Os trechos indexados | {{on:svc.embeddings}} |
| Relatórios de erro (Sentry) | Diagnosticar falhas | O erro, a pilha e a versão | {{on:svc.errors}} |
| Relatório de uso anônimo | Medir o funcionamento do projeto | Contagens e tamanhos, nunca conteúdo | {{on:svc.telemetry}} |
| Serviço de cobrança | Cobrar a implantação, quando houver | Dados da conta e contagens de uso | {{on:svc.billing}} |
| Cópia de segurança do banco | Restaurar a instalação | O banco de dados, sem os arquivos de bucket | {{on:backup}} |
| Hospedagem | Manter a instalação no ar | Tudo o que a instalação guarda | Sempre |

Prazos de retenção desta instalação, para completar o item 7 desta Política: {{#if logRetention}}registros técnicos por {{logRetention}}{{else}}registros técnicos pelo tempo que o servidor e o coletor mantêm{{/if}}{{#if backup}}{{#if backupDays}}, cópias de segurança por {{backupRetentionDays}} dias{{/if}}{{/if}}{{#if voiceDays}}, áudios de voz por {{voiceRetentionDays}} dias{{else}}, áudios de voz até serem apagados{{/if}}.
