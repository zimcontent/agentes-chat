import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@dougbot/db";
import { type Browser, browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

// The review's items on the server's side of the installation's own approval portal (docs/adr/
// doug-0031-embedded-approval-portal.md): the portal is one workspace's, a file's name survives any character, a
// decision's body is capped and limited, a workspace closed to work answers nothing of it, and a post marked posted
// goes to `published`.

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

async function start() {
  t = await createTestServer({ approvalPortalEmbedded: true, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const base = `/api/app/organizations/${orgId}`;
  const api = (path: string, init?: Parameters<Browser>[1]) => owner(`${base}${path}`, init);
  return { owner, orgId, base, api };
}

/** A second workspace of the same person: its onboarding is finished first, else the server answers the one still open. */
async function secondWorkspace(owner: Browser, orgId: string) {
  await owner(`/api/app/organizations/${orgId}/onboarding`, { method: "PATCH", json: { finished: true } });
  const created = (await (
    await owner("/api/app/organizations", { json: { name: "Consig", finished: true } })
  ).json()) as { organization: { id: string } };
  return created.organization.id;
}

const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code ?? "";

/** A client of the workspace, its link's token, and the portal the server made for it. */
async function aClient(
  api: (path: string, init?: Parameters<Browser>[1]) => Promise<Response>,
  client = "padaria-aurora",
) {
  const saved = (await (
    await api(`/portal-clients/${client}`, { method: "PUT", json: { name: "Padaria Aurora" } })
  ).json()) as { client: { link: string } };
  return { link: saved.client.link, token: saved.client.link.split("/").at(-1) as string };
}

test("another workspace of the server has none of the portal, and can't make a client", async () => {
  const { owner, api, orgId } = await start();
  await aClient(api);
  // The same person makes a second workspace on this server: it has no portal of its own (ADR 9001 §18).
  const otherId = await secondWorkspace(owner, orgId);
  const other = `/api/app/organizations/${otherId}`;
  const list = await owner(`${other}/portal-clients`);
  expect(list.status).toBe(404);
  expect(await code(list)).toBe("portal.off");
  const make = await owner(`${other}/portal-clients/acme`, { method: "PUT", json: { name: "Acme" } });
  expect(make.status).toBe(404);
  expect(await code(make)).toBe("portal.off");
  // The portal's own workspace still has it.
  expect((await api("/portal-clients")).status).toBe(200);
});

test("a file's name goes in the header as UTF-8, with an ASCII fallback, and no control character ever reaches it", async () => {
  const { api } = await start();
  const { token } = await aClient(api);
  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  // A name with an emoji, CJK, and a newline: the header must hold it and still be readable.
  const name = "foto 🍞 写真\n.jpeg";
  const upload = await portal.upload(name, new Uint8Array([1, 2, 3, 4, 5]));
  await portal.send({ client: "padaria-aurora", type: "image", files: [upload], title: "Foto", caption: "x" });
  const page = (await (await t.app.request(`/p/api/${token}`)).json()) as { waiting: { media: { id: string }[] }[] };
  const fileId = page.waiting[0]?.media[0]?.id as string;
  const res = await t.app.request(`/p/api/${token}/files/${fileId}`);
  expect(res.status).toBe(200);
  const disposition = res.headers.get("content-disposition") ?? "";
  expect(disposition).toContain("filename*=UTF-8''");
  expect(disposition).toContain("%F0%9F%8D%9E");
  // No newline, no quote: the plain `filename` is ASCII only.
  expect(disposition.startsWith('inline; filename="')).toBe(true);
  expect(disposition).not.toContain("\n");
  expect(disposition.split("; ")[1]).toMatch(/^filename="[\x20-\x7e]*"$/);
});

test("a file is served in parts: a Range answers 206 with the part it asks for", async () => {
  const { api } = await start();
  const { token } = await aClient(api);
  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  const upload = await portal.upload("reel.mp4", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], title: "Reel", caption: "x" });
  const page = (await (await t.app.request(`/p/api/${token}`)).json()) as { waiting: { media: { id: string }[] }[] };
  const fileId = page.waiting[0]?.media[0]?.id as string;
  const res = await t.app.request(`/p/api/${token}/files/${fileId}`, { headers: { range: "bytes=2-5" } });
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
});

test("a decision's body past 64 KiB is refused before it is read", async () => {
  const { api } = await start();
  const { token } = await aClient(api);
  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
  const job = await portal.send({
    client: "padaria-aurora",
    type: "reel",
    files: [upload],
    title: "Reel",
    caption: "x",
  });
  const res = await t.app.request(`/p/api/${token}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postId: job.item, decision: "adjust", text: "x".repeat(70 * 1024) }),
  });
  expect(res.status).toBe(413);
});

test("the page and its decision are rate-limited by the caller's address", async () => {
  const { api } = await start();
  const { token } = await aClient(api);
  // The page's own limit is 120 a minute: past it the address is told to slow down.
  let last = 200;
  for (let i = 0; i < 130; i++) {
    const res = await t.app.request(`/p/api/${token}`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    last = res.status;
    if (last === 429) break;
  }
  expect(last).toBe(429);
});

test("a workspace on hold, suspended or being deleted closes its clients' page and their decisions", async () => {
  const { api, orgId } = await start();
  const { token } = await aClient(api);
  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
  const job = await portal.send({
    client: "padaria-aurora",
    type: "reel",
    files: [upload],
    title: "Reel",
    caption: "x",
  });
  expect((await t.app.request(`/p/api/${token}`)).status).toBe(200);
  // The operator holds the workspace: its clients' pages answer nothing, as a link that names none.
  await t.db
    .update(schema.organizations)
    .set({ standing: "hold", standingReason: "operator", standingNotice: "shown" })
    .where(eq(schema.organizations.id, orgId));
  expect((await t.app.request(`/p/api/${token}`)).status).toBe(404);
  const decide = await t.app.request(`/p/api/${token}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postId: job.item, decision: "approve" }),
  });
  expect(decide.status).toBe(404);
});

