import { afterEach, beforeEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import { ensureRightHand } from "@agenteschat/engine";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer();
});
afterEach(() => t.close());

/** The right hand's sector cards over HTTP (docs/adr/doug-0020-doug-sector-cards.md). */
test("pills, a pill pressed, and a card's button that runs once on the server", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  await ensureRightHand(t.db, orgId);
  const [row] = await t.db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.builtin, "right_hand")));
  const hand = row?.id as string;
  expect(hand).toBeString();

  // Nothing waits yet: no pills, and the pills are the right hand's only.
  const res = await owner(`/api/app/organizations/${orgId}/agents/${hand}/sector-pills`);
  if (res.status !== 200) throw new Error(`${res.status} ${await res.text()}`);
  const empty = (await res.json()) as {
    pills: unknown[];
  };
  expect(empty.pills).toEqual([]);
  expect((await owner(`/api/app/organizations/${orgId}/agents/${agentId}/sector-pills`)).status).toBe(404);

  // A pill pressed with nothing there: the right hand says so, with no card.
  const pressed = await owner(`/api/app/organizations/${orgId}/agents/${hand}/sector-cards/tasks`, { json: {} });
  expect(pressed.status).toBe(201);
  const { id } = (await pressed.json()) as { id: string };
  const [message] = await t.db.select().from(schema.messages).where(eq(schema.messages.id, id));
  expect(message?.authorAgentId).toBe(hand);
  expect(message?.meta.sectorCards).toMatchObject({ why: "asked", items: [] });
  expect((await owner(`/api/app/organizations/${orgId}/agents/${hand}/sector-cards/fax`, { json: {} })).status).toBe(
    400,
  );

  // A button no server action stands behind.
  const block = "0190f0c2-1111-7000-8000-000000000001";
  expect((await owner(`/api/app/organizations/${orgId}/blocks/${block}/acts/reply`, { json: {} })).status).toBe(404);
});
