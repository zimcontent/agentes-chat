import { afterEach, describe, expect, test } from "bun:test";
import { createFakeLiveActivitySender } from "@dougbot/adapters";
import { eq, schema } from "@dougbot/db";
import {
  drainOutbox,
  endLiveActivity,
  LIVE_ACTIVITY_MAX_MS,
  liveActivityStartFor,
  liveProgress,
  liveStateOf,
  liveTitle,
  postPersonMessage,
  registerLiveActivity,
  syncLiveActivities,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const TOKEN = "ab12".repeat(20);
const facts = { waitingMachineId: null, transcript: null };

/** The owner asks the agent for work: the message and the run it started, still in line. */
async function asked() {
  f = await setup();
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
    body: "@dev revisa a Lâmina 21",
  });
  const start = await liveActivityStartFor(f.db, f.owner.id, f.org.id, message.id, "pt-BR");
  if (!start) throw new Error("no run");
  return { message, start };
}

describe("Live Activities (the lock screen)", () => {
  test("what it shows: who waits on whom, and how far, in the phone's language", () => {
    expect(liveTitle({ body: "@dev, revisa a Lâmina 21" })).toBe("revisa a Lâmina 21");
    expect(liveTitle({ issueTitle: "Lâmina 21", body: "@dev faz" })).toBe("Lâmina 21");
    expect(liveProgress(0)).toBe(0.1);
    expect(liveProgress(100)).toBe(0.9);
    expect(liveStateOf({ ...facts, status: "running", turns: 8 }, "Lâmina 21", "pt-BR")).toEqual({
      title: "Lâmina 21",
      line: "você está esperando · falta pouco",
      progress: liveProgress(8),
      phase: "work",
    });
    expect(liveStateOf({ ...facts, status: "waiting_approval", turns: 2 }, "x", "pt-BR")).toMatchObject({
      line: "esperando você",
      phase: "wait",
    });
    expect(liveStateOf({ ...facts, status: "done", turns: 2 }, "x", "en")).toMatchObject({
      line: "done",
      progress: 1,
      phase: "done",
    });
  });

  test("the app starts one for its own message; the run's changes and its end reach it once each", async () => {
    const { start } = await asked();
    expect(start).toMatchObject({
      agentName: expect.any(String),
      state: { phase: "queued", title: "revisa a Lâmina 21" },
    });
    await registerLiveActivity(f.db, f.owner.id, f.org.id, { runId: start.runId, token: TOKEN, locale: "pt-BR" });
    const sender = createFakeLiveActivitySender();
    expect(await syncLiveActivities({ db: f.db, sender })).toBe(1);
    expect(sender.sent[0]).toMatchObject({ to: TOKEN, event: "update", state: { phase: "queued" } });
    // Nothing changed: nothing sent.
    expect(await syncLiveActivities({ db: f.db, sender })).toBe(0);

    await drainOutbox(f.db, f.handlers);
    expect(await syncLiveActivities({ db: f.db, sender })).toBe(1);
    const end = sender.sent[1];
    expect(end).toMatchObject({ event: "end", state: { phase: "done", progress: 1 } });
    expect(end?.dismissAt).toBeInstanceOf(Date);
    const [row] = await f.db.select().from(schema.liveActivities);
    expect(row?.endedAt).toBeInstanceOf(Date);
    expect(await syncLiveActivities({ db: f.db, sender })).toBe(0);
  });

  test("only the person who sent it, and only a member", async () => {
    const { message, start } = await asked();
    const bia = await addMember(f.db, f.org.id, "member", "Bia");
    await expect(liveActivityStartFor(f.db, bia.id, f.org.id, message.id, "pt-BR")).rejects.toThrow();
    await expect(
      registerLiveActivity(f.db, bia.id, f.org.id, { runId: start.runId, token: TOKEN, locale: "pt-BR" }),
    ).rejects.toThrow();
    expect(await f.db.select().from(schema.liveActivities)).toEqual([]);
  });

  test("an activity Apple says is gone, one ended on the phone, and one past eight hours are sent no more", async () => {
    const { start } = await asked();
    await registerLiveActivity(f.db, f.owner.id, f.org.id, { runId: start.runId, token: TOKEN, locale: "en" });
    const sender = createFakeLiveActivitySender({ gone: [TOKEN] });
    expect(await syncLiveActivities({ db: f.db, sender })).toBe(0);
    const [gone] = await f.db.select().from(schema.liveActivities);
    expect(gone?.endedAt).toBeInstanceOf(Date);

    // Registered again (a new activity), then ended on the phone.
    const other = "cd34".repeat(20);
    await registerLiveActivity(f.db, f.owner.id, f.org.id, { runId: start.runId, token: other, locale: "en" });
    expect(await endLiveActivity(f.db, f.owner.id, other)).toBe(true);
    expect(await syncLiveActivities({ db: f.db, sender: createFakeLiveActivitySender() })).toBe(0);

    // A third, eight hours old: ended with an end push.
    const late = "ef56".repeat(20);
    await registerLiveActivity(f.db, f.owner.id, f.org.id, { runId: start.runId, token: late, locale: "en" });
    const fresh = createFakeLiveActivitySender();
    const later = new Date(Date.now() + LIVE_ACTIVITY_MAX_MS + 1000);
    expect(await syncLiveActivities({ db: f.db, sender: fresh, now: () => later })).toBe(1);
    expect(fresh.sent[0]?.event).toBe("end");
    const open = await f.db.select().from(schema.liveActivities).where(eq(schema.liveActivities.token, late));
    expect(open[0]?.endedAt).toBeInstanceOf(Date);
  });

  test("without a sender (the push relay) nothing is sent and nothing ends", async () => {
    const { start } = await asked();
    await registerLiveActivity(f.db, f.owner.id, f.org.id, { runId: start.runId, token: TOKEN, locale: "en" });
    expect(await syncLiveActivities({ db: f.db, sender: null })).toBe(0);
    const [row] = await f.db.select().from(schema.liveActivities);
    expect(row?.endedAt).toBeNull();
  });
});
