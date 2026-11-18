#!/usr/bin/env bash
# Testes do doug-cliente com docker, curl e openssl falsos: nada de Docker de verdade, nada de
# rede, nada fora de um diretório temporário. Rode: bash deploy/swas/test/doug-cliente.test.sh
set -uo pipefail

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SWAS=$(dirname "$AQUI")
REPO=$(cd "$SWAS/../.." && pwd)
SCRIPT=$SWAS/doug-cliente

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

FALHAS=0
TESTES=0

ok() {
  TESTES=$((TESTES + 1))
  printf '  ok   %s\n' "$1"
}
falha() {
  TESTES=$((TESTES + 1))
  FALHAS=$((FALHAS + 1))
  printf '  FALHA %s\n' "$1"
  [[ -z ${2:-} ]] || printf '        %s\n' "$2"
}
confere() { # <descrição> <comando de teste...>
  local desc=$1
  shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else falha "$desc"; fi
}
contem() { grep -qF -- "$2" <<<"$1"; }
arquivo_contem() { grep -qF -- "$2" "$1"; }
arquivo_tem_linha() { grep -qE -- "$2" "$1"; }

# ─── comandos falsos ─────────────────────────────────────────────────────────

BIN=$TMP/bin
mkdir -p "$BIN"

cat >"$BIN/docker" <<'EOF'
#!/usr/bin/env bash
# docker falso: anota a chamada e responde o que o doug-cliente pergunta. As redes são arquivos em
# $FAKE_REDES (um por rede, com um contêiner ligado por linha): o `up` cria a rede, o `down` a tira
# (e recusa uma rede com alguém ligado, como o Compose), connect e disconnect mexem na lista, e o
# inspect responde por rede.
printf '%s\n' "$*" >>"$FAKE_LOG"
# O descritor 9 é o da trava: um filho que o herda a segura depois de o script acabar.
[[ ! -e /proc/$$/fd/9 ]] || printf '%s\n' "$*" >>"$FAKE_LOG.fd9"
projeto=$(sed -nE 's/.*-p (doug-[0-9]+) .*/\1/p' <<<"$*")
case "$*" in
  "compose version"*) echo "Docker Compose version v2.30.0" ;;
  "network ls"*) printf '%s\n' "${FAKE_NET_LS:-}" ;;
  "network inspect"*IPAM*) printf '%s\n' "${FAKE_NET_SUBNETS:-}" ;;
  "network inspect"*)
    rede=${*: -1}
    [[ -f $FAKE_REDES/$rede ]] || { echo "Error: No such network: $rede" >&2; exit 1; }
    tr '\n' ' ' <"$FAKE_REDES/$rede"
    echo
    ;;
  "network connect"*)
    # network connect --ip <ip> <rede> <contêiner>
    [[ -z ${FAKE_NET_FAIL:-} && -z ${FAKE_CONNECT_FAIL:-} && ${FAKE_CONNECT_FAIL_REDE:-} != "$5" ]] || exit 1
    [[ -f $FAKE_REDES/$5 ]] || exit 1
    ! grep -qx "$6" "$FAKE_REDES/$5" || { echo "endpoint already exists" >&2; exit 1; }
    echo "$6" >>"$FAKE_REDES/$5"
    ;;
  "network disconnect"*)
    # network disconnect <rede> <contêiner>
    [[ -z ${FAKE_NET_FAIL:-} && -z ${FAKE_DISCONNECT_FAIL:-} ]] || exit 1
    [[ -f $FAKE_REDES/$3 ]] || exit 1
    grep -vx "$4" "$FAKE_REDES/$3" >"$FAKE_REDES/$3.t" || true
    mv "$FAKE_REDES/$3.t" "$FAKE_REDES/$3"
    ;;
  "images "*) echo "agentes-zim:doug-abc1234" ;;
  "image inspect "*) [[ -z ${FAKE_NO_IMAGE:-} ]] || exit 1 ;;
  "inspect "*) if [[ -n ${FAKE_PROXY_PARADO:-} ]]; then echo false; else echo true; fi ;;
  *" up -d"*)
    [[ -z ${FAKE_UP_FALHA:-} ]] || exit 1
    [[ "$*" != *"up -d agentes"* || -z ${FAKE_UP_AGENTES_FALHA:-} ]] || exit 1
    # Uma sub-rede que mudou: o Compose não recria uma rede com o proxy ligado.
    if [[ -n ${FAKE_UP_FALHA_COM_PROXY:-} && -n $projeto && -f $FAKE_REDES/$projeto ]] && grep -q . "$FAKE_REDES/$projeto"; then
      exit 1
    fi
    [[ -z $projeto || -f $FAKE_REDES/$projeto ]] || : >"$FAKE_REDES/$projeto"
    ;;
  *" down"*)
    [[ -z ${FAKE_DOWN_FAIL:-} ]] || exit 1
    if [[ -n $projeto && -f $FAKE_REDES/$projeto ]]; then
      if grep -q . "$FAKE_REDES/$projeto"; then
        echo "network has active endpoints" >&2
        exit 1
      fi
      rm -f "$FAKE_REDES/$projeto"
    fi
    ;;
  *" ps "*) for ((i = 0; i < ${FAKE_RUNNING:-2}; i++)); do echo "contêiner$i"; done ;;
  *"pg_isready"*) ;;
  *"pg_dump"*) [[ -z ${FAKE_DUMP_FAIL:-} ]] || exit 1; printf 'PGDMP falso\n' ;;
  *"caddy reload"*) [[ -z ${FAKE_CADDY_FAIL:-} ]] || exit 1 ;;
  *"caddy adapt"*)
    # O que o proxy enxerga: os <slug>.caddy da pasta que ele monta (FAKE_ADAPT_CEGO: nada).
    [[ -z ${FAKE_ADAPT_FALHA:-} ]] || exit 1
    printf '{"apps":{"http":{"servers":{"srv0":{"routes":['
    if [[ -z ${FAKE_ADAPT_CEGO:-} ]]; then
      for f in "${FAKE_SITES_DIR:-${DOUG_PROXY_SITES_DIR:-/nada}}"/*.caddy; do
        [[ -f $f ]] || continue
        h=$(sed -nE 's/^([a-z0-9.-]+) \{$/\1/p' "$f" | head -1)
        printf '{"match":[{"host":["%s"]}]},' "$h"
      done
    fi
    printf '{}]}}}}}\n'
    ;;
esac
exit 0
EOF
cat >"$BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >>"$FAKE_LOG"
[[ -z ${FAKE_CURL_SLEEP:-} ]] || sleep "$FAKE_CURL_SLEEP"
[[ -z ${FAKE_HEALTH_FAIL:-} ]]
EOF
cat >"$BIN/openssl" <<'EOF'
#!/usr/bin/env bash
# openssl falso: cada segredo sai diferente e previsível, com / e + para testar o preenchimento.
printf 'openssl %s\n' "$*" >>"$FAKE_LOG"
[[ -z ${FAKE_OPENSSL_FAIL:-} ]] || exit 1
n=$(cat "$FAKE_CONTADOR" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" >"$FAKE_CONTADOR"
[[ $1 == rand ]] || exit 1
case $2 in
  -base64) echo "segredoB64/mais+$n" ;;
  -hex) echo "segredohex$n" ;;
  *) exit 1 ;;
esac
EOF
# chown falso: anota o que o instalador pediria (de verdade só o root troca de dono).
cat >"$BIN/chown" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_CHOWN_LOG"
[[ -z ${FAKE_CHOWN_FAIL:-} ]]
EOF
# tar que falha quando se pede (o resto é o tar de verdade).
REAL_TAR=$(command -v tar)
cat >"$BIN/tar" <<EOF
#!/usr/bin/env bash
[[ -z \${FAKE_TAR_FAIL:-} ]] || exit 1
exec "$REAL_TAR" "\$@"
EOF
# id que diz "sou root" quando se pede: o ramo root do chown roda sem ser root.
REAL_ID=$(command -v id)
cat >"$BIN/id" <<EOF
#!/usr/bin/env bash
if [[ -n \${FAKE_ID_ROOT:-} && \$1 == -u ]]; then echo 0; exit 0; fi
exec "$REAL_ID" "\$@"
EOF
# ip route falso: as rotas desta máquina de mentira.
cat >"$BIN/ip" <<'EOF'
#!/usr/bin/env bash
printf '%b\n' "${FAKE_IP_ROUTE:-default via 192.0.2.1 dev eth0\n192.0.2.0/24 dev eth0 proto kernel scope link}"
EOF
# du que anota onde mediu e mede de verdade: mostra que o disco é medido antes da trava.
REAL_DU=$(command -v du)
cat >"$BIN/du" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"\$FAKE_DU_LOG"
exec "$REAL_DU" "\$@"
EOF
chmod +x "$BIN"/*

# O docker de verdade (se esta conta o alcança), para o `docker compose config`: o PATH abaixo põe o
# falso na frente.
REAL_DOCKER=$(command -v docker || true)

# Um ambiente novo por grupo de testes: raiz dos clientes, Caddy e registros próprios.
novo_ambiente() {
  A=$TMP/amb-$1
  rm -rf "$A"
  mkdir -p "$A/caddy/clientes"
  export DOUG_CLIENTES_DIR=$A/clientes
  export DOUG_CADDY_DIR=$A/caddy
  export FAKE_LOG=$A/docker.log
  export FAKE_CONTADOR=$A/contador
  export FAKE_CHOWN_LOG=$A/chown.log
  export FAKE_DU_LOG=$A/du.log
  : >"$FAKE_LOG"
  : >"$FAKE_CHOWN_LOG"
  : >"$FAKE_DU_LOG"
  # As redes do Docker de mentira e os arquivos de /etc de mentira (passwd, group, subuid, subgid).
  export FAKE_REDES=$A/redes
  export DOUG_ETC_DIR=$A/etc
  mkdir -p "$FAKE_REDES" "$DOUG_ETC_DIR"
  : >"$DOUG_ETC_DIR/passwd"
  : >"$DOUG_ETC_DIR/group"
  : >"$DOUG_ETC_DIR/subuid"
  : >"$DOUG_ETC_DIR/subgid"
  unset FAKE_NO_IMAGE FAKE_HEALTH_FAIL FAKE_CADDY_FAIL FAKE_DUMP_FAIL FAKE_RUNNING FAKE_CURL_SLEEP FAKE_OPENSSL_FAIL DOUG_PROXY_RELOAD FAKE_NET_FAIL DOUG_PROXY_CONTAINER DOUG_PROXY_SITES_DIR
  unset FAKE_CONNECT_FAIL FAKE_CONNECT_FAIL_REDE FAKE_DISCONNECT_FAIL FAKE_NET_LS FAKE_NET_SUBNETS FAKE_IP_ROUTE FAKE_UP_FALHA FAKE_UP_AGENTES_FALHA FAKE_UP_FALHA_COM_PROXY FAKE_DOWN_FAIL
  unset FAKE_TAR_FAIL FAKE_ID_ROOT FAKE_CHOWN_FAIL FAKE_PROXY_PARADO FAKE_ADAPT_CEGO FAKE_ADAPT_FALHA FAKE_SITES_DIR DOUG_UID_BASE DOUG_PROXY_CADDYFILE DOUG_PROXY_SITES_GRUPO
  # Os testes de Caddy abaixo são do modo próprio; o modo externo tem o seu grupo.
  export DOUG_PROXY_MODE=proprio
  export DOUG_TRAVA_ESPERA=3
  export DOUG_CLIENT_QUOTA_GB=1
  export DOUG_PORTA_INICIAL=47100
  export DOUG_PORTA_FINAL=47199
  export DOUG_HEALTH_TIMEOUT=2
  export DOUG_HEALTH_INTERVALO=0
  REGISTRO=$DOUG_CLIENTES_DIR/clientes.tsv
}

PATH=$BIN:$PATH

# As redes de mentira: cria a rede do cliente, liga ou tira um contêiner dela, lista quem está nela.
cria_rede() { : >"$FAKE_REDES/doug-$1"; }
liga_na_rede() { echo "$2" >>"$FAKE_REDES/doug-$1"; }
esta_na_rede() { grep -qx "$2" "$FAKE_REDES/doug-$1" 2>/dev/null; }
modo_externo() { # depois de novo_ambiente
  export DOUG_PROXY_MODE=externo DOUG_PROXY_CONTAINER=proxy-teste DOUG_PROXY_SITES_DIR=$A/sites
  export DOUG_PROXY_RELOAD="docker exec proxy-teste caddy reload --config /etc/caddy/Caddyfile"
}
esvazia_redes() { local f; for f in "$FAKE_REDES"/*; do [[ -f $f ]] && : >"$f"; done; return 0; }

rodar() { # guarda a saída em SAIDA e o código em CODIGO_SAIDA
  SAIDA=$("$SCRIPT" "$@" 2>&1)
  CODIGO_SAIDA=$?
}

echo "Arquivos e sintaxe"
confere "bash -n do doug-cliente" bash -n "$SCRIPT"
confere "bash -n deste teste" bash -n "${BASH_SOURCE[0]}"
if command -v shellcheck >/dev/null 2>&1; then
  confere "shellcheck do doug-cliente" shellcheck -S warning "$SCRIPT"
  confere "shellcheck deste teste" shellcheck -S warning -e SC2317 "${BASH_SOURCE[0]}"
else
  printf '  (shellcheck não está instalado: pulado)\n'
fi
confere "doug-cliente é executável" test -x "$SCRIPT"

echo "Modelos"
# Toda variável do cliente.env.example, menos as do DougBot e as do compose, existe no schema.
SCHEMA=$REPO/packages/config/src/schema.ts
MODELO=$SWAS/cliente.env.example
desconhecidas=""
while read -r nome; do
  case $nome in DOUG_* | POSTGRES_PASSWORD) continue ;; esac
  grep -qE "^  $nome: \{" "$SCHEMA" || desconhecidas="$desconhecidas $nome"
done < <(sed -nE 's/^#? ?([A-Z][A-Z0-9_]+)=.*/\1/p' "$MODELO" | sort -u)
if [[ -z $desconhecidas ]]; then ok "cliente.env.example só tem variáveis do schema (e as do DougBot/compose)"; else falha "variáveis fora do schema:" "$desconhecidas"; fi
arquivo_tem_linha "$MODELO" '^DOUG_CLIENT_CODE=' && ok "o modelo tem DOUG_CLIENT_CODE" || falha "o modelo tem DOUG_CLIENT_CODE"
arquivo_tem_linha "$MODELO" '^DOUG_IMAGE=' && ok "o modelo tem DOUG_IMAGE" || falha "o modelo tem DOUG_IMAGE"
arquivo_tem_linha "$SWAS/compose.cliente.yml" '^  agentes:' && arquivo_tem_linha "$SWAS/compose.cliente.yml" '^  postgres:' \
  && ok "o compose tem os serviços agentes e postgres" || falha "o compose tem os serviços agentes e postgres"
arquivo_contem "$SWAS/compose.cliente.yml" './dados/postgres:' && arquivo_contem "$SWAS/compose.cliente.yml" './dados/files:' \
  && ok "os volumes ficam em dados/" || falha "os volumes ficam em dados/"
arquivo_contem "$SWAS/compose.cliente.yml" '${DOUG_MEMORY:-' && ok "o limite de memória vem de variável com padrão" || falha "o limite de memória vem de variável com padrão"
if python3 -c 'import yaml' 2>/dev/null; then
  for y in "$SWAS/compose.cliente.yml" "$SWAS/caddy/compose.yml"; do
    confere "YAML válido: ${y#"$REPO"/}" python3 -c 'import sys, yaml; yaml.safe_load(open(sys.argv[1]))' "$y"
  done
fi
arquivo_contem "$SWAS/caddy/Caddyfile" 'import /etc/caddy/clientes/*.caddy' && ok "o Caddyfile importa clientes/*.caddy" || falha "o Caddyfile importa clientes/*.caddy"

echo "novo: simulação (--dry-run)"
novo_ambiente simulacao
rodar novo 064 padaria-aurora "Padaria Aurora" --dry-run
[[ $CODIGO_SAIDA == 0 ]] && ok "--dry-run termina bem" || falha "--dry-run termina bem" "$SAIDA"
contem "$SAIDA" "[simulação]" && ok "--dry-run diz o que faria" || falha "--dry-run diz o que faria"
contem "$SAIDA" "padaria-aurora.dougbot.app" && ok "--dry-run mostra o endereço" || falha "--dry-run mostra o endereço"
[[ ! -e $DOUG_CLIENTES_DIR ]] && ok "--dry-run não cria a raiz dos clientes" || falha "--dry-run não cria a raiz dos clientes"
[[ ! -e $DOUG_CADDY_DIR/clientes/padaria-aurora.caddy ]] && ok "--dry-run não escreve o arquivo do Caddy" || falha "--dry-run não escreve o arquivo do Caddy"
! grep -qE ' up | exec | stop ' "$FAKE_LOG" && ok "--dry-run não sobe nem muda nada no Docker" || falha "--dry-run não sobe nem muda nada no Docker"
! grep -q '^openssl' "$FAKE_LOG" && ok "--dry-run não gera segredos" || falha "--dry-run não gera segredos"

