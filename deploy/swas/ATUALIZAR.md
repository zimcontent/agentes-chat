# Atualizar todos os clientes do DougBot (SWAS)

`doug-atualizar-clientes` leva **todos** os clientes de `/opt/doug-clientes/clientes.tsv` para a mesma imagem
`agentes-zim:doug-<sha>`, um de cada vez. A imagem é a que a instância principal **está rodando agora**
(`docker inspect` do container `DOUG_PRINCIPAL_CONTAINER`): uma imagem que já passou pela produção, não "a mais recente
que existe na máquina". Este script não compila nada.

## O que ele faz com cada cliente

1. **Confere o cliente.** Código de 3 dígitos e slug do padrão do instalador; a pasta é exatamente
   `<raiz>/<codigo>-<slug>` pelo caminho real (um link simbólico no lugar da pasta, mesmo para a de outro cliente,
   é recusado); a pasta, o `compose.yml` e o `.env` são de root e ninguém mais escreve neles; `compose.yml`, `.env` e
   `dados/` não são links. **A porta do `.env` (`DOUG_HOST_PORT`) tem de ser a do registro**; se diferem (ou só um dos
   dois diz uma porta), o cliente é recusado. A imagem atual e a nova precisam existir na máquina (sem a atual não há
   volta). Qualquer falha aqui deixa o cliente como estava.
   **Cliente parado de propósito** (`doug-cliente parar`: `docker compose ps --status running -q` vem vazio) não é
   atualizado nem ligado: aparece no resumo como **Parados de propósito**, fora do código de saída 1 (a saída continua
   0 se o resto deu certo). A rodada seguinte depois de um `doug-cliente iniciar` o atualiza.
2. **Marca de imagem.** Se com esta mesma imagem o cliente já **voltou** ou **falhou**, é pulado (`--forcar` tenta de
   novo). Veja "Marcas e disjuntor".
3. **Cota e disco.** Confere o tamanho de `dados/` contra `DOUG_CLIENT_QUOTA_GB` (padrão 40). Passar da cota é aviso no
   log; com `DOUG_QUOTA_ESTRITA=1` impede a atualização daquele cliente. Depois confere se o disco comporta o dump: o
   espaço livre de `df` da raiz tem de cobrir o tamanho de `dados/postgres` mais `DOUG_FOLGA_GB` (padrão 5). Se não
   cobre, o cliente é recusado **antes de qualquer toque** (nem o aviso de troca é enviado).
4. **Prepara a troca.** Guarda o `.env` em `.env.antes-atualizar` e escreve o `.env` novo ao lado. Depois do ponto de
   parada só falta um `mv`.
5. **Ponto de parada** (ADR doug-0005). Se o servidor no ar conhece o aviso (o contrato da API, `/api/openapi.json`,
   cita o ADR: a mesma conferência da instância principal), manda `SIGUSR2` e espera o `/api/health` dizer
   `restart: ready`: nenhum agente fica cortado no meio de um turno. O contrato é lido em até **3 tentativas de 30 s**:
   uma leitura que falha ou chega pela metade não quer dizer "não conhece"; só uma resposta completa, sem o ADR, diz
   isso (e então o servidor **não recebe o sinal**: um servidor antigo morreria com ele, e a troca segue). Se nenhuma
   das 3 leituras funciona, o servidor é tratado como um que não responde: sem sinal, a troca segue. Depois do sinal: `waiting` espera; três leituras
   seguidas sem a chave `restart` mostram que o aviso não pegou e a troca segue; só `DOUG_FALHAS_SEGUIDAS` (3) leituras
   seguidas sem resposta dão o servidor por parado (uma falha solta não conta); no limite de
   `DOUG_PARADA_TIMEOUT_S` (15 min) troca assim mesmo, o que rodava continua depois, de onde parou.
