import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "doug-atualizar-clientes");
const dir = mkdtempSync(join(tmpdir(), "doug-atualizar-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** An executable stand-in on a PATH of its own. */
function stub(bin: string, name: string, body: string) {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), body);
  chmodSync(join(bin, name), 0o755);
}

// A docker that only knows the calls the script makes (always `compose -p … --project-directory … -f … --env-file …`),
// a curl that answers each client's /api/health and /api/openapi.json (by the published port) and a docker `compose exec`
// that answers the same from inside the container (no published port); both go through `apistub`. A systemctl, an awk
// that can fail and a df whose free space the test sets. The state folder says what exists and what happens, one file
// per fact:
//   images            names that exist, one per line
//   principal         the image the main instance's container runs
//   principal-state   what `systemctl is-active` says about the main instance's update
//   port-<porta>      the folder that owns that port
//   running-<pasta>   the image `up -d` last started; ps-<pasta> says another one to `compose ps`
//   signaled-<pasta> the server's restart hold (apps/server/src/restart-hold.ts): the time, in ms, of the SIGUSR2 that
//                     started it. While it holds (`aviso-prazo-ms`, 30 min by default), `restart` shows in /api/health
//                     and a second SIGUSR2 does nothing; after it, the key is gone and a signal is accepted again.
//                     Cleared by `up -d` and `restart` (a new container holds nothing). `signals` logs each signal as
//                     accepted or ignored
//   unhealthy         lines `<pasta> <imagem>` that never get healthy
//   script-<pasta>    one health answer per line, used first: fail, waiting, ready, plain
//   openapi-<pasta>   one answer of /api/openapi.json per line, used first: fail (curl's timeout), partial, plain
//   never-ready, ignora-sinal, no-adr, dump-fails, migrate-fails, parado, ps-quebrado   folders (one per line)
//   slow-up           the next `up -d` takes a while, once; slow-up-<n>: the n-th `up -d` of a client does
//   up-falha-<n>      the n-th `up -d` of a client is refused (stderr says why)
//   migrate-sinal     the migration drops the restart hold (the 30 minutes ran out); migrate-sinal-ignora: and the server
//                     then ignores the signal, so `ready` never comes back
//   removidos         the containers `docker rm -f` was asked to remove
//   slow-dump         the next pg_dump takes a while, once; slow-migrate: the same for the migration
//   dump-count        what each pg_dump found in the client's backups folder (the .dump files), one number per line
//   stdin-calls       what every compose call had as stdin
//   df-livre-kb       the free KB that `df` says
//   awk-falha         the awk that rewrites the registry fails
//   tira-do-registro  a codigo that the next `up -d` takes out of the registry (a `remover` in the middle of a round)
//   curl-calls        what curl was asked (a client with no published port never reaches it)
const docker = `#!/usr/bin/env bash
state=$STUB_STATE
here=-
if [[ $1 == compose && $2 == -p ]]; then
  here=$(basename "$5"); dir=$5
  set -- compose "\${@:10}"
fi
printf '%s\\n' "docker[$here] $*" >>"$state/calls"
if [[ $here != - ]]; then printf '%s\\n' "$* stdin=$(readlink /proc/$$/fd/0)" >>"$state/stdin-calls"; fi
now=$(( $(date +%s%N) / 1000000 ))
case "$*" in
"image inspect "*) grep -qx "$3" "$state/images" ;;
"inspect --format {{.Config.Image}} agentes-chat-agentes-1") cat "$state/principal" 2>/dev/null || exit 1 ;;
"compose kill -s SIGUSR2 agentes")
  if [[ -e $state/kill-falha-depois && -s $state/signals ]]; then echo "Error: container is not running" >&2; exit 1; fi
  prazo=$(cat "$state/aviso-prazo-ms" 2>/dev/null || echo 1800000)
  if [[ -s $state/signaled-$here ]] && (( now < $(cat "$state/signaled-$here") + prazo )); then
    echo "ignorado" >>"$state/signals"
  else
    echo "$now" >"$state/signaled-$here"; echo "aceito" >>"$state/signals"
  fi
  echo "stub-kill: SIGUSR2 entregue" ;;
"compose restart agentes") rm -f "$state/signaled-$here"; echo "stub-restart: reiniciado" ;;
"compose ps --status running -q")
  if grep -qx "$here" "$state/ps-quebrado" 2>/dev/null; then exit 1; fi
  grep -qx "$here" "$state/parado" 2>/dev/null || echo "cid-$here" ;;
"compose exec -T agentes bun -e "*)
  path=/api/health
  [[ $* == *"/api/openapi.json"* ]] && path=/api/openapi.json
  apistub "$here" "$path" ;;
"compose exec -T postgres pg_dump -Fc -U agentes agentes")
  if grep -qx "$here" "$state/dump-fails" 2>/dev/null; then echo "pg_dump: erro" >&2; exit 1; fi
  ls "$DOUG_CLIENTES_DIR/backups/\${here%%-*}" 2>/dev/null | grep -c '[.]dump$' >>"$state/dump-count" || true
  if [[ -e $state/slow-dump ]]; then rm -f "$state/slow-dump"; touch "$state/dump-started"; sleep 1.5; fi
  echo "PGDMP de $here" ;;
"compose up -d")
  n=$(( $(cat "$state/up-count-$here" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$state/up-count-$here"
  if [[ -e $state/up-falha-$n ]]; then echo "Error response from daemon: port is already allocated" >&2; exit 1; fi
  if [[ -e $state/slow-up ]]; then rm -f "$state/slow-up"; touch "$state/up-started"; sleep 1.5; fi
  if [[ -e $state/slow-up-$n ]]; then rm -f "$state/slow-up-$n"; touch "$state/up-started-$n"; sleep 1.5; fi
  sed -nE 's/^(export +)?DOUG_IMAGE=//p' "$dir/.env" | tail -n1 | tr -d "\\"'" >"$state/running-$here"
  rm -f "$state/signaled-$here"
  if [[ -s $state/tira-do-registro ]]; then
    grep -v "^$(cat "$state/tira-do-registro")"$'\\t' "$DOUG_CLIENTES_DIR/clientes.tsv" >"$DOUG_CLIENTES_DIR/clientes.novo"
    mv "$DOUG_CLIENTES_DIR/clientes.novo" "$DOUG_CLIENTES_DIR/clientes.tsv"
  fi ;;
"compose ps --format {{.Image}} agentes") cat "$state/ps-$here" 2>/dev/null || cat "$state/running-$here" ;;
"compose run --rm --name "*" --no-deps -T agentes migrate")
  if grep -qx "$here" "$state/migrate-fails" 2>/dev/null; then echo 'ERRO: relation "tarefas" already exists' >&2; exit 1; fi
  if [[ -e $state/migrate-sinal ]]; then rm -f "$state/signaled-$here"; fi
  if [[ -e $state/migrate-sinal-ignora ]]; then rm -f "$state/signaled-$here"; echo "$here" >>"$state/ignora-sinal"; fi
  if [[ -e $state/slow-migrate ]]; then rm -f "$state/slow-migrate"; touch "$state/migrate-started"; sleep 1.5; fi ;;
"rm -f "*) echo "$3" >>"$state/removidos" ;;
*) echo "docker: chamada inesperada: $*" >&2; exit 99 ;;
esac
`;
const curl = `#!/usr/bin/env bash
state=$STUB_STATE
echo "$*" >>"$state/curl-calls"
url=\${@: -1}
rest=\${url#http://127.0.0.1:}; port=\${rest%%/*}; path=/\${rest#*/}
here=$(cat "$state/port-$port" 2>/dev/null) || exit 7
exec apistub "$here" "$path"
`;
// What a client's server answers, by whichever way it is asked (curl on the port, or exec in the container).
const apistub = `#!/usr/bin/env bash
state=$STUB_STATE
here=$1; path=$2
if [[ $path == /api/openapi.json ]]; then
  echo "curl[$here] openapi" >>"$state/calls"
  script=$state/openapi-$here
  step=auto
  if [[ -s $script ]]; then step=$(head -n1 "$script"); tail -n +2 "$script" >"$script.tmp"; mv "$script.tmp" "$script"; fi
  case $step in
    fail) exit 28 ;;
    partial) printf '{"description":"ADR doug-00'; exit 0 ;;
  esac
  if grep -qx "$here" "$state/no-adr" 2>/dev/null; then echo '{}'; else echo '{"description":"ADR doug-0005"}'; fi
  exit 0
fi
echo "curl[$here] health" >>"$state/calls"
script=$state/script-$here
step=auto
if [[ -s $script ]]; then
  step=$(head -n1 "$script"); tail -n +2 "$script" >"$script.tmp"; mv "$script.tmp" "$script"
fi
image=$(cat "$state/running-$here" 2>/dev/null) || exit 7
[[ $step == fail ]] && exit 22
grep -qx "$here $image" "$state/unhealthy" 2>/dev/null && exit 22
restart=
case $step in
  waiting) restart=',"restart":"waiting"' ;;
  ready) restart=',"restart":"ready"' ;;
  auto)
    now=$(( $(date +%s%N) / 1000000 ))
    prazo=$(cat "$state/aviso-prazo-ms" 2>/dev/null || echo 1800000)
    if [[ -s $state/signaled-$here ]] && (( now < $(cat "$state/signaled-$here") + prazo )) \
      && ! grep -qx "$here" "$state/ignora-sinal" 2>/dev/null; then
      if grep -qx "$here" "$state/never-ready" 2>/dev/null; then restart=',"restart":"waiting"'; else restart=',"restart":"ready"'; fi
    fi ;;
esac
printf '{"status":"ok","version":"1"%s}\\n' "$restart"
`;
const systemctl = `#!/usr/bin/env bash
cat "$STUB_STATE/principal-state" 2>/dev/null || echo inactive
`;
const df = `#!/usr/bin/env bash
if [[ -s $STUB_STATE/df-livre-kb ]]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nstub 100000000 1 %s 1%% /\n' "$(cat "$STUB_STATE/df-livre-kb")"
  exit 0
fi
exec /usr/bin/df "$@"
`;
const awk = `#!/usr/bin/env bash
if [[ -e $STUB_STATE/awk-falha && " $* " == *" -v i="* ]]; then echo "linha pela metade"; exit 1; fi
exec /usr/bin/awk "$@"
`;

const OLD = "agentes-zim:doug-aaa111";
const NEW = "agentes-zim:doug-bbb222";
const NEW_TAG = "agentes-zim_doug-bbb222";
// the image inside a dump's name: no hyphens, so that the slug before it reads without doubt
const DUMP_TAG = "agentes_zim_doug_bbb222";

interface Cliente {
  codigo: string;
  slug: string;
  porta: number;
}
const trio: Cliente[] = [
  { codigo: "001", slug: "padaria-aurora", porta: 3101 },
  { codigo: "002", slug: "cafe-sol", porta: 3102 },
  { codigo: "003", slug: "oficina-lua", porta: 3103 },
];
const [c1, c2, c3] = trio as [Cliente, Cliente, Cliente];
const c4: Cliente = { codigo: "004", slug: "livraria-mar", porta: 3104 };

let rodadas = 0;
interface Opcoes {
  /** The text of the .env of a client (default: OLD, a password and a spare variable). */
  env?: (c: Cliente) => string;
  /** The registry text, from the default lines (header first). */
  tsv?: (linhas: string[]) => string;
  /** No published port (external proxy): `-` in the registry, no DOUG_HOST_PORT in the .env, health through `compose exec`. */
  semPorta?: boolean;
}

/** The default .env of a client, on the image given. */
const envDe = (c: Cliente, imagem: string, semPorta = false) =>
  `POSTGRES_PASSWORD=segredo-${c.codigo}\nDOUG_IMAGE=${imagem}\nOUTRA=1\n${semPorta ? "" : `DOUG_HOST_PORT=${c.porta}\n`}`;

