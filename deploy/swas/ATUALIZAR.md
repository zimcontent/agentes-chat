# Atualizar todos os clientes do DougBot (SWAS)

`doug-atualizar-clientes` leva **todos** os clientes de `/opt/doug-clientes/clientes.tsv` para a mesma imagem
`agentes-zim:doug-<sha>`, um de cada vez. A imagem é a que a instância principal já gerou nesta máquina
(`doug-atualizar.service`): este script não compila nada.

## O que ele faz com cada cliente

1. **Cota.** Confere o tamanho de `dados/` contra `DOUG_CLIENT_QUOTA_GB` (padrão 40). Passar da cota é aviso no log;
   com `DOUG_QUOTA_ESTRITA=1` impede a atualização daquele cliente.
2. **Backup.** `pg_dump -Fc` dentro do container do banco, em `dados/backups/<codigo>-<data>.dump`. Guarda os 3
   últimos. Se o backup falhar, o cliente **não é tocado**.
3. **Ponto de parada** (ADR doug-0005). Manda `SIGUSR2` ao servidor do cliente e espera o `/api/health` dizer
   `restart: ready`: nenhum agente fica cortado no meio de um turno. Se não vier em 15 minutos, troca assim mesmo,
   como a instância principal; o que rodava continua depois, de onde parou.
4. **Troca.** Guarda o `.env` em `.env.antes-atualizar`, troca `DOUG_IMAGE`, roda `docker compose up -d`.
5. **Health.** Espera `status: ok` em até 5 minutos. Dizendo ok, a coluna `imagem` de `clientes.tsv` passa à imagem nova.
6. **Volta.** Se não disser, restaura o `.env`, roda `docker compose up -d` na imagem anterior e espera o health de
   novo.

O **banco não é restaurado sozinho**. Se a versão nova já migrou o esquema antes de falhar, a imagem anterior pode não
subir sobre ele: então o cliente aparece como *falhou* e o backup do passo 2 (caminho no log) é a volta.
Restaurar: `docker compose exec -T postgres pg_restore -U agentes -d agentes --clean --if-exists < dados/backups/<arquivo>`
(com o servidor do cliente parado).

Um cliente que falha não para os outros.

## Usar

```bash
doug-atualizar-clientes                    # a imagem agentes-zim:doug-* mais recente
doug-atualizar-clientes doug-abc123        # uma imagem específica
doug-atualizar-clientes --dry-run          # mostra o que faria; não toca em nada e não grava log
doug-atualizar-clientes --so 064           # só o cliente 064 (pode repetir ou separar por vírgula)
doug-atualizar-clientes --exceto 064,065   # todos menos esses
```

Um teste seguro antes de atualizar de verdade: `--dry-run`, depois `--so <um cliente de teste>`.

### Saída e código de saída

O fim da saída é o resumo (também em `resumo.txt`): **atualizados**, **já na imagem**, **voltaram para a anterior** e
**falharam**.

| Código | Significa |
| --- | --- |
| 0 | tudo certo |
| 1 | algum cliente **falhou** (sem backup, `.env` ilegível, nem a imagem anterior ficou saudável…) |
| 3 | nenhum falhou, mas algum **voltou** para a imagem anterior: a versão nova não subiu ali |
| 2 | uso errado ou algo global: imagem inexistente, registro ausente, outra atualização rodando |

Logs: `/opt/doug-clientes/logs/atualizacao-<data>/<codigo>-<slug>.log` e `resumo.txt`; pastas com mais de 60 dias saem.
Duas execuções ao mesmo tempo não acontecem: a segunda sai com código 2.

### Variáveis (todas opcionais)

| Variável | Padrão |
| --- | --- |
| `DOUG_CLIENTES_DIR` | `/opt/doug-clientes` |
| `DOUG_CLIENT_QUOTA_GB` | `40` |
| `DOUG_IMAGE_REPO` | `agentes-zim` |
| `DOUG_SERVER_SERVICE`, `DOUG_DB_SERVICE` | `agentes`, `postgres` (serviços do `compose.yml` do cliente) |
| `DOUG_DB_USER`, `DOUG_DB_NAME` | `agentes`, `agentes` |
| `DOUG_PARADA_TIMEOUT_S` | `900` |
| `DOUG_SAUDE_TIMEOUT_S` | `300` |
| `DOUG_POLL_S` | `5` |
| `DOUG_BACKUPS_GUARDADOS` | `3` |
| `DOUG_LOG_DIR` | `$DOUG_CLIENTES_DIR/logs` |

## Instalar na máquina

O serviço roda como root, então o script tem que ser de root e ninguém mais pode alterá-lo:

```bash
sudo install -m 0755 -o root -g root deploy/swas/doug-atualizar-clientes /usr/local/sbin/doug-atualizar-clientes
sudo install -m 0644 deploy/swas/systemd/doug-atualizar-clientes.service deploy/swas/systemd/doug-atualizar-clientes.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now doug-atualizar-clientes.timer
```

O timer roda toda madrugada às 04:30 (com até 10 minutos de atraso aleatório), depois da atualização da instância
principal. Para ver: `systemctl list-timers doug-atualizar-clientes.timer` e `journalctl -u doug-atualizar-clientes`.

## Regra de sudo para disparar à mão

A conta de operação não precisa de root para o resto: só para pedir ao systemd que inicie o serviço. A regra é esta,
exata, igual à da atualização da instância principal, em `/etc/sudoers.d/doug-atualizar-clientes` (edite com
`sudo visudo -f`):

```
agentes ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block doug-atualizar-clientes.service
```

(troque `agentes` pela conta de operação). Uso: `sudo systemctl start --no-block doug-atualizar-clientes.service`, e o
andamento em `journalctl -u doug-atualizar-clientes -f`. Essa regra dispara sempre a imagem mais recente, para todos
os clientes. **Não** dê sudo para `doug-atualizar-clientes` com argumentos livres: `--so`, `--exceto` e a tag viram
comandos de root para quem tiver a regra. Uma atualização parcial se faz como root, direto no script.

## Antes de depender dele

- Os clientes precisam rodar uma imagem que já conhece o ADR doug-0005 (o `SIGUSR2` do aviso de troca): uma anterior
  trata o sinal como fim do processo. Os clientes novos nascem com a imagem atual, então vale.
- O script supõe, no `compose.yml` do cliente, os serviços `agentes` e `postgres` e `DOUG_IMAGE` no `.env`; se o
  instalador usar outros nomes, ajuste `DOUG_SERVER_SERVICE` e `DOUG_DB_SERVICE` no serviço.
