---
name: corte-pela-forma-de-onda
description: Regra e procedimento de corte de fala medido no áudio, nunca no tempo da transcrição. Use em todo corte de pausa, falso começo, tomada repetida, corte de live, depoimento ou ajuste "tira esse trecho", antes de montar e antes de entregar.
---
# Corte pela forma de onda

A transcrição diz O QUE foi falado. Onde cortar quem diz é o áudio. Os tempos de palavra de qualquer transcritor (Whisper, Scribe, AssemblyAI) chegam adiantados ou atrasados de 0,1 s a mais de 1 s e comprimem pausas: cortar por eles come começo e fim de palavra. Esta regra vale para todo vídeo, sem exceção.

## A regra

1. **Toda borda de corte cai em silêncio real medido no envelope do áudio** (janelas de 10 ms), nunca num vão da transcrição.
2. **Silêncio real = pelo menos 80 ms abaixo de um limiar adaptado ao ruído de sala** daquele trecho. Em pausa entre frases, prefira fechar o trecho só depois de uns 0,25 s de silêncio.
3. **Vale curto dentro de palavra não é silêncio.** Oclusão de p, t, k e b cria "silêncios" de 30 a 40 ms no meio da palavra. Nunca confie em vão abaixo de 50 ms.
4. **Olhe 1 s para cada lado da borda.** Se a fala volta em menos de ~1,2 s, a pausa é no meio da frase: a palavra seguinte entra no trecho.
5. **Meça no áudio bruto.** Nivelador de diálogo, compressor e redutor de ruído enchem os vãos e escondem a borda.
6. **Na grade de quadros, confira em que quadro o corte cai de fato** (a 23,976 fps um quadro dura 41,7 ms). Micro vão de 40 a 90 ms se mede à mão e vira exceção escrita.
7. **Respiros:** pausa natural até ~0,8 s fica; pausa longa encolhe para ~0,4 s (ou 0,15 s em edit falando acelerado). Vício ("é", "hã", "tipo", "né") só sai quando o silêncio o isola dos dois lados.
8. **Emenda sem estalo:** micro fade de ~10 ms no áudio em cada emenda.

## Procedimento

1. Transcreva com tempo por palavra só para ler e escolher (nunca para cravar a borda).
2. Proponha os cortes (pausas, falso começo, tomada repetida: fica sempre a última tomada completa).
3. Para cada borda, ache o silêncio real no envelope em volta do tempo proposto e mova a borda para dentro dele.
4. Gere uma imagem por borda suspeita (forma de onda + envelope + espectrograma, ±1 s) e OLHE. Toda borda marcada como risco é olhada, não aceita no escuro.
5. Aplique o corte no quadro exato.
6. **Retranscreva o áudio montado e compare com o texto esperado, palavra por palavra.** Palavra faltando é erro de corte até prova em contrário pela forma de onda, nunca "erro do transcritor".
7. Uma checagem automática que trava a montagem se alguma palavra ficou cortada roda antes da entrega.

## Ajustes pedidos por minutagem

- "Tira de X a Y": converta o tempo da versão vista para o tempo da montagem e procure o silêncio real mais próximo das duas bordas.
- "Deixa respirar depois de X": termine X dentro do silêncio dele e comece o trecho seguinte ~1,2 s antes, em ruído de sala limpo (nunca com riso ou respiração de outra pessoa).
- "Cortou a palavra": aumente o respiro daquela borda e confira de novo no envelope.
- Mudou o corte, mudam os tempos de tudo: gere a tabela de-para (tempo antigo para tempo novo) e reescreva os letreiros, sons e insertos que dependiam deles.

## Checklist

- [ ] Nenhuma borda fora de silêncio real; nenhuma palavra comida no começo ou no fim.
- [ ] Retranscrição final sem palavra faltando.
- [ ] Nenhuma muleta sobrando no fim de trecho ("certo?", "né?", "right?") a menos que o raciocínio termine nela.
- [ ] Emendas sem estalo, sem duplicação de sílaba.
