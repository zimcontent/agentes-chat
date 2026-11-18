# DougBot como serviço: um cliente por stack

Cada empresa cliente roda numa stack Docker só dela: o servidor do DougBot, um Postgres só dela e uma
rede só dela, com os dados numa pasta só (`dados/`). Um Caddy no host dá a cada cliente o seu
endereço, `<slug>.dougbot.app`, com TLS automático. Tudo se faz com um comando, o `doug-cliente`.

```
/opt/doug-clientes/
├── clientes.tsv                  o registro: codigo slug nome porta imagem criado_em (separados por tabulação)
├── 064-padaria-aurora/
│   ├── compose.yml               cópia de deploy/swas/compose.cliente.yml
│   ├── .env                      gerado de cliente.env.example, com segredos aleatórios (chmod 600)
│   ├── link-do-dono.txt          o link do primeiro acesso (chmod 600)
│   └── dados/
│       ├── postgres/             o banco
│       └── files/                os arquivos que o cliente envia
├── backups/                      dumps feitos por `backup` e por `remover`
└── removidos/                    pastas de clientes removidos sem --apagar-dados
```

O código do cliente (`064`) tem 3 dígitos e prende as customizações dele; o slug (`padaria-aurora`)
vira o subdomínio. O servidor do cliente recebe `DOUG_CLIENT_CODE=064`.

## Pré-requisitos

1. **DNS curinga.** Um registro `*.dougbot.app` (tipo A, e AAAA se a máquina tiver IPv6) apontando
   para o IP público da máquina. Com ele, cada cliente novo já nasce com o endereço resolvendo, sem
   mexer no DNS de novo. Confira: `dig +short qualquer-coisa.dougbot.app`.
