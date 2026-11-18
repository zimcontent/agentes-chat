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

Cada instalação pertence a um Cliente e fica no servidor dele, em `{{serverLocation}}`. Os dados de um Cliente não se misturam com os de outro.

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
- quando ligado, um relatório diário de uso anônimo (contagens e tamanhos, nunca mensagens, nomes, arquivos ou endereços), descrito no item 11

## 3. Como usamos os dados, e com que base legal

Tratamos dados pessoais com base nas seguintes hipóteses da LGPD:

- **Execução de contrato** (art. 7º, V): criar e manter a conta, dar acesso ao workspace, operar os agentes, cobrar pela implantação quando houver cobrança.
- **Cumprimento de obrigação legal ou regulatória** (art. 7º, II): guardar documentos fiscais, atender ordens judiciais e administrativas, manter registros de acesso exigidos por lei.
- **Legítimo interesse** (art. 7º, IX): manter a segurança da instalação, prevenir abuso e fraude, corrigir falhas, medir o funcionamento do Serviço. O interesse é o de manter o Serviço seguro e funcionando, e o tratamento é limitado ao necessário para isso.
- **Consentimento** (art. 7º, I): quando a empresa cliente ou a pessoa escolhe ligar uma funcionalidade opcional que envolva dados pessoais, como o relatório de uso, a transcrição de voz por um serviço externo ou uma conta de modelo conectada. O consentimento pode ser retirado a qualquer momento pelo próprio ajuste que o ligou.
- **Proteção da vida ou da tutela da saúde** (art. 7º, VII) e **exercício regular de direitos** (art. 7º, VI): apenas quando uma situação concreta exigir, como responder a uma emergência ou defender um direito em processo.

Não vendemos dados pessoais e não usamos o conteúdo do workspace para treinar modelos de inteligência artificial.

## 4. O que os agentes enviam a modelos de inteligência artificial

Os agentes usam as contas de inteligência artificial contratadas pela empresa cliente diretamente com cada provedor. Para responder, o agente envia ao provedor escolhido o trecho de conversa, o contexto do workspace e o resultado das ferramentas de que precisa naquele turno.

O que o provedor faz com o que recebe segue os termos e as configurações de privacidade dele, e não desta Política. A empresa cliente escolhe quais provedores usar e pode ver e trocar essa escolha no próprio Serviço.

Chaves de API e credenciais dos provedores ficam cifradas na instalação do Cliente, nunca são devolvidas ao navegador nem aos aplicativos, e todo uso é registrado com o workspace e o agente a que pertence.

## 5. Serviços externos opcionais

Além dos provedores de modelo, a instalação pode usar serviços externos. Cada um deles é ligado por configuração da instalação (uma variável de ambiente), e um serviço que não foi ligado não recebe nada. São eles:

- **WhatsApp, por um gateway Evolution Go** ligado pela empresa cliente. O gateway guarda apenas as sessões do WhatsApp. As conversas ficam no banco de dados da instalação. O gateway fala com os servidores do WhatsApp, e o uso do WhatsApp segue os termos dele. Uma conta pode ser banida por esse uso.
- **Envio de e-mails** por um provedor de e-mail transacional ou por um servidor SMTP escolhido pela empresa cliente, para convites, redefinição de senha, avisos de orçamento e aprovações.
- **Armazenamento de arquivos** em um serviço compatível com S3 ou em um diretório do próprio servidor. Sem nenhum dos dois, os arquivos ficam no banco de dados da instalação.
- **Geração de imagens e vídeos** por um serviço de mídia pago em créditos, que guarda as chaves dos provedores e a carteira de créditos do workspace.
- **Voz ao vivo** pela API de voz do provedor de modelo, com a chave do próprio workspace.
- **Transcrição de voz** por um serviço de fala configurado pela instalação, ou por um servidor de fala próprio na mesma rede.
- **Notificações no celular** enviadas pelo Firebase Cloud Messaging, pelo Apple Push Notification service ou por um relay de notificações, conforme a configuração da instalação.
- **Conectores e integrações** escolhidos pela empresa cliente, como servidores MCP, GitHub, Google, Microsoft, caixas de e-mail, bancos de dados e um integrador de serviços. Cada um recebe só o que a chamada daquele conector precisa e segue os termos do serviço conectado.
- **Busca por significado (embeddings)** por um serviço de vetores configurado pela instalação, quando ligado. Desligado, a busca usa apenas as palavras.
- **Relatórios de erro** para um servidor compatível com Sentry configurado pela instalação. O relatório leva o erro, a pilha, a versão e identificadores internos, nunca o conteúdo das mensagens, os e-mails, os IPs, os cookies ou os tokens.
- **Pagamentos e cobrança**, quando a empresa cliente contrata um, por um serviço de cobrança à parte. O DougBot não guarda números de cartão.
- **Hospedagem**: o servidor onde a instalação roda, contratado pelo Prestador ou pela empresa cliente, em `{{serverLocation}}`.

A lista de suboperadores em uso nesta instalação, com o serviço e a finalidade de cada um, está no Anexo II. Ela é preenchida por quem instala e é atualizada quando um serviço é ligado ou desligado.