echo "novo: um cliente"
novo_ambiente novo
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "novo termina bem" || falha "novo termina bem" "$SAIDA"
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
confere "criou compose.yml igual ao modelo" cmp -s "$SWAS/compose.cliente.yml" "$P/compose.yml"
confere "criou dados/postgres" test -d "$P/dados/postgres"
confere "criou dados/files" test -d "$P/dados/files"
[[ -f $P/.env ]] && ok "criou o .env" || falha "criou o .env"
[[ $(stat -c %a "$P/.env") == 600 ]] && ok ".env fica com chmod 600" || falha ".env fica com chmod 600"
arquivo_contem "$P/.env" "DOUG_CLIENT_CODE=064" && ok ".env tem o código" || falha ".env tem o código"
arquivo_contem "$P/.env" "DOUG_IMAGE=agentes-zim:doug-abc1234" && ok ".env tem a imagem" || falha ".env tem a imagem"
arquivo_contem "$P/.env" "PUBLIC_URL=https://padaria-aurora.dougbot.app" && ok ".env tem o PUBLIC_URL do subdomínio" || falha ".env tem o PUBLIC_URL do subdomínio"
arquivo_tem_linha "$P/.env" '^AGENTES_SECRET=segredoB64/mais\+[0-9]+$' && ok "AGENTES_SECRET vem de openssl rand (com / e + intactos)" || falha "AGENTES_SECRET vem de openssl rand"
arquivo_tem_linha "$P/.env" '^POSTGRES_PASSWORD=segredohex[0-9]+$' && ok "POSTGRES_PASSWORD vem de openssl rand" || falha "POSTGRES_PASSWORD vem de openssl rand"
arquivo_tem_linha "$P/.env" '^DOUG_HOST_PORT=47100$' && ok "a porta é a primeira livre" || falha "a porta é a primeira livre"
! grep -q '__[A-Z_]*__' "$P/.env" && ok ".env não ficou com campo por preencher" || falha ".env não ficou com campo por preencher"
LINK=$P/link-do-dono.txt
token=$(sed -E 's/.*claim=//' "$LINK")
hash=$(printf '%s' "$token" | sha256sum | awk '{ print $1 }')
arquivo_contem "$P/.env" "OWNER_CLAIM_SHA256=$hash" && ok "o link do dono bate com o SHA-256 do .env" || falha "o link do dono bate com o SHA-256 do .env"
[[ $(stat -c %a "$LINK") == 600 ]] && ok "link-do-dono.txt fica com chmod 600" || falha "link-do-dono.txt fica com chmod 600"

# clientes.tsv
[[ $(wc -l <"$REGISTRO") == 1 ]] && ok "clientes.tsv tem uma linha" || falha "clientes.tsv tem uma linha"
IFS=$'\t' read -r c s n p i d <"$REGISTRO"
[[ $c == 064 && $s == padaria-aurora && $n == "Padaria Aurora" && $p == 47100 && $i == agentes-zim:doug-abc1234 ]] \
  && ok "clientes.tsv: codigo slug nome porta imagem" || falha "clientes.tsv: codigo slug nome porta imagem" "$(cat "$REGISTRO")"
[[ $d =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] && ok "clientes.tsv: criado_em em UTC" || falha "clientes.tsv: criado_em em UTC" "$d"
[[ $(awk -F'\t' '{ print NF }' "$REGISTRO") == 6 ]] && ok "clientes.tsv tem 6 colunas" || falha "clientes.tsv tem 6 colunas"

# Docker e Caddy
arquivo_contem "$FAKE_LOG" "-p doug-064" && ok "usa o projeto doug-064" || falha "usa o projeto doug-064"
arquivo_tem_linha "$FAKE_LOG" '^compose -p doug-064 .* up -d$' && ok "sobe com docker compose -p doug-064 up -d" || falha "sobe com docker compose -p doug-064 up -d"
arquivo_contem "$FAKE_LOG" "curl -fsS --max-time 5 http://127.0.0.1:47100/api/health" && ok "espera o /api/health da porta do cliente" || falha "espera o /api/health da porta do cliente"
CADDY=$DOUG_CADDY_DIR/clientes/padaria-aurora.caddy
arquivo_contem "$CADDY" "padaria-aurora.dougbot.app {" && arquivo_contem "$CADDY" "reverse_proxy 127.0.0.1:47100" \
  && ok "o arquivo do Caddy aponta o subdomínio para a porta" || falha "o arquivo do Caddy aponta o subdomínio para a porta"
arquivo_contem "$FAKE_LOG" "caddy reload" && ok "recarrega o Caddy" || falha "recarrega o Caddy"
contem "$SAIDA" "https://padaria-aurora.dougbot.app/owner#claim=" && ok "mostra o link do dono" || falha "mostra o link do dono"

echo "novo: recusas"
tsv_antes=$(cat "$REGISTRO")
log_antes=$(wc -l <"$FAKE_LOG")
rodar novo 064 outra-padaria "Outra Padaria"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "código 064 já é de outro cliente" && ok "recusa código repetido" || falha "recusa código repetido" "$SAIDA"
[[ $(cat "$REGISTRO") == "$tsv_antes" ]] && ok "o clientes.tsv não mudou depois da recusa" || falha "o clientes.tsv não mudou depois da recusa"
[[ ! -e $DOUG_CLIENTES_DIR/064-outra-padaria ]] && ok "a recusa não criou pasta" || falha "a recusa não criou pasta"
! tail -n +$((log_antes + 1)) "$FAKE_LOG" | grep -qE ' up | exec |^openssl' && ok "a recusa não subiu nada nem gerou segredo" || falha "a recusa não subiu nada nem gerou segredo"
rodar novo 065 padaria-aurora "Outro Nome"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "slug padaria-aurora já é de outro cliente" && ok "recusa slug repetido" || falha "recusa slug repetido" "$SAIDA"
rodar novo 64 cafe-sol "Café Sol"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "código inválido" && ok "recusa código que não tem 3 dígitos" || falha "recusa código que não tem 3 dígitos" "$SAIDA"
rodar novo 065 "Café Sol" "Café Sol"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "slug inválido" && ok "recusa slug com maiúscula e espaço" || falha "recusa slug com maiúscula e espaço" "$SAIDA"
rodar novo 065 www "Café Sol"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "reservado" && ok "recusa slug reservado" || falha "recusa slug reservado" "$SAIDA"
rodar novo 065 cafe-sol ""
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "nome" && ok "recusa nome vazio" || falha "recusa nome vazio" "$SAIDA"
rodar novo 065 cafe-sol "Café	Sol"
[[ $CODIGO_SAIDA != 0 ]] && ok "recusa nome com tabulação" || falha "recusa nome com tabulação" "$SAIDA"
rodar novo 065 cafe-sol
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "uso:" && ok "pede os três argumentos" || falha "pede os três argumentos" "$SAIDA"
FAKE_NO_IMAGE=1 rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-sumiu
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não existe nesta máquina" && ok "recusa imagem que não existe aqui" || falha "recusa imagem que não existe aqui" "$SAIDA"
DOUG_CLIENT_QUOTA_GB=99999999 rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "falta disco" && ok "recusa quando não cabe a cota" || falha "recusa quando não cabe a cota" "$SAIDA"
rodar --dry-run novo 064 padaria-aurora "Padaria Aurora"
[[ $CODIGO_SAIDA != 0 ]] && ok "o --dry-run também recusa código repetido" || falha "o --dry-run também recusa código repetido" "$SAIDA"

echo "novo: segundo cliente e retomada"
rodar novo 065 cafe-sol "Café Sol"
[[ $CODIGO_SAIDA == 0 ]] && ok "segundo cliente sobe (imagem achada em docker images)" || falha "segundo cliente sobe" "$SAIDA"
arquivo_tem_linha "$DOUG_CLIENTES_DIR/065-cafe-sol/.env" '^DOUG_HOST_PORT=47101$' && ok "o segundo cliente leva a próxima porta" || falha "o segundo cliente leva a próxima porta"
[[ $(wc -l <"$REGISTRO") == 2 ]] && ok "clientes.tsv tem as duas linhas" || falha "clientes.tsv tem as duas linhas"
# Retomada: cai tudo depois do .env e antes do registro; rodar de novo mantém os segredos.
env_antes=$(cat "$DOUG_CLIENTES_DIR/065-cafe-sol/.env")
rm -f "$DOUG_CADDY_DIR/clientes/cafe-sol.caddy"
awk -F'\t' '$1 != "065"' "$REGISTRO" >"$REGISTRO.x" && mv "$REGISTRO.x" "$REGISTRO"
rodar novo 065 cafe-sol "Café Sol"
[[ $CODIGO_SAIDA == 0 ]] && ok "novo de novo, depois de uma queda, continua de onde parou" || falha "novo de novo continua" "$SAIDA"
[[ $(cat "$DOUG_CLIENTES_DIR/065-cafe-sol/.env") == "$env_antes" ]] && ok "a retomada mantém o .env e os segredos" || falha "a retomada mantém o .env e os segredos"
[[ $(wc -l <"$REGISTRO") == 2 && -f $DOUG_CADDY_DIR/clientes/cafe-sol.caddy ]] && ok "a retomada refaz o registro e o Caddy" || falha "a retomada refaz o registro e o Caddy"

echo "novo: falhas no meio não registram"
novo_ambiente falha
FAKE_HEALTH_FAIL=1 rodar novo 070 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não respondeu" && ok "falha se o /api/health não responde" || falha "falha se o /api/health não responde" "$SAIDA"
[[ ! -s $REGISTRO ]] && ok "sem health não registra o cliente" || falha "sem health não registra o cliente"
[[ ! -e $DOUG_CADDY_DIR/clientes/mercado-lua.caddy ]] && ok "sem health não publica no Caddy" || falha "sem health não publica no Caddy"
FAKE_CADDY_FAIL=1 rodar novo 070 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "proxy não aceitou" && ok "falha se o Caddy não recarrega" || falha "falha se o Caddy não recarrega" "$SAIDA"
[[ ! -s $REGISTRO && ! -e $DOUG_CADDY_DIR/clientes/mercado-lua.caddy ]] && ok "Caddy recusou: nem registro nem arquivo ficam" || falha "Caddy recusou: nem registro nem arquivo ficam"
rodar novo 070 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 && $(wc -l <"$REGISTRO") == 1 ]] && ok "depois da falha, rodar de novo conclui" || falha "depois da falha, rodar de novo conclui" "$SAIDA"

echo "lista, parar, iniciar, backup"
novo_ambiente ciclo
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
rodar lista
contem "$SAIDA" "padaria-aurora" && contem "$SAIDA" "cafe-sol" && contem "$SAIDA" "Café Sol" && ok "lista mostra os clientes" || falha "lista mostra os clientes" "$SAIDA"
contem "$SAIDA" "no ar" && ok "lista mostra o estado" || falha "lista mostra o estado" "$SAIDA"
FAKE_RUNNING=0 rodar lista
contem "$SAIDA" "parado" && ok "lista mostra parado" || falha "lista mostra parado" "$SAIDA"
rodar parar 064
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$FAKE_LOG" '^compose -p doug-064 .* stop$' && ok "parar roda docker compose stop do cliente" || falha "parar roda docker compose stop do cliente" "$SAIDA"
: >"$FAKE_LOG"
rodar iniciar 064
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$FAKE_LOG" '^compose -p doug-064 .* up -d$' && ok "iniciar roda docker compose up -d do cliente" || falha "iniciar roda docker compose up -d do cliente" "$SAIDA"
rodar parar 099
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não está em" && ok "parar recusa cliente que não existe" || falha "parar recusa cliente que não existe" "$SAIDA"
rodar backup 064
B=$(ls "$DOUG_CLIENTES_DIR"/backups/064/manual-*.dump 2>/dev/null | head -1)
[[ -n $B && $(stat -c %a "$B") == 600 && $(cat "$B") == "PGDMP falso" ]] && ok "backup grava o dump em backups/<codigo>/ (chmod 600)" || falha "backup grava o dump em backups/<codigo>/" "$SAIDA"
[[ $(stat -c %a "$DOUG_CLIENTES_DIR/backups") == 700 && $(stat -c %a "$DOUG_CLIENTES_DIR/backups/064") == 700 ]] && ok "backups/ e backups/<codigo>/ são 700" || falha "backups/ e backups/<codigo>/ são 700"
[[ ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora/dados/backups ]] && ok "o backup não vai para dentro de dados/" || falha "o backup não vai para dentro de dados/"

