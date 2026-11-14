import { afterEach, expect, test } from "bun:test";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
afterEach(() => t.close());

interface Sources {
  sources: {
    id: string;
    name: string;
    connections: { id: string; label: string; here: boolean; blocked: string | null }[];
    agents: { id: string; handle: string; connectionIds: string[]; here: boolean }[];
  }[];
}

test("carry API: what a person can bring into a new workspace, and bringing it", async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const key = await owner(`/api/app/organizations/${orgId}/connectors`, {
    json: { connector: "sentry", apiKey: "sntrys_secret_value" },
  });
  const sentry = (await key.json()) as { id: string };
  await owner(`/api/app/organizations/${orgId}/onboarding`, { method: "PATCH", json: { finished: true } });

  const made = await owner("/api/app/organizations", { json: { name: "Second", finished: true } });
  expect(made.status).toBe(201);
  const second = ((await made.json()) as { organization: { id: string } }).organization.id;

  const listed = await owner(`/api/app/organizations/${second}/carry`);
  expect(listed.status).toBe(200);
  const text = await listed.clone().text();
  expect(text).not.toContain("sntrys_secret_value");
  const { sources } = (await listed.json()) as Sources;
  expect(sources.map((s) => s.name)).toEqual(["Acme"]);
  expect(sources[0]?.connections).toMatchObject([{ id: sentry.id, here: false, blocked: null }]);
  expect(sources[0]?.agents).toMatchObject([{ id: agentId, handle: "dev", connectionIds: [sentry.id], here: false }]);

  // Nothing picked is refused; an unknown id is skipped, never an error.
  expect((await owner(`/api/app/organizations/${second}/carry`, { json: {} })).status).toBe(400);

  const brought = await owner(`/api/app/organizations/${second}/carry`, { json: { agentIds: [agentId] } });
  expect(brought.status).toBe(200);
  const result = (await brought.json()) as {
    connections: { outcome: string; id: string }[];
    agents: { handle: string }[];
    skipped: unknown[];
  };
  expect(result.connections.map((c) => c.outcome)).toEqual(["brought"]);
  expect(result.agents.map((a) => a.handle)).toEqual(["dev"]);
  expect(result.skipped).toEqual([]);

  const there = (await (await owner(`/api/app/organizations/${second}/connectors`)).json()) as {
    connections: { id: string; connector: string }[];
  };
  expect(there.connections.map((c) => c.connector)).toEqual(["sentry"]);
  expect(there.connections[0]?.id).not.toBe(sentry.id);

  const after = (await (await owner(`/api/app/organizations/${second}/carry`)).json()) as Sources;
  expect(after.sources[0]?.connections[0]?.here).toBe(true);
  expect(after.sources[0]?.agents[0]?.here).toBe(true);

  // Someone else's workspace: not theirs to bring into.
  const other = browser(t);
  await signUp(other, "other@example.com");
  expect((await other(`/api/app/organizations/${second}/carry`)).status).toBe(403);
});
