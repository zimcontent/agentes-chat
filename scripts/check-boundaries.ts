/**
 * Rules for the public repository, run in CI via `bun run check:boundaries`:
 *
 * - The edition boundary (docs/adr/0002-editions-and-modules.md): open-source code under apps/ and
 *   packages/ must never import a Cloud-only package (`@agenteschat/cloud`) or an `@agenteschat/ee` module.
 * - A client's folder (clients/<code>/, ADR doug-0023) extends only through the module API: its `client.ts` may
 *   import `@agenteschat/modules` and the public packages named in CLIENT_PACKAGES, and nothing else -- never the
 *   engine's internals, another client's folder or a private package -- so it can add through `AgentesModule` and
 *   never change what the product does for every server.
 * - No private files: nothing under PRIVATE_PATHS may be tracked here.
 * - No internal notes: every file is public, comments included, so none may point at the maintainers'
 *   private docs (planning decision ids, progress logs, prototype screens) or name the team's other
 *   projects, companies and repositories.
 */
import { createHash } from "node:crypto";
import * as pathPosix from "node:path/posix";
import { Glob } from "bun";

/**
 * Paths that must never be tracked in this repository: the maintainers' internal notes (planning, progress,
 * prototypes, instructions about their own machines) live in a private repository. docs/design/telas/ is
 * also gitignored, for prototypes kept on a designer's computer.
 */
export const PRIVATE_PATHS = [
  "docs/planejamento.md",
  "docs/backend-progress.md",
  "docs/frontend-progress.md",
  "docs/prototipo/",
  "docs/design/telas/",
  ".claude/rules/internal-docs.md",
];

export function isPrivate(path: string): boolean {
  return PRIVATE_PATHS.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

/**
 * What a client's `client.ts` may import (ADR doug-0023 §4): the module API it extends through, and the public packages
 * a module's context is typed with. Anything else -- the engine's internals, the server's own routes, a private
 * package, another client's folder -- is refused: a folder adds through `AgentesModule`, never by reaching inside.
 */
export const CLIENT_PACKAGES = [
  "@agenteschat/modules",
  "@agenteschat/adapters",
  "@agenteschat/config",
  "@agenteschat/db",
  "@agenteschat/providers",
  "@hono/zod-openapi",
  "zod",
] as const;

/** A module specifier's package: `@scope/name` or `name`, with a subpath dropped. `./x` and `../x` have none. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") || null : (parts[0] ?? null);
}

/** The transpiler loaders this check reads: every extension a client's folder may hold, its list kept beside the glob. */
const LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
};

/** One import a file spells: where and what the transpiler read, and the specifier when it is a literal string. */
interface ReadImport {
  line: number;
  /** The expression as written when it isn't a string literal (`import(name)`, a template with `${}`): refused. */
  dynamic: string | null;
  specifier: string | null;
}

/**
 * The imports `text` spells, read by Bun's own parser instead of a pattern: `import … from "x"`, `import "x"`,
 * `export … from "x"`, `import("x")` and `require("x")`. A `import(` / `require(` / `import.meta.resolve(` whose
 * argument isn't a string literal — a variable, a template with `${}` — has no specifier to check, so it is refused by
 * the caller as `dynamic`.
 */
