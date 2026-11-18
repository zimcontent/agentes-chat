---
name: motion-editorial-papel
description: Motion editorial de explicação sobre um vídeo vertical já cortado (podcast, entrevista, pessoa falando) ou em tela cheia: mundo de papel claro com grão, objetos e fotografias recortados, anotações desenhadas à mão (círculo, seta, risco), tipografia grande condensada e legenda queimada, tudo travado nas palavras da fala. Use para "põe motion explicativo", "ilustra as palavras-chave", "estilo papel editorial", ou para inserir cenas de explicação em cima de um avatar.
---
# Motion editorial de papel

O áudio é congelado: não dá para reescrever a fala, então tudo se ancora no que foi dito e em quando foi dito.

## Regra-mãe

**Mostrar uma prova, apontar o detalhe, concluir, nesta ordem.** Movimento acompanha raciocínio. Nada se mexe só para "dar dinâmica".

## Ordem de execução (cada etapa tem uma trava)

| # | Etapa | Saída | Trava |
|---|---|---|---|
| 1 | Ancorar | tabela palavra para quadro | transcrição palavra a palavra existe |
| 2 | Escolher frases | tabela entra / não entra, com motivo | cada escolha tem justificativa escrita |
| 3 | Gerar objetos | imagem crua por objeto | zero texto de IA, zero sombra embutida |
| 4 | Recortar | PNG com alfa | borda conferida a 200% |
| 5 | Compor | 4 estados por cena | estados coerentes |
| 6 | Entradas, saídas, transições | um plano por cena | entrada e saída definidas |
| 7 | Legenda | sequência da duração total | nenhuma palavra dita fica de fora |
| 8 | Render e montagem | master | duração, cadência e áudio idênticos à fonte |

## 1. Ancorar

Todo evento visual se trava numa palavra, com tolerância de ±3 quadros. Elemento que entra fora da palavra vira enfeite: o espectador não liga uma coisa à outra. Sem transcrição com tempo por palavra, pare e produza uma.

## 2. Escolher as frases

Entra a frase que tem **objeto**; não entra a que só tem conceito.

| Entra | Não entra |
|---|---|
| substantivo concreto ou unidade de medida | piada lateral, aparte |
| a instrução ou o payoff do clipe | o que já foi ilustrado por outra cena |
| número verificável | número que o falante estima ou corrige ("sei lá") como dado limpo |
| | grandiloquência sem objeto ("primeira vez na história") |

Número dito por entrevistado só vira gráfico limpo se for verificável; estimativa vira marcador manual ou não entra. **Varie o registro, não só o objeto**: três cenas seguidas de "mesa + objeto + fita" leem como a mesma cena. **Densidade**: 30 a 40% do clipe coberto por motion (abaixo de 20% fica parado; acima de 50% o rosto some), pelo menos 1,5 s de rosto entre cenas. Escreva a tabela dos que ficaram de fora, com o motivo.

## 3. Gerar os objetos

IA de imagem entra só para objetos físicos e fotografias, nunca para vídeo e nunca para texto. Um prompt por objeto, isolado, vista de cima, luz difusa uniforme, sempre com: sem sombra projetada no fundo, sem texto, letras, números, logo ou marca, sem brilho, neon, degradê ou cara polida de IA.

- Fundo pelo maior afastamento de luminância do objeto: papel e objeto claro em cinza médio; objeto escuro em cinza claro; chroma só como último recurso (contamina a borda, que neste estilo é a matéria: fibra de papel rasgado, metal fosco). Pedir "fundo transparente" não funciona.
- Relógio e mostrador: peça sem números, só tracinhos, e desenhe os ponteiros você mesmo.

## 4. Recortar

Preenchimento a partir das bordas com tolerância escolhida por varredura (o platô em que aumentar não remove mais nada), depois a faixa da sombra, depois o fundo encapsulado (miolo de clipe de papel). Tolerância relativa ao vizinho escorre por degradê e come o interior: reprovada.

## 5. Compor

| Camada | Origem | Por quê |
|---|---|---|
| fundo, objetos, fotografias | IA de imagem | materialidade |
| todo texto | código, com a tipografia da marca | grafia garantida |
| toda anotação (círculo, seta, sublinhado, risco) | desenho procedural | precisa ser desenhável em progresso ("seta 40% desenhada") |
| sombra de contato, grão, vinheta | código | intensidade por camada |

Uma timeline por cena e quatro estados amostrados dela (início, meio, fim do último evento, saída). O estado "fim" cai depois do último evento, senão mostra texto pela metade.

## 6. Entrada, saída, transição

| Tipo | Entrada | Saída |
|---|---|---|
| cutaway (cobre o vídeo) | corte seco, herói já em voo no quadro 0 | alterne três saídas (deslizar, cortina, empurrar); corte seco sozinho lê como tranco e repetir a mesma vira tique |
| overlay (sobre o vídeo) | animada, com trajetória | volta por onde entrou, com fitas e anotações presas ao objeto |

Segure 8 a 18 quadros antes de qualquer saída; o melhor ponto de corte é o silêncio entre palavras. Continuidade honesta: o que amarra é o objeto herdado (o mesmo objeto voltando com outro estado).

## 7. Render

Montagem por sobreposição, nunca por corte e concatenação: cutaway são quadros opacos; overlay é RGBA e a imagem original nunca é reprocessada. Avalie cada quadro de saída no tempo real (sem converter cadência depois, que gera tremido). Grão borrado e "em dois" (troca a cada dois quadros): ruído por pixel a cada quadro estoura o bitrate. Verifique o master contra a fonte: duração, cadência, quadros e o hash do áudio.

## Variante "papel editorial" (vertical, tela cheia)

Papel claro com grão, uma camada técnica cinza (grade, medidas), objetos 3D em preto e branco (lupa, coluna, chave), letra condensada gigante, risco e elipse na cor de alerta da marca desenhados no tempo da fala.
- Som: whoosh com pico no quadro do corte e papel no salto; impacto grave diferente em cada palavra grande; estalos de letra alternando, um por linha, mais forte na linha grande; lápis riscando recortado no tempo do traço; sem prato; trilha mínima por baixo.
- **Com avatar ou pessoa falando**: as letras entram por cima do vídeo (brancas em fundo escuro, pretas em claro; risco e destaque sempre na cor de alerta); de repente o papel entra em tela cheia para explicar um conceito e volta; em alguns trechos vira tela dividida com o papel em cima. Meça a cabeça e posicione as letras acima sem sobrepor o rosto.

## Edição em lote

Substituição de texto que não encontra o padrão devolve o arquivo intacto, em silêncio. Depois de uma rodada de mudanças, confira por busca que cada padrão crítico entrou.
