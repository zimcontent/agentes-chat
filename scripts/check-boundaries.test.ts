import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CLIENT_PACKAGES, clientImports, internalNotes, isPrivate } from "./check-boundaries";

test("only the listed docs, the prototypes and the team's rules are forbidden here", () => {
  for (const path of [
    "docs/planejamento.md",
    "docs/prototipo/a.html",
    "docs/design/telas/A.html",
    ".claude/rules/internal-docs.md",
  ]) {
    expect(isPrivate(path)).toBe(true);
  }
  for (const path of [
    "CLAUDE.md",
    "docs/adr/0002-editions-and-modules.md",
    "docs/design/README.md",
    "docs/planejamento.md.bak",
  ]) {
    expect(isPrivate(path)).toBe(false);
  }
});

test("a planning decision id in running text is caught", () => {
  const prose = [
    "The inbox (D46): mentions",
    "// D60: our tools",
    "Implements planejamento D18a.",
    "D9–D13",
    "D58's step 2",
    "(D18/D20 in planning)",
    "D104: the next hundred",
  ];
  for (const line of prose) expect(internalNotes(line)).toHaveLength(1);
  expect(internalNotes("ok\n(D33, revised by D45)\nok")).toEqual([
    "2: cites a planning decision id: cite the ADR or state the reason itself",
  ]);
});

test("ids in code, data and product names are not decision ids", () => {
  const lines = [
    "Workers, KV, R2 and D1 of the account.",
    "R2 e D1 da conta.",
    "Workers, KV, R2 und D1 des Kontos.",
    "Workers, KV, R2, D1 보기",
    "Workers, KV, R2 и D1 аккаунта.",
    "color: #D1D5DB;",
    "sha512-ab/D45+x==",
    "sha512-ab/D45/x==",
    "D2C",
    "3D",
  ];
  for (const line of lines) expect(internalNotes(line)).toEqual([]);
});

test("pointers to the private docs, prototype screens and artifacts are caught", () => {
  const lines = [
    "(telas/Example.html, C)",
    "Copy follows docs/design/telas exactly.",
    "Example.dc.html: the home",
    "see docs/planejamento.md",
    "https://claude.ai/artifact/abc",
  ];
  for (const line of lines) expect(internalNotes(line).length).toBeGreaterThan(0);
  const fine = [
    "help.yahoo.com/kb/SLN4075.html",
    "apps/web/index.html",
    "Faz telas e protótipos.",
    "Planejamento da sprint",
  ];
  for (const line of fine) expect(internalNotes(line)).toEqual([]);
});

test("a hashed word is caught in any case, alone or in a hyphenated name, never inside another word", () => {
  const words = new Set([createHash("sha256").update("acmecorp").digest("hex")]);
  expect(internalNotes("Same split as AcmeCorp's dashboard", words)).toHaveLength(1);
  expect(internalNotes("the acmecorp-cloud repo", words)).toHaveLength(1);
  expect(internalNotes("acmecorporation", words)).toEqual([]);
});

test("a client's client.ts may import the module API and the public packages, and its own files", () => {
  const allowed = [
    'import type { DougBotModule } from "@dougbot/modules";',
    'import { db } from "@dougbot/db";',
    'import { createRoute } from "@hono/zod-openapi";',
    'import { z } from "zod";',
    'import { helper } from "./helper";',
    'import { other } from "./nested/other";',
    'const m = await import("@dougbot/adapters");',
    'const p = require("@dougbot/providers");',
    'import { existsSync } from "node:fs";',
  ].join("\n");
  expect(clientImports([{ path: "clients/064/client.ts", text: allowed }])).toEqual([]);
  // The list is the contract: what the example uses, and no package outside it.
  expect(CLIENT_PACKAGES).toContain("@dougbot/modules");
});

