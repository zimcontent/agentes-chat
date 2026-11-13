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
  // The card it finished is gone, and the post is on the board, waiting for the client.
  expect(await portal.cards()).toEqual([]);
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
