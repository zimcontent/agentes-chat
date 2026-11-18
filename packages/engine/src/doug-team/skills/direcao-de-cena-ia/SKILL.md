---
name: direcao-de-cena-ia
description: Direção de cenas geradas por IA de vídeo (Seedance, Kling, Higgsfield e similares) quando o material real não existe. Storyboard em duas passadas (esboço a lápis para aprovação e quadro-âncora limpo para o modelo), mapa de posições (blocking) sem contaminação de estilo, tarefa de atuação que deixa o olhar vivo e o prompt final compilado e autossuficiente. Use em "faz o storyboard", "gera essa cena", "prompt para o Seedance", personagem com olhar morto, troca de lugar entre personagens, ou qualquer cena de filme gerada.
---
# Direção de cena gerada por IA

Material real vem antes de gerar. Cena gerada só com cotação e ok de quem decide o gasto, e só se a skill de marca permite cena de IA (muitas marcas proíbem). Nenhuma instrução desta skill aprova roteiro, débito ou mídia por ninguém.

## 1. Storyboard em duas passadas

Duas peças por plano, geradas da mesma descrição:
1. **Esboço a lápis** para a pessoa aprovar: grafite, sombra em marcador cinza, setas vermelhas de movimento, notas de tempo à mão. Proíbe fotorrealismo.
2. **Quadro-âncora limpo** para o modelo de vídeo: composição limpa, fotográfica, luz e figurino consistentes. Proíbe setas, notas, molduras de painel e a palavra "storyboard".

Esboço é entrada fraca para o modelo (sem cor, luz e textura, ele improvisa); quadro final é storyboard ruim para o cliente (parece pronto e vira discussão de detalhe).

**Fase 1, sistema visual comum**: personagens com descrição de primeira aparição, locais, hora do dia, número de planos, proporção (a da entrega: 9:16 gera em 9:16, nunca recorta depois), registro (documental, cinema, comercial). Escreva o bloco comum e copie-o LITERALMENTE em todo prompt das duas passadas: paleta (3 a 5 cores), UMA condição de luz, caráter de lente, look de filme, âncoras de cada personagem (figurino, cabelo, silhueta). Paráfrase entre planos = deriva de identidade. Mostre e espere o "fechado".

**Fase 2**: para cada plano, ação (uma frase), câmera (ângulo, lente, movimento), intenção, e os dois prompts lado a lado. **Valide no passo mais barato**: um esboço e um âncora do primeiro plano aprovados antes do lote.

**Fase 3, passagem ao modelo de vídeo**: modo de referência por imagem (nunca texto puro quando há âncora), cada plano declara qual imagem é seu âncora, gerações de até ~10 s encadeadas com o âncora do fim de uma no começo da outra, transição declarada.

Quantidade de planos: teste 2; vídeo curto 4 a 6; comercial de 30 s 6 a 8; narrativa de 60 s 10 a 14; acima disso, divida em atos com aprovação por ato.

## 2. Mapa de posições (blocking)

Use só quando trouxer informação que as fotos de referência não resolvem (quem está onde, olhando para onde). O mapa carrega o máximo de geometria com o mínimo de estilo, porque o inimigo é o estilo do mapa vazar para o plano.

**Três camadas contra o vazamento**
1. **Imagem**: figuras em CONTORNO fino, uma cor apagada e bem distinta por pessoa, sem preenchimento, sem blocos de cor, sem texto nem letras; grade de fundo bem fraca (é ferramenta do autor, não sinal para o modelo).
2. **Texto**: o bloco que liga o mapa ao vídeo é escrito só na forma POSITIVA. Modelos são fracos com negação: "sem ilustração chapada" injeta "ilustração chapada". Nunca nomeie o estilo gráfico do mapa no prompt de vídeo; só diga de onde o estilo vem (das referências de local e personagem).
3. **Estrutura**: o mapa é anexado POR ÚLTIMO, depois das referências de local e personagem.

**Passo 1, o prompt do desenho**: o quadro de origem vai anexado só como guia de composição (enquadramento, ângulo, recorte, posições, poses, escala); o look fotográfico não é copiado; nada é acrescentado; **corpo cortado pela borda continua cortado**. Descreva cada figura: posição no quadro, o que aparece, pose exata (sentado, cabeça inclinada para trás, de costas), direção do olhar, objeto-assinatura e onde ele fica em relação ao corpo ("na garganta, sob o queixo, não no peito"). Entregue também a etiqueta do mapa e do local, com cena e versão, e uma legenda de cores em uma linha. Não passe ao passo 2 sem pedido.

**Passo 2, o bloco de ligação** (colado nas referências do prompt de vídeo, um bloco só): o mapa serve só para ler posição, pose e direção; todo o resto (estilo, luz, cor, rostos, figurino, ambiente) vem do local e dos personagens; a cena é live-action fotorreal. Letras A, B, C existem só no texto e se ligam às figuras pela cor ("A = a figura azul = <personagem> → <posição>"). Travas finais: estilo, luz e textura só das referências; as cores do mapa identificam quem é quem, não figurino; cada um fica na sua posição até a sua ação.

