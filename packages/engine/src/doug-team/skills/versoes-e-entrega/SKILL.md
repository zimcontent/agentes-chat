---
name: versoes-e-entrega
description: Como um vídeo sai do QG de Vídeo: revisão pelo time, ajustes por minutagem como versão nova na mesma revisão, aprovação do cliente pelo portal quando ligado, entrega no Drive, versões no Frame.io sem perder comentários e o que guardar depois. Use ao mandar qualquer versão de vídeo, ao receber notas, ao subir versão nova no Frame.io e ao entregar o aprovado.
---
# Versões e entrega

## 1. Mandar para revisão

- Toda versão de vídeo vai para a revisão do time com `send_for_review`: o vídeo enviado à conversa ou ao Drive (cópia de revisão abaixo de ~50 MB: H.264, até 1080 de largura, bitrate que caiba), o título como o time chama o vídeo, o cliente e uma ou duas linhas do que é ou do que mudou. Preencha o briefing (o pedido nas palavras de quem pediu e a direção dada, ou "sem direção: mesmo look do aprovado X") e os links (tarefa, material bruto, pasta de entrega) com `set_review_brief` quando faltar.
- Responda com uma frase e o link que a ferramenta devolveu. Nada de caminho de arquivo, nome de ferramenta ou termo técnico para pessoas.
- Nunca mande só o caminho: o vídeo vai anexado ou na revisão.

## 2. Ajustes

- As notas chegam por segundo da versão vista, com texto ou voz. Para cada nota: o tempo, as palavras da pessoa e quem resolve.
- Converta o tempo da versão vista para o tempo da montagem atual; mudou o corte, gere a tabela de-para e reescreva o que dependia dos tempos.
- Mude só o que foi pedido e o que o pedido quebrou em volta, teste com stills e gere a versão seguinte (número simples: 1, 2, 3).
- **A próxima versão vai na MESMA revisão** (`review_id`), nunca numa revisão nova.
- Nota ambígua ("deixa mais dinâmico"): proponha 2 ou 3 leituras numeradas e pergunte qual.
- Nota que vale para os próximos vídeos ("sempre faz assim"): proponha a lição para a skill de marca; grafia corrigida vai para o glossário da marca.
- Ajuste só de som não renderiza a imagem.

## 3. Aprovação do cliente e entrega

- **Aprovado pelo time** com o portal de aprovação do cliente ligado: a peça segue para o portal (o próprio produto sobe quando a revisão está ligada a uma tarefa do portal; senão, `send_for_approval` quando uma pessoa do time mandar subir). Vídeo vai com a capa no campo de capa, nunca como segunda mídia; capa é da ROSA.
- **Sem portal**: entregue a versão final em alta no Drive do cliente e avise no chat com o link.
- **Nunca publique, agende ou mande ao cliente final** por conta própria: um humano decide. Antes de qualquer ação externa, confira o que já foi feito (já subiu? já existe a pasta?) para não duplicar.
- Link do Drive (pasta ou arquivo): use o conector do Drive, não o navegador. Sem acesso, peça que compartilhem a pasta com a conta do workspace.
- Pedido que veio de outro agente: o resultado volta para ele, com o arquivo.
- Nomes de arquivo no padrão da marca (idioma, numeração, tema).

## 4. Frame.io: versão nova sem perder comentários

1. Ache a pasta do vídeo original no projeto (nunca a raiz do projeto).
2. Suba a versão nova nessa mesma pasta, com o mesmo nome se quiser (o "_v2" no nome é cosmético; o versionamento do Frame.io é independente). Espere o upload terminar e recarregue a pasta.
3. Empilhe como versão: arrastando o arquivo novo sobre o card do original na visão de lista, ou selecionando os dois e pedindo ao assistente do Frame.io para criar a pilha de versões (leia o que ele vai fazer antes de permitir).
4. Confira: um card com "V2", a data mais nova, tocando; os comentários do original continuam na V1. O status do original (aprovado, agendado) pode não passar para a V2: avise quem marcou.
5. Só depois apague uma cópia antiga solta, se houver (ela fica um tempo na lixeira). Navegador compartilhado: faça esses passos quando nenhum outro trabalho estiver usando o mesmo navegador.

## 5. Depois de aprovado

- Guarde a versão aprovada na pasta de entregas do pedido, sem apagar nada do pedido.
- Estilo novo aprovado entra na biblioteca de estilos (GIF numerado de ~6 s, amostra, receita).
- Registre na memória do time o que foi entregue, onde e o que ficou pendente.
- Relatório curto: o que entrou, o que mudou, o que não foi verificado (som, movimento) e créditos gastos, se houve.