/** A root of clients, all on OLD and healthy, and the fakes on the PATH. */
function ambiente(clientes: Cliente[] = trio, opcoes: Opcoes = {}) {
  rodadas += 1;
  const raiz = join(dir, `raiz-${rodadas}`);
  const state = join(dir, `state-${rodadas}`);
  const bin = join(dir, `bin-${rodadas}`);
  mkdirSync(raiz);
  chmodSync(raiz, 0o755); // the test user's umask may be 002
  mkdirSync(state);
  stub(bin, "docker", docker);
  stub(bin, "curl", curl);
  stub(bin, "systemctl", systemctl);
  stub(bin, "awk", awk);
  stub(bin, "apistub", apistub);
  stub(bin, "df", df);
  writeFileSync(join(state, "calls"), "");
  writeFileSync(join(state, "images"), `${NEW}\n${OLD}\n`);
  writeFileSync(join(state, "principal"), NEW);
  const linhas = ["codigo\tslug\tnome\tporta\timagem\tcriado_em"];
  for (const c of clientes) {
    const pasta = `${c.codigo}-${c.slug}`;
    mkdirSync(join(raiz, pasta, "dados"), { recursive: true });
    writeFileSync(join(raiz, pasta, "compose.yml"), "services: {}\n");
    const env = opcoes.env?.(c) ?? envDe(c, OLD, opcoes.semPorta);
    writeFileSync(join(raiz, pasta, ".env"), env);
    chmodSync(join(raiz, pasta), 0o755);
    chmodSync(join(raiz, pasta, "compose.yml"), 0o644);
    chmodSync(join(raiz, pasta, ".env"), 0o644);
    if (!opcoes.semPorta) writeFileSync(join(state, `port-${c.porta}`), pasta);
    writeFileSync(join(state, `running-${pasta}`), OLD);
    linhas.push(`${c.codigo}\t${c.slug}\tNome ${c.slug}\t${opcoes.semPorta ? "-" : c.porta}\t${OLD}\t2026-11-01`);
  }
  writeFileSync(join(raiz, "clientes.tsv"), opcoes.tsv ? opcoes.tsv(linhas) : `${linhas.join("\n")}\n`);
  const pasta = (c: Cliente) => join(raiz, `${c.codigo}-${c.slug}`);
  const ambienteDoScript = (extra: Record<string, string> = {}) => ({
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    STUB_STATE: state,
    DOUG_CLIENTES_DIR: raiz,
    DOUG_DONO_UID: String(process.getuid?.() ?? 0),
    DOUG_POLL_S: "0",
    DOUG_SAUDE_TIMEOUT_S: "1",
    DOUG_PARADA_TIMEOUT_S: "1",
    DOUG_FOLGA_GB: "0", // the disk of the machine that runs the tests is not what is being tested
    ...extra,
  });
  const a = {
    raiz,
    state,
    pasta,
    ambienteDoScript,
    marca: (arquivo: string, conteudo: string) => writeFileSync(join(state, arquivo), conteudo),
    env: (c: Cliente) => readFileSync(join(pasta(c), ".env"), "utf8"),
    chamadas: () => readFileSync(join(state, "calls"), "utf8").split("\n").filter(Boolean),
    registro: () => readFileSync(join(raiz, "clientes.tsv"), "utf8"),
    /** The backups of a client: <raiz>/backups/<codigo>/. */
    pastaBackups: (c: Cliente) => join(raiz, "backups", c.codigo),
    backups: (c: Cliente) => {
      const p = join(raiz, "backups", c.codigo);
      return existsSync(p) ? readdirSync(p).sort() : [];
    },
    rodar(args: string[] = [], extra: Record<string, string> = {}, entrada?: Uint8Array) {
      const r = Bun.spawnSync(["bash", script, ...args], { env: ambienteDoScript(extra), stdin: entrada });
      return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
    },
  };
  return a;
}
type Ambiente = ReturnType<typeof ambiente>;

/** The `docker[<pasta>] …` calls of one client, without the prefix. */
const deste = (chamadas: string[], c: Cliente) =>
  chamadas.filter((l) => l.startsWith(`docker[${c.codigo}-${c.slug}] `)).map((l) => l.slice(l.indexOf("] ") + 2));
/** The calls of one client, docker and curl, in order. */
const todas = (chamadas: string[], c: Cliente) =>
  chamadas.filter(
    (l) => l.startsWith(`docker[${c.codigo}-${c.slug}] `) || l.startsWith(`curl[${c.codigo}-${c.slug}] `),
  );
const tocou = (a: Ambiente, c: Cliente) =>
  deste(a.chamadas(), c).some((l) => /kill|up -d|pg_dump|restart|migrate/.test(l));
const sobras = (a: Ambiente, c: Cliente) =>
  readdirSync(a.pasta(c)).filter((n) => n.startsWith(".env.") || n.endsWith(".parcial"));

