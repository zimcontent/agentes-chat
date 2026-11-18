---
name: cortes-de-live
description: Transforma live, podcast, aula ou entrevista longa em cortes verticais 9:16 premium para Shorts, Reels e TikTok. Escolhe os cortes campeões pela fala (gancho, pausa, conteúdo que conclui), crava cada emenda na forma de onda, reenquadra o falante e finaliza com lettering, mundos de cor, objetos 3D, trilha e QA. Use em "tira os cortes dessa live", "3 shorts desse podcast", link de live pedindo shorts, ou notas do cliente sobre cortes já entregues.
---
# Cortes de live e podcast em shorts premium

## Portões (pare em cada um e mostre)

Quem pediu valida por etapa. Só emende tudo numa rodada quando ela pedir ("vai até o fim").

1. **Momentos**: a tabela dos cortes escolhidos.
2. **Bases**: os trechos cortados, 16:9, sem edição, para assistir.
3. **Primeiro corte editado completo**. Só depois de "aprovado, faz os outros nesse padrão" seguem os demais.
4. **Entrega**: todos com QA completo.

## A ordem é fixa

Transcrição com tempo por palavra, depois seleção (só texto), depois corte (só aqui o bruto é aberto), depois vertical e acabamento. Nunca comece analisando o vídeo bruto.

- **Baixar**: só o áudio primeiro (leve), transcreva, escolha pela fala, e só então baixe os trechos escolhidos em 1080p com ~3 s de folga em cada ponta. Live ainda no ar: espere terminar. Serviço de vídeo que bloqueia download automatizado: não procure contorno; peça o arquivo da live no Drive.
- **Não leia a transcrição palavra por palavra inteira no contexto** de uma live longa: ela não cabe e não ajuda a escolher. Leia frases com tempo e as pausas; tempo por palavra é para os scripts, e leitura longa vai para um subagente em contexto próprio.

## Escolher os cortes (portão 1)

- **Estrutura**: GANCHO forte (até ~10 s, a frase mais chocante ou curiosa daquele assunto, pode vir de depois na live), **pausa de ~1,7 s** (o falante calado, ruído de sala real), CONTEÚDO que entrega o gancho. Total ideal de 75 a 90 s, nunca acima de ~100 s.
- **Tem que concluir o raciocínio.** Leia a transcrição além do último trecho escolhido e estenda até o fecho real. O corte termina quando ele fecha a ideia, nunca numa muleta ("certo?", "right?"). Se o fecho natural for o próprio gancho, repita-o no fim (loop).
- Pode reordenar e pular trechos; cada pedaço precisa soar contínuo.
- Melhor gancho, melhor história e melhor construção para viralizar. O número de cortes pedido é teto, não meta.
- Mostre a tabela: nome, gancho (citação), resumo, duração estimada, por que vira.

## Cravar as emendas (portão 2)

Siga a skill `corte-pela-forma-de-onda`: retranscreva as janelas escolhidas sem filtro de voz, proponha as bordas, olhe cada borda de risco em imagem (forma de onda, envelope, espectrograma), corrija com entrada ou saída fixa ou com remoção, monte as bases no quadro e na amostra exatos e retranscreva início e fim de cada base sem dica de vocabulário. Tire "right?", tropeço e palavra comida antes de mandar as bases.

## Vertical e acabamento (portão 3)

- **Reenquadramento**: ache o centro do rosto num quadro de referência; nada de faixa ou logo da live na borda; rosto sempre inteiro com folga em cima. Círculo ou cartão com o falante mostra o rosto inteiro, nunca só os olhos.
- **Lettering por frase**, colado nas palavras: lock-up com a **palavra de SENTIDO** em destaque (não a mais longa), largura fechada, entrelinha justa. Frases curtas entram letra por letra. Nenhuma palavra curta sozinha na linha; cada letreiro legível por pelo menos ~0,6 s.
- **Palavra grande acima da cabeça** nos momentos fortes: inteira, sem passar por trás com semitransparência, com espaço real entre o topo da cabeça e a base das letras (a câmera recua para criar esse espaço), terminando de ser escrita antes de sair. Nenhuma letra passa pela boca ou pelos olhos.
- **Mundos alternados** a cada ~3 a 7 s, trocados com chicote de câmera: claro (mesa off-white com sombra de folhagem), escuro (spot) e a cor principal da marca. Paleta da skill de marca.
- **Cena ligada ao sentido de cada ideia**: papel na mesa com marca-texto na fala, objeto 3D recortado que cai com quique e sombra de contato, odômetro, anel ou gráfico para número, contraste de palavras, capa da pausa (kicker pequeno, linha em serifa, palavra grande em itálico, centralizada, sem foto do falante e nunca congelada seca), nome e cargo nos primeiros segundos do conteúdo.
- **Nada com cara de HTML**: sem caixa, card de interface, pílula, chip, borda fina, fonte de sistema ou animação linear. Elementos são objetos físicos (papel com textura e sombra, objeto 3D, tipografia grande) com motion blur real e easing fino. Objetos sempre recortados; nunca imagem com fundo branco nem PNG com brilho varrendo.
- Corte seco, aproximação lenta, sem chicote no rosto.
- **O que vale para um corte vale para os outros**: corrigiu num, aplique em todos antes de entregar.

## Som

Uma trilha diferente por corte, cinematográfica e casada com a curva emocional do tema (tom sério e envolvente, nunca genérica), instrumental, com uma batida forte alinhada ao fim da pausa (o "drop" quando o conteúdo começa), sem cair no gancho nem antes do fim. Whoosh no chicote, impacto nas palavras grandes, pop no marca-texto, som do material no pouso de cada objeto, cliques de lettering baixos. Níveis de partida e ajuste na skill `som-do-video`. Ajuste de volume não renderiza a imagem de novo.

## Entrega (portão 4)

- 1080x1920, H.264, AAC, -14 LUFS, pico até -1 dBTP.
- QA completo: texto da tela contra a fala, folha de quadros lida, áudio retranscrito no início, nas emendas e no fim, trilha presente desde o começo até o fim, nenhum quadro preto.
- Nomes de arquivo no idioma que a marca pede.
- Revisão e entrega pela skill `versoes-e-entrega`.

## Notas do cliente depois da entrega

Para corrigir uma base que já tem roteiro (tirar muleta, tropeço, palavra comida): guarde o corte usado, ajuste as bordas, refaça a base e remapeie o roteiro antigo para os tempos novos (letreiros, mundos, cenas, sons e o offset da trilha) em vez de reescrever. Versão nova com sufixo, QA das notas uma a uma (espectrograma de cada ponto citado) e resposta ponto a ponto.
