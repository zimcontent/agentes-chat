---
name: motion-premium-kinetic-type
description: Motion design premium de kinetic type com textura e luz, palavra por palavra, cursor de digitação, câmera 3D com profundidade de campo e motion blur, vidro desfocado flutuando e troca de palco claro e escuro em corte seco no pico do chicote. Serve para explicador em motion puro, demo de produto ou motion sobre gravação de pessoa falando (16:9 ou 9:16). A paleta (preto, branco e UM acento) vem da skill de marca. Use para "motion premium", "kinetic type", "motion com câmera 3D", "motion claro e escuro".
---
# Motion premium de kinetic type

O motor pode ser um compositor no estilo After Effects rodando sem janela (After Effects) ou composição por código (HyperFrames com GSAP). O que importa é capturar tudo o que faz o look.

## O que faz o look

- **Tipografia com textura, pequena e de cinema**: uma grotesca pesada para impacto (tracking negativo), uma serifa itálica para palavra elegante ou emocional, uma sans média pequena para apoio, sempre as famílias da skill de marca nesses papéis. Palco escuro: degradê prateado vertical na letra, bisel leve e sombra suave. Palco claro: tinta quase preta em degradê e sombra longa bem suave. Por cima de tudo: brilho leve (escuro), vinheta radial e **grão monocromático** (~0,30 no escuro, ~0,18 no claro). Grão e bisel são a textura: nunca texto chapado de HTML. Tamanhos contidos: kicker 64 a 92 px, título 128 a 196, apoio ~54.
- **Entradas palavra por palavra**: digitação letra a letra (0,035 a 0,045 s por letra) com **cursor** na cor de acento (sólido enquanto digita, pisca 1 s parado, segue a camada ativa); ou fade de 0,10 a 0,14 s com deslize ou dolly e mola (~12% de ultrapassagem, assenta em ~0,6 s) e desfoque gaussiano limpando em ~0,22 s. Palavras entram 1 a 5 quadros antes de serem faladas.
- **Câmera 3D**: pivô (posição e órbita) com câmera filha (dolly) e foco animado; curvas easy ease, saída, entrada, encaixe rápido. Uma deriva constante por cima: nunca parada morta. Cada cena termina num chicote (aceleração para um pan ou giro grande nos últimos 0,15 a 0,25 s) e a seguinte abre saindo de um chicote: **o corte seco no pico do chicote some no motion blur**.
- **Profundidade**: profundidade de campo ligada, íris redonda; vidros flutuantes (sequência 3D de vidro em preto e branco) muito desfocados no primeiro plano e no fundo; poeira nas cenas escuras.
- **Motion blur em tudo**: obturador de 180 a 270 graus, muitas amostras, inclusive nas pré-composições dentro da principal. Um borrão de 180 graus em que a palavra ainda está borrada no quadro do pouso e nítida no seguinte costuma agradar.
- **Palcos**: claro = degradê radial branco, manchas de luz na cor de acento (multiplicar) derivando, ponto quente branco; escuro = fundo escuro da paleta, poça de luz branca fraca, reflexos na cor de acento, arco fino opcional. Claro e escuro alternam por cena em corte seco no movimento. Disciplina de paleta: preto, branco e UM acento. Acento saturado (azul, por exemplo) pesa nas manchas sobre o claro: use ~0,6 da opacidade.
- **Ritmo**: ~2 eventos por segundo (cada palavra ou entrada ganha uma reação de câmera: empurrão, punch, pan, recuo, troca de foco). Cenas de 2 a 4 s.

## Fluxo

1. **Ficha de cenas**: a partir do roteiro ou da fala com tempos por palavra, uma linha por cena (duração, palavras, palco claro ou escuro, movimento de câmera, elemento de apoio). Escolha a paleta pela skill de marca.
2. **Partes curtas** (2 a 7 s cada), uma composição por cena e uma principal por parte; confira margem de pelo menos ~120 px e nenhuma sobreposição.
3. **Folha de quadros-chave** (herói e meio do movimento de cada cena), compare com a referência aprovada e **mande a folha a quem pediu e espere o ok** antes do render.
4. **Render das partes em paralelo**, na máquina ou na nuvem (o que for mais rápido; nuvem em pedaços com contagem de quadros e um pedaço comparado localmente; falhou, volta para a local). Os arquivos de tipografia precisam ir junto com o projeto para o render remoto.
5. **Som separado**: voz, trilha e efeitos no tempo dos eventos; trilha cortada no fim, sem cauda. Total termina na última fala.
6. **Exportação** (HEVC ou H.264, 30 fps, AAC) e **QC**: quadros nos cortes e entradas, rostos e margens.

## Sobre gravação de pessoa falando (vertical)

Alterne três jeitos, nunca recorte o vídeo inteiro:
1. **Motion em tela cheia**, escuro e claro, cortes secos no pico do chicote.
2. **Gravação original sem recorte**, com o texto no espaço acima da cabeça, sombra suave no topo; no chicote, a imagem ~50% maior para não mostrar borda.
3. **Recorte só no destaque** (normalmente o fechamento): palco escuro e palavra grande atrás da cabeça.

Nada sobre o rosto. Para trocar a gravação no projeto, gere os quadros como cópias reais (atalho faz o motor ler só o primeiro quadro e a imagem congela). No QC, compare quadros na região do rosto para provar que a gravação se mexe.

Som em vídeo de perfil pessoal costuma pedir trilha baixa (~15 dB abaixo da voz) e efeitos discretos; registre o nível aprovado na skill de marca.

## Armadilhas

- Expressões e cálculos de quadro usam a taxa do projeto, nunca um número fixo.
- No motion blur de composição por código, transformação 3D (perspectiva, giro em Y, profundidade) pode zerar o borrão: use x, y, escala e rotação 2D. Vídeo com início próprio não pode ficar dentro de um contêiner com início próprio: anime o vídeo direto. O modo de captura do borrão pode deixar fantasma em texto com zoom; compare as variantes lado a lado num trecho real antes de trocar.
- Montagem das cenas é o gargalo, não o render: tenha cenas-modelo prontas.
