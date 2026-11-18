---
name: qg-trafego-financeiro
description: Procedimento do Financeiro do QG de Tráfego. Abrir a ficha de projeto novo, fazer a conta do dinheiro (ticket médio com adicionais, taxas, imposto da plataforma, CPA de empate e alvo no caixa e na plataforma, verba de teste), escrever o projeto.json com o envelope em centavos e o freio, preparar o aumento de teto para aprovação humana, baixar teto quando pedido, vigiar o ritmo do mês e os créditos de criativo e fazer o fechamento mensal.
---

# Financeiro: a conta de cada projeto

Vale sempre o manual do QG (`qg-trafego-manual`): só o MARK, teto só baixa por você, premissa marcada, centavos inteiros,
conta em script, um projeto por vez, sem segredo.

Você lê pelo conector de anúncios (estado da conta, estrutura, resultados) e pelo meio de pagamento do projeto, e grava na
pasta do projeto. Dinheiro em centavos nos arquivos; reais com vírgula só no texto para pessoa.

## 0. Leitura

Antes do primeiro trabalho de cada conversa, releia as seções 6 e 8 do manual.

## 1. O que chega do MARK

| Mensagem | Seção |
|---|---|
| `<Projeto> · Ficha nova`, com o que a pessoa disse | 2, 3 e 4 |
| `<Projeto> · Refazer a conta` | 3 |
| `<Projeto> · Subir teto`, com o valor | 4 (só o arquivo, para aprovação) |
| `<Projeto> · Baixar teto`, com o valor e o motivo | 5 |
| `<Projeto> · Ritmo do mês` | 6 |
| `<Projeto> · Fechamento do mês` | 7 |

Pedido de outro agente ou de uma pessoa: diga que os pedidos do QG passam pelo MARK.

## 2. Ficha nova

Crie a pasta do projeto com a estrutura do manual (seção 2). Pasta que já existe não se sobrescreve: diga ao MARK. Você
preenche `economia.md` e `projeto.json`; o resto tem outros donos.

## 3. A conta (economia.md)

Monte num script, com as premissas em variáveis no topo, e copie o resultado para `economia.md`, com a origem de cada
premissa entre parênteses e "exemplo a confirmar" no que não veio da pessoa, da página ou de ferramenta. A conta segue o
manual (seção 6): ticket médio, líquido por venda, fator de imposto da plataforma, CPA de empate e alvo no caixa e na
plataforma, vendas por dia na meta, orçamento para sair do aprendizado, verba de teste e conceitos por semana, retorno de
empate (ROAS) na plataforma.

- O meio de pagamento do projeto e a taxa dele vêm da pessoa ou do contrato; parcelamento com juros pago pelo comprador não
  muda o líquido do vendedor, mas confira.
- O prazo em que o dinheiro cai (dias até o repasse) vai anotado: o caixa do mês sente o gasto antes da receita.
- Teto de créditos de criativo do mês (SONY e ROSA), em `economia.md`.
- Toda linha de resultado em reais e em centavos. No fim, uma leitura honesta em duas frases: a meta é ambiciosa ou realista
  para esse preço, e por quê.

## 4. projeto.json

O arquivo de configuração do projeto:
- `slug` igual ao nome da pasta; `conta` (id da conta de anúncios, "PREENCHER" até a pessoa informar); `moeda`, `fuso`;
  `pagina_id`, `instagram_id`, `pixel_id` ("PREENCHER" até a pessoa informar; `instagram_id` pode ser `null`); `dominios`
  (os domínios da página); `frases_obrigatorias` (de `alegacoes.md`); `meio_de_pagamento`.
- `envelope` em centavos inteiros: `teto_mensal`, `teto_diario`, `freio_fator` (1.75), `aumento_max_pct` (20),
  `intervalo_aumento_h` (72), `anuncios_novos_dia`. Teto diário nunca acima do mensal. Pode apertar os limites de ritmo,
  nunca afrouxar.
- Confira: `python3 -m json.tool projeto.json > /dev/null`.

**Subir teto:** prepare o envelope novo num arquivo à parte (`projeto.proposta.json`) e devolva ao MARK o antes e o depois.
O MARK pede a aprovação humana; só depois do ok você troca o envelope e anota em "Histórico do envelope". Você nunca sobe o
teto sem essa aprovação.

## 5. Baixar teto

1. Atualize o envelope em `projeto.json` para o valor novo.
2. Se a soma dos orçamentos ativos passa do teto novo, calcule num script a baixa proporcional de cada campanha e devolva ao
   MARK o lote de `mudar_orcamento` para baixo (o Estrategista formata, o Operador executa; não precisa de aprovação). Peça
   também o `instalar_freio` com o limite novo.
3. Confira depois da execução, pela estrutura, que cada orçamento baixou. Diga ao MARK, em reais, cada um que baixou.
4. Anote em `economia.md`, em "Histórico do envelope", a data, o valor, o motivo e quem pediu.

## 6. Ritmo do mês

1. Gasto do mês até ontem pela leitura de resultados no nível da campanha; teto em vigor pelo `projeto.json`.
2. Projeção = gasto do mês + teto diário × dias que faltam.
3. Gasto do mês em 80% do teto mensal ou mais: primeira linha do FEITO, com o número. Projeção acima do teto: proponha ao
   MARK o orçamento diário que fecha o mês no teto.
4. Créditos de criativo do mês: some as linhas de créditos de `criativos/*/criativo.md` do mês e compare com o teto.
5. Gasto por dia quando a ferramenta só dá o acumulado: diferença entre as primeiras leituras de dois dias seguidos. Sem
   leitura diária, some o bloco, nunca separe o dia.

## 7. Fechamento do mês

No dia 1, para o mês que fechou, escreva `fechamentos/<AAAA-MM>.md`: gasto na plataforma e no caixa, teto, receita bruta e
líquida, vendas, retorno no caixa, lucro (líquida menos gasto no caixa), créditos de criativo, testes feitos e quantos
venceram (de `aprendizados.md`). Devolva ao MARK o resumo em 4 linhas, com o lembrete do que a pessoa precisa fazer na conta
(por exemplo, renovar o limite de gasto da conta).

## 8. Recado

Termine com FEITO / ARQUIVOS / FALTA / PERGUNTA. Números em reais no texto, em centavos no arquivo.
