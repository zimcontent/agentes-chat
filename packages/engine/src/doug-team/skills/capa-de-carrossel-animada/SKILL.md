---
name: capa-de-carrossel-animada
description: Capa de carrossel com um ou dois elementos animados (e a capa de notícia com vídeo real em cima), desenhada parada pela diretora de arte e separada em camadas para o editor de vídeo animar em loop. Use quando pedirem capa animada, capa que se mexe, capa de notícia com vídeo ou quiserem mais atenção no feed sem perder a cara de design.
---
# Capa de carrossel animada

Capa parada chama pouca atenção no feed; vídeo inteiro de IA perde a cara de design. O meio-termo: a capa é desenhada parada e só um ou dois elementos ganham movimento. Texto, foto e grid ficam travados. As outras lâminas do carrossel seguem estáticas. A animação é do SONY; a capa e as camadas são suas.

## 1. Desenhar a capa parada

Monte a capa como sempre (skill `direcao-de-arte`) e aprove-a parada primeiro. Escolha UM movimento ligado ao gancho da copy: um ícone que se transforma, um contador que regride, uma luz que varre a cena e acende a palavra vazada, cabos com brilho, a tarja de notícia rolando. Por volta da metade do ciclo pode haver uma virada (a luz apaga, o número zera) que volta para fechar o loop.

## 2. Separar em camadas

Duplique o quadro em cópias, cada uma com só a sua parte visível e o fundo do quadro transparente, por exemplo:
1. fundo (a foto ou o objeto 3D);
2. a palavra vazada;
3. o objeto recortado que passa por cima da palavra;
4. texto e interface (título, cartão, cabeçalho, rodapé, sombras, grão).

Exporte cada camada em PNG transparente no tamanho final (1080 x 1350) e confira empilhando as camadas por código (FFmpeg `overlay`) contra a capa final: tem que bater pixel a pixel.

## 3. Pedir ao SONY

Mande, numa mensagem completa:
- as camadas, na ordem, com caminhos completos;
- as coordenadas do que anima e o movimento, em uma frase;
- o que fica parado (texto, sem câmera, sem zoom);
- a entrega: MP4 H.264 1080 x 1350, 30 fps, de 6 a 8 s em loop limpo, sem áudio, mais o PNG do primeiro quadro.

## 4. Conferir e entregar

Confira com uma folha de quadros (por exemplo, 1,5 quadro por segundo em grade 6 x 2) antes de mandar para revisão: o loop fecha sem pulo, o texto não treme, nada fora do lugar. Entregue o carrossel completo com a capa animada e as outras lâminas paradas.

## Capa de notícia com vídeo real

Metade de cima é o vídeo real do assunto (gravação de tela ou trecho de TV, com a marca do canal), com uma pílula de urgência e uma tarja de notícia rolando com a frase-resumo; metade de baixo tem o título em caixa alta e o convite para arrastar.
- Quem pesquisa traz o vídeo da fonte original, com pelo menos 1280 px, o trecho útil marcado e o nome da fonte.
- Você entrega os PNGs transparentes já no lugar, a pílula separada, a tarja mais larga que a tela (ou a frase e o nome da fonte), as coordenadas da janela de vídeo e a ordem das camadas.
- O SONY devolve o MP4 em loop como acima.
- Vídeo de telejornal ou de terceiro leva "Fonte: <canal>" bem pequeno na capa.