echo "remover"
rodar remover 064 <<<"não é o slug"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não confirmado" && ok "remover sem confirmação não faz nada" || falha "remover sem confirmação não faz nada" "$SAIDA"
[[ -d $DOUG_CLIENTES_DIR/064-padaria-aurora && $(grep -c '^064' "$REGISTRO") == 1 ]] && ok "o cliente continua depois da recusa" || falha "o cliente continua depois da recusa"
rodar remover 064 --dry-run
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "[simulação]" && [[ -d $DOUG_CLIENTES_DIR/064-padaria-aurora ]] && ok "remover --dry-run só mostra" || falha "remover --dry-run só mostra" "$SAIDA"
rm -rf "$DOUG_CLIENTES_DIR"/backups/*
echo "padaria-aurora" | "$SCRIPT" remover 064 >"$TMP/saida" 2>&1
CODIGO_SAIDA=$?
SAIDA=$(cat "$TMP/saida")
[[ $CODIGO_SAIDA == 0 ]] && ok "remover com a confirmação certa termina bem" || falha "remover com a confirmação certa termina bem" "$SAIDA"
ls "$DOUG_CLIENTES_DIR"/backups/064/remocao-*.dump >/dev/null 2>&1 && ok "remover faz o backup do banco antes, em backups/<codigo>/" || falha "remover faz o backup do banco antes, em backups/<codigo>/"
! ls "$DOUG_CLIENTES_DIR"/backups/064/remocao-*-files.tar >/dev/null 2>&1 && ok "sem --apagar-dados não arquiva dados/files (a pasta inteira é guardada)" || falha "sem --apagar-dados não arquiva dados/files"
[[ ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora ]] && ok "a pasta saiu do lugar" || falha "a pasta saiu do lugar"
ls -d "$DOUG_CLIENTES_DIR"/removidos/064-padaria-aurora-*/dados/files >/dev/null 2>&1 && ok "sem --apagar-dados, dados/ fica guardado" || falha "sem --apagar-dados, dados/ fica guardado"
! grep -q '^064' "$REGISTRO" && grep -q '^065' "$REGISTRO" && ok "tirou só o 064 do clientes.tsv" || falha "tirou só o 064 do clientes.tsv"
[[ ! -e $DOUG_CADDY_DIR/clientes/padaria-aurora.caddy ]] && [[ -e $DOUG_CADDY_DIR/clientes/cafe-sol.caddy ]] && ok "tirou só o 064 do Caddy" || falha "tirou só o 064 do Caddy"
arquivo_tem_linha "$FAKE_LOG" '^compose -p doug-064 .* down' && ok "derrubou a stack do cliente" || falha "derrubou a stack do cliente"
# O backup vem antes de derrubar.
dump_linha=$(grep -n 'pg_dump' "$FAKE_LOG" | tail -1 | cut -d: -f1)
down_linha=$(grep -n ' down' "$FAKE_LOG" | tail -1 | cut -d: -f1)
((dump_linha < down_linha)) && ok "o backup acontece antes de derrubar" || falha "o backup acontece antes de derrubar"
# A janela de escrita: o servidor para antes do dump (o Postgres fica no ar para ele).
stop_linha=$(grep -n 'compose -p doug-064 .* stop agentes$' "$FAKE_LOG" | tail -1 | cut -d: -f1)
[[ -n $stop_linha ]] && ((stop_linha < dump_linha)) && ok "remover para o servidor (stop agentes) antes do dump" || falha "remover para o servidor (stop agentes) antes do dump" "$stop_linha $dump_linha"
! grep -q 'compose -p doug-064 .* stop$\|compose -p doug-064 .* stop postgres' "$FAKE_LOG" && ok "só o servidor para antes do dump, o Postgres fica no ar" || falha "só o servidor para antes do dump, o Postgres fica no ar"
# Backup que falha: não remove, e o servidor volta antes de sair.
: >"$FAKE_LOG"
FAKE_DUMP_FAIL=1 rodar remover 065 --sim
[[ $CODIGO_SAIDA != 0 && -d $DOUG_CLIENTES_DIR/065-cafe-sol ]] && grep -q '^065' "$REGISTRO" && ok "se o backup falha, nada é removido" || falha "se o backup falha, nada é removido" "$SAIDA"
stop_l=$(grep -n 'compose -p doug-065 .* stop agentes$' "$FAKE_LOG" | head -1 | cut -d: -f1)
dump_l=$(grep -n 'pg_dump' "$FAKE_LOG" | head -1 | cut -d: -f1)
volta_l=$(grep -n 'compose -p doug-065 .* up -d agentes$' "$FAKE_LOG" | tail -1 | cut -d: -f1)
[[ -n $stop_l && -n $dump_l && -n $volta_l ]] && ((stop_l < dump_l && dump_l < volta_l)) && ! grep -q 'compose -p doug-065 .* down' "$FAKE_LOG" && ok "backup que falha: o servidor é religado (up -d agentes) e nada é derrubado" || falha "backup que falha: o servidor é religado" "$stop_l $dump_l $volta_l"
contem "$SAIDA" "religuei o servidor" && ok "a saída diz que religou o servidor" || falha "a saída diz que religou o servidor" "$SAIDA"
# Cliente parado de propósito: se a remoção falhar, ele não volta ao ar sozinho.
: >"$FAKE_LOG"
FAKE_RUNNING=0 FAKE_DUMP_FAIL=1 rodar remover 065 --sim
[[ $CODIGO_SAIDA != 0 ]] && ! grep -q 'compose -p doug-065 .* up -d agentes$' "$FAKE_LOG" && ! contem "$SAIDA" "religuei o servidor" && contem "$SAIDA" "já estava parado" && ok "remover que falha não religa um cliente que já estava parado" || falha "remover que falha não religa um cliente que já estava parado" "$SAIDA"
# --apagar-dados.
echo "segredo do arquivo do cliente" >"$DOUG_CLIENTES_DIR/065-cafe-sol/dados/files/nota.txt"
rodar remover 065 --apagar-dados --dry-run
contem "$SAIDA" "arquivar dados/files num tar" && ok "a confirmação do --apagar-dados diz que dados/files vira um tar" || falha "a confirmação do --apagar-dados diz que dados/files vira um tar" "$SAIDA"
echo "APAGAR cafe-sol" | "$SCRIPT" remover 065 --apagar-dados >"$TMP/saida" 2>&1
CODIGO_SAIDA=$?
[[ $CODIGO_SAIDA == 0 && ! -e $DOUG_CLIENTES_DIR/065-cafe-sol ]] && ok "--apagar-dados apaga a pasta" || falha "--apagar-dados apaga a pasta" "$(cat "$TMP/saida")"
E=$(ls "$DOUG_CLIENTES_DIR"/backups/065/remocao-*.env 2>/dev/null | head -1)
[[ -n $E ]] && arquivo_tem_linha "$E" '^AGENTES_SECRET=' && ok "--apagar-dados guarda o .env ao lado do backup" || falha "--apagar-dados guarda o .env ao lado do backup"
T=$(ls "$DOUG_CLIENTES_DIR"/backups/065/remocao-*-files.tar 2>/dev/null | head -1)
[[ -n $T && $(stat -c %a "$T") == 600 ]] && tar -tf "$T" | grep -qx 'files/nota.txt' && ok "--apagar-dados arquiva dados/files num tar (600) ao lado do dump" || falha "--apagar-dados arquiva dados/files num tar ao lado do dump"
contem "$(cat "$TMP/saida")" "-files.tar" && ok "a mensagem final diz onde ficou o tar de dados/files" || falha "a mensagem final diz onde ficou o tar de dados/files" "$(cat "$TMP/saida")"
[[ ! -s $REGISTRO ]] && ok "o registro ficou vazio" || falha "o registro ficou vazio"
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "o código e o slug removidos ficam livres" || falha "o código e o slug removidos ficam livres" "$SAIDA"

echo "cota"
novo_ambiente cota
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
head -c 2097152 /dev/zero >"$DOUG_CLIENTES_DIR/064-padaria-aurora/dados/files/grande.bin"
DOUG_CLIENT_QUOTA_GB=40 rodar cota
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "padaria-aurora" && contem "$SAIDA" "ok" && ok "cota: dentro da cota sai com 0" || falha "cota: dentro da cota sai com 0" "$SAIDA"
DOUG_CLIENT_QUOTA_GB=0.001 rodar cota
[[ $CODIGO_SAIDA == 3 ]] && contem "$SAIDA" "ACIMA DA COTA" && ok "cota: acima da cota sai com 3 e avisa" || falha "cota: acima da cota sai com 3 e avisa" "$SAIDA"
DOUG_CLIENT_QUOTA_GB=0.0021 rodar cota 064
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "perto do limite" && ok "cota: perto do limite avisa sem falhar" || falha "cota: perto do limite avisa sem falhar" "$SAIDA"
rodar cota 099
[[ $CODIGO_SAIDA != 0 ]] && ok "cota recusa cliente que não existe" || falha "cota recusa cliente que não existe" "$SAIDA"

echo "modelos: SSRF, logs, admin do Caddy"
arquivo_tem_linha "$MODELO" '^MODEL_ENDPOINTS_PRIVATE=false$' && ok "o modelo fecha os endereços privados (MODEL_ENDPOINTS_PRIVATE=false)" || falha "o modelo fecha os endereços privados"
arquivo_tem_linha "$MODELO" '^TRUSTED_PROXIES=__REDE__\.0/24$' && ok "TRUSTED_PROXIES do modelo é só a faixa da rede do cliente" || falha "TRUSTED_PROXIES do modelo é só a faixa da rede do cliente"
! arquivo_contem "$MODELO" '172.16.0.0/12' && ! arquivo_tem_linha "$MODELO" '^TRUSTED_PROXIES=.*10\.64\.0\.0/10' && ok "o modelo não confia em todo o pool do Docker" || falha "o modelo não confia em todo o pool do Docker"
arquivo_tem_linha "$SWAS/compose.cliente.yml" 'user: "\$\{DOUG_UID:\?[^}]*\}:\$\{DOUG_UID\}"' && ok "o compose roda o servidor com o uid do cliente (DOUG_UID)" || falha "o compose roda o servidor com o uid do cliente (DOUG_UID)"
arquivo_contem "$SWAS/compose.cliente.yml" 'subnet: "${DOUG_REDE' && arquivo_contem "$SWAS/compose.cliente.yml" '.0/24"' && ok "o compose fixa a sub-rede do cliente (ipam, DOUG_REDE)" || falha "o compose fixa a sub-rede do cliente (ipam, DOUG_REDE)"
[[ $(grep -c 'max-size: "10m"\|logging: \*logs' "$SWAS/compose.cliente.yml") == 2 ]] && ok "o compose limita o log dos dois serviços (max-size)" || falha "o compose limita o log dos dois serviços (max-size)"
arquivo_contem "$SWAS/caddy/Caddyfile" 'admin unix//run/caddy-admin/admin.sock' && ! arquivo_contem "$SWAS/caddy/Caddyfile" 'localhost:2019' && ok "o admin do Caddy é um socket Unix, não uma porta" || falha "o admin do Caddy é um socket Unix, não uma porta"
arquivo_contem "$SWAS/caddy/compose.yml" 'caddy-admin:/run/caddy-admin' && ok "o socket fica num volume do Docker" || falha "o socket fica num volume do Docker"
if [[ -n $REAL_DOCKER ]] && "$REAL_DOCKER" compose version >/dev/null 2>&1; then
  novo_ambiente compose-real
  rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
  P=$DOUG_CLIENTES_DIR/064-padaria-aurora
  confere "docker compose config aceita o compose.yml e o .env gerados" "$REAL_DOCKER" compose --project-directory "$P" -f "$P/compose.yml" --env-file "$P/.env" config -q
  confere "docker compose config aceita o compose do Caddy" "$REAL_DOCKER" compose -f "$SWAS/caddy/compose.yml" config -q
else
  printf '  (docker compose não está disponível nesta conta: o config de verdade foi pulado)\n'
fi

echo "novo: slugs perigosos"
novo_ambiente slug
for ruim in 'a}b' 'a/b' 'a;b' $'a\nb' 'a b' '../x' 'a{b' 'a"b' 'a-'; do
  rodar novo 064 "$ruim" "Padaria Aurora" --imagem agentes-zim:doug-abc1234
  [[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "slug inválido" && ok "recusa o slug ${ruim//$'\n'/\\n}" || falha "recusa o slug ${ruim//$'\n'/\\n}" "$SAIDA"
done
[[ ! -e $DOUG_CLIENTES_DIR && -z $(ls -A "$DOUG_CADDY_DIR/clientes") ]] && ok "slug recusado não cria pasta, arquivo do Caddy nem registro" || falha "slug recusado não cria pasta, arquivo do Caddy nem registro"
# Um registro adulterado não vira caminho nem bloco do Caddy.
mkdir -p "$DOUG_CLIENTES_DIR"
printf '064\tx}\\n\tNome\t47100\tagentes-zim:doug-abc1234\t2026-11-17T00:00:00Z\n' >"$REGISTRO"
rodar parar 064
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "slug inválido" && ok "carrega_cliente recusa um slug adulterado no registro" || falha "carrega_cliente recusa um slug adulterado no registro" "$SAIDA"
printf '064\tpadaria-aurora\tNome\tabc\tagentes-zim:doug-abc1234\t2026-11-17T00:00:00Z\n' >"$REGISTRO"
rodar parar 064
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "porta inválida" && ok "carrega_cliente recusa uma porta adulterada no registro" || falha "carrega_cliente recusa uma porta adulterada no registro" "$SAIDA"

echo "registro: comparação como texto"
novo_ambiente texto
mkdir -p "$DOUG_CLIENTES_DIR"
printf '064\tpadaria-aurora\tPadaria Aurora\t47100\tagentes-zim:doug-abc1234\t2026-11-17T00:00:00Z\n' >"$REGISTRO"
rodar novo 64 cafe-sol "Café Sol"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "código inválido" && ok "o código 64 não passa por 064" || falha "o código 64 não passa por 064" "$SAIDA"
printf '064\t007\tPadaria Aurora\t47100\tagentes-zim:doug-abc1234\t2026-11-17T00:00:00Z\n' >"$REGISTRO"
rodar novo 065 7 "Sete" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "o slug 7 não é o slug 007 (texto, não número)" || falha "o slug 7 não é o slug 007 (texto, não número)" "$SAIDA"
printf '064\tpadaria-aurora\tNome\t047100\tagentes-zim:doug-abc1234\t2026-11-17T00:00:00Z\n' >"$REGISTRO"
rodar novo 066 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
arquivo_tem_linha "$DOUG_CLIENTES_DIR/066-mercado-lua/.env" '^DOUG_HOST_PORT=47100$' && ok "a porta 47100 não é a 047100 do registro: o texto manda" || falha "a porta 47100 não é a 047100 do registro: o texto manda" "$SAIDA"

echo "porta: corrida e retomada"
novo_ambiente porta
FAKE_HEALTH_FAIL=1 rodar novo 070 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
arquivo_tem_linha "$DOUG_CLIENTES_DIR/070-mercado-lua/.env" '^DOUG_HOST_PORT=47100$' && [[ ! -s $REGISTRO ]] && ok "um cliente que caiu antes do registro deixa o .env com a porta 47100" || falha "um cliente que caiu antes do registro deixa o .env com a porta 47100"
rodar novo 071 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
arquivo_tem_linha "$DOUG_CLIENTES_DIR/071-cafe-sol/.env" '^DOUG_HOST_PORT=47101$' && ok "o próximo cliente pula a porta de um .env ainda não registrado" || falha "o próximo cliente pula a porta de um .env ainda não registrado" "$SAIDA"
rodar novo 070 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$DOUG_CLIENTES_DIR/070-mercado-lua/.env" '^DOUG_HOST_PORT=47100$' && grep -q $'^070\tmercado-lua\tMercado Lua\t47100\t' "$REGISTRO" && ok "a retomada do primeiro mantém a porta 47100 e registra" || falha "a retomada do primeiro mantém a porta 47100 e registra" "$SAIDA"
# Retomada com a porta já registrada para outro cliente: recusa em vez de duplicar.
novo_ambiente porta-dupla
rodar novo 072 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
FAKE_HEALTH_FAIL=1 rodar novo 073 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
sed -i 's/^DOUG_HOST_PORT=.*/DOUG_HOST_PORT=47100/' "$DOUG_CLIENTES_DIR/073-cafe-sol/.env"
rodar novo 073 cafe-sol "Café Sol"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "já é de outro cliente" && ok "a retomada recusa uma porta que é de outro cliente" || falha "a retomada recusa uma porta que é de outro cliente" "$SAIDA"
# Três `novo` ao mesmo tempo: a trava vem antes da porta, cada um fica com a sua.
novo_ambiente corrida
export FAKE_CURL_SLEEP=0.3
for n in 1 2 3; do
  "$SCRIPT" novo "08$n" "loja-$n" "Loja $n" --imagem agentes-zim:doug-abc1234 >"$A/saida-$n" 2>&1 &
done
wait
unset FAKE_CURL_SLEEP
[[ $(wc -l <"$REGISTRO") == 3 ]] && ok "três novo ao mesmo tempo: os três entram no registro" || falha "três novo ao mesmo tempo: os três entram no registro" "$(cat "$A"/saida-*)"
[[ $(cut -f4 "$REGISTRO" | sort -u | wc -l) == 3 ]] && ok "três novo ao mesmo tempo: três portas diferentes" || falha "três novo ao mesmo tempo: três portas diferentes" "$(cut -f4 "$REGISTRO")"
[[ $(cat "$DOUG_CLIENTES_DIR"/08*/.env | grep -c '^DOUG_HOST_PORT=') == 3 && $(cat "$DOUG_CLIENTES_DIR"/08*/.env | grep '^DOUG_HOST_PORT=' | sort -u | wc -l) == 3 ]] && ok "três novo ao mesmo tempo: nenhum .env repete a porta" || falha "três novo ao mesmo tempo: nenhum .env repete a porta"

echo "trava comum (<raiz>/.lock)"
novo_ambiente trava
mkdir -p "$DOUG_CLIENTES_DIR"
# Esta shell segura a trava (outra descrição de arquivo aberto: o script do teste a vê ocupada).
exec 8>"$DOUG_CLIENTES_DIR/.lock"
flock -n 8
DOUG_TRAVA_ESPERA=1 rodar novo 090 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "outro doug-cliente ou o doug-atualizar-clientes" && ok "novo espera a trava .lock e desiste com erro" || falha "novo espera a trava .lock e desiste com erro" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/090-padaria-aurora && ! -s $REGISTRO ]] && ok "sem a trava, novo não escreve nada" || falha "sem a trava, novo não escreve nada"
printf '090\tpadaria-aurora\tPadaria Aurora\t47100\tagentes-zim:doug-abc1234\t2026-11-17T00:00:00Z\n' >"$REGISTRO"
mkdir -p "$DOUG_CLIENTES_DIR/090-padaria-aurora/dados"
: >"$DOUG_CLIENTES_DIR/090-padaria-aurora/compose.yml"
: >"$DOUG_CLIENTES_DIR/090-padaria-aurora/.env"
for cmd in parar iniciar backup compose; do
  DOUG_TRAVA_ESPERA=1 rodar "$cmd" 090
  [[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "trava em $DOUG_CLIENTES_DIR/.lock" && ok "$cmd usa a trava .lock" || falha "$cmd usa a trava .lock" "$SAIDA"
done
DOUG_TRAVA_ESPERA=1 rodar remover 090 --sim
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "trava em $DOUG_CLIENTES_DIR/.lock" && [[ -d $DOUG_CLIENTES_DIR/090-padaria-aurora ]] && ok "remover usa a trava .lock e não mexe em nada sem ela" || falha "remover usa a trava .lock" "$SAIDA"
exec 8>&-
rodar parar 090
[[ $CODIGO_SAIDA == 0 ]] && ok "solta a trava, o mesmo comando passa" || falha "solta a trava, o mesmo comando passa" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/.trava ]] && ok "não existe mais o arquivo .trava (é só .lock)" || falha "não existe mais o arquivo .trava"
# Sem flock, sai com erro: um PATH sem o flock.
SEMFLOCK=$TMP/semflock
mkdir -p "$SEMFLOCK"
for c in env bash awk sed grep date mkdir chmod chown install mv rm cat cp tr wc df du dirname readlink stat ls head tail sort cut sha256sum mktemp id tar printf sleep find uniq tee paste; do
  [[ -e $SEMFLOCK/$c ]] || { w=$(command -v "$c" 2>/dev/null) && [[ -x $w ]] && ln -s "$w" "$SEMFLOCK/$c"; }
