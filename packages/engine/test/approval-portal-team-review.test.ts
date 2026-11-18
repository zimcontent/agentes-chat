import { afterEach, describe, expect, test } from "bun:test";
import { createFakeApprovalPortal } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  cardReviews,
  myPortalWork,
  portalBoard,
  portalOverview,
  portalPipeline,
  portalPlan,
  portalTaskOf,
  scheduleRank,
  syncPortalTasks,
  tieSentCards,
  updateIssue,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/**
 * A card the team approved in Review (ADR 9001, addendum 2026-11-18). The case that brought it: two of an editor's
 * videos approved in Review stayed "to do" on the schedule and the board, so nobody could find them to send them to
 * the client; and the editor's tasks came in the order the cards were made, not the order the schedule has them.
 */

const { issues, videoReviews } = schema;
let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const NOW = new Date("2026-11-18T15:00:00Z");

async function review(
  over: Partial<typeof videoReviews.$inferInsert> & { taskId?: string | null; portalCard?: string | null },
) {
  const [row] = await f.db
    .insert(videoReviews)
    .values({
      orgId: f.org.id,
      channelId: crypto.randomUUID(),
      title: "Vídeo",
      client: "fontes",
      portalClient: "fontes",
      senderUserId: f.owner.id,
      ...over,
    })
    .returning();
  if (!row) throw new Error("no review");
  return row;
}

/** A client's schedule with two lists, and an editor's two videos in the first, as the team made them. */
async function editorsWeek() {
  const deps = { db: f.db, pubsub: f.pubsub };
  const ronny = await addMember(f.db, f.org.id, "member", "Ronny");
  const portal = createFakeApprovalPortal();
  const week = await portal.createList("fontes", "SEMANA");
  const card50 = await portal.createCard("fontes", {
    title: "Vídeo 50 mil dólares",
    list: week.id,
    order: 9,
    produceOn: "2026-11-19",
    members: [ronny.id],
  });
  const pool = await portal.createCard("fontes", {
    title: "Vídeo pool",
    list: week.id,
    order: 10,
    produceOn: "2026-11-19",
    members: [ronny.id],
  });
  await syncPortalTasks(deps, portal, f.org.id);
  const task50 = await portalTaskOf(f.db, f.org.id, card50.id);
  const taskPool = await portalTaskOf(f.db, f.org.id, pool.id);
  if (!task50 || !taskPool) throw new Error("no tasks");
  return { deps, ronny, portal, week, card50, pool, task50, taskPool };
}

