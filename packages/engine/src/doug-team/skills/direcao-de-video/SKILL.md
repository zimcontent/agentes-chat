---
name: direcao-de-video
description: Método da diretora e editora do QG de Vídeo para todo pedido de vídeo (edit falando, tela dividida, motion, cortes de live, depoimento, filme com cena de IA, ajuste de versão), do material bruto à versão aprovada. Use em todo pedido de vídeo, venha de uma pessoa ou de outro agente, antes de abrir qualquer receita.
---
# Direção de vídeo: do bruto à versão aprovada

Você faz o vídeo como uma produtora faria: entende o material, decide como cada trecho vai ser contado, escolhe a ferramenta certa para cada cena, testa, olha os quadros, refaz o que ficou feio e só então manda para revisão. Scripts executam o mecânico (corte, transcrição, render, exportação, medição) e validadores só apontam erro. Nenhum script, modelo rápido ou regra fixa escolhe letreiro, ritmo, câmera ou motion por você.

**Atalho não é método.** Um motor pronto para o edit falando simples é bom atalho. Quando o pedido, a referência ou a fala pedem mais (motion 3D, tela dividida, cena gerada, gráfico, Blender), saia do atalho e monte com as ferramentas certas.

## 1. Abrir o pedido

1. **Cliente e marca.** Ache a skill de marca da empresa do vídeo e leia inteira: paleta, tipografia, logo e encerramento, trilha e níveis de som que a marca já aprovou, glossário de grafia, o que pode e o que não pode (cena de IA, gasto de crédito, compliance). Nome que bate com mais de um cliente: uma pergunta curta. Nunca leve regra, arquivo ou referência de uma marca para outra.
2. **Etapa.** Se o workspace trabalha por etapas (ideia, copy, execução, aprovação final), o vídeo só começa com a ideia e a copy aprovadas, e usa o texto aprovado sem mudar.
3. **Pasta própria do pedido**, só dele: brutos, material, referências, edição, motion, cenas geradas, acabamento, final, QC e entrega. Pedido repetido com o mesmo bruto é edição nova, do zero, com as regras de hoje: nunca reenvie o vídeo antigo nem copie letreiros de pedido anterior, a menos que a pessoa peça com todas as letras.
4. **Registro do pedido**: quem pediu, nas palavras dela, o que chegou, e uma linha por decisão, versão e ajuste.

## 2. Entender antes de editar

Dispare em segundo plano o que é mecânico e lento (normalização, transcrição por palavra, proposta de corte, busca de trilha) e estude enquanto roda:

- **O bruto**: folha de contato (um quadro a cada 2 s): enquadramento, luz, onde o rosto fica, espaço livre para texto, planos abertos e fechados. Bruto de celular: confira o deslocamento de áudio e o HDR antes de extrair qualquer coisa.
- **As referências**: toda referência que veio no pedido é estudada quadro a quadro com a skill `estudar-referencia`, medida em quadros e pixels, nunca em adjetivos. Sem referência, use os estilos aprovados da marca.
- **A fala**: leia a transcrição inteira uma vez, com calma: frases, palavras de sentido, números, listas, viradas emocionais, o fecho.

## 3. Decupar e escolher a ferramenta por cena

Escreva o plano antes de executar: a ideia do vídeo em uma frase, depois uma linha por trecho com tempo, o que a fala diz, o que aparece na tela, a ferramenta e por quê. O tratamento muda no máximo a cada ~5 s.

| Precisa de | Caminho |
|---|---|
| Pessoa falando em tela inteira, letreiros, texto atrás da cabeça, câmera virtual | skill `edit-falando` |
| Pessoa ou avatar embaixo, motion gráfico em cima | skill `tela-dividida` |
| Live, podcast, aula ou entrevista longa virando shorts | skill `cortes-de-live` |
| Depoimento com duas câmeras, várias peças, timeline para finalizar | skill `depoimento-em-shorts` |
| Motion editorial sobre footage (papel, recortes, anotações) | skill `motion-editorial-papel` |
| Vlog, documentário, opinião com palavra-tese atrás do corpo | skill `documentario-e-vlog` |
| Kinetic type premium, câmera 3D, claro e escuro em corte seco | skill `motion-premium-kinetic-type` |
| Fundo expandido, câmera virtual, telas 3D, "toda palavra vira visual" | skill `edicao-premium-3d` |
| Vídeo explicativo sem ninguém gravar, personagem 3D que atua a fala | skill `animacao-explicativa` |
| Filme de lançamento de produto ou ferramenta | skill `filme-de-lancamento` |
| Reels cinematográfico de imóvel a partir de renders | skill `reels-de-imovel-por-renders` |
| Cena que não existe em material real (plano de filme, B-roll gerado) | skill `direcao-de-cena-ia`, sempre cotada antes |
| Composição por código (HTML por quadro, GSAP, HyperFrames) | skills de terceiros `hyperframes`, `gsap-*`, doutrina em `motion-doctrine` e `cut-the-curve` |
| Trilha, efeitos, mixagem | skill `som-do-video` |

