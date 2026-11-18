---
name: modelo-de-cada-agente
description: Escolhe e aplica o modelo de IA de cada agente do time pelo tipo de trabalho e pelo custo de errar. Use quando perguntarem "qual o melhor modelo para cada agente", "dá para pôr um modelo mais barato no X", "troca o modelo do Y" ou quando um agente parar de responder por crédito ou modelo indisponível.
---
# Modelo de cada agente

Recomenda em qual modelo cada agente roda e aplica a troca. Cobre a recomendação (modelo por papel, custo contra benefício) e a troca em si; não cobre as instruções, os fluxos nem o conteúdo dos agentes.

## Quando usar

- "qual o melhor modelo para cada agente", "dá para usar um modelo mais barato aqui", "troca o modelo do X".
- Um agente ficou mudo porque o crédito da conta acabou ou o modelo escolhido saiu do ar.

## Passos

1. **Veja o time e os modelos atuais antes de responder**, pela lista de agentes e pelo Painel de IA do workspace.
2. **Separe o time pelo tipo de trabalho.** Coordenação com contexto longo e julgamento (o gerente, quem revisa) pede o modelo mais forte; trabalho de rotina (status, agendamento, lembretes) aguenta um modelo rápido e barato; agentes de criação e de vídeo usam o que as ferramentas deles exigem.
3. **Responda com uma tabela por agente e o nome exato do modelo**, como aparece no catálogo, com uma frase do porquê. Não responda em faixas ("barato", "premium") nem com "depende".
4. **Fale de custo como custo de uma execução errada**, não como preço do token. Diga claramente quais papéis podem descer de modelo e quais não.
5. **Aplique só nos agentes que você gerencia.** Os outros, diga quais são e deixe a troca com a pessoa responsável, sem dar a entender que foi feita.
6. **Teste depois da troca**: mande um pedido pequeno ao agente. A troca só é real quando a resposta volta.
7. **Agente mudo:** confira primeiro o modelo e o crédito da conta; recarregue ou troque por um modelo disponível e teste de novo.

## Armadilhas

- **Responder em faixas em vez de nomes:** a pessoa vai perguntar de novo até ver os nomes.
- **Prometer troca que você não pode fazer.**
- **Rebaixar o coordenador:** coordenação longa piora primeiro num modelo pequeno, mesmo quando a rotina ainda parece bem.
- **Trocar sem testar:** silêncio depois da troca costuma ser modelo indisponível ou crédito acabado, não agente quebrado.

## Conferência

Cada agente trocado responde a uma mensagem de teste e a lista de agentes mostra o modelo novo.
