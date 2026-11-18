# Atualizar todos os clientes do DougBot (SWAS)

`doug-atualizar-clientes` leva **todos** os clientes de `/opt/doug-clientes/clientes.tsv` para a mesma imagem
`agentes-zim:doug-<sha>`, um de cada vez. A imagem é a que a instância principal **está rodando agora**
(`docker inspect` do container `DOUG_PRINCIPAL_CONTAINER`): uma imagem que já passou pela produção, não "a mais recente
que existe na máquina". Este script não compila nada.

## O que ele faz com cada cliente

1. **Confere o cliente.** Código de 3 dígitos e slug do padrão do instalador; a pasta fica dentro da raiz; a pasta, o
   `compose.yml` e o `.env` são de root e ninguém mais escreve neles; nenhum link simbólico no caminho. A imagem atual e
   a nova precisam existir na máquina (sem a atual não há volta). Qualquer falha aqui deixa o cliente como estava.
2. **Marca de imagem.** Se com esta mesma imagem o cliente já **voltou** ou **falhou**, é pulado (`--forcar` tenta de
   novo). Veja "Marcas e disjuntor".
3. **Cota.** Confere o tamanho de `dados/` contra `DOUG_CLIENT_QUOTA_GB` (padrão 40). Passar da cota é aviso no log;
   com `DOUG_QUOTA_ESTRITA=1` impede a atualização daquele cliente.
4. **Prepara a troca.** Guarda o `.env` em `.env.antes-atualizar` e escreve o `.env` novo ao lado. Depois do ponto de
   parada só falta um `mv`.
5. **Ponto de parada** (ADR doug-0005). Se o servidor no ar conhece o aviso (o contrato da API, `/api/openapi.json`,
   cita o ADR: a mesma conferência da instância principal), manda `SIGUSR2` e espera o `/api/health` dizer
   `restart: ready`: nenhum agente fica cortado no meio de um turno. Se o servidor não conhece o aviso, **não recebe
   o sinal** (um servidor antigo morreria com ele) e a troca segue. Depois do sinal: `waiting` espera; três leituras
   seguidas sem a chave `restart` mostram que o aviso não pegou e a troca segue; só `DOUG_FALHAS_SEGUIDAS` (3) leituras
   seguidas sem resposta dão o servidor por parado (uma falha solta não conta); no limite de
   `DOUG_PARADA_TIMEOUT_S` (15 min) troca assim mesmo, o que rodava continua depois, de onde parou.
6. **Backup, já com nada rodando.** `pg_dump -Fc` dentro do container do banco, em
   `/opt/doug-clientes/backups/<codigo>/pre-<imagem>-<data>.dump`. **Fora de `dados/`**: lá o cliente escreve, e um
   link simbólico levaria a escrita do root para fora da pasta dele. Se o backup falhar, o cliente **não é tocado** e o
   servidor sai do aviso de troca (reiniciado na mesma imagem se nada rodava; senão o aviso se solta sozinho em 30
   minutos, ADR doug-0005).
7. **Troca.** `mv` do `.env` novo; se o `.env` desliga as migrações no boot (`RUN_MIGRATIONS_ON_BOOT=false`) roda
   `docker compose run --rm --no-deps agentes migrate` antes (o `.env` do instalador não desliga: o servidor migra ao
   subir); `docker compose up -d`.
8. **Health e imagem.** Espera `status: ok` em até 5 minutos e confere, com `docker compose ps`, que o servidor roda a
   imagem nova. Dando certo, a coluna `imagem` de `clientes.tsv` passa à imagem nova (por um arquivo ao lado e um `mv`;
   a cópia anterior fica em `clientes.tsv.anterior`; um disco cheio não trunca o registro) e os backups de trocas boas
   são rotacionados (ficam `DOUG_BACKUPS_GUARDADOS`, 3).
9. **Volta.** Se não ficar saudável (ou rodar outra imagem, ou a migração falhar): restaura o `.env`, `up -d` na imagem
   anterior, espera o health de novo. O backup dessa tentativa vira `falhou-<imagem>-<data>.dump`, que **nunca é
   rotacionado**, e a imagem fica marcada.

O **banco não é restaurado sozinho**. Se a versão nova já migrou o esquema antes de falhar, a imagem anterior pode não
subir sobre ele: então o cliente aparece como *falhou* e o backup (caminho no log) é a volta.
Restaurar, com o servidor do cliente parado:
`docker compose exec -T postgres pg_restore -U agentes -d agentes --clean --if-exists < /opt/doug-clientes/backups/<codigo>/<arquivo>`.

