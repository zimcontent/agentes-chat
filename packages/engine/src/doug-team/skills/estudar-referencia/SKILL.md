---
name: estudar-referencia
description: Estuda um vídeo de referência quadro a quadro (link ou arquivo) para copiar a técnica de edição e motion. Transforma o vídeo em folhas de contato e tiras com timecode carimbado, mede ritmo, legenda, tipografia, transições, câmera, cor e som em quadros, pixels, hex e LUFS, e termina numa receita replicável. Use em "estuda essa referência", "estuda em detalhes", "quero o motion igual a esse", antes de editar algo "no estilo de".
---
# Estudar uma referência quadro a quadro

Você não tem entrada de vídeo. Transforme o vídeo em IMAGENS com timecode carimbado e em TEXTO (cortes e transcrição por palavra) e leia as imagens. Nunca descreva algo que não viu numa imagem lida; cite sempre timecode e número do quadro.

## Preparar

- Pasta própria do estudo, fora da pasta das skills. Ferramentas: ffmpeg com `drawtext`, `tile` e detecção de cena, ffprobe, yt-dlp, um transcritor com tempo por palavra.
- Link: baixe em 1080p, preferindo 50 ou 60 fps (cada passo da animação aparece). Não baixe legendas do serviço (bloqueiam); transcreva local. Download bloqueado: peça o arquivo, não procure contorno.

## Estudar, nesta ordem

1. **Ficha**: fps nativo, resolução, duração.
2. **Visão geral**: folhas de contato 5x4, um quadro a cada 2 s (vídeo longo: a cada 3 a 5 s); no gancho, uma folha mais densa (a cada 0,5 s nos primeiros 90 s). Leia todas.
3. **Ritmo**: cortes por minuto, duração dos planos, tempo de cada corte; gancho contra o resto.
4. **Fala**: transcrição por palavra (para medir se um texto entra antes ou depois da palavra).
5. Liste os **momentos que importam**: cada entrada e saída de texto ou grafismo, transição, efeito, zoom, corte na batida.
6. **Tira quadro a quadro de cada momento, no fps nativo** (todos os quadros de ~1 s numa grade, cada um com timecode e número do quadro; no máximo 60 a 90 quadros por tira).
7. **Prints em resolução cheia** só para ler texto, tipografia e detalhe.
8. **Cores**: hex de regiões medidas num print.
9. **Som**, se importar: separe voz e música, meça loudness integrado, de curto prazo, pico e faixa dinâmica, e mapeie efeitos e o tempo de cada um.

## Regras

- Tiras sempre no fps nativo, sem pular quadro.
- Meça em quadros e ms ("o texto entra em 4 quadros, 67 ms, com ultrapassagem"; "a legenda troca 0,3 s antes da palavra"). Descrição vaga ("a faixa se abre") não serve: "faixa atravessa o rosto e abre em 0,5 s, a câmera empurra".
- Não deu para ver: faça uma tira mais curta ou um print, não chute.
- Leia as imagens em paralelo; folhas a ~384 px e tiras a ~320 px já são legíveis.
- Página HTML local para capturar quadros: sirva por servidor local e espere a página assentar antes do primeiro quadro.

## A análise (entrega)

Folhas, tiras, prints, cortes, transcrição e um documento com:
- **Ritmo**: cortes por minuto, plano médio e mediano, gancho contra o resto.
- **Legenda**: tipografia, peso, caixa, cor, posição, palavras por bloco, quando aparece.
- **Cada tipo de texto, grafismo e motion**: como entra e sai (em quadros), easing, duração, cor em hex, tipografia, posição, citando a tira que prova.
- **Transições e câmera** medidas.
- **Som**: origem da trilha, relação voz e música, efeitos e seus tempos, loudness.
- **A gramática** (o que se repete do começo ao fim) e **como levar ao nosso motion** (o que copiar, com que ferramenta).
- No fim, uma **receita** para replicar o estilo com a paleta e a tipografia da marca do pedido.

## Exemplo de gramática extraída (anúncio de produto em motion)

Útil como modelo do nível de detalhe esperado:
1. **Passagem por transformação**: um elemento da cena vira a próxima (ponto vira fundo, onda do clique vira cortina, anel vira círculo gigante). Poucos cortes secos, e esses na batida.
2. **Uma ideia por tela**: palavra grande centralizada e um elemento de apoio, muito ar.
3. **Texto em 3 estados**: digita espaçado e colorido, assenta em peso forte escuro, ganha um detalhe (ponto, traço, faísca).
4. **Hierarquia de peso**: contexto leve e cinza, palavra-chave forte; a palavra antiga desbota (~30% em 3 quadros) quando a nova entra.
5. **Fundo sempre vivo**: grão, formas desfocadas flutuando, palavra gigante tom sobre tom, brilho radial. Nunca cor chapada parada.
6. **Cursor que clica de verdade**: aproxima, aperta (escala ~0,9), onda sai do ponto do clique, o clicado reage.
7. **Cortinas de cor** subindo de baixo com motion blur, alternando claro e escuro a cada 2 ou 3 telas.
8. **Easing**: entra muito rápido, assenta macio com leve ultrapassagem; motion blur em tudo que se move rápido; micro vida no que está parado.
9. **Paleta**: 3 cores e 1 acento.
10. **Ritmo** medido: ~30 trocas por minuto, plano mediano ~1,6 s, troca de ideia a cada 1 a 2 s no fim, puxando para o fecho; cada palavra-chave da narração aparece na tela no mesmo instante.

## Biblioteca de estilos

Todo estilo aprovado vira uma entrada numerada na biblioteca de estilos do workspace: um GIF de ~6 s, uma amostra com som, a receita e o que não pode mudar. Quando alguém perguntar "qual estilo usar", mande os GIFs numerados para a escolha. A biblioteca cresce a cada edição aprovada.
