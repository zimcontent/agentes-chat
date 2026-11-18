# DougBot como serviço: um cliente por stack

Cada empresa cliente roda numa stack Docker só dela: o servidor do DougBot, um Postgres só dela e uma
rede só dela, com os dados numa pasta só (`dados/`). Um proxy no host (Caddy) dá a cada cliente o seu
endereço, `<slug>.dougbot.app`, com TLS automático. Tudo se faz com um comando, o `doug-cliente`.

```
/opt/doug-clientes/                 root, 711
├── .lock                         a trava única (flock), a mesma do doug-atualizar-clientes (root, 600)
├── doug-cliente.conf             (opcional) configuração fixa da máquina, de root (veja "Configuração da máquina")
├── clientes.tsv                  o registro: codigo slug nome porta imagem criado_em (tabulação, sem cabeçalho; root, 600)
├── proxy/                        (modo externo) os <slug>.caddy que o contêiner do proxy monta (root, 700; 750 com DOUG_PROXY_SITES_GRUPO)
├── 064-padaria-aurora/           root, 711
│   ├── compose.yml               cópia de deploy/swas/compose.cliente.yml (root, 644)
│   ├── .env                      gerado de cliente.env.example, com segredos aleatórios (root, 600)
│   ├── link-do-dono.txt          o link do primeiro acesso (root, 600)
│   └── dados/                    711
│       ├── postgres/             o banco (o diretório de dados dele é 700 do usuário postgres)
│       └── files/                os arquivos que o cliente envia (700, do uid do cliente: DOUG_UID do .env)
├── backups/                      root, 700
│   └── 064/                      root, 700: manual-<slug>-<data>.dump e remocao-<slug>-<data>.*, fora de dados/
└── removidos/                    pastas de clientes removidos sem --apagar-dados (root, 700)
```

