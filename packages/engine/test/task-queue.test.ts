import { afterEach, describe, expect, test } from "bun:test";
import { userTopic } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import {
  createIssue,
  ForbiddenError,
  moveInQueue,
  NotFoundError,
  openTasksBrief,
  portalQueueOf,
  teamAgenda,
  updateIssue,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const person = (userId: string) => ({ type: "person" as const, userId });
const to = (id: string) => ({ type: "person" as const, id });

describe("each assignee's queue", () => {
  test("tasks line up in the order they reach someone, whatever their dates or priority", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const owner = person(f.owner.id);
    const ronny = await addMember(f.db, f.org.id, "member", "Ronny");
    const leticia = await createIssue(deps, owner, f.org.id, {
      title: "Vídeo da Leticia",
      assignee: to(ronny.id),
      dueDate: "2026-11-20",
    });
    const fontes = await createIssue(deps, owner, f.org.id, {
      title: "Vídeo da Fontes",
      assignee: to(ronny.id),
      dueDate: "2026-11-18",
      priority: "high",
    });
    const loose = await createIssue(deps, owner, f.org.id, { title: "Sem dono" });
    const agenda = await teamAgenda(f.db, f.owner.id, f.org.id, { from: "2026-11-16" });
    expect(agenda.tasks.map((t) => t.id)).toEqual([leticia.id, fontes.id]);

    // Given to him later: the end of his queue. Taken away: out of it.
    await updateIssue(deps, owner, f.org.id, loose.id, { assignee: to(ronny.id) });
    expect((await teamAgenda(f.db, f.owner.id, f.org.id, { from: "2026-11-16" })).tasks.map((t) => t.id)).toEqual([
      leticia.id,
      fontes.id,
      loose.id,
    ]);
    await updateIssue(deps, owner, f.org.id, leticia.id, { assignee: null });
    const [gone] = await f.db
      .select({ position: schema.issues.queuePosition })
      .from(schema.issues)
      .where(eq(schema.issues.id, leticia.id));
    expect(gone?.position).toBeNull();
    // Back to him: behind what he already has, not where it was.
    await updateIssue(deps, owner, f.org.id, leticia.id, { assignee: to(ronny.id) });
    expect((await teamAgenda(f.db, f.owner.id, f.org.id, { from: "2026-11-16" })).tasks.map((t) => t.id)).toEqual([
      fontes.id,
      loose.id,
      leticia.id,
    ]);
    // Done and opened again: it arrives again.
    await updateIssue(deps, owner, f.org.id, fontes.id, { status: "done" });
    await updateIssue(deps, owner, f.org.id, fontes.id, { status: "todo" });
    expect((await teamAgenda(f.db, f.owner.id, f.org.id, { from: "2026-11-16" })).tasks.map((t) => t.id)).toEqual([
      loose.id,
      leticia.id,
      fontes.id,
    ]);
  });

  test("owners and admins move a task; it is audited, admins hear it, and the agenda follows", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const owner = person(f.owner.id);
    const ronny = await addMember(f.db, f.org.id, "member", "Ronny");
    const admin = await addMember(f.db, f.org.id, "admin", "Bia");
    const make = (title: string) => createIssue(deps, owner, f.org.id, { title, assignee: to(ronny.id) });
    const a = await make("A");
    const b = await make("B");
    const c = await make("C");
    const other = await createIssue(deps, owner, f.org.id, {
      title: "Do agente",
      assignee: { type: "agent", id: f.agent.id },
    });
    const heard: { type: string }[] = [];
    f.pubsub.subscribe(userTopic(f.org.id, admin.id), (e) => heard.push(e as { type: string }));
    const order = async () =>
      (await teamAgenda(f.db, admin.id, f.org.id, { from: "2026-11-16" })).tasks
        .filter((t) => t.assignee.id === ronny.id)
        .map((t) => t.title);

    expect(await moveInQueue(deps, admin.id, f.org.id, to(ronny.id), { taskId: c.id, afterId: null })).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
    expect(await order()).toEqual(["C", "A", "B"]);
    await moveInQueue(deps, f.owner.id, f.org.id, to(ronny.id), { taskId: c.id, afterId: a.id });
    expect(await order()).toEqual(["A", "C", "B"]);
    // Many moves between the same two: the middle keeps working, renumbered when it runs out.
    for (let i = 0; i < 60; i++) {
      const moving = i % 2 === 0 ? b : c;
      await moveInQueue(deps, admin.id, f.org.id, to(ronny.id), { taskId: moving.id, afterId: a.id });
    }
    expect(await order()).toEqual(["A", "C", "B"]);
    await moveInQueue(deps, admin.id, f.org.id, to(ronny.id), { taskId: a.id, afterId: b.id });
    expect(await order()).toEqual(["C", "B", "A"]);
    expect(heard.some((e) => e.type === "issue.queue")).toBe(true);

    const audit = await f.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, f.org.id), eq(schema.auditLog.action, "issue.queue_changed")));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]).toMatchObject({ actorId: admin.id, targetType: "issue", targetId: c.id });

    // A member who isn't an admin can't, and a task of another queue isn't moved through this one.
    await expect(
      moveInQueue(deps, ronny.id, f.org.id, to(ronny.id), { taskId: a.id, afterId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      moveInQueue(deps, admin.id, f.org.id, to(ronny.id), { taskId: other.id, afterId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      moveInQueue(deps, admin.id, f.org.id, to(ronny.id), { taskId: a.id, afterId: other.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a person's portal cards read their tasks' places, by card", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const owner = person(f.owner.id);
    const ronny = await addMember(f.db, f.org.id, "member", "Ronny");
    const card = (cardId: string) =>
      createIssue(deps, owner, f.org.id, {
        title: cardId,
        assignee: to(ronny.id),
        source: { type: "portal", client: "acme", cardId },
      });
    const first = await card("c-1");
    const second = await card("c-2");
    await createIssue(deps, owner, f.org.id, { title: "Not a card", assignee: to(ronny.id) });
    await moveInQueue(deps, f.owner.id, f.org.id, to(ronny.id), { taskId: second.id, afterId: null });
    const places = await portalQueueOf(f.db, f.org.id, ronny.id);
    expect([...places.keys()].sort()).toEqual(["c-1", "c-2"]);
    expect((places.get("c-2") ?? 0) < (places.get("c-1") ?? 0)).toBe(true);
    expect(first.id).not.toBe(second.id);
  });

  test("an agent reads its tasks in its queue's order", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const owner = person(f.owner.id);
    const mine = { type: "agent" as const, id: f.agent.id };
    const first = await createIssue(deps, owner, f.org.id, { title: "Primeira", assignee: mine });
    const second = await createIssue(deps, owner, f.org.id, { title: "Segunda", assignee: mine });
    // Activity on the second doesn't move it ahead.
    await updateIssue(deps, owner, f.org.id, second.id, { description: "mais detalhes" });
    const brief = (await openTasksBrief(f.db, f.org.id, f.agent.id, f.general.id, false)) ?? "";
    expect(brief.indexOf("Primeira")).toBeLessThan(brief.indexOf("Segunda"));
    await moveInQueue(deps, f.owner.id, f.org.id, mine, { taskId: second.id, afterId: null });
    const moved = (await openTasksBrief(f.db, f.org.id, f.agent.id, f.general.id, false)) ?? "";
    expect(moved.indexOf("Segunda")).toBeLessThan(moved.indexOf("Primeira"));
    expect(first.id).not.toBe(second.id);
  });
});
