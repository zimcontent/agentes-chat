# DougBot como serviço: um cliente por stack

Cada empresa cliente roda numa stack Docker só dela: o servidor do DougBot, um Postgres só dela e uma
rede só dela, com os dados numa pasta só (`dados/`). Um proxy no host (Caddy) dá a cada cliente o seu
endereço, `<slug>.dougbot.app`, com TLS automático. Tudo se faz com um comando, o `doug-cliente`.

```
/opt/doug-clientes/                 root, 711
├── .lock                         a trava única (flock), a mesma do doug-atualizar-clientes
├── doug-cliente.conf             (opcional) configuração fixa da máquina, de root (veja "Configuração da máquina")
├── clientes.tsv                  o registro: codigo slug nome porta imagem criado_em (tabulação, sem cabeçalho)
├── 064-padaria-aurora/           root, 711
│   ├── compose.yml               cópia de deploy/swas/compose.cliente.yml (root, 644)
│   ├── .env                      gerado de cliente.env.example, com segredos aleatórios (root, 600)
│   ├── link-do-dono.txt          o link do primeiro acesso (root, 600)
│   └── dados/                    711
│       ├── postgres/             o banco (o diretório de dados dele é 700 do usuário postgres)
│       └── files/                os arquivos que o cliente envia (700, do usuário da imagem, uid 1000)
├── backups/                      root, 700
│   └── 064/                      root, 700: dumps de `backup` e de `remover`, fora de dados/
└── removidos/                    pastas de clientes removidos sem --apagar-dados
```

As permissões são parte do contrato, e o `novo` as refaz também ao retomar: só o root lê a pasta de um
cliente por dentro, e o usuário de login 1000 (dono de `dados/files` por causa da imagem) não abre a
pasta de outro cliente. A pasta, o `compose.yml` e o `.env` são do root e não têm escrita para grupo
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
5. **Mais de 30 clientes: aumente o pool de sub-redes do Docker.** Cada cliente tem uma rede só
   dele, e o pool padrão do Docker (172.17.0.0/16 até 172.31.0.0/16, mais 192.168.0.0/16 em
   fatias /20) dá 31 sub-redes: o cliente 32 não sobe (`all predefined address pools have been
   fully subnetted`). Antes de passar de uns 25, ponha em `/etc/docker/daemon.json`:

   ```json
   { "default-address-pools": [{ "base": "10.64.0.0/10", "size": 24 }] }
   ```

   (16 mil redes /24; escolha uma faixa que não choque com a rede privada do provedor nem com uma VPN.)
   Reinicie o Docker (`sudo systemctl restart docker`: os contêineres sobem de novo, e as redes que já
   existem mantêm a faixa antiga; só as novas usam o pool). O servidor de cada cliente só confia nas
   conexões do proxy que vêm das faixas de `TRUSTED_PROXIES` do `.env`: o modelo já inclui
   `10.64.0.0/10` além do `172.16.0.0/12` padrão; se escolher outra faixa, ponha-a em
   `cliente.env.example` e rode `doug-cliente compose <codigo>` em cada cliente (ele só acrescenta o
   que falta: para uma linha que já existe, edite o `.env` do cliente à mão). O `novo` avisa (não
   recusa) quando o daemon não tem um pool configurado.
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
  pergunta, para scripts). O backup do banco vem antes de qualquer coisa: se ele falhar, nada é
  removido. Sem `--apagar-dados`, a pasta inteira (com `dados/` e `.env`) vai para
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
cliente, `deploy/swas/caddy/clientes/<slug>.caddy` (não vai para o git), com o bloco do site e o
`reverse_proxy 127.0.0.1:<porta>`; o que muda entre os dois modos é quem lê esses arquivos.
`DOUG_PROXY_MODE` escolhe (na `doug-cliente.conf`; padrão `externo`):

**(b) `externo`, o do MVP: sem Caddy próprio.** Na máquina do MVP as portas 80 e 443 já são do proxy
da instância principal. O instalador só gera os arquivos, e esse proxy os importa: ponha no
Caddyfile dele a linha

```
import /opt/doug-swas/deploy/swas/caddy/clientes/*.caddy
```

(o proxy tem de alcançar `127.0.0.1:<porta>` da máquina: um Caddy no host, ou em contêiner com
`network_mode: host`) e diga como recarregá-lo em `DOUG_PROXY_RELOAD`, por exemplo:

```
DOUG_PROXY_MODE=externo
DOUG_PROXY_RELOAD="systemctl reload caddy"
```

O `novo` e o `remover` rodam esse comando depois de escrever ou tirar um arquivo. Se ele falhar, o
arquivo volta ao que era e o `novo` para sem registrar o cliente (rode o mesmo comando de novo depois
de arrumar o proxy). Sem `DOUG_PROXY_RELOAD`, o script só avisa, e você recarrega o proxy à mão.

**(a) `proprio`: Caddy próprio, para uma máquina dedicada.** `caddy/compose.yml` roda um Caddy só,
na rede do host (abre 80 e 443: use só onde elas estão livres), com o `caddy/Caddyfile` importando
`caddy/clientes/*.caddy`. O `doug-cliente` o sobe sozinho no primeiro cliente e o recarrega a cada
mudança. A API de administração do Caddy **não é uma porta**: é um socket Unix
(`/run/caddy-admin/admin.sock`) num volume do Docker (`caddy-admin`), que só o root do host alcança, e
o reload vai por `caddy reload --address unix//run/caddy-admin/admin.sock`. Para subir ou recarregar
à mão:

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
recusa), com linhas `NOME=valor`, lido pelo script e com precedência sobre o ambiente:

```sh
DOUG_PROXY_MODE=externo
DOUG_PROXY_RELOAD="systemctl reload caddy"
DOUG_DOMINIO=dougbot.app
DOUG_CLIENT_QUOTA_GB=40
```

As variáveis que o script lê estão no começo dele (`doug-cliente ajuda`).

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

Usam `docker`, `curl` e `openssl` falsos num diretório temporário: não precisam de Docker, de rede
nem de root. Cobrem os arquivos gerados, o `clientes.tsv`, as recusas (código e slug repetidos,
slugs com `}`, `/`, `;` e quebra de linha, argumentos inválidos), o `--dry-run`, a retomada, a
corrida e a retomada de porta (três `novo` ao mesmo tempo), a trava `.lock` e o erro sem `flock`, as
permissões, o aviso do pool de sub-redes, os dois modos de proxy, o subcomando `compose`, `remover`
(com e sem `--apagar-dados`) e `cota`. Onde o `docker compose` de verdade existe, rodam também
`docker compose config` no compose e no `.env` gerados; sem ele, essa parte é pulada.
