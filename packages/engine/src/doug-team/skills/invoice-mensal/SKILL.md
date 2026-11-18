---
name: invoice-mensal
description: Prepara a invoice mensal de um cliente em PDF a partir do modelo da empresa e da invoice anterior, escreve o e-mail de envio e só manda depois da aprovação na conversa. Use nas rotinas de invoice, em "faz a invoice do cliente X", "manda a cobrança do mês" ou em lembretes de pagamento em atraso.
---
# Invoice mensal

Do dado conferido ao e-mail enviado com aprovação. Vale para a invoice do mês e para o lembrete de pagamento em atraso.

## Antes de começar

- **Confira a condição vigente do cliente** nas notas do cliente e na memória do financeiro: se está ativo, valor, moeda, dia de emissão, vencimento, idioma da invoice e formas de pagamento aceitas. Se o cliente pediu pausa, não emita.
- **Valor só de fonte firme:** o que a pessoa responsável disse ou a invoice anterior. Nunca preencha lacuna com dado de outro cliente nem chute valor. Faltou dado: pergunte e pare.
- Precisa de dois arquivos: o **modelo de invoice da empresa** (com a marca, pelo skill de marca do workspace) e a **invoice anterior** do cliente, para conferir razão social, endereço, numeração e dados de pagamento.

## Passos

1. **Numere** seguindo a sequência da invoice anterior.
2. **Gere o PDF** a partir do modelo (por exemplo, com ReportLab), com a logo da marca. Documento em inglês usa data por extenso e números no padrão americano; em português, o padrão brasileiro.
3. **Confira o PDF antes de anexar:** extraia o texto e renderize a página em imagem (por exemplo, com PyMuPDF) e olhe. Número, valor, vencimento, nome do cliente e dados de pagamento batem com a fonte? A logo aparece inteira?
4. **Escreva o e-mail** curto, no idioma do cliente: número, valor e vencimento, fechando com um agradecimento. A assinatura do financeiro entra pelo próprio envio, se o workspace tiver uma.
5. **Mostre na conversa:** anexe o PDF e diga para quem vai, o número, o valor e o vencimento.
6. **Peça o ok** da pessoa responsável em palavras simples (destino, número, que vai enviar) e encerre a sua vez. Com o sim, envie exatamente o que foi mostrado e diga se saiu. Se pedirem ajuste, faça um rascunho novo e peça o ok de novo: nunca altere o rascunho já aprovado nem envie por outro caminho.
7. **Registre** na memória do financeiro: número, valor, data de envio.

## Lembrete de atraso

1. Confira se a invoice do mês saiu e se há sinal de pagamento (extrato, alerta do banco, resposta do cliente).
2. Pagou: avise em uma frase e pare. Não dá para saber: diga isso.
3. Não pagou: rascunho de lembrete gentil citando o número da invoice, mostrado na conversa, e o mesmo fluxo de aprovação do passo 6.

## Armadilhas

- Logo escura sumindo num fundo escuro ao conferir: renderize sobre branco e posicione a imagem original inteira, sem máscara de recorte.
- Dados bancários vão só no documento e nunca digitados no chat. Mostre só as formas de pagamento que o cliente usa.
- Nada sai sem aprovação, nem "só um teste".