describe("a card the team approved in Review", () => {
  test("reads as approved by the team on the schedule, the board, the overview and the pipeline, ready to go up", async () => {
    f = await setup();
    const { portal, card50, pool, task50, taskPool } = await editorsWeek();
    // The editor's videos, sent from their tasks and approved in Review: the review holds the card (doug-0012).
    await review({ taskId: task50.id, portalCard: card50.id, status: "approved", title: "Vídeo 50 mil dólares" });
    await review({ taskId: taskPool.id, portalCard: pool.id, status: "in_review", title: "Vídeo pool" });
    const reviewsOf = (cards: Parameters<typeof cardReviews>[2]) => cardReviews(f.db, f.org.id, cards);

    const plan = await portalPlan(portal, "fontes", reviewsOf);
    const [first, second] = plan.lists[0]?.cards ?? [];
    expect(first).toMatchObject({ id: card50.id, stage: "approved", review: { status: "approved" } });
    expect(second).toMatchObject({ id: pool.id, stage: "doing", review: { status: "in_review" } });

    const board = await portalBoard(portal, "fontes", reviewsOf);
    // Still in its own column for an app from before; the review says where the apps draw it.
    expect(board.cards.todo.map((c) => [c.id, c.review?.status])).toEqual([
      [card50.id, "approved"],
      [pool.id, "in_review"],
    ]);

    const [summary] = await portalOverview(portal, reviewsOf);
    expect(summary?.counts).toMatchObject({ todo: 0, doing: 1, approved: 1 });

    const pipeline = await portalPipeline(portal, NOW, "America/Sao_Paulo", reviewsOf);
    expect(pipeline.entries.find((e) => e.id === card50.id)).toMatchObject({
      stage: "approved",
      review: { status: "approved" },
    });

    // Without the reviews read (an agent's tool with no database, a test of the bare plan), the card is as it was.
    expect((await portalPlan(portal, "fontes")).lists[0]?.cards[0]).toMatchObject({ stage: "todo", review: null });
  });

  test("a review is found by its card, by its task, or by the task's conversation, and only until it goes up", async () => {
    f = await setup();
    const { portal, card50, pool, task50, taskPool } = await editorsWeek();
    const room = f.general.id;
    await f.db.update(issues).set({ conversationChannelId: room }).where(eq(issues.id, taskPool.id));
    // An agent's design piece sent from the task's room: no card or task of its own (doug-0019 §4).
    await review({ channelId: room, status: "changes", senderUserId: null, medium: "design" });
    // A first video approved and a second still in Review: the card waits for both.
    await review({ taskId: task50.id, portalCard: card50.id, status: "approved" });
    const second = await review({ taskId: task50.id, portalCard: null, status: "in_review", taskPart: 2 });
    let found = await cardReviews(f.db, f.org.id, await portal.cards());
    expect(found.get(card50.id)).toMatchObject({ status: "in_review", reviewId: second.id, approved: 1, total: 2 });
    expect(found.get(pool.id)).toMatchObject({ status: "changes", approved: 0, total: 1 });

    // The second went to the client through Review (its own card): the first alone is left, approved.
    await f.db
      .update(videoReviews)
      .set({ status: "approved", delivery: { state: "sent", item: "p9" } })
      .where(eq(videoReviews.id, second.id));
    found = await cardReviews(f.db, f.org.id, await portal.cards());
    expect(found.get(card50.id)).toMatchObject({ status: "approved", approved: 1, total: 1 });

    // A card that went up is the portal's: no review is read for it.
    await portal.updateCard(card50.id, { item: "p1" });
    found = await cardReviews(f.db, f.org.id, await portal.cards());
    expect(found.has(card50.id)).toBe(false);
  });

  test("sent from the schedule, the card's approved review becomes the post's", async () => {
    f = await setup();
    const { portal, card50, task50 } = await editorsWeek();
    const approved = await review({ taskId: task50.id, portalCard: card50.id, status: "approved" });
    const waiting = await review({ portalCard: card50.id, status: "in_review" });
    await portal.updateCard(card50.id, { item: "p1" });
    expect(await tieSentCards(f.db, f.org.id, await portal.cards())).toBe(1);
    const [row] = await f.db.select().from(videoReviews).where(eq(videoReviews.id, approved.id));
    expect(row?.delivery).toMatchObject({ state: "sent", item: "p1" });
    // Only an approved review is the post's; and a second pass marks nothing again.
    const [other] = await f.db.select().from(videoReviews).where(eq(videoReviews.id, waiting.id));
    expect(other?.delivery).toBeNull();
    expect(await tieSentCards(f.db, f.org.id, await portal.cards())).toBe(0);
  });

  test("the task follows Review once per decision, and the pass tells nobody the client approved it", async () => {
    f = await setup();
    const { deps, portal, card50, task50 } = await editorsWeek();
    const sent = await review({ taskId: task50.id, portalCard: card50.id, status: "in_review" });

    let pass = await syncPortalTasks(deps, portal, f.org.id);
    expect((await portalTaskOf(f.db, f.org.id, card50.id))?.status).toBe("in_review");
    expect(pass.changes).toEqual([]);

    await f.db.update(videoReviews).set({ status: "changes" }).where(eq(videoReviews.id, sent.id));
    await syncPortalTasks(deps, portal, f.org.id);
    expect((await portalTaskOf(f.db, f.org.id, card50.id))?.status).toBe("in_progress");

    await f.db.update(videoReviews).set({ status: "approved" }).where(eq(videoReviews.id, sent.id));
    pass = await syncPortalTasks(deps, portal, f.org.id);
    const task = await portalTaskOf(f.db, f.org.id, card50.id);
    expect(task?.status).toBe("in_review");
    // A stage the team's review gives is never said as the client's: no "the client approved" line goes anywhere.
    expect(pass.changes).toEqual([]);
    const synced = (task?.source ?? {}) as { synced?: { card?: { stage?: string } } };
    expect(synced.synced?.card?.stage).toBe("todo");

    // A person moves the task by hand: the same decision doesn't move it back.
    await updateIssue(deps, { type: "person", userId: f.owner.id }, f.org.id, task50.id, { status: "in_progress" });
    await syncPortalTasks(deps, portal, f.org.id);
    expect((await portalTaskOf(f.db, f.org.id, card50.id))?.status).toBe("in_progress");
  });

  test("an editor's Home leaves out what the team approved: it waits on whoever sends it", async () => {
    f = await setup();
    const { portal, ronny, card50, pool, task50 } = await editorsWeek();
    await review({ taskId: task50.id, portalCard: card50.id, status: "approved" });
    const work = await myPortalWork(portal, ronny.id, NOW, "America/Sao_Paulo", (cards) =>
      cardReviews(f.db, f.org.id, cards),
    );
    expect(work.next.map((c) => c.id)).toEqual([pool.id]);
  });
});