## 6. Quem vê o conteúdo do workspace

O conteúdo do workspace é visto pelas pessoas que dele participam, conforme os papéis e as permissões que a empresa cliente define, e pelos agentes que ela autoriza.

A equipe do Prestador acessa a instalação apenas para operá-la e mantê-la: diagnosticar falhas, restaurar cópias de segurança, aplicar uma atualização ou cumprir uma obrigação legal. Esse acesso é restrito às pessoas que precisam dele e fica registrado. Nenhum desses acessos é usado para montar perfis, fazer publicidade ou treinar modelos.

## 7. Por quanto tempo guardamos

- **Dados da conta:** enquanto a conta existir. Quando a pessoa pede para excluir a conta no próprio Serviço, as sessões e os aparelhos saem na hora e o resto é apagado 7 dias depois, a menos que ela restaure a conta antes disso. As cópias de segurança somem no prazo do item 8.
- **Conteúdo do workspace:** enquanto o workspace existir, e antes disso quando alguém apaga um conteúdo específico. Quando o proprietário pede para excluir o workspace, ele fecha para todos na hora e o conteúdo é apagado 7 dias depois, a menos que um proprietário o restaure antes disso.
- **Mensagens de voz:** o áudio é apagado depois de `{{voiceRetentionDays}}` dias (90 por padrão). A mensagem e as palavras transcritas continuam.
- **Registros de uso de modelos** (tokens e custo): enquanto o workspace existir, porque orçamentos e relatórios de uso dependem deles.
- **Registro de auditoria:** enquanto o workspace existir, porque é ele que mostra quem fez o quê.
- **Registros técnicos (logs):** por `{{logRetention}}`, o prazo configurado na instalação, que é informado no Anexo II.
- **Códigos enviados por e-mail:** valem por 10 minutos e as linhas já usadas saem um dia depois.

Depois desses prazos os dados são apagados ou anonimizados, ressalvado o que a lei obrigar a guardar, como documentos fiscais e registros de acesso, e o que for necessário para defender um direito em processo, hipótese do art. 16, I e II, da LGPD.

## 8. Cópias de segurança

A instalação faz uma cópia de segurança do banco de dados por dia, guardada em um local separado. As cópias são mantidas por `{{backupRetentionDays}}` dias (14 por padrão) e depois apagadas automaticamente. Quando a empresa cliente opta por cifrar as cópias, a chave de leitura fica fora do servidor.

Um dado apagado pelo Serviço pode continuar em uma cópia de segurança até o prazo acima. Ele não é usado para nada e sai com a expiração da cópia.

## 9. Segurança

O tráfego entre o navegador ou o aplicativo e o servidor é cifrado por TLS. Os dados ficam no disco do servidor contratado, cifrado quando a infraestrutura contratada oferece cifragem em repouso. As credenciais de modelos, conectores e bancos de dados são cifradas com chave derivada do segredo da instalação, com envelope por credencial, e nunca são devolvidas aos clientes. O acesso à instalação é restrito e registrado.

Se o Prestador souber de um incidente de segurança que possa acarretar risco ou dano relevante às pessoas, ele comunica a empresa cliente e as pessoas afetadas, e a Autoridade Nacional de Proteção de Dados (ANPD), nos prazos que a LGPD e a regulamentação exigem.

## 10. Transferência internacional

A instalação fica em `{{serverLocation}}`. Os provedores de modelo e os serviços opcionais do item 5 podem tratar dados em outros países, sob os termos e as salvaguardas deles. Quando a transferência sair do Brasil, ela se apoia nas hipóteses do art. 33 da LGPD, em especial as cláusulas contratuais específicas, as cláusulas-padrão ou as normas corporativas globais do fornecedor.

## 11. Relatório de uso anônimo

A instalação pode enviar uma vez por dia um relatório de uso anônimo para o endereço de telemetria do projeto agentes.chat, do qual o DougBot deriva. O relatório leva contagens e tamanhos: quantas pessoas, agentes e computadores existem, quais modelos foram usados e quantos tokens, o tamanho das máquinas e o quanto os navegadores dos agentes trafegaram. Ele nunca leva mensagens, arquivos, nomes, e-mails, endereços, caminhos ou identificadores de pessoas, de workspaces ou de computadores. O único identificador é um número aleatório criado na primeira inicialização da instalação.

Esse envio é opcional. Ele é desligado por configuração da instalação (`TELEMETRY=off`) ou pelo interruptor em Configurações › Geral, disponível ao proprietário da instalação. Desligado, nada é enviado. O comando `agentes telemetry` mostra exatamente o que seria enviado.

## 12. Cookies e armazenamento local

O Serviço usa um cookie de sessão para manter a pessoa conectada. O navegador e os aplicativos guardam no próprio aparelho preferências como o idioma, o tema, o ícone do aplicativo e os rascunhos de mensagens ainda não enviadas. Não usamos cookies de publicidade nem de rastreamento entre sites.

## 13. Direitos de quem tem dados tratados