As permissões são parte do contrato, e o `novo` as refaz também ao retomar: só o root lê a pasta de um
cliente por dentro. O servidor de cada cliente roda com um uid só dele, `DOUG_UID_BASE + o código` (o
padrão da base é `1000000000`: o 064 é o 1000000064, gravado como `DOUG_UID` no `.env`; o compose usa
`user: "${DOUG_UID}:${DOUG_UID}"`), que é o dono de `dados/files`. A base fica longe do `100000` com
que o `useradd` e o `newuidmap` dão as faixas de `/etc/subuid` e `/etc/subgid` aos logins (um login com
`ubuntu:100000:65536` e o `newuidmap` vira qualquer uid dessa faixa e leria os arquivos dos clientes): o
`novo` **recusa** um uid que caia numa faixa de `/etc/subuid` ou `/etc/subgid`, que exista em
`/etc/passwd` ou `/etc/group`, ou que já seja o `DOUG_UID` de outro cliente, e diz de quem é. Quem
confere é só o `novo` (e o `compose` num `.env` de antes do uid): o `DOUG_UID` fica gravado e os outros
comandos o leem de lá, nunca o calculam de novo, então mudar `DOUG_UID_BASE` depois não mexe nos clientes
que existem. Um não lê os arquivos do outro. A imagem aceita qualquer uid (o `/app` é do root e legível por todos; o servidor só
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
   porta de cada servidor só abre no loopback (`127.0.0.1`), e quem fala com a internet é o proxy; mas
   o loopback não é privado: leia "A porta de loopback".
4. **O repositório nesta máquina**, num lugar que só o root escreve (os exemplos usam
   `/opt/doug-swas`): o `doug-cliente` roda como root e copia os modelos desta pasta, então quem
   altera estes arquivos altera o que roda como root.
5. **A rede de cada cliente é fixa: `10.64.<código>.0/24`.** O compose do cliente declara a sub-rede
   (`DOUG_REDE=10.64.64` no `.env`, de onde o `TRUSTED_PROXIES` do servidor tira a faixa dele), então
   nada depende do `default-address-pools` do Docker e não há limite de 31 redes. O limite é outro:
   a rede só tem um terceiro número de 0 a 255, e por isso **o código do cliente vai de 000 a 255**
   (o `doug-cliente` recusa um código maior). Confira que `10.64.0.0/16` está livre nesta máquina
   (`ip route | grep '^10\.64\.'`, a rede privada do provedor, uma VPN) e que o
   `default-address-pools` do Docker, se houver um, não cobre essa faixa. O `novo` confere isso antes
   de criar a pasta: compara a sub-rede do cliente com a de toda rede do Docker (`docker network
   inspect`) e com as rotas da máquina (`ip route`), e se colidir recusa e diz com quê. Os contêineres
   do cliente pegam endereços de `.128` para cima; o `.1` é o gateway e o `.2` é do proxy, no modo
   externo.
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
   7. escreve o `padaria-aurora.caddy` na pasta dos sites (`DOUG_PROXY_SITES_DIR`, por exemplo
      `/opt/doug-clientes/proxy/` no modo externo; `deploy/swas/caddy/clientes/` no próprio), faz o
      proxy lê-lo e confere que ele o enxerga (veja "O proxy");
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
doug-cliente novo 064 café-sol "Café Sol" --reusar-codigo   # o código de um cliente removido, para outro cliente (veja "Backups")
doug-cliente cota                               # uso de disco de cada cliente contra a cota
doug-cliente religar-proxy                      # modo externo: liga o proxy à rede de cada cliente e recarrega (depois de recriar o proxy)
doug-cliente limpar-backups 064 --antes 2026-12-17 [--slug padaria-aurora]   # apaga os manual-* e remocao-* anteriores (veja "Backups e dados de quem saiu")
doug-cliente limpar-removidos --antes 2026-12-17 [064]   # apaga as pastas de removidos/ de antes da data
```

(Todos como `sudo /opt/doug-swas/deploy/swas/doug-cliente …`.) O `--dry-run` vale em qualquer comando
que muda algo. `novo`, `remover`, `parar`, `iniciar`, `backup` e `compose` (tudo o que escreve no
`clientes.tsv`, nas pastas dos clientes ou no Docker deles, e o `religar-proxy`, o `limpar-backups` e
o `limpar-removidos`) rodam sob a trava `/opt/doug-clientes/.lock`;
com ela ocupada, esperam até `DOUG_TRAVA_ESPERA` s (120) e saem com erro.

- **`compose`** é o caminho para um modelo que mudou (uma variável nova no `cliente.env.example`, um
  limite no `compose.cliente.yml`): reinstala o `compose.yml` do cliente a partir do modelo e acrescenta
  ao `.env` só as variáveis que faltam, sem mexer nas que existem; passa todo o `dados/files` ao uid do
  `.env` (`chown -hR`, para o cliente que veio com os arquivos de outro uid) e, no modo externo, liga o
  proxy à rede do cliente se ela existir. Não inventa segredo: sem `AGENTES_SECRET` ou
  `POSTGRES_PASSWORD` no `.env`, recusa. Para aplicar: `doug-cliente iniciar <codigo>`.
- **`iniciar`** sobe a stack e espera o `/api/health`. No modo externo, se o `up` falha com o proxy
  ligado à rede do cliente (uma sub-rede ou um `ipam` que mudou no `compose.yml`: o Compose não recria
  uma rede com alguém ligado), desliga o proxy dessa rede, sobe de novo e liga o proxy outra vez; no fim
  religa o proxy se ele estiver fora da rede (o contêiner dele foi recriado).
- **`remover`** pede para você digitar o slug (com `--apagar-dados`, `APAGAR <slug>`; `--sim` pula a
  pergunta, para scripts). O servidor do cliente é parado antes do dump (`stop agentes`: nada é gravado
  entre o dump e o fim; o Postgres fica no ar para o dump), e o backup do banco vem antes de qualquer
  outra coisa. **Se algo falhar depois de parar o servidor e antes de derrubar a stack** (o dump, o tar,
  o `.env` copiado, desligar o proxy da rede, o próprio `down`), o servidor é religado (`up -d
  agentes`) e o proxy volta à rede dele, e a mensagem diz o que foi feito: religou ou, se nem isso deu,
  que o servidor continua parado e que comando rodar (`iniciar`, `religar-proxy`); nada é removido.
  Depois do `down` a remoção não volta atrás, e cada falha dali diz onde as coisas ficaram. Sem
  `--apagar-dados`, a pasta inteira (com `dados/` e `.env`) vai para `/opt/doug-clientes/removidos/` e o
  código e o slug ficam livres. Com `--apagar-dados`, antes de apagar a pasta o script **arquiva
  `dados/files` num tar** (`remocao-<slug>-<data>-files.tar`, 600) ao lado do dump, em
  `/opt/doug-clientes/backups/<codigo>/`, com o servidor parado (a confirmação e a mensagem final dizem
  isso), e copia o `.env` (que tem o `AGENTES_SECRET`, sem o qual as chaves guardadas no backup não
  abrem) também ao lado. Se o tar falhar, nada é apagado. O backup do banco é o dump; os arquivos de
  `dados/files` só entram no tar do `--apagar-dados`. Os nomes são `manual-<slug>-<data>` (`backup`) e
  `remocao-<slug>-<data>` (`remover`), ficam fora de `dados/`, e a poda de backups do
  `doug-atualizar-clientes` e a cota não os alcançam.
- **`religar-proxy`** (modo externo) tenta todos os clientes do `clientes.tsv`: liga o proxy à rede de
  cada um que ainda não está nela, pula com aviso o que não tem rede (parado e derrubado, ou que nunca
  subiu), recarrega o proxy no fim, de qualquer jeito, e sai com código diferente de 0, com a lista dos
  que ficaram de fora, se algum não foi ligado. Com o contêiner do proxy parado ele para antes de tudo
  (`docker start <contêiner>` e rode de novo).
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
do proxy à rede de cada cliente** e usa, como upstream, o alias que o `compose.yml` dá ao servidor
nessa rede (não o nome do contêiner, que o Compose escolhe e muda de versão para versão):

```
padaria-aurora.dougbot.app {
	reverse_proxy doug-064-agentes:3000
	...
}
```

O alias leva o código (`doug-064-agentes`) porque **o proxy fica ligado à rede de todos os clientes**: um alias igual nas redes de dois clientes cairia no cliente errado. Essa ligação também
quer dizer que quem controla o proxy alcança o servidor de qualquer cliente; o servidor de um cliente,
por sua vez, só vê o proxy (o `.2` da rede dele), nunca a rede de outro cliente.

O `novo` faz `docker network connect --ip 10.64.64.2 doug-064 <contêiner do proxy>` (o endereço `.2`
da rede do cliente: `TRUSTED_PROXIES` é a faixa `10.64.64.0/24`, veja "A porta de loopback") e
escreve o arquivo na pasta dos sites. A porta de loopback do servidor (`127.0.0.1:<porta>`) continua
publicada, só para o `/api/health` do `doug-cliente` e do `doug-atualizar-clientes` (que a leem do
`.env`, `DOUG_HOST_PORT`, e do `clientes.tsv`, e precisam que sejam a mesma): o proxy não passa por ela.

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
'{{.Names}}' | grep caddy`), o **caminho do host** da pasta montada acima e o caminho do Caddyfile
**dentro do contêiner**:

