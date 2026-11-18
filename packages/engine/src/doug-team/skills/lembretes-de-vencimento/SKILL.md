---
name: lembretes-de-vencimento
description: Monta lembretes antes da cobrança de assinaturas e contas da empresa, dois avisos por item, para dar tempo de cancelar ou pagar. Use quando mostrarem uma lista ou imagem de assinaturas com datas de cobrança, ou pedirem "me lembra de cancelar", "lembrete dos vencimentos".
---
# Lembretes de vencimento

Cria avisos antecipados para cobranças de assinaturas e contas, para a pessoa cancelar ou pagar antes de a cobrança cair. Não cancela nada, não entra em conta nenhuma e não mexe em forma de pagamento.

## Quando usar

- "me lembra de cancelar as assinaturas", "lembrete dos vencimentos", uma lista ou um print de assinaturas com datas.
- Várias cobranças em datas diferentes que precisam de aviso coordenado.

## Passos

1. **Monte a tabela de referência** a partir da lista ou da imagem: serviço, valor na moeda original, data da cobrança.
2. **Calcule os avisos:** o primeiro 2 dias antes da cobrança, o segundo 1 dia antes. Para cancelamento trabalhoso, ofereça um primeiro aviso 3 dias antes ou pergunte a antecedência que a pessoa prefere.
3. **Antes de criar, liste as rotinas e lembretes que já existem** para não duplicar aviso.
4. **Crie os lembretes** no fuso da pessoa, explícito em cada um, com nome claro ("Lembrete: <serviço> cobra <valor> em <data>"). Uma rotina só pode cobrir a lista inteira: no dia, ela confere quais itens têm aviso e para sem mandar nada se não houver.
5. **Mensagem do aviso:** serviço, valor, data da cobrança, se é amanhã ou depois de amanhã e onde cancelar. Curta e acionável. Mande pelos canais que a pessoa escolheu e confira que chegou em todos.
6. **Mostre a tabela** (serviço, valor, cobrança, aviso 1, aviso 2) para a pessoa conferir.
7. **Ao saber que algo foi cancelado**, pare os avisos daquele item na hora (pause, não apague) e confirme em uma linha.
8. **Quando a lista acabar**, pause a rotina.

## Armadilhas

- **Erro de um dia:** 2 dias antes do dia 10 é o dia 8. Confira a conta.
- **Fuso errado:** rotina em UTC dispara na hora local errada.
- **Aviso duplicado:** sempre confira o que já existe antes de criar.
- **Cancelamento esquecido:** se a pessoa não avisou, pergunte se já cancelou em vez de supor.
- **Agir por conta própria:** só lembrar. Cancelar é decisão da pessoa.

## Conferência

A tabela bate com as datas, cada aviso dispara no dia e no horário local certos, chega nos canais combinados, e itens cancelados param de gerar aviso.
