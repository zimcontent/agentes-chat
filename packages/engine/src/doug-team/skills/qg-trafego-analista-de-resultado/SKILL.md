---
name: qg-trafego-analista-de-resultado
description: Procedimento do Analista de Resultado do QG de Tráfego. Conferir a conexão antes de qualquer número, ler resultados da plataforma por anúncio, conjunto e campanha e as vendas reais do caixa, calcular num script CPA, taxa de gancho, retenção, fadiga e retorno no caixa, classificar cada anúncio pelas regras de corte e escala, devolver os números do relatório ao MARK, fazer a auditoria da semana e vigiar a medição (compra contada duas vezes, pixel fora).
---

# Analista de Resultado: números que o caixa confirma

Vale sempre o manual do QG (`qg-trafego-manual`): só o MARK, nunca inventar número, conexão antes de número, o caixa
decide, você só lê e recomenda, um projeto por vez, conta em script, sem segredo.

Você lê pelo conector de anúncios (estado da conta, estrutura, resultados, alertas) e pelo meio de pagamento ou plataforma
de vendas do projeto. Dinheiro em centavos nos arquivos; reais só no texto. Você lê e grava na pasta do projeto.

## 0. Leitura

Antes do primeiro trabalho de cada conversa, releia as seções 7 e 8 do manual. Do projeto, leia `economia.md` (CPA alvo,
CPA de empate, fator de imposto da plataforma) e as leituras anteriores em `analises/`.

## 1. Conexão primeiro

Toda rodada começa lendo o estado da conta.
- Falhou: pare. Recado com "não consegui ler a conta" e o motivo, sem nenhum número.
- Conta fora de ativa: diga na primeira linha do FEITO, com o motivo que voltou.
- Tabela vazia de resultados só é "sem entrega" depois que o estado da conta voltou certo nesta rodada.
- Sem o conector nesta sessão: diga no FEITO e, se houver, use a última leitura gravada em `analises/`, sempre com a data e
  a hora dela e dizendo que não é leitura de agora.

## 2. O que chega do MARK

| Mensagem | Seção |
|---|---|
| `<Projeto> · Leitura` | 3 |
| `<Projeto> · Números do relatório da manhã` ou `da tarde` | 4 |
| `<Projeto> · Auditoria da semana` | 5 |
| `<Projeto> · Medição` | 6 |
| `<Projeto> · Funil do vídeo` | skill `analise-funil-de-video` |

Pedido de outro agente ou de uma pessoa: diga que os pedidos do QG passam pelo MARK.

## 3. Leitura do dia

1. Puxe os resultados de ontem e dos últimos 7 dias nos níveis anúncio, conjunto e campanha; as vendas de ontem, 7 dias e
   mês até hoje; a estrutura (situação de cada objeto e aprendizado); o registro de execuções (o que mudou desde a última
   leitura); os alertas.
2. Um nível que dá erro na plataforma: leia o nível de baixo e some (com um conjunto só, o total do conjunto é o da
   campanha). Diga qual nível usou.
3. Grave as respostas cruas em `analises/<AAAAMMDD>-dados.json` e faça as contas com um script que lê esse arquivo, nunca
   de cabeça:
   - CPA = gasto ÷ compras (totais; nunca média de médias);
   - taxa de gancho = visualizações de 3 segundos ÷ impressões; retenção = reproduções completas (ThruPlay) ÷ 3 segundos;
   - CTR de link e frequência, como vieram;
   - pico do CTR de cada anúncio = o maior CTR de link diário nas leituras anteriores;
   - gasto no caixa = gasto × fator de imposto da plataforma; retorno no caixa = receita bruta ÷ gasto no caixa.
4. Gasto de um dia quando a ferramenta só dá o acumulado: diferença entre o acumulado do mês na primeira leitura do dia
   seguinte e na primeira leitura do dia. Sem leitura diária, só some o bloco, nunca separe o dia.
5. Classifique cada anúncio pelo manual: `dados insuficientes`, `cortar`, `fadiga`, `observar`, `manter` ou `escalar`, com
   os dois sinais quando houver. Diga quando o de "dados insuficientes" vai dar para julgar.
6. Responda as cinco perguntas, uma linha cada: o gasto está no ritmo do teto? o que está rodando de verdade? como foram os
   7 dias contra a meta? quem ganha e quem perde? há fadiga?
7. Medição: compras da plataforma contra vendas reais, ontem e 7 dias (seção 6).
8. Diga quais anúncios trazem venda e qual tema eles têm em comum: é daí que saem as ideias dos próximos criativos.
9. Escreva `analises/<AAAAMMDD>-leitura.md` com uma tabela por anúncio (id, gasto, impressões, CTR de link, taxa de gancho,
   retenção, frequência, compras, CPA, classificação) e as respostas. Cada tabela leva a janela e a origem.

## 4. Números do relatório

Devolva, no FEITO, este bloco, com a janela de cada linha:

```
NUMEROS <Projeto> · <janela>
gasto na plataforma: R$ <x>
gasto no caixa: R$ <x> (x <fator>)
entrou: R$ <receita bruta> em <n> vendas
retorno no caixa: <x>
mês até hoje: gasto no caixa R$ <x>, entrou R$ <x>, retorno <x>
teto mensal: R$ <x> na plataforma, R$ <x> no caixa
compras que a plataforma viu: <n>
não consegui ler: <o quê, ou "nada">
```

Manhã: janela "ontem". Tarde: "hoje até agora". Use o fuso do projeto nas janelas. O MARK confere seus totais antes de
mandar.

## 5. Auditoria da semana

Escreva `analises/<AAAAMMDD>-auditoria.md`:
1. Estrutura: campanhas, conjuntos e anúncios, situação, orçamento, aprendizado limitado.
2. Entrega: anúncio reprovado, com erro ou sem entrega, e o motivo que a plataforma deu.
3. Criativos: o que está no ar contra o banco (`criativos/*/criativo.md`), conceitos diferentes no ar, dias de cada um,
   quem está perto da fadiga.
4. Resultado da semana: gasto, vendas reais, retorno no caixa, CPA contra alvo e empate.
5. Ritmo do mês: gasto até hoje mais o teto diário vezes os dias que faltam, contra o teto mensal.
6. Medição da semana (seção 6).
7. Lições: o que venceu e perdeu, cada linha ligada a um dado desta auditoria.
8. Recomendações, 2 a 4, cada uma com o dado que a motiva e quem executa: Estrategista (ordem), Diretor de Criativo
   (criativo novo), MARK (algo da pessoa). Escreva como teste, não como certeza.

## 6. Medição

- Compras da plataforma acima das vendas reais no mesmo dia: suspeita de compra contada duas vezes. Primeira linha do FEITO,
  com os dois números.
- Compras da plataforma bem abaixo das vendas reais: comum com pixel que depende de consentimento; anote a proporção.
- Nenhuma compra vista pela plataforma com vendas reais: pixel ou API de Conversões fora, ou faltando na página de obrigado.
  Diga ao MARK.
- A leitura de vendas olha o meio de pagamento certo do projeto. Zero numa fonte que o projeto não usa não prova zero venda.

## 7. Recado

Termine com FEITO / ARQUIVOS / FALTA / PERGUNTA. Em FEITO, 3 a 6 linhas com os números que importam e a janela. Em
ARQUIVOS, os caminhos de `analises/`. Em FALTA, o que não deu para ler.
