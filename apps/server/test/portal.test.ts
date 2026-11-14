import { afterEach, expect, test } from "bun:test";
import { createFakeApprovalPortal, type PortalItem } from "@agenteschat/adapters";
import { type Browser, browser, createTestServer, ORIGIN, seedOrg, signUp, type TestServer } from "./harness";

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
  const { orgId } = await seedOrg(owner);
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
  return { owner, orgId, base, api, upload };
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
    clients: { client: string; counts: Record<string, number>; open: number; next: string | null }[];
  };
  // The client with open work first; what is posted isn't open.
  expect(overview.clients.map((c) => c.client)).toEqual(["acme", "zeta"]);
  expect(overview.clients[0]).toEqual({
    client: "acme",
    counts: { todo: 1, doing: 0, approval: 2, adjusting: 1, approved: 1, scheduled: 1, posted: 1 },
    open: 6,
    next: "2026-12-01T10:00:00-03:00",
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
  const board = (await (await api("/portal/clients/acme")).json()) as { items: { approval: { id: string }[] } };
  expect(board.items.approval.map((i) => i.id)).toEqual([job.item]);
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
    json: { caption: "New caption", scheduledFor: "2026-12-03T09:00:00-03:00" },
  });
  expect(edited.status).toBe(204);
  expect(portal.edits[0]).toMatchObject({ client: "acme", item: "up-9", edit: { caption: "New caption" } });

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
