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
- Ícone da aba e do app na web: o Doug. `index.html` aponta para `/favicon.svg` (de `packages/ui/scripts/dougbot-files.ts`) e `faviconOf` do ícone padrão também (`apps/web/src/lib/app-icon.ts`); `favicon.ico`, `apple-touch-icon.png` e `icon-512.png` em `apps/web/public` são o mesmo Doug, e `packages/ui/scripts/app-icons.mjs` do oficial não os regrava. Ao misturar o oficial, conferir que nada voltou a apontar para o ícone de pixel do agentes.chat.
- Avisos do portal de aprovação pelo WhatsApp: `POST /api/webhooks/approval-portal/whatsapp` (`PORTAL_WHATSAPP_TOKEN`, `PORTAL_WHATSAPP_FROM`, `PORTAL_WHATSAPP_TO`; sem as três responde 404), em `packages/engine/src/whatsapp/portal-notice.ts` e `apps/server/src/routes/webhooks.ts`, descrito no adendo 2026-11-16 de `docs/adr/doug-0001-whatsapp-numbers.md`. Ao misturar o oficial, conferir em `routes/webhooks.ts` que a rota continua registrada ANTES da genérica `/webhooks/:provider/:endpointId` (os dois segmentos dela casam com a genérica) e que `sendWhatsAppText` continua saindo por `deliverWhatsAppText`.
- Marca: a plataforma se chama **DougBot** e nenhum texto que chega a uma pessoa diz "agentes.chat". O nome é escrito uma vez, em `packages/i18n/src/brand.ts` (`BRAND_NAME`; `packages/ui/src/brand/doug.ts` e as docs do app reexportam, `packages/config/src/index.ts` guarda uma cópia que `apps/server/test/brand.test.ts` mantém igual). Em vez de editar cada string que o oficial traz, o texto é renomeado onde sai, por `brandText`/`brandTree` (troca "agentes.chat" como palavra e deixa endereços como estão: `https://agentes.chat/install`, `ping@agentes.chat`, `app.agentes.chat`, `/Applications/agentes.chat.app`):
  - strings dos apps em todos os idiomas: `STRINGS`, `resources` e `serverText` em `packages/i18n/src/index.ts`, `loadStrings` em `packages/i18n/src/load.ts`;
  - e-mails (assunto, prévia, HTML e texto): `renderEmail` em `packages/engine/src/email.ts`; o remetente padrão é `BRAND_NAME` (`defaultEmailFrom`, e `EMAIL_FROM` dos hosts oficiais em `packages/config/src/index.ts`, que mantém o endereço `ping@agentes.chat`);
  - páginas de ajuda: `apps/web/src/docs/doug-docs.ts` (já existia), e os links de ajuda e de download dos apps ficam no nosso site: `appDocsUrl`/`DOWNLOAD_URL`/`BRAND_SITE` (`https://time.zimcontent.com`) em `packages/i18n/src/docs.ts`, `helpUrl` em `packages/client/src/lib/server.ts`, `/help/<página>` do servidor redireciona para `/docs/<página>` dele mesmo (`apps/server/src/app.ts`) e a documentação do MCP aponta para `/docs/apps-de-ia` do próprio servidor (`packages/engine/src/apps/urls.ts`);
  - trocas diretas, uma linha cada (conflito possível quando o oficial mexer na mesma linha: manter `BRAND_NAME`): `appName` em `apps/server/src/auth.ts`, `resource_name` em `apps/server/src/routes/oauth.ts`, `title` do servidor MCP em `packages/engine/src/apps/tools.ts`, "You work in … on" em `packages/engine/src/context.ts` (com os snapshots `prompt-text` e `token-trim`), `plan_hold` em `packages/engine/src/no-ai.ts`, o nome do avatar em `packages/ui/src/components/HostingScene.tsx` e `apps/web/src/pages/EmailUndoPage.tsx`.
  - O que NÃO muda, de propósito: atribuição e licença (NOTICE, TRADEMARKS, CLA, termos, a linha "Baseado no agentes.chat da Codari Global, LLC" do Sobre e a página `open-source` das docs, que usam `DOCS_SITE`), `OFFICIAL_HOSTS`, URLs de install/compose/update/telemetria/relay do oficial, `instance.name` (`"agentes.chat"` é o que os apps conferem em `GET /api/instance`), `user-agent`, chaves de criptografia (`crypto.ts`, `secret-box.ts`), nomes de pacote e de binário.
  - Ao misturar o oficial, conferir: `bun test packages/i18n/test/brand.test.ts packages/engine/test/email-brand.test.ts apps/server/test/brand.test.ts` (estão no portão). O primeiro falha se alguma string de algum idioma ainda disser o nome antigo depois do `brandTree`; o segundo renderiza todos os e-mails em todos os idiomas e também varre `packages/engine/src/push/messages` e `packages/engine/src/email/words` (os avisos de push não têm um ponto único de saída: se o oficial trouxer "agentes.chat" ali, o teste aponta arquivo e linha, e a correção é editar a string). Conferir também que `renderEmail`, `STRINGS` e `loadStrings` continuam passando por `brandText`/`brandTree` e que `helpUrl` continua em `appDocsUrl`.
  - Ainda dizem "agentes.chat" e ficaram para uma próxima passada, por serem texto para o agente ou para quem opera o servidor, não para a pessoa no app: descrições de ferramentas e recusas devolvidas ao modelo (`packages/engine/src/apps/*`, `git/github-call.ts`, `git/github-events.ts`, `browser/status.ts`, `desktop/status.ts`, `browser/handoff.ts`, `capabilities.ts`, `setup-tools.ts`, `tools/directory.ts`, `machine-hub.ts`, `machine-accounts.ts`, `runner-update.ts`), o nome do GitHub App criado pelo manifesto (`git/github-app-settings.ts`), o autor dos commits dos agentes (`git/machine.ts`), o cabeçalho dos arquivos de missão (`mission-sync.ts`), descrições do OpenAPI e das variáveis de ambiente, o CLI nativo (`apps/server/src/native.ts`) e o runner. Os testes de tela em `apps/web/test` que ainda esperam "agentes.chat" em frases já estavam fora do portão antes desta mudança.
- Conectores: `MCP_PRIVATE_SERVERS` (MCP interno exato, ex. Segundo Cérebro: aceito ao cadastrar e a cada requisição do `outboundFetch`; nunca use o `allowPrivateOutbound` global) e `MCP_CIMD_ISSUERS` (OAuth por documento de metadados em `/oauth/client-metadata.json`, ex. HeyGen).

## Automações herdadas do oficial
As Actions do oficial (CI, Android, Desktop, Mobile EAS, iOS, Release setup) vieram junto. Elas publicam imagens/apps do agentes.chat e gastam minutos; decidir se ficam desligadas neste repositório privado. A nossa Action diária não depende delas. O CI do oficial também roda nos PRs daqui; a etapa "Migrations are up to date with the schema" falha por desenho, porque as colunas `display_name`/`icon` de `channels` ficam fora do journal.
