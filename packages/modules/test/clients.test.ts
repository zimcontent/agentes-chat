import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCENT_MIN_CONTRAST,
  ACCENT_STAGES,
  accentLegible,
  ClientConfigError,
  clientConfigSchema,
  clientsRoot,
  loadClient,
  locateClient,
  overridesOf,
} from "../src/clients";

/** A throwaway `clients/` root with `folders`, each `{ name: file }`. */
function clientsDir(folders: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "clientes-"));
  for (const [name, files] of Object.entries(folders)) {
    mkdirSync(join(root, name), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, name, file), text);
  }
  return root;
}

const MODULE = `const m = { name: "client-teste", onStart() {} };\nexport default m;\n`;

describe("a client's folder (ADR doug-0032)", () => {
  test("no code loads nothing at all", async () => {
    expect(await loadClient(undefined)).toBeNull();
    expect(await loadClient("")).toBeNull();
    expect(await loadClient("  ")).toBeNull();
  });

  test("the example this repository ships loads, with a name and a color", async () => {
    const root = clientsRoot();
    expect(root).toBeTruthy();
    const loaded = await loadClient("000", root);
    expect(loaded?.code).toBe("000");
    expect(loaded?.module?.name).toBe("client-000-exemplo");
    if (!loaded) throw new Error("the example client didn't load");
    expect(overridesOf(loaded)).toEqual({ code: "000", name: "Padaria Aurora", accent: "#C2410C" });
  });

  test("a code with no folder is no error: the team's own installs set the code and ship no folder", async () => {
    const root = clientsDir({});
    // Nothing loads, and nothing stops the boot: the server runs the shared code (ADR doug-0032 §1).
    expect(await loadClient("064", root)).toBeNull();
    expect(locateClient("064", root)).toEqual({ kind: "no-folder", code: "064", root });
  });

  test("a build with no clients/ at all says so through its place, and loads nothing", async () => {
    expect(await loadClient("064", null)).toBeNull();
    expect(locateClient("064", null)).toEqual({ kind: "no-root" });
    expect(locateClient(undefined, null)).toBeNull();
  });

  test("a folder that is there but broken still stops the boot: only a missing one is forgiven", async () => {
    await expect(loadClient("064", clientsDir({ "064": {} }))).rejects.toBeInstanceOf(ClientConfigError);
    await expect(loadClient("064", clientsDir({ "064": { "config.json": "{ nope" } }))).rejects.toBeInstanceOf(
      ClientConfigError,
    );
    const twice = clientsDir({ "064-padaria-aurora": { "config.json": "{}" }, "064-outra": { "config.json": "{}" } });
    await expect(loadClient("064", twice)).rejects.toBeInstanceOf(ClientConfigError);
  });

  test("a code that isn't three digits is refused before a folder is looked for", async () => {
    const root = clientsDir({ "06-x": { "config.json": "{}" } });
    await expect(loadClient("06", root)).rejects.toThrow(/three digits/);
    await expect(loadClient("0641", root)).rejects.toThrow(/three digits/);
    await expect(loadClient("abc", root)).rejects.toThrow(/three digits/);
    // A path shaped like a code never reaches the filesystem: it isn't three digits.
    await expect(loadClient("../x", root)).rejects.toThrow(/three digits/);
    // `0640` is four digits, not a code: the folder is never looked for.
    await expect(loadClient("0640", clientsDir({ "0640": { "config.json": "{}" } }))).rejects.toThrow(/three digits/);
  });

  test("a code names its folder alone or with its slug; two folders for one code are refused", async () => {
    const slug = clientsDir({ "064-padaria-aurora": { "config.json": '{ "product": { "name": "Padaria Aurora" } }' } });
    expect((await loadClient("064", slug))?.code).toBe("064");
    const twice = clientsDir({
      "064-padaria-aurora": { "config.json": "{}" },
      "064-outra": { "config.json": "{}" },
    });
    await expect(loadClient("064", twice)).rejects.toThrow(/more than one folder/);
  });

  test("a folder with neither file can't be used", async () => {
    const root = clientsDir({ "064": {} });
    await expect(loadClient("064", root)).rejects.toThrow(/neither config.json nor client.ts/);
  });

  test("a config.json off the schema names every key it got wrong", async () => {
    const root = clientsDir({
      "064": { "config.json": '{ "product": { "name": "", "accent": "orange" }, "extra": true }' },
    });
    const failed = loadClient("064", root);
    await expect(failed).rejects.toThrow(/product\.name/);
    await expect(failed).rejects.toThrow(/product\.accent/);
    await expect(failed).rejects.toThrow(/extra/);
  });

  test("a client.ts that isn't valid JSON or exports no module is refused with its path", async () => {
    const brokenJson = clientsDir({ "064": { "config.json": "{ nope" } });
    await expect(loadClient("064", brokenJson)).rejects.toThrow(/isn't valid JSON/);
    const noModule = clientsDir({ "064": { "client.ts": "export default { nope: true };" } });
    await expect(loadClient("064", noModule)).rejects.toThrow(/must export default an DougBotModule/);
    const brokenModule = clientsDir({ "064": { "client.ts": "export default ;" } });
    await expect(loadClient("064", brokenModule)).rejects.toThrow(/didn't load/);
  });

  test("a folder with only client.ts loads as a module and changes nothing in the apps", async () => {
    const root = clientsDir({ "064": { "client.ts": MODULE } });
    const loaded = await loadClient("064", root);
    expect(loaded?.module?.name).toBe("client-teste");
    if (!loaded) throw new Error("a client with only client.ts didn't load");
    expect(overridesOf(loaded)).toEqual({ code: "064", name: null, accent: null });
    rmSync(root, { recursive: true, force: true });
  });

  test("a switch no screen applies yet is refused by name, never held and never honored", async () => {
    for (const [key, value] of [
      ["features", { wiki: false }],
      ["teamAgentsHidden", ["otto"]],
      ["onboarding", { intro: "Bem-vindo" }],
    ] as const) {
      const root = clientsDir({
        "064": { "config.json": JSON.stringify({ product: { name: "Padaria Aurora" }, [key]: value }) },
      });
      await expect(loadClient("064", root)).rejects.toThrow(new RegExp(`${key} isn't supported yet`));
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a name is text and only text: no template, no translation call, no markup, no control character", () => {
    for (const name of ["{{name}}", "Padaria $t( x)", "<b>Padaria</b>", "Aurora\u0007", "Aurora\nB"]) {
      const parsed = clientConfigSchema.safeParse({ product: { name } });
      expect(parsed.success).toBe(false);
    }
    // What a person would type is taken: an ampersand, an accent, a trailing space trimmed, a hyphen.
    for (const name of ["Padaria Aurora", "Café Sol & Cia", "Aurora-64"]) {
      expect(clientConfigSchema.safeParse({ product: { name } }).success).toBe(true);
    }
  });

  test("a color under 3:1 on either of the two stages is refused: black and white are", () => {
    for (const accent of ["#000000", "#ffffff"]) {
      const parsed = clientConfigSchema.safeParse({ product: { accent } });
      expect(parsed.success).toBe(false);
      const messages = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      expect(messages.join("\n")).toMatch(/product\.accent: must stand at least 3:1 against both stages/);
    }
    // A color with enough separation from both is taken, and so is the one the example ships.
    for (const accent of ["#C2410C", "#808080", "#1F7A45"])
      expect(clientConfigSchema.safeParse({ product: { accent } }).success).toBe(true);
  });

  test("the schema says which key of a config.json it refuses, and only lets the name and the color in", async () => {
    const root = clientsDir({
      "064": { "config.json": JSON.stringify({ product: { name: "Café Sol" }, extra: true }) },
    });
    await expect(loadClient("064", root)).rejects.toThrow(/extra/);
    rmSync(root, { recursive: true, force: true });
    // Exactly the two overrides: what the product's object holds, and nothing else.
    const product = clientConfigSchema.shape.product.unwrap();
    expect(Object.keys(product.shape).sort()).toEqual(["accent", "name"]);
  });

  test("the accent's contrast is measured on both of the identity's stages", () => {
    expect(ACCENT_STAGES).toEqual(["#0a0a0a", "#f4f6f2"]);
    expect(ACCENT_MIN_CONTRAST).toBe(3);
    // 21:1: pure white on the dark stage and pure black on the light one, each fails on the other.
    expect(accentLegible("#000000")).toBe(false);
    expect(accentLegible("#ffffff")).toBe(false);
    expect(accentLegible("#808080")).toBe(true);
  });
});