done
novo_ambiente sem-flock
PATH=$SEMFLOCK:$BIN "$SCRIPT" novo 090 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234 >"$TMP/saida" 2>&1
CODIGO_SAIDA=$?
SAIDA=$(cat "$TMP/saida")
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "falta o comando flock" && ok "sem flock, novo sai com erro" || falha "sem flock, novo sai com erro" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/090-padaria-aurora ]] && ok "sem flock, nada é criado" || falha "sem flock, nada é criado"
PATH=$SEMFLOCK:$BIN "$SCRIPT" novo 090 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234 --dry-run >"$TMP/saida" 2>&1
[[ $? == 0 ]] && ok "o --dry-run não pede a trava (nem escreve nada)" || falha "o --dry-run não pede a trava" "$(cat "$TMP/saida")"

echo "permissões"
novo_ambiente perm
( umask 000; "$SCRIPT" novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234 >"$TMP/saida" 2>&1 ) || falha "novo com umask 000" "$(cat "$TMP/saida")"
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
modo() { stat -c %a "$1"; }
sem_escrita_de_outros() { (( (8#$(modo "$1") & 8#022) == 0 )); }
[[ $(modo "$DOUG_CLIENTES_DIR") == 711 ]] && ok "a raiz fica 711 (mesmo com umask 000)" || falha "a raiz fica 711" "$(modo "$DOUG_CLIENTES_DIR")"
[[ $(modo "$P") == 711 ]] && ok "a pasta do cliente fica 711" || falha "a pasta do cliente fica 711" "$(modo "$P")"
[[ $(modo "$P/dados") == 711 ]] && ok "dados/ fica 711" || falha "dados/ fica 711" "$(modo "$P/dados")"
[[ $(modo "$P/dados/files") == 700 ]] && ok "dados/files fica 700" || falha "dados/files fica 700" "$(modo "$P/dados/files")"
[[ $(modo "$P/.env") == 600 ]] && ok ".env fica 600" || falha ".env fica 600"
sem_escrita_de_outros "$P/compose.yml" && sem_escrita_de_outros "$P/.env" && sem_escrita_de_outros "$P" && ok "pasta, compose.yml e .env sem escrita para grupo nem outros" || falha "pasta, compose.yml e .env sem escrita para grupo nem outros"
if ((EUID == 0)); then
  [[ $(stat -c %u "$P") == 0 && $(stat -c %u "$P/compose.yml") == 0 && $(stat -c %u "$P/.env") == 0 ]] && ok "pasta, compose.yml e .env são do root" || falha "pasta, compose.yml e .env são do root"
else
  [[ $(stat -c %u "$P") == "$EUID" && $(stat -c %u "$P/.env") == "$EUID" ]] && ok "o dono é quem rodou (root, em produção; este teste não é root)" || falha "o dono é quem rodou"
fi
# A retomada conserta o que alguém afrouxou.
chmod 777 "$P" "$P/dados" "$P/dados/files" "$P/compose.yml"
chmod 666 "$P/.env"
printf '' >"$REGISTRO"
rodar novo 064 padaria-aurora "Padaria Aurora"
[[ $(modo "$P") == 711 && $(modo "$P/dados") == 711 && $(modo "$P/dados/files") == 700 && $(modo "$P/.env") == 600 && $(modo "$P/compose.yml") == 644 ]] && ok "a retomada refaz os modos (711, 711, 700, 600, 644)" || falha "a retomada refaz os modos" "$(modo "$P") $(modo "$P/dados") $(modo "$P/dados/files") $(modo "$P/.env") $(modo "$P/compose.yml")"

echo "proxy: modo externo (o proxy é um contêiner, ligado à rede do cliente)"
novo_ambiente externo
export DOUG_PROXY_MODE=externo
export DOUG_PROXY_CONTAINER=proxy-teste
export DOUG_PROXY_SITES_DIR=$A/sites
export DOUG_PROXY_RELOAD="docker exec proxy-teste caddy reload --config /etc/caddy/Caddyfile"
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "novo no modo externo termina bem" || falha "novo no modo externo termina bem" "$SAIDA"
SITE=$DOUG_PROXY_SITES_DIR/padaria-aurora.caddy
arquivo_contem "$SITE" "reverse_proxy doug-064-agentes:3000" && ! arquivo_contem "$SITE" "127.0.0.1" && ok "o upstream é o contêiner do cliente pelo nome, não o loopback" || falha "o upstream é o contêiner do cliente pelo nome, não o loopback" "$(cat "$SITE" 2>/dev/null)"
[[ ! -e $DOUG_CADDY_DIR/clientes/padaria-aurora.caddy ]] && ok "o arquivo vai para DOUG_PROXY_SITES_DIR, não para a pasta do repositório" || falha "o arquivo vai para DOUG_PROXY_SITES_DIR"
[[ $(stat -c %a "$SITE") == 600 && $(stat -c %a "$DOUG_PROXY_SITES_DIR") == 700 ]] && ok "o arquivo do site (600) e a pasta (700) são só do root: a lista dos sites é a dos clientes" || falha "o arquivo do site (600) e a pasta (700) são só do root" "$(stat -c %a "$SITE" "$DOUG_PROXY_SITES_DIR")"
arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.64.2 doug-064 proxy-teste" && ok "liga o contêiner do proxy à rede doug-064 com o endereço .2 da rede do cliente" || falha "liga o contêiner do proxy à rede doug-064" "$(grep network "$FAKE_LOG")"
up_l=$(grep -n 'compose -p doug-064 .* up -d$' "$FAKE_LOG" | head -1 | cut -d: -f1)
con_l=$(grep -n 'network connect' "$FAKE_LOG" | head -1 | cut -d: -f1)
rel_l=$(grep -n 'exec proxy-teste caddy reload' "$FAKE_LOG" | head -1 | cut -d: -f1)
[[ -n $up_l && -n $con_l && -n $rel_l ]] && ((up_l < con_l && con_l < rel_l)) && ok "a ordem é subir a stack, ligar a rede, recarregar o proxy" || falha "a ordem é subir a stack, ligar a rede, recarregar o proxy" "$up_l $con_l $rel_l"
arquivo_contem "$FAKE_LOG" "exec proxy-teste caddy reload --config /etc/caddy/Caddyfile" && ok "o modo externo roda DOUG_PROXY_RELOAD (docker exec no contêiner do proxy)" || falha "o modo externo roda DOUG_PROXY_RELOAD"
! arquivo_contem "$FAKE_LOG" "-f $DOUG_CADDY_DIR/compose.yml" && ok "o modo externo não sobe nem recarrega o Caddy próprio" || falha "o modo externo não sobe nem recarrega o Caddy próprio"
arquivo_tem_linha "$DOUG_CLIENTES_DIR/064-padaria-aurora/.env" '^TRUSTED_PROXIES=10\.64\.64\.0/24$' && ok "TRUSTED_PROXIES é a faixa do cliente, onde o proxy entra (10.64.64.2)" || falha "TRUSTED_PROXIES é a faixa do cliente"
# Retomada com o proxy já ligado: não liga de novo.
: >"$FAKE_LOG"
esta_na_rede 064 proxy-teste || falha "o proxy ficou ligado à rede do 064 depois do novo"
awk -F'\t' '$1 != "064"' "$REGISTRO" >"$REGISTRO.x" && mv "$REGISTRO.x" "$REGISTRO"
rodar novo 064 padaria-aurora "Padaria Aurora"
[[ $CODIGO_SAIDA == 0 ]] && ! arquivo_contem "$FAKE_LOG" "network connect" && ok "com o proxy já na rede, a retomada não liga de novo" || falha "com o proxy já na rede, a retomada não liga de novo" "$SAIDA"
# Segundo cliente: rede própria.
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.65.2 doug-065 proxy-teste" && arquivo_contem "$DOUG_PROXY_SITES_DIR/cafe-sol.caddy" "doug-065-agentes:3000" && ok "cada cliente tem a sua rede e o seu upstream" || falha "cada cliente tem a sua rede e o seu upstream" "$SAIDA"
# A rede não liga: nada é registrado.
FAKE_NET_FAIL=1 rodar novo 066 loja-lua "Loja Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não consegui ligar o contêiner proxy-teste" && ! grep -q '^066' "$REGISTRO" && [[ ! -e $DOUG_PROXY_SITES_DIR/loja-lua.caddy ]] && ok "se o proxy não liga à rede, não publica nem registra" || falha "se o proxy não liga à rede, não publica nem registra" "$SAIDA"
# Recarga que falha: volta o arquivo.
export DOUG_PROXY_RELOAD=false
rodar novo 067 padaria-sol "Padaria Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 && ! -e $DOUG_PROXY_SITES_DIR/padaria-sol.caddy ]] && ! grep -q '^067' "$REGISTRO" && ok "recarga que falha: o arquivo volta ao que era e não registra" || falha "recarga que falha: o arquivo volta ao que era e não registra" "$SAIDA"
unset DOUG_PROXY_RELOAD
rodar novo 067 padaria-sol "Padaria Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "DOUG_PROXY_RELOAD não está definido" && ok "sem DOUG_PROXY_RELOAD o aviso manda recarregar à mão" || falha "sem DOUG_PROXY_RELOAD o aviso manda recarregar à mão" "$SAIDA"
# remover: desliga o proxy da rede antes de derrubar, tira o arquivo e recarrega.
export DOUG_PROXY_RELOAD="echo recarga-ao-remover >>$A/proxy.log"
: >"$FAKE_LOG"
rodar remover 064 --sim
[[ $CODIGO_SAIDA == 0 && ! -e $DOUG_PROXY_SITES_DIR/padaria-aurora.caddy ]] && grep -q recarga-ao-remover "$A/proxy.log" && ok "remover tira o arquivo e recarrega o proxy externo" || falha "remover tira o arquivo e recarrega o proxy externo" "$SAIDA"
dis_l=$(grep -n 'network disconnect doug-064 proxy-teste' "$FAKE_LOG" | head -1 | cut -d: -f1)
dow_l=$(grep -n 'compose -p doug-064 .* down' "$FAKE_LOG" | head -1 | cut -d: -f1)
[[ -n $dis_l && -n $dow_l ]] && ((dis_l < dow_l)) && ok "remover desconecta a rede do proxy antes de derrubar a stack" || falha "remover desconecta a rede do proxy antes de derrubar a stack" "$dis_l $dow_l"
: >"$FAKE_LOG"
cria_rede 065
rodar remover 065 --sim
! arquivo_contem "$FAKE_LOG" "network disconnect" && ok "com o proxy fora da rede, remover não desconecta" || falha "com o proxy fora da rede, remover não desconecta"
esta_na_rede 067 proxy-teste && ok "o proxy está na rede do 067 antes da remoção que falha" || falha "o proxy está na rede do 067 antes da remoção que falha"
: >"$FAKE_LOG"
FAKE_NET_FAIL=1 rodar remover 067 --sim
[[ $CODIGO_SAIDA != 0 && -d $DOUG_CLIENTES_DIR/067-padaria-sol ]] && grep -q '^067' "$REGISTRO" && ! grep -q 'compose -p doug-067 .* down' "$FAKE_LOG" && ok "se não desconecta a rede, remover não derruba nada" || falha "se não desconecta a rede, remover não derruba nada" "$SAIDA"
contem "$SAIDA" "religar-proxy" && ok "a falha do remover cita o religar-proxy" || falha "a falha do remover cita o religar-proxy" "$SAIDA"
contem "$SAIDA" "religuei o servidor" && grep -q 'compose -p doug-067 .* up -d agentes$' "$FAKE_LOG" && ok "e o servidor, parado para o backup, volta" || falha "e o servidor, parado para o backup, volta" "$SAIDA"
# religar-proxy: o contêiner do proxy foi recriado e perdeu as redes.
rodar novo 069 mercado-sol "Mercado Sol" --imagem agentes-zim:doug-abc1234
esvazia_redes
: >"$FAKE_LOG"
recargas_antes=$(grep -c recarga-ao-remover "$A/proxy.log")
rodar religar-proxy
[[ $CODIGO_SAIDA == 0 ]] && arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.67.2 doug-067 proxy-teste" && arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.69.2 doug-069 proxy-teste" && ok "religar-proxy liga o proxy à rede de cada cliente" || falha "religar-proxy liga o proxy à rede de cada cliente" "$SAIDA"
[[ $(grep -c recarga-ao-remover "$A/proxy.log") == $((recargas_antes + 1)) ]] && ok "religar-proxy recarrega o proxy" || falha "religar-proxy recarrega o proxy"
: >"$FAKE_LOG"
rodar religar-proxy
! arquivo_contem "$FAKE_LOG" "network connect" && ok "religar-proxy não liga o que já está ligado" || falha "religar-proxy não liga o que já está ligado"
# Sem o nome do contêiner do proxy, o modo externo recusa.
DOUG_PROXY_CONTAINER="" rodar novo 068 loja-sol "Loja Sol" --dry-run
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "DOUG_PROXY_CONTAINER" && ok "o modo externo sem DOUG_PROXY_CONTAINER é recusado" || falha "o modo externo sem DOUG_PROXY_CONTAINER é recusado" "$SAIDA"
DOUG_PROXY_MODE=abacate rodar novo 066 loja "Loja" --dry-run
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "DOUG_PROXY_MODE" && ok "modo de proxy desconhecido é recusado" || falha "modo de proxy desconhecido é recusado" "$SAIDA"
DOUG_PROXY_MODE=proprio rodar religar-proxy
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "modo externo" && ok "religar-proxy é só do modo externo" || falha "religar-proxy é só do modo externo" "$SAIDA"
export DOUG_PROXY_MODE=proprio
unset DOUG_PROXY_CONTAINER DOUG_PROXY_SITES_DIR DOUG_PROXY_RELOAD

echo "proxy: modo próprio, admin por socket Unix"
novo_ambiente proprio
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
arquivo_contem "$FAKE_LOG" "caddy reload --config /etc/caddy/Caddyfile --address unix//run/caddy-admin/admin.sock" && ok "o reload do Caddy próprio usa --address unix//…" || falha "o reload do Caddy próprio usa --address unix//…" "$(grep caddy "$FAKE_LOG")"

echo "configuração de root (<raiz>/doug-cliente.conf)"
novo_ambiente conf
mkdir -p "$DOUG_CLIENTES_DIR"
CONF=$DOUG_CLIENTES_DIR/doug-cliente.conf
cat >"$CONF" <<EOF
# a conf não é um script: só NOME=valor
DOUG_PROXY_MODE=externo
DOUG_PROXY_CONTAINER='proxy-conf'
DOUG_PROXY_SITES_DIR="$A/sites-conf"
DOUG_PROXY_RELOAD="echo da-conf >>$A/proxy.log"
EOF
chmod 600 "$CONF"
export FAKE_SITES_DIR=$A/sites-conf
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
unset FAKE_SITES_DIR
[[ $CODIGO_SAIDA == 0 && $(cat "$A/proxy.log" 2>/dev/null) == da-conf ]] && ok "a conf de root vale mais que o ambiente (modo e comando de recarga)" || falha "a conf de root vale mais que o ambiente" "$SAIDA"
[[ -f $A/sites-conf/padaria-aurora.caddy ]] && arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.64.2 doug-064 proxy-conf" && ok "a conf dá o contêiner do proxy e a pasta dos sites (valores entre aspas simples e duplas)" || falha "a conf dá o contêiner do proxy e a pasta dos sites"
# Sem source: o que parece comando ou expansão é só texto.
cat >"$CONF" <<EOF
DOUG_DOMINIO=\$(touch $A/executou-1)
DOUG_PROXY_MODE=proprio
EOF
rodar lista
[[ ! -e $A/executou-1 ]] && ok "a conf não executa \$(...) de um valor" || falha "a conf não executa \$(...) de um valor"
printf 'touch %s/executou-2\nDOUG_PROXY_MODE=proprio\n' "$A" >"$CONF"
rodar lista
[[ $CODIGO_SAIDA != 0 && ! -e $A/executou-2 ]] && contem "$SAIDA" "só vale NOME=valor" && ok "uma linha que não é NOME=valor é recusada, e não roda" || falha "uma linha que não é NOME=valor é recusada, e não roda" "$SAIDA"
printf 'DOUG_QUALQUER_COISA=1\nPATH=/nada\nDOUG_CLIENTES_DIR=/nada-de-raiz\nDOUG_PROXY_MODE=proprio\n' >"$CONF"
rodar lista
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "DOUG_QUALQUER_COISA não vale na conf" && contem "$SAIDA" "PATH não vale na conf" && ok "chave que não é das conhecidas é ignorada, com aviso (nem o PATH entra)" || falha "chave que não é das conhecidas é ignorada, com aviso" "$SAIDA"
contem "$SAIDA" "DOUG_CLIENTES_DIR não vale na conf" && ok "DOUG_CLIENTES_DIR não vale na conf (ela fica dentro dele)" || falha "DOUG_CLIENTES_DIR não vale na conf" "$SAIDA"
[[ ! -e /nada-de-raiz ]] && ok "a raiz continua a do ambiente" || falha "a raiz continua a do ambiente"
printf 'DOUG_PORTA_INICIAL=a[$(touch %s/executou-3)]\n' "$A" >"$CONF"
rodar lista
[[ $CODIGO_SAIDA != 0 && ! -e $A/executou-3 ]] && contem "$SAIDA" "não é um número" && ok "um valor numérico que não é número é recusado, sem avaliar" || falha "um valor numérico que não é número é recusado, sem avaliar" "$SAIDA"
printf 'DOUG_PROXY_MODE=proprio\n' >"$CONF"
chmod 666 "$CONF"
rodar lista
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "sem escrita para grupo nem outros" && ok "a conf com escrita para outros é recusada" || falha "a conf com escrita para outros é recusada" "$SAIDA"

echo "compose: reinstala o compose.yml e completa o .env"
novo_ambiente compose
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
rodar compose 064
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "já tem todas as variáveis" && ok "compose num .env completo não muda nada" || falha "compose num .env completo não muda nada" "$SAIDA"
# O modelo ganhou uma variável: tira uma do .env (como se o cliente fosse de antes dela) e muda o compose.
env_antes=$(grep -v '^MODEL_ENDPOINTS_PRIVATE=\|^TRUSTED_PROXIES=' "$P/.env")
grep -v '^MODEL_ENDPOINTS_PRIVATE=' "$P/.env" >"$P/.env.t" && cat "$P/.env.t" >"$P/.env" && rm -f "$P/.env.t"
sed -i 's/^SHUTDOWN_DELAY_MS=.*/SHUTDOWN_DELAY_MS=9999/' "$P/.env"
echo "# compose velho" >>"$P/compose.yml"
chmod 666 "$P/compose.yml"
rodar compose 064 --dry-run
contem "$SAIDA" "MODEL_ENDPOINTS_PRIVATE" && ! arquivo_contem "$P/.env" "MODEL_ENDPOINTS_PRIVATE" && arquivo_contem "$P/compose.yml" "compose velho" && ok "compose --dry-run diz o que acrescentaria e não escreve" || falha "compose --dry-run" "$SAIDA"
senha_antes=$(grep '^POSTGRES_PASSWORD=' "$P/.env")
rodar compose 064
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$P/.env" '^MODEL_ENDPOINTS_PRIVATE=false$' && ok "compose acrescenta ao .env a variável que faltava" || falha "compose acrescenta ao .env a variável que faltava" "$SAIDA"
arquivo_tem_linha "$P/.env" '^SHUTDOWN_DELAY_MS=9999$' && [[ $(grep '^POSTGRES_PASSWORD=' "$P/.env") == "$senha_antes" ]] && [[ $(grep -c '^MODEL_ENDPOINTS_PRIVATE=' "$P/.env") == 1 ]] && ok "compose não mexe nas variáveis que existem" || falha "compose não mexe nas variáveis que existem"
confere "compose reinstala o compose.yml a partir do modelo" cmp -s "$SWAS/compose.cliente.yml" "$P/compose.yml"
[[ $(stat -c %a "$P/compose.yml") == 644 && $(stat -c %a "$P/.env") == 600 ]] && ok "compose deixa os modos do compose.yml e do .env certos" || falha "compose deixa os modos do compose.yml e do .env certos"
rodar compose 064
contem "$SAIDA" "já tem todas as variáveis" && ok "rodar compose de novo não acrescenta de novo" || falha "rodar compose de novo não acrescenta de novo" "$SAIDA"
# Sem o segredo do banco o .env não é deste cliente: não inventa.
grep -v '^POSTGRES_PASSWORD=' "$P/.env" >"$P/.env.t" && cat "$P/.env.t" >"$P/.env" && rm -f "$P/.env.t"
rodar compose 064
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não invento segredos" && ! arquivo_contem "$P/.env" "POSTGRES_PASSWORD" && ok "compose não inventa o segredo que faltar" || falha "compose não inventa o segredo que faltar" "$SAIDA"
rodar compose 099
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não está em" && ok "compose recusa cliente que não existe" || falha "compose recusa cliente que não existe" "$SAIDA"

echo "novo: --imagem com um .env que já existe"
novo_ambiente imagem
FAKE_HEALTH_FAIL=1 rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-outra
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "já usa a imagem agentes-zim:doug-abc1234" && ok "--imagem diferente do .env existente é recusada com uma mensagem clara" || falha "--imagem diferente do .env existente é recusada" "$SAIDA"
[[ ! -s $REGISTRO ]] && ok "a recusa da imagem não registra nada" || falha "a recusa da imagem não registra nada"
rodar novo 064 padaria-aurora "Padaria Aurora"
IFS=$'\t' read -r c s n p i d <"$REGISTRO"
[[ $CODIGO_SAIDA == 0 && $i == agentes-zim:doug-abc1234 ]] && ok "na retomada o registro leva a imagem do .env" || falha "na retomada o registro leva a imagem do .env" "$SAIDA $i"

echo "disco: a cota de todos os clientes"
novo_ambiente disco
livre=$(df -Pk "$TMP" | awk 'NR == 2 { print $4 }')
# Uma cota de 60% do que há livre: um cliente cabe, o segundo (o prometido soma 120%) não.
export DOUG_CLIENT_QUOTA_GB=$(awk -v l="$livre" 'BEGIN { printf "%.6f", l * 0.6 / 1048576 }')
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "o primeiro cliente cabe na cota" || falha "o primeiro cliente cabe na cota" "$SAIDA"
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "falta disco" && contem "$SAIDA" "1 clientes de hoje" && ok "o segundo cliente não cabe: a cota reservada soma a de todos" || falha "o segundo cliente não cabe: a cota reservada soma a de todos" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/065-cafe-sol ]] && ok "a recusa por disco não cria a pasta" || falha "a recusa por disco não cria a pasta"

echo "cota: o que não dá para medir"
novo_ambiente medir
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
if ((EUID != 0)); then
  mkdir "$DOUG_CLIENTES_DIR/064-padaria-aurora/dados/files/fechada"
  chmod 000 "$DOUG_CLIENTES_DIR/064-padaria-aurora/dados/files/fechada"
  rodar cota
  [[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não consegui medir" && ok "cota que não consegue medir avisa em vez de inventar um número" || falha "cota que não consegue medir avisa" "$SAIDA"
  chmod 700 "$DOUG_CLIENTES_DIR/064-padaria-aurora/dados/files/fechada"
else
  printf '  (root lê tudo: o teste de pasta ilegível foi pulado)\n'
fi

echo "novo: .env.novo órfão"
novo_ambiente orfao
mkdir -p "$DOUG_CLIENTES_DIR/064-padaria-aurora"
echo "lixo de uma queda" >"$DOUG_CLIENTES_DIR/064-padaria-aurora/.env.novo"
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 && ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora/.env.novo ]] && ok "um .env.novo órfão é removido" || falha "um .env.novo órfão é removido" "$SAIDA"
novo_ambiente orfao2
FAKE_OPENSSL_FAIL=1 rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 && ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora/.env.novo && ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora/.env ]] && ok "openssl que falha não deixa .env nem .env.novo" || falha "openssl que falha não deixa .env nem .env.novo" "$SAIDA"

