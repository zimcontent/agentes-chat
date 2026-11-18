---
name: relatorio-de-vendas-mercado-pago
description: Levanta vendas pagas, bruto, taxas e líquido de um período no painel do Mercado Pago, transação por transação, e entrega no formato de relatório com evidência e ressalvas. Use para "quantas vendas pagas no mês", "valor líquido no Mercado Pago", "relatório de vendas do período", "bruto, taxas e líquido".
---
# Relatório de vendas do Mercado Pago

Como tirar as vendas pagas, o bruto, as taxas e o líquido de um período no painel de vendedor do Mercado Pago e entregar no formato de relatório. Não movimenta dinheiro, não muda configuração da conta e não parte para a chave de API enquanto o painel logado responder.

## Quando usar

- "número real de vendas do mês", "quantas vendas pagas", "valor líquido no Mercado Pago".
- "relatório de vendas do mês", "bruto, taxas e líquido do período", "detalhe por transação".
- Receita de um período ou de um produto digital vendido pelo Mercado Pago.

## Passos

1. **Fixe a janela, o fuso e a conta ou produto** antes de abrir qualquer coisa (ex.: do dia 1 ao último dia do mês, America/Sao_Paulo, conta e produto pedidos) e repita isso no relatório.
2. **Veja se o painel já está logado** no navegador. Se a conta já está aberta, use-a e não peça chave.
3. **Primeiro as métricas:** abra a área de relatórios, ponha o período personalizado e espere o total ("Volume de vendas") aparecer antes de ler.
4. **Depois, transação por transação:** abra a lista de vendas, abra o detalhe de cada venda aprovada e leia bruto, taxa e líquido. Tire uma leitura nova da tela antes de cada clique; referências de uma leitura antiga ficam velhas depois de navegar.
5. **Leia a coluna de status** e conte as não pagas (não aprovadas, canceladas): elas entram como exclusão, nunca como receita.
6. **Tabela:** Data | Transação | Bruto | Taxas | Líquido, uma linha por venda aprovada e uma linha de total, na moeda da conta.
7. **Depois da tabela:** **Situação**, **Resultado** (janela, conta ou produto, quantidade, bruto, líquido, taxas, detalhe com os números das transações), **Evidência** (quais telas e qual período deram os números) e **Ressalva** (passo 8). Diga se usou o painel ou a chave.
8. **Sinalize venda cujo rótulo não bate com o produto pedido** (ex.: um rótulo genérico no lugar do nome do produto) e dê a outra leitura: X vendas e Y de líquido contando só as rotuladas. A pessoa escolhe qual vale.
9. **Registre a entrega** na memória do time ao mandar o relatório.

## Armadilhas

- Painel que recarrega e desloga sozinho não é motivo para clicar mais rápido nem reabrir em laço: pare, diga em uma linha que parou e vá por outro caminho. Clique às cegas numa página instável dá número errado.
- Quando o navegador está nas mãos da pessoa, o agente não clica: peça o controle de volta.
- Não anuncie que trocou de ambiente antes de trocar e conferir que o novo tem o que o passo precisa.
- Ao retomar, veja primeiro o que já foi feito e comprovado e continue do último passo que funcionou.
- A chave de API é o plano B. Não mande a pessoa gerar chave antes de tentar o painel, e não apresente números como se a chave tivesse sido usada se não foi.
- Filtro de período pode voltar sozinho ao padrão: o período na tela tem que bater com o pedido antes de citar o total.
- Rótulo de produto ambíguo: nunca um número só; as duas leituras e a ressalva.

## Conferência

O total da área de métricas, no período pedido, é igual à soma das linhas por transação, e cada transação listada foi aberta e lida uma a uma.
