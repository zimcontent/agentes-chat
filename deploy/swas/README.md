# DougBot como serviço: um cliente por stack

Cada empresa cliente roda numa stack Docker só dela: o servidor do DougBot, um Postgres só dela e uma
rede só dela, com os dados numa pasta só (`dados/`). Um proxy no host (Caddy) dá a cada cliente o seu
endereço, `<slug>.dougbot.app`, com TLS automático. Tudo se faz com um comando, o `doug-cliente`.

```
/opt/doug-clientes/                 root, 711
├── .lock                         a trava única (flock), a mesma do doug-atualizar-clientes (root, 600)
├── doug-cliente.conf             (opcional) configuração fixa da máquina, de root (veja "Configuração da máquina")
├── clientes.tsv                  o registro: codigo slug nome porta imagem criado_em (tabulação, sem cabeçalho; root, 600)
├── proxy/                        (modo externo) os <slug>.caddy que o contêiner do proxy monta, 755
├── 064-padaria-aurora/           root, 711
│   ├── compose.yml               cópia de deploy/swas/compose.cliente.yml (root, 644)
│   ├── .env                      gerado de cliente.env.example, com segredos aleatórios (root, 600)
│   ├── link-do-dono.txt          o link do primeiro acesso (root, 600)
│   └── dados/                    711
│       ├── postgres/             o banco (o diretório de dados dele é 700 do usuário postgres)
│       └── files/                os arquivos que o cliente envia (700, do uid do cliente: 100000 + o código)
├── backups/                      root, 700
│   └── 064/                      root, 700: dumps de `backup` e de `remover`, fora de dados/
└── removidos/                    pastas de clientes removidos sem --apagar-dados (root, 700)
```

As permissões são parte do contrato, e o `novo` as refaz também ao retomar: só o root lê a pasta de um
cliente por dentro. O servidor de cada cliente roda com um uid só dele, `100000 + o código` (o 064 é o
100064, gravado como `DOUG_UID` no `.env`; o compose usa `user: "${DOUG_UID}:${DOUG_UID}"`), que é o
dono de `dados/files`: não é o de um login da máquina (o 1000) nem o de outro cliente, e um não lê os
arquivos do outro. A imagem aceita qualquer uid (o `/app` é do root e legível por todos; o servidor só
escreve em `/tmp`, que é um tmpfs, e em `FILES_DIR`), então não há `group_add` nem ajuste na imagem. A pasta, o `compose.yml` e o `.env` são do root e não têm escrita para grupo
nem outros; o `doug-atualizar-clientes` recusa o cliente que não estiver assim.

O código do cliente (`064`) tem 3 dígitos e prende as customizações dele; o slug (`padaria-aurora`)
vira o subdomínio. O servidor do cliente recebe `DOUG_CLIENT_CODE=064`.

## Pré-requisitos

1. **DNS curinga.** Um registro `*.dougbot.app` (tipo A, e AAAA se a máquina tiver IPv6) apontando
   para o IP público da máquina. Com ele, cada cliente novo já nasce com o endereço resolvendo, sem
   mexer no DNS de novo. Confira: `dig +short qualquer-coisa.dougbot.app`.