echo "um uid e uma rede por cliente"
novo_ambiente uid
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
rodar novo 010 loja-dez "Loja Dez" --imagem agentes-zim:doug-abc1234
rodar novo 000 loja-zero "Loja Zero" --imagem agentes-zim:doug-abc1234
rodar novo 255 loja-fim "Loja Fim" --imagem agentes-zim:doug-abc1234
P64=$DOUG_CLIENTES_DIR/064-padaria-aurora
P65=$DOUG_CLIENTES_DIR/065-cafe-sol
arquivo_tem_linha "$P64/.env" '^DOUG_UID=1000000064$' && arquivo_tem_linha "$P65/.env" '^DOUG_UID=1000000065$' && ok "DOUG_UID é DOUG_UID_BASE (1000000000) + o código, um por cliente" || falha "DOUG_UID é DOUG_UID_BASE + o código, um por cliente"
arquivo_tem_linha "$DOUG_CLIENTES_DIR/010-loja-dez/.env" '^DOUG_UID=1000000010$' && arquivo_tem_linha "$DOUG_CLIENTES_DIR/010-loja-dez/.env" '^DOUG_REDE=10\.64\.10$' && ok "o código 010 vale dez (decimal, não octal)" || falha "o código 010 vale dez (decimal, não octal)"
arquivo_tem_linha "$DOUG_CLIENTES_DIR/000-loja-zero/.env" '^DOUG_UID=1000000000$' && arquivo_tem_linha "$DOUG_CLIENTES_DIR/255-loja-fim/.env" '^DOUG_REDE=10\.64\.255$' && ok "os códigos 000 e 255 funcionam" || falha "os códigos 000 e 255 funcionam"
arquivo_tem_linha "$P64/.env" '^DOUG_REDE=10\.64\.64$' && arquivo_tem_linha "$P65/.env" '^DOUG_REDE=10\.64\.65$' && ok "DOUG_REDE é 10.64.<código>, uma por cliente" || falha "DOUG_REDE é 10.64.<código>, uma por cliente"
arquivo_tem_linha "$P64/.env" '^TRUSTED_PROXIES=10\.64\.64\.0/24$' && arquivo_tem_linha "$P65/.env" '^TRUSTED_PROXIES=10\.64\.65\.0/24$' && ok "TRUSTED_PROXIES de cada cliente é só a faixa da rede dele" || falha "TRUSTED_PROXIES de cada cliente é só a faixa da rede dele" "$(grep TRUSTED "$P64/.env" "$P65/.env")"
! grep -q '10\.64\.65' "$P64/.env" && ! grep -q '10\.64\.64' "$P65/.env" && ok "um cliente não confia na faixa do outro" || falha "um cliente não confia na faixa do outro"
arquivo_tem_linha "$P64/.env" '^TRUSTED_PROXIES=' && [[ $(grep -c '^TRUSTED_PROXIES=' "$P64/.env") == 1 ]] && ok ".env tem uma linha só de TRUSTED_PROXIES" || falha ".env tem uma linha só de TRUSTED_PROXIES"
# chown: o root fica com a pasta e os arquivos, o uid do cliente com dados/files.
grep -qE "^root:root $P64 $P64/dados $P64/compose.yml $P64/.env" "$FAKE_CHOWN_LOG" && ok "chown dá a pasta, dados/, compose.yml e .env ao root:root" || falha "chown dá a pasta, dados/, compose.yml e .env ao root:root" "$(cat "$FAKE_CHOWN_LOG")"
grep -qxF "1000000064:1000000064 $P64/dados/files" "$FAKE_CHOWN_LOG" && grep -qxF "1000000065:1000000065 $P65/dados/files" "$FAKE_CHOWN_LOG" && ok "chown dá dados/files ao uid do cliente (1000000064, 1000000065), não ao 1000" || falha "chown dá dados/files ao uid do cliente" "$(cat "$FAKE_CHOWN_LOG")"
! grep -qE '(^| )1000(:| )' "$FAKE_CHOWN_LOG" && ok "nenhum chown usa o uid 1000 (um login da máquina)" || falha "nenhum chown usa o uid 1000"
grep -qxF "1000000064:1000000064 $P64/dados/files" <(grep '/dados/files$' "$FAKE_CHOWN_LOG" | sort -u | grep 064-) && [[ $(grep -c "dados/files$" "$FAKE_CHOWN_LOG" | head -1) -ge 5 ]] && ok "cada cliente leva o chown de dados/files" || falha "cada cliente leva o chown de dados/files"
: >"$FAKE_CHOWN_LOG"
rodar compose 064
grep -qxF -- "-hR 1000000064:1000000064 $P64/dados/files" "$FAKE_CHOWN_LOG" && ok "compose refaz o dono de todo o dados/files (chown -hR, sem seguir links)" || falha "compose refaz o dono de dados/files" "$(cat "$FAKE_CHOWN_LOG")"
# Um .env de antes do uid ganha as variáveis com `compose`.
grep -v '^DOUG_UID=\|^DOUG_REDE=' "$P64/.env" >"$P64/.env.t" && cat "$P64/.env.t" >"$P64/.env" && rm -f "$P64/.env.t"
rodar compose 064
arquivo_tem_linha "$P64/.env" '^DOUG_UID=1000000064$' && arquivo_tem_linha "$P64/.env" '^DOUG_REDE=10\.64\.64$' && ok "compose acrescenta DOUG_UID e DOUG_REDE a um .env que não os tinha" || falha "compose acrescenta DOUG_UID e DOUG_REDE a um .env que não os tinha" "$SAIDA"
rodar novo 256 loja-acima "Loja Acima" --dry-run
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "000 a 255" && ok "o código 256 é recusado: não cabe na rede 10.64.<código>.0/24" || falha "o código 256 é recusado: não cabe na rede 10.64.<código>.0/24" "$SAIDA"
rodar novo 999 loja-acima "Loja Acima" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 && ! -e $DOUG_CLIENTES_DIR/999-loja-acima ]] && ok "o código 999 é recusado e nada é criado" || falha "o código 999 é recusado e nada é criado" "$SAIDA"
rodar novo 100 loja-cem "Loja Cem" --dry-run
contem "$SAIDA" "uid:      1000000100, rede 10.64.100.0/24" && ok "o --dry-run mostra o uid e a rede" || falha "o --dry-run mostra o uid e a rede" "$SAIDA"

echo "permissões: .lock, clientes.tsv, backups/ e removidos/"
novo_ambiente perm2
mkdir -p "$DOUG_CLIENTES_DIR"
# Um .lock e um clientes.tsv que alguém criou abertos (o script os fecha).
: >"$DOUG_CLIENTES_DIR/.lock"
chmod 666 "$DOUG_CLIENTES_DIR/.lock"
: >"$REGISTRO"
chmod 644 "$REGISTRO"
( umask 000; "$SCRIPT" novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234 ) >"$TMP/saida" 2>&1 || falha "novo com umask 000" "$(cat "$TMP/saida")"
[[ $(modo "$REGISTRO") == 600 ]] && ok "clientes.tsv, que existia 644, fica 600 depois de acrescentar um cliente" || falha "clientes.tsv fica 600 depois de acrescentar" "$(modo "$REGISTRO")"
(
  umask 000
  "$SCRIPT" novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
  "$SCRIPT" backup 064
  "$SCRIPT" remover 065 --sim
) >"$TMP/saida" 2>&1 || falha "a sequência de permissões" "$(cat "$TMP/saida")"
[[ $(modo "$DOUG_CLIENTES_DIR/.lock") == 600 ]] && ok ".lock fica 600 (mesmo existindo aberto e com umask 000)" || falha ".lock fica 600" "$(modo "$DOUG_CLIENTES_DIR/.lock")"
[[ $(modo "$REGISTRO") == 600 ]] && ok "clientes.tsv continua 600 depois de tirar um cliente" || falha "clientes.tsv fica 600" "$(modo "$REGISTRO")"
[[ $(modo "$DOUG_CLIENTES_DIR/backups") == 700 && $(modo "$DOUG_CLIENTES_DIR/backups/064") == 700 ]] && ok "backups/ e backups/<codigo>/ ficam 700 (umask 000)" || falha "backups/ e backups/<codigo>/ ficam 700"
[[ $(modo "$DOUG_CLIENTES_DIR/removidos") == 700 ]] && ok "removidos/ fica 700 (umask 000)" || falha "removidos/ fica 700" "$(modo "$DOUG_CLIENTES_DIR/removidos" 2>&1)"
[[ $(modo "$DOUG_CLIENTES_DIR/backups/064"/manual-*.dump) == 600 && $(modo "$DOUG_CLIENTES_DIR/backups/065"/remocao-*.dump) == 600 ]] && ok "os dumps ficam 600" || falha "os dumps ficam 600"
# O .lock continua o mesmo arquivo (um flock vale por arquivo): o script não o recria.
ino=$(stat -c %i "$DOUG_CLIENTES_DIR/.lock")
"$SCRIPT" lista >/dev/null 2>&1
rodar parar 064
[[ $(stat -c %i "$DOUG_CLIENTES_DIR/.lock") == "$ino" ]] && ok "o .lock não é recriado a cada comando" || falha "o .lock não é recriado a cada comando"

