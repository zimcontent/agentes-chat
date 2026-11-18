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
// a curl that answers each client's /api/health and /api/openapi.json, a systemctl and an awk that can fail. The state
// folder says what exists and what happens, one file per fact:
//   images            names that exist, one per line
//   principal         the image the main instance's container runs
//   principal-state   what `systemctl is-active` says about the main instance's update
//   port-<porta>      the folder that owns that port
//   running-<pasta>   the image `up -d` last started; ps-<pasta> says another one to `compose ps`
//   signaled-<pasta>  set by SIGUSR2, cleared by `up -d` and `restart` (a new container holds nothing)
//   unhealthy         lines `<pasta> <imagem>` that never get healthy
//   script-<pasta>    one health answer per line, used first: fail, waiting, ready, plain
//   never-ready, ignora-sinal, no-adr, dump-fails, migrate-fails   folders (one per line)
//   slow-up           the next `up -d` takes a while, once (to kill the script in the middle of it)
//   awk-falha         the awk that rewrites the registry fails
//   tira-do-registro  a codigo that the next `up -d` takes out of the registry (a `remover` in the middle of a round)
const docker = `#!/usr/bin/env bash
state=$STUB_STATE
here=-
if [[ $1 == compose && $2 == -p ]]; then
  here=$(basename "$5"); dir=$5
  set -- compose "\${@:10}"
fi
printf '%s\\n' "docker[$here] $*" >>"$state/calls"
case "$*" in
"image inspect "*) grep -qx "$3" "$state/images" ;;
"inspect --format {{.Config.Image}} agentes-chat-agentes-1") cat "$state/principal" 2>/dev/null || exit 1 ;;
"compose kill -s SIGUSR2 agentes") touch "$state/signaled-$here" ;;
"compose restart agentes") rm -f "$state/signaled-$here" ;;
"compose exec -T postgres pg_dump -Fc -U agentes agentes")
  if grep -qx "$here" "$state/dump-fails" 2>/dev/null; then echo "pg_dump: erro" >&2; exit 1; fi
  echo "PGDMP de $here" ;;
"compose up -d")
  if [[ -e $state/slow-up ]]; then rm -f "$state/slow-up"; touch "$state/up-started"; sleep 1.5; fi
  sed -nE 's/^(export +)?DOUG_IMAGE=//p' "$dir/.env" | tail -n1 | tr -d "\\"'" >"$state/running-$here"
  rm -f "$state/signaled-$here"
  if [[ -s $state/tira-do-registro ]]; then
    grep -v "^$(cat "$state/tira-do-registro")"$'\\t' "$DOUG_CLIENTES_DIR/clientes.tsv" >"$DOUG_CLIENTES_DIR/clientes.novo"
    mv "$DOUG_CLIENTES_DIR/clientes.novo" "$DOUG_CLIENTES_DIR/clientes.tsv"
  fi ;;
"compose ps --format {{.Image}} agentes") cat "$state/ps-$here" 2>/dev/null || cat "$state/running-$here" ;;
"compose run --rm --no-deps -T agentes migrate")
  if grep -qx "$here" "$state/migrate-fails" 2>/dev/null; then exit 1; fi ;;
*) echo "docker: chamada inesperada: $*" >&2; exit 99 ;;
esac
`;
const curl = `#!/usr/bin/env bash
state=$STUB_STATE
url=\${@: -1}
rest=\${url#http://127.0.0.1:}; port=\${rest%%/*}; path=/\${rest#*/}
here=$(cat "$state/port-$port" 2>/dev/null) || exit 7
if [[ $path == /api/openapi.json ]]; then
  echo "curl[$here] openapi" >>"$state/calls"
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
    if [[ -e $state/signaled-$here ]] && ! grep -qx "$here" "$state/ignora-sinal" 2>/dev/null; then
      if grep -qx "$here" "$state/never-ready" 2>/dev/null; then restart=',"restart":"waiting"'; else restart=',"restart":"ready"'; fi
    fi ;;
esac
printf '{"status":"ok","version":"1"%s}\\n' "$restart"
`;
const systemctl = `#!/usr/bin/env bash
cat "$STUB_STATE/principal-state" 2>/dev/null || echo inactive
`;
const awk = `#!/usr/bin/env bash
if [[ -e $STUB_STATE/awk-falha && " $* " == *" -v i="* ]]; then echo "linha pela metade"; exit 1; fi
exec /usr/bin/awk "$@"
`;

