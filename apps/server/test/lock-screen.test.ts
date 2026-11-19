import { afterEach, describe, expect, test } from "bun:test";
import { createFakeLiveActivitySender } from "@dougbot/adapters";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

/** The lock screen's routes (docs/adr/doug-0021-lock-screen.md): Live Activities and a block's button pressed there. */

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const TOKEN = "ab12".repeat(20);

async function ownerWithMessage(server: TestServer) {
  const owner = browser(server);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const sent = await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages`, {
    json: { body: "@dev revisa a Lâmina 21" },
  });
  expect(sent.status).toBe(201);
  const { id } = (await sent.json()) as { id: string };
  return { owner, orgId, messageId: id };
}

describe("Live Activities", () => {
  test("through the push relay (no sender): none to start, and a token is refused", async () => {
    t = await createTestServer();
    const { owner, orgId, messageId } = await ownerWithMessage(t);
    const start = await owner(
      `/api/app/organizations/${orgId}/live-activities/start?messageId=${messageId}&locale=pt-BR`,
    );
    expect(await start.json()).toEqual({ available: false, start: null });
    const put = await owner(`/api/app/organizations/${orgId}/live-activities`, {
      method: "PUT",
      json: { runId: messageId, token: TOKEN, locale: "pt-BR" },
    });
    expect(put.status).toBe(409);
  });

  test("straight to Apple: the run a message started, its token registered, the end pushed", async () => {
    const sender = createFakeLiveActivitySender();
    t = await createTestServer({ liveActivities: sender });
    const { owner, orgId, messageId } = await ownerWithMessage(t);
    const start = (await (
      await owner(`/api/app/organizations/${orgId}/live-activities/start?messageId=${messageId}&locale=pt-BR`)
    ).json()) as { available: boolean; start: { runId: string; agentName: string; state: { line: string } } | null };
    expect(start.available).toBe(true);
    if (!start.start) throw new Error("no run");
    expect(start.start.agentName).toBe("Dev");
    const put = await owner(`/api/app/organizations/${orgId}/live-activities`, {
      method: "PUT",
      json: { runId: start.start.runId, token: TOKEN, appId: "app.dougbot", locale: "pt-BR" },
    });
    expect(put.status).toBe(204);
    const ended = await owner("/api/app/push/live-activities/end", { json: { token: TOKEN } });
    expect(ended.status).toBe(204);
  });

  test("a block's button pressed on a block that isn't there: not found", async () => {
    t = await createTestServer();
    const { owner, orgId } = await ownerWithMessage(t);
    const res = await owner(`/api/app/organizations/${orgId}/blocks/0190f1c4-2a5b-7c3d-8e9f-0a1b2c3d4e5f/press`, {
      json: { version: 1, key: "2.0" },
    });
    expect(res.status).toBe(404);
  });
});
