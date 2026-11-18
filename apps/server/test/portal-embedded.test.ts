import { afterEach, expect, test } from "bun:test";
import { type Browser, browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

// The approval portal kept in this server's own database (docs/adr/doug-0020-embedded-approval-portal.md): the team
// makes its clients and their links in Settings, and a client opens its own page with no account.

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  await current?.close();
});

async function start() {
  // The portal is this server's own: it reads and writes this database, as `start.ts` makes it with no bridge.
  t = await createTestServer({ approvalPortalEmbedded: true, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const base = `/api/app/organizations/${orgId}`;
  return { owner, orgId, base, api: (path: string, init?: Parameters<Browser>[1]) => owner(`${base}${path}`, init) };
}

const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

test("the team makes a client with a contact, gets a link, and changes the client", async () => {
  const { api } = await start();
  const made = await api("/portal-clients/padaria-aurora", {
    method: "PUT",
    json: { name: "Padaria Aurora", contacts: [{ name: "Ana", email: "ana@example.com" }], color: "teal" },
  });
  expect(made.status).toBe(200);
  const { client } = (await made.json()) as {
    client: { client: string; name: string; link: string | null; color: string | null; contacts: { email: string }[] };
  };
  expect(client.name).toBe("Padaria Aurora");
  expect(client.color).toBe("teal");
  expect(client.contacts[0]?.email).toBe("ana@example.com");
  expect(client.link).toMatch(/\/portal\/[A-Za-z0-9_-]{20,64}$/);

  const list = (await (await api("/portal-clients")).json()) as { clients: { client: string; link: string | null }[] };
  expect(list.clients.map((c) => c.client)).toEqual(["padaria-aurora"]);
  expect(list.clients[0]?.link).toBe(client.link);
});

test("a new link revokes the old address; a revoked link answers 404 on its page", async () => {
  const { api, owner } = await start();
  const { client } = (await (
    await api("/portal-clients/padaria-aurora", { method: "PUT", json: { name: "Padaria Aurora" } })
  ).json()) as { client: { link: string } };
  const oldToken = client.link.split("/").at(-1) as string;

  const remadeRes = await api("/portal-clients/padaria-aurora/link", { method: "POST", json: {} });
  expect(remadeRes.status).toBe(200);
  const remade = (await remadeRes.json()) as { link: string };
  const newToken = remade.link.split("/").at(-1) as string;
  expect(newToken).not.toBe(oldToken);
  // The client's own page: the old address opens nothing, the new one opens it.
  expect((await t.app.request(`/portal/api/${oldToken}`)).status).toBe(404);
  const page = await t.app.request(`/portal/api/${newToken}`);
  expect(page.status).toBe(200);
  expect((await page.json()) as { client: { name: string } }).toMatchObject({ client: { name: "Padaria Aurora" } });

  // Revoked: both answer nothing.
  expect((await api("/portal-clients/padaria-aurora/link", { method: "DELETE" })).status).toBe(204);
  expect((await t.app.request(`/portal/api/${newToken}`)).status).toBe(404);
  void owner;
});

test("a client approves through its own page; the workspace's people are told", async () => {
  const { api } = await start();
  const { client } = (await (
    await api("/portal-clients/padaria-aurora", { method: "PUT", json: { name: "Padaria Aurora" } })
  ).json()) as { client: { link: string } };
  const token = client.link.split("/").at(-1) as string;

  // A post goes up through the same portal the agents' tools use.
  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  const upload = await portal.upload("reel.mp4", new Uint8Array([1, 2, 3]));
  const job = await portal.send({
    client: "padaria-aurora",
    type: "reel",
    files: [upload],
    title: "Reel de dezembro",
    caption: "Nosso menu",
  });

  const page = (await (await t.app.request(`/portal/api/${token}`)).json()) as {
    waiting: { id: string; title: string; video: boolean }[];
  };
  expect(page.waiting.map((p) => p.title)).toEqual(["Reel de dezembro"]);
  expect(page.waiting[0]?.video).toBe(true);

  const decided = await t.app.request(`/portal/api/${token}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postId: job.item, decision: "approve" }),
  });
  expect(decided.status).toBe(200);
  expect((await portal.items()).find((i) => i.id === job.item)?.status).toBe("approved");

  // A second decision is refused.
  const again = await t.app.request(`/portal/api/${token}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postId: job.item, decision: "approve" }),
  });
  expect(again.status).toBe(409);
});

test("a client's file is read only through its own link", async () => {
  const { api } = await start();
  const aurora = (await (
    await api("/portal-clients/padaria-aurora", { method: "PUT", json: { name: "Padaria Aurora" } })
  ).json()) as { client: { link: string } };
  const sol = (await (await api("/portal-clients/cafe-sol", { method: "PUT", json: { name: "Cafe Sol" } })).json()) as {
    client: { link: string };
  };
  const auroraToken = aurora.client.link.split("/").at(-1) as string;
  const solToken = sol.client.link.split("/").at(-1) as string;

  const portal = t.adapters.approvalPortal as NonNullable<typeof t.adapters.approvalPortal>;
  const upload = await portal.upload("post.png", new Uint8Array([7, 7, 7]));
  await portal.send({ client: "padaria-aurora", type: "image", files: [upload], title: "Foto", caption: "x" });
  const page = (await (await t.app.request(`/portal/api/${auroraToken}`)).json()) as {
    waiting: { media: { id: string }[] }[];
  };
  const fileId = page.waiting[0]?.media[0]?.id as string;

  expect((await t.app.request(`/portal/api/${auroraToken}/files/${fileId}`)).status).toBe(200);
  // The other client's link doesn't reach it, nor a made-up token.
  expect((await t.app.request(`/portal/api/${solToken}/files/${fileId}`)).status).toBe(404);
  expect((await t.app.request(`/portal/api/not-a-real-token-at-all-0000/files/${fileId}`)).status).toBe(404);
});

test("on a server with a bridge (not the embedded portal) the client routes answer portal.off", async () => {
  // No embedded flag: the routes are the bridge's, and these ones aren't mounted.
  t = await createTestServer({ approvalPortal: null, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const res = await owner(`/api/app/organizations/${orgId}/portal-clients`);
  expect(res.status).toBe(404);
  expect(await code(res)).toBe("portal.off");
});
