---
name: social-media-operacao
description: Como o social media leva cada conteúdo da ideia ao ar - as quatro etapas com aprovação explícita, o pedido à arte e ao vídeo, a subida ao portal de aprovação do cliente, versões novas, agendamento e a conferência da fila. Use em todo conteúdo que vai para as redes de uma marca, do pedido ao post publicado.
---
# Operação de social media: da ideia ao ar

## As quatro etapas

Todo conteúdo passa por quatro etapas, uma ativa por vez, e só avança com aprovação explícita da pessoa responsável ("aprovado"). Ninguém começa uma etapa antes de a anterior estar aprovada, nem "adiantando".

1. **Ideia.** Conceito, objetivo, formato e direção, em poucas linhas. Você apresenta no canal do time e pede "aprovar ideia" ou "ajustes".
2. **Copy.** O texto completo: por lâmina no carrossel (título, texto, CTA), o roteiro no vídeo, a legenda. Se a marca publica em outra língua, a copy vai na língua da marca com a tradução de apoio embaixo, para a pessoa aprovar as duas; só a língua da marca vai ao ar. Quem escreve é você, ou o CHESS quando a peça é de campanha.
3. **Execução.** A ROSA (arte) ou o SONY (vídeo) produzem com a ideia e a copy aprovadas, sem mudar o texto validado, e mandam para revisão.
4. **Aprovação final.** Aprovação do cliente no portal; aprovado vira pronto para publicar.

Regras:
- No cartão do conteúdo, marque a etapa atual ("Etapa 1 Ideia", "Etapa 2 Copy", "Etapa 3 Execução", "Etapa 4 Aprovação") e registre cada aprovação com quem aprovou, data, hora e versão.
- Ajuste pedido volta para a etapa certa, mantendo o histórico. Copy aprovada que mudar precisa ser aprovada de novo antes de mexer na arte ou no vídeo.
- Toda mensagem sobre um conteúdo diz em uma linha: etapa atual, responsável e próxima ação.

## Pedir arte e vídeo

- **À ROSA** (por `tell_agent` ou no canal): a marca, o tipo de peça, o texto literal por lâmina, as medidas, as fotos (com caminho completo ou link) e o canal onde o time revisa. Ela não escreve copy.
- **Ao SONY**: a marca, o material bruto, o roteiro aprovado, a duração, o formato (9:16 para reels e stories, 4:5 ou 1:1 para feed, 16:9 para YouTube) e o prazo.
- Pedido completo numa mensagem só: quem recebe não vê a sua conversa.
- Ao subir vídeo, registre quem editou: é isso que define para quem vai o ajuste. A informação é interna e nunca aparece para o cliente.

## Subir para aprovação do cliente

Com o portal de aprovação ligado:
- `portal_board` mostra as marcas e, de uma marca, cada post com o estado, a data, o que falta, o que o cliente pediu de ajuste e o link do post. `portal_work` mostra o que cada pessoa tem para fazer e o cronograma.
- `portal_card` cria e muda o cartão do que ainda vai ser feito (o calendário).
- `send_for_approval` sobe um post novo; `send_new_version` sobe a versão nova de um post que o cliente mandou ajustar, no mesmo post, com a linha do que mudou (o cliente lê essa linha).
- Arquivo que está no computador vai antes para o Drive com `upload_file`.
- Peça de design aprovada na revisão ligada a uma tarefa do portal sobe sozinha: não suba de novo nem duplique.
- No portal não existe segundo caminho: se uma ferramenta falhar, diga em uma frase o que falhou a quem pediu e pare.

Sem portal ligado: entregue no Drive, numa pasta por marca e por mês, e peça a aprovação no chat com a peça anexada.

**Subir nunca trava.** Suba na hora com o que tiver: vídeo sem capa sobe com um quadro do vídeo como capa provisória; sem legenda, legenda vazia; sem título, um título curto tirado do que está escrito no conteúdo; sem data, sem data; sem saber quem editou, sem editor. Diga numa frase o que ficou pendente e complete depois no mesmo item. Nunca espere a capa, a legenda ou uma resposta para subir.

**Reel não é carrossel.** No reel, a mídia é só o vídeo; a capa vai no campo de capa. Capa enviada como segunda mídia vira uma lâmina "2/2". Capa e post vão juntos para aprovação.

**O que sobe:** para aprovar, uma prévia leve de boa qualidade (vídeo que abre pausado, com barra); para publicar, o arquivo final em alta.

## Agendar e publicar

- Só agende o que o cliente aprovou no portal. Aprovado em lote pela pessoa responsável vale para o lote inteiro; o que não foi liberado continua esperando.
- Agende no agendador de redes ligado ao workspace, com o fuso da marca e o horário da skill de marca. Reel só com a capa junto; sem capa, pare e pergunte.
- Use exatamente o arquivo da versão aprovada mais recente (uma versão nova pode ter ajustes de voz e imagem que os arquivos antigos não têm), sem recomprimir.
- Agende com margem: um horário pode vencer enquanto a confirmação espera. Depois de criar, confira no agendador que o post existe, uma vez só, com a mídia e a capa certas. Antes de reenviar, procure duplicata.
- Reagendar é mudar no agendador e no portal.
- Todo aviso de post agendado vai com o link daquele post no agendador.
- Publicado é o estado da rede mais o link público; "publicando" no horário ainda não é publicado.
- Post com automação de comentário para DM: o gatilho fica no post específico; depois de publicar, ligue e teste a automação.
- Publicar, apagar post já publicado e qualquer gasto continuam esperando o ok da pessoa responsável.

## Conferência da fila

Todo dia, para cada marca: a fila dos próximos 7 dias (fila vazia nas próximas 48 horas é o primeiro aviso, em destaque); o que o portal tem como agendado e já foi publicado (marque e avise); o aprovado que não está na fila; e o que está na fila sem aprovação. Sem mexer em nada sem o ok.

## Arquivo

Conteúdo aprovado e publicado vai para o Drive, numa pasta por marca, mês e conteúdo, com o arquivo final e a legenda. Nunca arquive o que ainda está em andamento.
