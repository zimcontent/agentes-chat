import { afterEach, expect, test } from "bun:test";
import { createFakeApprovalPortal, type PortalItem } from "@dougbot/adapters";
import { eq, schema } from "@dougbot/db";
import {
  type Browser,
  browser,
  createTestServer,
  joinByInvitation,
  ORIGIN,
  seedOrg,
  signUp,
  type TestServer,
} from "./harness";

// The approval portal's routes (ADR 9001): the board per client, the team's cards, and a send that reads each Drive
// file as the caller may and hands it to the portal, with no model in the way.

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

const item = (over: Partial<PortalItem>): PortalItem => ({
  client: "acme",
  id: "up-1",
  title: "Launch reel",
  type: "reel",
  status: "sent",
  scheduledFor: null,
  publishedAt: null,
  createdAt: null,
  updatedAt: null,
  editor: null,
  caption: "",
  files: 1,
  video: true,
  version: 1,
  missing: [],
  released: false,
  lastNote: null,
  postUrl: null,
  link: "https://portal.example.com/i/acme/up-1",
  ...over,
});

async function start(portal: ReturnType<typeof createFakeApprovalPortal> | null) {
  t = await createTestServer({ approvalPortal: portal, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const base = `/api/app/organizations/${orgId}`;
  const api = (path: string, init?: Parameters<Browser>[1]) => owner(`${base}${path}`, init);
  const upload = async (name: string, type: string, bytes: Uint8Array) => {
    const form = new FormData();
    form.set("file", new File([bytes], name, { type }));
    const res = await t.app.request(`${base}/artifacts/files`, {
      method: "POST",
      headers: { cookie: owner.cookie(), origin: ORIGIN },
      body: form,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  return { owner, orgId, base, api, upload, agentId };
}

const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

test("no portal on the server: the flag is off and every route answers portal.off", async () => {
  const { api, owner } = await start(null);
  const config = (await (await owner("/api/app/auth-config")).json()) as { approvalPortal: boolean };
  expect(config.approvalPortal).toBe(false);
  const res = await api("/portal");
  expect(res.status).toBe(404);
  expect(await code(res)).toBe("portal.off");
  expect((await api("/portal/clients/acme")).status).toBe(404);
});

test("the overview counts each client's columns and the board puts every post in its column", async () => {
  const portal = createFakeApprovalPortal({
    items: [
      item({ id: "up-1", status: "sent" }),
      item({ id: "up-2", status: "adjust_requested", lastNote: { at: null, by: "Client", text: "Make it shorter" } }),
      item({ id: "up-3", status: "adjusted" }),
      item({ id: "up-4", status: "approved", scheduledFor: "2026-12-02T10:00:00-03:00" }),
      item({ id: "up-5", status: "scheduled", scheduledFor: "2026-12-01T10:00:00-03:00" }),
      item({ id: "up-6", status: "published" }),
      item({ id: "up-7", client: "zeta", status: "published" }),
    ],
  });
  const { api, owner } = await start(portal);
  expect(((await (await owner("/api/app/auth-config")).json()) as { approvalPortal: boolean }).approvalPortal).toBe(
    true,
  );
  const made = await api("/portal/cards", { json: { client: "acme", title: "December carousel", type: "carousel" } });
  expect(made.status).toBe(200);

  const overview = (await (await api("/portal")).json()) as {
    clients: {
      client: string;
      counts: Record<string, number>;
      open: number;
      next: string | null;
      color: string | null;
      logo: string | null;
      name: string | null;
    }[];
  };
  // The client with open work first; what is posted isn't open.
  expect(overview.clients.map((c) => c.client)).toEqual(["acme", "zeta"]);
  expect(overview.clients[0]).toEqual({
    client: "acme",
    counts: { todo: 1, doing: 0, approval: 2, adjusting: 1, approved: 1, scheduled: 1, posted: 1 },
    open: 6,
    next: "2026-12-01T10:00:00-03:00",
    color: null,
    logo: null,
    name: null,
  });
  expect(overview.clients[1]).toMatchObject({ open: 0, counts: { posted: 1 } });

  const board = (await (await api("/portal/clients/acme")).json()) as {
    cards: { todo: { title: string }[]; doing: unknown[] };
    items: Record<string, { id: string; lastNote: { text: string } | null }[]>;
  };
  expect(board.cards.todo.map((c) => c.title)).toEqual(["December carousel"]);
  expect(board.items.approval?.map((i) => i.id)).toEqual(["up-1", "up-3"]);
  expect(board.items.adjusting?.[0]).toMatchObject({ id: "up-2", lastNote: { text: "Make it shorter" } });
  expect(board.items.approved?.map((i) => i.id)).toEqual(["up-4"]);
  expect(board.items.scheduled?.map((i) => i.id)).toEqual(["up-5"]);
  expect(board.items.posted?.map((i) => i.id)).toEqual(["up-6"]);
  expect((await api("/portal/clients/Not%20A%20Client")).status).toBe(400);
});

test("a card moves, changes and leaves; a stranger reads nothing", async () => {
  const portal = createFakeApprovalPortal();
  const { api, orgId } = await start(portal);
  const { card } = (await (await api("/portal/cards", { json: { client: "acme", title: "Story" } })).json()) as {
    card: { id: string; state: string };
  };
  expect(card.state).toBe("todo");
  const moved = await api(`/portal/cards/${card.id}`, { method: "PATCH", json: { state: "doing", note: "filming" } });
  expect(((await moved.json()) as { card: { state: string; note: string } }).card).toMatchObject({
    state: "doing",
    note: "filming",
  });
  expect((await api("/portal/cards", { json: { client: "acme", title: "  " } })).status).toBe(400);
  expect((await api(`/portal/cards/${card.id}`, { method: "DELETE" })).status).toBe(204);
  expect(await portal.cards()).toEqual([]);

  const stranger = browser(t);
  await signUp(stranger, "stranger@example.com");
  expect((await stranger(`/api/app/organizations/${orgId}/portal`)).status).toBe(403);
  expect(
    (await stranger(`/api/app/organizations/${orgId}/portal/cards`, { json: { client: "acme", title: "x" } })).status,
  ).toBe(403);
});

test("a send reads the Drive files, hands them over in order and finishes the card; the same key sends once", async () => {
  const portal = createFakeApprovalPortal();
  const { api, upload } = await start(portal);
  const one = await upload("slide-1.png", "image/png", new Uint8Array([1, 2, 3]));
  const two = await upload("slide-2.png", "image/png", new Uint8Array([4, 5]));
  const { card } = (await (await api("/portal/cards", { json: { client: "acme", title: "Carousel" } })).json()) as {
    card: { id: string };
  };
  const body = {
    client: "acme",
    type: "carousel",
    artifactIds: [one, two],
    title: "Carousel",
    date: "2026-12-01T10:00",
    card: card.id,
    key: "k1",
  };
  const sent = await api("/portal/send", { json: body });
  expect(sent.status).toBe(200);
  const { job } = (await sent.json()) as { job: { id: string; state: string; item: string; missing: string[] } };
  expect(job).toMatchObject({ state: "done", missing: ["caption"] });
  expect(portal.sends).toHaveLength(1);
  expect(portal.sends[0]).toMatchObject({ client: "acme", type: "carousel", names: ["slide-1.png", "slide-2.png"] });
  expect([...portal.uploads.values()].map((u) => [...u.bytes])).toEqual([
    [1, 2, 3],
    [4, 5],
  ]);
  // The card it finished stays, tied to the post, which is on the board, waiting for the client.
  expect((await portal.cards()).map((c) => c.item)).toEqual([job.item]);
  const board = (await (await api("/portal/clients/acme")).json()) as {
    items: { approval: { id: string; scheduledFor: string | null }[] };
  };
  expect(board.items.approval.map((i) => i.id)).toEqual([job.item]);
  // The date an older app still sends is dropped: a post goes to the client without one (ADR 9001, addendum 2026-11-17).
  expect(board.items.approval[0]?.scheduledFor).toBeNull();
  expect(((await (await api(`/portal/jobs/${job.id}`)).json()) as { job: { id: string } }).job.id).toBe(job.id);

  // Asked again with the same key: the same job, nothing sent twice.
  const again = (await (await api("/portal/send", { json: body })).json()) as { job: { id: string } };
  expect(again.job.id).toBe(job.id);
  expect(portal.sends).toHaveLength(1);

  // A reel is one video; a file that doesn't exist stops the send before anything goes up.
  expect((await api("/portal/send", { json: { client: "acme", type: "reel", artifactIds: [one, two] } })).status).toBe(
    400,
  );
  const before = portal.uploads.size;
  const missing = await api("/portal/send", {
    json: { client: "acme", type: "image", artifactIds: [one, "00000000-0000-4000-8000-000000000000"] },
  });
  expect(missing.status).toBe(404);
  expect(portal.uploads.size).toBe(before);
});

test("a post is completed at the portal; the portal's refusal comes back in its own words, its silence as 502", async () => {
  const portal = createFakeApprovalPortal({ items: [item({ id: "up-9" })] });
  const { api } = await start(portal);
  const edited = await api("/portal/clients/acme/items/up-9", {
    method: "PATCH",
    json: { caption: "New caption", scheduledFor: null },
  });
  expect(edited.status).toBe(204);
  expect(portal.edits[0]).toMatchObject({
    client: "acme",
    item: "up-9",
    edit: { caption: "New caption", scheduledFor: null },
  });
  // A date is only cleared here, and nothing turns a post scheduled or posted: a person schedules it (ADR 9001,
  // addendum 2026-11-17).
  for (const json of [
    { scheduledFor: "2026-12-03T09:00:00-03:00" },
    { status: "scheduled" },
    { status: "published" },
  ]) {
    expect((await api("/portal/clients/acme/items/up-9", { method: "PATCH", json })).status).toBe(400);
  }
  expect(portal.edits).toHaveLength(1);

  portal.fail(400, "status must be one of the portal's");
  const refused = await api("/portal/clients/acme/items/up-9", { method: "PATCH", json: { status: "approved" } });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({
    error: { code: "portal.refused", message: "status must be one of the portal's" },
  });

  portal.fail(502, "The approval portal didn't answer");
  const down = await api("/portal");
  expect(down.status).toBe(502);
  expect(await code(down)).toBe("portal.unavailable");
  // A bridge that refuses our token is this server's problem, never shown as the member's mistake.
  portal.fail(401, "sem autorização");
  expect((await api("/portal")).status).toBe(502);
});

test("an approved post is scheduled; one the client hasn't approved is refused in the portal's words", async () => {
  const portal = createFakeApprovalPortal({
    items: [item({ id: "up-1", status: "approved" }), item({ id: "up-2", status: "sent" })],
  });
  const { api } = await start(portal);
  const path = (id: string) => `/portal/clients/acme/items/${id}/schedule`;
  expect((await api(path("up-1"), { json: { scheduledFor: "2026-12-05T10:00" } })).status).toBe(204);
  expect(portal.scheduled).toHaveLength(1);
  expect(portal.scheduled[0]).toMatchObject({ client: "acme", item: "up-1", when: "2026-12-05T10:00" });
  const board = (await (await api("/portal/clients/acme")).json()) as {
    items: { approved: { id: string; scheduledFor: string; released: boolean }[]; scheduled: unknown[] };
  };
  // Released: still approved, with its date, until the publishing service has it; never released twice.
  expect(board.items.scheduled).toEqual([]);
  expect(board.items.approved[0]).toMatchObject({ id: "up-1", scheduledFor: "2026-12-05T10:00", released: true });
  const twice = await api(path("up-1"), { json: { scheduledFor: "2026-12-05T10:00" } });
  expect(twice.status).toBe(400);
  expect(portal.scheduled).toHaveLength(1);

  const early = await api(path("up-2"), { json: { scheduledFor: "2026-12-05T10:00" } });
  expect(early.status).toBe(400);
  expect(await early.json()).toMatchObject({ error: { code: "portal.refused" } });
  expect((await api(path("up-1"), { json: { scheduledFor: "tomorrow" } })).status).toBe(400);
});

test("approved posts nobody scheduled wait on the team, the longest waiting first, until someone schedules them", async () => {
  const portal = createFakeApprovalPortal({
    items: [
      item({ id: "up-1", status: "approved", updatedAt: "2026-11-16T10:00:00-03:00" }),
      item({ id: "up-2", status: "sent" }),
      item({ id: "up-3", status: "approved", updatedAt: "2026-11-15T10:00:00-03:00" }),
      item({ id: "up-4", status: "approved", released: true }),
      item({ id: "up-5", status: "scheduled" }),
    ],
  });
  const { api } = await start(portal);
  const waiting = async () =>
    ((await (await api("/portal/to-schedule")).json()) as { items: { id: string }[] }).items.map((i) => i.id);
  expect(await waiting()).toEqual(["up-3", "up-1"]);
  // A person schedules one: it leaves the list.
  expect(
    (await api("/portal/clients/acme/items/up-3/schedule", { json: { scheduledFor: "2099-12-05T10:00" } })).status,
  ).toBe(204);
  expect(await waiting()).toEqual(["up-1"]);
});

test("an admin approves for a client who went quiet: approved at the portal, said on the card and in the audit", async () => {
  const portal = createFakeApprovalPortal({
    items: [item({ id: "up-1", status: "seen" }), item({ id: "up-2", status: "adjust_requested" })],
  });
  const { api, orgId, owner } = await start(portal);
  const card = await portal.createCard("acme", { title: "Launch reel", type: "reel", item: "up-1" });
  const path = (id: string) => `/portal/clients/acme/items/${id}/approve`;

  // A member who may give work but isn't an administrator can't.
  const member = await joinByInvitation(t, owner, orgId, "bia@example.com");
  expect((await member(`/api/app/organizations/${orgId}${path("up-1")}`, { json: {} })).status).toBe(403);
  expect(portal.edits).toEqual([]);

  expect((await api(path("up-1"), { json: { note: "Said yes on WhatsApp" } })).status).toBe(204);
  expect(portal.edits).toHaveLength(1);
  expect(portal.edits[0]).toMatchObject({ client: "acme", item: "up-1", edit: { status: "approved" } });
  const board = (await (await api("/portal/clients/acme")).json()) as { items: { approved: { id: string }[] } };
  expect(board.items.approved.map((i) => i.id)).toEqual(["up-1"]);
  const said = (await portal.cards()).find((c) => c.id === card.id)?.comments.map((c) => c.text) ?? [];
  expect(said[0]).toContain("Motivo: Said yes on WhatsApp");
  const audit = (await (await api("/audit?kind=change")).json()) as {
    rows: { action: string; details: Record<string, unknown> }[];
  };
  expect(audit.rows.find((e) => e.action === "portal.approved_for_client")?.details).toMatchObject({
    title: "Launch reel",
    client: "acme",
    note: "Said yes on WhatsApp",
  });

  // Already approved, or sent back by the client: not the client's move, refused.
  expect((await api(path("up-1"), { json: {} })).status).toBe(400);
  expect((await api(path("up-2"), { json: {} })).status).toBe(400);
  expect(portal.edits).toHaveLength(1);
});

test("a portal that stopped answering: the last good read comes marked stale, with what still waits to reach it", async () => {
  const portal = createFakeApprovalPortal({ items: [item({ id: "up-1" })] });
  const { api } = await start(portal);
  type State = { state: { stale: boolean; readAt: string | null; queued: number } };
  expect(((await (await api("/portal")).json()) as State).state).toEqual({ stale: false, readAt: null, queued: 0 });
  portal.setState({ stale: true, readAt: "2026-11-13T18:00:00-0300", queued: 2 });
  const state = { stale: true, readAt: "2026-11-13T18:00:00-0300", queued: 2 };
  expect(((await (await api("/portal")).json()) as State).state).toEqual(state);
  const board = (await (await api("/portal/clients/acme")).json()) as State & { items: { approval: unknown[] } };
  expect(board.state).toEqual(state);
  expect(board.items.approval).toHaveLength(1);
});

test("the strategic schedule: lists the team names, cards with labels and members, and a stage that follows the portal", async () => {
  const portal = createFakeApprovalPortal();
  const { api, owner, upload } = await start(portal);
  const me = ((await (await owner("/api/app/me")).json()) as { user: { id: string } }).user.id;
  const list = async (name: string) =>
    ((await (await api("/portal/clients/acme/lists", { json: { name } })).json()) as { list: { id: string } }).list.id;
  const week1 = await list("Semana 16 a 20/11");
  const week2 = await list("Semana 23 a 27/11");
  // The same name, whatever its capitals, is the same list.
  expect(await list("semana 16 a 20/11")).toBe(week1);
  const label = (
    (await (await api("/portal/labels", { json: { name: "em edição", color: "olive" } })).json()) as {
      label: { id: string };
    }
  ).label.id;

  const made = await api("/portal/cards", {
    json: {
      client: "acme",
      title: "Tour video",
      type: "reel",
      list: week1,
      labels: [label],
      members: [me],
      produceOn: "2026-11-14",
      date: "2026-11-18T10:00",
      description: "Walk through the house",
      checklist: [{ id: "a", text: "Film", done: false }],
    },
  });
  expect(made.status).toBe(200);
  const card = ((await made.json()) as { card: { id: string } }).card.id;
  expect((await api("/portal/cards", { json: { client: "acme", title: "x", produceOn: "saturday" } })).status).toBe(
    400,
  );

  // Dragged to the other week, then the weeks swap places.
  expect((await api(`/portal/cards/${card}`, { method: "PATCH", json: { list: week2, order: 1 } })).status).toBe(200);
  const order = await api("/portal/clients/acme/lists/order", { method: "PUT", json: { ids: [week2, week1] } });
  expect(order.status).toBe(200);
  expect((await api(`/portal/lists/${week2}`, { method: "PATCH", json: { name: "Week two" } })).status).toBe(200);
  const commented = await api(`/portal/cards/${card}/comments`, { json: { text: "Edited: link" } });
  expect(commented.status).toBe(200);

  type Plan = {
    lists: {
      name: string;
      cards: { id: string; stage: string; postOn: string | null; comments: { by: string }[] }[];
    }[];
    loose: unknown[];
    labels: { name: string; color: string }[];
  };
  const plan = (await (await api("/portal/clients/acme/plan")).json()) as Plan;
  expect(plan.lists.map((l) => [l.name, l.cards.length])).toEqual([
    ["Week two", 1],
    ["Semana 16 a 20/11", 0],
  ]);
  expect(plan.lists[0]?.cards[0]).toMatchObject({ id: card, stage: "todo", postOn: "2026-11-18T10:00" });
  expect(plan.lists[0]?.cards[0]?.comments[0]?.by).toBe(me);
  expect(plan.labels).toEqual([expect.objectContaining({ name: "em edição", color: "olive" })]);

  // It is the caller's work, on its production day; the day it goes out is another thing.
  type Mine = { day: string; late: { id: string }[]; today: unknown[]; next: unknown[]; undated: unknown[] };
  const mine = (await (await api("/portal/mine")).json()) as Mine;
  expect([...mine.late, ...mine.today, ...mine.next].map((c) => (c as { id: string }).id)).toEqual([card]);

  // The client's materials (ADR 9001 §20): a list of them, a card moved in leaves the caller's work and the board.
  const shelf = await api("/portal/clients/acme/lists", { json: { name: "Acessos", kind: "materials" } });
  const shelfId = ((await shelf.json()) as { list: { id: string; kind: string } }).list;
  expect(shelfId.kind).toBe("materials");
  expect((await api(`/portal/cards/${card}`, { method: "PATCH", json: { list: shelfId.id, order: 1 } })).status).toBe(
    200,
  );
  const shelved = (await (await api("/portal/mine")).json()) as Mine;
  expect([...shelved.late, ...shelved.today, ...shelved.next, ...shelved.undated]).toEqual([]);
  const material = (await (await api("/portal/clients/acme/plan")).json()) as {
    lists: { id: string; kind: string; cards: { id: string; material: boolean }[] }[];
  };
  expect(material.lists.find((l) => l.id === shelfId.id)?.cards).toEqual([
    expect.objectContaining({ id: card, material: true }),
  ]);
  // A list changes part with a PATCH, and a PATCH with nothing in it is refused.
  const moved = await api(`/portal/lists/${shelfId.id}`, { method: "PATCH", json: { kind: "plan" } });
  expect(((await moved.json()) as { list: { kind: string } }).list.kind).toBe("plan");
  expect((await api(`/portal/lists/${shelfId.id}`, { method: "PATCH", json: {} })).status).toBe(400);
  expect((await api(`/portal/lists/${shelfId.id}`, { method: "DELETE" })).status).toBe(204);
  expect((await api(`/portal/cards/${card}`, { method: "PATCH", json: { list: week2, order: 1 } })).status).toBe(200);

  // Sent: the card stays in its week, its stage is now the portal's, and it is nobody's task while the client has it.
  const file = await upload("tour.mp4", "video/mp4", new Uint8Array([1]));
  const sent = await api("/portal/send", { json: { client: "acme", type: "reel", artifactIds: [file], card } });
  expect(sent.status).toBe(200);
  const after = (await (await api("/portal/clients/acme/plan")).json()) as Plan;
  expect(after.lists[0]?.cards[0]).toMatchObject({ id: card, stage: "approval" });
  expect(after.loose).toEqual([]);
  const board = (await (await api("/portal/clients/acme")).json()) as {
    cards: { todo: unknown[]; doing: unknown[] };
    items: { approval: unknown[] };
  };
  expect(board.cards.todo).toEqual([]);
  expect(board.items.approval).toHaveLength(1);
  const done = (await (await api("/portal/mine")).json()) as Mine;
  expect([...done.late, ...done.today, ...done.next, ...done.undated]).toEqual([]);

  // A deleted list leaves its cards, in no list; a deleted label leaves every card.
  expect((await api(`/portal/lists/${week2}`, { method: "DELETE" })).status).toBe(204);
  expect((await api(`/portal/labels/${label}`, { method: "DELETE" })).status).toBe(204);
  const last = (await (await api("/portal/clients/acme/plan")).json()) as Plan & {
    unlisted: { id: string; labels: string[] }[];
  };
  expect(last.unlisted).toEqual([expect.objectContaining({ id: card, labels: [] })]);
});

test("the pipeline: every open piece of work across clients, with who is on it and what is late", async () => {
  const portal = createFakeApprovalPortal({
    items: [
      item({ id: "up-1", status: "adjust_requested", lastNote: { at: null, by: "Client", text: "Shorter" } }),
      item({ id: "up-2", client: "zeta", status: "approved" }),
      item({ id: "up-3", status: "published" }),
    ],
  });
  const { api } = await start(portal);
  await portal.createCard("acme", { title: "Late reel", members: ["u1"], produceOn: "2020-01-01" });
  await portal.createCard("acme", { title: "Adjusting", members: ["u2"], item: "up-1", produceOn: "2020-01-01" });
  type Entry = { client: string; kind: string; title: string; stage: string; late: boolean; note: string | null };
  const { entries } = (await (await api("/portal/pipeline")).json()) as { entries: Entry[] };
  expect(entries.map((e) => [e.client, e.kind, e.title, e.stage, e.late, e.note])).toEqual([
    ["acme", "card", "Late reel", "todo", true, null],
    // The card stands for its post: one entry, the portal's stage, the client's words.
    ["acme", "card", "Adjusting", "adjusting", true, "Shorter"],
    ["zeta", "post", "Launch reel", "approved", false, null],
  ]);
});

test("a card is a task too: made with it, started by the agent put on it, canceled when it is deleted", async () => {
  const portal = createFakeApprovalPortal();
  const { api, agentId } = await start(portal);
  type Task = {
    id: string;
    number: number;
    title: string;
    status: string;
    assignee: { type: string; id: string } | null;
  };
  const made = await api("/portal/cards", { json: { client: "acme", title: "Launch reel", produceOn: "2026-11-20" } });
  expect(made.status).toBe(200);
  const { card } = (await made.json()) as { card: { id: string } };

  const { tasks } = (await (await api("/portal/tasks")).json()) as {
    tasks: { cardId: string; id: string; number: number }[];
  };
  expect(tasks).toMatchObject([{ cardId: card.id, number: 1 }]);
  const task = async () => (await (await api(`/issues/${tasks[0]?.id}`)).json()) as Task & { dueDate: string | null };
  expect(await task()).toMatchObject({ title: "Launch reel", status: "todo", dueDate: "2026-11-20", assignee: null });
  expect((await portal.cards())[0]?.task).toBe(tasks[0]?.id ?? "");

  // The agent first on the card has the task and starts on it: the work moves both to "in production".
  const put = await api(`/portal/cards/${card.id}`, { method: "PATCH", json: { members: [agentId] } });
  expect(put.status).toBe(200);
  expect(await task()).toMatchObject({ status: "in_progress", assignee: { type: "agent", id: agentId } });
  const runs = await t.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agentId));
  expect(runs).toHaveLength(1);

  expect((await api(`/portal/cards/${card.id}`, { method: "DELETE" })).status).toBe(204);
  expect((await task()).status).toBe("canceled");
});

test("the bridge's call is taken only with the portal's token, and puts cards and tasks in step at once", async () => {
  const portal = createFakeApprovalPortal();
  t = await createTestServer({
    approvalPortal: portal,
    env: {
      ALLOW_SIGNUP: "true",
      APPROVAL_PORTAL_URL: "http://bridge.example",
      APPROVAL_PORTAL_TOKEN: "bridge-secret-for-the-tests-0001",
    },
  });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  await portal.createCard("acme", { title: "Launch reel" });
  const call = (token?: string) =>
    t.app.request("/api/webhooks/approval-portal", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  expect((await call()).status).toBe(401);
  expect((await call("wrong")).status).toBe(401);
  expect((await call("bridge-secret-for-the-tests-0001")).status).toBe(202);
  for (let i = 0; i < 50 && !(await portal.cards())[0]?.task; i++) await Bun.sleep(20);
  const { tasks } = (await (await owner(`/api/app/organizations/${orgId}/portal/tasks`)).json()) as {
    tasks: { number: number }[];
  };
  expect(tasks).toHaveLength(1);
});

test("without a portal the bridge's address isn't there", async () => {
  t = await createTestServer({ approvalPortal: null });
  const res = await t.app.request("/api/webhooks/approval-portal", {
    method: "POST",
    headers: { authorization: "Bearer anything" },
  });
  expect(res.status).toBe(404);
});

test("a client's colour: who gives agents work picks one, the overview says it, null takes it away", async () => {
  const portal = createFakeApprovalPortal();
  const { api } = await start(portal);
  expect((await api("/portal/cards", { json: { client: "acme", title: "Tour video" } })).status).toBe(200);
  type Overview = { clients: { client: string; color: string | null }[] };
  const colorOf = async () =>
    ((await (await api("/portal")).json()) as Overview).clients.find((c) => c.client === "acme")?.color;
  expect(await colorOf()).toBeNull();
  expect((await api("/portal/clients/acme/color", { method: "PUT", json: { color: "navy" } })).status).toBe(204);
  expect(await colorOf()).toBe("navy");
  // Only the colours the apps draw.
  expect((await api("/portal/clients/acme/color", { method: "PUT", json: { color: "#123456" } })).status).toBe(400);
  expect((await api("/portal/clients/acme/color", { method: "PUT", json: { color: null } })).status).toBe(204);
  expect(await colorOf()).toBeNull();
});

test("a client's logo: stored here, named at the portal, served to members, and gone when removed", async () => {
  const portal = createFakeApprovalPortal();
  const { api, owner, orgId } = await start(portal);
  expect((await api("/portal/cards", { json: { client: "acme", title: "Tour video" } })).status).toBe(200);
  type Overview = { clients: { client: string; logo: string | null }[] };
  const logoOf = async () =>
    ((await (await api("/portal")).json()) as Overview).clients.find((c) => c.client === "acme")?.logo;
  expect(await logoOf()).toBeNull();

  // A 1×1 PNG.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const set = await api("/portal/clients/acme/logo", {
    method: "PUT",
    json: { imageBase64: png, contentType: "image/png" },
  });
  expect(set.status).toBe(200);
  const { logo } = (await set.json()) as { logo: string };
  expect(logo).toMatch(new RegExp(`^/api/app/portal-logos/${orgId}/acme/[0-9a-f]{16}\\.png$`));
  expect(await logoOf()).toBe(logo);
  // The portal's side keeps the file's name alone.
  expect(Object.values((await portal.clientLooks()).logos)).toEqual([logo.split("/").at(-1) as string]);
  const file = await owner(logo);
  expect(file.status).toBe(200);
  expect(file.headers.get("content-type")).toBe("image/png");

  // Not an image: refused before anything is kept.
  const bad = await api("/portal/clients/acme/logo", {
    method: "PUT",
    json: { imageBase64: "aGVsbG8=", contentType: "image/png" },
  });
  expect(bad.status).toBe(400);

  expect((await api("/portal/clients/acme/logo", { method: "DELETE" })).status).toBe(204);
  expect(await logoOf()).toBeNull();
  expect((await owner(logo)).status).toBe(404);
});

test("a client's name and hiding are the team's: kept here, audited, out of every list until shown", async () => {
  const portal = createFakeApprovalPortal({
    items: [
      item({ client: "teste-ajustes", id: "up-1", status: "approved" }),
      item({ client: "acme", id: "up-2", status: "approved" }),
    ],
  });
  const { api, owner, orgId } = await start(portal);
  expect((await api("/portal/cards", { json: { client: "teste-ajustes", title: "Old test" } })).status).toBe(200);
  type Overview = {
    clients: { client: string; name: string | null }[];
    hidden: { client: string; name: string | null }[];
  };
  const overview = async () => (await (await api("/portal")).json()) as Overview;
  expect((await overview()).clients.map((c) => c.name)).toEqual([null, null]);

  // A name, tidied; empty goes back to the slug's; too long is refused.
  const named = await api("/portal/clients/acme/name", { method: "PUT", json: { name: "  ACME   Corp " } });
  expect(await named.json()).toEqual({ name: "ACME Corp" });
  expect((await overview()).clients.find((c) => c.client === "acme")?.name).toBe("ACME Corp");
  expect((await api("/portal/clients/acme/name", { method: "PUT", json: { name: "x".repeat(61) } })).status).toBe(400);

  // Hidden: out of the overview, the pipeline, what waits to be scheduled and each one's work.
  expect((await api("/portal/clients/teste-ajustes/hidden", { method: "PUT", json: { hidden: true } })).status).toBe(
    204,
  );
  const hiddenNow = await overview();
  expect(hiddenNow.clients.map((c) => c.client)).toEqual(["acme"]);
  expect(hiddenNow.hidden).toEqual([{ client: "teste-ajustes", name: null }]);
  const pipeline = (await (await api("/portal/pipeline")).json()) as { entries: { client: string }[] };
  expect(pipeline.entries.every((e) => e.client === "acme")).toBe(true);
  const toSchedule = (await (await api("/portal/to-schedule")).json()) as { items: { client: string }[] };
  expect(toSchedule.items.map((i) => i.client)).toEqual(["acme"]);
  // Nothing changed at the portal.
  expect((await portal.cards("teste-ajustes")).length).toBe(1);

  // Shown again, everything comes back.
  expect((await api("/portal/clients/teste-ajustes/hidden", { method: "PUT", json: { hidden: false } })).status).toBe(
    204,
  );
  expect((await overview()).clients.map((c) => c.client).sort()).toEqual(["acme", "teste-ajustes"]);

  const audit = (await (await api("/audit?kind=change")).json()) as { rows: { action: string }[] };
  const actions = audit.rows.map((r) => r.action);
  expect(actions).toContain("portal.client_renamed");
  expect(actions).toContain("portal.client_hidden");
  expect(actions).toContain("portal.client_shown");

  // Another workspace's person can't touch it.
  const other = browser(t);
  await signUp(other, "stranger@example.com");
  const stranger = await other(`/api/app/organizations/${orgId}/portal/clients/acme/name`, {
    method: "PUT",
    json: { name: "Mine" },
  });
  expect([403, 404]).toContain(stranger.status);
  expect(owner).toBeDefined();
});

test("the portal is one workspace's: another on the same server doesn't see it, nor its clients", async () => {
  const portal = createFakeApprovalPortal({ items: [item({ id: "up-1" })] });
  const { api, owner, orgId } = await start(portal);
  // A card makes its task here, which settles whose the portal is.
  expect((await api("/portal/cards", { json: { client: "acme", title: "Story" } })).status).toBe(200);
  // Another business on the same server, with its own workspace.
  const other = browser(t);
  await signUp(other, "consig@example.com");
  const { orgId: otherId } = await seedOrg(other);
  expect(otherId).not.toBe(orgId);
  const res = await other(`/api/app/organizations/${otherId}/portal`);
  expect(res.status).toBe(404);
  expect(await code(res)).toBe("portal.off");
  expect((await other(`/api/app/organizations/${otherId}/portal/clients/acme`)).status).toBe(404);
  expect((await other(`/api/app/organizations/${otherId}/portal/tasks`)).status).toBe(404);
  expect((await api("/portal")).status).toBe(200);
  const portalOf = async (b: Browser, id: string) =>
    (
      (await (await b("/api/app/me")).json()) as { organizations: { id: string; portal?: boolean }[] }
    ).organizations.find((o) => o.id === id)?.portal;
  expect(await portalOf(owner, orgId)).toBe(true);
  expect(await portalOf(other, otherId)).toBe(false);
});

test("an admin takes tools out of the workspace's sidebar: settings and /me say which", async () => {
  const { owner, orgId, base } = await start(null);
  const patched = await owner(`${base}/settings`, {
    method: "PATCH",
    json: { hiddenTools: ["portal", "whatsapp", "wiki"] },
  });
  expect(patched.status).toBe(200);
  expect(((await patched.json()) as { hiddenTools: string[] }).hiddenTools).toEqual(["portal", "wiki", "whatsapp"]);
  const me = (await (await owner("/api/app/me")).json()) as {
    organizations: { id: string; hiddenTools?: string[] }[];
  };
  expect(me.organizations.find((o) => o.id === orgId)?.hiddenTools).toEqual(["portal", "wiki", "whatsapp"]);
  expect((await owner(`${base}/settings`, { method: "PATCH", json: { hiddenTools: ["nope"] } })).status).toBe(400);
  const back = await owner(`${base}/settings`, { method: "PATCH", json: { hiddenTools: [] } });
  expect(((await back.json()) as { hiddenTools: string[] }).hiddenTools).toEqual([]);
});