echo "o descritor da trava não vai para os filhos"
novo_ambiente fd9
export DOUG_PROXY_MODE=externo DOUG_PROXY_CONTAINER=proxy-teste DOUG_PROXY_SITES_DIR=$A/sites
export DOUG_PROXY_RELOAD="if [ -e /proc/self/fd/9 ]; then echo aberto >>$A/fd9-reload; fi; echo ok >>$A/reload-rodou"
# O detector funciona: um filho que herda o descritor 9 é visto.
( exec 9>"$A/qualquer"; "$BIN/docker" detector ) 2>/dev/null
[[ -s $FAKE_LOG.fd9 ]] && ok "o detector do docker falso vê o descritor 9 quando ele é herdado" || falha "o detector do docker falso vê o descritor 9 quando ele é herdado"
rm -f "$FAKE_LOG.fd9"
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
rodar parar 064
rodar iniciar 064
rodar backup 064
[[ -s $A/reload-rodou ]] && [[ ! -e $A/fd9-reload ]] && ok "o comando de recarga do proxy roda sem o descritor 9" || falha "o comando de recarga do proxy roda sem o descritor 9"
[[ ! -e $FAKE_LOG.fd9 ]] && ok "nenhuma chamada ao docker (compose, network, exec, image) herda o descritor 9" || falha "nenhuma chamada ao docker herda o descritor 9" "$(cat "$FAKE_LOG.fd9")"
echo x | "$SCRIPT" remover 064 --sim >/dev/null 2>&1
[[ ! -e $FAKE_LOG.fd9 ]] && ok "o remover também não passa o descritor 9 ao docker" || falha "o remover também não passa o descritor 9 ao docker"
export DOUG_PROXY_MODE=proprio
unset DOUG_PROXY_CONTAINER DOUG_PROXY_SITES_DIR DOUG_PROXY_RELOAD

echo "o disco dos clientes é medido antes da trava"
novo_ambiente antes
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
: >"$FAKE_DU_LOG"
exec 8>"$DOUG_CLIENTES_DIR/.lock"
flock -n 8
DOUG_TRAVA_ESPERA=1 rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
exec 8>&-
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "trava em" && grep -q '064-padaria-aurora/dados' "$FAKE_DU_LOG" && ok "com a trava ocupada, o novo já mediu o disco dos clientes (a medida não segura a trava)" || falha "com a trava ocupada, o novo já mediu o disco dos clientes" "$SAIDA | $(cat "$FAKE_DU_LOG")"

echo "compose: o modelo que não preenche para o comando"
novo_ambiente modelo-ruim
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
RUIM=$TMP/swas-ruim
rm -rf "$RUIM"
mkdir -p "$RUIM"
cp "$SCRIPT" "$SWAS/compose.cliente.yml" "$SWAS/cliente.env.example" "$RUIM/"
printf 'NOVA_VARIAVEL=__SEM_VALOR__\n' >>"$RUIM/cliente.env.example"
env_antes=$(cat "$P/.env")
compose_antes=$(cat "$P/compose.yml")
SAIDA=$("$RUIM/doug-cliente" compose 064 2>&1)
CODIGO_SAIDA=$?
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "campo que o instalador não preenche" && ok "compose sai com erro (não com 0) quando o modelo tem um campo sem valor" || falha "compose sai com erro quando o modelo tem um campo sem valor" "$CODIGO_SAIDA $SAIDA"
[[ $(cat "$P/.env") == "$env_antes" && $(cat "$P/compose.yml") == "$compose_antes" ]] && ok "e não muda o .env nem o compose.yml" || falha "e não muda o .env nem o compose.yml"
SAIDA=$("$RUIM/doug-cliente" compose 064 --dry-run 2>&1)
[[ $? != 0 ]] && ok "o --dry-run do compose também sai com erro" || falha "o --dry-run do compose também sai com erro" "$SAIDA"

echo "menores: openssl, imagem, slug e cota de um cliente começado"
novo_ambiente openssl
FAKE_OPENSSL_FAIL=1 rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "openssl não gerou" && ok "openssl que falha diz que foi o openssl (e sai com erro)" || falha "openssl que falha diz que foi o openssl" "$SAIDA"
novo_ambiente menores
for ruim in -x --force 'a b' 'agentes zim:doug' 'img;rm'; do
  rodar novo 064 padaria-aurora "Padaria Aurora" --imagem "$ruim"
  [[ $CODIGO_SAIDA != 0 ]] && ok "recusa --imagem '$ruim'" || falha "recusa --imagem '$ruim'" "$SAIDA"
done
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem=-x
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não começa com hífen" && ok "recusa --imagem=-x, com a causa" || falha "recusa --imagem=-x, com a causa" "$SAIDA"
DOUG_IMAGE=-x rodar novo 064 padaria-aurora "Padaria Aurora"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "nome de imagem inválido" && ok "recusa DOUG_IMAGE que começa com hífen" || falha "recusa DOUG_IMAGE que começa com hífen" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora ]] && ok "as imagens recusadas não criam pasta" || falha "as imagens recusadas não criam pasta"
# Um cliente começado e ainda não registrado reserva o slug e a cota.
novo_ambiente reserva
FAKE_HEALTH_FAIL=1 rodar novo 070 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
[[ ! -s $REGISTRO && -d $DOUG_CLIENTES_DIR/070-mercado-lua ]] && ok "o cliente que caiu antes do registro deixa a pasta" || falha "o cliente que caiu antes do registro deixa a pasta"
rodar novo 071 mercado-lua "Outro Mercado" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "começado e ainda não registrado" && [[ ! -e $DOUG_CLIENTES_DIR/071-mercado-lua ]] && ok "o slug de um cliente começado e não registrado é dele" || falha "o slug de um cliente começado e não registrado é dele" "$SAIDA"
rodar novo 070 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "o mesmo código e slug continuam o cliente começado" || falha "o mesmo código e slug continuam o cliente começado" "$SAIDA"
novo_ambiente reserva2
livre=$(df -Pk "$TMP" | awk 'NR == 2 { print $4 }')
export DOUG_CLIENT_QUOTA_GB=$(awk -v l="$livre" 'BEGIN { printf "%.6f", l * 0.6 / 1048576 }')
FAKE_HEALTH_FAIL=1 rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ ! -s $REGISTRO ]] && ok "o primeiro cliente caiu antes do registro" || falha "o primeiro cliente caiu antes do registro"
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "falta disco" && contem "$SAIDA" "1 clientes de hoje" && ok "a cota de um cliente começado e não registrado conta na conta do disco" || falha "a cota de um cliente começado e não registrado conta na conta do disco" "$SAIDA"

echo "limpar-backups"
novo_ambiente limpa
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
B=$DOUG_CLIENTES_DIR/backups/064
mkdir -p "$B"
chmod 700 "$B"
for f in manual-padaria-aurora-20261001-100000.dump remocao-padaria-aurora-20261002-100000.dump remocao-padaria-aurora-20261002-100000.env remocao-padaria-aurora-20261002-100000-files.tar manual-padaria-aurora-20261120-100000.dump pre-20261001-100000.dump falhou-20261001-100000.dump; do
  echo x >"$B/$f"
done
rodar limpar-backups 064
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "--antes" && ok "limpar-backups sem --antes recusa" || falha "limpar-backups sem --antes recusa" "$SAIDA"
rodar limpar-backups 064 --antes ontem
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "data válida" && ok "limpar-backups com uma data inválida recusa" || falha "limpar-backups com uma data inválida recusa" "$SAIDA"
rodar limpar-backups 064 --antes 2026-02-31
[[ $CODIGO_SAIDA != 0 ]] && ok "limpar-backups recusa uma data que não existe" || falha "limpar-backups recusa uma data que não existe" "$SAIDA"
rodar limpar-backups 064 --antes 2026-11-01 --dry-run
[[ $CODIGO_SAIDA == 0 && $(ls "$B" | wc -l) == 7 ]] && contem "$SAIDA" "manual-padaria-aurora-20261001-100000.dump" && ok "--dry-run lista o que apagaria e não apaga" || falha "--dry-run lista o que apagaria e não apaga" "$SAIDA"
echo "não" | "$SCRIPT" limpar-backups 064 --antes 2026-11-01 >"$TMP/saida" 2>&1
[[ $? != 0 && $(ls "$B" | wc -l) == 7 ]] && ok "sem a confirmação, não apaga nada" || falha "sem a confirmação, não apaga nada" "$(cat "$TMP/saida")"
rodar limpar-backups 064 --antes 2026-11-01 --sim
[[ $CODIGO_SAIDA == 0 ]] && ok "limpar-backups --antes --sim termina bem" || falha "limpar-backups --antes --sim termina bem" "$SAIDA"
[[ ! -e $B/manual-padaria-aurora-20261001-100000.dump && ! -e $B/remocao-padaria-aurora-20261002-100000.dump && ! -e $B/remocao-padaria-aurora-20261002-100000.env && ! -e $B/remocao-padaria-aurora-20261002-100000-files.tar ]] && ok "apaga o dump, o .env e o tar de antes da data" || falha "apaga o dump, o .env e o tar de antes da data" "$(ls "$B")"
[[ -e $B/manual-padaria-aurora-20261120-100000.dump ]] && ok "guarda o que é da data ou depois" || falha "guarda o que é da data ou depois"
[[ -e $B/pre-20261001-100000.dump && -e $B/falhou-20261001-100000.dump ]] && ok "não toca nos pre-* e falhou-* do doug-atualizar-clientes" || falha "não toca nos pre-* e falhou-* do doug-atualizar-clientes"
echo "APAGAR padaria-aurora" | "$SCRIPT" remover 064 --apagar-dados >/dev/null 2>&1
ls "$B"/remocao-padaria-aurora-*.dump >/dev/null 2>&1 && ok "o remover --apagar-dados deixa o dump em backups/ (é o que a guarda de LGPD limpa)" || falha "o remover --apagar-dados deixa o dump em backups/"
rodar limpar-backups 064 --antes 2099-01-01 --sim
[[ $CODIGO_SAIDA == 0 ]] && ! ls "$B"/remocao-* >/dev/null 2>&1 && [[ -e $B/pre-20261001-100000.dump ]] && ok "vale também para um cliente que já foi removido (o dump, o .env e o tar da remoção saem)" || falha "vale também para um cliente que já foi removido" "$SAIDA $(ls "$B")"
rodar limpar-backups 099 --antes 2099-01-01 --sim
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não há backups" && ok "limpar-backups de um código sem backups avisa" || falha "limpar-backups de um código sem backups avisa" "$SAIDA"

echo "backups: o nome leva o slug, e o código não mistura clientes"
novo_ambiente slugbackup
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
rodar backup 064
ls "$DOUG_CLIENTES_DIR"/backups/064/manual-padaria-aurora-[0-9]*-[0-9]*.dump >/dev/null 2>&1 && ok "o backup manual se chama manual-<slug>-<data>.dump" || falha "o backup manual se chama manual-<slug>-<data>.dump" "$(ls "$DOUG_CLIENTES_DIR/backups/064")"
rodar remover 064 --sim
ls "$DOUG_CLIENTES_DIR"/backups/064/remocao-padaria-aurora-[0-9]*-[0-9]*.dump >/dev/null 2>&1 && ok "o backup da remoção se chama remocao-<slug>-<data>.dump" || falha "o backup da remoção se chama remocao-<slug>-<data>.dump" "$(ls "$DOUG_CLIENTES_DIR/backups/064")"
B=$DOUG_CLIENTES_DIR/backups/064
rodar novo 064 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "backups de outro cliente" && contem "$SAIDA" "padaria-aurora" && contem "$SAIDA" "--reusar-codigo" && ok "novo recusa reutilizar um código cuja pasta de backups é de outro slug" || falha "novo recusa reutilizar um código cuja pasta de backups é de outro slug" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/064-cafe-sol ]] && ok "a recusa não criou a pasta do cliente" || falha "a recusa não criou a pasta do cliente"
rodar novo 064 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234 --dry-run
[[ $CODIGO_SAIDA != 0 ]] && ok "o --dry-run também recusa" || falha "o --dry-run também recusa" "$SAIDA"
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "o mesmo slug volta ao seu código sem a opção" || falha "o mesmo slug volta ao seu código sem a opção" "$SAIDA"
rodar remover 064 --sim
rodar novo 064 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234 --reusar-codigo
[[ $CODIGO_SAIDA == 0 ]] && ok "--reusar-codigo deixa outro cliente usar o código" || falha "--reusar-codigo deixa outro cliente usar o código" "$SAIDA"
# Dois slugs no mesmo código: limpar por código recusa, e --slug limpa só o de um.
rodar backup 064
for f in manual-padaria-aurora-20200101-100000.dump manual-cafe-sol-20200101-100000.dump manual-cafe-sol-20200101-100000.env manual-loja-2020-20200101-100000.dump pre-20200101-100000.dump; do echo x >"$B/$f"; done
rodar limpar-backups 064 --antes 2021-01-01 --sim
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "mais de um cliente" && contem "$SAIDA" "--slug" && [[ -e $B/manual-padaria-aurora-20200101-100000.dump && -e $B/manual-cafe-sol-20200101-100000.dump ]] && ok "limpar-backups recusa apagar pelo código quando há backups de mais de um cliente" || falha "limpar-backups recusa apagar pelo código quando há backups de mais de um cliente" "$SAIDA"
rodar limpar-backups 064 --antes 2021-01-01 --slug cafe-sol --sim
[[ $CODIGO_SAIDA == 0 && ! -e $B/manual-cafe-sol-20200101-100000.dump && ! -e $B/manual-cafe-sol-20200101-100000.env ]] && ok "--slug apaga os backups só desse cliente" || falha "--slug apaga os backups só desse cliente" "$SAIDA $(ls "$B")"
[[ -e $B/manual-padaria-aurora-20200101-100000.dump && -e $B/manual-loja-2020-20200101-100000.dump && -e $B/pre-20200101-100000.dump ]] && ok "e deixa os de outro slug (inclusive um com ano no nome) e os pre-*" || falha "e deixa os de outro slug e os pre-*" "$(ls "$B")"
rodar limpar-backups 064 --antes 2021-01-01 --slug "Ruim Slug" --sim
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "slug inválido" && ok "--slug inválido é recusado" || falha "--slug inválido é recusado" "$SAIDA"

echo "limpar-removidos"
novo_ambiente removidos
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
rodar remover 064 --sim
R=$DOUG_CLIENTES_DIR/removidos
mkdir -p "$R/067-loja-lua-20200101-100000/dados" "$R/068-mercado-sol-20200301-100000/dados" "$R/lixo"
echo x >"$R/067-loja-lua-20200101-100000/dados/f"
rodar limpar-removidos
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "--antes" && ok "limpar-removidos sem --antes recusa" || falha "limpar-removidos sem --antes recusa" "$SAIDA"
rodar limpar-removidos --antes 2021-01-01 --dry-run
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "067-loja-lua-20200101-100000" && contem "$SAIDA" "068-mercado-sol-20200301-100000" && ! contem "$SAIDA" "064-padaria-aurora" && [[ -d $R/067-loja-lua-20200101-100000 ]] && ok "--dry-run lista as pastas de antes da data e não apaga" || falha "--dry-run lista as pastas de antes da data e não apaga" "$SAIDA"
echo "não" | "$SCRIPT" limpar-removidos --antes 2021-01-01 >"$TMP/saida" 2>&1
[[ $? != 0 && -d $R/067-loja-lua-20200101-100000 ]] && ok "sem a confirmação, não apaga nada" || falha "sem a confirmação, não apaga nada" "$(cat "$TMP/saida")"
rodar limpar-removidos 067 --antes 2021-01-01 --sim
[[ $CODIGO_SAIDA == 0 && ! -e $R/067-loja-lua-20200101-100000 && -d $R/068-mercado-sol-20200301-100000 ]] && ok "com o código, só as pastas dele" || falha "com o código, só as pastas dele" "$SAIDA $(ls "$R")"
rodar limpar-removidos --antes 2021-01-01 --sim
[[ $CODIGO_SAIDA == 0 && ! -e $R/068-mercado-sol-20200301-100000 && -d $R/lixo ]] && ls "$R"/064-padaria-aurora-* >/dev/null 2>&1 && ok "apaga o que saiu antes da data e guarda o resto (e o que não tem o nome de uma remoção)" || falha "apaga o que saiu antes da data e guarda o resto" "$SAIDA $(ls "$R")"
rodar limpar-removidos --antes 2099-01-01 --sim
[[ $CODIGO_SAIDA == 0 ]] && ! ls "$R"/064-padaria-aurora-* >/dev/null 2>&1 && ok "uma data no futuro leva também a remoção de hoje" || falha "uma data no futuro leva também a remoção de hoje" "$SAIDA"

