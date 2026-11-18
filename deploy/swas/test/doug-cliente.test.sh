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
# docker falso: anota a chamada e responde o que o doug-cliente pergunta.
printf '%s\n' "$*" >>"$FAKE_LOG"
case "$*" in
  "compose version"*) echo "Docker Compose version v2.30.0" ;;
  "images "*) echo "agentes-zim:doug-abc1234" ;;
  "image inspect "*) [[ -z ${FAKE_NO_IMAGE:-} ]] || exit 1 ;;
  *" ps "*) for ((i = 0; i < ${FAKE_RUNNING:-2}; i++)); do echo "contêiner$i"; done ;;
  *"pg_isready"*) ;;
  *"pg_dump"*) [[ -z ${FAKE_DUMP_FAIL:-} ]] || exit 1; printf 'PGDMP falso\n' ;;
  *"caddy reload"*) [[ -z ${FAKE_CADDY_FAIL:-} ]] || exit 1 ;;
esac
exit 0
EOF
cat >"$BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >>"$FAKE_LOG"
[[ -z ${FAKE_HEALTH_FAIL:-} ]]
EOF
cat >"$BIN/openssl" <<'EOF'
#!/usr/bin/env bash
# openssl falso: cada segredo sai diferente e previsível, com / e + para testar o preenchimento.
printf 'openssl %s\n' "$*" >>"$FAKE_LOG"
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
chmod +x "$BIN"/*

# Um ambiente novo por grupo de testes: raiz dos clientes, Caddy e registros próprios.
novo_ambiente() {
  A=$TMP/amb-$1
  rm -rf "$A"
  mkdir -p "$A/caddy/clientes"
  export DOUG_CLIENTES_DIR=$A/clientes
  export DOUG_CADDY_DIR=$A/caddy
  export FAKE_LOG=$A/docker.log
  export FAKE_CONTADOR=$A/contador
  : >"$FAKE_LOG"
  unset FAKE_NO_IMAGE FAKE_HEALTH_FAIL FAKE_CADDY_FAIL FAKE_DUMP_FAIL FAKE_RUNNING
  export DOUG_CLIENT_QUOTA_GB=1
  export DOUG_PORTA_INICIAL=47100
  export DOUG_PORTA_FINAL=47199
  export DOUG_HEALTH_TIMEOUT=2
  export DOUG_HEALTH_INTERVALO=0
  REGISTRO=$DOUG_CLIENTES_DIR/clientes.tsv
}

PATH=$BIN:$PATH

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
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "Caddy não aceitou" && ok "falha se o Caddy não recarrega" || falha "falha se o Caddy não recarrega" "$SAIDA"
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
B=$(ls "$DOUG_CLIENTES_DIR"/backups/064-padaria-aurora-*.dump 2>/dev/null | head -1)
[[ -n $B && $(stat -c %a "$B") == 600 && $(cat "$B") == "PGDMP falso" ]] && ok "backup grava o dump (chmod 600)" || falha "backup grava o dump" "$SAIDA"

echo "remover"
rodar remover 064 <<<"não é o slug"
[[ $CODIGO_SAIDA != 0 ]] && contem "$SAIDA" "não confirmado" && ok "remover sem confirmação não faz nada" || falha "remover sem confirmação não faz nada" "$SAIDA"
[[ -d $DOUG_CLIENTES_DIR/064-padaria-aurora && $(grep -c '^064' "$REGISTRO") == 1 ]] && ok "o cliente continua depois da recusa" || falha "o cliente continua depois da recusa"
rodar remover 064 --dry-run
[[ $CODIGO_SAIDA == 0 ]] && contem "$SAIDA" "[simulação]" && [[ -d $DOUG_CLIENTES_DIR/064-padaria-aurora ]] && ok "remover --dry-run só mostra" || falha "remover --dry-run só mostra" "$SAIDA"
rm -f "$DOUG_CLIENTES_DIR"/backups/*
echo "padaria-aurora" | "$SCRIPT" remover 064 >"$TMP/saida" 2>&1
CODIGO_SAIDA=$?
SAIDA=$(cat "$TMP/saida")
[[ $CODIGO_SAIDA == 0 ]] && ok "remover com a confirmação certa termina bem" || falha "remover com a confirmação certa termina bem" "$SAIDA"
ls "$DOUG_CLIENTES_DIR"/backups/064-padaria-aurora-*.dump >/dev/null 2>&1 && ok "remover faz o backup do banco antes" || falha "remover faz o backup do banco antes"
[[ ! -e $DOUG_CLIENTES_DIR/064-padaria-aurora ]] && ok "a pasta saiu do lugar" || falha "a pasta saiu do lugar"
ls -d "$DOUG_CLIENTES_DIR"/removidos/064-padaria-aurora-*/dados/files >/dev/null 2>&1 && ok "sem --apagar-dados, dados/ fica guardado" || falha "sem --apagar-dados, dados/ fica guardado"
! grep -q '^064' "$REGISTRO" && grep -q '^065' "$REGISTRO" && ok "tirou só o 064 do clientes.tsv" || falha "tirou só o 064 do clientes.tsv"
[[ ! -e $DOUG_CADDY_DIR/clientes/padaria-aurora.caddy ]] && [[ -e $DOUG_CADDY_DIR/clientes/cafe-sol.caddy ]] && ok "tirou só o 064 do Caddy" || falha "tirou só o 064 do Caddy"
arquivo_tem_linha "$FAKE_LOG" '^compose -p doug-064 .* down' && ok "derrubou a stack do cliente" || falha "derrubou a stack do cliente"
# O backup vem antes de derrubar.
dump_linha=$(grep -n 'pg_dump' "$FAKE_LOG" | tail -1 | cut -d: -f1)
down_linha=$(grep -n ' down' "$FAKE_LOG" | tail -1 | cut -d: -f1)
((dump_linha < down_linha)) && ok "o backup acontece antes de derrubar" || falha "o backup acontece antes de derrubar"
# Backup que falha: não remove.
FAKE_DUMP_FAIL=1 rodar remover 065 --sim
[[ $CODIGO_SAIDA != 0 && -d $DOUG_CLIENTES_DIR/065-cafe-sol ]] && grep -q '^065' "$REGISTRO" && ok "se o backup falha, nada é removido" || falha "se o backup falha, nada é removido" "$SAIDA"
# --apagar-dados.
echo "APAGAR cafe-sol" | "$SCRIPT" remover 065 --apagar-dados >"$TMP/saida" 2>&1
CODIGO_SAIDA=$?
[[ $CODIGO_SAIDA == 0 && ! -e $DOUG_CLIENTES_DIR/065-cafe-sol ]] && ok "--apagar-dados apaga a pasta" || falha "--apagar-dados apaga a pasta" "$(cat "$TMP/saida")"
E=$(ls "$DOUG_CLIENTES_DIR"/backups/065-cafe-sol-*.env 2>/dev/null | head -1)
[[ -n $E ]] && arquivo_tem_linha "$E" '^AGENTES_SECRET=' && ok "--apagar-dados guarda o .env ao lado do backup" || falha "--apagar-dados guarda o .env ao lado do backup"
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