6. **Backup, já com nada rodando.** `pg_dump -Fc` dentro do container do banco, em
   `/opt/doug-clientes/backups/<codigo>/pre-<imagem>-<data>.dump`. **Fora de `dados/`**: lá o cliente escreve, e um
   link simbólico levaria a escrita do root para fora da pasta dele. Se o backup falhar, o cliente **não é tocado** e o
   servidor sai do aviso de troca (reiniciado na mesma imagem se nada rodava; senão o aviso se solta sozinho em 30
   minutos, ADR doug-0005).
   **O prazo de 30 minutos do aviso.** O servidor solta o aviso sozinho em 30 min, e um backup grande pode comer boa
   parte disso. O script mede o tempo desde o `SIGUSR2`; se passar de `DOUG_AVISO_REENVIO_S` (1500, 25 min) antes do
   `mv`, reenvia o sinal, espera o `ready` de novo e **refaz o backup** (o primeiro ficou velho: o servidor pode ter
   voltado a trabalhar enquanto o aviso estava solto) e apaga o anterior.
7. **Troca.** `mv` do `.env` novo; `docker compose run --rm --no-deps agentes migrate` **sempre**, antes do
   `docker compose up -d` (`migrate` é idempotente: sem nada a fazer, não faz nada; assim não importa de que jeito o
   `.env` desliga as migrações do boot: `false`, `0`, `off`, `no`, `n`, `disabled`, em qualquer caixa).
8. **Health e imagem.** Espera `status: ok` em até 5 minutos e confere, com `docker compose ps`, que o servidor roda a
   imagem nova. Dando certo, a coluna `imagem` de `clientes.tsv` passa à imagem nova (por um arquivo ao lado e um `mv`;
   a cópia anterior fica em `clientes.tsv.anterior`; um disco cheio não trunca o registro) e os backups de trocas boas
   são rotacionados (ficam `DOUG_BACKUPS_GUARDADOS`, 3). O `.env` antigo (`.env.antes-atualizar`) sai e o ponto sem volta
   deixa de valer **antes** de gravar o registro: uma morte depois do health bom não devolve o cliente à imagem anterior.
9. **Volta.** Se não ficar saudável (ou rodar outra imagem, ou a migração falhar): restaura o `.env`, `up -d` na imagem
   anterior, espera o health de novo. O backup dessa tentativa vira `falhou-<imagem>-<data>.dump`, fora da rotação de
   `pre-*`, e a imagem fica marcada. Esses são os que mais pesam e ninguém os apagaria: ficam só os
   `DOUG_FALHOU_GUARDADOS` (2) mais novos de cada cliente, e o resumo diz quantos foram apagados.

### Como o health é lido (com e sem porta publicada)

- **Com porta** (`DOUG_HOST_PORT` no `.env` e a mesma no registro): `curl http://127.0.0.1:<porta>/api/health`.
- **Sem porta publicada** (o modo de proxy "externo", em que o proxy entra na rede do cliente e o upstream é o nome do
  container: o `compose.yml` não tem `ports` e o `.env` não tem `DOUG_HOST_PORT`; a coluna `porta` do registro é `-`,
  `0` ou vazia): o mesmo fetch que o `HEALTHCHECK` da imagem faz, por dentro, com
  `docker compose exec -T agentes bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health')…"`.
  Serve para o `/api/health` e para o `/api/openapi.json`. Não depende da rede do host, de porta nem de firewall.
  O servidor tem de estar rodando para o `exec` (antes e depois da troca é o mesmo caso: sem resposta, é "não responde").

O **banco não é restaurado sozinho**. Se a versão nova já migrou o esquema antes de falhar, a imagem anterior pode não
subir sobre ele: então o cliente aparece como *falhou* e o backup (caminho no log) é a volta.
Restaurar, com o servidor do cliente parado:
`docker compose exec -T postgres pg_restore -U agentes -d agentes --clean --if-exists < /opt/doug-clientes/backups/<codigo>/<arquivo>`.

### Script morto no meio da troca

Se o script for morto por `SIGTERM`, `SIGHUP` ou `SIGINT` (o fim do prazo da unidade, `systemctl stop`, a sessão
que fechou, Ctrl-C), o `trap` restaura o `.env`, tira o guarda e o dump pela metade (`*.parcial`) e, se a troca já
tinha sido feita, devolve o servidor à imagem anterior. Antes da troca, solta o aviso (reinicia a mesma imagem se nada
rodava; senão o aviso acaba sozinho em 30 min). Se for morto sem trap (`SIGKILL`, queda da máquina), o
`.env.antes-atualizar` fica no disco: **na rodada seguinte, antes de qualquer outra coisa**, o script olha o cliente:
- se o servidor **já roda a imagem do `.env`, com o health ok** (a morte veio depois da troca boa), só o guarda sai e o
  registro é gravado: nada volta atrás;
