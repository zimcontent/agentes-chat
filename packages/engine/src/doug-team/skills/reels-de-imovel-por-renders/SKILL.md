---
name: reels-de-imovel-por-renders
description: Cria do zero um reels cinematográfico de imóvel (9:16, ~50 a 60 s) a partir de uma pasta de renders 3D ou fotos de uma casa. Roteiro em beats com narração curta, imagens 9:16 realistas sem mudar a estrutura, takes gerados com movimento de câmera de cinema, montagem no ritmo da música, letterings 3D presos às superfícies do ambiente, foley por ambiente e cartela final da marca. Use para "reels da casa", "vídeo do imóvel a partir dos renders", "filme de arquitetura".
---
# Reels cinematográfico de imóvel a partir de renders

## Regras fixas

1. **Movimento e ângulo de cinema em toda geração de take**: dolly, push-in, grua, órbita, slider lateral, paralaxe com primeiro plano, troca de foco, ângulo baixo, macro, plano zenital. Nunca câmera parada genérica.
2. **Em geração multicena, o plano 1 é sempre um zoom-in cinematográfico** no quadro inicial (mesmo que não entre na edição); os seguintes são close-ups de detalhes do mesmo ambiente, cada um com um movimento diferente.
3. **Nada estrutural muda** nas imagens melhoradas: só luz, textura e realismo. Móvel, material, cor, arquitetura ou objeto diferente: gere de novo.
4. **Custo**: toda geração (imagem, vídeo, voz) é cotada antes; mostre o total do lote e gere só com o ok. Timeout não é motivo para reenviar (consulte a lista de gerações ou use a chave de idempotência).
5. Nunca sobrescreva entregas (versões novas com sufixo) nem mexa num projeto que alguém esteja com aberto no editor sem perguntar.

## 1. Roteiro com narração

1. Folha de contato de todos os renders e leia: ambiente, materiais marcantes, luz, objetos-herói.
2. O **conceito** da casa em duas frases curtas e opostas (ex.: "Silêncio por fora. Luz por dentro."), tirado do que a casa tem de mais forte.
3. **10 beats, ~60 s**: 9 ambientes de 5 a 7 s e uma cartela de ~4 s. Ordem que funciona: abertura forte interna com narração, fachada (muda, rodapé com o endereço se a marca quiser), social, cozinha (narração), ambiente-surpresa (adega, home theater), o mais dramático ou escuro (narração), suíte (volta à luz, quase parado), banho, área externa ao entardecer (narração final), cartela.
4. **Narração: 4 frases** curtas e poéticas, cada uma ligada ao que o beat mostra, nos beats 1, 4, 6 e 9; beats sem narração são mudos. Roteiro no idioma da marca, com tradução quando a equipe trabalha em outro.
5. Cada beat descreve hora do dia e luz, movimento de câmera, o detalhe que acende ou se mexe (chama, cortina, água, luz acendendo) e o som ambiente. Mostre e ajuste antes de gastar crédito.

## 2. Imagens 9:16 realistas

- **Monte você a tela 9:16 antes**: original na largura total, centralizado, áreas cinzas vazias em cima e embaixo. Mandando o render horizontal cru com proporção 9:16, o modelo reenquadra e muda a estrutura (janela dupla vira simples, número muda de lugar). Com a tela pronta ele só preenche céu e chão.
- Prompt: estender a cena só nas áreas vazias, de forma mínima; a imagem original fica idêntica; mais realismo, textura, luz física, sem luz artificial nova.
- **Conferência obrigatória imagem por imagem**: original e nova lado a lado na mesma altura; compare cada móvel, luminária, quadro, material, veio da pedra, metais, número da casa, janelas, plantas. Mudou algo estrutural, gere de novo (mesmo prompt; se repetir, outro modelo). Liste o que foi refeito e por quê.

## 3. Takes gerados