function importsOf(path: string, text: string): ReadImport[] {
  const ext = path.split(".").pop() ?? "";
  const loader = LOADERS[ext];
  if (!loader) return [];
  const found: ReadImport[] = [];
  const lineOf = (index: number) => (index < 0 ? 1 : text.slice(0, index).split("\n").length);
  // `import … from "x"`, `import "x"`, `export … from "x"`, `import("x")` and `require("x")`, read by Bun's parser:
  // the line is where the specifier's text starts, so a `from` on the next line names the line the path is on.
  // The parser drops a type-only import (`import type { … } from "x"`, `export type { … } from "x"`) as it erases the
  // types, but the name is still a reach the folder may not take: four spaces stand where ` type` was, so the length
  // and the lines hold and the import reads as a value's.
  const read = new Bun.Transpiler({ loader }).scanImports(
    text.replace(
      /\b(import|export)(\s+)type(\s+)(?=[{*])/g,
      (_m, kw: string, sp: string, sp2: string) => `${kw}${sp}    ${sp2}`,
    ),
  );
  let at = 0;
  for (const { path: specifier } of read) {
    const index = text.indexOf(specifier, at);
    if (index >= 0) at = index + specifier.length;
    found.push({ line: lineOf(index), dynamic: null, specifier });
  }
  // A call the parser can't resolve to a literal leaves no entry above: `import(x)`, `require(x)`, `import.meta.resolve`
  // with a variable, a template with a hole. Its argument is read here, so the line still names it and it is refused
  // rather than silently passed. A literal `import.meta.resolve("x")` names a path the parser hands back nothing for, so
  // it is checked like the rest: any specifier the folder writes goes through the allow-list.
  const calls = /(?:import|require)\s*\(\s*([^)]*?)\s*\)|import\.meta\.resolve\s*\(\s*([^)]*?)\s*\)/g;
  for (const [whole, first, second] of text.matchAll(calls)) {
    const arg = (first ?? second ?? "").trim();
    const index = text.indexOf(whole);
    const literal = /^(["'])([^"'`\\]*)\1$/.exec(arg);
    if (literal) {
      // `import.meta.resolve("x")` is the one only this pattern reads: the parser answers nothing for it.
      if (second !== undefined) found.push({ line: lineOf(index), dynamic: null, specifier: literal[2] ?? "" });
      continue;
    }
    found.push({ line: lineOf(index), dynamic: arg.slice(0, 80), specifier: null });
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * Whether a specifier from `path` resolves inside the same client's folder: `./x` and `./a/b` do, `../x` and
 * `./a/../../..` don't. The folder is `clients/<code>` — the first two segments of a path under `clients/` — so a file
 * can only reach its own client's code, never another's or the repo's. `path.posix.resolve` does the climb as a string,
 * with a virtual root so nothing touches the disk.
 */
function staysInFolder(path: string, specifier: string): boolean {
  const parts = path.split("/");
  if (parts[0] !== "clients" || parts.length < 3) return false;
  const folder = `/${parts[0]}/${parts[1]}`;
  const resolved = pathPosix.resolve(pathPosix.dirname(`/${path}`), specifier);
  return resolved === folder || resolved.startsWith(`${folder}/`);
}

/** What a client folder's `{ path, text }` files import that they may not, as `path:line: specifier`. */
export function clientImports(files: { path: string; text: string }[]): string[] {
  const refused: string[] = [];
  for (const { path, text } of files) {
    for (const { line, dynamic, specifier } of importsOf(path, text)) {
      // A specifier the parser couldn't read as a literal reaches anything: refused by name.
      if (dynamic !== null) {
        refused.push(`${path}:${line}: ${dynamic}`);
        continue;
      }
      if (specifier === null) continue;
      // The folder's own code (`./x`, `./a/b`) is allowed; so is a runtime's own builtin (`node:fs`), which reaches no
      // part of this product. A relative path stays in the folder only if it resolves inside it: `./a/../../..` leaves.
      if (specifier.startsWith("node:")) continue;
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        if (staysInFolder(path, specifier)) continue;
        refused.push(`${path}:${line}: ${specifier}`);
        continue;
      }
      const name = packageOf(specifier);
      if (name !== null && (CLIENT_PACKAGES as readonly string[]).includes(name)) continue;
      refused.push(`${path}:${line}: ${specifier}`);
    }
  }
  return refused;
}

/** Whether a relative specifier from `path` resolves inside the same client's folder: `./x` and `./a/b` do, `../x` and
 * `./a/../../..` don't. The folder is `clients/<code>` — the first two segments of a path under `clients/` — so a file
 * can only reach its own client's code, never another's or the repo's. */
/** Public files that hold the patterns on purpose: this check, its samples and the ignore rule for local prototypes. */
const NAMES_PRIVATE_PATHS = new Set(["scripts/check-boundaries.ts", "scripts/check-boundaries.test.ts", ".gitignore"]);

/**
 * A planning decision id in running text: "(D46)", "D60: …", "D9–D13", "D18/D20", "D104". A slash only joins
 * two ids, so base64 like "ab/D45/x" passes. Cloudflare's D1 is a product name, after R2 in any language ("R2 und D1", "R2, D1").
 */
const DECISION_ID =
  /(?<=^|[\s([,;–]|D\d{1,3}[a-c]?\/)D\d{1,3}[a-c]?(?=$|[\s)\],;:.'’–-]|\/D\d)(?<!R2,? \S{1,4} D1|R2, D1)/;

const NOTES: [RegExp, string][] = [
  [DECISION_ID, "cites a planning decision id: cite the ADR or state the reason itself"],
  [
    /(?:planejamento|backend-progress|frontend-progress)\.md|docs\/prototipo|docs\/design\/telas|\btelas\//,
    "points at a private doc",
  ],
  [/(?<![\w./-])[A-Z][A-Za-z0-9]*\.(?:dc\.)?html\b/, "names a prototype screen"],
  [/claude\.ai\/(?:code\/)?artifact/, "links a private claude.ai artifact"],
];

/**
 * SHA-256 of words no public file may contain: the team's other project and company, the product's
 * former name, an Apple team id and the private Cloud repository. Hashed so this file doesn't publish them;
 * add one, in lowercase, with `printf %s word | shasum -a 256`.
 */
const PRIVATE_WORDS = new Set([
  "49a9f16c112863fbcd5f840da8fd0d18c8cd4f1ff43cf601a89998c25138da4f",
  "4a5c0838bb397331a4f27195980b69ecfadc67379cb29f281842e38147b06955",
  "4215a347ee21606e7da0cb76ad84dc9a647c9ebfdfa986d194acfd0bf080281c",
  "ff291731fc8e904455a0399bc5154213041396596a2d0857f27a66b473593f2e",
  "5a686fdaa0c9ea14840b98c25a1f626d362132ccf94e33356d4b71c73ac5907f",
]);

const hashes = new Map<string, string>();

/** Whether a line holds one of the hashed words, alone or inside a hyphenated name. */
function hasPrivateWord(line: string, privateWords: Set<string>): boolean {
  for (const name of line.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    for (const word of name.includes("-") ? [name, ...name.split("-")] : [name]) {
      const hash = hashes.get(word) ?? createHash("sha256").update(word).digest("hex");
      hashes.set(word, hash);
      if (privateWords.has(hash)) return true;
    }
  }
  return false;
}

/** The internal notes in a public file's text, as `line: what is wrong`. */
export function internalNotes(text: string, privateWords = PRIVATE_WORDS): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const [pattern, why] of NOTES) if (pattern.test(line)) hits.push(`${i + 1}: ${why}`);
    if (hasPrivateWord(line, privateWords)) hits.push(`${i + 1}: names an internal project, company or repository`);
  });
  return hits;
}

