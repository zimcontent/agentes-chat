import { afterEach, describe, expect, test } from "bun:test";
import type { ClientOverrides } from "@agenteschat/modules";
import { loadClient, overridesOf } from "@agenteschat/modules";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

/**
 * A client's customizations (ADR doug-0020): `clients/<DOUG_CLIENT_CODE>/` read at boot into `GET /api/instance` and
 * `GET /api/app/me`, and nothing at all without a code.
 */

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

/** The example this repository ships, read the way `start.ts` reads it at boot. */
async function exampleClient(): Promise<ClientOverrides> {
  const loaded = await loadClient("000");
  if (!loaded) throw new Error("the example client didn't load");
  return overridesOf(loaded);
}

const instance = async () => (await (await t.app.request("/api/instance")).json()) as Record<string, unknown>;

describe("DOUG_CLIENT_CODE (ADR doug-0020)", () => {
  test("without a code the server behaves as the shared code does", async () => {
    t = await createTestServer();
    expect(await instance()).toMatchObject({ name: "agentes.chat", client: null });
    const web = browser(t);
    await signUp(web, "ana@example.com");
    const me = (await (await web("/api/app/me")).json()) as { client: unknown };
    expect(me.client).toBeNull();
  });

  test("the example client's overrides reach the apps, in /api/instance and in /me", async () => {
    t = await createTestServer({ client: await exampleClient() });
    expect(await instance()).toMatchObject({
      client: { name: "Padaria Aurora", accent: "#C2410C" },
    });
    const web = browser(t);
    await signUp(web, "ana@example.com");
    const me = (await (await web("/api/app/me")).json()) as {
      client: { name: string; accent: string; hiddenTools: string[]; onboardingIntro: string } | null;
    };
    expect(me.client).toMatchObject({
      name: "Padaria Aurora",
      accent: "#C2410C",
      hiddenTools: ["wiki", "drive", "review"],
      onboardingIntro: expect.stringContaining("Padaria Aurora"),
    });
  });

  test("what the apps read of a client never carries a secret: only what config.json declares", async () => {
    t = await createTestServer({ client: await exampleClient() });
    const body = JSON.stringify(await instance());
    // The config's own keys, and nothing a folder's client.ts may hold.
    expect(body).not.toContain("hiddenAgents");
    expect(body).not.toContain("client-000-exemplo");
  });
});
