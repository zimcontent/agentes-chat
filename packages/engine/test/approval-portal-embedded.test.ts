import { afterEach, beforeEach, expect, test } from "bun:test";
import { createFakeEmailSender, createMemoryBlobStore } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import {
  announcePortalPost,
  clientDecision,
  clientPortalFile,
  clientPortalPage,
  createEmbeddedApprovalPortal,
  listPortalClients,
  makeClientLink,
  PORTAL_NOTIFY_JOB,
  portalClientOfToken,
  revokeClientLink,
  upsertPortalClient,
} from "../src";
import { setup } from "./fixtures";

// The approval portal kept in this server's own database (docs/adr/doug-0022-embedded-approval-portal.md): the same
// contract as the bridge (ADR 9001), the clients and their links, the client's page and its decision. On PGlite, with
// a memory file store and no network.

const PUBLIC_URL = "https://acme.example";
const SECRET = "test-secret-".padEnd(48, "x");

let f: Awaited<ReturnType<typeof setup>>;
let blobs: ReturnType<typeof createMemoryBlobStore>;
let portal: ReturnType<typeof createEmbeddedApprovalPortal>;
const email = createFakeEmailSender();

beforeEach(async () => {
  f = await setup();
  blobs = createMemoryBlobStore();
  portal = createEmbeddedApprovalPortal({ db: f.db, blobs, publicUrl: PUBLIC_URL, secret: SECRET });
});
afterEach(async () => {
  await f?.close();
});