```
DOUG_PROXY_MODE=externo
DOUG_PROXY_CONTAINER=agentes-chat-caddy-1
DOUG_PROXY_SITES_DIR=/opt/doug-clientes/proxy
DOUG_PROXY_RELOAD="docker exec agentes-chat-caddy-1 caddy reload --config /etc/caddy/Caddyfile"
DOUG_PROXY_CADDYFILE=/etc/caddy/Caddyfile
```

(`agentes-chat-caddy-1` é um exemplo: use o nome que o `docker ps` mostrar. `DOUG_PROXY_CADDYFILE` já
vale `/etc/caddy/Caddyfile` se você não o puser.) O `novo` e o `remover` rodam o `DOUG_PROXY_RELOAD`
depois de escrever ou tirar um arquivo; se ele falhar, o arquivo volta ao que era e o `novo` para sem
registrar o cliente. Sem `DOUG_PROXY_RELOAD`, o script só avisa.

**O `novo` confere que o proxy enxerga o arquivo.** Depois do reload ele roda `docker exec
<contêiner> caddy adapt --config <DOUG_PROXY_CADDYFILE> --adapter caddyfile` e procura nele o endereço
`<slug>.dougbot.app`. Se o endereço não aparece (a pasta dos sites montada no lugar errado, o
Caddyfile sem o `import`, um arquivo que o usuário do proxy não lê), o arquivo é desfeito como no
reload que falha, e o cliente não é registrado. A pasta dos sites e os arquivos são do root, `700` e
`600` (a lista dos sites é a lista dos clientes; o proxy, no contêiner, roda como root e os lê). Se o
proxy roda com outro usuário, ponha em `DOUG_PROXY_SITES_GRUPO` o grupo dele (o nome ou o número): a
pasta passa a `750` e os arquivos a `640`, de `root:<grupo>`.