- senão, restaura o `.env` do guarda, sobe o cliente na imagem anterior, confere o health e o conta como *voltou* (a
  troca interrompida não foi concluída; a próxima rodada tenta de novo).

Um guarda igual ao `.env` (a morte veio antes do `mv`) só é removido. Um cliente que já está na imagem pedida **só conta como "já na imagem" se o health disser ok**; sem health
ele *falha*.

### Marcas e disjuntor

- Depois de uma volta ou de uma falha, fica uma marca `(cliente, imagem)` em
  `/opt/doug-clientes/atualizacao/marcas/`. Nas rodadas seguintes com a mesma imagem o cliente aparece em **Pulados**
  (sem tocar nele) até alguém olhar e rodar com `--forcar`. Uma troca boa apaga as marcas do cliente; marcas com mais de
  60 dias saem.
- **Disjuntor:** `DOUG_DISJUNTOR` (2) voltas ou falhas seguidas, com a mesma imagem, **param a rodada**: a imagem é o
  problema, não os clientes. Os que sobram aparecem em **Sem iniciar**. Falhas antes de tocar no cliente (backup,
  permissões, imagem ausente…) não contam: não dizem nada sobre a imagem.
- A rodada também para se a atualização da instância principal (`doug-atualizar.service`) começar no meio dela, e nem
  começa se ela já estiver rodando (`systemctl is-active`).

Um cliente que falha não para os outros, salvo pelo disjuntor.

## Usar

```bash
doug-atualizar-clientes                    # a imagem que a instância principal roda
doug-atualizar-clientes doug-abc123        # uma imagem específica
doug-atualizar-clientes --dry-run          # mostra o que faria; não toca em nada, não grava log, não pega trava
doug-atualizar-clientes --so 064           # só o cliente 064 (pode repetir ou separar por vírgula)
doug-atualizar-clientes --exceto 064,065   # todos menos esses
doug-atualizar-clientes --forcar --so 064 # tenta de novo o cliente 064, marcado com esta imagem (ver acima)
```

`--so` e `--exceto` vazios (`--so ""`, `--so ,`) são erro (código 2), nunca "todos". Um teste seguro antes de atualizar
de verdade: `--dry-run`, depois `--so <um cliente de teste>`.

### Saída e código de saída

O fim da saída é o resumo (também em `resumo.txt`): **atualizados**, **já na imagem**, **voltaram para a anterior**,
**falharam**, **pulados**, **parados de propósito** e **sem iniciar**, e quantos backups `falhou-*` foram apagados.

| Código | Significa |
| --- | --- |
| 0 | tudo certo (um cliente parado de propósito aparece no resumo e não muda o código) |
| 1 | algum cliente **falhou** (sem backup, `.env` ilegível, permissões, imagem ausente, nem a anterior ficou saudável…) ou ficou **sem iniciar** (disjuntor) |
| 3 | nenhum falhou, mas algum **voltou** para a imagem anterior ou foi **pulado** por uma marca |
| 2 | uso errado ou algo global: imagem inexistente, registro ausente, `flock` ausente, outra atualização rodando, a instância principal se atualizando |

Logs: `/opt/doug-clientes/logs/atualizacao-<data>/<codigo>-<slug>.log` e `resumo.txt`; pastas com mais de 60 dias saem.
Sobras de execuções mortas são apagadas **só pelo prefixo do próprio script**: `.env.atualizando.*` na pasta do cliente,
`pre-*.dump.parcial` em `backups/<codigo>/` e `clientes.tsv.atualizando.*` na raiz. Um `.env.backup`, um
`clientes.tsv.backup` ou um `manual-*.dump.parcial` do operador ficam como estão.

### Variáveis (todas opcionais)