echo "uid: longe das faixas de subuid e subgid"
novo_ambiente uidfaixa
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
arquivo_tem_linha "$DOUG_CLIENTES_DIR/064-padaria-aurora/.env" '^DOUG_UID=1000000064$' && ok "o padrão de DOUG_UID_BASE é 1000000000 (longe do 100000 de um login)" || falha "o padrão de DOUG_UID_BASE é 1000000000"
printf 'ubuntu:100000:65536\n' >"$DOUG_ETC_DIR/subuid"
log_antes=$(wc -l <"$FAKE_LOG")
DOUG_UID_BASE=100000 rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "subuid" && contem "$SAIDA" "ubuntu" && ok "o uid na faixa de /etc/subuid de um login é recusado (ubuntu:100000:65536)" || falha "o uid na faixa de /etc/subuid de um login é recusado" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/065-cafe-sol && $(wc -l <"$REGISTRO") == 1 ]] && ! tail -n +$((log_antes + 1)) "$FAKE_LOG" | grep -qE ' up |^openssl' && ok "a recusa não cria pasta, nem gera segredo, nem sobe a stack" || falha "a recusa não cria pasta, nem gera segredo, nem sobe a stack"
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$DOUG_CLIENTES_DIR/065-cafe-sol/.env" '^DOUG_UID=1000000065$' && ok "com o padrão (fora da faixa) o mesmo cliente passa" || falha "com o padrão o mesmo cliente passa" "$SAIDA"
: >"$DOUG_ETC_DIR/subuid"
printf 'ubuntu:100000:65536\n' >"$DOUG_ETC_DIR/subgid"
DOUG_UID_BASE=100000 rodar novo 066 loja-lua "Loja Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "subgid" && ok "a faixa de /etc/subgid também recusa" || falha "a faixa de /etc/subgid também recusa" "$SAIDA"
: >"$DOUG_ETC_DIR/subgid"
printf 'svc:x:1000000066:1000000066::/nonexistent:/usr/sbin/nologin\n' >"$DOUG_ETC_DIR/passwd"
rodar novo 066 loja-lua "Loja Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "já é do usuário svc" && ok "um uid que existe em /etc/passwd é recusado" || falha "um uid que existe em /etc/passwd é recusado" "$SAIDA"
rodar novo 067 mercado-sol "Mercado Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "e o uid ao lado, livre, passa" || falha "o uid ao lado, livre, passa" "$SAIDA"
: >"$DOUG_ETC_DIR/passwd"
printf 'svc:x:1000000068:\n' >"$DOUG_ETC_DIR/group"
rodar novo 068 padaria-sol "Padaria Sol" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "grupo svc" && ok "um gid que existe em /etc/group é recusado (o grupo do cliente é o uid)" || falha "um gid que existe em /etc/group é recusado" "$SAIDA"
: >"$DOUG_ETC_DIR/group"
# A borda da faixa: 1000000000..1000000063 é do login, o 064 fica de fora.
printf 'ubuntu:1000000000:64\n' >"$DOUG_ETC_DIR/subuid"
rodar novo 063 loja-sessenta-e-tres "Loja 63" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "1000000063" && ok "o último uid da faixa (base + 63) é recusado" || falha "o último uid da faixa é recusado" "$SAIDA"
rodar novo 069 mercado-lua "Mercado Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "o primeiro uid depois da faixa (base + 64 já dado; base + 69) passa" || falha "o uid depois da faixa passa" "$SAIDA"
: >"$DOUG_ETC_DIR/subuid"
# Outro cliente com o mesmo uid (a base mudou): recusa.
DOUG_UID_BASE=999999999 rodar novo 071 loja-um "Loja Um" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "uma base nova dá uid novo a quem não bate com ninguém (999999999 + 71)" || falha "uma base nova dá uid novo" "$SAIDA"
DOUG_UID_BASE=999999999 rodar novo 070 loja-zero-setenta "Loja 70" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "já é o DOUG_UID do cliente" && ok "o uid que já é o DOUG_UID de outro cliente é recusado" || falha "o uid que já é o DOUG_UID de outro cliente é recusado" "$SAIDA"
# O .env é a fonte: os outros comandos não recalculam.
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
printf 'ubuntu:1000000000:1000\n' >"$DOUG_ETC_DIR/subuid"
: >"$FAKE_CHOWN_LOG"
DOUG_UID_BASE=100000 rodar compose 064
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$P/.env" '^DOUG_UID=1000000064$' && grep -qxF -- "-hR 1000000064:1000000064 $P/dados/files" "$FAKE_CHOWN_LOG" && ok "compose lê o uid do .env: não o recalcula nem o confere de novo (base e subuid mudaram)" || falha "compose lê o uid do .env" "$SAIDA $(cat "$FAKE_CHOWN_LOG")"
awk -F'\t' '$1 != "064"' "$REGISTRO" >"$REGISTRO.x" && mv "$REGISTRO.x" "$REGISTRO"
DOUG_UID_BASE=100000 rodar novo 064 padaria-aurora "Padaria Aurora"
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$P/.env" '^DOUG_UID=1000000064$' && ok "a retomada do novo também lê o uid do .env" || falha "a retomada do novo também lê o uid do .env" "$SAIDA"
sed -i 's/^DOUG_UID=.*/DOUG_UID=4242/' "$P/.env"
: >"$FAKE_CHOWN_LOG"
rodar compose 064
arquivo_tem_linha "$P/.env" '^DOUG_UID=4242$' && grep -qxF -- "-hR 4242:4242 $P/dados/files" "$FAKE_CHOWN_LOG" && ok "o uid que está no .env (4242) é o que vale, em qualquer comando" || falha "o uid do .env é o que vale" "$(cat "$FAKE_CHOWN_LOG")"
# Um .env de antes do uid, no meio de um novo que caiu: o uid conferido entra nele.
grep -v '^DOUG_UID=' "$P/.env" >"$P/.env.t" && cat "$P/.env.t" >"$P/.env" && rm -f "$P/.env.t"
awk -F'\t' '$1 != "064"' "$REGISTRO" >"$REGISTRO.x" && mv "$REGISTRO.x" "$REGISTRO"
: >"$DOUG_ETC_DIR/subuid"
rodar novo 064 padaria-aurora "Padaria Aurora"
[[ $CODIGO_SAIDA == 0 ]] && arquivo_tem_linha "$P/.env" '^DOUG_UID=1000000064$' && [[ $(grep -c '^DOUG_UID=' "$P/.env") == 1 ]] && ok "a retomada de um .env sem DOUG_UID grava o uid conferido, uma vez" || falha "a retomada de um .env sem DOUG_UID grava o uid conferido" "$SAIDA"
# A base: só número, na faixa.
DOUG_UID_BASE=1000 rodar lista
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "fora da faixa" && ok "DOUG_UID_BASE abaixo de 65536 é recusado" || falha "DOUG_UID_BASE abaixo de 65536 é recusado" "$SAIDA"
DOUG_UID_BASE=4294967290 rodar lista
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "fora da faixa" && ok "DOUG_UID_BASE que estoura o uid de 32 bits com o código 255 é recusado" || falha "DOUG_UID_BASE que estoura o uid de 32 bits é recusado" "$SAIDA"
DOUG_UID_BASE='1e9' rodar lista
[[ $CODIGO_SAIDA != 0 ]] && ok "DOUG_UID_BASE que não é número é recusado" || falha "DOUG_UID_BASE que não é número é recusado" "$SAIDA"
# A base na conf de root.
novo_ambiente uidconf
mkdir -p "$DOUG_CLIENTES_DIR"
printf 'DOUG_UID_BASE=2000000000\n' >"$DOUG_CLIENTES_DIR/doug-cliente.conf"
chmod 600 "$DOUG_CLIENTES_DIR/doug-cliente.conf"
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
arquivo_tem_linha "$DOUG_CLIENTES_DIR/064-padaria-aurora/.env" '^DOUG_UID=2000000064$' && ok "DOUG_UID_BASE vale na conf de root" || falha "DOUG_UID_BASE vale na conf de root" "$SAIDA"

echo "religar-proxy: tenta todos, recarrega sempre e lista os que falharam"
novo_ambiente religa
modo_externo
mkdir -p "$DOUG_CLIENTES_DIR"
export DOUG_PROXY_RELOAD="echo recarregou >>$A/proxy.log"
printf '%s\t%s\tNome\t%s\timagem\t2026-11-17T00:00:00Z\n' 064 padaria-aurora 47100 065 cafe-sol 47101 066 loja-lua 47102 067 mercado-sol 47103 >"$REGISTRO"
cria_rede 064
liga_na_rede 064 proxy-teste
cria_rede 066
cria_rede 067
# 064: já ligado. 065: sem rede. 066: a ligação falha. 067: liga.
FAKE_CONNECT_FAIL_REDE=doug-066 rodar religar-proxy
[[ $CODIGO_SAIDA != 0 ]] && ok "religar-proxy sai com código diferente de 0 se algum cliente ficou de fora" || falha "religar-proxy sai com código diferente de 0 se algum cliente ficou de fora" "$SAIDA"
esta_na_rede 067 proxy-teste && ok "um cliente com problema antes dele não impede ligar o 067 (tenta todos)" || falha "um cliente com problema antes dele não impede ligar o 067" "$SAIDA"
contem "$SAIDA" "a rede doug-065 de cafe-sol não existe" && ok "o cliente sem rede é pulado com aviso" || falha "o cliente sem rede é pulado com aviso" "$SAIDA"
contem "$SAIDA" "065-cafe-sol (sem rede)" && contem "$SAIDA" "066-loja-lua (não liga)" && ! contem "$SAIDA" "064-padaria-aurora (" && ok "a lista final nomeia os que falharam (e só eles)" || falha "a lista final nomeia os que falharam" "$SAIDA"
! arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.64.2" && arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.67.2 doug-067 proxy-teste" && ok "inspect por rede: o 064, já ligado, não é ligado de novo; o 067, que não estava, é" || falha "inspect por rede" "$(grep network "$FAKE_LOG")"
[[ $(grep -c recarregou "$A/proxy.log") == 1 ]] && ok "o proxy é recarregado mesmo com clientes de fora" || falha "o proxy é recarregado mesmo com clientes de fora" "$(cat "$A/proxy.log" 2>&1)"
cria_rede 065
: >"$FAKE_LOG"
rodar religar-proxy
[[ $CODIGO_SAIDA == 0 ]] && esta_na_rede 065 proxy-teste && esta_na_rede 066 proxy-teste && ! arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.64.2" && ! arquivo_contem "$FAKE_LOG" "network connect --ip 10.64.67.2" && ok "com todas as redes de pé, liga o que falta, não repete o que existe e sai com 0" || falha "com todas as redes de pé, liga o que falta e sai com 0" "$SAIDA"
# O proxy parado.
esvazia_redes
: >"$FAKE_LOG"
: >"$A/proxy.log"
FAKE_PROXY_PARADO=1 rodar religar-proxy
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não está rodando" && ! arquivo_contem "$FAKE_LOG" "network connect" && [[ ! -s $A/proxy.log ]] && ok "com o proxy parado: erro claro, nada ligado e nada recarregado" || falha "com o proxy parado: erro claro" "$SAIDA"
# Todos falham: ainda recarrega, e sai com erro.
FAKE_CONNECT_FAIL=1 rodar religar-proxy
[[ $CODIGO_SAIDA != 0 && -s $A/proxy.log ]] && contem "$SAIDA" "4 clientes ficaram de fora" && ok "se nenhuma ligação vale, tenta as quatro, recarrega e diz as quatro" || falha "se nenhuma ligação vale, tenta as quatro, recarrega e diz as quatro" "$SAIDA"
rodar religar-proxy --dry-run
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "[simulação]" && ok "religar-proxy --dry-run só mostra" || falha "religar-proxy --dry-run só mostra" "$SAIDA"

echo "iniciar e compose religam o proxy (modo externo)"
novo_ambiente liga3
modo_externo
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
esvazia_redes
rodar iniciar 064
[[ $CODIGO_SAIDA == 0 ]] && esta_na_rede 064 proxy-teste && ok "iniciar liga o proxy à rede (o contêiner do proxy foi recriado)" || falha "iniciar liga o proxy à rede" "$SAIDA"
: >"$FAKE_LOG"
rodar iniciar 064
[[ $CODIGO_SAIDA == 0 ]] && ! arquivo_contem "$FAKE_LOG" "network connect" && ok "com o proxy ligado, iniciar não liga de novo (idempotente)" || falha "com o proxy ligado, iniciar não liga de novo" "$SAIDA"
esvazia_redes
rodar compose 064
[[ $CODIGO_SAIDA == 0 ]] && esta_na_rede 064 proxy-teste && ok "compose liga o proxy à rede" || falha "compose liga o proxy à rede" "$SAIDA"
rm -f "$FAKE_REDES/doug-064"
: >"$FAKE_LOG"
rodar compose 064
[[ $CODIGO_SAIDA == 0 ]] && ! arquivo_contem "$FAKE_LOG" "network connect" && ok "compose de um cliente sem rede (parado e derrubado) não falha nem liga nada" || falha "compose de um cliente sem rede" "$SAIDA"
DOUG_PROXY_CONTAINER="" rodar iniciar 064
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "DOUG_PROXY_CONTAINER" && ok "iniciar no modo externo precisa do nome do contêiner do proxy" || falha "iniciar no modo externo precisa do nome do contêiner do proxy" "$SAIDA"

echo "iniciar: o up que muda a sub-rede pede o proxy fora da rede"
novo_ambiente ipam
modo_externo
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
: >"$FAKE_LOG"
FAKE_UP_FALHA_COM_PROXY=1 rodar iniciar 064
up1=$(grep -n 'compose -p doug-064 .* up -d$' "$FAKE_LOG" | sed -n 1p | cut -d: -f1)
dis=$(grep -n 'network disconnect doug-064 proxy-teste' "$FAKE_LOG" | head -1 | cut -d: -f1)
up2=$(grep -n 'compose -p doug-064 .* up -d$' "$FAKE_LOG" | sed -n 2p | cut -d: -f1)
con=$(grep -n 'network connect --ip 10.64.64.2 doug-064 proxy-teste' "$FAKE_LOG" | tail -1 | cut -d: -f1)
[[ $CODIGO_SAIDA == 0 && -n $up1 && -n $dis && -n $up2 && -n $con ]] && ((up1 < dis && dis < up2 && up2 < con)) && esta_na_rede 064 proxy-teste && ok "up falha com o proxy ligado: desliga, sobe de novo e liga o proxy (proxy_desliga e proxy_liga ao redor do up)" || falha "up falha com o proxy ligado: desliga, sobe de novo e liga" "$SAIDA | $up1 $dis $up2 $con"
FAKE_UP_FALHA=1 rodar iniciar 064
[[ $CODIGO_SAIDA != 0 ]] && esta_na_rede 064 proxy-teste && contem "$SAIDA" "religar-proxy" && ok "se o up não sobe de jeito nenhum, o proxy volta à rede e o erro cita o religar-proxy" || falha "se o up não sobe, o proxy volta à rede" "$SAIDA"