test("a client folder reaching past the module API is refused, with the line", () => {
  const refused = [
    'import { executor } from "../../packages/engine/src/executor";',
    'import { thing } from "../064-outra/client";',
    'import { private } from "@dougbot/cloud";',
    'import { ee } from "@dougbot/ee";',
    'import { x } from "some-other-package";',
  ].join("\n");
  const hits = clientImports([{ path: "clients/064/client.ts", text: refused }]);
  expect(hits).toEqual([
    "clients/064/client.ts:1: ../../packages/engine/src/executor",
    "clients/064/client.ts:2: ../064-outra/client",
    "clients/064/client.ts:3: @dougbot/cloud",
    "clients/064/client.ts:4: @dougbot/ee",
    "clients/064/client.ts:5: some-other-package",
  ]);
});

test("an import no allow-list names is refused, however it is spelled", () => {
  // A template literal with a hole names no path the parser can read: the hole is a variable's value. The two fixtures
  // are built from pieces so this test file itself carries no placeholder.
  const tick = String.fromCharCode(96);
  const dollar = String.fromCharCode(36);
  const hole = (inner: string) => `${dollar}{${inner}}`;
  const cases: [string, string][] = [
    // A bare import, no `from`.
    ['import "@dougbot/engine";', "@dougbot/engine"],
    // A template literal with a hole.
    [`const x = await import(${tick}@dougbot/${hole("name")}${tick});`, `${tick}@dougbot/`],
    [`const y = require(${tick}./a/${hole("b")}${tick});`, `${tick}./a/`],
    // A relative path that climbs out of the client's folder.
    ['import { x } from "./a/../../..";', "./a/../../.."],
    // `import.meta.resolve`, literal or not.
    ['const r = import.meta.resolve("@dougbot/engine");', "@dougbot/engine"],
    ["const r = import.meta.resolve(name);", "name"],
    // A variable argument.
    ["const m = await import(module);", "module"],
    ["const p = require(somewhere);", "somewhere"],
  ];
  for (const [text, specifier] of cases) {
    const hits = clientImports([{ path: "clients/064/client.ts", text }]);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain(specifier);
  }
});

test("a specifier is named on the line the path is on, even with `from` below it", () => {
  const text = 'import type { DougBotModule } from\n  "@dougbot/engine";';
  expect(clientImports([{ path: "clients/064/client.ts", text }])).toEqual([
    "clients/064/client.ts:2: @dougbot/engine",
  ]);
  const allowed = 'import type { DougBotModule } from\n  "@dougbot/modules";';
  expect(clientImports([{ path: "clients/064/client.ts", text: allowed }])).toEqual([]);
});

test("a tournament of relative paths stays in the folder or leaves it, by where it resolves", () => {
  const path = "clients/064/client.ts";
  const inside = ['import { a } from "./a";', 'import { b } from "./a/b/c";', 'import { c } from "./a/../b";'];
  expect(clientImports(inside.map((text) => ({ path, text })))).toEqual([]);
  // A nested file, whose own `..` keeps it in the folder, is fine; one more `..` leaves.
  expect(clientImports([{ path: "clients/064/sub/x.ts", text: 'import { a } from "../a";' }])).toEqual([]);
  const leaving = [
    'import { a } from "../064-other/client";',
    'import { b } from "./a/../../../packages/engine/src/x";',
    'import { c } from "../../packages/engine";',
  ];
  expect(clientImports(leaving.map((text) => ({ path, text })))).toHaveLength(3);
});

test("every extension a client's folder may hold is read, not only .ts", () => {
  for (const extension of ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]) {
    const hits = clientImports([
      { path: `clients/064/client.${extension}`, text: 'import { x } from "@dougbot/engine";' },
    ]);
    expect(hits).toEqual([`clients/064/client.${extension}:1: @dougbot/engine`]);
  }
});

test("the example this repository ships keeps to the module API", async () => {
  const text = await Bun.file(new URL("../clients/000-exemplo/client.ts", import.meta.url).pathname).text();
  expect(clientImports([{ path: "clients/000-exemplo/client.ts", text }])).toEqual([]);
});
