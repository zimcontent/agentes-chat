---
name: edit-falando
description: Edit premium de uma pessoa falando para a câmera (bruto do celular ou da câmera, horizontal ou vertical) em 9:16 tela inteira, do bruto ao MP4. Corte pela fala, câmera virtual, letreiros do começo ao fim, palavra atrás da cabeça, número digitado, telas cheias, B-roll, trilha e efeitos. Inclui a variante de lettering em cascata com zooms e ícones. Use em "edita esse vídeo", "transforma em reels", "corta as pausas", "faz igual ao último com esse bruto novo".
---
# Edit falando premium

Um motor faz o pesado (corte, câmera, letreiros, recorte da pessoa, telas cheias, mixagem, montagem). Você decide o que fica e escreve o roteiro do vídeo: o que vira letreiro, onde a câmera anda, o que vai atrás da cabeça, onde entra tela cheia e som. Confere por imagens antes e depois do render.

Pergunte só o que o material não responde: edit falando (tela inteira) ou tela dividida, se a pessoa disse só "edita"; nomes próprios e marcas com a grafia certa (ou leia o glossário da skill de marca); se quer trilha e B-roll. Cores, tipografia, níveis e estilo vêm da skill de marca e desta receita.

## 1. Fluxo

1. **Projeto**: normalize o bruto (fps constante, rotação, áudio alinhado, HDR do celular para cores normais).
2. **Transcrição por palavra**, com os termos da marca como dica para o transcritor.
3. **Proposta de corte** (não mexe no vídeo): pausas longas viram respiro curto (~0,15 s); sobra antes da primeira palavra ~0,12 s e depois da última ~0,6 s; falso começo e tomada repetida (fica sempre a última tomada completa); vícios e som sem fala como opcionais.
4. **Você aprova**: pausas e cortes de confiança alta, aplique. Confiança média: leia o texto que sai e o que vem antes e depois; repetição de propósito ("Não. Não é isso.") fica. Leia a transcrição inteira: frase refeita com outras palavras o script não percebe, marque à mão.
5. **Aplicar o corte** seguindo a skill `corte-pela-forma-de-onda`. Diga à pessoa quanto saiu ("tirei 9,8 s: duas pausas longas e um começo repetido").
6. **Plano a plano**: onde o rosto fica na saída e quanto sobra de cada lado. É essa tabela que diz onde cabe texto.
7. **Trilha e B-roll** (opcionais, skill `som-do-video` e seção 5).
8. **Roteiro** (seção 2).
9. **Stills de teste** em cada tratamento. Corrigir aqui custa segundos; depois do render, minutos.
10. **Recorte da pessoa** só onde há texto atrás da cabeça.
11. **Render**, **mix** (-14 LUFS, pico -1,2 dBTP) e **montagem**.
12. **Conferir**: folha de quadros, quadro antes e depois de cada corte, revisão de todos os quadros procurando pulo fora de corte e piscada de um quadro.

Ajuste só de som: refaça mix e montagem, sem render. Ajuste de texto: stills, render só dos trechos afetados, mix e montagem. Mudou o corte: refaça do corte em diante, porque todos os tempos mudam.

## 2. O roteiro

Tempo de tudo = início da palavra falada. Confira a grafia de cada palavra que vai para a tela.

**Câmera**
- **Troca de plano é corte seco**: sem zoom de entrada, sem borrão, sem flash. Cada plano entra parado e deriva devagar (zoom +0,03 a +0,06).
- Em jump cut no mesmo enquadramento, o zoom alterna (1,00 e ~1,12) para o corte parecer troca de câmera. Nenhum corte com o mesmo enquadramento dos dois lados.
- Movimento só: pan lateral com easy ease de 1,0 a 1,2 s entre blocos, ou empurrão (zoom +0,08 a +0,12 em ~0,7 s) numa frase forte. Motion blur e whoosh no movimento.
- Posição do rosto: ~0,70 da largura (rosto à direita, bloco à esquerda), ~0,30 (o contrário), ~0,82 a 0,87 (palavra grande ao lado do rosto), 0,50 em plano fechado. O rosto nunca sai do quadro.
- Keyframe de câmera no instante EXATO do corte. Arredondar o tempo do corte dá piscada de um quadro.
- Zoom forte em selfie fechada amolece o rosto e deforma o corpo: evite. Não passe de ~1,30 em imagem de celular. Varie os movimentos; zoom idêntico repetido cansa.

