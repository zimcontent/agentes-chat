import { afterEach, describe, expect, test } from "bun:test";
import { createFakeWhatsAppGateway } from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import {
  agendaDay,
  createBlockToolSource,
  createWhatsAppAccount,
  dayBounds,
  deliverSectorCards,
  ensureRightHand,
  eventsOfAnswer,
  getBlockState,
  openDm,
  runBlockAct,
  type SectorCardDeps,
  sectorPills,
  setBlockState,
  showSectorCard,
} from "../src";
import type { ToolContext } from "../src/tools/types";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const NOW = new Date("2026-11-19T11:00:00Z");

/** Google Calendar's answer through Composio, as its events list gives it. */
const GOOGLE = {
  items: [
    {
      summary: "Call Five Rings",
      start: { dateTime: "2026-11-19T13:00:00Z" },
      end: { dateTime: "2026-11-19T13:30:00Z" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      colorId: "9",
    },
    {
      summary: "Revisão com o Ronny",
      start: { dateTime: "2026-11-19T17:30:00Z" },
      end: { dateTime: "2026-11-19T18:30:00Z" },
      location: "Escritório",
    },
    { summary: "Cancelada", status: "cancelled", start: { dateTime: "2026-11-19T15:00:00Z" } },
    { summary: "Feriado", start: { date: "2026-11-19" }, end: { date: "2026-11-20" } },
  ],
};

/** The owner, the right hand, a WhatsApp number the owner answers with a lead waiting, and a fake calendar. */
async function workspace(options: { calendar?: boolean } = {}) {
  f = await setup();
  const hand = (await ensureRightHand(f.db, f.org.id)) as string;
  const gateway = createFakeWhatsAppGateway();
  const account = await createWhatsAppAccount(
    { db: f.db, gateway, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: "http://agentes:3000" },
    f.owner.id,
    f.org.id,
    { label: "Comercial" },
  );
  const [chat] = await f.db
    .insert(schema.whatsappChats)
    .values({
      orgId: f.org.id,
      accountId: account.id,
      jid: "5511988887777@s.whatsapp.net",
      name: "Lexeer",
      lastAt: new Date(NOW.getTime() - 10 * 60_000),
      lastText: "Quanto custa uma reforma?",
      unread: 4,
    })
    .returning();
  const reads: { from: Date; to: Date }[] = [];
  const deps: SectorCardDeps = {
    ...f.artifactDeps,
    pubsub: f.pubsub,
    now: () => NOW,
    calendar:
      options.calendar === false
        ? null
        : async (from, to) => {
            reads.push({ from, to });
            return eventsOfAnswer(GOOGLE).filter((e) => !e.start || (e.start >= from && e.start < to));
          },
  };
  const dm = await openDm(f.db, f.owner.id, f.org.id, { agentId: hand });
  return { hand, account, chat: chat as typeof schema.whatsappChats.$inferSelect, deps, dm, reads };
}

const actionsOf = (artifactId: string) =>
  f.db.select().from(schema.blockActions).where(eq(schema.blockActions.artifactId, artifactId));

describe("the Agenda from Google Calendar (docs/adr/doug-0020-doug-sector-cards.md §3)", () => {
  test("events by start, a Meet call named, colors as tones, cancelled ones left out", () => {
    const events = eventsOfAnswer({ data: GOOGLE });
    expect(events.map((e) => [e.title, e.place, e.tone, e.link])).toEqual([
      ["Feriado", "", null, null],
      ["Call Five Rings", "Google Meet", "blue", "https://meet.google.com/abc-defg-hij"],
      ["Revisão com o Ronny", "Escritório", null, null],
    ]);
  });

  test("what is left of today; in the evening with nothing left, tomorrow's", async () => {
    const read = async () => eventsOfAnswer(GOOGLE).filter((e) => e.start !== null);
    const found = await agendaDay(read, NOW, "America/Sao_Paulo");
    expect(found?.events.map((e) => e.title)).toEqual(["Call Five Rings", "Revisão com o Ronny"]);
    const late = new Date("2026-11-19T22:00:00Z");
    const tomorrow = dayBounds(late, "America/Sao_Paulo", 1);
    expect(tomorrow.from.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    const asked: Date[] = [];
    await agendaDay(
      async (from) => {
        asked.push(from);
        return [];
      },
      late,
      "America/Sao_Paulo",
    );
    expect(asked.map((d) => d.toISOString())).toEqual(["2026-11-19T03:00:00.000Z", "2026-11-20T03:00:00.000Z"]);
  });
});

describe("the right hand's sector cards (docs/adr/doug-0020-doug-sector-cards.md)", () => {
  test("the pills: the sectors with something, and the agenda only with a calendar", async () => {
    const w = await workspace();
    expect(await sectorPills(w.deps, f.owner.id, f.org.id, w.hand)).toEqual([
      { sector: "whatsapp", count: 4 },
      { sector: "calendar", count: 0 },
    ]);
    expect(w.reads).toEqual([]);
    const none = await sectorPills({ ...w.deps, calendar: null }, f.owner.id, f.org.id, w.hand);
    expect(none.map((p) => p.sector)).toEqual(["whatsapp"]);
    await expect(sectorPills(w.deps, f.owner.id, f.org.id, f.agent.id)).rejects.toThrow("Agent not found");
  });

  test("a pill pressed: the WhatsApp card, its buttons in an actions part, held on the server", async () => {
    const w = await workspace();
    const message = await showSectorCard(w.deps, f.owner.id, f.org.id, w.hand, "whatsapp");
    expect(message.channelId).toBe(w.dm.id);
    const links = message.meta.artifacts as { id: string }[];
    expect(links).toHaveLength(1);
    const id = links[0]?.id as string;
    expect(message.meta.sectorCards).toMatchObject({ why: "asked", items: [{ sector: "whatsapp", artifactId: id }] });
    const [artifact] = await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, id));
    expect(artifact?.kind).toBe("block");
    const acts = await actionsOf(id);
    expect(acts.map((a) => [a.act, a.kind, a.forUserId]).sort()).toEqual([
      ["mine", "whatsapp_mine", f.owner.id],
      ["reply", "ask_agent", f.owner.id],
    ]);
  });

  test("Responder: the person's own message to the right hand, once, and the button done for everyone", async () => {
    const w = await workspace();
    const message = await showSectorCard(w.deps, f.owner.id, f.org.id, w.hand, "whatsapp");
    const id = (message.meta.artifacts as { id: string }[])[0]?.id as string;
    const done = await runBlockAct(w.deps, f.owner.id, f.org.id, id, "reply");
    expect(done.messageId).not.toBeNull();
    const [sent] = await f.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.id, done.messageId as string)));
    expect(sent?.authorUserId).toBe(f.owner.id);
    expect(sent?.body).toContain("Lexeer");
    expect(sent?.channelId).toBe(w.dm.id);
    await expect(runBlockAct(w.deps, f.owner.id, f.org.id, id, "reply")).rejects.toThrow("already done");
    const state = await getBlockState(w.deps, f.owner.id, f.org.id, id, 1);
    expect(state.state._acted).toEqual({ reply: "done" });
    await expect(runBlockAct(w.deps, f.owner.id, f.org.id, id, "nope")).rejects.toThrow("does nothing");
  });

  test("Eu respondo: only the card's person; the number's agent stays out of that conversation", async () => {
    const w = await workspace();
    const message = await showSectorCard(w.deps, f.owner.id, f.org.id, w.hand, "whatsapp");
    const id = (message.meta.artifacts as { id: string }[])[0]?.id as string;
    await runBlockAct(w.deps, f.owner.id, f.org.id, id, "mine");
    const [chat] = await f.db.select().from(schema.whatsappChats).where(eq(schema.whatsappChats.id, w.chat.id));
    expect(chat?.agentOff).toBe(true);
    const bia = await addMember(f.db, f.org.id, "admin", "Bia");
    await expect(runBlockAct(w.deps, bia.id, f.org.id, id, "reply")).rejects.toThrow();
  });

  test("nobody sets the server's mark by hand", async () => {
    const w = await workspace();
    const message = await showSectorCard(w.deps, f.owner.id, f.org.id, w.hand, "whatsapp");
    const id = (message.meta.artifacts as { id: string }[])[0]?.id as string;
    await expect(
      setBlockState(w.deps, f.owner.id, f.org.id, id, { version: 1, values: { _acted: { reply: "done" } } }),
    ).rejects.toThrow("invalid name");
  });

  test("the day's brief at the opening ronda: each sector with something, once a day", async () => {
    const w = await workspace();
    const since = new Date(NOW.getTime() - 3_600_000);
    const input = { orgId: f.org.id, agentId: w.hand, personId: f.owner.id, channelId: w.dm.id, since };
    expect(await deliverSectorCards(w.deps, { ...input, opening: true })).toEqual(["whatsapp", "calendar"]);
    const posted = await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, w.dm.id));
    const brief = posted.find((m) => (m.meta.sectorCards as { why?: string } | undefined)?.why === "brief");
    if (!brief) throw new Error("no brief");
    const links = brief.meta.artifacts as { id: string }[];
    expect(links.length).toBe(2);
    const [agenda] = await f.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, links[1]?.id as string));
    expect(agenda?.title).toMatch(/·/);
    // The same slot again, or the next one: nothing new, nothing posted.
    expect(await deliverSectorCards(w.deps, { ...input, opening: true })).toEqual([]);
    expect(await deliverSectorCards(w.deps, { ...input, opening: false })).toEqual([]);
  });

  test("during the day: a lead that arrived brings its card, one card per thing, at most six a day", async () => {
    const w = await workspace({ calendar: false });
    const input = { orgId: f.org.id, agentId: w.hand, personId: f.owner.id, channelId: w.dm.id, opening: false };
    // Before the window: nothing arrived.
    expect(await deliverSectorCards(w.deps, { ...input, since: NOW })).toEqual([]);
    const since = new Date(NOW.getTime() - 3_600_000);
    expect(await deliverSectorCards(w.deps, { ...input, since })).toEqual(["whatsapp"]);
    expect(await deliverSectorCards(w.deps, { ...input, since })).toEqual([]);
    for (let i = 0; i < 8; i++) {
      await f.db
        .update(schema.whatsappChats)
        .set({ lastAt: new Date(NOW.getTime() - 60_000 + i) })
        .where(eq(schema.whatsappChats.id, w.chat.id));
      await deliverSectorCards(w.deps, { ...input, since });
    }
    const arrived = (await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, w.dm.id))).filter(
      (m) => (m.meta.sectorCards as { why?: string } | undefined)?.why === "arrived",
    );
    expect(arrived).toHaveLength(6);
  });

  test("an agent's own block can't hold a server action", async () => {
    await workspace();
    const source = createBlockToolSource(f.artifactDeps);
    const ctx = { db: f.db, orgId: f.org.id, agentId: f.agent.id, channelId: f.general.id } as unknown as ToolContext;
    const show = (await source.tools(ctx)).find((t) => t.name === "show_block");
    const out = await show?.execute(
      { title: "x", spec: { parts: [{ type: "actions", buttons: [{ label: "Go", act: "go" }] }] } },
      ctx,
    );
    expect(out?.isError).toBe(true);
    expect(String(out?.content)).toContain("act");
  });
});