const OLD = "agentes-zim:doug-aaa111";
const NEW = "agentes-zim:doug-bbb222";
const NEW_TAG = "agentes-zim_doug-bbb222";

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
}

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
  writeFileSync(join(state, "calls"), "");
  writeFileSync(join(state, "images"), `${NEW}\n${OLD}\n`);
  writeFileSync(join(state, "principal"), NEW);
  const linhas = ["codigo\tslug\tnome\tporta\timagem\tcriado_em"];
  for (const c of clientes) {
    const pasta = `${c.codigo}-${c.slug}`;
    mkdirSync(join(raiz, pasta, "dados"), { recursive: true });
    writeFileSync(join(raiz, pasta, "compose.yml"), "services: {}\n");
    const env = opcoes.env?.(c) ?? `POSTGRES_PASSWORD=segredo-${c.codigo}\nDOUG_IMAGE=${OLD}\nOUTRA=1\n`;
    writeFileSync(join(raiz, pasta, ".env"), env);
    chmodSync(join(raiz, pasta), 0o755);
    chmodSync(join(raiz, pasta, "compose.yml"), 0o644);
    chmodSync(join(raiz, pasta, ".env"), 0o644);
    writeFileSync(join(state, `port-${c.porta}`), pasta);
    writeFileSync(join(state, `running-${pasta}`), OLD);
    linhas.push(`${c.codigo}\t${c.slug}\tNome ${c.slug}\t${c.porta}\t${OLD}\t2026-11-01`);
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
    rodar(args: string[] = [], extra: Record<string, string> = {}) {
      const r = Bun.spawnSync(["bash", script, ...args], { env: ambienteDoScript(extra) });
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
      expect(a.env(c)).toBe(`POSTGRES_PASSWORD=segredo-${c.codigo}\nDOUG_IMAGE=${NEW}\nOUTRA=1\n`);
      expect(existsSync(`${a.pasta(c)}/.env.antes-atualizar`)).toBe(false);
      expect(sobras(a, c)).toEqual([]);
      // the dump is under <raiz>/backups/<codigo>/, never in the tenant's dados/
      expect(a.backups(c)).toHaveLength(1);
      expect(a.backups(c)[0]).toStartWith(`pre-${NEW_TAG}-`);
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
    expect(a.env(c2)).toBe(`POSTGRES_PASSWORD=segredo-002\nDOUG_IMAGE=${OLD}\nOUTRA=1\n`);
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
    expect(a.env(c1)).toBe(`POSTGRES_PASSWORD=segredo-001\nDOUG_IMAGE=${OLD}\nOUTRA=1\n`);
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
      writeFileSync(join(pasta, `pre-agentes-zim_doug-old${dia}-2025110${dia}-030000.dump`), "x");
    writeFileSync(join(pasta, "falhou-antigo.dump"), "x");
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

  test("backups: depois de uma troca boa ficam só os últimos 3 de trocas boas; os de falha nunca saem", () => {
    const a = ambiente([c1]);
    const pasta = a.pastaBackups(c1);
    mkdirSync(pasta, { recursive: true, mode: 0o700 });
    for (const dia of ["01", "02", "03", "04"]) {
      const f = join(pasta, `pre-x-202511${dia}-030000.dump`);
      writeFileSync(f, "x");
      utimesSync(f, new Date(`2025-11-${dia}T03:00:00Z`), new Date(`2025-11-${dia}T03:00:00Z`));
    }
    writeFileSync(join(pasta, "falhou-x-20251001-030000.dump"), "x");
    writeFileSync(join(pasta, "outro-arquivo.txt"), "fica");
    expect(a.rodar([NEW]).code).toBe(0);
    const ficou = readdirSync(pasta).sort();
    expect(ficou.filter((n) => n.startsWith("pre-"))).toHaveLength(3); // the new one and the two newest
    expect(ficou).not.toContain("pre-x-20251101-030000.dump");
    expect(ficou).not.toContain("pre-x-20251102-030000.dump");
    expect(ficou).toContain("falhou-x-20251001-030000.dump");
    expect(ficou).toContain("outro-arquivo.txt");
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
      [c1, `A=1\nDOUG_IMAGE="${OLD}"`],
      [c2, `export DOUG_IMAGE='${OLD}'\nB=2`],
      [c3, `DOUG_IMAGE=${OLD} # a imagem\nC=3\n`],
    ];
    const a = ambiente(trio, { env: (c) => variantes.find(([x]) => x === c)?.[1] ?? "" });
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("Atualizados (3)");
    expect(a.env(c1)).toBe(`A=1\nDOUG_IMAGE=${NEW}\n`);
    expect(a.env(c2)).toBe(`DOUG_IMAGE=${NEW}\nB=2\n`);
    expect(a.env(c3)).toBe(`DOUG_IMAGE=${NEW}\nC=3\n`);
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

  test("guarda órfão de uma execução morta no meio: restaura o .env, confere o cliente e não o atualiza na mesma rodada", () => {
    const a = ambiente([c1]);
    const env = join(a.pasta(c1), ".env");
    writeFileSync(`${env}.antes-atualizar`, `POSTGRES_PASSWORD=segredo-001\nDOUG_IMAGE=${OLD}\nOUTRA=1\n`);
    writeFileSync(env, `POSTGRES_PASSWORD=segredo-001\nDOUG_IMAGE=${NEW}\nOUTRA=1\n`);
    a.marca(`running-${c1.codigo}-${c1.slug}`, NEW);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(3);
    expect(out).toContain("de uma execução interrompida");
    expect(out).toContain("Voltaram para a anterior (1)");
    expect(a.env(c1)).toContain(`DOUG_IMAGE=${OLD}`);
    expect(existsSync(`${env}.antes-atualizar`)).toBe(false);
    expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(OLD);
    expect(deste(a.chamadas(), c1).some((l) => l.includes("pg_dump"))).toBe(false);
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
    writeFileSync(`${env}.antes-atualizar`, `DOUG_IMAGE=${OLD}\n`);
    writeFileSync(env, `DOUG_IMAGE=${NEW}\n`);
    a.marca("unhealthy", `001-padaria-aurora ${OLD}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Falharam (1)");
  });

  test("sobras de execuções mortas (.env.XXXXXX, .dump.parcial, clientes.tsv.XXXXXX) são limpas", () => {
    const a = ambiente([c1]);
    writeFileSync(join(a.pasta(c1), ".env.AbC123"), "DOUG_IMAGE=lixo\n");
    mkdirSync(a.pastaBackups(c1), { recursive: true, mode: 0o700 });
    writeFileSync(join(a.pastaBackups(c1), "pre-x-20251101-030000.dump.parcial"), "x");
    writeFileSync(join(a.raiz, "clientes.tsv.Zz9Yy8"), "lixo");
    expect(a.rodar([NEW]).code).toBe(0);
    expect(sobras(a, c1)).toEqual([]);
    expect(a.backups(c1).some((n) => n.endsWith(".parcial"))).toBe(false);
    expect(existsSync(join(a.raiz, "clientes.tsv.Zz9Yy8"))).toBe(false);
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
    expect(out).toContain("link simbólico");
    expect(readFileSync(join(fora, ".env"), "utf8")).toBe(`DOUG_IMAGE=${OLD}\n`);
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

  test("migrações desligadas no boot: rodam antes do up -d; falhando, o cliente volta", () => {
    const comMigracao = (c: Cliente) => `DOUG_IMAGE=${OLD}\nRUN_MIGRATIONS_ON_BOOT=false\nX=${c.codigo}\n`;
    const a = ambiente([c1], { env: comMigracao });
    expect(a.rodar([NEW]).code).toBe(0);
    const d = deste(a.chamadas(), c1);
    const migra = d.findIndex((l) => l.includes("migrate"));
    expect(migra).toBeGreaterThanOrEqual(0);
    expect(migra).toBeLessThan(d.indexOf("compose up -d"));
    // with the default (migrations on boot) the script runs none
    const b = ambiente([c1]);
    b.rodar([NEW]);
    expect(deste(b.chamadas(), c1).some((l) => l.includes("migrate"))).toBe(false);
    // a failing migration is a failed swap: back to the old image
    const c = ambiente([c1], { env: comMigracao });
    c.marca("migrate-fails", `${c1.codigo}-${c1.slug}\n`);
    const r = c.rodar([NEW]);
    expect(r.code).toBe(3);
    expect(r.out).toContain("as migrações falharam");
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
    const trava = join(a.raiz, ".trava");
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
    expect(a.env(c1)).toBe(`POSTGRES_PASSWORD=segredo-001\nDOUG_IMAGE=${OLD}\nOUTRA=1\n`);
    expect(existsSync(`${a.pasta(c1)}/.env.antes-atualizar`)).toBe(false);
    expect(sobras(a, c1)).toEqual([]);
    // the interrupted swap's up -d, then the one that puts the old image back
    expect(readFileSync(join(a.state, `running-${c1.codigo}-${c1.slug}`), "utf8").trim()).toBe(OLD);
    expect(a.registro()).toContain(`\t${OLD}\t`);
  });
});
