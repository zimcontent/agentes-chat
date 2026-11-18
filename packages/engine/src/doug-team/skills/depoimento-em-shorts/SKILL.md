---
name: depoimento-em-shorts
description: Transforma um depoimento ou entrevista filmada (uma ou duas pessoas, duas câmeras sincronizadas, gravador separado opcional) em vários shorts de 60 a 120 s com arco de história, cortados só no silêncio real, câmera frontal primeiro, montados como timelines editáveis no DaVinci Resolve (ou XML) com cor e exportação. Use em "faz os shorts desse depoimento", "mesmo tipo de corte e entrega do último", ou notas sobre shorts de depoimento (palavra cortada, troca de câmera frenética, gancho, escolha de câmera, cor).
---
# Depoimento em shorts

## Entrega padrão (combine na primeira vez e registre na skill de marca)

- Vários shorts (padrão: 9, sendo 3 do ponto de vista de cada pessoa e 3 mistos em que as falas se completam), cada um de **60 a 120 s**, abrindo num gancho que chega à revelação na primeira frase.
- **Nenhuma fala se repete** entre os shorts. Respirações, erros e falsos começos saem sem cortar palavra nem tirar fala do contexto. A história flui.
- Entrevista bilíngue (cada resposta gravada duas vezes): nunca misture idiomas no mesmo short. Conte primeiro a fala única por idioma; se não der para todos, pergunte como dividir. "Nenhuma fala repete" vale dentro de cada idioma.
- Projeto novo no DaVinci Resolve com bins (Câmera A, Câmera B, Áudio, Timelines), uma timeline por short; V1 é o ângulo ativo, V2 o outro ângulo com os mesmos cortes, desligado; A1 o áudio mestre. Cor de clipe por pessoa. Marcadores: gancho, cada beat (com a fala inteira na nota) e a pausa dramática depois do gancho.
- Documentos: um LEIA-ME (tabela, método, estrutura das timelines, o que ficou de fora e por quê, o que mudou na versão) e um CUTLIST com o texto inteiro de cada beat, para ler como roteiro.

## Regras aprendidas com notas (não afrouxe)

1. **Só corte em silêncio real medido na energia do áudio**, nunca no vão da transcrição (skill `corte-pela-forma-de-onda`). Transcritores comprimem pausas e atrasam o fim das palavras.
2. **Pausas naturais até ~0,8 s ficam**; maiores encolhem para ~0,4 s. Vício ou gagueira só sai quando o silêncio o isola dos dois lados.
3. **Câmera frontal primeiro.** Todo short abre na câmera de frente e ela carrega 60 a 75% do tempo. A lateral é um inserto de 3 a 7 s "para dar impacto". Todo corte que tira tempo troca de ângulo (nunca vira jump cut); tomada longa troca de ângulo sem tirar tempo. Nunca deixe um flash de 1 a 2 s de um ângulo: segure a pausa. Resposta cheia de pausas pede o lateral inteiro (até ~9 s) em vez de picar em lateral + frontal curto, que fica frenético.
4. Quando a outra pessoa fala por cima, um "uhum" solto pode ficar; uma resposta real nunca é picada.
5. **Respeite o que a direção disse no set** (na transcrição: "isso não vamos usar", restrições de compliance como nome de empresa). Leia a transcrição inteira, inclusive a conversa fora de câmera, antes de escolher os beats.
6. **Só falas para a câmera.** Fala dirigida a alguém na sala ("quando você me ligou") quebra a ilusão: troque.
7. **Arco, não coleção de frases fortes**: gancho, pausa dramática, a história que se desenvolve e paga, chamada final forte. Cada beat continua ou responde o anterior. Duração emocional antes de brevidade arbitrária.
8. **Shorts mistos** cruzam as duas pessoas descrevendo o MESMO momento de dois ângulos.

## Fluxo

1. **Reconhecimento**: pessoas, câmeras, áudio, B-roll. Confira se a lente é anamórfica (nada no arquivo diz): desfaça a compressão antes de montar.
2. **Sincronia**: sincronize câmeras e gravador pelo áudio; as checagens de deriva ficam dentro de um quadro (abaixo de 0,04 s). Se o relógio da transcrição não bate com a timeline, descubra o mapeamento e prove que cada beat cai na tomada da pessoa certa antes de confiar. Nunca entregue timecode chutado.
3. **Transcrição** de todas as tomadas e rotulagem dos falantes (protagonista, segunda pessoa, diretor fora de câmera, intérprete). Entrevista em português: confira se o transcritor não traduziu sozinho.
4. **Roteiro dos shorts**: escreva cada short como lista de falas; cada fala precisa ser encontrada na transcrição; confira as bordas sem silêncio limpo; gere os cortes (motor de energia + plano de ângulos com frontal primeiro).
5. **Verificação**: monte o áudio de cada short, retranscreva e compare com o roteiro.
6. **Timelines no Resolve** em lotes (chamadas longas expiram). Folga de ~1 s em cada ponta quando a entrega é XML para outra pessoa finalizar.
7. **Cor**: se há um preset na galeria de cor do projeto, aplique em todos os clipes V1 e V2. Material log sem preset: nunca exporte chapado; mande stills de 2 ou 3 variantes (LUT do fabricante, exposição casada por câmera na pele, altas luzes contidas) e espere o ok. Material Rec.709 sem preset: ainda assim equilibre a câmera fechada com a aberta na pele. Câmera com exposição variando (nuvens) se casa plano a plano.
8. **Render** e **QA**: duração, quadros, áudio, quadros de cada corte, o arco lido no CUTLIST.

## Rodada de notas

Guarde a versão anterior antes de mexer. Mapeie os tempos das notas numa retranscrição do áudio montado (a diagramação das notas pode parear o tempo com o item errado). Corrija a causa no motor ou no roteiro, não só no ponto. Responda em português: o que mudou, as durações novas e o que ficou como estava e por quê.

- **"A voz está baixa, os efeitos cobrem"**: nivele cada plano pela fala (RMS dos quadros acima do percentil 40, 75% da diferença até a mediana, limitado entre -3 e +6 dB) e finalize o áudio com passa-alta em 70 Hz, compressor leve e loudnorm em duas passadas. Para depoimento entregue a outro editor, -16 LUFS é um bom padrão.
- **Legendas**: gere o .srt da transcrição de verificação do corte final, quebrando em pontuação e pausas (acima de 0,45 s), até ~40 caracteres por legenda, sem "é", "hum" e falsos começos.
- Arquivos de câmera movidos: religue as mídias em vez de recriar; renomeie a timeline antiga com o sufixo da versão em vez de apagar.