if (import.meta.main) {
  const forbidden =
    /(from\s+|import\s*\(\s*|require\s*\(\s*)["'](@agenteschat\/(cloud|ee)(\/[^"']*)?|(\.\.\/)+(cloud|ee)(\/[^"']*)?)["']/;
  const violations: string[] = [];

  for (const dir of ["apps", "packages"]) {
    for await (const file of new Glob(`${dir}/**/*.{ts,tsx,js,mjs}`).scan({ dot: false })) {
      if (file.includes("node_modules") || file.includes("/dist/")) continue;
      const text = await Bun.file(file).text();
      text.split("\n").forEach((line, i) => {
        if (forbidden.test(line)) violations.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
  }

  for (const pkgFile of ["apps", "packages"].flatMap((d) => [...new Glob(`${d}/*/package.json`).scanSync()])) {
    const pkg = await Bun.file(pkgFile).json();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    for (const name of ["@agenteschat/cloud", "@agenteschat/ee"]) {
      if (name in deps) violations.push(`${pkgFile}: depends on ${name}`);
    }
  }

  // A client's folder extends through the module API alone (ADR doug-0023 §4): what its `.ts` files import.
  {
    const files: { path: string; text: string }[] = [];
    for await (const file of new Glob("clients/*/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}").scan({ dot: false })) {
      if (file.includes("node_modules") || file.includes("/dist/")) continue;
      files.push({ path: file, text: await Bun.file(file).text() });
    }
    for (const hit of clientImports(files)) {
      violations.push(`${hit}: a client's folder may import only ${CLIENT_PACKAGES.join(", ")} and its own files`);
    }
  }

  const lsFiles = (...args: string[]) => {
    const git = Bun.spawnSync(["git", "ls-files", "-z", ...args]);
    if (!git.success) throw new Error(`git ls-files failed: ${git.stderr.toString()}`);
    return git.stdout.toString().split("\0").filter(Boolean);
  };
  const tracked = lsFiles("--cached").filter(isPrivate);

  // Tracked files and new ones not ignored, so a file is checked before its first commit too.
  const notes: string[] = [];
  for (const path of lsFiles("--cached", "--others", "--exclude-standard")) {
    if (isPrivate(path) || NAMES_PRIVATE_PATHS.has(path)) continue;
    const file = Bun.file(path);
    if (!(await file.exists())) continue; // deleted, not staged yet
    const text = await file.text();
    if (text.includes("\0")) continue; // binary
    for (const hit of internalNotes(text)) notes.push(`${path}:${hit}`);
  }

  if (violations.length > 0) {
    console.error(
      `Boundaries broken (cloud/ee, or a client folder reaching past the module API):\n${violations.join("\n")}`,
    );
  }
  if (tracked.length > 0) {
    console.error(`Private files must not be tracked here (git rm --cached them):\n${tracked.join("\n")}`);
  }
  if (notes.length > 0) {
    console.error("Internal notes in public files: cite the ADR or state the reason itself:");
    console.error(notes.join("\n"));
  }
  if (violations.length > 0 || tracked.length > 0 || notes.length > 0) process.exit(1);
  console.log("boundaries ok");
}