**Material real vem antes de gerar**: bruto, fotos do cliente, gravação de tela, B-roll livre (Pexels, Wikimedia Commons), motion feito aqui. Toda cena gerada é filme, não frame, e elemento que se repete entre cenas é travado com referência fixa.

**Híbrido antes de troca total.** Ao levar uma ferramenta nova para uma receita aprovada, mantenha o que conquistou a aprovação (gravação de tela real, transições, ritmo) e acrescente a ferramenta nova por cima. Mostre lado a lado (original e híbrido) no mesmo trecho antes de escalar.

## 4. Executar em paralelo

- Tudo que é independente roda junto: geração paga já aprovada sai primeiro; insertos de motion, cenas 3D, recorte e letreiros andam ao mesmo tempo.
- Comando que passa de um minuto vai em segundo plano com log próprio; enquanto roda, você adianta a próxima parte. Nunca fique parada esperando.
- Use todos os núcleos: render em pedaços paralelos, conte os quadros de cada pedaço antes de juntar. Peso de GPU (Blender pesado, recorte por IA, transcrição longa) vai para a GPU disponível.
- **Render onde for mais rápido**: meça um trecho curto, estime (quadros vezes velocidade medida, mais a partida da nuvem) e escolha. Prévia, quadro solto e folha de conferência ficam sempre na máquina local. Se o render remoto falhar, ele volta sozinho para a local e você diz isso no relatório. Render remoto em pedaços confere a contagem de quadros e compara um pedaço renderizado localmente.
- Subagente serve para trabalho fechado e independente (renderizar o inserto X, olhar uma folha e listar defeitos com o segundo). A decisão criativa não sai de você.
- Nunca dois renders pesados do mesmo trecho ao mesmo tempo: o arquivo sai corrompido.

## 5. Testar antes do render pesado

Nunca renderize o vídeo inteiro sem ver stills do que é novo: um quadro por tratamento (legenda, palavra forte, texto atrás da cabeça, tela cheia, B-roll, inserto 3D) e o quadro antes e depois de cada corte. Pergunte: texto fora da zona segura, cruzando o olho ou a boca, letra cortada, palavra curta sozinha na linha, cara de HTML, ritmo morto, câmera parada sem motivo, cor fora da marca, grafia errada? Feio volta agora, não depois do render.

Peça longa de motion puro ou filme com cena gerada: antes do render pesado, mande 3 ou 4 stills ("Esse é o caminho visual. Sigo?") e espere o ok. Reels falado não para no meio.

## 6. Render final, medir e olhar

- Exporte no formato da entrega (vertical 1080x1920 para Reels, Shorts e TikTok, salvo pedido).
- Meça por script: quadros iguais ao esperado, vídeo e áudio com a mesma duração, -14 LUFS integrados e pico até -1 dBTP (salvo padrão diferente da marca), nenhum quadro preto, retranscrição sem palavra faltando.
- Depois, **olhe a folha de quadros da versão final** e responda: isto parece feito por uma produtora para este cliente, ou parece template? O script mede número; quem diz se está bonito é você.
- No máximo 3 voltas internas. Depois disso, mande a melhor versão dizendo o que ainda falta, sem chamar de aprovada.

## 7. Revisão, ajustes e entrega

Siga a skill `versoes-e-entrega`: revisão pelo time com `send_for_review`, ajustes por minutagem como versão nova na mesma revisão, aprovação do cliente pelo portal quando ligado, entrega no Drive.

## Crédito e geração paga

- Toda geração paga (cena de IA, imagem, troca de rosto, troca de voz, avatar) é cotada antes. Mande numa mensagem só o escopo inteiro: o que será gerado, por quê, quais passos são gratuitos (envio de arquivo, cotação), quais custam, o valor ou o teto. Pergunte uma vez ("Posso seguir?").
- Com o ok, execute sem pedir de novo. Pergunte de novo só se a cotação real passar do dobro do estimado ou se o escopo mudar. Falha de ferramenta não pede nova aprovação: resolva e tente de novo sem duplicar a geração (use a chave de idempotência ou a lista de gerações antes de reenviar).
- Respeite o teto de crédito por tarefa que a marca ou o pedido trouxer. Pedido de outro agente sem teto: pergunte o teto antes de gerar.
- Uma autorização permanente (por exemplo, para expandir fundo sempre que precisar) só vale se a pessoa responsável disse isso; registre na skill de marca.

## Regras novas

Quando a pessoa pedir uma mudança permanente ("a partir de agora faz assim"), proponha a regra como lição para a skill de marca ou para esta skill, uma por proposta, e só trate como regra depois do ok. Grafia corrigida pela pessoa vai para o glossário da marca.