2. **Portas 80 e 443** abertas no firewall da máquina e do provedor (o Caddy pede e renova os
   certificados do Let's Encrypt por elas). O Let's Encrypt limita a quantidade de certificados por
   domínio por semana: ao subir muitos clientes de uma vez, espalhe-os em dias.
3. **Docker Engine com o plugin Compose v2** (`docker compose version`). A porta de cada servidor só
   abre no loopback (`127.0.0.1`); quem fala com a internet é o Caddy.
4. **O repositório nesta máquina**, num lugar que só o root escreve (os exemplos usam
   `/opt/doug-swas`): o `doug-cliente` roda como root e copia os modelos desta pasta, então quem
   altera estes arquivos altera o que roda como root.
5. **A imagem do servidor** (`agentes-zim:doug-<sha>`, a mesma da instância principal) já
   construída nesta máquina. Sem `--imagem`, o `novo` usa a `agentes-zim:doug-*` mais nova que achar.
6. **Disco.** A cota é de 40 GB por cliente (`DOUG_CLIENT_QUOTA_GB`). O `novo` se recusa a criar um
   cliente quando não há essa folga no disco. Arquivos grandes devem ir para o armazenamento externo
   configurado, não para `dados/files`.
7. **A regra de sudo**, exata, sem senha e só para este script. Em `/etc/sudoers.d/doug-cliente`
   (crie com `sudo visudo -f /etc/sudoers.d/doug-cliente`):

   ```
   equipe ALL=(root) NOPASSWD: /opt/doug-swas/deploy/swas/doug-cliente
   ```

   `equipe` é o usuário (ou `%grupo`) que opera os clientes. O caminho é completo e sem curinga: a
   regra libera este arquivo e mais nada, e quem a usa passa os subcomandos (`novo`, `lista`…), que o
   script valida. Pontos de atenção:

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

   1. valida o código (3 dígitos), o slug e o nome, e confere em `clientes.tsv` que o código e o slug
      estão livres;
   2. escolhe uma porta de loopback livre (a partir da 3100);
   3. cria `/opt/doug-clientes/064-padaria-aurora/` com o `compose.yml`, o `.env` (segredos de
      `openssl rand`) e `dados/`;
   4. sobe a stack: `docker compose -p doug-064 up -d`;
   5. espera o `/api/health` responder (até 240 s);
   6. escreve `caddy/clientes/padaria-aurora.caddy`, sobe o Caddy se ele ainda não roda e o recarrega;
   7. registra o cliente em `clientes.tsv`.

3. **Entregue o link do primeiro acesso.** No fim, o comando mostra
   `https://padaria-aurora.dougbot.app/owner#claim=…` (também fica em `link-do-dono.txt`). O cadastro
   do cliente nasce fechado: só quem tem esse link cria a primeira conta, a dona ou o dono do
   espaço. Depois da primeira conta, o link não serve mais.

4. **Configure o cliente:** a conta de IA e os conectores ficam no próprio app, em Configurações.
   Opcionais do servidor (e-mail, backup para o Drive do cliente) entram no `.env` do cliente: veja os
   comentários em `cliente.env.example`. Depois de mudar o `.env`:

   ```sh
   cd /opt/doug-clientes/064-padaria-aurora && sudo docker compose up -d
   ```

Se o comando cair no meio (a imagem demorou, o Caddy recusou, a máquina reiniciou), **rode o mesmo
comando de novo**: ele continua de onde parou, mantém o `.env` e os segredos que já existem e só
registra o cliente no fim, quando tudo funciona.

## Operação

```sh
doug-cliente lista                              # clientes, porta, estado e imagem
doug-cliente parar 064                          # para a stack (os dados ficam)
doug-cliente iniciar 064                        # sobe de novo e espera o /api/health
doug-cliente backup 064                         # dump do banco em /opt/doug-clientes/backups/
doug-cliente remover 064                        # pede confirmação, faz backup, tira do ar e do Caddy
doug-cliente remover 064 --apagar-dados         # idem, e apaga a pasta com os dados
doug-cliente cota                               # uso de disco de cada cliente contra a cota
```

(Todos como `sudo /opt/doug-swas/deploy/swas/doug-cliente …`.) O `--dry-run` vale em qualquer comando
que muda algo.

- **`remover`** pede para você digitar o slug (com `--apagar-dados`, `APAGAR <slug>`; `--sim` pula a
  pergunta, para scripts). O backup do banco vem antes de qualquer coisa: se ele falhar, nada é
  removido. Sem `--apagar-dados`, a pasta inteira (com `dados/` e `.env`) vai para
  `/opt/doug-clientes/removidos/` e o código e o slug ficam livres. Com `--apagar-dados`, o `.env`
  (que tem o `AGENTES_SECRET`, sem o qual as chaves guardadas no backup não abrem) fica copiado ao
  lado do dump. O backup cobre o banco; os arquivos de `dados/files` não entram nele.
- **`cota`** mostra o uso de `dados/` de cada cliente contra `DOUG_CLIENT_QUOTA_GB` (40 por padrão) e
  sai com código 3 se algum passou, para um alerta ler. Rode como root: o Postgres dos clientes não é
  legível por outros usuários.
- Limites de memória e de CPU de cada cliente vêm de variáveis com padrão no compose
  (`DOUG_MEMORY`, `DOUG_CPUS`, `DOUG_PG_MEMORY`, `DOUG_PG_CPUS`): ponha a linha no `.env` do cliente.
- Atualizar a imagem de todos os clientes é com o `doug-atualizar-clientes`, ao lado deste script.

## O Caddy

`caddy/compose.yml` roda um Caddy só, na rede do host. O `caddy/Caddyfile` importa
`caddy/clientes/*.caddy`: um arquivo por cliente, escrito e removido pelo `doug-cliente`, que não vão
para o git. Para subir ou recarregar à mão:

```sh
docker compose -f /opt/doug-swas/deploy/swas/caddy/compose.yml up -d
docker compose -f /opt/doug-swas/deploy/swas/caddy/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile
```

Se o Caddy recusar o arquivo de um cliente, o `doug-cliente` devolve o arquivo ao que era e para com
o erro, sem registrar o cliente.

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
argumentos inválidos), o `--dry-run`, a retomada, `remover` e `cota`.
