# Doug: como este fork acompanha o agentes.chat

Doug é um fork do [agentes.chat](https://github.com/agentes-chat/agentes-chat) ("Based on agentes.chat by Codari Global, LLC").

## Branches
- `main`: o que roda em produção (https://time.zimcontent.com) = versão oficial (tag `vX.Y.Z`) + as nossas mudanças.
- `doug-ui`: piloto da UI Doug (paleta do portal mydoug.io + estrutura/vidro do Nordus). Só entra no `main` depois de aprovado.
- `oficial/vX.Y.Z`: criados pela Action quando sai versão nova do oficial.

## Remotos numa sessão nova
```sh
git clone https://github.com/zimcontent/dougbot.git && cd dougbot
git remote add upstream https://github.com/agentes-chat/agentes-chat.git
git fetch upstream --tags
```

## Versão nova do oficial
1. A Action **Acompanhar o agentes.chat oficial** (todo dia às 8h de Brasília, ou à mão em Actions) abre uma issue com o que mudou, as migrações de banco novas e o branch `oficial/vX.Y.Z` já misturado — ou a lista de arquivos em conflito.
2. Ler as mudanças; resolver conflitos; rodar typecheck e testes.
3. Migrações: as nossas colunas extras NÃO entram no journal do Drizzle (são aplicadas no boot por `EXTRA_COLUMNS` em `packages/db/src/client.ts`), então as migrações numeradas do oficial entram sem colidir.
4. Produção: montar a imagem no servidor a partir do `main` e subir app **e runner juntos** (ver memória/HANDOFF do projeto).

## As nossas mudanças sobre o oficial (resumo)
- Ocultar agente da barra (`hiddenAgents` na visão da sidebar).
- Grupos/canais com nome de exibição e foto (colunas `display_name`/`icon`).
- Navegador: assumir o controle para os comandos do agente e do servidor; um cartão ao vivo por agente.
- Conectores: `MCP_PRIVATE_SERVERS` (MCP interno exato, ex. Segundo Cérebro) e `MCP_CIMD_ISSUERS` (OAuth por documento de metadados, ex. HeyGen).

## Automações herdadas do oficial
As Actions do oficial (CI, Android, Desktop, Mobile EAS, Release setup) vieram junto. Elas publicam imagens/apps do agentes.chat e gastam minutos; decidir se ficam desligadas neste repositório privado.