2. **Portas 80 e 443** abertas no firewall da máquina e do provedor, no proxy que atende os clientes
   (ele pede e renova os certificados do Let's Encrypt por elas). O Let's Encrypt limita a quantidade de certificados por
   domínio por semana: ao subir muitos clientes de uma vez, espalhe-os em dias.
3. **Docker Engine com o plugin Compose v2** (`docker compose version`) e o `flock` (util-linux): sem
   `flock` o script sai com erro, porque a trava contra o `doug-atualizar-clientes` é obrigatória. A
   porta de cada servidor só abre no loopback (`127.0.0.1`); quem fala com a internet é o proxy.
4. **O repositório nesta máquina**, num lugar que só o root escreve (os exemplos usam
   `/opt/doug-swas`): o `doug-cliente` roda como root e copia os modelos desta pasta, então quem
   altera estes arquivos altera o que roda como root.
5. **A rede de cada cliente é fixa: `10.64.<código>.0/24`.** O compose do cliente declara a sub-rede
   (`DOUG_REDE=10.64.64` no `.env`, de onde o `TRUSTED_PROXIES` do servidor tira a faixa dele), então
   nada depende do `default-address-pools` do Docker e não há limite de 31 redes. O limite é outro:
   a rede só tem um terceiro número de 0 a 255, e por isso **o código do cliente vai de 000 a 255**
   (o `doug-cliente` recusa um código maior). Confira que `10.64.0.0/16` está livre nesta máquina
   (`ip route | grep '^10\.64\.'`, a rede privada do provedor, uma VPN) e que o
   `default-address-pools` do Docker, se houver um, não cobre essa faixa. Os contêineres do cliente
   pegam endereços de `.128` para cima; o `.1` é o gateway e o `.2` é do proxy, no modo externo.
6. **O proxy** (Caddy), em um destes dois modos, definidos em "O proxy" mais abaixo: o do MVP, que usa o
   proxy que já roda na máquina, ou um Caddy próprio, só para uma máquina dedicada.
7. **A imagem do servidor** (`agentes-zim:doug-<sha>`, a mesma da instância principal) já
   construída nesta máquina. Sem `--imagem`, o `novo` usa a `agentes-zim:doug-*` mais nova que achar.
8. **Disco.** A cota é de 40 GB por cliente (`DOUG_CLIENT_QUOTA_GB`). O `novo` se recusa a criar um
   cliente quando o disco não cobre a cota de todos: o que falta a cada cliente de hoje para chegar à
   cota dele, mais a cota do novo (com root, mede o `dados/` de cada um; leva um tempo com muitos). Arquivos grandes devem ir para o armazenamento externo
   configurado, não para `dados/files`.
9. **A regra de sudo**, exata, sem senha e só para este script. Em `/etc/sudoers.d/doug-cliente`
   (crie com `sudo visudo -f /etc/sudoers.d/doug-cliente`):

   ```
   equipe ALL=(root) NOPASSWD: /opt/doug-swas/deploy/swas/doug-cliente
   ```

   `equipe` é o usuário (ou `%grupo`) que opera os clientes. O caminho é completo e sem curinga: a
   regra libera este arquivo e mais nada, e quem a usa passa os subcomandos (`novo`, `lista`…), que o
   script valida. Pontos de atenção:

   - o ambiente do `sudo` é limpo (e deve continuar sendo): as opções fixas da máquina, como o
     comando de recarga do proxy, ficam em `/opt/doug-clientes/doug-cliente.conf` (veja "Configuração
     da máquina"), não em variáveis de ambiente;
   - o arquivo `doug-cliente` e a pasta `deploy/swas/` têm de ser do root (`root:root`, sem escrita
     para o grupo ou para os outros); do contrário, quem edita o script vira root;
   - não troque o caminho por `ALL` nem por um padrão com `*`;
   - confira o resultado com `sudo -l -U equipe` e teste: `sudo /opt/doug-swas/deploy/swas/doug-cliente lista`.

## Passo a passo: um cliente novo

Exemplo: o cliente nº 64, a Padaria Aurora.

1. **Veja o que vai acontecer**, sem mudar nada:

   ```sh
   sudo /opt/doug-swas/deploy/swas/doug-cliente novo 064 padaria-aurora "Padaria Aurora" --dry-run
   ```

   Ele confere que o código e o slug estão livres, escolhe a porta, e lista cada passo.

2. **Crie o cliente:**

   ```sh
   sudo /opt/doug-swas/deploy/swas/doug-cliente novo 064 padaria-aurora "Padaria Aurora"
   ```

   Em ordem, ele:

   1. valida o código (3 dígitos), o slug e o nome, e **pega a trava** `/opt/doug-clientes/.lock`
      (a mesma do `doug-atualizar-clientes`: um dos dois espera o outro terminar);
   2. confere em `clientes.tsv` que o código e o slug estão livres, e que o disco cobre a cota;
   3. escolhe uma porta de loopback livre (a partir da 3100), pulando as do registro, as de todo
      `.env` de pasta de cliente (mesmo o de um que caiu antes de ser registrado) e as que o host usa;
   4. cria `/opt/doug-clientes/064-padaria-aurora/` com o `compose.yml`, o `.env` (segredos de
      `openssl rand`) e `dados/`, nas permissões da tabela acima;
   5. sobe a stack: `docker compose -p doug-064 up -d`;
   6. espera o `/api/health` responder (até 240 s);
   7. escreve `caddy/clientes/padaria-aurora.caddy` e faz o proxy lê-lo (veja "O proxy");
   8. registra o cliente em `clientes.tsv`.

3. **Entregue o link do primeiro acesso.** No fim, o comando mostra
   `https://padaria-aurora.dougbot.app/owner#claim=…` (também fica em `link-do-dono.txt`). O cadastro
   do cliente nasce fechado: só quem tem esse link cria a primeira conta, a dona ou o dono do
   espaço. Depois da primeira conta, o link não serve mais.

4. **Configure o cliente:** a conta de IA e os conectores ficam no próprio app, em Configurações.
   Opcionais do servidor (e-mail, backup para o Drive do cliente) entram no `.env` do cliente (do
   root, só o root edita: `sudoedit`): veja os comentários em `cliente.env.example`. Depois de mudar o
   `.env`:

   ```sh
   sudo /opt/doug-swas/deploy/swas/doug-cliente iniciar 064
   ```

Se o comando cair no meio (a imagem demorou, o Caddy recusou, a máquina reiniciou), **rode o mesmo
comando de novo**: ele continua de onde parou, mantém o `.env` e os segredos que já existem e só
registra o cliente no fim, quando tudo funciona.

## Operação

```sh
doug-cliente lista                              # clientes, porta, estado e imagem
doug-cliente parar 064                          # para a stack (os dados ficam)
doug-cliente iniciar 064                        # sobe de novo e espera o /api/health
doug-cliente backup 064                         # dump do banco em /opt/doug-clientes/backups/064/
doug-cliente compose 064                        # reinstala o compose.yml e acrescenta ao .env o que o modelo ganhou
doug-cliente remover 064                        # pede confirmação, faz backup, tira do ar e do proxy
doug-cliente remover 064 --apagar-dados         # idem, arquiva dados/files num tar e apaga a pasta
doug-cliente cota                               # uso de disco de cada cliente contra a cota
doug-cliente religar-proxy                      # modo externo: liga o proxy à rede de cada cliente e recarrega (depois de recriar o proxy)
doug-cliente limpar-backups 064 --antes 2026-12-17   # apaga os manual-* e remocao-* anteriores (veja "Backups e dados de quem saiu")
```

(Todos como `sudo /opt/doug-swas/deploy/swas/doug-cliente …`.) O `--dry-run` vale em qualquer comando
que muda algo. `novo`, `remover`, `parar`, `iniciar`, `backup` e `compose` (tudo o que escreve no
`clientes.tsv`, nas pastas dos clientes ou no Docker deles) rodam sob a trava `/opt/doug-clientes/.lock`;
com ela ocupada, esperam até `DOUG_TRAVA_ESPERA` s (120) e saem com erro.

- **`compose`** é o caminho para um modelo que mudou (uma variável nova no `cliente.env.example`, um
  limite no `compose.cliente.yml`): reinstala o `compose.yml` do cliente a partir do modelo e acrescenta
  ao `.env` só as variáveis que faltam, sem mexer nas que existem. Não inventa segredo: sem
  `AGENTES_SECRET` ou `POSTGRES_PASSWORD` no `.env`, recusa. Para aplicar: `doug-cliente iniciar <codigo>`.
- **`remover`** pede para você digitar o slug (com `--apagar-dados`, `APAGAR <slug>`; `--sim` pula a
  pergunta, para scripts). O servidor do cliente é parado antes do dump (`stop agentes`: nada é gravado
  entre o dump e o fim; o Postgres fica no ar para o dump), e o backup do banco vem antes de qualquer
  outra coisa: se ele falhar, o servidor é religado e nada é removido. Sem `--apagar-dados`, a pasta inteira (com `dados/` e `.env`) vai para
  `/opt/doug-clientes/removidos/` e o código e o slug ficam livres. Com `--apagar-dados`, antes de
  apagar a pasta o script **arquiva `dados/files` num tar** (`remocao-<data>-files.tar`, 600) ao lado do
  dump, em `/opt/doug-clientes/backups/<codigo>/`, com a stack parada (a confirmação e a mensagem final
  dizem isso), e copia o `.env` (que tem o `AGENTES_SECRET`, sem o qual as chaves guardadas no backup
  não abrem) também ao lado. Se o tar falhar, nada é apagado. O backup do banco é o dump; os
  arquivos de `dados/files` só entram no tar do `--apagar-dados`. Os nomes começam com `manual-`
  (`backup`) e `remocao-` (`remover`) e ficam fora de `dados/`, onde a poda de backups do
  `doug-atualizar-clientes` e a cota não os alcançam.
- **`cota`** mostra o uso de `dados/` de cada cliente contra `DOUG_CLIENT_QUOTA_GB` (40 por padrão) e
  sai com código 3 se algum passou, para um alerta ler. Rode como root: o Postgres dos clientes não é
  legível por outros usuários.
- Limites de memória e de CPU de cada cliente vêm de variáveis com padrão no compose
  (`DOUG_MEMORY`, `DOUG_CPUS`, `DOUG_PG_MEMORY`, `DOUG_PG_CPUS`): ponha a linha no `.env` do cliente.
- Atualizar a imagem de todos os clientes é com o `doug-atualizar-clientes`, ao lado deste script.

## O proxy

O proxy dá a cada cliente o endereço `<slug>.dougbot.app`. O `doug-cliente` escreve um arquivo por
cliente, `<slug>.caddy`, com o bloco do site, e faz o proxy lê-lo. `DOUG_PROXY_MODE` escolhe como
(na `doug-cliente.conf`; padrão `externo`):

**(b) `externo`, o do MVP: sem Caddy próprio.** Na máquina do MVP as portas 80 e 443 já são de um
**contêiner** Caddy, o da instância principal (`docker-compose.yml` da raiz do repositório: ele
publica 80 e 443 e recebe o Caddyfile por `configs:`), na rede bridge dele. Um `reverse_proxy
127.0.0.1:<porta>` cairia no loopback do próprio contêiner, por isso o instalador **liga o contêiner
do proxy à rede de cada cliente** e usa o nome do contêiner do servidor como upstream:

```
padaria-aurora.dougbot.app {
	reverse_proxy doug-064-agentes-1:3000
	...
}
```

O `novo` faz `docker network connect --ip 10.64.64.2 doug-064 <contêiner do proxy>` (o endereço `.2`
da rede do cliente, o único que o servidor dele aceita como proxy: `TRUSTED_PROXIES=10.64.64.0/24`) e
escreve o arquivo na pasta dos sites. A porta de loopback do servidor (`127.0.0.1:<porta>`) continua
publicada, só para o `/api/health` do `doug-cliente` e do `doug-atualizar-clientes`; o proxy não passa
por ela.

**O que mudar uma vez no compose da instância principal** (nesta máquina,
`/opt/agentes-chat/docker-compose.override.yml`; o `docker-compose.yml` fica como está): montar a
pasta dos sites no Caddy e importá-la no Caddyfile.

```yaml
services:
  caddy:
    volumes:
      - /opt/agentes-chat/caddy-errors:/srv/doug-errors:ro   # o que já existe
      - /opt/doug-clientes/proxy:/etc/caddy/clientes:ro      # NOVO: a pasta dos sites (host:contêiner)
configs:
  caddyfile:
    content: |
      # ...os blocos que já existem (dougbot.app, www.dougbot.app)...
      import /etc/caddy/clientes/*.caddy                     # NOVO, no fim
```

Depois: `docker compose up -d caddy` (recria o Caddy; segundos de corte, uma vez) e crie a pasta
`mkdir -p /opt/doug-clientes/proxy`. Sem arquivos na pasta, o `import` não casa nada e o Caddy
segue normal. O `docker compose up -d` de uma atualização da instância principal recria o contêiner
do Caddy **e ele perde as ligações às redes dos clientes**: depois de cada atualização dela, rode

```sh
sudo /opt/doug-swas/deploy/swas/doug-cliente religar-proxy   # liga de novo cada rede e recarrega o proxy
```

(é seguro rodar sempre: não liga o que já está ligado). Se o atualizador da instância principal
roda sozinho, ponha esse comando no fim dele. Reiniciar o contêiner (sem recriar) mantém as ligações.

E na `/opt/doug-clientes/doug-cliente.conf`, com o nome do contêiner (`docker ps --format
'{{.Names}}' | grep caddy`) e o **caminho do host** da pasta montada acima:

```
DOUG_PROXY_MODE=externo
DOUG_PROXY_CONTAINER=agentes-chat-caddy-1
DOUG_PROXY_SITES_DIR=/opt/doug-clientes/proxy
DOUG_PROXY_RELOAD="docker exec agentes-chat-caddy-1 caddy reload --config /etc/caddy/Caddyfile"
```

(`agentes-chat-caddy-1` é um exemplo: use o nome que o `docker ps` mostrar.) O `novo` e o `remover`
rodam o `DOUG_PROXY_RELOAD` depois de escrever ou tirar um arquivo; se ele falhar, o arquivo volta ao
que era e o `novo` para sem registrar o cliente. Sem `DOUG_PROXY_RELOAD`, o script só avisa. O
`remover` desliga o contêiner do proxy da rede do cliente antes de derrubá-la (o Compose não derruba
uma rede com alguém ligado: se você derrubar um cliente à mão, desligue antes
`docker network disconnect doug-064 <contêiner>`).

**(a) `proprio`: Caddy próprio, para uma máquina dedicada.** `caddy/compose.yml` roda um Caddy só,
na rede do host (abre 80 e 443: use só onde elas estão livres), com o `caddy/Caddyfile` importando
`caddy/clientes/*.caddy` (o upstream é `127.0.0.1:<porta>`). O `doug-cliente` o sobe sozinho no
primeiro cliente e o recarrega a cada mudança. A API de administração do Caddy **não é uma porta**: é
um socket Unix (`/run/caddy-admin/admin.sock`) num volume do Docker (`caddy-admin`), que só o root do
host alcança, e o reload vai por `caddy reload --address unix//run/caddy-admin/admin.sock`. Para subir
ou recarregar à mão:

```sh
docker compose -f /opt/doug-swas/deploy/swas/caddy/compose.yml up -d
docker compose -f /opt/doug-swas/deploy/swas/caddy/compose.yml exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --address unix//run/caddy-admin/admin.sock --force
```

Se o Caddy recusar o arquivo de um cliente, o `doug-cliente` devolve o arquivo ao que era e para com
o erro, sem registrar o cliente.

## Configuração da máquina

O `sudo` limpa o ambiente, e um comando lido do ambiente de quem chama (como `DOUG_PROXY_RELOAD`)
rodaria como root: por isso o que é fixo da máquina vai em `/opt/doug-clientes/doug-cliente.conf`, um
arquivo de root (do usuário que roda o script, e sem escrita para grupo nem outros; senão o script
recusa), com precedência sobre o ambiente. **O arquivo não é executado** (não há `source`): cada linha
é `NOME=valor` (o valor pode vir entre aspas, que são tiradas; `$(...)` e `$VAR` ficam como texto),
só vale a chave da lista abaixo, e uma linha de outro formato faz o script parar. Uma chave que não
é da lista é ignorada, com um aviso. `DOUG_CLIENTES_DIR` não vale aí (o arquivo fica dentro dessa
pasta): ele só vale no ambiente. As chaves: `DOUG_CADDY_DIR`, `DOUG_DOMINIO`, `DOUG_PROXY_MODE`,
`DOUG_PROXY_CONTAINER`, `DOUG_PROXY_SITES_DIR`, `DOUG_PROXY_RELOAD`, `DOUG_IMAGE_REPO`,
`DOUG_CLIENT_QUOTA_GB`, `DOUG_PORTA_INICIAL`, `DOUG_PORTA_FINAL`, `DOUG_HEALTH_TIMEOUT` e
`DOUG_TRAVA_ESPERA`.

```sh
DOUG_PROXY_MODE=externo
DOUG_PROXY_CONTAINER=agentes-chat-caddy-1
DOUG_PROXY_SITES_DIR=/opt/doug-clientes/proxy
DOUG_PROXY_RELOAD="docker exec agentes-chat-caddy-1 caddy reload --config /etc/caddy/Caddyfile"
DOUG_DOMINIO=dougbot.app
DOUG_CLIENT_QUOTA_GB=40
```

As variáveis que o script lê estão no começo dele (`doug-cliente ajuda`).

## Backups e dados de quem saiu (LGPD)

Os backups do `doug-cliente` (`manual-*` do `backup`, `remocao-*` do `remover`) ficam em
`/opt/doug-clientes/backups/<codigo>/` (700, do root), fora de `dados/`. Têm dados pessoais do
cliente, e por isso precisam de um **prazo de guarda**: defina um (a sugestão do MVP é 30 dias depois
da saída do cliente para `remocao-*`, e 90 dias para os `manual-*`; confirme com o contrato e com o
jurídico), cumpra-o e apague depois dele.

- O `remover` sem `--apagar-dados` guarda a pasta inteira em `removidos/` (700), com o banco, os
  arquivos e o `.env`: apague com `rm -rf` ao fim do prazo.
- O `remover --apagar-dados` apaga a pasta, **mas guarda em `backups/<codigo>/`**: o dump do banco
  (pessoas, mensagens, as chaves guardadas, cifradas), o tar de `dados/files` (os arquivos que o
  cliente enviou) e o `.env` (o `AGENTES_SECRET`, que abre as chaves do dump). Os três contam como
  dados do cliente até serem apagados.
- Para apagar o que passou do prazo (também de um cliente já removido, e a pedido dele):

  ```sh
  sudo /opt/doug-swas/deploy/swas/doug-cliente limpar-backups 064 --antes 2026-12-17
  ```

  Lista o que é de antes da data e pede a confirmação (`LIMPAR 064`; `--sim` pula a pergunta, e
  `--dry-run` só lista). Só mexe nos `manual-*` e `remocao-*` (com o `.env` e o tar que vão ao lado);
  os `pre-*` e `falhou-*` são do `doug-atualizar-clientes`, que os poda.

## Endpoint de modelo privado de um cliente

O modelo do `.env` traz `MODEL_ENDPOINTS_PRIVATE=false`. Sem essa linha, o servidor (com
`ALLOW_SIGNUP=false`, fora da agentes.chat Cloud) **libera** endereços privados e `http`: o cliente
poderia apontar um endpoint de modelo, um conector MCP, um bucket ou uma página que os agentes leem
para serviços desta máquina (o Postgres de outro cliente, o Docker, o painel do proxy) e para o
endpoint de metadados do provedor (`169.254.169.254`). Com `false`, só endereços públicos em https
passam, conferidos a cada conexão.

Só abra para um cliente que precisa de um modelo na rede dele (um Ollama ou vLLM na máquina): edite o
`.env` dele (`sudoedit /opt/doug-clientes/064-padaria-aurora/.env`) para `MODEL_ENDPOINTS_PRIVATE=true`
e aplique com `doug-cliente iniciar 064`. A linha existe no `.env`, então o `doug-cliente compose` e
o `doug-atualizar-clientes` não a desfazem. Antes de abrir, bloqueie o endpoint de metadados no host
para os contêineres (regra na cadeia `DOCKER-USER`, ou `iptables -I DOCKER-USER -d 169.254.169.254 -j DROP`),
porque `true` libera também ele, e saiba que o cliente passa a alcançar tudo o que o loopback e a
rede do Docker alcançam.

## Fora desta versão

O modelo do cliente tem o servidor e o Postgres. Voz, busca por vetores, WhatsApp e o backup diário
automático para um bucket ficam de fora por enquanto: o backup é o `doug-cliente backup`, e o do
Drive do cliente se liga pelas variáveis `BACKUP_GOOGLE_DRIVE_*` do `.env`.

## Testes

```sh
bash deploy/swas/test/doug-cliente.test.sh
```

Usam `docker`, `curl`, `openssl`, `chown` e `du` falsos num diretório temporário: não precisam de
Docker, de rede nem de root. Cobrem os arquivos gerados, o `clientes.tsv`, as recusas (código e slug
repetidos, slugs com `}`, `/`, `;` e quebra de linha, argumentos e imagens inválidos), o `--dry-run`, a
retomada, a corrida e a retomada de porta (três `novo` ao mesmo tempo), a trava `.lock` (e o disco
medido antes dela) e o erro sem `flock`, o descritor da trava que não passa aos filhos, as permissões
(`.lock`, `clientes.tsv`, `backups/`, `removidos/`, a pasta do cliente), o uid e a rede por cliente
(`chown` e `TRUSTED_PROXIES`), os dois modos de proxy (a ligação à rede, o upstream pelo nome, o
`remover`, o `religar-proxy`), a conf de root, o subcomando `compose`, `remover` (com e sem
`--apagar-dados`, e a janela de escrita), `limpar-backups` e `cota`. Onde o `docker compose` de
verdade existe, rodam também `docker compose config` no compose e no `.env` gerados; sem ele, essa
parte é pulada.