| Variável | Padrão |
| --- | --- |
| `DOUG_CLIENTES_DIR` | `/opt/doug-clientes` |
| `DOUG_CLIENT_QUOTA_GB` | `40` |
| `DOUG_IMAGE_REPO` | `agentes-zim` |
| `DOUG_PRINCIPAL_CONTAINER` | `agentes-chat-agentes-1` |
| `DOUG_PRINCIPAL_UNIT` | `doug-atualizar.service` |
| `DOUG_SERVER_SERVICE`, `DOUG_DB_SERVICE` | `agentes`, `postgres` (serviços do `compose.yml` do cliente) |
| `DOUG_DB_USER`, `DOUG_DB_NAME` | `agentes`, `agentes` |
| `DOUG_PARADA_TIMEOUT_S` | `900` |
| `DOUG_SAUDE_TIMEOUT_S` | `300` |
| `DOUG_POLL_S` | `5` |
| `DOUG_FALHAS_SEGUIDAS` | `3` |
| `DOUG_BACKUPS_GUARDADOS` | `3` (os `pre-*`) |
| `DOUG_FALHOU_GUARDADOS` | `2` (os `falhou-*` mais novos de cada cliente) |
| `DOUG_FOLGA_GB` | `5` (folga de disco, além de `dados/postgres`, para o dump) |
| `DOUG_AVISO_REENVIO_S` | `1500` (reenvio do `SIGUSR2` antes do `mv`, aviso de 30 min) |
| `DOUG_QUOTA_ESTRITA` | vazio (`1`: passar da cota impede a atualização do cliente) |
| `DOUG_DISJUNTOR` | `2` |
| `DOUG_TRAVA_ESPERA_S` | `0` (a unidade põe `600`) |
| `DOUG_DONO_UID` | `0` (root) |
| `DOUG_LOG_DIR` | `$DOUG_CLIENTES_DIR/logs` |

## Travas e permissões (contrato com o instalador `doug-cliente`)

- **Travas.** `$RAIZ/.atualizar.lock` impede duas atualizações ao mesmo tempo (a segunda sai com 2); o script **exige
  `flock`** e sai com erro sem ele. `$RAIZ/.lock` é a trava do instalador (`doug-cliente novo`, `remover`): o
  atualizador a pega **por cliente**, enquanto o toca, e a solta entre um e outro; com a trava de outro, o cliente fica
  para a próxima rodada (ou espera `DOUG_TRAVA_ESPERA_S`). Dentro da trava confere de novo que o cliente continua no
  registro com o mesmo slug e a mesma porta (um `remover` no meio da rodada o deixa em *pulados*).
  **O outro lado.** Um cliente fica com a trava enquanto o script espera o ponto de parada (até 15 min), faz o backup e
  espera o health (até 5 min, ou 10 se voltar). Um `doug-cliente novo`, `remover`, `parar`, `iniciar` ou `backup` que
  chegue nesse tempo **espera a trava** por `DOUG_TRAVA_ESPERA` (120 s no instalador) e **falha depois disso** com
  "outro doug-cliente ou o doug-atualizar-clientes está rodando": é só rodar de novo quando a rodada passar daquele
  cliente (o `journalctl -u doug-atualizar-clientes -f` mostra onde ela está), ou subir `DOUG_TRAVA_ESPERA` na
  `doug-cliente.conf` de quem opera à noite.
- **Dono e modo.** Como o script roda como root e escreve nessas pastas, ele recusa o cliente cuja pasta, `compose.yml`
  ou `.env` não seja de `DOUG_DONO_UID` (root) ou tenha escrita para grupo ou outros, e recusa links simbólicos em todo
  caminho que toca (`compose.yml`, `.env`, `dados/`, `backups/`, `atualizacao/`), e a pasta do cliente tem de ser,
  pelo caminho real, `<raiz>/<codigo>-<slug>`. A raiz também é conferida (de root, sem escrita para grupo nem outros).
  O instalador já cria assim (a raiz e a pasta do cliente `0711`, `compose.yml` `0644`, `.env` `0600`, tudo de root; só
  `dados/files` e `dados/postgres` pertencem a outros usuários e o script não os toca; `backups/` e
  `backups/<codigo>/` `0700`): **não afrouxe isso**, nem rode o instalador com `umask` mais aberta que `022`. O `0711` da
  pasta deixa só atravessar: quem não é root não lista os clientes. O `.lock`, o `clientes.tsv` e `removidos/` podem ter
  modo fechado: o script, como root, lê e escreve neles do mesmo jeito, e o `clientes.tsv` novo herda o modo e o dono do
  antigo.