Extensões: trajetória (de um objeto ou personagem) desenhada como caminho tracejado na grade; caminho de câmera com setas declaradas "setas = câmera"; deslocamento com início, percurso, destino e o acontecimento que dispara o movimento.

**QA do desenho**: só contornos, nenhum texto, corpo cortado continua cortado, objeto na altura anatômica certa, poses e enquadramento iguais ao quadro. **QA do vídeo**: fotorreal sem nada gráfico, sem fundo branco ou grade, nenhuma cor do mapa no figurino ou na gradação, nenhuma letra, cada personagem na posição mapeada. Falhou: corrija na camada que alimentou o erro e suba a versão.

## 3. Tarefa de atuação (olhar vivo)

Tarefa de atuação é o personagem **investido na tática para alcançar o objetivo**. Não é descrever comportamento externo ("sobrancelha sobe", "parece triste"): isso é jogar o resultado e produz rosto morto. A tática pode morar inteira no olhar: quem argumenta por convicção confere os dois olhos do parceiro procurando confiança e se ajusta ao que encontra. Olhar morto não se conserta com luz; conserta-se dando tarefa ao olho.

A escada, nesta ordem:
0. **Leia a cena inteira** antes de dirigir qualquer fala.
1. **Objetivo da cena**: UMA direção compartilhada por todos, quase sempre não dita (ex.: mãe arruma a mala do filho que parte em uma hora: "fazer isso sem dor, não deixar tristeza um para o outro"). Não é a função dramática do filme: o personagem não sabe dela.
1a. **O fim nomeia o acontecimento**: leia a cena de trás para frente a partir do último beat (cuidado com a última fala de duplo sentido).
1b. **Todos no mesmo acontecimento**, inclusive quem só escuta ou está inconsciente; se alguém fica fora, o acontecimento está mal nomeado.
1c. **A ação física é o canal**: a atividade de superfície (arrumar a mala, a ronda de rotina) continua, e cada personagem persegue o acontecimento por ela, com um comportamento físico próprio e legível pela câmera.
2. **Motivo de cada um**: mesmo vetor, combustível diferente (o filho por causa da mãe; a mãe por superstição). As circunstâncias limitam os motivos possíveis.
3. **Objetivo pessoal**: a briga dele dentro da cena, comum e jogável.
4. **Obstáculo**: o que pressiona contra a linha (o sentimento querendo sair). O público sente justamente porque ninguém o joga.
5. **Tática**: o que ele FAZ ao parceiro, momento a momento, com o trabalho do olhar nomeado como ação (conferir os dois olhos, registrar se a frase pegou, roubar um olhar e voltar antes de ser pego), presa às palavras do diálogo, marcando onde a linha quebra se quebrar.

No prompt, um bloco de atuação por personagem: direção da cena, motivo, objetivo, obstáculo, tática e o momento a momento ligado às falas aprovadas (literais, no idioma aprovado), com a trava de segurança: olhar sempre engajado na tarefa, nunca vidrado; piscar natural de vez em quando. Diferencie as pessoas pelas circunstâncias e estratégias; não imponha a mesma contenção emocional a todos. Na revisão de um take, ache o instante em que a intenção deixou de ser legível e proponha correção localizada antes de outra geração.

## 4. Compilar o prompt final

- **Cada prompt funciona sozinho**: nada de "como antes"; o modelo não recebe histórico.
- Ordem: duração e tipo de plano; invariantes de estilo; política de texto; prioridades; referências (com o papel de cada uma: rosto, roupa, espaço, posição); geometria; primeiro quadro; óptica; câmera; luz e cor; atmosfera; beats que cabem na duração; física; atuação; áudio (onde se escuta, o que está perto, o que está longe, o que a barreira abafa; fala, ruído e música separados); travas e negativo. Omita o irrelevante e remova contradições. Bloco único em inglês, falas no idioma aprovado.
- Referências pelos IDs reais anexados, na ordem real; tags numeradas conforme essa ordem; o mapa de posições depois das fotos. Não invente sintaxe de referência que a rota não resolve. Reordenar anexos exige revisar todas as tags.
- Proporção, duração e resolução são parâmetros da rota, não palavras do prompt ("8K" ou "24 fps" na prosa não mudam o arquivo).
- Personagem e local nunca se juntam numa imagem intermediária: folha de personagem neutra (identidade, vistas úteis, luz neutra, sem rótulos) aprovada e usada como identidade; local e objetos continuam arquivos separados.
- Plano único com vários beats não é multicorte; A, B, A são três planos. Estilo de câmera fixo por sequência. Cada inserto de objeto pedido é um plano próprio.
- **Direção de cor ligada à história**: recomende uma base pela premissa e pelo arco emocional, compare uma alternativa, registre a escolhida e mantenha paleta, contraste, saturação e pele na sequência; variação só com luz motivada ou virada prevista. Não aplique o look às folhas neutras.
- Texto em cena: um texto canônico, conferido em todas as repetições; para letra garantida, proponha composição por cima em vez de prometer pelo prompt.
- Antes de pedir a geração: referências resolvidas, parâmetros aceitos pela rota, tempo para a ação e a leitura, primeiro e último estados compatíveis com os planos vizinhos.