**Letreiros: texto do começo ao fim, variando o tratamento a cada ~5 s.** Nunca dois tratamentos no mesmo lugar ao mesmo tempo.
- **Legenda corrida** nos trechos sem outro letreiro: blocos de 1 a 3 palavras, nunca termina em artigo ou preposição, nunca atravessa corte, branca e sem caixa salvo a marca dizer outra coisa.
- **Palavra forte**: a palavra que carrega o sentido sobe com desfoque, 1 a 5 quadros antes da sílaba.
- **Bloco (lock-up)**: todo texto de 2 ou mais linhas é uma caixa encaixada: cada linha ganha o corpo que a faz ocupar a mesma largura, entrelinha óptica apertada. Quebre em linhas curtas para o corpo ficar grande. Termo-chave em peso forte ou serifa de destaque, nunca no peso leve; o leve fica para as ligações ("que", "e não", "como um").
- **Palavra atrás da cabeça** (com recorte): use bastante, 4 a 5 por minuto. Plano aberto: palavra ao lado, o fim entrando atrás da cabeça. Plano fechado: na altura da testa, num canto, alternando os lados, nunca cruzando os olhos nem centralizada. Por cima da pessoa só aparece um contorno fino (~1 px).
- **Número digitado** em todo número falado, com som de teclado.
- **Nome e cargo** (lower third): a única coisa abaixo da boca.
- **Zona segura** em 1080x1920: nada acima de y ~240 nem abaixo de y ~1340 (exceto o nome, na faixa 1300 a 1490); abaixo de y ~1110 a coluna de curtir e comentar ocupa a direita (pare em x ~887) e texto centralizado centra em x ~478.
- **Nunca palavra curta sozinha numa linha** (até 4 letras: artigo, preposição, conector). Junte com a vizinha ou tire o letreiro. Exceção: termo-chave grande e colorido. Checagem automática antes de todo render.
- **Cada letreiro fica pelo menos ~0,6 s legível**; o som de digitação termina junto com a última letra.
- **Lista falada** (20, 30, 40): cada item entra sozinho, no instante em que é falado, com movimento e som próprios.
- Bloco lateral colado na cabeça: calcule a posição pela cabeça real de cada plano, não por uma coluna fixa.
- Tempos dos letreiros: alinhe à voz final (alinhamento forçado) e confira que cada letreiro entra quando a primeira palavra dele é falada.
- Nada de promessa, número ou afirmação que a pessoa não falou. Termos da marca com a grafia do glossário e nunca partidos em dois blocos.

**Telas cheias** (1 a 3 por minuto, corte seco na entrada e na saída): B-roll do assunto exato, mesa vista de cima com documentos gerados em código e recortes de papel com sombra (marca fictícia, valores sensíveis desfocados, nunca imitar banco, app ou jornal real), insertos 3D nos picos de sentido (número rolando, lista de três em cartões, conceito-chave em tipografia extrudada, logo que monta e explode no encerramento). Inserto de tela cheia de 0,8 a 3 s, no máximo ~4 num vídeo de 40 s, nunca o mesmo tipo duas vezes seguidas, nunca no mesmo instante de outro letreiro.

**Sons pontuais**: impacto grave em parte das palavras atrás da cabeça (nunca em duas seguidas), riser antes da virada emocional, notificação em mensagem citada, papel na mesa. Cliques de letra e whoosh de câmera são automáticos. Níveis na skill `som-do-video`.

## 3. Variante: lettering em cascata com zooms

Para vertical falado já cortado (com B-roll), quando a marca pede um look de lettering grande sobre o vídeo:
- **Quase sempre há um lettering na tela**, um bloco por ideia (2 a 4 s): linha pequena com a frase de apoio, palavra grande com o conceito (número, verbo forte, nome), entrando letra a letra em cascata com desfoque. Cor de alerta só para choque ou negativo, no máximo 3 ou 4 vezes no vídeo.
- **Gancho**: o número ou a frase-choque do começo é o primeiro bloco, desde o quadro 0.
- **Zooms**: um movimento a cada 1 a 3 s. Punch-in curto (0,25 a 0,45 s) na palavra forte, volta mais lenta (0,6 a 0,8 s), zoom-out 1,2 a 1,0 logo depois de cada corte para o rosto, push lento no B-roll.
- **Motion de ícones** quando a fala descreve uma transformação concreta (velho para novo, problema para solução, dinheiro entrando): cada etapa no tempo da palavra (entrada na primeira menção, quebra no verbo, troca no "no lugar", brilho no "nova"). Fundo borrado e escurecido ~20% atrás do ícone.
- Próximo bloco na outra posição (topo ou base) quando entra antes de o anterior terminar de sair.
- Drop da trilha alinhado com um corte forte (o primeiro corte para o B-roll costuma funcionar).
- Entregas extras quando pedidas: stems (mix, voz, música já com ducking, efeitos) do tamanho do vídeo e letterings em vídeo com alfa.

## 4. B-roll

1 a 3 momentos por minuto em que a fala cita algo concreto (lugar, objeto, ação). Busca em inglês e concreta. Olhe os candidatos e escolha o do lugar e do assunto exatos da fala; fiel ao público da marca. Nada de pessoa reconhecível em contexto que a constranja nem marca em destaque. Recorte 9:16 no fps do projeto, sempre a 1,0x (nunca câmera lenta para esticar), 1,5 a 3 s, entrando num corte ou numa pausa, com a legenda corrida por cima. B-roll ampliado mais de 1,5x fica mole: escolha outro. Guarde créditos e licença; a do Pexels permite uso comercial, não revenda sem alteração. Lugar citado na fala pede B-roll, mapa ou motion daquele lugar. Tela de aparelho em branco no B-roll: troque a tela no próprio clipe.

## 5. Checklist de entrega

- [ ] Corte: nenhuma pausa longa sobrando, nenhuma palavra comida, nenhuma tomada repetida.
- [ ] Antes e depois de cada corte: sem borrão, duplicação, pulo ou piscada; nas emendas o enquadramento muda.
- [ ] Rosto inteiro em todos os planos; nenhuma palavra cruzando olhos ou boca.
- [ ] Toda caixa de 2 ou mais linhas encaixada; termo-chave em peso forte; nenhuma palavra curta sozinha.
- [ ] Nada fora da zona segura (exceto o nome).
- [ ] B-roll do assunto certo, a 1,0x, com legenda; créditos guardados.
- [ ] Grafia de nomes e marcas como no glossário; palavras duvidosas apontadas na entrega.
- [ ] -14 LUFS, pico até -1 dBTP; vídeo e áudio com a mesma duração.