### Script morto no meio da troca

Se o script for morto por `SIGTERM` ou `SIGINT` (o fim do prazo da unidade, `systemctl stop`, Ctrl-C), o `trap` restaura o
`.env`, tira o guarda e, se a troca já tinha sido feita, devolve o servidor à imagem anterior. Se for morto sem trap
(`SIGKILL`, queda da máquina), o `.env.antes-atualizar` fica no disco: **na rodada seguinte, antes de qualquer outra
coisa**, o script o restaura, sobe o cliente na imagem anterior, confere o health e o conta como *voltou* (a troca
interrompida não foi concluída; a próxima rodada tenta de novo). Um guarda igual ao `.env` (a morte veio antes do `mv`)
só é removido. Um cliente que já está na imagem pedida **só conta como "já na imagem" se o health disser ok**; sem health
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
doug-atualizar-clientes --forcar 064       # tenta de novo um cliente marcado com esta imagem (ver acima)
```

`--so` e `--exceto` vazios (`--so ""`, `--so ,`) são erro (código 2), nunca "todos". Um teste seguro antes de atualizar
de verdade: `--dry-run`, depois `--so <um cliente de teste>`.

### Saída e código de saída

O fim da saída é o resumo (também em `resumo.txt`): **atualizados**, **já na imagem**, **voltaram para a anterior**,
**falharam**, **pulados** e **sem iniciar**.

| Código | Significa |
| --- | --- |
| 0 | tudo certo |
| 1 | algum cliente **falhou** (sem backup, `.env` ilegível, permissões, imagem ausente, nem a anterior ficou saudável…) ou ficou **sem iniciar** (disjuntor) |
| 3 | nenhum falhou, mas algum **voltou** para a imagem anterior ou foi **pulado** por uma marca |
| 2 | uso errado ou algo global: imagem inexistente, registro ausente, `flock` ausente, outra atualização rodando, a instância principal se atualizando |

Logs: `/opt/doug-clientes/logs/atualizacao-<data>/<codigo>-<slug>.log` e `resumo.txt`; pastas com mais de 60 dias saem.
Sobras de execuções mortas (`.env.XXXXXX`, `*.dump.parcial`, `clientes.tsv.XXXXXX`) são apagadas.

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
| `DOUG_BACKUPS_GUARDADOS` | `3` |
| `DOUG_DISJUNTOR` | `2` |
| `DOUG_TRAVA_ESPERA_S` | `0` (a unidade põe `600`) |
| `DOUG_DONO_UID` | `0` (root) |
| `DOUG_LOG_DIR` | `$DOUG_CLIENTES_DIR/logs` |

## Travas e permissões (contrato com o instalador `doug-cliente`)

- **Travas.** `$RAIZ/.atualizar.lock` impede duas atualizações ao mesmo tempo (a segunda sai com 2); o script **exige
  `flock`** e sai com erro sem ele. `$RAIZ/.trava` é a trava do instalador (`doug-cliente novo`, `remover`): o
  atualizador a pega **por cliente**, enquanto o toca, e a solta entre um e outro; com a trava de outro, o cliente fica
  para a próxima rodada (ou espera `DOUG_TRAVA_ESPERA_S`). Dentro da trava confere de novo que o cliente continua no
  registro com o mesmo slug e a mesma porta (um `remover` no meio da rodada o deixa em *pulados*).
- **Dono e modo.** Como o script roda como root e escreve nessas pastas, ele recusa o cliente cuja pasta, `compose.yml`
  ou `.env` não seja de `DOUG_DONO_UID` (root) ou tenha escrita para grupo ou outros, e recusa links simbólicos em todo
  caminho que toca (a pasta do cliente, `compose.yml`, `.env`, `dados/`, `backups/`, `atualizacao/`). A raiz também.
  O instalador já cria assim (pasta `0755`, `compose.yml` `0644`, `.env` `0600`, tudo de root; só `dados/files` e
  `dados/postgres` pertencem ao cliente e o script não os toca): **não afrouxe isso**, nem rode o instalador com `umask`
  mais aberta que `022`.
- **Pastas do script**, criadas `0700` e de root: `backups/<codigo>/`, `atualizacao/marcas/`, `logs/`. `umask 077` no
  script todo. Os backups do `doug-cliente backup`/`remover` ficam em `backups/` também, com outros nomes
  (`<codigo>-<slug>-<data>.dump`); a rotação do atualizador só mexe em `backups/<codigo>/pre-*.dump`.

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