describe("an editor's work in the schedule's order", () => {
  test("Home lists it by day, then by the schedule's lists and order, never by when the card was made", async () => {
    f = await setup();
    const ronny = await addMember(f.db, f.org.id, "member", "Ronny");
    const portal = createFakeApprovalPortal();
    const week = await portal.createList("fontes", "SEMANA");
    const next = await portal.createList("fontes", "SEMANA 23/11");
    const other = await portal.createList("lexeer", "SEMANA");
    const day = "2026-11-18";
    const make = (client: string, title: string, list: string, order: number) =>
      portal.createCard(client, { title, list, order, produceOn: day, members: [ronny.id] });
    // Made in this order; the team then put them where they belong.
    await make("fontes", "Tráfego Do Brasil", week.id, 5);
    await make("fontes", "Semana que vem", next.id, 1);
    await make("lexeer", "Yale 1438", other.id, 2.75);
    await make("fontes", "Vídeo alavancagem", week.id, 4.5);
    await make("lexeer", "Carrossel Luxo", other.id, 1.25);
    const work = await myPortalWork(portal, ronny.id, NOW);
    expect(work.today_.map((c) => c.title)).toEqual([
      "Vídeo alavancagem",
      "Carrossel Luxo",
      "Tráfego Do Brasil",
      "Yale 1438",
      "Semana que vem",
    ]);
  });

  test("the tasks' board follows the schedule: a card moved moves its task, and the rank leaves the task unchanged", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const portal = createFakeApprovalPortal();
    const week = await portal.createList("fontes", "SEMANA");
    const a = await portal.createCard("fontes", { title: "A", list: week.id, order: 1, produceOn: "2026-11-19" });
    const b = await portal.createCard("fontes", { title: "B", list: week.id, order: 2, produceOn: "2026-11-19" });
    await syncPortalTasks(deps, portal, f.org.id);
    const rank = async (id: string) => (await portalTaskOf(f.db, f.org.id, id))?.boardRank ?? Number.NaN;
    expect(await rank(a.id)).toBeLessThan(await rank(b.id));
    expect(await rank(a.id)).toBe(scheduleRank("2026-11-19", 0));

    const before = await portalTaskOf(f.db, f.org.id, a.id);
    // B goes first in the list: its task goes first too, with no activity and no new "updated" time.
    await portal.updateCard(b.id, { order: 0.5 });
    const pass = await syncPortalTasks(deps, portal, f.org.id);
    expect(pass.toTasks).toBe(0);
    expect(await rank(b.id)).toBeLessThan(await rank(a.id));
    const after = await portalTaskOf(f.db, f.org.id, a.id);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime() ?? 0);

    // An earlier production day comes first, whatever the list says.
    await portal.updateCard(a.id, { produceOn: "2026-11-18" });
    await syncPortalTasks(deps, portal, f.org.id);
    expect(await rank(a.id)).toBeLessThan(await rank(b.id));
  });
});
