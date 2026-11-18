import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientConfigError, clientsRoot, loadClient, overridesOf } from "../src/clients";

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

describe("a client's folder (ADR doug-0023)", () => {
  test("no code loads nothing at all", async () => {
    expect(await loadClient(undefined)).toBeNull();
    expect(await loadClient("")).toBeNull();
    expect(await loadClient("  ")).toBeNull();
  });

  test("the example this repository ships loads, with every kind of override", async () => {
    const root = clientsRoot();
    expect(root).toBeTruthy();
    const loaded = await loadClient("000", root);
    expect(loaded?.code).toBe("000");
    expect(loaded?.module?.name).toBe("client-000-exemplo");
    if (!loaded) throw new Error("the example client didn't load");
    expect(overridesOf(loaded)).toEqual({
      code: "000",
      name: "Padaria Aurora",
      accent: "#C2410C",
      hiddenTools: ["wiki", "drive", "review"],
      hiddenAgents: ["otto", "rui"],
      onboardingIntro: expect.stringContaining("Padaria Aurora"),
    });
  });

  test("a code with no folder is an error, never a server that boots as if nothing was asked", async () => {
    const root = clientsDir({});
    expect(loadClient("064", root)).rejects.toBeInstanceOf(ClientConfigError);
  });

  test("a code that isn't three digits is refused before a folder is looked for", async () => {
    const root = clientsDir({ "06-x": { "config.json": "{}" } });
    expect(loadClient("06", root)).rejects.toThrow(/three digits/);
    expect(loadClient("0641", root)).rejects.toThrow(/three digits/);
    expect(loadClient("abc", root)).rejects.toThrow(/three digits/);
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

  test("a build with no clients/ at all says so", async () => {
    await expect(loadClient("064", null)).rejects.toThrow(/carries no clients/);
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
    await expect(loadClient("064", noModule)).rejects.toThrow(/must export default an AgentesModule/);
    const brokenModule = clientsDir({ "064": { "client.ts": "export default ;" } });
    await expect(loadClient("064", brokenModule)).rejects.toThrow(/didn't load/);
  });

  test("a folder with only client.ts loads as a module and changes nothing in the apps", async () => {
    const root = clientsDir({ "064": { "client.ts": MODULE } });
    const loaded = await loadClient("064", root);
    expect(loaded?.module?.name).toBe("client-teste");
    if (!loaded) throw new Error("a client with only client.ts didn't load");
    expect(overridesOf(loaded)).toEqual({
      code: "064",
      name: null,
      accent: null,
      hiddenTools: [],
      hiddenAgents: [],
      onboardingIntro: null,
    });
    rmSync(root, { recursive: true, force: true });
  });

  test("features turned on are not a hiding; handles lose their @ and repeat once", async () => {
    const root = clientsDir({
      "064": {
        "config.json": JSON.stringify({
          features: { wiki: false, drive: true },
          teamAgentsHidden: ["@Otto", "otto", "Rui"],
        }),
      },
    });
    const loaded = await loadClient("064", root);
    if (!loaded) throw new Error("the client didn't load");
    const overrides = overridesOf(loaded);
    expect(overrides.hiddenTools).toEqual(["wiki"]);
    expect(overrides.hiddenAgents).toEqual(["otto", "rui"]);
    rmSync(root, { recursive: true, force: true });
  });
});
