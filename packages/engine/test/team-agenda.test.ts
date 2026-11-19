import { afterEach, describe, expect, test } from "bun:test";
import { agendaEnd, createIssue, ForbiddenError, teamAgenda, updateIssue, ValidationError } from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const person = (userId: string) => ({ type: "person" as const, userId });

describe("team agenda", () => {
  test("the end date counts the first day", () => {
    expect(agendaEnd("2026-11-16", 7)).toBe("2026-11-22");
    expect(agendaEnd("2026-12-30", 3)).toBe("2027-01-01");
  });

  test("owners and admins read each one's open, assigned tasks due through the last day, late and undated ones included, in queue order", async () => {
    f = await setup();
    const deps = { db: f.db, pubsub: f.pubsub };
    const owner = person(f.owner.id);
    const ronny = await addMember(f.db, f.org.id, "member", "Ronny");
    const admin = await addMember(f.db, f.org.id, "admin", "Letícia");
    const to = (id: string) => ({ type: "person" as const, id });

    const late = await createIssue(deps, owner, f.org.id, {
      title: "Atrasada",
      assignee: to(ronny.id),
      dueDate: "2026-11-14",
    });
    const monday = await createIssue(deps, owner, f.org.id, {
      title: "Segunda",
      assignee: to(ronny.id),
      dueDate: "2026-11-16",
    });
    const agent = await createIssue(deps, owner, f.org.id, {
      title: "Do agente",
      assignee: { type: "agent", id: f.agent.id },
      dueDate: "2026-11-17",
    });
    await createIssue(deps, owner, f.org.id, { title: "Longe", assignee: to(ronny.id), dueDate: "2026-11-30" });
    // Under way: on the agenda whatever its date, or with none.
    const doing = await createIssue(deps, owner, f.org.id, { title: "Fazendo", assignee: to(ronny.id) });
    await updateIssue(deps, owner, f.org.id, doing.id, { status: "in_progress" });
    const undated = await createIssue(deps, owner, f.org.id, { title: "Sem data", assignee: to(ronny.id) });
    await createIssue(deps, owner, f.org.id, { title: "Sem dono", dueDate: "2026-11-16" });
    const done = await createIssue(deps, owner, f.org.id, {
      title: "Feita",
      assignee: to(ronny.id),
      dueDate: "2026-11-16",
    });
    await updateIssue(deps, owner, f.org.id, done.id, { status: "done" });

    const agenda = await teamAgenda(f.db, admin.id, f.org.id, { from: "2026-11-16", days: 4 });
    expect(agenda.to).toBe("2026-11-19");
    // Each one's tasks in their queue's order (ADR doug-0022): Ronny's in the order they reached him.
    expect(agenda.tasks.map((t) => t.id)).toEqual([late.id, agent.id, monday.id, doing.id, undated.id]);
    expect(agenda.tasks.filter((t) => t.assignee.id === ronny.id).map((t) => t.id)).toEqual([
      late.id,
      monday.id,
      doing.id,
      undated.id,
    ]);
    expect(agenda.tasks[0]).toMatchObject({ assignee: { type: "person", id: ronny.id }, dueDate: "2026-11-14" });
    expect((await teamAgenda(f.db, f.owner.id, f.org.id, { from: "2026-11-16" })).tasks).toHaveLength(5);

    // A member who is not an admin has no team agenda, and a date that isn't one is refused.
    await expect(teamAgenda(f.db, ronny.id, f.org.id, { from: "2026-11-16" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teamAgenda(f.db, admin.id, f.org.id, { from: "16/11/2026" })).rejects.toBeInstanceOf(ValidationError);
  });
});
