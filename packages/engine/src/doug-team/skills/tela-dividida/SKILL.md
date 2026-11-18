---
name: tela-dividida
description: Vídeo vertical em tela dividida premium para Reels, TikTok e Shorts. A pessoa (gravação ou avatar) fica na metade de baixo, a de cima mostra motion gráfico do assunto de cada frase, a cabeça recortada atravessa a emenda e a legenda entra palavra por palavra abaixo do queixo. Use em "tela dividida", "motion em cima e eu embaixo", vídeo com avatar e motion.
---
# Tela dividida premium

Vídeo 1080x1920. Embaixo, a pessoa falando, quadro a quadro, a 1,0x, sem faixa preta do lado. Em cima, motion gráfico que **mostra** o assunto de cada frase. A cabeça recortada atravessa a linha da emenda e tudo de cima passa por trás dela. A legenda entra palavra por palavra, sem caixa, com a palavra falada na cor de destaque da marca. Opcional: moldura de gravação no topo (perfil, tempo com REC, cantoneiras, nome da seção), só se a marca quiser mostrar o perfil.

## Regras que não se negociam

1. **Em cima é gráfico, não a frase.** A legenda já carrega a fala; frase repetida em cima foi reprovada. Em cima só número, rótulo curto de 1 a 3 palavras em mono, interface refeita, ícone, retrato, gráfico, e uma palavra de impacto rara.
2. **Cada vídeo com outra cara.** Perfil que posta todo dia não pode ter a mesma cara todo dia: sorteie (ou escolha conscientemente) estilo, fio condutor e transição sem repetir os últimos três vídeos, variante de cada tipo de cena diferente da última vez, trilha fora das últimas dez. Registre o histórico.
3. **Gramática de motion**: troca na batida, cor chapada, física (passa do ponto e volta, amassa e estica), motion blur forte, um fio condutor que nasce de trás da cabeça e costura as cenas, nada aparece do nada, interface refeita em componentes (nunca print cru).
4. **Paleta e tipografia só da skill de marca**, em poucos estilos fechados. Cor sempre por papel (escuro, claro, acento, secundária, tinta) e fonte por função (número, título, interface, mono): é isso que deixa o mesmo código sair em qualquer estilo. Degradê com brilho, vidro e tipografias "de IA" foram reprovados.
5. **Legenda abaixo do queixo**, na faixa entre y ~1340 e ~1480 (abaixo disso a interface do Reels cobre), também na tela cheia; nunca sobre rosto, testa ou cabelo; sem caixa, 1 a 3 palavras por vez. A altura sai do rosto medido em cada plano.
6. **Painel troca a cada ~1,8 s.** Cena de mais de ~3 s leva troca de cor na batida ou um segundo bloco.
7. **A cabeça atravessa a emenda**: só cabeça e pescoço (ombro, encosto e fundo ao lado do rosto nunca sobem), com fade até ~50 px abaixo e sem contorno, salvo pedido.
8. **Recorte limpo**: sobre fundo claro qualquer halo aparece. Microfone de mesa entra no recorte.

## Enquadramento

Regras duras primeiro: a cabeça sobe no máximo ~300 px acima da emenda (alvo ~160) e os olhos ficam pelo menos 80 px abaixo dela. Depois o tamanho do rosto (~360 a 420 px de altura). Por último a altura da legenda dentro da faixa. Gravação em pé colada no rosto: a gravação diminui e as laterais recebem a borda da própria gravação esticada, desfocada e escurecida; avise que o melhor é gravar a um braço de distância. Se nem assim as regras duras cabem, pare e explique.

## Fluxo

1. **Cortar o bruto** (skill `corte-pela-forma-de-onda`): tira pausas acima de ~0,35 s e falso começo (frase que começa igual à seguinte fica só a segunda). Confira o fim (frase cortada, "é isso", tosse).
2. **Projeto**: normaliza fps e áudio, acha o rosto, enquadra a pessoa na metade de baixo, decide a altura da legenda e grava a fala palavra por palavra. Comece o recorte da cabeça logo em seguida, em segundo plano.
3. **Plano de cenas pelo sentido**: quebre a fala em trechos de 3 a 6 s e classifique cada um: `numero`, `comparacao`, `processo`, `ferramenta`, `pessoa`, `abstrato`, `atencao` e `fecho` (chamada para comentar). Cada tipo tem variantes (retrato em meio-tom, equalizador, cartões virando, interface com cursor, grade em onda, esteira, editor de curvas, camadas 3D, implosão). Marque 2 ou 3 cenas fortes como tela cheia (número do gancho, nome, prova). Tempos presos à palavra: entrada 1 a 2 quadros antes da sílaba. Janelas rápidas (trocas de cena, pulos do fio, contadores) ganham mais subquadros de motion blur.
4. **Trilha**: instrumental, nunca entre as últimas usadas, editada para a duração exata; meça a batida, porque o roteiro visual anda nela. Sem trilha o vídeo sai com voz e efeitos.
5. **Recorte**: leve (rápido, borda mais macia) ou por SAM 2.1 (fios de cabelo finos, bem mais lento). Nos trechos sem rosto o recorte some em rampa e a emenda fica reta só ali.
6. **Revisar por quadros antes do render**, com o recorte pronto (sem ele os stills não mostram a cabeça atravessando): uma folha com um quadro a cada ~0,6 a 1,4 s e as linhas da faixa da legenda desenhadas.
7. **Som**: cada bloco anota os seus efeitos (pop, clique, tique do contador, impacto, whoosh na troca de cena, estalo na troca de cor); trilha audível, ~10 dB abaixo da voz (a -20 dB ela some). Final -14 LUFS.
8. **Render** e **conferência**: contagem de quadros, áudio do mesmo tamanho do vídeo, folha do arquivo final, detalhe a 200% da borda do cabelo e da legenda.

## Com avatar

O avatar fica a 1,0x, nunca esticado ou com quadro repetido; 25 fps se a fonte for 25. Avatar e voz do avatar seguem a skill de marca (quem escolhe o avatar é a pessoa responsável). A voz vem gerada antes e é enviada ao avatar: a voz embutida do avatar em outro idioma sai sem o timbre da pessoa.

## Lista de conferência

- Nada em cima repete a fala.
- O fio nasce e mergulha atrás da cabeça a cada troca; nada surge do nada.
- Contraste: nada claro sobre o campo claro, nada escuro sobre o escuro.
- Legenda legível em todo quadro, abaixo do queixo e dentro da faixa.
- Pessoa sem faixa preta; topo do cabelo bem acima da emenda, olhos abaixo dela; nenhuma linha atravessando o rosto, sem brilho vazando na emenda.
- Borda da cabeça sem halo nem pedaço do fundo antigo; sem cadeira ou capuz colado; microfone inteiro.
- Número na tela igual ao número falado.
- Ícones 3D com alfa (PNG), nunca JPG com modo de mesclagem.
- Último quadro: a fala termina antes do fim do vídeo.
