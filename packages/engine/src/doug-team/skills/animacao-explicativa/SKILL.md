---
name: animacao-explicativa
description: Vídeo vertical que explica qualquer assunto sem ninguém gravar, com narração, um personagem 3D estilo massinha que atua a fala e interage com a cena (toca, pega, carimba, é empurrado), câmera viva e transições de marca. Use para "animação explicativa", "explica isso sem eu gravar", "vídeo com bonequinho", explicador curto para Reels.
---
# Animação explicativa com personagem 3D

## Roteiro

Molde: **gancho comparativo, o jeito comum, a virada, o mecanismo em 3 ou 4 telas, uma metáfora, pergunta final.** Frases curtas. Nada inventado: número, dado e promessa só se vieram no pedido ou na marca. Amostra de demonstração fecha em ~10 s, com assinatura e logo no fim.

## Fluxo

1. **Narração uma vez só** (voz da marca, gerada ou gravada), com o tempo de cada palavra.
2. **Decupe cada frase**: a tela, o gesto do personagem e **onde ele interage com a cena** (toca o botão, pega a prancheta, carimba, é empurrado, bate palma). Personagem parado ao lado da tela é o erro mais reprovado.
3. **Cenas**: cada elemento entra na palavra em que é dito, transição de marca a cada 3 a 6 s, câmera viva.
4. **Agenda do personagem**: uma faixa de gestos (parado, acena, pensa, aponta, comemora, pulo, correndo, prancheta, espanto, pulo para tocar) com ajustes finos de olhar, giro, mão e pulo. O personagem é 3D ao vivo, na mesma luz e sombra dos objetos da cena (celular, crachá); nada de sprite.
5. **Marca**: troque só a paleta e a tipografia pela skill de marca; personagem, movimentos e luz ficam iguais.
6. **Quadros soltos de cada cena** e corrija o feio: volume, sombra no chão, contato real entre mão e objeto. Página por servidor local (o navegador não abre arquivo local direto) e espere a página assentar antes do primeiro quadro: o navegador frio entrega o primeiro quadro vazio ou atrasado.
7. **Render** distribuído em pedaços (na nuvem quando for mais rápido; falhou, volta para a máquina local). Depois o acabamento: motion blur de ~4 quadros a 30 qps, vinheta, grão, codificação em duas passadas.
8. **Som**: voz, trilha leve (~20 dB abaixo) e foley no tempo de cada gesto (whoosh, carimbo e palmas com o pico alinhado no gesto). Efeitos de biblioteca premium, nunca de pacote genérico. Final -14 LUFS, pico -1.
9. **Conferir** quadros e volume no arquivo final e mandar para revisão. Ajuste só de som: remixe e junte ao vídeo pronto copiando a imagem, sem render.

## Armadilhas

- Esconda a legenda no fim de cada janela de fala; senão as palavras se acumulam e o fecho vira um bloco ilegível.
- Camadas da cena anterior podem continuar visíveis por baixo do fecho: desligue e confira o fecho quadro a quadro.
- Logo claro sobre luz forte fica lavado: leve o logo para fundo escuro e suavize a luz.
- Antes de refazer o render por um objeto estranho, olhe o quadro em resolução cheia: muitas vezes é uma letra da legenda ou sobra de outra camada.
- Marca ditada com grafia fonética para a voz (a sigla soletrada letra por letra) sai na legenda com o nome certo.

## Tempo

A maior parte do tempo vai na decupagem e na montagem das cenas, não no render. Para encurtar, mantenha um kit de cenas prontas.

## Verificação

Nos últimos 2 s: legenda sem acúmulo, nenhuma camada da cena anterior, logo nítido, assinatura no tempo da fala final; -14 LUFS com pico -1.