- **Pastas do script**, criadas `0700` e de root: `backups/<codigo>/`, `atualizacao/marcas/`, `logs/`. `umask 077` no
  script todo. Os backups do `doug-cliente backup`/`remover` ficam em `backups/<codigo>/` também, com os nomes
  `manual-<data>.dump` e `remocao-<data>.dump` (e `remocao-<data>.env`, `remocao-<data>-files.tar`); a rotação do
  atualizador só mexe nos `pre-*.dump` e nos `falhou-*.dump`.

## O que muda para os computadores conectados (ADR doug-0005)

O `SIGUSR2` só pára o **servidor**: os agentes que rodam no servidor terminam o turno e retomam depois da troca; as
mensagens das pessoas continuam entrando. Este script **não atualiza o runner** dos computadores conectados (as máquinas
onde os agentes rodam Claude Code ou Codex): ele roda lá, fora das stacks. Quando a imagem nova traz um runner diferente,
cada computador atualiza no seu tempo com `install.sh --when-idle` (ou `agentes-runner service install --when-idle`), que
manda `SIGUSR2` ao runner: ele recusa turnos novos (`restarting`), deixa os que rodam terminarem e reinicia sozinho
(saída 75). O servidor novo espera o runner voltar sem barulho no chat. Um runner mais antigo que o ADR trata o `SIGUSR2`
como fim do processo; por isso a atualização do runner de cada cliente é uma etapa à parte, depois desta.

## Instalar na máquina

O serviço roda como root, então o script tem que ser de root e ninguém mais pode alterá-lo:

```bash
sudo install -m 0755 -o root -g root deploy/swas/doug-atualizar-clientes /usr/local/sbin/doug-atualizar-clientes
sudo install -m 0644 deploy/swas/systemd/doug-atualizar-clientes.service deploy/swas/systemd/doug-atualizar-clientes.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now doug-atualizar-clientes.timer
```

O timer roda toda madrugada às 04:30 (com até 10 minutos de atraso aleatório), depois da atualização da instância
principal. A unidade não tem `TimeoutStartSec` curto (12 h, o teto de uma rodada travada), usa `KillMode=mixed` (o
`SIGTERM` chega ao script, que desfaz a troca em curso; o resto do grupo só leva `SIGKILL` depois de `TimeoutStopSec`,
20 min). Para ver: `systemctl list-timers doug-atualizar-clientes.timer` e `journalctl -u doug-atualizar-clientes`.

## Regra de sudo para disparar à mão

A conta de operação não precisa de root para o resto: só para pedir ao systemd que inicie o serviço. A regra é esta,
exata, igual à da atualização da instância principal, em `/etc/sudoers.d/doug-atualizar-clientes` (edite com
`sudo visudo -f`):

```
agentes ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block doug-atualizar-clientes.service
```

(troque `agentes` pela conta de operação). Uso: `sudo systemctl start --no-block doug-atualizar-clientes.service`, e o
andamento em `journalctl -u doug-atualizar-clientes -f`. Essa regra dispara sempre a imagem da instância principal, para
todos os clientes. **Não** dê sudo para `doug-atualizar-clientes` com argumentos livres: `--so`, `--exceto` e a tag viram
comandos de root para quem tiver a regra. Uma atualização parcial se faz como root, direto no script.

## Antes de depender dele

- Os clientes precisam rodar uma imagem que já conhece o ADR doug-0005 (o `SIGUSR2` do aviso de troca): o script
  confere isso por cliente e, se não, troca sem avisar. Os clientes novos nascem com a imagem atual, então vale.
- O script supõe, no `compose.yml` do cliente, os serviços `agentes` e `postgres`, o projeto `doug-<codigo>` e
  `DOUG_IMAGE` no `.env`; se o instalador usar outros nomes, ajuste `DOUG_SERVER_SERVICE` e `DOUG_DB_SERVICE` na unidade.
  A imagem tem de ter o `bun` (a do DougBot tem: é o que o `HEALTHCHECK` usa), para o health sem porta publicada.
