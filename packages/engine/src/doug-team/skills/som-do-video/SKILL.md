---
name: som-do-video
description: Trilha, efeitos sonoros e mixagem de vídeo curto e longo. Escolha e edição da trilha para a duração e a curva emocional, efeitos por vaga e por evento visual, níveis de partida, ducking, loudness de entrega e ajuste de som sem renderizar a imagem. Use em toda mixagem, troca de trilha, "abaixa a música", "som de notificação aqui", ou quando faltar um efeito específico.
---
# Som do vídeo

Você não ouve o áudio. Diga sempre o que mediu (LUFS da voz e da música, pico, alinhamento do drop e dos efeitos) e peça para a pessoa ouvir antes de aprovar.

## Trilha

- **Licenciada**: Epidemic Sound pelo conector da conta da marca, ou a música que a pessoa mandar. Nunca música sem licença.
- **Uma trilha diferente por vídeo**, nunca repetida: registre o que cada vídeo usou e confira antes de escolher. Para achar parecidas com uma referência, use a busca por similaridade do catálogo.
- **Casada com o tema e a curva emocional**: corte sério pede trilha cinematográfica e envolvente; tema de negócio ou polêmica costuma pedir trilha corporativa com impacto rítmico, não melancólica; perfil pessoal pode pedir algo leve. A marca decide; o que foi aprovado vai para a skill de marca. Instrumental sob voz.
- **Edição para a imagem**: peça a edição da faixa para a duração do vídeo (ou ~15 s mais longa, e corte no fim com fade curto, quando o final da faixa é uma cauda longa e morreria antes do fim). O ápice perto do pico emocional da fala; drop alinhado a um corte forte ou ao fim da pausa do gancho; respiro antes das viradas; o gancho nunca fica sem música e a trilha não some antes da chamada final. Trilha que morre cedo: comece a faixa mais adiante.
- Ofereça 3 opções numeradas com prévia e o motivo de cada uma quando a pessoa ainda não escolheu.

## Efeitos

- **Fonte premium primeiro**: biblioteca licenciada (Epidemic) e a biblioteca de efeitos aprovados do workspace. Pacote genérico não, porque briga com a linguagem cinematográfica.
- **Não existe o som exato**: gere (ElevenLabs ou similar), toque para a pessoa antes de usar no render final e, aprovado, guarde na biblioteca para reuso.
- **Por vaga**: cada som tem um nome de vaga (impacto, riser, notificação, papel, whoosh, clique de letra, pop, tique de contador, teclado); o mix leva cada um ao nível aprovado da vaga, seja qual for a origem.
- **Só onde há evento visual**, com o pico no quadro do evento: whoosh no meio do pan ou no corte do chicote; impacto grave na palavra grande (nunca em duas seguidas); riser antes da virada emocional; clique por linha de lettering alternando três sons sem repetir; teclado real no número digitado, terminando com a última letra; foley no gesto (carimbo, palma, papel, lápis riscando recortado no tempo do traço); som do material no pouso de cada objeto 3D. Sem prato ou brilho de címbalo (soa barato). Lista falada: cada item com o seu som.

## Níveis de partida (ajuste pela marca)

- Voz: passa-alta em ~70 Hz e compressor leve (~2,5:1); voz em ~-15 LUFS antes da cadeia.
- Normalize a trilha antes de aplicar o ganho (uma faixa mixada mais alta entraria mais alta). Trilha ~10 a 16 dB abaixo da voz na fala, com ducking.
- Referência que já foi aprovada num reel vertical: trilha ~-18 dB, whoosh de corte ~-14, whoosh secundário e papel ~-16 a -17, impacto ~-15, lápis ~-18, estalo de letra ~-19, com a voz normalizada e o total em -14 LUFS. Com a trilha em ~-27 e os efeitos entre -21 e -27, ninguém percebeu trilha nem efeitos.
- Perfis pessoais costumam pedir o contrário (trilha ~15 dB abaixo da voz e efeitos bem discretos). O nível aprovado de cada marca fica na skill de marca e é o ponto de partida dela.
- Entrega: -14 LUFS integrados e pico até -1 dBTP para redes (loudnorm em duas passadas; uma passada fica abaixo em vídeo curto). Depoimento entregue a outro editor: ~-16 LUFS. Formato íntimo (voz sussurrada) pode ficar bem mais baixo se a marca aprovou.

## Ajuste só de som

Mudou só trilha, nível ou efeito: remixe e junte ao vídeo da última versão copiando a imagem, sem reencodar e sem render. Vira a versão seguinte, com o mesmo QC.

## Checagem

- [ ] Trilha presente desde o começo e até o fim (ou até a cartela), sem cair no gancho.
- [ ] Nenhum efeito sem evento visual; picos alinhados.
- [ ] Voz inteligível acima de tudo; nenhuma palavra encoberta.
- [ ] Loudness e pico dentro do padrão da entrega; vídeo e áudio com a mesma duração.
