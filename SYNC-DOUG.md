# Doug: como este fork acompanha o agentes.chat

Doug é um fork do [agentes.chat](https://github.com/agentes-chat/agentes-chat) ("Based on agentes.chat by Codari Global, LLC").

## Branches
- `main`: o que roda em produção (https://time.zimcontent.com) = `main` do oficial + as nossas mudanças. A Action diária avança o `main` sozinha quando a mistura passa no portão; produção só muda quando alguém sobe a imagem.
- `doug-ui`: piloto da UI Doug (paleta do portal mydoug.io + estrutura/vidro do Nordus). Só entra no `main` depois de aprovado.
- `atualizacao/oficial-AAAA-MM-DD`: branch de trabalho da Action (só fica no GitHub quando uma pessoa o publica para resolver algo).
- Tags `doug-AAAAMMDD-<sha7>`: cada atualização do `main` que passou no portão (para saber o que subir ou para onde voltar).

## Remotos numa sessão nova
```sh
git clone https://github.com/zimcontent/dougbot.git && cd dougbot
git remote add upstream https://github.com/agentes-chat/agentes-chat.git
git fetch upstream --tags
```

## Fluxo diário (Action "Acompanhar o agentes.chat oficial", `.github/workflows/acompanhar-oficial.yml`)
Todo dia às 06:00 UTC (03:00 de Brasília), ou à mão em Actions → "Run workflow":
1. Busca o `main` do oficial. Se ele já está contido no nosso `main`, termina.
2. Mistura o `upstream/main` num branch `atualizacao/oficial-AAAA-MM-DD` a partir do `main`.
3. Portão de qualidade no runner do GitHub (Bun 1.4.4): `bun install --frozen-lockfile`, typecheck de todos os pacotes, `bun run check:migrations`, build da web e os testes dos pacotes com as nossas mudanças (net-guard, custom-mcp, conectores, oauth, sidebar, canais, navegador do runner, browser-handoff, migrações). A lista está no próprio workflow: teste novo nosso entra lá.
4. Passou: o `main` avança (fast-forward), ganha a tag `doug-AAAAMMDD-<sha7>`, o resumo da execução lista o que entrou e fica uma issue fechada "Doug atualizado com o oficial (data)" com os commits e as migrações novas (histórico).
5. Falhou: o `main` não muda; abre (ou atualiza, sem duplicar) a issue "Atualização do oficial falhou no portão de qualidade" com a etapa e o log resumido.

A Action não depende das Actions herdadas do oficial (CI, Android, Desktop, Mobile, Release setup) nem de segredo além do `GITHUB_TOKEN`. Ela não sobe nada para produção.

**Limite do GITHUB_TOKEN:** ele não pode gravar arquivos em `.github/workflows`. Quando a mistura do oficial mexe em algum workflow, a Action roda o portão e, se passou, abre a issue "Atualização do oficial pronta, falta o push (mexe em workflows)" com os comandos: numa sessão com o `gh` logado, `git merge` do commit indicado sobre o `origin/main` e `git push origin HEAD:main`.

**Ensaio:** rodar a partir de outro branch, ou com `ensaio=true`, faz tudo (inclusive o portão, mesmo sem novidade) sem gravar nada: `gh workflow run acompanhar-oficial.yml --ref <branch> -f base=<branch>`.

### Quando abre issue de conflito ("Atualização do oficial com conflito")
O `main` não mudou e a issue lista os arquivos em conflito, os commits novos e as migrações. Numa sessão:
1. `git fetch origin && git fetch upstream --tags && git switch -c atualizacao/oficial-manual origin/main && git merge upstream/main`
2. Resolver cada arquivo mantendo as duas coisas: o que o oficial trouxe e a nossa mudança (lista abaixo). Os pontos sensíveis: `packages/engine/src/net-guard.ts` (`privateServerAllowed` também no `outboundFetch`), `connectors/oauth-mcp.ts` (`cimdClientId` antes do registro), `packages/db/src/client.ts` (`EXTRA_COLUMNS`).
3. `bun install`, typecheck, `bun run check:migrations`, build da web e os testes listados no workflow (no Windows alguns testes de tela e do navegador do runner falham por ambiente: comparar com o `main` antes).
4. Push do branch e PR para `main`. Ao entrar no `main`, a próxima execução diária fecha a issue sozinha (ou fechar à mão).

## Migrações
As nossas colunas extras NÃO entram no journal do Drizzle (são aplicadas no boot por `EXTRA_COLUMNS` em `packages/db/src/client.ts` e no helper de testes), então as migrações numeradas do oficial entram sem colidir. O deploy aplica as migrações novas no boot: ler as listadas na issue antes de subir.

## Produção
Montar a imagem no servidor a partir do `main` (ou de uma tag `doug-*`) e subir app **e runner juntos** (ver memória/HANDOFF do projeto).

## As nossas mudanças sobre o oficial (resumo)
- Ocultar agente da barra (`hiddenAgents` na visão da sidebar).
- Grupos/canais com nome de exibição e foto (colunas `display_name`/`icon`).
- Navegador: assumir o controle para os comandos do agente e do servidor; um cartão ao vivo por agente.
- WhatsApp: números conectados por um gateway (Evolution Go) no mesmo servidor, com as conversas no nosso banco (`docs/adr/doug-0001-whatsapp-numbers.md`). As três tabelas `whatsapp_*` são criadas no boot por `EXTRA_COLUMNS`, fora do journal.
- Conectores: `MCP_PRIVATE_SERVERS` (MCP interno exato, ex. Segundo Cérebro: aceito ao cadastrar e a cada requisição do `outboundFetch`; nunca use o `allowPrivateOutbound` global) e `MCP_CIMD_ISSUERS` (OAuth por documento de metadados em `/oauth/client-metadata.json`, ex. HeyGen).

## Automações herdadas do oficial
As Actions do oficial (CI, Android, Desktop, Mobile EAS, iOS, Release setup) vieram junto. Elas publicam imagens/apps do agentes.chat e gastam minutos; decidir se ficam desligadas neste repositório privado. A nossa Action diária não depende delas. O CI do oficial também roda nos PRs daqui; a etapa "Migrations are up to date with the schema" falha por desenho, porque as colunas `display_name`/`icon` de `channels` ficam fora do journal.