A LGPD garante à pessoa, entre outros, os direitos de confirmação de tratamento, acesso, correção, anonimização, bloqueio ou eliminação, portabilidade, informação sobre compartilhamento, informação sobre a possibilidade de não consentir e revogação do consentimento, além de petição à ANPD.

Como exercer cada um:

- **Confirmação e acesso:** o Serviço mostra o perfil e as preferências em Configurações › Sua conta, e o conteúdo do workspace a que a pessoa tem acesso. Para uma cópia organizada do que a instalação guarda sobre a pessoa, escreva para o encarregado, `{{dpoEmail}}`.
- **Correção:** nome, foto, fuso horário e idioma se corrigem em Configurações › Sua conta. A troca de e-mail tem um passo de confirmação por código.
- **Eliminação:** a pessoa exclui a própria conta em Configurações › Sua conta, e o proprietário exclui o workspace nas mesmas configurações. Os dois ficam restaurable até 7 dias antes de a exclusão se completar. Para apagar um conteúdo específico, use o próprio Serviço.
- **Portabilidade:** peça ao encarregado a exportação dos dados da pessoa, que será entregue em um formato legível por máquina.
- **Informação sobre compartilhamento:** esta Política e o Anexo II dizem com quem os dados são compartilhados. Um pedido específico pode ser feito ao encarregado.
- **Revogação do consentimento e oposição:** escreva para o encarregado, ou desligue no próprio Serviço a funcionalidade que dependia do consentimento.
- **Reclamação:** a pessoa pode reclamar à ANPD (https://www.gov.br/anpd).

Quando o pedido for sobre conteúdo do workspace, o Prestador encaminha à empresa cliente, que é a controladora, e a auxilia a responder, como o Anexo I prevê. O Prestador responde aos pedidos de que é controlador no prazo que a LGPD fixa.

## 14. Encarregado pelo tratamento de dados

O encarregado (DPO) do Prestador é `{{dpo}}`, e o contato é `{{dpoEmail}}`. Também é por esse endereço que se fala sobre esta Política e sobre o Acordo de Tratamento de Dados.

## 15. Crianças e adolescentes

O Serviço é para maiores de 18 anos. Não coletamos intencionalmente dados de crianças ou adolescentes. Se isso acontecer, avise o encarregado, e os dados serão apagados.

## 16. Alterações desta Política

O Prestador pode alterar esta Política. Uma alteração relevante é avisada com antecedência razoável pelos canais do Serviço, e a versão publicada nesta página é sempre a vigente. A data no topo diz quando ela mudou.

## 17. Contato

Dúvidas, pedidos e reclamações vão para o encarregado: `{{dpo}}`, `{{dpoEmail}}`.

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

Esta lista é preenchida por quem instala o DougBot e é atualizada quando um serviço é ligado ou desligado. Um serviço que não consta aqui não está ligado nesta instalação.

| Serviço | Para quê | O que recebe | Ligado? |
| --- | --- | --- | --- |
| Provedores de modelo contratados pelo Cliente | Responder, resumir e rotear as mensagens | O trecho de conversa e o contexto do turno | `{{modelProviderName}}` |
| Gateway do WhatsApp | Ler e enviar mensagens de WhatsApp | As conversas do número | `{{whatsappGateway}}` |
| Provedor de e-mail | Enviar convites, códigos e avisos | E-mail e nome de quem recebe | `{{emailProvider}}` |
| Armazenamento de arquivos | Guardar os arquivos do Drive e os anexos | Os arquivos do workspace | `{{storageProvider}}` |
| Serviço de mídia | Gerar imagens e vídeos | O pedido e as referências enviadas | `{{mediaProvider}}` |
| Voz ao vivo | Falar em uma chamada | O áudio da chamada | `{{liveVoiceProvider}}` |
| Transcrição de voz | Transformar áudio em texto | O áudio da mensagem de voz | `{{speechProvider}}` |
| Notificações no celular | Entregar o aviso no aparelho | O texto do aviso e o token do aparelho | `{{pushProvider}}` |
| Integrador de serviços | Conectar e-mail e outros aplicativos | O que a chamada do conector precisa | `{{integratorProvider}}` |
| Busca por significado | Encontrar textos por sentido | Os trechos indexados | `{{embeddingsProvider}}` |
| Relatórios de erro | Diagnosticar falhas | O erro, a pilha e a versão | `{{errorProvider}}` |
| Relatório de uso anônimo | Medir o funcionamento do projeto | Contagens e tamanhos, nunca conteúdo | `{{telemetryProvider}}` |
| Serviço de cobrança | Cobrar a implantação, quando houver | Dados de cobrança do Cliente | `{{billingProvider}}` |
| Hospedagem | Manter a instalação no ar | Tudo o que a instalação guarda | `{{hostingProvider}}` |

Os prazos de retenção desta instalação, para completar o item 7 desta Política: registros técnicos por `{{logRetention}}`, cópias de segurança por `{{backupRetentionDays}}` dias, áudios de voz por `{{voiceRetentionDays}}` dias.