- Por beat, 2 ou 3 planos (6 a 8 s no total, 1 a 2 s a mais que o beat): plano 1 zoom-in no ambiente inteiro; planos 2 e 3 close-ups com lente e movimento próprios.
- Cada plano = cena + câmera + **bloco de estilo fixo** (filme arquitetônico fotorrealista, 24 fps, luz natural suave, movimento estabilizado, profundidade de campo rasa nos close-ups, gradação quente e neutra com pretos limpos, manter exatamente arquitetura, materiais, móveis, cores e layout da referência, sem pessoas, sem texto nem logo, assunto centralizado para 9:16, só som ambiente) + **negativo fixo** (pessoas, mãos, texto, legenda, marca d'água, logo, linhas tortas, móvel deformando, objetos derretendo ou novos, flicker, tremor, cara de CGI, saturação exagerada, altas luzes estouradas). Número ou letreiro da casa: "manter exatamente como na imagem".
- Respeite os limites da rota (número de cenas, soma de segundos, tamanho do texto por cena). Beat com segunda imagem vira uma geração própria com ela como quadro inicial.
- Folha de contato de cada take; anote os melhores pedaços. Take com deformação, pessoa ou texto: gere aquele beat de novo.

## 4. Música e voz

Música instrumental, cinematográfica e elegante; ache o trecho com pulso (pule a intro) e edite para terminar com a cartela. Voz íntima e sem pressa (sussurrada funciona), as 4 frases com pausas, num arquivo só ou uma por arquivo. Cote antes.

## 5. Montagem base

Vertical 1080x1920, 30 fps. Um corte a cada ~1,7 a 2,0 s na batida, corte seco, com os melhores pedaços de cada plano (o zoom-in pode entrar depois como plano aberto). Câmera lenta de 0,57 a 0,92 quando o pedaço é curto ou para dar peso; escala de 123 a 130% para fechar um enquadramento. Os beats encolhem na montagem (~50 s no fim, tudo bem). Narração a 0 dB no beat; música baixa e constante sob a voz (~-22 dB no início, ~-25 com narração, subindo para ~-18 perto do fim e ~-14,5 na cartela). Camada de ajuste de cor leve por cima.

## 6. Letterings 3D presos ao ambiente

- Para cada frase de narração, um par: linha pequena (itálico leve, branca, digitada letra a letra) e palavra grande (~2,2x maior, itálico pesado, branca ou prata, letra a letra com desfoque e pequena queda), linhas coladas.
- A palavra grande em 3D com extrusão, bisel, degradê prateado, um feixe de luz passando e sombra suave. A palavra grande fica pelo menos ~1,2 s na tela (desacelere o take se o plano for curto).
- **O texto mora numa superfície do ambiente** (parede da lareira, frente da ilha, céu sobre o telhado, coluna) e acompanha o movimento do take (rastreio de plano aplicado por corner pin, homografia em superfície em perspectiva). Pode passar atrás do que fica na frente (máscara do fundo como track matte).
- Nunca cubra o objeto-herói do plano; lettering no espaço vazio da superfície. Tempos de letra conferidos na forma de onda.
- Folha de QC antes de renderizar: preso à superfície, legível, sem cobrir o herói, sem palavra solta.
- Se o 3D não ficar bom: lettering 2D em cascata (linha pequena branca, palavra grande prata entrando letra a letra com desfoque, no tempo da fala).

## 7. Finalização

Letterings por cima dos takes, cor, e a **cartela da marca** (vem da skill de marca) nos últimos ~4,4 s com dissolve de ~0,4 s. Efeitos em stems separados: whoosh suave em cada corte, tecla por letra nas linhas pequenas, swish e batida por letra nas palavras grandes, ambiência de cada ambiente (lareira, pássaros, piscina, grilos), foley (cortina, garrafas, água), brilho nos lustres, riser com sub e impacto no corte para a cartela.

## 8. Checagem e entrega

Folha do final a cada 0,5 s: letterings presos e legíveis, nenhum take deformado, cartela no corte, nenhum texto gerado pela IA. Loudness: este formato é íntimo e baixo (~-27 LUFS integrados com voz sussurrada); não normalize para -14 sem a pessoa pedir. Relatório curto: roteiro final, imagens e takes refeitos e por quê, música, voz, créditos gastos e o que você mediu no áudio (você não ouve).
