import { afterEach, expect, test } from "bun:test";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

/** An agent's ronda over the API (ADR 9004): read by members, turned on and off by who manages agents. */

let t: TestServer;
afterEach(() => t.close());

type Ronda = { schedule: string; routineId: string | null; nextRunAt: string | null; recent: unknown[] };

test("the ronda: off by default, on in the person's time zone, listed in Rotinas, never set by a member", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const bia = await joinByInvitation(t, owner, orgId, "bia@example.com");
  const org = `/api/app/organizations/${orgId}`;
  const agent = (await (await owner(`${org}/agents`, { json: { name: "Ada", handle: "ada" } })).json()) as {
    id: string;
  };
  const at = `${org}/agents/${agent.id}/ronda`;

  expect(((await (await owner(at)).json()) as Ronda).schedule).toBe("off");
  const on = await owner(at, { method: "PUT", json: { schedule: "daily", timezone: "America/Sao_Paulo" } });
  expect(on.status).toBe(200);
  const ronda = (await on.json()) as Ronda;
  expect(ronda).toMatchObject({ schedule: "daily", recent: [] });
  expect(ronda.nextRunAt).not.toBeNull();

  const list = (await (await owner(`${org}/routines`)).json()) as { routines: { id: string; name: string }[] };
  expect(list.routines.find((r) => r.id === ronda.routineId)?.name).toBe("Ronda");

  expect((await bia(at, { method: "PUT", json: { schedule: "hourly" } })).status).toBe(403);
  expect((await owner(at, { method: "PUT", json: { schedule: "weekly" } })).status).toBe(400);
  expect(((await (await bia(at)).json()) as Ronda).schedule).toBe("daily");

  const off = (await (await owner(at, { method: "PUT", json: { schedule: "off" } })).json()) as Ronda;
  expect(off).toMatchObject({ schedule: "off", routineId: ronda.routineId, nextRunAt: null });
});