describe("deploy/swas/doug-atualizar-clientes", () => {
  test("passa no bash -n", () => {
    expect(Bun.spawnSync(["bash", "-n", script]).exitCode).toBe(0);
  });

  test("atualiza todos: aviso, parada, backup fora de dados/, troca do .env e do registro, log e resumo", () => {
    const a = ambiente();
    const { code, out } = a.rodar([NEW.split(":")[1] as string]);
    expect(code).toBe(0);
    expect(out).toContain("Atualizados (3): 001-padaria-aurora 002-cafe-sol 003-oficina-lua");
    for (const c of trio) {
      expect(a.env(c)).toBe(envDe(c, NEW));
      expect(existsSync(`${a.pasta(c)}/.env.antes-atualizar`)).toBe(false);
      expect(sobras(a, c)).toEqual([]);
      // the dump is under <raiz>/backups/<codigo>/, never in the tenant's dados/
      expect(a.backups(c)).toHaveLength(1);
      expect(a.backups(c)[0]).toStartWith(`pre-${c.slug}-${DUMP_TAG}-`);
      expect(existsSync(join(a.pasta(c), "dados", "backups"))).toBe(false);
      // notice, then the stopping point, then the dump, then the swap
      const c1x = todas(a.chamadas(), c);
      const kill = c1x.findIndex((l) => l.includes("kill -s SIGUSR2"));
      const dump = c1x.findIndex((l) => l.includes("pg_dump"));
      const up = c1x.findIndex((l) => l.endsWith("compose up -d"));
      expect(kill).toBeGreaterThanOrEqual(0);
      expect(kill).toBeLessThan(dump);
      expect(dump).toBeLessThan(up);
      expect(a.registro()).toContain(`${c.codigo}\t${c.slug}\tNome ${c.slug}\t${c.porta}\t${NEW}\t2026-11-01`);
    }
    // the folders of the script are the owner's alone
    expect(statSync(join(a.raiz, "backups")).mode & 0o777).toBe(0o700);
    expect(statSync(a.pastaBackups(c1)).mode & 0o777).toBe(0o700);
    // the registry's previous copy
    expect(readFileSync(join(a.raiz, "clientes.tsv.anterior"), "utf8")).toContain(`\t${OLD}\t`);
    // one folder of logs, a log per client and the summary
    const logs = join(a.raiz, "logs");
    const [rodada] = readdirSync(logs);
    expect(readdirSync(join(logs, rodada as string)).sort()).toEqual([
      "001-padaria-aurora.log",
      "002-cafe-sol.log",
      "003-oficina-lua.log",
      "resumo.txt",
    ]);
    expect(readFileSync(join(logs, rodada as string, "resumo.txt"), "utf8")).toContain("Atualizados (3)");
    expect(readFileSync(join(logs, rodada as string, "001-padaria-aurora.log"), "utf8")).toContain("ATUALIZADO");
  });

  test("sem tag usa a imagem que a instância principal roda, não a mais recente da máquina", () => {
    const a = ambiente([c1]);
    a.marca("images", `agentes-zim:doug-ccc333\n${NEW}\n${OLD}\n`);
    a.marca("principal", NEW);
    expect(a.rodar().code).toBe(0);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
    expect(a.chamadas()).toContain("docker[-] inspect --format {{.Config.Image}} agentes-chat-agentes-1");
  });

  test("sem tag e sem ler o container da principal: recusa, sem tocar em ninguém", () => {
    const a = ambiente([c1]);
    rmSync(join(a.state, "principal"));
    const { code, out } = a.rodar();
    expect(code).toBe(2);
    expect(out).toContain("passe a tag");
    expect(tocou(a, c1)).toBe(false);
  });

  test("a instância principal se atualizando: não começa", () => {
    const a = ambiente([c1]);
    a.marca("principal-state", "activating");
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(2);
    expect(out).toContain("se atualizando");
    expect(tocou(a, c1)).toBe(false);
  });

  test("ready que demora alguns polls: o dump e a troca esperam por ele", () => {
    const a = ambiente([c1]);
    a.marca(`script-${c1.codigo}-${c1.slug}`, "waiting\nwaiting\nwaiting\nready\n");
    const { code } = a.rodar([NEW], { DOUG_PARADA_TIMEOUT_S: "30" });
    expect(code).toBe(0);
    const t = todas(a.chamadas(), c1);
    const dump = t.findIndex((l) => l.includes("pg_dump"));
    const antes = t.slice(0, dump).filter((l) => l.endsWith("health"));
    expect(antes).toHaveLength(4); // three waiting, then ready
    expect(t.findIndex((l) => l.includes("kill"))).toBeLessThan(t.findIndex((l) => l.endsWith("health")));
    // the new container holds nothing: the stub dropped the notice at `up -d`
    expect(existsSync(join(a.state, `signaled-${c1.codigo}-${c1.slug}`))).toBe(false);
  });

  test("leituras que falham no meio da espera não bastam para dar o servidor por parado", () => {
    const a = ambiente([c1]);
    a.marca(`script-${c1.codigo}-${c1.slug}`, "fail\nfail\nready\n");
    const { code, out } = a.rodar([NEW], { DOUG_PARADA_TIMEOUT_S: "30" });
    expect(code).toBe(0);
    expect(out).not.toContain("não responde");
    expect(out).toContain("ponto de parada: nada roda mais ali");
    const t = todas(a.chamadas(), c1);
    expect(t.findIndex((l) => l.includes("pg_dump"))).toBeGreaterThan(t.findIndex((l) => l.endsWith("health")));
  });

  test("três falhas seguidas: o servidor não responde, nada a esperar", () => {
    const a = ambiente([c1]);
    a.marca(`script-${c1.codigo}-${c1.slug}`, "fail\nfail\nfail\n");
    const { code, out } = a.rodar([NEW], { DOUG_PARADA_TIMEOUT_S: "30" });
    expect(code).toBe(0);
    expect(out).toContain("não responde há 3 leituras seguidas");
  });

  test("servidor que não conhece a parada: não recebe o SIGUSR2", () => {
    const a = ambiente([c1]);
    a.marca("no-adr", `${c1.codigo}-${c1.slug}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("não conhece o aviso de troca");
    expect(deste(a.chamadas(), c1).some((l) => l.includes("kill"))).toBe(false);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("health sem a chave restart depois do sinal: três leituras e segue, sem esperar o limite", () => {
    const a = ambiente([c1]);
    a.marca("ignora-sinal", `${c1.codigo}-${c1.slug}\n`);
    const { code, out } = a.rodar([NEW], { DOUG_PARADA_TIMEOUT_S: "600" });
    expect(code).toBe(0);
    expect(out).toContain("não confirmou o aviso em 3 leituras");
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("o ponto de parada que não vem no limite não trava: troca assim mesmo", () => {
    const a = ambiente([c1]);
    a.marca("never-ready", `${c1.codigo}-${c1.slug}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("o ponto de parada não veio");
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("health que não fica ok: volta para a imagem anterior, restaura o .env e marca a imagem", () => {
    const a = ambiente();
    a.marca("unhealthy", `002-cafe-sol ${NEW}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(3);
    expect(out).toContain("Voltaram para a anterior (1): 002-cafe-sol");
    expect(out).toContain("Atualizados (2): 001-padaria-aurora 003-oficina-lua");
    expect(out).toContain("Falharam (0): nenhum");
    expect(a.env(c2)).toBe(envDe(c2, OLD));
    expect(existsSync(`${a.pasta(c2)}/.env.antes-atualizar`)).toBe(false);
    expect(a.registro()).toContain(`002\tcafe-sol\tNome cafe-sol\t3102\t${OLD}\t`);
    // the swap and the way back: two `up -d`
    expect(deste(a.chamadas(), c2).filter((l) => l === "compose up -d")).toHaveLength(2);
    expect(a.env(c3)).toContain(`DOUG_IMAGE=${NEW}`);
    // the dump of a try that went back is kept out of the rotation, and the image is marked
    expect(a.backups(c2)).toHaveLength(1);
    expect(a.backups(c2)[0]).toStartWith("falhou-");
    expect(readFileSync(join(a.raiz, "atualizacao", "marcas", `002__${NEW_TAG}`), "utf8")).toStartWith("voltou\t");
  });

  test("cliente que falha também na volta: o .env volta para a imagem velha e o guarda é removido", () => {
    const a = ambiente([c1]);
    a.marca("unhealthy", `001-padaria-aurora ${NEW}\n001-padaria-aurora ${OLD}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (1): 001-padaria-aurora");
    expect(a.env(c1)).toBe(envDe(c1, OLD));
    expect(existsSync(`${a.pasta(c1)}/.env.antes-atualizar`)).toBe(false);
    expect(sobras(a, c1)).toEqual([]);
    expect(a.backups(c1)[0]).toStartWith("falhou-");
    expect(readFileSync(join(a.raiz, "atualizacao", "marcas", `001__${NEW_TAG}`), "utf8")).toStartWith("falhou\t");
    // the registry still says the old image
    expect(a.registro()).toContain(`\t${OLD}\t`);
  });

  test("servidor que sobe com outra imagem: não conta como atualizado", () => {
    const a = ambiente([c1]);
    a.marca(`ps-${c1.codigo}-${c1.slug}`, OLD);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(3);
    expect(out).toContain(`o servidor roda ${OLD}, não ${NEW}`);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
  });

  test("dump que falha com backups antigos presentes: os antigos ficam, o cliente não é tocado, o aviso acaba", () => {
    const a = ambiente([c1]);
    const pasta = a.pastaBackups(c1);
    mkdirSync(pasta, { recursive: true, mode: 0o700 });
    for (const dia of ["01", "02", "03", "04"])
      writeFileSync(join(pasta, `pre-${c1.slug}-agentes_zim_doug_old${dia}-2025110${dia}-030000.dump`), "x");
    writeFileSync(join(pasta, `falhou-${c1.slug}-antigo-20251001-030000.dump`), "x");
    const antes = readdirSync(pasta).sort();
    a.marca("dump-fails", `${c1.codigo}-${c1.slug}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("backup FALHOU");
    expect(readdirSync(pasta).sort()).toEqual(antes);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
    expect(sobras(a, c1)).toEqual([]);
    expect(existsSync(`${a.pasta(c1)}/.env.antes-atualizar`)).toBe(false);
    const d = deste(a.chamadas(), c1);
    expect(d.some((l) => l === "compose up -d")).toBe(false);
    // the server was told to stop at a stopping point and nothing runs: it is restarted on the same image
    expect(d).toContain("compose restart agentes");
    // no mark: nothing was wrong with the image
    expect(readdirSync(join(a.raiz, "atualizacao", "marcas"))).toEqual([]);
  });

  test("backups: depois de uma troca boa ficam só os últimos 3 de trocas boas; os de falha, 2, e os do instalador não são tocados", () => {
    const a = ambiente([c1]);
    const pasta = a.pastaBackups(c1);
    mkdirSync(pasta, { recursive: true, mode: 0o700 });
    for (const dia of ["01", "02", "03", "04"]) {
      const f = join(pasta, `pre-${c1.slug}-x-202511${dia}-030000.dump`);
      writeFileSync(f, "x");
      utimesSync(f, new Date(`2025-11-${dia}T03:00:00Z`), new Date(`2025-11-${dia}T03:00:00Z`));
    }
    writeFileSync(join(pasta, `falhou-${c1.slug}-x-20251001-030000.dump`), "x");
    writeFileSync(join(pasta, "outro-arquivo.txt"), "fica");
    writeFileSync(join(pasta, "manual-20251101-030000.dump"), "do instalador");
    writeFileSync(join(pasta, "remocao-20251101-030000.dump"), "do instalador");
    expect(a.rodar([NEW]).code).toBe(0);
    const ficou = readdirSync(pasta).sort();
    expect(ficou.filter((n) => n.startsWith("pre-"))).toHaveLength(3); // the new one and the two newest
    expect(ficou).not.toContain(`pre-${c1.slug}-x-20251101-030000.dump`);
    expect(ficou).not.toContain(`pre-${c1.slug}-x-20251102-030000.dump`);
    expect(ficou).toContain(`falhou-${c1.slug}-x-20251001-030000.dump`);
    expect(ficou).toContain("outro-arquivo.txt");
    expect(ficou).toContain("manual-20251101-030000.dump");
    expect(ficou).toContain("remocao-20251101-030000.dump");
  });

  test("imagem marcada como falha ou volta: o cliente é pulado até --forcar", () => {
    const a = ambiente([c1]);
    a.marca("unhealthy", `001-padaria-aurora ${NEW}\n`);
    expect(a.rodar([NEW]).code).toBe(3);
    const feitas = a.chamadas().length;
    // the next night, same image: not touched
    const segunda = a.rodar([NEW]);
    expect(segunda.code).toBe(3);
    expect(segunda.out).toContain("Pulados (1): 001-padaria-aurora");
    expect(segunda.out).toContain("PULADO");
    expect(
      a
        .chamadas()
        .slice(feitas)
        .some((l) => /kill|up -d|pg_dump/.test(l)),
    ).toBe(false);
    // another image is not marked
    a.marca("images", `agentes-zim:doug-ddd444\n${NEW}\n${OLD}\n`);
    expect(a.rodar(["doug-ddd444"]).code).toBe(0);
    // and --forcar tries the marked one again
    const b = ambiente([c1]);
    b.marca("unhealthy", `001-padaria-aurora ${NEW}\n`);
    b.rodar([NEW]);
    rmSync(join(b.state, "unhealthy"));
    const forcado = b.rodar(["--forcar", NEW]);
    expect(forcado.code).toBe(0);
    expect(forcado.out).toContain("Atualizados (1): 001-padaria-aurora");
    // a good update clears the mark
    expect(existsSync(join(b.raiz, "atualizacao", "marcas", `001__${NEW_TAG}`))).toBe(false);
  });

  test("disjuntor: voltas seguidas com a mesma imagem param a rodada", () => {
    const quatro = [...trio, c4];
    const a = ambiente(quatro);
    a.marca("unhealthy", quatro.map((c) => `${c.codigo}-${c.slug} ${NEW}`).join("\n"));
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Voltaram para a anterior (2): 001-padaria-aurora 002-cafe-sol");
    expect(out).toContain("Sem iniciar (2): 003-oficina-lua 004-livraria-mar");
    expect(out).toContain("DISJUNTOR");
    expect(tocou(a, c3)).toBe(false);
    expect(tocou(a, c4)).toBe(false);
  });

  test("um cliente que falha antes de ser tocado não aciona o disjuntor nem para os outros", () => {
    const a = ambiente();
    a.marca("dump-fails", "001-padaria-aurora\n002-cafe-sol\n");
    const { code, out } = a.rodar([NEW], { DOUG_DISJUNTOR: "1" });
    expect(code).toBe(1);
    expect(out).toContain("Falharam (2): 001-padaria-aurora 002-cafe-sol");
    expect(out).toContain("Atualizados (1): 003-oficina-lua");
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
  });

  test("--dry-run só mostra: nada é tocado, nenhum log, nenhuma trava, nenhum backup", () => {
    const a = ambiente();
    const antes = a.registro();
    const { code, out } = a.rodar(["--dry-run", NEW]);
    expect(code).toBe(0);
    expect(out).toContain("Seriam atualizados (3)");
    expect(out).toContain(`[simulação] ${OLD} -> ${NEW}`);
    expect(a.registro()).toBe(antes);
    for (const c of trio) {
      expect(a.env(c)).toContain(`DOUG_IMAGE=${OLD}`);
      expect(a.backups(c)).toEqual([]);
      expect(sobras(a, c)).toEqual([]);
    }
    expect(existsSync(join(a.raiz, "logs"))).toBe(false);
    expect(existsSync(join(a.raiz, ".atualizar.lock"))).toBe(false);
    expect(a.chamadas().filter((l) => /pg_dump|kill|up -d|restart/.test(l))).toEqual([]);
  });

  test("--so e --exceto escolhem os clientes", () => {
    const a = ambiente();
    expect(a.rodar(["--so", "2", NEW]).out).toContain("Atualizados (1): 002-cafe-sol");
    const b = ambiente();
    const { code, out } = b.rodar(["--exceto", "001,003", NEW]);
    expect(code).toBe(0);
    expect(out).toContain("Atualizados (1): 002-cafe-sol");
    const c = ambiente();
    const so = c.rodar(["--so", "009", NEW]);
    expect(so.code).toBe(2);
    expect(so.out).toContain("009 não está em");
  });

  test("--so e --exceto vazios não viram 'todos': saem com 2 sem tocar em ninguém", () => {
    for (const args of [
      ["--so", ""],
      ["--so", ","],
      ["--exceto", ""],
      ["--exceto", " , "],
      ["--so="],
      ["--exceto=,"],
    ]) {
      const a = ambiente();
      const { code, out } = a.rodar([...args, NEW]);
      expect(code).toBe(2);
      expect(out).toContain("pedem ao menos um código");
      expect(a.chamadas().filter((l) => /pg_dump|kill|up -d/.test(l))).toEqual([]);
      expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
    }
  });

  test("cliente que já está na imagem: pulado sem backup, desde que o health esteja ok", () => {
    const a = ambiente([c1]);
    const { code, out } = a.rodar([OLD]);
    expect(code).toBe(0);
    expect(out).toContain("Já na imagem (1): 001-padaria-aurora");
    expect(a.backups(c1)).toEqual([]);
  });

  test("já na imagem mas sem health: falha em vez de passar por em dia", () => {
    const a = ambiente([c1]);
    a.marca("unhealthy", `001-padaria-aurora ${OLD}\n`);
    a.marca("images", `${OLD}\n`);
    const { code, out } = a.rodar([OLD]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (1): 001-padaria-aurora");
    expect(out).toContain("não responde ok");
  });

  test("imagem nova que não existe na máquina: recusa antes de tocar em qualquer cliente", () => {
    const a = ambiente();
    const { code, out } = a.rodar(["doug-nao-existe"]);
    expect(code).toBe(2);
    expect(out).toContain("não existe nesta máquina");
    expect(a.chamadas().some((l) => l.includes("kill") || l.includes("up -d"))).toBe(false);
  });

  test("imagem anterior ausente: o cliente falha sem ser tocado", () => {
    const a = ambiente([c1, c2]);
    a.marca("images", `${NEW}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (2)");
    expect(out).toContain(`a imagem atual ${OLD} não existe`);
    expect(tocou(a, c1)).toBe(false);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
  });

  test("TSV com campo vazio e com CRLF: o cliente certo é atualizado e a linha mantém o jeito", () => {
    const a = ambiente([c1, c2], {
      tsv: (l) => `${l.map((x, i) => (i === 1 ? x.replace("Nome padaria-aurora", "") : x)).join("\r\n")}\r\n`,
    });
    expect(a.registro()).toContain(`001\tpadaria-aurora\t\t3101\t${OLD}\t2026-11-01\r\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("Atualizados (2): 001-padaria-aurora 002-cafe-sol");
    expect(a.registro()).toContain(`001\tpadaria-aurora\t\t3101\t${NEW}\t2026-11-01\r\n`);
    expect(a.registro()).toContain(`002\tcafe-sol\tNome cafe-sol\t3102\t${NEW}\t2026-11-01\r\n`);
  });

  test(".env sem newline final, com aspas ou com export: a imagem é lida e trocada, o resto fica", () => {
    const variantes: Array<[Cliente, string]> = [
      [c1, `A=1\nDOUG_HOST_PORT=3101\nDOUG_IMAGE="${OLD}"`],
      [c2, `export DOUG_HOST_PORT=3102\nexport DOUG_IMAGE='${OLD}'\nB=2`],
      [c3, `DOUG_HOST_PORT="3103"\nDOUG_IMAGE=${OLD} # a imagem\nC=3\n`],
    ];
    const a = ambiente(trio, { env: (c) => variantes.find(([x]) => x === c)?.[1] ?? "" });
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("Atualizados (3)");
    expect(a.env(c1)).toBe(`A=1\nDOUG_HOST_PORT=3101\nDOUG_IMAGE=${NEW}\n`);
    expect(a.env(c2)).toBe(`export DOUG_HOST_PORT=3102\nDOUG_IMAGE=${NEW}\nB=2\n`);
    expect(a.env(c3)).toBe(`DOUG_HOST_PORT="3103"\nDOUG_IMAGE=${NEW}\nC=3\n`);
  });

  test("a troca do .env mantém o modo do arquivo", () => {
    const a = ambiente([c1]);
    chmodSync(join(a.pasta(c1), ".env"), 0o600);
    expect(a.rodar([NEW]).code).toBe(0);
    expect(statSync(join(a.pasta(c1), ".env")).mode & 0o777).toBe(0o600);
  });

  test("registro com falha de escrita: o clientes.tsv fica como estava e o cliente continua atualizado", () => {
    const a = ambiente([c1]);
    const antes = a.registro();
    a.marca("awk-falha", "1");
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("o registro não ganhou a imagem nova");
    expect(a.registro()).toBe(antes);
    expect(readdirSync(a.raiz).filter((n) => n.startsWith("clientes.tsv."))).toEqual([]);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("guarda órfão de uma troca que não chegou a ficar saudável: restaura o .env, confere o cliente e não o atualiza na mesma rodada", () => {
    const a = ambiente([c1]);
    const env = join(a.pasta(c1), ".env");
    writeFileSync(`${env}.antes-atualizar`, envDe(c1, OLD));
    writeFileSync(env, envDe(c1, NEW));
    a.marca(`running-${c1.codigo}-${c1.slug}`, NEW);
    a.marca("unhealthy", `${c1.codigo}-${c1.slug} ${NEW}\n`); // the new image never got healthy
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(3);
    expect(out).toContain("de uma execução interrompida");
    expect(out).toContain("Voltaram para a anterior (1)");
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
    expect(existsSync(`${env}.antes-atualizar`)).toBe(false);
    expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(OLD);
    expect(deste(a.chamadas(), c1).some((l) => l.includes("pg_dump"))).toBe(false);
  });

  test("guarda órfão de uma troca que já deu certo (morreu depois do health): só o guarda sai e o registro é gravado; nada volta atrás", () => {
    const a = ambiente([c1]);
    const env = join(a.pasta(c1), ".env");
    writeFileSync(`${env}.antes-atualizar`, envDe(c1, OLD));
    writeFileSync(env, envDe(c1, NEW));
    a.marca(`running-${c1.codigo}-${c1.slug}`, NEW);
    expect(a.registro()).toContain(`\t${OLD}\t`); // the dead run never got to write it
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("de uma troca que já deu certo");
    expect(out).toContain("Já na imagem (1): 001-padaria-aurora");
    expect(a.env(c1)).toBe(envDe(c1, NEW));
    expect(existsSync(`${env}.antes-atualizar`)).toBe(false);
    expect(a.registro()).toContain(`\t${NEW}\t`);
    expect(a.registro()).not.toContain(`\t${OLD}\t`);
    // nothing was restarted, dumped or signaled
    expect(tocou(a, c1)).toBe(false);
    expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(NEW);
  });

  test("guarda órfão que não chegou a trocar nada: some e a atualização segue", () => {
    const a = ambiente([c1]);
    const env = join(a.pasta(c1), ".env");
    writeFileSync(`${env}.antes-atualizar`, readFileSync(env));
    const { code } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(existsSync(`${env}.antes-atualizar`)).toBe(false);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("guarda órfão com cliente que não sobe de volta: falha", () => {
    const a = ambiente([c1]);
    const env = join(a.pasta(c1), ".env");
    writeFileSync(`${env}.antes-atualizar`, `DOUG_IMAGE=${OLD}\nDOUG_HOST_PORT=3101\n`);
    writeFileSync(env, `DOUG_IMAGE=${NEW}\nDOUG_HOST_PORT=3101\n`);
    a.marca("unhealthy", `001-padaria-aurora ${OLD}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (1)");
  });

  test("sobras de execuções mortas (.env.atualizando.*, pre-*.dump.parcial, clientes.tsv.atualizando.*) são limpas; os arquivos do operador, não", () => {
    const a = ambiente([c1]);
    writeFileSync(join(a.pasta(c1), ".env.atualizando.AbC123"), "DOUG_IMAGE=lixo\n");
    mkdirSync(a.pastaBackups(c1), { recursive: true, mode: 0o700 });
    writeFileSync(join(a.pastaBackups(c1), `pre-${c1.slug}-x-20251101-030000.dump.parcial`), "x");
    writeFileSync(join(a.raiz, "clientes.tsv.atualizando.Zz9Yy8"), "lixo");
    // the operator's own files, with names that the old glob (`.env.??????`) would have taken
    writeFileSync(join(a.pasta(c1), ".env.backup"), "SEGREDO=do-operador\n");
    writeFileSync(join(a.pasta(c1), ".env.abcdef"), "SEGREDO=outro\n");
    writeFileSync(join(a.raiz, "clientes.tsv.backup"), "copia do operador\n");
    writeFileSync(join(a.raiz, "clientes.tsv.abcdef"), "outra copia\n");
    writeFileSync(join(a.pastaBackups(c1), "manual-20251101-030000.dump.parcial"), "do instalador, na mão");
    expect(a.rodar([NEW]).code).toBe(0);
    expect(existsSync(join(a.pasta(c1), ".env.atualizando.AbC123"))).toBe(false);
    expect(a.backups(c1).some((n) => n.startsWith(`pre-${c1.slug}-x-`) && n.endsWith(".parcial"))).toBe(false);
    expect(existsSync(join(a.raiz, "clientes.tsv.atualizando.Zz9Yy8"))).toBe(false);
    expect(readFileSync(join(a.pasta(c1), ".env.backup"), "utf8")).toBe("SEGREDO=do-operador\n");
    expect(readFileSync(join(a.pasta(c1), ".env.abcdef"), "utf8")).toBe("SEGREDO=outro\n");
    expect(readFileSync(join(a.raiz, "clientes.tsv.backup"), "utf8")).toBe("copia do operador\n");
    expect(readFileSync(join(a.raiz, "clientes.tsv.abcdef"), "utf8")).toBe("outra copia\n");
    expect(a.backups(c1)).toContain("manual-20251101-030000.dump.parcial");
    // and a normal run leaves no temporary of its own behind
    expect(readdirSync(a.pasta(c1)).filter((n) => n.includes(".atualizando."))).toEqual([]);
    expect(readdirSync(a.raiz).filter((n) => n.includes(".atualizando."))).toEqual([]);
  });

  test("código ou slug fora do padrão no registro: o cliente falha sem ser tocado", () => {
    const a = ambiente([c1], {
      tsv: (l) =>
        `${[
          ...l,
          `12\tpadaria\tNome\t3150\t${OLD}\t2026-11-01`,
          `005\t../fora\tNome\t3151\t${OLD}\t2026-11-01`,
          `006\tPadaria Aurora\tNome\t3152\t${OLD}\t2026-11-01`,
          `007\t-ruim-\tNome\t3153\t${OLD}\t2026-11-01`,
          `008\tcafe-sol\tNome\tdoze\t${OLD}\t2026-11-01`,
        ].join("\n")}\n`,
    });
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Atualizados (1): 001-padaria-aurora");
    expect(out).toContain("Falharam (5):");
    expect(out).toContain("código inválido");
    expect(out).toContain("slug inválido");
    expect(out).toContain("porta inválida");
    expect(a.chamadas().filter((l) => /^docker\[(?!001)/.test(l) && /kill|up -d|pg_dump/.test(l))).toEqual([]);
  });

  test("pasta do cliente que é um link simbólico, ou que sai da raiz: falha", () => {
    const a = ambiente([c1, c2]);
    const fora = join(dir, `fora-${rodadas}`);
    mkdirSync(join(fora, "dados"), { recursive: true });
    writeFileSync(join(fora, "compose.yml"), "services: {}\n");
    writeFileSync(join(fora, ".env"), `DOUG_IMAGE=${OLD}\n`);
    rmSync(a.pasta(c2), { recursive: true });
    symlinkSync(fora, a.pasta(c2));
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (1): 002-cafe-sol");
    expect(out).toContain("não fica dentro de");
    expect(readFileSync(join(fora, ".env"), "utf8")).toBe(`DOUG_IMAGE=${OLD}\n`);
  });

  test("a contenção pelo caminho real: a pasta é um link para a de OUTRO cliente (passa pelo sem_link e para no realpath)", () => {
    const a = ambiente([c1, c2]);
    // 002's folder is a link to 001's: every file under it is a plain file, so only the real path says it is not 002's
    rmSync(a.pasta(c2), { recursive: true });
    symlinkSync(a.pasta(c1), a.pasta(c2));
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (1): 002-cafe-sol");
    expect(out).toMatch(/FALHOU: .*002-cafe-sol não fica dentro de/);
    expect(tocou(a, c2)).toBe(false);
    expect(out).toContain("Atualizados (1): 001-padaria-aurora");
  });

  test(".env que é um link simbólico: falha, e o que está do outro lado não é tocado", () => {
    const a = ambiente([c1]);
    const alvo = join(dir, `alvo-${rodadas}`);
    writeFileSync(alvo, `DOUG_IMAGE=${OLD}\n`);
    rmSync(join(a.pasta(c1), ".env"));
    symlinkSync(alvo, join(a.pasta(c1), ".env"));
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("link simbólico");
    expect(readFileSync(alvo, "utf8")).toBe(`DOUG_IMAGE=${OLD}\n`);
    expect(tocou(a, c1)).toBe(false);
  });

  test("pasta dos backups que é um link simbólico: o backup é recusado e nada é escrito do outro lado", () => {
    const a = ambiente([c1]);
    const fora = join(dir, `backups-fora-${rodadas}`);
    mkdirSync(fora);
    symlinkSync(fora, join(a.raiz, "backups"));
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("link simbólico");
    expect(readdirSync(fora)).toEqual([]);
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
  });

  test("permissões: .env, compose.yml ou pasta graváveis por grupo/outros, ou de outro dono, não são aceitos", () => {
    const a = ambiente([c1, c2, c3]);
    chmodSync(join(a.pasta(c1), ".env"), 0o664);
    chmodSync(join(a.pasta(c2), "compose.yml"), 0o666);
    chmodSync(a.pasta(c3), 0o775);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (3)");
    expect(out).toContain("deixa grupo ou outros escreverem");
    for (const c of trio) expect(tocou(a, c)).toBe(false);
    // another owner: the stand-in for "not root" is a different expected uid
    const b = ambiente([c1]);
    const outro = String((process.getuid?.() ?? 0) + 1);
    const dono = b.rodar([NEW], { DOUG_DONO_UID: outro });
    expect(dono.code).toBe(2);
    expect(dono.out).toContain(`não do ${outro}`);
    expect(tocou(b, c1)).toBe(false);
  });

  test("as migrações rodam sempre antes do up -d, seja qual for RUN_MIGRATIONS_ON_BOOT; falhando, o cliente volta", () => {
    const comMigracao = (c: Cliente) =>
      `DOUG_IMAGE=${OLD}\nRUN_MIGRATIONS_ON_BOOT=false\nX=${c.codigo}\nDOUG_HOST_PORT=${c.porta}\n`;
    const a = ambiente([c1], { env: comMigracao });
    expect(a.rodar([NEW]).code).toBe(0);
    const d = deste(a.chamadas(), c1);
    const migra = d.findIndex((l) => l.includes("migrate"));
    expect(migra).toBeGreaterThanOrEqual(0);
    expect(migra).toBeLessThan(d.indexOf("compose up -d"));
    // every spelling that the config's boolean reads as false, in any case, and the default (unset) and true: all migrate
    for (const valor of ["false", "FALSE", "0", "off", "No", "n", "disabled", "Disabled", "true", ""]) {
      const e = ambiente([c1], {
        env: (c) =>
          `DOUG_IMAGE=${OLD}\n${valor === "" ? "" : `RUN_MIGRATIONS_ON_BOOT=${valor}\n`}DOUG_HOST_PORT=${c.porta}\n`,
      });
      expect(e.rodar([NEW]).code).toBe(0);
      const ch = deste(e.chamadas(), c1);
      expect(ch.filter((l) => l.includes("migrate"))).toHaveLength(1);
      expect(ch.findIndex((l) => l.includes("migrate"))).toBeLessThan(ch.indexOf("compose up -d"));
    }
    // a failing migration is a failed swap: back to the old image
    const c = ambiente([c1], { env: comMigracao });
    c.marca("migrate-fails", `${c1.codigo}-${c1.slug}\n`);
    const r = c.rodar([NEW]);
    expect(r.code).toBe(3);
    expect(r.out).toContain("a migração falhou");
    expect(c.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
  });

  test("duas execuções ao mesmo tempo: a segunda sai com 2", async () => {
    const a = ambiente([c1]);
    const trava = join(a.raiz, ".atualizar.lock");
    writeFileSync(trava, "");
    const dono = Bun.spawn(["flock", trava, "sleep", "20"]);
    try {
      for (let i = 0; i < 50 && Bun.spawnSync(["flock", "-n", trava, "true"]).exitCode === 0; i++) await Bun.sleep(100);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(2);
      expect(out).toContain("outra atualização está rodando");
      expect(tocou(a, c1)).toBe(false);
    } finally {
      dono.kill();
    }
  });

  test("o doug-cliente com a trava de clientes: o cliente fica para a próxima rodada, sem ser tocado", async () => {
    const a = ambiente([c1, c2]);
    const trava = join(a.raiz, ".lock");
    writeFileSync(trava, "");
    const dono = Bun.spawn(["flock", trava, "sleep", "20"]);
    try {
      for (let i = 0; i < 50 && Bun.spawnSync(["flock", "-n", trava, "true"]).exitCode === 0; i++) await Bun.sleep(100);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(1);
      expect(out).toContain("o doug-cliente está com a trava");
      expect(tocou(a, c1)).toBe(false);
      expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
    } finally {
      dono.kill();
    }
  });

  test("cliente tirado do registro durante a rodada (um `remover`) é pulado, não atualizado", () => {
    const a = ambiente([c1, c2]);
    // the first client's `up -d` is where the stand-in for `doug-cliente remover 002` takes 002 out of the registry
    a.marca("tira-do-registro", "002");
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(3);
    expect(out).toContain("Atualizados (1): 001-padaria-aurora");
    expect(out).toContain("Pulados (1): 002-cafe-sol");
    expect(out).toContain("saiu do registro");
    expect(tocou(a, c2)).toBe(false);
  });

  test("SIGTERM no meio da troca: o .env volta ao que era, o guarda some e o servidor é devolvido", async () => {
    const a = ambiente([c1]);
    a.marca("slow-up", "1");
    const proc = Bun.spawn(["bash", script, NEW], { env: a.ambienteDoScript(), stdout: "pipe", stderr: "pipe" });
    const fim = Date.now() + 8000;
    while (Date.now() < fim && !existsSync(join(a.state, "up-started"))) await Bun.sleep(20);
    expect(existsSync(join(a.state, "up-started"))).toBe(true);
    // the new .env is in place and the guard holds the old one
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
    expect(existsSync(`${a.pasta(c1)}/.env.antes-atualizar`)).toBe(true);
    proc.kill("SIGTERM");
    const code = await proc.exited;
    const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
    expect(code).toBe(143);
    expect(out).toContain("INTERROMPIDO");
    expect(a.env(c1)).toBe(envDe(c1, OLD));
    expect(existsSync(`${a.pasta(c1)}/.env.antes-atualizar`)).toBe(false);
    expect(sobras(a, c1)).toEqual([]);
    // the interrupted swap's up -d, then the one that puts the old image back
    expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(OLD);
    expect(a.registro()).toContain(`\t${OLD}\t`);
  });

  // ─── o contrato da API (openapi): uma leitura que falha não diz "não conhece" ─────────────────────────────────────

  describe("o servidor conhece a parada? (/api/openapi.json)", () => {
    const aberturas = (a: Ambiente) => a.chamadas().filter((l) => l.endsWith("openapi")).length;
    const calls = (a: Ambiente) => readFileSync(join(a.state, "curl-calls"), "utf8").split("\n");

    test("duas leituras que falham (timeout) e a terceira completa: o sinal é enviado", () => {
      const a = ambiente([c1]);
      a.marca(`openapi-${c1.codigo}-${c1.slug}`, "fail\nfail\n");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(aberturas(a)).toBe(3);
      expect(out).not.toContain("não conhece");
      expect(deste(a.chamadas(), c1).some((l) => l.includes("kill -s SIGUSR2"))).toBe(true);
      // every read of the contract has its own 30 s limit
      const leituras = calls(a).filter((l) => l.includes("/api/openapi.json"));
      expect(leituras).toHaveLength(3);
      for (const l of leituras) expect(l).toContain("--max-time 30");
    });

    test("uma resposta pela metade (sem o fim do JSON) é leitura que falhou, não 'não conhece'", () => {
      const a = ambiente([c1]);
      a.marca(`openapi-${c1.codigo}-${c1.slug}`, "partial\nplain\n");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).not.toContain("não conhece");
      expect(aberturas(a)).toBe(2);
      expect(deste(a.chamadas(), c1).some((l) => l.includes("kill -s SIGUSR2"))).toBe(true);
    });

    test("nenhuma das 3 leituras funciona: servidor que não responde, sem sinal e sem dizer que não conhece", () => {
      for (const roteiro of ["fail\nfail\nfail\n", "partial\npartial\npartial\n", "fail\npartial\nfail\n"]) {
        const a = ambiente([c1]);
        a.marca(`openapi-${c1.codigo}-${c1.slug}`, roteiro);
        const { code, out } = a.rodar([NEW]);
        expect(code).toBe(0);
        expect(aberturas(a)).toBe(3);
        expect(out).toContain("não respondeu ao contrato da API em 3 tentativas");
        expect(out).not.toContain("não conhece o aviso");
        expect(deste(a.chamadas(), c1).some((l) => l.includes("kill"))).toBe(false);
        expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
      }
    });

    test("só uma resposta completa e sem doug-0005 diz que não conhece: uma leitura basta", () => {
      const a = ambiente([c1]);
      a.marca("no-adr", `${c1.codigo}-${c1.slug}\n`);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(aberturas(a)).toBe(1);
      expect(out).toContain("não conhece o aviso de troca");
      expect(deste(a.chamadas(), c1).some((l) => l.includes("kill"))).toBe(false);
    });
  });

  // ─── o disco e os backups de falha ───────────────────────────────────────────────────────────────────────────────

  describe("disco para o dump e backups de falha", () => {
    test("pouco espaço livre (menos que a folga): o cliente é recusado antes de qualquer toque", () => {
      const a = ambiente([c1, c2]);
      a.marca("df-livre-kb", String(4 * 1024 * 1024)); // 4 GB livres, a folga padrão é 5
      const { code, out } = a.rodar([NEW], { DOUG_FOLGA_GB: "5" });
      expect(code).toBe(1);
      expect(out).toContain("Falharam (2): 001-padaria-aurora 002-cafe-sol");
      expect(out).toContain("sem espaço para o backup");
      for (const c of [c1, c2]) {
        expect(tocou(a, c)).toBe(false); // no notice, no dump, no swap
        expect(a.env(c)).toBe(envDe(c, OLD));
        expect(a.backups(c)).toEqual([]);
      }
    });

    test("a folga vem de DOUG_FOLGA_GB e vale 5 GB sem ela", () => {
      // without DOUG_FOLGA_GB in the environment: 6 GB free is enough, 4 GB is not
      const semFolga = (a: Ambiente) => {
        const env = a.ambienteDoScript() as Record<string, string>;
        delete env.DOUG_FOLGA_GB;
        const r = Bun.spawnSync(["bash", script, NEW], { env });
        return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
      };
      const cabe = ambiente([c1]);
      cabe.marca("df-livre-kb", String(6 * 1024 * 1024));
      const ok = semFolga(cabe);
      expect(ok.code).toBe(0);
      expect(ok.out).toContain("disco:");
      const nao = ambiente([c1]);
      nao.marca("df-livre-kb", String(4 * 1024 * 1024));
      const recusa = semFolga(nao);
      expect(recusa.code).toBe(1);
      expect(recusa.out).toContain("a folga é de 5 GB");
      expect(tocou(nao, c1)).toBe(false);
      // a folga of 3 GB makes the 4 GB enough
      const tres = ambiente([c1]);
      tres.marca("df-livre-kb", String(4 * 1024 * 1024));
      expect(tres.rodar([NEW], { DOUG_FOLGA_GB: "3" }).code).toBe(0);
    });

    test("o tamanho de dados/postgres entra na conta", () => {
      const a = ambiente([c1]);
      mkdirSync(join(a.pasta(c1), "dados", "postgres"), { recursive: true });
      writeFileSync(join(a.pasta(c1), "dados", "postgres", "base.bin"), Buffer.alloc(3 * 1024 * 1024));
      a.marca("df-livre-kb", "2000"); // ~2 MB livres para um banco de 3 MB, sem folga
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(1);
      expect(out).toContain("dados/postgres tem 3 MB");
      expect(tocou(a, c1)).toBe(false);
      // with room for it, the same client goes on
      a.marca("df-livre-kb", "100000");
      expect(a.rodar([NEW]).code).toBe(0);
    });

    test("--dry-run também avisa que não cabe, sem tocar em nada", () => {
      const a = ambiente([c1]);
      a.marca("df-livre-kb", "10");
      const { code, out } = a.rodar(["--dry-run", NEW], { DOUG_FOLGA_GB: "5" });
      expect(code).toBe(1);
      expect(out).toContain("sem espaço para o backup");
      expect(tocou(a, c1)).toBe(false);
    });

    test("só os 2 backups falhou-* mais novos de cada cliente ficam, e o resumo diz quantos saíram", () => {
      const a = ambiente([c1, c2]);
      for (const c of [c1, c2]) {
        mkdirSync(a.pastaBackups(c), { recursive: true, mode: 0o700 });
        for (const dia of ["01", "02", "03"]) {
          const f = join(a.pastaBackups(c), `falhou-${c.slug}-x-202510${dia}-030000.dump`);
          writeFileSync(f, "x");
          utimesSync(f, new Date(`2025-10-${dia}T03:00:00Z`), new Date(`2025-10-${dia}T03:00:00Z`));
        }
      }
      writeFileSync(join(a.pastaBackups(c1), "manual-20251001-030000.dump"), "do instalador");
      a.marca("unhealthy", `001-padaria-aurora ${NEW}\n`); // 001 goes back and its dump becomes a falhou-*
      const { out } = a.rodar([NEW]);
      // 001: three old + the new one = four, two stay (the new and the 3rd of October); 002 went well: its 3 become 2
      const f1 = a.backups(c1).filter((n) => n.startsWith("falhou-"));
      expect(f1).toHaveLength(2);
      expect(f1).toContain(`falhou-${c1.slug}-x-20251003-030000.dump`);
      expect(a.backups(c1)).toContain("manual-20251001-030000.dump");
      const f2 = a.backups(c2).filter((n) => n.startsWith("falhou-"));
      expect(f2).toEqual([`falhou-${c2.slug}-x-20251002-030000.dump`, `falhou-${c2.slug}-x-20251003-030000.dump`]);
      expect(out).toContain("Backups de falha (falhou-*) apagados: 3 (ficam os 2 mais novos de cada cliente)");
      expect(out).toContain("apaguei 2 backup(s) de falha antigo(s)");
    });
  });

  // ─── porta ───────────────────────────────────────────────────────────────────────────────────────────────────────

  describe("a porta do .env é a do registro", () => {
    test("diferentes, ou uma só dizendo a porta: o cliente é recusado sem ser tocado", () => {
      const casos: Array<[string, (c: Cliente) => string, Opcoes["semPorta"]]> = [
        ["outra porta", (c) => `DOUG_IMAGE=${OLD}\nDOUG_HOST_PORT=${c.porta + 98}\n`, false],
        ["sem DOUG_HOST_PORT com porta no registro", () => `DOUG_IMAGE=${OLD}\n`, false],
        ["DOUG_HOST_PORT com `-` no registro", (c) => `DOUG_IMAGE=${OLD}\nDOUG_HOST_PORT=${c.porta}\n`, true],
        ["porta que não é número", () => `DOUG_IMAGE=${OLD}\nDOUG_HOST_PORT=abc\n`, false],
      ];
      for (const [nome, env, semPorta] of casos) {
        const a = ambiente([c1], { env, semPorta });
        const { code, out } = a.rodar([NEW]);
        expect([nome, code]).toEqual([nome, 1]);
        expect(out).toMatch(/FALHOU: (o registro diz a porta|DOUG_HOST_PORT)/);
        expect(tocou(a, c1)).toBe(false);
        expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
      }
    });

    test("iguais (com aspas, export ou espaços): passa", () => {
      const a = ambiente([c1], { env: () => `export DOUG_HOST_PORT = "3101"\nDOUG_IMAGE=${OLD}\n` });
      expect(a.rodar([NEW]).code).toBe(0);
    });
  });

  describe("sem porta publicada (proxy externo): o health vem de dentro do contêiner", () => {
    const curlFoi = (a: Ambiente) => existsSync(join(a.state, "curl-calls"));
    const execs = (a: Ambiente, c: Cliente) =>
      deste(a.chamadas(), c).filter((l) => l.startsWith("compose exec -T agentes bun -e "));

    test("aviso, parada, backup, troca e volta, tudo sem curl no host; o registro e o .env seguem sem porta", () => {
      const a = ambiente(trio, { semPorta: true });
      a.marca("unhealthy", `002-cafe-sol ${NEW}\n`);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(3);
      expect(out).toContain("sem porta publicada: o health é lido de dentro do contêiner");
      expect(out).toContain("Atualizados (2): 001-padaria-aurora 003-oficina-lua");
      expect(out).toContain("Voltaram para a anterior (1): 002-cafe-sol");
      expect(curlFoi(a)).toBe(false);
      for (const c of [c1, c3]) {
        const t = todas(a.chamadas(), c);
        const kill = t.findIndex((l) => l.includes("kill -s SIGUSR2"));
        const dump = t.findIndex((l) => l.includes("pg_dump"));
        const up = t.findIndex((l) => l.endsWith("compose up -d"));
        expect(kill).toBeGreaterThanOrEqual(0);
        expect(kill).toBeLessThan(dump);
        expect(dump).toBeLessThan(up);
        expect(execs(a, c).length).toBeGreaterThan(2);
        expect(a.env(c)).toBe(envDe(c, NEW, true));
      }
      // the one that did not get healthy went back, and its registry line still says `-`
      expect(a.env(c2)).toBe(envDe(c2, OLD, true));
      expect(a.registro()).toContain(`002\tcafe-sol\tNome cafe-sol\t-\t${OLD}\t`);
      expect(a.registro()).toContain(`001\tpadaria-aurora\tNome padaria-aurora\t-\t${NEW}\t`);
    });

    test("já na imagem sem health fica como falha; o servidor sem a parada não recebe o sinal; o ponto de parada demora", () => {
      const a = ambiente([c1], { semPorta: true });
      a.marca("unhealthy", `001-padaria-aurora ${OLD}\n`);
      a.marca("images", `${OLD}\n`);
      const { code, out } = a.rodar([OLD]);
      expect(code).toBe(1);
      expect(out).toContain("não responde ok");
      expect(curlFoi(a)).toBe(false);

      const b = ambiente([c1], { semPorta: true });
      b.marca("no-adr", `${c1.codigo}-${c1.slug}\n`);
      expect(b.rodar([NEW]).out).toContain("não conhece o aviso de troca");
      expect(deste(b.chamadas(), c1).some((l) => l.includes("kill"))).toBe(false);

      const d = ambiente([c1], { semPorta: true });
      d.marca(`script-${c1.codigo}-${c1.slug}`, "waiting\nwaiting\nready\n");
      const r = d.rodar([NEW], { DOUG_PARADA_TIMEOUT_S: "30" });
      expect(r.code).toBe(0);
      const t = todas(d.chamadas(), c1);
      expect(
        t
          .slice(
            0,
            t.findIndex((l) => l.includes("pg_dump")),
          )
          .filter((l) => l.endsWith("health")),
      ).toHaveLength(3);
      expect(curlFoi(d)).toBe(false);
    });

    test("o contrato da API também é lido de dentro, com 3 tentativas", () => {
      const a = ambiente([c1], { semPorta: true });
      a.marca(`openapi-${c1.codigo}-${c1.slug}`, "fail\npartial\n");
      const { code } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(a.chamadas().filter((l) => l.endsWith("openapi"))).toHaveLength(3);
      expect(deste(a.chamadas(), c1).some((l) => l.includes("kill -s SIGUSR2"))).toBe(true);
      expect(curlFoi(a)).toBe(false);
    });
  });

  // ─── cliente parado de propósito ─────────────────────────────────────────────────────────────────────────────────

  test("cliente parado de propósito: pulado com estado próprio, fora do código 1, sem ser ligado nem tocado", () => {
    const a = ambiente();
    a.marca("parado", "002-cafe-sol\n");
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("PARADO: nenhum contêiner do cliente roda");
    expect(out).toContain("Parados de propósito (1): 002-cafe-sol");
    expect(out).toContain("Atualizados (2): 001-padaria-aurora 003-oficina-lua");
    expect(out).toContain("Falharam (0): nenhum");
    expect(out).toContain("Sem iniciar (0): nenhum");
    expect(tocou(a, c2)).toBe(false);
    expect(a.env(c2)).toBe(envDe(c2, OLD));
    expect(a.registro()).toContain(`002\tcafe-sol\tNome cafe-sol\t3102\t${OLD}\t`);
    // all of them stopped: still not an error
    const b = ambiente([c1]);
    b.marca("parado", `${c1.codigo}-${c1.slug}\n`);
    const r = b.rodar([NEW]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Parados de propósito (1): 001-padaria-aurora");
    // the dry run says it too
    const c = ambiente([c1]);
    c.marca("parado", `${c1.codigo}-${c1.slug}\n`);
    expect(c.rodar(["--dry-run", NEW]).out).toContain("PARADO");
  });

  test("não conseguir ler o estado do cliente (docker compose ps falha) é falha, não 'parado'", () => {
    const a = ambiente([c1]);
    a.marca("ps-quebrado", `${c1.codigo}-${c1.slug}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("não li o estado do cliente");
    expect(out).toContain("Parados de propósito (0): nenhum");
    expect(tocou(a, c1)).toBe(false);
  });

  // ─── o prazo de 30 minutos do aviso ──────────────────────────────────────────────────────────────────────────────

  // The stub models the server's hold (apps/server/src/restart-hold.ts): `restart` shows in /api/health while the notice
  // holds, a second SIGUSR2 during it does nothing, the key goes away when it lets go by itself (30 min) and a signal
  // after that is accepted. The test shrinks the 30 min to `aviso-prazo-ms`.
  describe("o aviso de troca vale 30 min e um segundo sinal não o renova", () => {
    const sinais = (a: Ambiente) =>
      existsSync(join(a.state, "signals"))
        ? readFileSync(join(a.state, "signals"), "utf8").split("\n").filter(Boolean)
        : [];
    const dumpsVistos = (a: Ambiente) =>
      readFileSync(join(a.state, "dump-count"), "utf8").split("\n").filter(Boolean).map(Number);

    test("o aviso cai durante o backup: o health perde o restart, o sinal é aceito, o ready esperado e o backup refeito sem dois dumps no disco", () => {
      const a = ambiente([c1]);
      a.marca("aviso-prazo-ms", "1000");
      a.marca("slow-dump", "1"); // the first dump outlives the notice
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("o health não diz restart: ready");
      expect(out).toContain("refazendo o backup");
      const t = todas(a.chamadas(), c1);
      const idx = (re: RegExp) => t.flatMap((l, i) => (re.test(l) ? [i] : []));
      const kills = idx(/kill -s SIGUSR2/);
      const dumps = idx(/pg_dump/);
      const up = t.findIndex((l) => l.endsWith("compose up -d"));
      expect(kills).toHaveLength(2);
      expect(dumps).toHaveLength(2);
      // notice, ready, dump, health (the key is gone), notice again, ready again, dump again, then the swap
      expect(kills[0] as number).toBeLessThan(dumps[0] as number);
      expect(dumps[0] as number).toBeLessThan(kills[1] as number);
      expect(kills[1] as number).toBeLessThan(dumps[1] as number);
      expect(dumps[1] as number).toBeLessThan(up);
      expect(t.slice(dumps[0] as number, kills[1] as number).some((l) => l.endsWith("health"))).toBe(true);
      expect(t.slice(kills[1] as number, dumps[1] as number).some((l) => l.endsWith("health"))).toBe(true);
      // the server took both: the second came after the first notice had let go
      expect(sinais(a)).toEqual(["aceito", "aceito"]);
      // never two dumps on the disk: the second pg_dump started with none (its .parcial is not a .dump)
      expect(dumpsVistos(a)).toEqual([0, 0]);
      expect(a.backups(c1)).toHaveLength(1);
      expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
    });

    test("dentro do prazo (o padrão, 30 min): um só sinal, um só backup, nada de reenvio", () => {
      const a = ambiente([c1]);
      a.marca("slow-dump", "1");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).not.toContain("mando o sinal de novo");
      expect(deste(a.chamadas(), c1).filter((l) => l.includes("kill -s SIGUSR2"))).toHaveLength(1);
      expect(deste(a.chamadas(), c1).filter((l) => l.includes("pg_dump"))).toHaveLength(1);
      expect(sinais(a)).toEqual(["aceito"]);
    });

    test("um health que volta sem ready com o aviso ainda valendo: o sinal é ignorado pelo servidor, o ready é esperado e o backup refeito", () => {
      const a = ambiente([c1]);
      // the first read says ready; the one after the dump says waiting; the next says ready
      a.marca(`script-${c1.codigo}-${c1.slug}`, "ready\nwaiting\nready\n");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("refazendo o backup");
      expect(sinais(a)).toEqual(["aceito", "ignorado"]);
      expect(deste(a.chamadas(), c1).filter((l) => l.includes("pg_dump"))).toHaveLength(2);
      expect(dumpsVistos(a)).toEqual([0, 0]);
      expect(a.backups(c1)).toHaveLength(1);
    });

    test("sem ponto de parada no limite (o servidor trabalhando): troca assim mesmo, sem segundo sinal nem segundo backup", () => {
      const a = ambiente([c1]);
      a.marca("never-ready", `${c1.codigo}-${c1.slug}\n`);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("o ponto de parada não veio");
      expect(sinais(a)).toEqual(["aceito"]);
      expect(deste(a.chamadas(), c1).filter((l) => l.includes("pg_dump"))).toHaveLength(1);
    });

    test("o segundo sinal não chega ao servidor (parado depois do backup): troca com o backup que há", () => {
      const a = ambiente([c1]);
      // the key is gone after the dump and the signal finds nobody: `compose kill` fails from then on
      a.marca("aviso-prazo-ms", "1000");
      a.marca("slow-dump", "1");
      a.marca("kill-falha-depois", "1");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("o servidor não recebeu o aviso de novo");
      expect(a.backups(c1)).toHaveLength(1);
      expect(deste(a.chamadas(), c1).filter((l) => l.includes("pg_dump"))).toHaveLength(1);
    });
  });

  // ─── o script morto em cada ponto da troca ───────────────────────────────────────────────────────────────────────

  describe("SIGTERM e SIGHUP em cada ponto da troca", () => {
    async function aguardar(arquivo: string) {
      const fim = Date.now() + 10_000;
      while (Date.now() < fim && !existsSync(arquivo)) await Bun.sleep(20);
      expect(existsSync(arquivo)).toBe(true);
    }
    async function matar(
      a: Ambiente,
      extra: Record<string, string>,
      espera: string,
      sinal: "SIGTERM" | "SIGHUP" = "SIGTERM",
    ) {
      const proc = Bun.spawn(["bash", script, NEW], { env: a.ambienteDoScript(extra), stdout: "pipe", stderr: "pipe" });
      await aguardar(join(a.state, espera));
      await Bun.sleep(150);
      proc.kill(sinal);
      const code = await proc.exited;
      const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
      return { code, out };
    }
    const nada = (a: Ambiente) => {
      expect(a.env(c1)).toBe(envDe(c1, OLD));
      expect(existsSync(`${a.pasta(c1)}/.env.antes-atualizar`)).toBe(false);
      expect(readdirSync(a.pasta(c1)).filter((n) => n.includes(".atualizando."))).toEqual([]);
      expect(a.registro()).toContain(`\t${OLD}\t`);
    };

    test("durante a espera do ponto de parada: o .env não muda, o guarda some e o aviso é deixado correr", async () => {
      const a = ambiente([c1]);
      a.marca("never-ready", `${c1.codigo}-${c1.slug}\n`);
      const { code, out } = await matar(
        a,
        { DOUG_PARADA_TIMEOUT_S: "60", DOUG_POLL_S: "1" },
        `signaled-${c1.codigo}-${c1.slug}`,
      );
      expect(code).toBe(143);
      expect(out).toContain("INTERROMPIDO");
      nada(a);
      // work is running there: it is not restarted; the notice lets go by itself
      expect(out).toContain("se solta sozinho em 30 minutos");
      const d = deste(a.chamadas(), c1);
      expect(d.some((l) => l.includes("restart") || l.includes("up -d") || l.includes("pg_dump"))).toBe(false);
      expect(a.backups(c1)).toEqual([]);
    });

    test("durante o backup: o dump pela metade sai, o .env não muda e o servidor, sem nada rodando, é reiniciado", async () => {
      const a = ambiente([c1]);
      a.marca("slow-dump", "1");
      const { code, out } = await matar(a, {}, "dump-started");
      expect(code).toBe(143);
      expect(out).toContain("INTERROMPIDO");
      nada(a);
      expect(out).toContain("servidor reiniciado na mesma imagem");
      expect(a.backups(c1)).toEqual([]); // neither the dump nor its .parcial
      const d = deste(a.chamadas(), c1);
      expect(d).toContain("compose restart agentes");
      expect(d.some((l) => l === "compose up -d")).toBe(false);
    });

    test("SIGHUP (a sessão que a rodou fechou) desfaz do mesmo jeito", async () => {
      const a = ambiente([c1]);
      a.marca("slow-dump", "1");
      const { code, out } = await matar(a, {}, "dump-started", "SIGHUP");
      expect(code).toBe(129);
      expect(out).toContain("INTERROMPIDO");
      nada(a);
      expect(a.backups(c1)).toEqual([]);
    });

    test("durante a volta para a imagem anterior: o .env já é o de antes, sem guarda, e nenhuma marca é gravada", async () => {
      const a = ambiente([c1]);
      a.marca("unhealthy", `${c1.codigo}-${c1.slug} ${NEW}\n`);
      a.marca("slow-up-2", "1"); // the first `up -d` is the swap, the second is the way back
      const { code, out } = await matar(a, {}, `up-started-2`);
      expect(code).toBe(143);
      expect(out).toContain("INTERROMPIDO");
      expect(out).toContain("voltando para");
      nada(a);
      // the new container holds no notice: nothing was restarted on top of it
      expect(deste(a.chamadas(), c1).some((l) => l.includes("restart"))).toBe(false);
      expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(OLD);
      // the dump of the try that went back stays, out of the rotation
      expect(a.backups(c1)).toHaveLength(1);
      expect(a.backups(c1)[0]).toStartWith("falhou-");
      expect(existsSync(join(a.raiz, "atualizacao", "marcas", `001__${NEW_TAG}`))).toBe(false);
    });
  });

  // ─── trava, cota ─────────────────────────────────────────────────────────────────────────────────────────────────

  describe("a trava do doug-cliente com espera (flock -w)", () => {
    async function segurar(trava: string, segundos: number) {
      writeFileSync(trava, "");
      const dono = Bun.spawn(["flock", trava, "sleep", String(segundos)]);
      for (let i = 0; i < 50 && Bun.spawnSync(["flock", "-n", trava, "true"]).exitCode === 0; i++) await Bun.sleep(100);
      return dono;
    }

    test("com espera maior que 0, o cliente espera a trava soltar e é atualizado", async () => {
      const a = ambiente([c1]);
      const dono = await segurar(join(a.raiz, ".lock"), 2);
      try {
        const antes = Date.now();
        const { code, out } = a.rodar([NEW], { DOUG_TRAVA_ESPERA_S: "20" });
        expect(code).toBe(0);
        expect(Date.now() - antes).toBeGreaterThan(800);
        expect(out).toContain("Atualizados (1): 001-padaria-aurora");
        expect(a.env(c1)).toContain(`DOUG_IMAGE=${NEW}`);
      } finally {
        dono.kill();
      }
    });

    test("a espera acaba: com a trava ainda de outro, o cliente fica para a próxima rodada, sem ser tocado", async () => {
      const a = ambiente([c1]);
      const dono = await segurar(join(a.raiz, ".lock"), 30);
      try {
        const antes = Date.now();
        const { code, out } = a.rodar([NEW], { DOUG_TRAVA_ESPERA_S: "1" });
        expect(Date.now() - antes).toBeGreaterThan(800);
        expect(code).toBe(1);
        expect(out).toContain("o doug-cliente está com a trava");
        expect(tocou(a, c1)).toBe(false);
        expect(a.env(c1)).toBe(envDe(c1, OLD));
      } finally {
        dono.kill();
      }
    });
  });

  describe("DOUG_QUOTA_ESTRITA", () => {
    test("sem ela, passar da cota é só um aviso; com =1, o cliente não é atualizado nem tocado", () => {
      const a = ambiente([c1]);
      const solta = a.rodar([NEW], { DOUG_CLIENT_QUOTA_GB: "0" });
      expect(solta.code).toBe(0);
      expect(solta.out).toContain("COTA: ");
      const b = ambiente([c1]);
      const estrita = b.rodar([NEW], { DOUG_CLIENT_QUOTA_GB: "0", DOUG_QUOTA_ESTRITA: "1" });
      expect(estrita.code).toBe(1);
      expect(estrita.out).toContain("cota excedida");
      expect(estrita.out).toContain("Falharam (1): 001-padaria-aurora");
      expect(tocou(b, c1)).toBe(false);
      expect(b.env(c1)).toBe(envDe(c1, OLD));
      // within the quota, strict or not
      const c = ambiente([c1]);
      expect(c.rodar([NEW], { DOUG_QUOTA_ESTRITA: "1" }).code).toBe(0);
    });
  });

  test("uma morte depois do health bom, antes do registro, não devolve o cliente à imagem anterior", async () => {
    // the registry is written slowly: the awk of the registry is where the script is killed
    const a = ambiente([c1]);
    a.marca("slow-registro", "1");
    const lento = join(dir, `bin-${rodadas}`);
    stub(
      lento,
      "awk",
      `#!/usr/bin/env bash
if [[ -e $STUB_STATE/slow-registro && " $* " == *" -v i="* ]]; then touch "$STUB_STATE/registro-comecou"; sleep 1.5; fi
exec /usr/bin/awk "$@"
`,
    );
    const proc = Bun.spawn(["bash", script, NEW], { env: a.ambienteDoScript(), stdout: "pipe", stderr: "pipe" });
    const fim = Date.now() + 10_000;
    while (Date.now() < fim && !existsSync(join(a.state, "registro-comecou"))) await Bun.sleep(20);
    expect(existsSync(join(a.state, "registro-comecou"))).toBe(true);
    proc.kill("SIGTERM");
    const code = await proc.exited;
    const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
    expect(code).toBe(143);
    // the swap had worked: the new image stays, no guard, nothing put back
    expect(a.env(c1)).toBe(envDe(c1, NEW));
    expect(existsSync(`${a.pasta(c1)}/.env.antes-atualizar`)).toBe(false);
    expect(out).not.toContain("devolvido à imagem anterior");
    expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(NEW);
    expect(deste(a.chamadas(), c1).filter((l) => l === "compose up -d")).toHaveLength(1);
  });

  // ─── o disjuntor lembra entre rodadas ────────────────────────────────────────────────────────────────────────────

  describe("o disjuntor lembra entre rodadas", () => {
    const quatro = [...trio, c4];
    const estragados = (cs: Cliente[]) => cs.map((c) => `${c.codigo}-${c.slug} ${NEW}`).join("\n");

    test("duas rodadas com a mesma imagem: a segunda, com as marcas do limite, sai com 1 sem tocar em ninguém; --forcar passa por cima", () => {
      const a = ambiente(quatro);
      a.marca("unhealthy", estragados(quatro));
      const primeira = a.rodar([NEW]);
      expect(primeira.code).toBe(1);
      expect(primeira.out).toContain("Voltaram para a anterior (2): 001-padaria-aurora 002-cafe-sol");
      expect(primeira.out).toContain("Sem iniciar (2): 003-oficina-lua 004-livraria-mar");
      const feitas = a.chamadas().length;

      // the next night: 001 and 002 carry the mark, and that is already DOUG_DISJUNTOR of them: nobody is touched
      const segunda = a.rodar([NEW]);
      expect(segunda.code).toBe(1);
      expect(segunda.out).toContain("DISJUNTOR");
      expect(segunda.out).toContain("não toquei em ninguém");
      expect(
        a
          .chamadas()
          .slice(feitas)
          .filter((l) => l.includes("compose")),
      ).toEqual([]);
      for (const c of quatro) expect(a.env(c)).toBe(envDe(c, OLD));
      expect(a.registro()).not.toContain(NEW);

      // another image has no marks: the round goes on (and here the new image is fine)
      a.marca("images", `agentes-zim:doug-ddd444\n${NEW}\n${OLD}\n`);
      expect(a.rodar(["doug-ddd444"]).code).toBe(0);

      // --forcar goes over it: the marked client is tried again
      const forcada = a.rodar(["--forcar", "--so", "001", NEW]);
      expect(forcada.out).not.toContain("DISJUNTOR");
      expect(deste(a.chamadas().slice(feitas), c1).some((l) => l.includes("pg_dump"))).toBe(true);
    });

    test("uma marca de antes e uma volta nesta rodada fazem o limite: os outros ficam sem iniciar", () => {
      const a = ambiente(quatro);
      a.marca("unhealthy", estragados([c1, c2]));
      // first night: only 001 (one mark: under the limit of 2)
      expect(a.rodar(["--so", "001", NEW]).code).toBe(3);
      const feitas = a.chamadas().length;
      // second night: 001 is skipped (its mark), 002 goes back (the second one) and the round stops
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(1);
      expect(out).toContain("Pulados (1): 001-padaria-aurora");
      expect(out).toContain("Voltaram para a anterior (1): 002-cafe-sol");
      expect(out).toContain("Sem iniciar (2): 003-oficina-lua 004-livraria-mar");
      expect(tocou(a, c3)).toBe(false);
      expect(tocou(a, c4)).toBe(false);
      expect(deste(a.chamadas().slice(feitas), c1).some((l) => l.includes("pg_dump"))).toBe(false);
    });

    test("marcas de uma imagem não contam para outra, nem as de um cliente que saiu do registro", () => {
      const a = ambiente(quatro);
      a.marca("unhealthy", estragados(quatro));
      a.rodar([NEW]);
      a.marca("images", `agentes-zim:doug-ddd444\n${NEW}\n${OLD}\n`);
      expect(a.rodar(["doug-ddd444"]).out).not.toContain("DISJUNTOR");
      // 001 and 002 leave the registry: their marks are no one's
      const linhas = a
        .registro()
        .split("\n")
        .filter((l) => !l.startsWith("001\t") && !l.startsWith("002\t"));
      writeFileSync(join(a.raiz, "clientes.tsv"), linhas.join("\n"));
      expect(a.rodar([NEW]).out).not.toContain("DISJUNTOR");
    });
  });

  // ─── a causa da falha fica no log ────────────────────────────────────────────────────────────────────────────────

  describe("a causa da falha", () => {
    const logDe = (a: Ambiente, c: Cliente) => {
      const logs = join(a.raiz, "logs");
      const [rodada] = readdirSync(logs);
      return readFileSync(join(logs, rodada as string, `${c.codigo}-${c.slug}.log`), "utf8");
    };

    test("a migração que falha: a saída do migrate vai para o log do cliente e o motivo é específico", () => {
      const a = ambiente([c1]);
      a.marca("migrate-fails", `${c1.codigo}-${c1.slug}\n`);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(3);
      expect(out).toContain("a troca para");
      expect(out).toContain("a migração falhou");
      expect(out).not.toContain("não ficou saudável em");
      expect(logDe(a, c1)).toContain('ERRO: relation "tarefas" already exists');
      expect(out).not.toContain('relation "tarefas"'); // the output is in the log, not on the terminal
    });

    test("o up -d recusado: o motivo é 'o compose recusou' e o erro do Docker está no log", () => {
      const a = ambiente([c1]);
      a.marca("up-falha-1", "1");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(3);
      expect(out).toContain("o compose recusou o up -d");
      expect(out).not.toContain("não ficou saudável em");
      expect(logDe(a, c1)).toContain("port is already allocated");
      expect(a.env(c1)).toBe(envDe(c1, OLD));
    });

    test("health que não fica ok: o motivo diz isso, e não 'a migração' nem 'o compose'", () => {
      const a = ambiente([c1]);
      a.marca("unhealthy", `${c1.codigo}-${c1.slug} ${NEW}\n`);
      const { out } = a.rodar([NEW]);
      expect(out).toContain("o /api/health não disse ok em 1s");
    });

    test("a saída do kill, do restart e do pg_dump também vai para o log", () => {
      const a = ambiente([c1]);
      a.marca("dump-fails", `${c1.codigo}-${c1.slug}\n`);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(1);
      expect(out).not.toContain("stub-kill");
      expect(out).not.toContain("stub-restart");
      const log = logDe(a, c1);
      expect(log).toContain("stub-kill: SIGUSR2 entregue");
      expect(log).toContain("pg_dump: erro");
      expect(log).toContain("stub-restart: reiniciado");
    });

    test("cliente sem DOUG_UID no .env: a falha do compose sugere `doug-cliente compose <codigo>`, sem calcular um uid", () => {
      const a = ambiente([c1]);
      a.marca("migrate-fails", `${c1.codigo}-${c1.slug}\n`);
      const r = a.rodar([NEW]);
      expect(r.out).toContain("`doug-cliente compose 001`");
      expect(r.out).not.toContain("100001");
      expect(a.env(c1)).not.toContain("DOUG_UID");

      const b = ambiente([c1]);
      b.marca("up-falha-1", "1");
      expect(b.rodar([NEW]).out).toContain("`doug-cliente compose 001`");

      const c = ambiente([c1]);
      c.marca("ps-quebrado", `${c1.codigo}-${c1.slug}\n`);
      expect(c.rodar([NEW]).out).toContain("`doug-cliente compose 001`");

      // a client that has it: no hint
      const d = ambiente([c1], { env: (x) => `${envDe(x, OLD)}DOUG_UID=100001\n` });
      d.marca("migrate-fails", `${c1.codigo}-${c1.slug}\n`);
      expect(d.rodar([NEW]).out).not.toContain("doug-cliente compose");
    });
  });

  // ─── prazo nos comandos ──────────────────────────────────────────────────────────────────────────────────────────

  describe("prazo no migrate, no pg_dump e no up -d", () => {
    test("um up -d que estoura o prazo é falha: a volta age e o motivo diz o prazo", () => {
      const a = ambiente([c1]);
      a.marca("slow-up-1", "1"); // the swap hangs; the way back is quick
      const { code, out } = a.rodar([NEW], { DOUG_UP_TIMEOUT_S: "1" });
      expect(code).toBe(3);
      expect(out).toContain("estourou o prazo de 1s (DOUG_UP_TIMEOUT_S)");
      expect(out).toContain("VOLTOU");
      expect(a.env(c1)).toBe(envDe(c1, OLD));
      expect(deste(a.chamadas(), c1).filter((l) => l === "compose up -d")).toHaveLength(2);
    });

    test("uma migração que estoura o prazo é falha: o cliente volta, e o up -d da troca nem roda", () => {
      const a = ambiente([c1]);
      a.marca("slow-migrate", "1");
      const { code, out } = a.rodar([NEW], { DOUG_MIGRATE_TIMEOUT_S: "1" });
      expect(code).toBe(3);
      expect(out).toContain("a migração estourou o prazo de 1s (DOUG_MIGRATE_TIMEOUT_S)");
      expect(a.env(c1)).toBe(envDe(c1, OLD));
      expect(deste(a.chamadas(), c1).filter((l) => l === "compose up -d")).toHaveLength(1); // the way back only
    });

    test("um pg_dump que estoura o prazo: o cliente não é tocado, nada fica pela metade e o servidor sai do aviso", () => {
      const a = ambiente([c1]);
      a.marca("slow-dump", "1");
      const { code, out } = a.rodar([NEW], { DOUG_BACKUP_TIMEOUT_S: "1" });
      expect(code).toBe(1);
      expect(out).toContain("o pg_dump estourou o prazo de 1s (DOUG_BACKUP_TIMEOUT_S)");
      expect(a.env(c1)).toBe(envDe(c1, OLD));
      expect(a.backups(c1)).toEqual([]);
      const d = deste(a.chamadas(), c1);
      expect(d.some((l) => l.includes("migrate") || l === "compose up -d")).toBe(false);
      expect(d).toContain("compose restart agentes");
    });

    test("com prazos folgados (e 0, sem prazo) nada muda", () => {
      const a = ambiente([c1]);
      expect(
        a.rodar([NEW], { DOUG_UP_TIMEOUT_S: "600", DOUG_MIGRATE_TIMEOUT_S: "0", DOUG_BACKUP_TIMEOUT_S: "3600" }).code,
      ).toBe(0);
    });
  });

  // ─── sem porta: só uma defesa ────────────────────────────────────────────────────────────────────────────────────

  test("nenhum docker compose lê a entrada do script: a entrada de cada chamada é /dev/null", () => {
    for (const semPorta of [false, true]) {
      const a = ambiente([c1], { semPorta });
      const { code } = a.rodar([NEW], {}, new Uint8Array([10, 10, 10])); // the script's own stdin is a pipe with data
      expect(code).toBe(0);
      const linhas = readFileSync(join(a.state, "stdin-calls"), "utf8").split("\n").filter(Boolean);
      expect(linhas.length).toBeGreaterThan(5);
      if (semPorta) expect(linhas.some((l) => l.startsWith("compose exec -T agentes bun -e "))).toBe(true);
      for (const l of linhas) expect(l.endsWith(" stdin=/dev/null")).toBe(true);
    }
  });

  // ─── validações e o resumo ───────────────────────────────────────────────────────────────────────────────────────

  describe("validações de entrada", () => {
    const numericas = [
      "DOUG_CLIENT_QUOTA_GB",
      "DOUG_PARADA_TIMEOUT_S",
      "DOUG_SAUDE_TIMEOUT_S",
      "DOUG_MIGRATE_TIMEOUT_S",
      "DOUG_BACKUP_TIMEOUT_S",
      "DOUG_UP_TIMEOUT_S",
      "DOUG_POLL_S",
      "DOUG_FALHAS_SEGUIDAS",
      "DOUG_BACKUPS_GUARDADOS",
      "DOUG_FALHOU_GUARDADOS",
      "DOUG_FOLGA_GB",
      "DOUG_DISJUNTOR",
      "DOUG_TRAVA_ESPERA_S",
      "DOUG_DONO_UID",
    ];

    test("toda variável numérica ruim sai com 2, nomeando a variável, sem tocar em nada", () => {
      const a = ambiente([c1]);
      for (const nome of numericas) {
        for (const ruim of ["abc", "1.5", "-1", "10s", "1 2"]) {
          const r = a.rodar([NEW], { [nome]: ruim });
          expect(r.code).toBe(2);
          expect(r.out).toContain(`${nome} tem de ser um número inteiro`);
        }
      }
      expect(a.chamadas()).toEqual([]);
      expect(existsSync(join(a.raiz, "logs"))).toBe(false);
    });

    test("--help não depende do ambiente numérico ruim, e valores bons passam", () => {
      const a = ambiente([c1]);
      expect(a.rodar(["--help"], { DOUG_POLL_S: "abc" }).code).toBe(0);
      expect(a.rodar([NEW], { DOUG_DISJUNTOR: "5", DOUG_BACKUPS_GUARDADOS: "7", DOUG_FALHAS_SEGUIDAS: "4" }).code).toBe(
        0,
      );
    });

    test("a imagem lida do container principal é validada como a tag; um digest com @sha256: serve", () => {
      const digest = `agentes-zim@sha256:${"a1".repeat(32)}`;
      const a = ambiente([c1]);
      a.marca("images", `${digest}\n${OLD}\n${NEW}\n`);
      a.marca("principal", digest);
      const { code } = a.rodar();
      expect(code).toBe(0);
      expect(a.env(c1)).toContain(`DOUG_IMAGE=${digest}`);
      expect(a.registro()).toContain(`\t${digest}\t`);

      for (const ruim of [
        "agentes-zim:doug-x; touch /tmp/pwn",
        "agentes zim:doug",
        "-rf",
        'agentes-zim:"x"',
        "$(id)",
      ]) {
        const b = ambiente([c1]);
        b.marca("images", `${ruim}\n${OLD}\n`);
        b.marca("principal", ruim);
        const r = b.rodar();
        expect(r.code).toBe(2);
        expect(r.out).toContain("não tem a forma de uma imagem");
        expect(tocou(b, c1)).toBe(false);
      }
      // a tag with `@` given by hand follows the same rule
      const c = ambiente([c1]);
      c.marca("images", `${digest}\n${OLD}\n`);
      expect(c.rodar([digest]).code).toBe(0);
      expect(c.rodar(["a;b"]).code).toBe(2);
    });
  });

  test("cliente que já está na imagem, com o registro velho: a coluna imagem é acertada (no --dry-run, só dita)", () => {
    // the .env says NEW and the server is healthy, but the registry still says OLD (a round that died after the mv)
    const a = ambiente([c1, c2], { env: (c) => envDe(c, c.codigo === "001" ? NEW : OLD) });
    a.marca(`running-${c1.codigo}-${c1.slug}`, NEW); // and the container really runs it
    const seco = a.rodar(["--dry-run", NEW]);
    expect(seco.out).toContain("[simulação] o registro diz");
    expect(a.registro()).toContain(`\t${OLD}\t`);
    expect(a.registro()).not.toContain(`\t${NEW}\t`);

    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("Já na imagem (1): 001-padaria-aurora");
    expect(a.registro()).toContain(`001\tpadaria-aurora\tNome padaria-aurora\t3101\t${NEW}\t2026-11-01`);
    expect(a.registro()).toContain(`002\tcafe-sol\tNome cafe-sol\t3102\t${NEW}\t2026-11-01`); // 002 was updated
    expect(existsSync(join(a.raiz, "clientes.tsv.anterior"))).toBe(true);
    expect(a.backups(c1)).toEqual([]);
    // the registry's other columns are untouched: the same number of columns on every line
    for (const l of a.registro().split("\n").filter(Boolean)) expect(l.split("\t")).toHaveLength(6);

    // with the registry right already, no write at all
    const antes = readFileSync(join(a.raiz, "clientes.tsv.anterior"), "utf8");
    a.rodar([NEW]);
    expect(readFileSync(join(a.raiz, "clientes.tsv.anterior"), "utf8")).toBe(antes);
  });

  test("o resumo começa por 'Parados de propósito', antes dos atualizados", () => {
    const a = ambiente();
    a.marca("parado", "002-cafe-sol\n");
    const { out } = a.rodar([NEW]);
    const resumo = out.slice(out.indexOf("Resumo ("));
    const linhas = resumo.split("\n");
    expect(linhas[1]).toBe("Parados de propósito (1): 002-cafe-sol");
    expect(linhas[2]).toStartWith("Atualizados (");
    const [rodada] = readdirSync(join(a.raiz, "logs"));
    expect(readFileSync(join(a.raiz, "logs", rodada as string, "resumo.txt"), "utf8").split("\n")[1]).toStartWith(
      "Parados de propósito (1)",
    );
  });
  // ─── o seguimento da revisão ─────────────────────────────────────────────────────────────────────────────────────

  describe("seguimento: dumps com o slug, aviso reconferido, migrate com nome, imagem que roda, disjuntor", () => {
    const kills = (a: Ambiente, c: Cliente) => deste(a.chamadas(), c).filter((l) => l === "compose kill -s SIGUSR2 agentes");

    test("a rotação filtra pelo slug: os dumps de outro slug com o mesmo código e os de antes do slug ficam", () => {
      const a = ambiente([c1]);
      const pasta = a.pastaBackups(c1);
      mkdirSync(pasta, { recursive: true, mode: 0o700 });
      const velhos = [
        `pre-${c1.slug}-x-20250101-030000.dump`,
        `pre-${c1.slug}-x-20250102-030000.dump`,
        `pre-${c1.slug}-x-20250103-030000.dump`,
        `pre-${c1.slug}-x-20250104-030000.dump`,
      ];
      const alheios = [
        "pre-padaria-x-20250101-030000.dump", // another client that had this code (a prefix of this slug, even)
        "pre-padaria-x-20250102-030000.dump",
        "pre-padaria-x-20250103-030000.dump",
        "pre-padaria-x-20250104-030000.dump",
        "falhou-padaria-x-20250101-030000.dump",
        "falhou-padaria-x-20250102-030000.dump",
        "falhou-padaria-x-20250103-030000.dump",
        "pre-agentes_zim_doug_old-20250101-030000.dump", // from before the name had the slug
      ];
      for (const f of [...velhos, ...alheios]) {
        writeFileSync(join(pasta, f), "x");
        utimesSync(join(pasta, f), new Date("2025-01-01T03:00:00Z"), new Date("2025-01-01T03:00:00Z"));
      }
      expect(a.rodar([NEW]).code).toBe(0);
      const ficou = readdirSync(pasta);
      for (const f of alheios) expect(ficou).toContain(f);
      expect(ficou.filter((n) => n.startsWith(`pre-${c1.slug}-`))).toHaveLength(3);
    });

    test("o backup de uma troca que volta vira falhou-<slug>-…, e a contagem de falhas é do slug", () => {
      const a = ambiente([c1]);
      a.marca("unhealthy", `${c1.codigo}-${c1.slug} ${NEW}\n`);
      expect(a.rodar([NEW]).code).toBe(3);
      expect(a.backups(c1)).toHaveLength(1);
      expect(a.backups(c1)[0]).toStartWith(`falhou-${c1.slug}-${DUMP_TAG}-`);
    });

    test("o aviso que cai durante a migração: o sinal é reenviado antes do up -d, sem refazer o backup", () => {
      const a = ambiente([c1]);
      a.marca("migrate-sinal", "1");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("antes do up -d o health não diz restart: ready");
      expect(out).toContain("Atualizados (1)");
      const d = deste(a.chamadas(), c1);
      expect(kills(a, c1)).toHaveLength(2);
      expect(d.filter((l) => l.includes("pg_dump"))).toHaveLength(1);
      // the second signal comes after the migration and before the up -d of the swap
      const ultimoKill = d.lastIndexOf("compose kill -s SIGUSR2 agentes");
      expect(ultimoKill).toBeGreaterThan(d.findIndex((l) => l.includes("migrate")));
      expect(ultimoKill).toBeLessThan(d.indexOf("compose up -d"));
    });

    test("o aviso que não volta: no máximo 2 voltas e a troca segue", () => {
      const a = ambiente([c1]);
      a.marca("migrate-sinal-ignora", "1");
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("volta 1 de 2");
      expect(out).toContain("volta 2 de 2");
      expect(out).not.toContain("volta 3");
      expect(out).toContain("depois de 2 voltas");
      expect(kills(a, c1)).toHaveLength(3); // the first one + two
      expect(deste(a.chamadas(), c1).filter((l) => l.includes("pg_dump"))).toHaveLength(1);
      expect(a.env(c1)).toBe(envDe(c1, NEW));
    });

    test("o migrate leva um --name, e o prazo estourado remove esse contêiner", () => {
      const a = ambiente([c1]);
      a.marca("slow-migrate", "1");
      a.rodar([NEW], { DOUG_MIGRATE_TIMEOUT_S: "1" });
      const run = deste(a.chamadas(), c1).find((l) => l.startsWith("compose run "));
      const nome = /--name (\S+)/.exec(run ?? "")?.[1];
      expect(nome).toMatch(/^doug-001-migrate-\d+$/);
      expect(readFileSync(join(a.state, "removidos"), "utf8").trim()).toBe(nome as string);
    });

    test("um migrate que termina (bem ou mal, sem prazo) não pede docker rm", () => {
      const a = ambiente([c1]);
      expect(a.rodar([NEW]).code).toBe(0);
      expect(existsSync(join(a.state, "removidos"))).toBe(false);
      const b = ambiente([c1]);
      b.marca("migrate-fails", `${c1.codigo}-${c1.slug}\n`);
      expect(b.rodar([NEW]).code).toBe(3);
      expect(existsSync(join(b.state, "removidos"))).toBe(false);
    });

    test("o .env já na imagem nova mas o contêiner roda outra: é troca, não 'já atual'", () => {
      const a = ambiente([c1], { env: (c) => envDe(c, NEW) });
      a.marca(`running-${c1.codigo}-${c1.slug}`, OLD);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("o servidor roda agentes-zim:doug-aaa111: trato como troca");
      expect(out).toContain("Atualizados (1)");
      expect(out).not.toContain("já está em");
      expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(NEW);
      expect(a.env(c1)).toBe(envDe(c1, NEW));
      expect(a.backups(c1)).toHaveLength(1);
    });

    test("a troca de um .env já adiantado que falha volta para a imagem que rodava", () => {
      const a = ambiente([c1], { env: (c) => envDe(c, NEW) });
      a.marca(`running-${c1.codigo}-${c1.slug}`, OLD);
      a.marca("unhealthy", `${c1.codigo}-${c1.slug} ${NEW}\n`);
      expect(a.rodar([NEW]).code).toBe(3);
      expect(a.env(c1)).toBe(envDe(c1, OLD));
      expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(OLD);
    });

    test("com a imagem certa rodando, continua 'já atual'", () => {
      const a = ambiente([c1], { env: (c) => envDe(c, NEW) });
      a.marca(`running-${c1.codigo}-${c1.slug}`, NEW);
      const { code, out } = a.rodar([NEW]);
      expect(code).toBe(0);
      expect(out).toContain("Já na imagem (1)");
      expect(tocou(a, c1)).toBe(false);
    });

    test("DOUG_DISJUNTOR=0 sai com 2 e não toca em nada", () => {
      const a = ambiente([c1]);
      const r = a.rodar([NEW], { DOUG_DISJUNTOR: "0" });
      expect(r.code).toBe(2);
      expect(r.out).toContain("DOUG_DISJUNTOR=0 não é aceito");
      expect(tocou(a, c1)).toBe(false);
      expect(a.rodar([NEW], { DOUG_DISJUNTOR: "1" }).code).toBe(0);
    });

    test("um cliente recuperado de uma execução interrompida não conta para o disjuntor", () => {
      const a = ambiente([c1, c2]);
      const env = join(a.pasta(c1), ".env");
      writeFileSync(`${env}.antes-atualizar`, envDe(c1, OLD));
      writeFileSync(env, envDe(c1, NEW));
      a.marca(`running-${c1.codigo}-${c1.slug}`, NEW);
      a.marca("unhealthy", `${c1.codigo}-${c1.slug} ${NEW}\n`);
      const { code, out } = a.rodar([NEW], { DOUG_DISJUNTOR: "1" });
      expect(code).toBe(3);
      expect(out).toContain("Voltaram para a anterior (1): 001-padaria-aurora");
      expect(out).toContain("Atualizados (1): 002-cafe-sol");
      expect(out).not.toContain("DISJUNTOR");
      expect(a.env(c2)).toBe(envDe(c2, NEW));
      // and it leaves no mark either: the next round tries it again
      expect(readdirSync(join(a.raiz, "atualizacao", "marcas"))).toEqual([]);
    });
  });
});