echo "proxy: o proxy enxerga o arquivo do site (caddy adapt)"
novo_ambiente adapt
modo_externo
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
rel=$(grep -n 'caddy reload' "$FAKE_LOG" | head -1 | cut -d: -f1)
ada=$(grep -n 'exec proxy-teste caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile' "$FAKE_LOG" | head -1 | cut -d: -f1)
[[ -n $rel && -n $ada ]] && ((rel < ada)) && ok "depois do reload, roda docker exec <proxy> caddy adapt --config <Caddyfile do contêiner> --adapter caddyfile" || falha "depois do reload, roda o caddy adapt" "$rel $ada"
export DOUG_PROXY_CADDYFILE=/config/Caddyfile
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
arquivo_contem "$FAKE_LOG" "caddy adapt --config /config/Caddyfile --adapter caddyfile" && ok "o caminho do Caddyfile do contêiner é configurável (DOUG_PROXY_CADDYFILE)" || falha "o caminho do Caddyfile do contêiner é configurável"
unset DOUG_PROXY_CADDYFILE
DOUG_PROXY_CADDYFILE='/a b' rodar lista
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "DOUG_PROXY_CADDYFILE" && ok "um DOUG_PROXY_CADDYFILE que não é um caminho simples é recusado" || falha "um DOUG_PROXY_CADDYFILE que não é um caminho simples é recusado" "$SAIDA"
FAKE_ADAPT_CEGO=1 rodar novo 066 loja-lua "Loja Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não enxerga loja-lua.dougbot.app" && [[ ! -e $DOUG_PROXY_SITES_DIR/loja-lua.caddy ]] && ! grep -q '^066' "$REGISTRO" && ok "o proxy que não lista o host depois do reload: o arquivo é desfeito e o cliente não é registrado" || falha "o proxy que não lista o host: desfaz e não registra" "$SAIDA"
FAKE_ADAPT_FALHA=1 rodar novo 066 loja-lua "Loja Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 && ! -e $DOUG_PROXY_SITES_DIR/loja-lua.caddy ]] && ! grep -q '^066' "$REGISTRO" && ok "o caddy adapt que falha também desfaz" || falha "o caddy adapt que falha também desfaz" "$SAIDA"
rodar novo 066 loja-lua "Loja Lua" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && grep -q '^066' "$REGISTRO" && ok "depois de acertar o proxy, rodar de novo conclui" || falha "depois de acertar o proxy, rodar de novo conclui" "$SAIDA"
# Um arquivo que já existia volta ao que era.
SITE=$DOUG_PROXY_SITES_DIR/padaria-aurora.caddy
echo "# marca do teste" >>"$SITE"
cp "$SITE" "$A/site-antes"
awk -F'\t' '$1 != "064"' "$REGISTRO" >"$REGISTRO.x" && mv "$REGISTRO.x" "$REGISTRO"
FAKE_ADAPT_CEGO=1 rodar novo 064 padaria-aurora "Padaria Aurora"
[[ $CODIGO_SAIDA != 0 ]] && cmp -s "$SITE" "$A/site-antes" && ok "um arquivo de site que já existia volta ao conteúdo de antes" || falha "um arquivo de site que já existia volta ao conteúdo de antes" "$SAIDA"
novo_ambiente adapt-proprio
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
! arquivo_contem "$FAKE_LOG" "caddy adapt" && ok "no modo próprio não há o que adaptar: o Caddy é o do repositório" || falha "no modo próprio não há o que adaptar"

echo "remover: falha depois de parar o servidor religa o servidor"
novo_ambiente rem7
modo_externo
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
echo conteudo >"$P/dados/files/n.txt"
: >"$FAKE_LOG"
FAKE_TAR_FAIL=1 rodar remover 064 --apagar-dados --sim
st=$(grep -n 'compose -p doug-064 .* stop agentes$' "$FAKE_LOG" | head -1 | cut -d: -f1)
vo=$(grep -n 'compose -p doug-064 .* up -d agentes$' "$FAKE_LOG" | tail -1 | cut -d: -f1)
[[ $CODIGO_SAIDA != 0 && -n $st && -n $vo ]] && ((st < vo)) && ! grep -q 'compose -p doug-064 .* down' "$FAKE_LOG" && ok "tar que falha com --apagar-dados: o servidor é religado (up -d agentes) e nada é derrubado" || falha "tar que falha: o servidor é religado" "$SAIDA | $st $vo"
contem "$SAIDA" "religuei o servidor" && contem "$SAIDA" "nada foi removido" && ok "a mensagem diz o que aconteceu: religou e nada foi removido" || falha "a mensagem diz o que aconteceu" "$SAIDA"
[[ -f $P/dados/files/n.txt && -d $P && -f $DOUG_PROXY_SITES_DIR/padaria-aurora.caddy ]] && grep -q '^064' "$REGISTRO" && esta_na_rede 064 proxy-teste && ok "a pasta, o site, o registro e a ligação do proxy ficam como estavam" || falha "a pasta, o site, o registro e a ligação do proxy ficam como estavam"
! ls "$DOUG_CLIENTES_DIR"/backups/064/*-files.tar* >/dev/null 2>&1 && ok "o tar que falhou não deixa arquivo (nem .parcial)" || falha "o tar que falhou não deixa arquivo" "$(ls "$DOUG_CLIENTES_DIR/backups/064")"
: >"$FAKE_LOG"
FAKE_DOWN_FAIL=1 rodar remover 064 --sim
dw=$(grep -n 'compose -p doug-064 .* down' "$FAKE_LOG" | head -1 | cut -d: -f1)
vo=$(grep -n 'compose -p doug-064 .* up -d agentes$' "$FAKE_LOG" | tail -1 | cut -d: -f1)
[[ $CODIGO_SAIDA != 0 && -n $dw && -n $vo ]] && ((dw < vo)) && contem "$SAIDA" "religuei o servidor" && ok "o down que falha também religa o servidor" || falha "o down que falha também religa o servidor" "$SAIDA | $dw $vo"
esta_na_rede 064 proxy-teste && [[ -f $DOUG_PROXY_SITES_DIR/padaria-aurora.caddy ]] && grep -q '^064' "$REGISTRO" && ok "o proxy, desligado da rede para o down, volta a ela; o site e o registro ficam" || falha "o proxy volta à rede depois do down que falhou"
FAKE_DOWN_FAIL=1 FAKE_UP_AGENTES_FALHA=1 rodar remover 064 --sim
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "NÃO consegui religar o servidor de 064" && contem "$SAIDA" "doug-cliente iniciar 064" && ok "se nem religar dá, a mensagem diz que o servidor continua parado e o que fazer" || falha "se nem religar dá, a mensagem diz que o servidor continua parado" "$SAIDA"
rodar remover 064 --sim
[[ $CODIGO_SAIDA == 0 ]] && ! contem "$SAIDA" "religando-o" && ok "uma remoção que dá certo não religa nada" || falha "uma remoção que dá certo não religa nada" "$SAIDA"

echo "chown: o ramo root"
novo_ambiente root8
FAKE_ID_ROOT=1 rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
grep -qF "root:root $P $P/dados $P/compose.yml $P/.env" "$FAKE_CHOWN_LOG" && grep -qxF "1000000064:1000000064 $P/dados/files" "$FAKE_CHOWN_LOG" && ok "como root: a pasta, dados/, o compose.yml e o .env vão a root:root e dados/files ao uid do cliente" || falha "como root: os chown" "$SAIDA $(cat "$FAKE_CHOWN_LOG")"
! grep -q -- '-hR' "$FAKE_CHOWN_LOG" && ok "o novo não faz chown recursivo (a pasta é nova)" || falha "o novo não faz chown recursivo"
: >"$FAKE_CHOWN_LOG"
FAKE_ID_ROOT=1 rodar compose 064
grep -qxF -- "-hR 1000000064:1000000064 $P/dados/files" "$FAKE_CHOWN_LOG" && grep -qF "root:root $P $P/dados" "$FAKE_CHOWN_LOG" && ok "como root, o compose passa todo o dados/files ao uid do .env (chown -hR: um cliente com os dados de outro uid fica certo)" || falha "como root, o compose faz chown -hR" "$SAIDA $(cat "$FAKE_CHOWN_LOG")"
FAKE_ID_ROOT=1 FAKE_CHOWN_FAIL=1 rodar compose 064
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não consegui dar" && ok "como root, um chown que falha para o comando (não é ignorado)" || falha "como root, um chown que falha para o comando" "$SAIDA"
FAKE_CHOWN_FAIL=1 rodar compose 064
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "sem root" && ok "sem root, o chown que falha só avisa" || falha "sem root, o chown que falha só avisa" "$SAIDA"

echo "sub-rede: colisão antes de criar a pasta"
novo_ambiente subrede
FAKE_NET_LS="abc" FAKE_NET_SUBNETS="redefoo 10.64.0.0/16" rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "colide" && contem "$SAIDA" "redefoo" && ok "a sub-rede dentro de uma rede do Docker existente (10.64.0.0/16) é recusada" || falha "a sub-rede dentro de uma rede do Docker é recusada" "$SAIDA"
[[ ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora && ! -s $REGISTRO ]] && ! grep -qE ' up |^openssl' "$FAKE_LOG" && ok "a recusa vem antes de criar a pasta, gerar segredo ou subir" || falha "a recusa vem antes de criar a pasta"
FAKE_NET_LS="abc" FAKE_NET_SUBNETS="pequena 10.64.64.128/25" rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234 --dry-run
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "pequena" && ok "uma rede menor dentro da faixa colide, e o --dry-run também recusa" || falha "uma rede menor dentro da faixa colide" "$SAIDA"
FAKE_NET_LS="abc" FAKE_NET_SUBNETS=$'bridge 172.17.0.0/16\noutra 10.64.65.0/24\nv6 fd00::/64\nduas 10.65.0.0/16 10.66.0.0/16' rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234 --dry-run
[[ $CODIGO_SAIDA == 0 ]] && ok "redes vizinhas, IPv6 e outras faixas não atrapalham" || falha "redes vizinhas, IPv6 e outras faixas não atrapalham" "$SAIDA"
FAKE_IP_ROUTE=$'default via 10.0.0.1 dev eth0\n10.64.64.0/24 dev tun0 scope link' rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "rota 10.64.64.0/24" && [[ ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora ]] && ok "uma rota da máquina (VPN, rede do provedor) sobre a sub-rede é recusada" || falha "uma rota da máquina sobre a sub-rede é recusada" "$SAIDA"
FAKE_IP_ROUTE=$'10.0.0.0/8 via 192.0.2.1 dev eth1' rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "10.0.0.0/8" && ok "uma rota mais larga (10.0.0.0/8) também colide" || falha "uma rota mais larga também colide" "$SAIDA"
FAKE_IP_ROUTE=$'10.64.65.0/24 dev tun0\n10.64.0.1 dev tun1' rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "uma rota para outro código (10.64.65.0/24) e um host de outra faixa não colidem" || falha "uma rota para outro código não colide" "$SAIDA"
# Retomada: a rede do próprio cliente já existe (ela é quem ocupa a faixa).
novo_ambiente subrede2
cria_rede 064
FAKE_NET_LS="abc" FAKE_NET_SUBNETS="doug-064 10.64.64.0/24" FAKE_IP_ROUTE="10.64.64.0/24 dev br-abcdef" rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
[[ $CODIGO_SAIDA == 0 ]] && ok "a rede doug-<código> que já existe é a do próprio cliente: a retomada não colide com ela" || falha "a retomada não colide com a rede do próprio cliente" "$SAIDA"

echo "menores: alias, pasta dos sites, grupo do proxy, documentação"
novo_ambiente menores2
modo_externo
arquivo_contem "$SWAS/compose.cliente.yml" 'aliases: ["doug-${DOUG_CLIENT_CODE}-agentes"]' && ok "o compose dá ao servidor um alias fixo com o código na rede do cliente" || falha "o compose dá ao servidor um alias fixo"
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
arquivo_contem "$DOUG_PROXY_SITES_DIR/padaria-aurora.caddy" "reverse_proxy doug-064-agentes:3000" && ! arquivo_contem "$DOUG_PROXY_SITES_DIR/padaria-aurora.caddy" "agentes-1" && ok "o upstream é o alias, não o nome do contêiner que o Compose escolhe" || falha "o upstream é o alias"
export DOUG_PROXY_SITES_DIR=$A/sites-grupo DOUG_PROXY_SITES_GRUPO=proxygrp
rodar novo 065 cafe-sol "Café Sol" --imagem agentes-zim:doug-abc1234
[[ $(stat -c %a "$DOUG_PROXY_SITES_DIR") == 750 && $(stat -c %a "$DOUG_PROXY_SITES_DIR/cafe-sol.caddy") == 640 ]] && grep -qF "root:proxygrp $DOUG_PROXY_SITES_DIR $DOUG_PROXY_SITES_DIR/cafe-sol.caddy" "$FAKE_CHOWN_LOG" && ok "com DOUG_PROXY_SITES_GRUPO a pasta é 750 e o arquivo 640, de root:<grupo> (só root e o grupo do proxy)" || falha "com DOUG_PROXY_SITES_GRUPO a pasta é 750 e o arquivo 640" "$(stat -c %a "$DOUG_PROXY_SITES_DIR") $(cat "$FAKE_CHOWN_LOG")"
DOUG_PROXY_SITES_GRUPO='a b' rodar lista
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "DOUG_PROXY_SITES_GRUPO" && ok "um grupo inválido é recusado" || falha "um grupo inválido é recusado" "$SAIDA"
README=$SWAS/README.md
arquivo_contem "$README" "## A porta de loopback" && arquivo_contem "$README" "X-Forwarded-For" && arquivo_contem "$README" "TRUSTED_PROXIES" && ok "o README diz a verdade sobre a porta de loopback e o TRUSTED_PROXIES" || falha "o README diz a verdade sobre a porta de loopback"
arquivo_contem "$MODELO" "qualquer login da máquina" && arquivo_contem "$MODELO" "X-Forwarded-For" && ok "o cliente.env.example avisa que a porta de loopback fala com qualquer login" || falha "o cliente.env.example avisa sobre a porta de loopback"
arquivo_contem "$README" "ligado à rede de todos os clientes" && arquivo_contem "$README" "limpar-removidos" && arquivo_contem "$README" "caddy adapt" && arquivo_contem "$README" "DOUG_UID_BASE" && ok "o README fala do proxy em todas as redes, do limpar-removidos, do caddy adapt e do DOUG_UID_BASE" || falha "o README fala dos itens novos"
! arquivo_contem "$README" "100000 + o código" && ok "o README não diz mais 100000 + o código" || falha "o README não diz mais 100000 + o código"

echo "contrato com o doug-atualizar-clientes"
novo_ambiente contrato
modo_externo
rodar novo 064 padaria-aurora "Padaria Aurora" --imagem agentes-zim:doug-abc1234
P=$DOUG_CLIENTES_DIR/064-padaria-aurora
IFS=$'\t' read -r c s n porta_reg i d <"$REGISTRO"
arquivo_contem "$P/compose.yml" '"127.0.0.1:${DOUG_HOST_PORT:?' && arquivo_tem_linha "$P/.env" "^DOUG_HOST_PORT=$porta_reg$" && ok "a porta em 127.0.0.1 e DOUG_HOST_PORT no .env são a porta do clientes.tsv, também no modo externo" || falha "a porta de loopback e DOUG_HOST_PORT batem com o clientes.tsv" "$porta_reg"
[[ -f $DOUG_CLIENTES_DIR/.lock && $(stat -c %a "$DOUG_CLIENTES_DIR/.lock") == 600 ]] && ok "a trava é <raiz>/.lock (600)" || falha "a trava é <raiz>/.lock"
rodar backup 064
ls "$DOUG_CLIENTES_DIR"/backups/064/*.dump >/dev/null 2>&1 && ! ls "$DOUG_CLIENTES_DIR"/backups/064/pre-* "$DOUG_CLIENTES_DIR"/backups/064/falhou-* >/dev/null 2>&1 && ok "os backups ficam em <raiz>/backups/<codigo>/ e os nomes pre-* e falhou-* são só do atualizador" || falha "os backups ficam em <raiz>/backups/<codigo>/"
[[ $(stat -c %a "$P") == 711 && $(stat -c %a "$P/compose.yml") == 644 && $(stat -c %a "$P/.env") == 600 ]] && ok "a pasta do cliente, o compose.yml e o .env sem escrita para grupo e outros (e do root, em produção)" || falha "a pasta do cliente, o compose.yml e o .env sem escrita para grupo e outros"

echo "ajuda"
rodar ajuda
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "doug-cliente novo" && ok "ajuda mostra os comandos" || falha "ajuda mostra os comandos"
rodar abacate
[[ $CODIGO_SAIDA != 0 ]] && ok "comando desconhecido falha" || falha "comando desconhecido falha"

echo
if ((FALHAS == 0)); then
  printf '%d testes, todos passaram\n' "$TESTES"
else
  printf '%d testes, %d falharam\n' "$TESTES" "$FALHAS"
  exit 1
fi