O `remover` desliga o contêiner do proxy da rede do cliente antes de derrubá-la (o Compose não derruba
uma rede com alguém ligado: se você derrubar um cliente à mão, desligue antes
`docker network disconnect doug-064 <contêiner>`). Se o `remover` ou o `iniciar` falhar com o proxy
fora de alguma rede, `doug-cliente religar-proxy` o põe de volta.

## A porta de loopback

O `compose.yml` publica a porta de cada servidor só em `127.0.0.1:<DOUG_HOST_PORT>`, e a mesma porta
está no `.env` e no `clientes.tsv`: o `doug-cliente` e o `doug-atualizar-clientes` leem o `/api/health`
por ela e conferem que são iguais, também no modo externo, em que o proxy fala com o servidor pela
rede do cliente e não a usa. **Não tire essa porta.**

Ela não é privada. `127.0.0.1` é de todos os logins da máquina, e o Docker entrega ao servidor o que
chega nela pelo gateway da rede do cliente (`.1`), que está dentro de `TRUSTED_PROXIES`
(`10.64.<código>.0/24`, a rede inteira: o servidor só aceita o `X-Forwarded-For` de quem vem dessa
faixa, e o proxy é o `.2`). Na prática, **qualquer login local conversa com o servidor de qualquer
cliente por essa porta e escolhe o `X-Forwarded-For`**, ou seja, o IP que o servidor registra e usa nos
limites de uso e na auditoria. Isso não dá acesso a dados (a autenticação é a mesma), mas falsifica o
IP. Se a máquina tem logins que não são da equipe, estreite o `TRUSTED_PROXIES` do `.env` do cliente
para o endereço do proxy (`10.64.64.2/32` no modo externo; `10.64.64.1/32` no próprio, em que o Caddy
chega pelo gateway) e aplique com `doug-cliente iniciar 064`; o `doug-cliente compose` não desfaz uma
linha que já existe no `.env`.

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
o erro, sem registrar o cliente. O `caddy/clientes/` é do root, `700`, como a pasta dos sites do
modo externo.

## Configuração da máquina

O `sudo` limpa o ambiente, e um comando lido do ambiente de quem chama (como `DOUG_PROXY_RELOAD`)
rodaria como root: por isso o que é fixo da máquina vai em `/opt/doug-clientes/doug-cliente.conf`, um
arquivo de root (do usuário que roda o script, e sem escrita para grupo nem outros; senão o script
recusa), com precedência sobre o ambiente. **O arquivo não é executado** (não há `source`): cada linha
é `NOME=valor` (o valor pode vir entre aspas, que são tiradas; `$(...)` e `$VAR` ficam como texto),
só vale a chave da lista abaixo, e uma linha de outro formato faz o script parar. Uma chave que não
é da lista é ignorada, com um aviso. `DOUG_CLIENTES_DIR` não vale aí (o arquivo fica dentro dessa
pasta): ele só vale no ambiente. As chaves: `DOUG_CADDY_DIR`, `DOUG_DOMINIO`, `DOUG_PROXY_MODE`,
`DOUG_PROXY_CONTAINER`, `DOUG_PROXY_SITES_DIR`, `DOUG_PROXY_SITES_GRUPO`, `DOUG_PROXY_RELOAD`,
`DOUG_PROXY_CADDYFILE`, `DOUG_IMAGE_REPO`, `DOUG_CLIENT_QUOTA_GB`, `DOUG_PORTA_INICIAL`,
`DOUG_PORTA_FINAL`, `DOUG_HEALTH_TIMEOUT`, `DOUG_TRAVA_ESPERA`, `DOUG_UID_BASE` (o uid de um cliente é
essa base mais o código; padrão `1000000000`; só vale para clientes novos) e `DOUG_ETC_DIR` (onde ficam
`passwd`, `group`, `subuid` e `subgid`; padrão `/etc`).

```sh
DOUG_PROXY_MODE=externo
DOUG_PROXY_CONTAINER=agentes-chat-caddy-1
DOUG_PROXY_SITES_DIR=/opt/doug-clientes/proxy
DOUG_PROXY_RELOAD="docker exec agentes-chat-caddy-1 caddy reload --config /etc/caddy/Caddyfile"
DOUG_DOMINIO=dougbot.app
DOUG_CLIENT_QUOTA_GB=40
DOUG_UID_BASE=1000000000
```

As variáveis que o script lê estão no começo dele (`doug-cliente ajuda`).

