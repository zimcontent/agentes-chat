---
name: documentario-e-vlog
description: Edição e motion de vídeo horizontal de fala em movimento (vlog de viagem, documentário, opinião, walk-and-talk): base cortada por palavra, cor consistente, palavra-tese gigante atrás do corpo com rotoscopia, texto que entra em "decode", fitas e mundo de papel nas provas, legenda e tradução, trilha nova a cada vídeo. Use para vlog, documentário ou vídeo de opinião 16:9 com grafismo editorial.
---
# Documentário e vlog com motion editorial

## A ideia

1. **Quem dá o ritmo é o grafismo, não o corte.** Uns 10 cortes por minuto no corpo, planos de fala de 3 a 6 s; a cada 5 a 15 s entra um texto, uma fita ou um papel. O gancho é mais rápido (~24 cortes por minuto).
2. **Uma palavra-tese gigante por bloco, ATRÁS do corpo.** Sans pesada branca a 18 a 25% da altura, no meio do quadro, com o corpo cobrindo 1 a 3 letras e a palavra ainda legível. Só em plano médio ou aberto, com céu ou parede lisa atrás.
3. **Texto em "decode"**: as letras entram fora de ordem com glifo trocado e fecham em ~0,3 s, começando 0,3 a 0,5 s antes da palavra e fechando nela. Sem escala, slide ou bounce. A saída é no corte.
4. **A cor dos títulos vem do cenário** (o tom da fachada, o azul do vidro, o vermelho do telhado), medida no quadro; o padrão é branco. A paleta da marca entra nos elementos de marca.
5. **Prova = mundo de papel**: quadriculado claro, vinheta, recortes com borda branca caindo com sombra, deriva de câmera. Ali a trilha fica em silêncio e cada objeto tem foley: é o único lugar de efeito forte.
6. **Legenda** em caixa alta, branca, sem caixa de fundo, em blocos de 3 a 5 palavras, só no gancho, nas traduções e nas piadas; o monólogo na língua do vídeo fica sem legenda (salvo a marca pedir legenda corrida).
7. **Tradução de fala estrangeira**: fala séria é tradução fiel. Em tom de humor a marca pode pedir tradução livre e engraçada; o dado (preço, prato, sim ou não) continua certo e ninguém zoa sotaque ou etnia. Transcreva o trecho estrangeiro no idioma original (transcritor configurado em português traduz sozinho). Vale para o texto na tela e para o .srt.
8. **Trilha nova em todo vídeo**: registre as faixas usadas e confira antes de escolher. Busque faixas parecidas com uma referência pelo próprio catálogo (busca por similaridade). No estilo documentário, cordas e violão em blocos (~23% do tempo), ~17 dB abaixo da voz, subindo no fechamento.

## Fluxo

1. **Ingestão**: inventário das câmeras (confira o relógio de cada uma), transcrição palavra a palavra, folhas de contato.
2. **Base**: gancho, vinheta, abertura, o conteúdo em ordem, fecho. **Seja assertivo no corte** já na primeira base: tire takes fracos, repetições, conversa sem informação e bastidor, e liste o que saiu e por quê, sem virar corte frenético e sem comer fala (skill `corte-pela-forma-de-onda`; respiro de pelo menos ~0,18 s antes e ~0,22 s depois da fala; pausa abaixo de ~0,9 s fica).
3. **Voz**: isolamento de voz moderado e sincronia conferida em 0 ms.
4. **Cor** (seção abaixo), com prints antes, só balanço e final para aprovação antes do render.
5. **Roteiro de motion** por bloco: a palavra-tese (gigante, atrás), o título de capítulo (decode em duas linhas, na cor do lugar), as listas (fitas, uma por palavra), os números (contador ou conta no papel). Números falados vêm por extenso na transcrição. Densidade de 2 a 3 intervenções por minuto no corpo, mais no gancho. **Nunca dois textos grandes na mesma tela**, nunca legenda embaixo de um decode no terço inferior, **um elemento nunca atravessa um corte de câmera**.
6. **Render das peças** com alfa no MESMO fps da base, e confira parado antes.
7. **Rotoscopia** só nos trechos com palavra atrás.
8. **Composição**, **som** e **mix** (-14 LUFS, pico até -1 dBTP).
9. **QA**: tiras quadro a quadro de toda peça; o decode fecha na palavra, o corpo cobre só 1 a 3 letras, o texto não cobre rosto, nenhuma fita cortada na borda, nada atravessa corte. Compare lado a lado com a referência.
10. **Entrega**: thumbnail, título, descrição com capítulos e .srt quando for YouTube.

## Rotoscopia (regras para não errar)

1. **Borda seca** (~2,5 px de rampa, sem feather). Borda larga ou borrada foi reprovada. Borda macia só em motion blur forte.
2. **Nada de buraco no corpo**: o recorte costuma tirar alça de câmera ou bolsa, o ombro sob a alça e a mão borrada, e a letra aparece através do corpo. Tape esses pontos com um segundo modelo de recorte de pessoa.
3. **Vão real continua vão**: o espaço entre braço e corpo mostra o fundo.
4. **QA obrigatório**: folha de todos os quadros sobre magenta, com zoom nos piores (ombro, alça, mão, chapéu, cabelo). Se não passar, ajuste os pontos do recorte, ou mova ou encurte o texto, ou troque de plano. Nunca entregue com defeito na região do texto.
5. **Escolha do plano**: pessoa inteira no quadro, fundo sem outras pessoas coladas; mão rápida cruzando o texto por muitos quadros é o caso mais difícil.

## Cor

Padrão consistente em todo vídeo da série, aprovado uma vez e reaplicado: transformação de espaço de cor do log, exposição por cena (internas pelo sujeito), **balanço de branco pelos neutros ANTES do LUT**, LUT de filme a ~70%, curvas, brilho só nas altas luzes, difusão leve, saturação um pouco abaixo. Registre os números na skill de marca.

## Regras de ouro

- Nunca comer início ou fim de fala; ritmo com respiro (B-roll de 3 a 6 s, corte rápido só no gancho); uma câmera por momento.
- Nada mudo: B-roll com som ambiente baixo; B-roll com fala de fundo picada vai só com trilha; música com direitos ao fundo é mutada.
- Grafismo nunca sobre o rosto de quem fala; texto nunca cortado; confira no quadro real.
- Visual premium (papel, textura, grão, aberração leve, animação a 12 qps nos recortes), nunca cara de HTML; sem emoji no vídeo.
- Fatos conferidos (lugares, nomes, preços).
- Texto com contorno: contorno por baixo, preenchimento por cima.
- Toda correção vira regra no motor ou no roteiro (reproduzível), nunca remendo no arquivo final.

## Estudar uma referência nova

Baixe em 50 ou 60 fps se houver, meça o ritmo (cortes), transcreva, faça folhas de contato e tiras quadro a quadro de cada entrada de grafismo, prints em resolução cheia, e separe voz, trilha e efeitos para medir. Guarde o estudo na biblioteca de referências (skill `estudar-referencia`).
