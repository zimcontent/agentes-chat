---
name: edicao-premium-3d
description: Edição premium 3D de vídeo vertical de alguém falando para a câmera (anúncio, VSL, conteúdo, roteiro gravado). Dois modos que se combinam, "estúdio" (fundo expandido por IA, câmera virtual com destaque até meia face, lettering linha a linha, telas 3D com palavras que caem, ícones 3D encaixados no texto, B-roll) e "cinema" (câmera 3D sobre o vídeo original, luz do ambiente regradada, heróis 3D de vidro ou cromo atrás da cabeça, toda palavra vira visual). Use para "edição 3D", "toda palavra visual", "fundo expandido com câmera", "objeto 3D atrás da cabeça", "telas 3D", ou pasta de takes verticais virando vários shorts premium.
---
# Edição premium 3D

A paleta, a tipografia, o logo e o símbolo vêm sempre da skill de marca (logo e símbolo oficiais, nunca recriados). O que esta receita define é a técnica.

## Entrada

Vídeo vertical já polido (cortado, com cor e voz prontas). Se vier bruto, faça antes o estágio de polimento:
- **Decupagem**: melhor take de cada linha, fora falsos começos, tropeços e fala do diretor.
- **Corte só em silêncio real** (skill `corte-pela-forma-de-onda`).
- **Voz**: respirações ~15 dB mais baixas, voz em ~-16 LUFS antes do mix.
- **Cor**: transformação de espaço de cor do log e mistura de LUTs aprovada nos prints, com contraste.
- Transcrição palavra a palavra com alinhamento forçado. Confira nomes próprios e termos da marca: nome errado quebra a legenda.

## Modo estúdio: fundo expandido e câmera virtual

- **Fundo expandido por cenário** (luz, roupa e lugar iguais), feito uma vez antes de qualquer roteiro: quadro com a pessoa numa tela maior com laterais neutras, IA de imagem estende o fundo com o centro idêntico, upscale e alinhamento fino com o vídeo. A câmera pode abrir e andar de lado sem mostrar borda. Uma sala serve vários vídeos gravados no mesmo lugar.
- **Não recorte a pessoa** quando o cabelo é difícil (cacheado, solto): use fundo expandido mais câmera.
- **Câmera virtual** alterna o enquadramento a cada corte (nenhum corte com o mesmo enquadramento dos dois lados: leve punch de ~1,15 no quadro EXATO do corte) e faz o **destaque**: desliza (~0,75 s, curva suave) até deixar metade do rosto na borda, com o bloco de texto do outro lado; nunca atravessa corte (volta um quadro antes).
- **Lettering linha a linha** no tempo da fala: termo-chave em caixa alta é a maior linha do lock-up (apoio até ~0,85 dela), na cor de destaque da marca (branca quando a roupa da pessoa não deixa o destaque ler); linha leve para ligações; alerta na cor de alerta no máximo uma vez por vídeo. Caixa de frase (maiúscula só no começo e no nome do produto). Pilha até ~760 px de largura; linha comprida vira duas equilibradas. Nome do produto nunca partido em duas linhas. Listas: um item por linha, entrando um a um.
- **Telas 3D** (1 ou 2 por vídeo): palavras 3D que caem numa mesa na cor da marca sob sombra de persiana, com linha pequena de apoio.
- **Ícones 3D animados** (casa, escudo, documento, coração, moeda, calendário, presente) encaixados no texto como uma palavra; o termo-chave não encolhe por causa dele.
- **B-roll** em tela cheia com texto em cima (acima se o rosto de alguém do B-roll ficaria coberto), fiel ao público da marca.
- Estrutura típica: gancho com lettering, 1 a 3 B-rolls, 1 tela 3D no meio, 1 destaque perto do fim, chamada final.

## Modo cinema: toda palavra vira visual

- **O fundo é sempre o vídeo original.** A luz do ambiente muda com a história por gradação a partir de placas geradas uma vez (placa limpa sem a pessoa, versão com luz clara fria do alto, versão escura com um ponto de luz na cor da marca), alinhadas por plano. Nunca troque o fundo inteiro por placa ou foto.
- **Câmera 3D virtual** sobre o vídeo: push, órbita, chicote com motion blur, troca de foco.
- **Cada frase ganha um "mundo"** ligado ao significado: tipografia editorial, herói 3D (vidro, cromo), interface do produto com profundidade, imagens reais da marca. Varie a técnica, não repita o mesmo truque em seguida. Toda palavra falada aparece ou é visualizada de outro jeito.
- **Heróis 3D**: até ~6 sequências curtas por vídeo, renderizadas em Blender com alfa; teste um quadro sobre cinza antes da sequência. **O herói nunca encosta no cabelo nem cobre a testa** (folga explícita medida pelo topo do cabelo em cada quadro; reduza o herói se não couber entre a legenda e a cabeça). Só encoste de propósito quando a fala pedir.
- **Recorte só onde precisa**: a pessoa só é recortada nos quadros em que algo passa atrás dela, em resolução média (fica igual no 1080 final), borda seca, sem halo.
- **Legenda nunca sobre o herói** e nunca encostando na próxima.
- **Nada de cara de HTML**: nada de card chapado, chip ou mono pequeno; no máximo 2 momentos de interface por vídeo, sempre com profundidade.
- **Flash** até ~0,16 de intensidade e brilho nunca contornando a cabeça.
- Variantes de chamada final (anúncio com botão e cursor, feed com "comenta X") mudam só o fim; o corpo é o mesmo.
- Plano gerado por IA só em momentos curtos e só com a fala intacta.

## Som

- Voz intacta. Uma trilha diferente por vídeo, nunca repetida (registre), cinematográfica e emocional, com o drop alinhado à virada e o final da música chegando ao fim do vídeo (peça a edição da faixa ~15 s mais longa que o vídeo e corte no fim com fade curto sob o whoosh final). O gancho nunca fica sem música e a trilha não some antes da chamada final.
- Música e efeitos baixos; efeito só onde há evento visual: um clique por linha de texto (alternando três sons, forte nas linhas grandes), pop baixinho nos ícones (sem o clique de letra ao lado), swoosh e impactos nas telas 3D. Sem prato (soa címbalo).
- -14 LUFS em duas passadas (uma passada fica abaixo em vídeo curto), pico até -1,2 dBTP.

## Prints antes de renderizar

Um quadro por letreiro e por cena numa folha; mande a quem pediu e espere o ok. O lettering quase sempre recebe nota.

## QA antes de mandar

O QA automático do fechamento não basta. Confira: texto da tela contra a fala; folhas do MP4 final em partes legíveis, lendo todas; nada na frente da boca ou do rosto (inclusive o rosto das pessoas do B-roll); nenhum jump cut com o mesmo enquadramento; sincronia da voz; trilha até o fim; -14 LUFS. Corrija, rerenderize só o que mudou e rode o QA de novo.

## Armadilhas

- Duas filas de render ao mesmo tempo corrompem os trechos: uma fila por vez.
- Troca instantânea de câmera é degrau (duração menor que um quadro); rampa de 1 ms caía entre quadros e piscava. Motion blur nunca amostra através de corte, punch ou troca seca. Punch de corte precisa do tempo exato do corte.
- Comentário no meio de uma linha de roteiro engole o resto da chamada: comentário sempre em linha própria.
- Mudar o tamanho de um ícone 3D cria um parâmetro novo e o Blender rerenderiza o ícone (cache por parâmetros).