## Backups e dados de quem saiu (LGPD)

Os backups do `doug-cliente` (`manual-<slug>-<data>` do `backup`, `remocao-<slug>-<data>` do
`remover`) ficam em `/opt/doug-clientes/backups/<codigo>/` (700, do root), fora de `dados/`. Os nomes
levam o **slug** porque os backups são do código, e o código de um cliente removido pode ser dado a
outro: o `novo` **recusa** um código cuja pasta de backups tenha os de outro slug, a menos que se passe
`--reusar-codigo`, e o `limpar-backups` só apaga pelo código quando há um cliente só nele (com mais de
um, é preciso dizer qual: `--slug`). Os `pre-*` e `falhou-*` da mesma pasta são do
`doug-atualizar-clientes`, que os nomeia e os poda: o `doug-cliente` não mexe neles. Têm dados pessoais do
cliente, e por isso precisam de um **prazo de guarda**: defina um (a sugestão do MVP é 30 dias depois
da saída do cliente para `remocao-*`, e 90 dias para os `manual-*`; confirme com o contrato e com o
jurídico), cumpra-o e apague depois dele.

- O `remover` sem `--apagar-dados` guarda a pasta inteira em `removidos/` (700), com o banco, os
  arquivos e o `.env` (`removidos/<codigo>-<slug>-<data>`): ao fim do prazo, apague com
  `doug-cliente limpar-removidos --antes <data> [<codigo>]`, que lista o que sai e pede a confirmação
  (`LIMPAR REMOVIDOS`; `--sim` pula a pergunta, `--dry-run` só lista).
- O `remover --apagar-dados` apaga a pasta, **mas guarda em `backups/<codigo>/`**: o dump do banco
  (pessoas, mensagens, as chaves guardadas, cifradas), o tar de `dados/files` (os arquivos que o
  cliente enviou) e o `.env` (o `AGENTES_SECRET`, que abre as chaves do dump). Os três contam como
  dados do cliente até serem apagados.
- Para apagar o que passou do prazo (também de um cliente já removido, e a pedido dele):

  ```sh
  sudo /opt/doug-swas/deploy/swas/doug-cliente limpar-backups 064 --antes 2026-12-17 --slug padaria-aurora
  ```

  Lista o que é de antes da data e pede a confirmação (`LIMPAR 064`; `--sim` pula a pergunta, e
  `--dry-run` só lista). Só mexe nos `manual-*` e `remocao-*` (com o `.env` e o tar que vão ao lado);
  os `pre-*` e `falhou-*` são do `doug-atualizar-clientes`, que os poda. Com `--slug`, só os desse
  cliente.

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

Usam `docker`, `curl`, `openssl`, `chown`, `du`, `tar`, `id` e `ip` falsos num diretório temporário
(o `docker` falso guarda as redes em arquivos e responde o `network inspect` por rede; um `/etc` de
mentira dá o `passwd`, `group`, `subuid` e `subgid`): não precisam de Docker, de rede nem de root. Cobrem os arquivos gerados, o `clientes.tsv`, as recusas (código e slug
repetidos, slugs com `}`, `/`, `;` e quebra de linha, argumentos e imagens inválidos), o `--dry-run`, a
retomada, a corrida e a retomada de porta (três `novo` ao mesmo tempo), a trava `.lock` (e o disco
medido antes dela) e o erro sem `flock`, o descritor da trava que não passa aos filhos, as permissões
(`.lock`, `clientes.tsv`, `backups/`, `removidos/`, a pasta do cliente), o uid e a rede por cliente
(`chown`, o ramo root dele, as faixas de `subuid`/`subgid` e `TRUSTED_PROXIES`), a colisão de
sub-rede (redes do Docker e `ip route`), os dois modos de proxy (a ligação à rede, o upstream pelo alias,
o `caddy adapt`, o `remover`, o `religar-proxy` com redes que faltam e proxy parado), a conf de root, o
subcomando `compose`, `iniciar` (o `up` que muda a sub-rede), `remover` (com e sem `--apagar-dados`, a
janela de escrita e o servidor religado se algo falha), os backups por slug, `limpar-backups`,
`limpar-removidos`, `cota` e o contrato com o `doug-atualizar-clientes`. Onde o `docker compose` de
verdade existe, rodam também `docker compose config` no compose e no `.env` gerados; sem ele, essa
parte é pulada.