async function makeClient(overrides: { client?: string; name?: string; contacts?: unknown[] } = {}) {
  return upsertPortalClient(
    { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
    f.org.id,
    {
      name: overrides.name ?? "Padaria Aurora",
      client: overrides.client ?? "padaria-aurora",
      contacts: overrides.contacts ?? [],
    },
    f.owner.id,
  );
}

test("a client gets a link, editable contacts and a colour; a new link revokes the one before", async () => {
  const made = await makeClient({
    contacts: [{ name: "Ana", email: "ana@example.com", whatsapp: "+55 11 99999-0000" }],
  });
  expect(made.client).toBe("padaria-aurora");
  expect(made.link).toMatch(/^https:\/\/acme\.example\/p\/[A-Za-z0-9_-]{20,64}$/);
  // The digits only, the country code first.
  expect(made.contacts[0]?.whatsapp).toBe("5511999990000");
  const first = made.link as string;

  const again = await upsertPortalClient(
    { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
    f.org.id,
    { client: "padaria-aurora", name: "Padaria Aurora", color: "navy" },
    f.owner.id,
  );
  expect(again.link).toBe(first);
  expect(again.color).toBe("navy");

  // A new link: the old address opens nothing.
  const remade = await makeClientLink(
    { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
    f.org.id,
    made.id,
    f.owner.id,
  );
  expect(remade).not.toBe(first);
  const oldToken = first.split("/").at(-1) as string;
  expect(await portalClientOfToken(f.db, oldToken, SECRET)).toBeNull();
  const newToken = remade.split("/").at(-1) as string;
  expect((await portalClientOfToken(f.db, newToken, SECRET))?.client).toBe("padaria-aurora");

  // Revoked: it opens nothing either.
  await revokeClientLink({ db: f.db }, f.org.id, "padaria-aurora");
  expect(await portalClientOfToken(f.db, newToken, SECRET)).toBeNull();
});

test("a contact needs a name and an address or a number", async () => {
  await expect(
    upsertPortalClient(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
      f.org.id,
      { name: "Cafe", client: "cafe", contacts: [{ name: "" }] },
      f.owner.id,
    ),
  ).rejects.toThrow();
  await expect(
    upsertPortalClient(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
      f.org.id,
      { name: "Cafe", client: "cafe", contacts: [{ name: "Bea" }] },
      f.owner.id,
    ),
  ).rejects.toThrow();
  await expect(
    upsertPortalClient(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
      f.org.id,
      { name: "Cafe", client: "cafe", contacts: [{ name: "Bea", whatsapp: "123" }] },
      f.owner.id,
    ),
  ).rejects.toThrow();
});

test("the portal's contract: a send becomes a post, a card is tied to it, the client sees it, and approves", async () => {
  const client = await makeClient({ contacts: [{ name: "Ana", email: "ana@example.com" }] });
  const token = (client.link as string).split("/").at(-1) as string;

  // A card and a send, as `sendForApproval` drives it.
  const card = await portal.createCard("padaria-aurora", { title: "Reel de dezembro" });
  const upload = await portal.upload("reel.mp4", new Uint8Array([1, 2, 3, 4]));
  const job = await portal.send({
    client: "padaria-aurora",
    type: "reel",
    files: [upload],
    caption: "Nosso menu de dezembro",
    card: card.id,
  });
  expect(job.state).toBe("done");
  expect(job.item).toBeTruthy();
  expect(job.missing).toEqual(["cover", "editor", "date"]);

  // The card stayed, tied to the post.
  expect((await portal.cards("padaria-aurora")).find((c) => c.id === card.id)?.item).toBe(job.item);

  // The client's page shows the video and the caption, and marks it seen.
  const mine = await portalClientOfToken(f.db, token, SECRET);
  if (!mine) throw new Error("the client's link names none");
  const before = await clientPortalPage(f.db, mine, false);
  expect(before.waiting).toHaveLength(1);
  expect(before.waiting[0]).toMatchObject({
    title: "Reel de dezembro",
    video: true,
    caption: "Nosso menu de dezembro",
  });
  expect(before.waiting[0]?.media).toHaveLength(1);
  const seen = await clientPortalPage(f.db, mine, true);
  expect(seen.waiting[0]?.status).toBe("seen");

  // The decision turns the post approved, and the workspace's watch reads it.
  const result = await clientDecision(
    { db: f.db },
    { orgId: f.org.id, client: "padaria-aurora" },
    {
      postId: job.item as string,
      decision: "approve",
    },
  );
  expect(result.status).toBe("approved");
  expect((await portal.items()).find((i) => i.id === job.item)?.status).toBe("approved");

  // A second decision on the same post is refused.
  await expect(
    clientDecision(
      { db: f.db },
      { orgId: f.org.id, client: "padaria-aurora" },
      {
        postId: job.item as string,
        decision: "approve",
      },
    ),
  ).rejects.toThrow();
});

test("a change asked keeps the note, the second of the video and the slide, and only a sent-back post takes a version", async () => {
  await makeClient();
  const upload = await portal.upload("reel.mp4", new Uint8Array([1, 2, 3]));
  const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Cap" });

  await clientDecision(
    { db: f.db },
    { orgId: f.org.id, client: "padaria-aurora" },
    {
      postId: job.item as string,
      decision: "adjust",
      text: "Troca a segunda cena",
      atSeconds: 4.2,
      page: 2,
    },
  );
  const item = (await portal.items()).find((i) => i.id === job.item);
  expect(item?.status).toBe("adjust_requested");
  expect(item?.lastNote?.text).toBe("Troca a segunda cena");
  expect(item?.clientNotes?.at(-1)).toMatchObject({ atSeconds: 4.2, page: 2 });

  // A new version goes up, and the client sees V2.
  const v2 = await portal.upload("reel-v2.mp4", new Uint8Array([5, 6, 7]));
  const version = await portal.newVersion("padaria-aurora", job.item as string, { files: [v2], note: "Refeito" });
  expect(version.state).toBe("done");
  expect((await portal.items()).find((i) => i.id === job.item)?.status).toBe("adjusted");
  // A post no longer waiting on the client takes no new version.
  await expect(
    portal.newVersion("padaria-aurora", job.item as string, {
      files: [await portal.upload("x.mp4", new Uint8Array([9]))],
    }),
  ).rejects.toThrow();
});

test("a client's file is read only through its own link, and nothing of another client's", async () => {
  const aurora = await makeClient();
  const sol = await makeClient({ client: "cafe-sol", name: "Cafe Sol" });
  const auroraToken = (aurora.link as string).split("/").at(-1) as string;
  const solToken = (sol.link as string).split("/").at(-1) as string;

  const upload = await portal.upload("post.png", new Uint8Array([7, 7, 7]));
  const job = await portal.send({ client: "padaria-aurora", type: "image", files: [upload], caption: "Foto" });
  const auroraClient = await portalClientOfToken(f.db, auroraToken, SECRET);
  if (!auroraClient) throw new Error("the client's link names none");
  const page = await clientPortalPage(f.db, auroraClient, false);
  const fileId = page.waiting[0]?.media[0]?.id as string;

  const auroraRead = await clientPortalFile({ db: f.db, blobs }, { orgId: f.org.id, client: "padaria-aurora" }, fileId);
  expect(auroraRead?.contentType).toStartWith("image/");
  // The other client's link doesn't reach it.
  const solRead = await clientPortalFile({ db: f.db, blobs }, { orgId: f.org.id, client: "cafe-sol" }, fileId);
  expect(solRead).toBeNull();
  expect(solToken).not.toBe(auroraToken);
  void job;
});

test("the board's lists, labels and colours are kept in this server", async () => {
  await makeClient();
  const week = await portal.createList("padaria-aurora", "Semana 1");
  expect(week.kind).toBe("plan");
  await portal.createList("padaria-aurora", "Logins");
  const second = (await portal.lists("padaria-aurora"))[1];
  if (!second) throw new Error("the second list is missing");
  await portal.setListKind(second.id, "materials");
  const lists = await portal.lists("padaria-aurora");
  expect(lists.map((l) => l.name)).toEqual(["Semana 1", "Logins"]);
  expect(lists[1]?.kind).toBe("materials");

  const label = await portal.createLabel("Urgente", "wine");
  await portal.setClientColor("padaria-aurora", "teal");
  expect((await portal.clientLooks()).colors["padaria-aurora"]).toBe("teal");
  const card = await portal.createCard("padaria-aurora", { title: "Post", labels: [label.id] });
  expect(card.labels).toEqual([label.id]);
  await portal.deleteLabel(label.id);
  expect((await portal.cards("padaria-aurora")).find((c) => c.id === card.id)?.labels).toEqual([]);
});

test("the clients a workspace lists come with their links; another workspace sees none", async () => {
  await makeClient();
  const listed = await listPortalClients({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET }, f.org.id);
  expect(listed).toHaveLength(1);
  expect(listed[0]?.link).toMatch(/\/p\//);
  // Another workspace has no clients: the portal is one workspace's (ADR 9001 §18).
  const other = await listPortalClients(
    { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
    "00000000-0000-0000-0000-000000000000",
  );
  expect(other).toEqual([]);
});

test("a send queues the client's notice; the email kind is the client's own, and a second send of the same version tells once", async () => {
  await makeClient({ contacts: [{ name: "Ana", email: "ana@example.com" }] });
  const upload = await portal.upload("reel.mp4", new Uint8Array([1, 2, 3]));
  const job = await portal.send({
    client: "padaria-aurora",
    type: "reel",
    files: [upload],
    title: "Reel",
    caption: "Cap",
  });

  // The send queued the notice job (dedupe key = post + version).
  const notified = await f.db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, PORTAL_NOTIFY_JOB)));
  expect(notified.map((j) => j.dedupeKey)).toContain(`portal.notify:${job.item}:v1`);

  // Running it queues the email to the contact, with the client's own link and the `portal_ready` kind.
  const sent = await announcePortalPost(
    { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
    f.org.id,
    job.item as string,
    1,
  );
  expect(sent.sent).toBe(1);
  const emails = await f.db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, "email.send")));
  // One email per client, contact and hour (`portal-notices.ts`): its key names the client, the hour's window and the
  // contact, so a second send inside the window adds nothing.
  const one = emails.find((e) => String(e.payload.key).startsWith("portal-notice:padaria-aurora:"));
  expect(one).toBeTruthy();
  expect(one && (one.payload.template as { kind: string }).kind).toBe("portal_ready");

  // A post no longer waiting on the client (approved) tells nothing.
  await clientDecision(
    { db: f.db },
    { orgId: f.org.id, client: "padaria-aurora" },
    {
      postId: job.item as string,
      decision: "approve",
    },
  );
  const again = await announcePortalPost(
    { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
    f.org.id,
    job.item as string,
    1,
  );
  expect(again.sent).toBe(0);
  expect(again.skipped).toBe("answered");
});
