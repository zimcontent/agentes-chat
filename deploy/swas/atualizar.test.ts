import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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

// A docker that only knows the calls the script makes, and a curl that answers the clients' /api/health. The state
// folder says what exists: `images` (names that exist, newest first), `port-<porta>` (whose port it is),
// `running-<pasta>` (the image `up -d` last started), `unhealthy` (lines `<pasta> <imagem>` that never get healthy),
// `dump-fails` (folders whose pg_dump fails), `never-ready` (folders that never reach `restart: ready`).
const docker = `#!/usr/bin/env bash
state=$STUB_STATE
here=$(basename "$PWD")
printf '%s\\n' "docker[$here] $*" >>"$state/calls"
case "$*" in
"image ls --format {{.Tag}} agentes-zim") sed -n 's/^agentes-zim://p' "$state/images" ;;
"image inspect "*) grep -qx "$3" "$state/images" ;;
"compose kill -s SIGUSR2 agentes") touch "$state/signaled-$here" ;;
"compose exec -T postgres pg_dump -Fc -U agentes agentes")
  if grep -qx "$here" "$state/dump-fails" 2>/dev/null; then echo "pg_dump: erro" >&2; exit 1; fi
  echo "PGDMP de $here" ;;
"compose up -d")
  awk -F= '$1 == "DOUG_IMAGE" { print $2 }' .env >"$state/running-$here" ;;
*) echo "docker: chamada inesperada: $*" >&2; exit 99 ;;
esac
`;
const curl = `#!/usr/bin/env bash
state=$STUB_STATE
url=\${@: -1}
port=\${url#http://127.0.0.1:}; port=\${port%%/*}
here=$(cat "$state/port-$port" 2>/dev/null) || exit 7
echo "curl[$here]" >>"$state/calls"
image=$(cat "$state/running-$here" 2>/dev/null) || exit 7
grep -qx "$here $image" "$state/unhealthy" 2>/dev/null && exit 22
restart=
if [[ -e $state/signaled-$here ]]; then
  if grep -qx "$here" "$state/never-ready" 2>/dev/null; then restart=',"restart":"waiting"'; else restart=',"restart":"ready"'; fi
fi
printf '{"status":"ok","version":"1"%s}\\n' "$restart"
`;

const OLD = "agentes-zim:doug-aaa111";
const NEW = "agentes-zim:doug-bbb222";

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

let rodadas = 0;
/** A root of clients with the three above, all on OLD and healthy, and the fakes on the PATH. */
function ambiente(clientes: Cliente[] = trio) {
  rodadas += 1;
  const raiz = join(dir, `raiz-${rodadas}`);
  const state = join(dir, `state-${rodadas}`);
  const bin = join(dir, `bin-${rodadas}`);
  mkdirSync(raiz);
  mkdirSync(state);
  stub(bin, "docker", docker);
  stub(bin, "curl", curl);
  writeFileSync(join(state, "calls"), "");
  writeFileSync(join(state, "images"), `${NEW}\n${OLD}\n`);
  const linhas = ["codigo\tslug\tnome\tporta\timagem\tcriado_em"];
  for (const c of clientes) {
    const pasta = `${c.codigo}-${c.slug}`;
    mkdirSync(join(raiz, pasta, "dados"), { recursive: true });
    writeFileSync(join(raiz, pasta, "compose.yml"), "services: {}\n");
    writeFileSync(join(raiz, pasta, ".env"), `POSTGRES_PASSWORD=segredo-${c.codigo}\nDOUG_IMAGE=${OLD}\nOUTRA=1\n`);
    writeFileSync(join(state, `port-${c.porta}`), pasta);
    writeFileSync(join(state, `running-${pasta}`), OLD);
    linhas.push(`${c.codigo}\t${c.slug}\tNome ${c.slug}\t${c.porta}\t${OLD}\t2026-11-01`);
  }
  writeFileSync(join(raiz, "clientes.tsv"), `${linhas.join("\n")}\n`);
  const pasta = (c: Cliente) => join(raiz, `${c.codigo}-${c.slug}`);
  return {
    raiz,
    state,
    pasta,
    marca: (arquivo: string, conteudo: string) => writeFileSync(join(state, arquivo), conteudo),
    env: (c: Cliente) => readFileSync(join(pasta(c), ".env"), "utf8"),
    chamadas: () => readFileSync(join(state, "calls"), "utf8").split("\n").filter(Boolean),
    registro: () => readFileSync(join(raiz, "clientes.tsv"), "utf8"),
    backups: (c: Cliente) => {
      const p = join(pasta(c), "dados", "backups");
      return existsSync(p) ? readdirSync(p).sort() : [];
    },
    rodar(args: string[] = [], extra: Record<string, string> = {}) {
      const r = Bun.spawnSync(["bash", script, ...args], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          STUB_STATE: state,
          DOUG_CLIENTES_DIR: raiz,
          DOUG_POLL_S: "0",
          DOUG_SAUDE_TIMEOUT_S: "1",
          DOUG_PARADA_TIMEOUT_S: "1",
          ...extra,
        },
      });
      return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
    },
  };
}