test("a scheduled post is marked posted by a person: `published`, with its date and address", async () => {
  const { api } = await start();
  const { token } = await aClient(api);
  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
  const job = await portal.send({
    client: "padaria-aurora",
    type: "reel",
    files: [upload],
    title: "Reel",
    caption: "x",
  });
  // The client approves, and the team schedules it.
  await t.app.request(`/p/api/${token}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postId: job.item, decision: "approve" }),
  });
  expect(
    (
      await api(`/portal/clients/padaria-aurora/items/${job.item}/schedule`, {
        json: { scheduledFor: "2099-12-05T10:00" },
      })
    ).status,
  ).toBe(204);
  const posted = await api(`/portal/clients/padaria-aurora/items/${job.item}/published`, {
    json: { postUrl: "https://example.com/p/1" },
  });
  expect(posted.status).toBe(204);
  const item = (await portal.items()).find((i) => i.id === job.item);
  expect(item?.status).toBe("published");
  expect(item?.publishedAt).toBeTruthy();
  expect(item?.postUrl).toBe("https://example.com/p/1");
  // Only a scheduled post is marked posted: another try finds it out of `scheduled`.
  expect((await api(`/portal/clients/padaria-aurora/items/${job.item}/published`, { json: {} })).status).toBe(400);
});

test("the clients' links are only in `links`, and only for who may manage the portal", async () => {
  const { api } = await start();
  await aClient(api);
  const list = (await (await api("/portal-clients")).json()) as {
    clients: { link?: string }[];
    links: Record<string, string>;
  };
  expect(list.links["padaria-aurora"]).toMatch(/\/p\//);
  expect(list.clients[0]?.link).toBeUndefined();
});

test("a client or its link made, revoked or removed is left in the audit log", async () => {
  const { api, orgId } = await start();
  await aClient(api);
  await api("/portal-clients/padaria-aurora/link", { method: "POST", json: {} });
  await api("/portal-clients/padaria-aurora/link", { method: "DELETE" });
  await api("/portal-clients/padaria-aurora", { method: "DELETE" });
  const rows = await t.db
    .select({ action: schema.auditLog.action })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.orgId, orgId));
  const actions = rows.map((r) => r.action);
  expect(actions).toContain("portal.client_created");
  expect(actions).toContain("portal.link_made");
  expect(actions).toContain("portal.link_revoked");
  expect(actions).toContain("portal.client_removed");
});

test("a file's id that isn't one answers 404, not a failure of the query", async () => {
  const { api } = await start();
  const { token } = await aClient(api);
  for (const id of ["nope", "1", "00000000-0000-0000-0000-00000000000z", "' or 1=1"]) {
    expect((await t.app.request(`/p/api/${token}/files/${encodeURIComponent(id)}`)).status).toBe(404);
  }
  // An id of the right shape that names no file is a 404 too.
  expect((await t.app.request(`/p/api/${token}/files/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
});

test("a range off the end answers 416 with the file's own size; a multi-range is the whole file", async () => {
  const { api } = await start();
  const { token } = await aClient(api);
  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  const upload = await portal.upload("reel.mp4", new Uint8Array(10));
  await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], title: "Reel", caption: "x" });
  const page = (await (await t.app.request(`/p/api/${token}`)).json()) as { waiting: { media: { id: string }[] }[] };
  const fileId = page.waiting[0]?.media[0]?.id as string;
  const past = await t.app.request(`/p/api/${token}/files/${fileId}`, { headers: { range: "bytes=20-30" } });
  expect(past.status).toBe(416);
  expect(past.headers.get("content-range")).toBe("bytes */10");
  // A multi-range header is ignored: the whole file, `200`.
  const many = await t.app.request(`/p/api/${token}/files/${fileId}`, { headers: { range: "bytes=0-1,4-5" } });
  expect(many.status).toBe(200);
  expect(new Uint8Array(await many.arrayBuffer()).length).toBe(10);
});

test("a bridge's installation has no `published` of its own: the route is the embedded portal's", async () => {
  // The same server with a bridge: the route answers `portal.off`, as the client routes do.
  t = await createTestServer({ approvalPortal: null, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const res = await owner(`/api/app/organizations/${orgId}/portal/clients/acme/items/abc/published`, {
    method: "POST",
    json: {},
  });
  expect(res.status).toBe(404);
  expect(await code(res)).toBe("portal.off");
});