/** The `docker[<pasta>] …` calls of one client, without the prefix. */
const deste = (chamadas: string[], c: Cliente) =>
  chamadas.filter((l) => l.startsWith(`docker[${c.codigo}-${c.slug}] `)).map((l) => l.slice(l.indexOf("] ") + 2));

describe("deploy/swas/doug-atualizar-clientes", () => {
  test("passa no bash -n", () => {
    expect(Bun.spawnSync(["bash", "-n", script]).exitCode).toBe(0);
  });

  test("atualiza todos: backup, aviso de parada, troca do .env e do registro, log e resumo", () => {
    const a = ambiente();
    const { code, out } = a.rodar([NEW.split(":")[1] as string]);
    expect(code).toBe(0);
    expect(out).toContain("Atualizados (3): 001-padaria-aurora 002-cafe-sol 003-oficina-lua");
    for (const c of trio) {
      expect(a.env(c)).toBe(`POSTGRES_PASSWORD=segredo-${c.codigo}\nDOUG_IMAGE=${NEW}\nOUTRA=1\n`);
      expect(existsSync(`${a.pasta(c)}/.env.antes-atualizar`)).toBe(false);
      expect(a.backups(c)).toHaveLength(1);
      // dump, then the notice, then the swap
      const c1 = deste(a.chamadas(), c);
      const ordem = [
        c1.findIndex((l) => l.includes("pg_dump")),
        c1.findIndex((l) => l.includes("kill -s SIGUSR2")),
        c1.indexOf("compose up -d"),
      ];
      expect(ordem.every((i) => i >= 0)).toBe(true);
      expect([...ordem].sort((x, y) => x - y)).toEqual(ordem);
      expect(a.registro()).toContain(`${c.codigo}\t${c.slug}\tNome ${c.slug}\t${c.porta}\t${NEW}\t2026-11-01`);
    }
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
  });

  test("sem argumento, usa a imagem doug-* mais recente da máquina", () => {
    const a = ambiente([trio[0] as Cliente]);
    a.marca("images", `agentes-zim:latest\n${NEW}\n${OLD}\n`);
    const { code } = a.rodar();
    expect(code).toBe(0);
    expect(a.env(trio[0] as Cliente)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("health que não fica ok: volta para a imagem anterior e restaura o .env", () => {
    const a = ambiente();
    const ruim = trio[1] as Cliente;
    a.marca("unhealthy", `002-cafe-sol ${NEW}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(3);
    expect(out).toContain("Voltaram para a anterior (1): 002-cafe-sol");
    expect(out).toContain("Atualizados (2): 001-padaria-aurora 003-oficina-lua");
    expect(out).toContain("Falharam (0): nenhum");
    expect(a.env(ruim)).toBe(`POSTGRES_PASSWORD=segredo-002\nDOUG_IMAGE=${OLD}\nOUTRA=1\n`);
    expect(existsSync(`${a.pasta(ruim)}/.env.antes-atualizar`)).toBe(false);
    expect(a.registro()).toContain(`002\tcafe-sol\tNome cafe-sol\t3102\t${OLD}\t`);
    // the swap and the way back: two `up -d`
    expect(deste(a.chamadas(), ruim).filter((l) => l === "compose up -d")).toHaveLength(2);
    // the others were not held back by it
    expect(a.env(trio[2] as Cliente)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("um cliente que falha não para os outros: sai com 1 e lista quem falhou", () => {
    const a = ambiente();
    const quebrado = trio[0] as Cliente;
    a.marca("dump-fails", "001-padaria-aurora\n");
    // 003 doesn't even come back to the old image: it fails
    a.marca("unhealthy", `003-oficina-lua ${NEW}\n003-oficina-lua ${OLD}\n`);
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(1);
    expect(out).toContain("Atualizados (1): 002-cafe-sol");
    expect(out).toContain("Falharam (2): 001-padaria-aurora 003-oficina-lua");
    // no backup, nothing swapped
    expect(a.env(quebrado)).toContain(`DOUG_IMAGE=${OLD}`);
    expect(deste(a.chamadas(), quebrado).some((l) => l === "compose up -d")).toBe(false);
    expect(a.backups(quebrado)).toEqual([]);
    expect(a.env(trio[1] as Cliente)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("o ponto de parada que não vem no limite não trava: troca assim mesmo", () => {
    const a = ambiente([trio[0] as Cliente]);
    a.marca("never-ready", "001-padaria-aurora\n");
    const { code, out } = a.rodar([NEW]);
    expect(code).toBe(0);
    expect(out).toContain("o ponto de parada não veio");
    expect(a.env(trio[0] as Cliente)).toContain(`DOUG_IMAGE=${NEW}`);
  });

  test("guarda só os 3 últimos backups de cada cliente", () => {
    const a = ambiente([trio[0] as Cliente]);
    const pasta = join(a.pasta(trio[0] as Cliente), "dados", "backups");
    mkdirSync(pasta, { recursive: true });
    for (const dia of ["01", "02", "03", "04"]) writeFileSync(join(pasta, `001-202511${dia}-030000.dump`), "x");
    writeFileSync(join(pasta, "outro-arquivo.txt"), "fica");
    expect(a.rodar([NEW]).code).toBe(0);
    const ficou = readdirSync(pasta).sort();
    expect(ficou).toHaveLength(4); // 3 dumps and the file that isn't one
    expect(ficou).not.toContain("001-20251101-030000.dump");
    expect(ficou).not.toContain("001-20251102-030000.dump");
    expect(ficou).toContain("outro-arquivo.txt");
  });

  test("--dry-run só mostra: nada é tocado e nenhum log é gravado", () => {
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
    }
    expect(existsSync(join(a.raiz, "logs"))).toBe(false);
    const mudou = a.chamadas().filter((l) => /pg_dump|kill|up -d/.test(l));
    expect(mudou).toEqual([]);
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

  test("cliente que já está na imagem é pulado sem backup", () => {
    const a = ambiente([trio[0] as Cliente]);
    const { code, out } = a.rodar([OLD]);
    expect(code).toBe(0);
    expect(out).toContain("Já na imagem (1): 001-padaria-aurora");
    expect(a.backups(trio[0] as Cliente)).toEqual([]);
  });

  test("imagem que não existe na máquina: recusa antes de tocar em qualquer cliente", () => {
    const a = ambiente();
    const { code, out } = a.rodar(["doug-nao-existe"]);
    expect(code).toBe(2);
    expect(out).toContain("não existe nesta máquina");
    expect(a.chamadas().some((l) => l.includes("kill") || l.includes("up -d"))).toBe(false);
  });
});
