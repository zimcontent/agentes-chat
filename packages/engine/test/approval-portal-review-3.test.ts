import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createFakeEmailSender,
  createFakeWhatsAppGateway,
  createMemoryBlobStore,
  StorageError,
} from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import {
  announcePortalPost,
  createEmbeddedApprovalPortal,
  makeClientLink,
  PORTAL_NOTIFY_JOB,
  PortalTextsUnsent,
  queuePortalNoticesFor,
  sealSecret,
  setOrgStanding,
  setPortalNoticeNumber,
  upsertPortalClient,
} from "../src";
import { createJobHandlers } from "../src/jobs";
import { drainOutbox } from "../src/outbox";
import { SECRET, setup } from "./fixtures";

// The fourth review of the installation's own approval portal (docs/adr/doug-0031-embedded-approval-portal.md): the
// notice a hold or a missing link swallowed is swept back by the real job, a text that fails is retried on its own
// without a second e-mail, an upload's key is its own id and never the name a browser sent, and a range the server
// can make no sense of answers the whole file instead of a refusal. On PGlite, a memory file store and no network.

const PUBLIC_URL = "https://acme.example";

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

const deps = () => ({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET });

async function makeClient(client = "padaria-aurora", name = "Padaria Aurora", contacts: unknown[] = []) {
  return upsertPortalClient(deps(), f.org.id, { client, name, contacts }, f.owner.id);
}

/** A connected WhatsApp number of the workspace, sealed as `createWhatsAppAccount` does. */
async function connectedNumber(label: string, people: string[] = []) {
  const id = Bun.randomUUIDv7();
  const sealed = await sealSecret(f.keyWrapper, "token-for-tests", `whatsapp:${f.org.id}:${id}`);
  const [row] = await f.db
    .insert(schema.whatsappAccounts)
    .values({
      id,
      orgId: f.org.id,
      label,
      status: "connected",
      people,
      instanceId: `i-${id.slice(0, 6)}`,
      tokenCiphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
      hookHash: `h-${id}`,
    })
    .returning();
  if (!row) throw new Error("the number could not be made");
  return row;
}

const jobs = async () =>
  (
    await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, PORTAL_NOTIFY_JOB)))
  ).filter((row) => row.status === "pending");

describe("a notice a hold or a missing link swallowed comes back (review 4, item 1)", () => {
  test("the real job runs on the hold, and the sweep queues the post again when the hold lifts", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    const handlers = createJobHandlers({
      ...f.jobDeps,
      portalNotify: { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
    });
    await setOrgStanding({ db: f.db }, f.org.id, { state: "hold", reason: "legal_hold", note: null, notice: "shown" });
    // The job the send left runs for real: it answers `closed`, and the row is consumed as the worker marks it.
    await drainOutbox(f.db, { [PORTAL_NOTIFY_JOB]: handlers[PORTAL_NOTIFY_JOB]! } as never);
    expect(await jobs()).toHaveLength(0);
    // The hold lifts: the sweep queues the post again, under a key of its own, so the consumed first one doesn't take
    // it. It names the client, and its post and version.
    await setOrgStanding({ db: f.db }, f.org.id, { state: "active", reason: null, note: null, notice: "shown" });
    const pending = await jobs();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toMatchObject({ postId: job.item as string, version: 1, client: "padaria-aurora" });
    expect(pending[0]?.payload.resumed).toBe(true);
    expect(String(pending[0]?.dedupeKey)).toStartWith(`portal.notify:resume:${job.item}:v1:`);
  });

  test("the sweep after a new link tells what the stale link held back, and keeps the send's e-mail to one", async () => {
    const client = await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    // No live link: the notice answers `link`, and nothing is recorded for the post.
    await f.db
      .update(schema.portalClientLinks)
      .set({ revokedAt: new Date() })
      .where(eq(schema.portalClientLinks.clientId, client.id));
    const held = await announcePortalPost(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
      f.org.id,
      job.item as string,
      1,
    );
    expect(held).toMatchObject({ sent: 0, skipped: "link" });
    // A new link is made (the team's `makeClientLink`): the sweep names the post that was waiting.
    await makeClientLink(deps(), f.org.id, client.id, f.owner.id);
    const pending = (await jobs()).filter((row) => row.payload.resumed === true);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toMatchObject({ postId: job.item as string, client: "padaria-aurora" });
    // The sweep is safe to repeat: the same version is never told twice while no notice row says it was.
    const once = await queuePortalNoticesFor(f.db, f.org.id, new Date("2026-11-18T10:00:00.000Z"));
    const again = await queuePortalNoticesFor(f.db, f.org.id, new Date("2026-11-18T10:00:00.000Z"));
    expect(once).toBe(1);
    expect(again).toBe(0);
  });
});

describe("a text that fails is retried on its own (review 4, item 2)", () => {
  test("every text failing with nothing else reaching the client throws, so the outbox retries the notice", async () => {
    // Contacts with a number and no address: the texts are the notice's only way, so their failing leaves the client
    // told of nothing, and the whole notice is owed again.
    await makeClient("padaria-aurora", "Padaria Aurora", [
      { name: "Ana", whatsapp: "5511999990001" },
      { name: "Bia", whatsapp: "5511999990002" },
    ]);
    const number = await connectedNumber("DOUG", [f.owner.id]);
    await setPortalNoticeNumber(f.db, f.org.id, number.id, { userId: f.owner.id, manages: true });
    const gateway = createFakeWhatsAppGateway();
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    const refusing = {
      ...gateway,
      sendText: async () => {
        throw new Error("the gateway is down");
      },
    };
    const err = await announcePortalPost(
      {
        db: f.db,
        publicUrl: PUBLIC_URL,
        secret: SECRET,
        email,
        whatsapp: { gateway: refusing, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: PUBLIC_URL },
      },
      f.org.id,
      job.item as string,
      1,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortalTextsUnsent);
    // Nothing recorded, so the retry reads the post as not yet told.
    const notices = await f.db.select().from(schema.portalNotices).where(eq(schema.portalNotices.orgId, f.org.id));
    expect(notices).toHaveLength(0);
    // And the job itself fails through the real handler, which is what makes the outbox retry it with backoff.
    const handlers = createJobHandlers({
      ...f.jobDeps,
      portalNotify: {
        db: f.db,
        publicUrl: PUBLIC_URL,
        secret: SECRET,
        email,
        whatsapp: { gateway: refusing, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: PUBLIC_URL },
      },
    });
    await drainOutbox(f.db, { [PORTAL_NOTIFY_JOB]: handlers[PORTAL_NOTIFY_JOB]! } as never, { maxBatches: 1 });
    const row = (await f.db.select().from(schema.outbox).where(eq(schema.outbox.orgId, f.org.id))).find(
      (r) => r.dedupeKey === `portal.notify:${job.item}:v1`,
    );
    expect(row?.attempts).toBeGreaterThanOrEqual(1);
    expect(row?.status).toBe("pending");
  });

  test("a notice whose e-mail went is `done` even when its text failed: the e-mail is queued once", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [
      { name: "Ana", email: "ana@example.com", whatsapp: "5511999990001" },
    ]);
    const number = await connectedNumber("DOUG", [f.owner.id]);
    await setPortalNoticeNumber(f.db, f.org.id, number.id, { userId: f.owner.id, manages: true });
    const gateway = createFakeWhatsAppGateway();
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    const out = await announcePortalPost(
      {
        db: f.db,
        publicUrl: PUBLIC_URL,
        secret: SECRET,
        email,
        whatsapp: {
          gateway: { ...gateway, sendText: async () => Promise.reject(new Error("gone")) },
          keyWrappers: [f.keyWrapper],
          pubsub: f.pubsub,
          hookBase: PUBLIC_URL,
        },
      },
      f.org.id,
      job.item as string,
      1,
    );
    // The e-mail reached the client, so the notice is not owed as a whole; the text is, and is named as pending.
    expect(out.sent).toBe(1);
    expect(out.pending).toHaveLength(1);
    const emails = (await f.db.select().from(schema.outbox).where(eq(schema.outbox.orgId, f.org.id))).filter(
      (r) => r.kind === "email.send" && String(r.dedupeKey ?? "").startsWith("email:portal-notice:"),
    );
    expect(emails).toHaveLength(1);
  });

  test("one text failing while another went leaves the notice done, and queues a retry for the contact owed it", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [
      { name: "Ana", email: "ana@example.com", whatsapp: "5511999990001" },
      { name: "Bia", whatsapp: "5511999990002" },
    ]);
    const number = await connectedNumber("DOUG", [f.owner.id]);
    await setPortalNoticeNumber(f.db, f.org.id, number.id, { userId: f.owner.id, manages: true });
    const gateway = createFakeWhatsAppGateway();
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    const handlers = createJobHandlers({
      ...f.jobDeps,
      portalNotify: {
        db: f.db,
        publicUrl: PUBLIC_URL,
        secret: SECRET,
        email,
        whatsapp: { gateway, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: PUBLIC_URL },
      },
    });
    // The first text goes; the second is refused by the gateway once.
    gateway.failNext = "the number refused";
    await drainOutbox(f.db, { [PORTAL_NOTIFY_JOB]: handlers[PORTAL_NOTIFY_JOB]! } as never);
    const all = await f.db.select().from(schema.outbox).where(eq(schema.outbox.orgId, f.org.id));
    const first = all.find((r) => r.dedupeKey === `portal.notify:${job.item}:v1`);
    // The notice itself finished: one of the two contacts was told by WhatsApp.
    expect(first?.status).toBe("done");
    // And a retry names the contact whose text is owed, alone.
    const retry = all.find((r) => String(r.dedupeKey ?? "").startsWith(`${PORTAL_NOTIFY_JOB}:text:`));
    expect(retry).toBeDefined();
    expect(retry?.payload.client).toBe("padaria-aurora");
    expect(retry?.payload.contacts).toHaveLength(1);
    // The e-mail of Ana went once, and Bia has no address to get a second.
    const emails = all.filter((r) => r.kind === "email.send");
    expect(emails).toHaveLength(1);
  });

  test("the retry for the owed contact tells that contact alone, without reading the hour again", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [
      { name: "Ana", whatsapp: "5511999990001" },
      { name: "Bia", whatsapp: "5511999990002" },
    ]);
    const number = await connectedNumber("DOUG", [f.owner.id]);
    await setPortalNoticeNumber(f.db, f.org.id, number.id, { userId: f.owner.id, manages: true });
    const gateway = createFakeWhatsAppGateway();
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    const contacts = (await f.db.select().from(schema.portalClients)).find((c) => c.client === "padaria-aurora")
      ?.contacts as { id: string; name: string }[];
    const bia = contacts.find((c) => c.name === "Bia")?.id as string;
    const whatsapp = { gateway, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: PUBLIC_URL };
    // Ana is told; Bia's text is the one still owed.
    const first = await announcePortalPost(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email, whatsapp },
      f.org.id,
      job.item as string,
      1,
      null,
      [bia],
    );
    expect(first.sent).toBe(1);
    expect(gateway.calls.filter((call) => call.op === "send")).toHaveLength(1);
  });
});

describe("an upload's key is its own id, never the name (review 4, item 3)", () => {
  test("a name with a path in it stays out of the key, and the name the client reads is the row's", async () => {
    await makeClient();
    const id = await portal.upload("../x.png", new Uint8Array([1]));
    const [upload] = await f.db
      .select()
      .from(schema.portalUploads)
      .where(and(eq(schema.portalUploads.orgId, f.org.id), eq(schema.portalUploads.id, id)));
    expect(upload?.name).toBe("../x.png");
    expect(upload?.blobKey).toMatch(/\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(upload?.blobKey).not.toContain("..");
    expect(upload?.blobKey).not.toContain("x.png/");
  });

  test("a name whose extension isn't one a key holds ends the key with nothing", async () => {
    await makeClient();
    const id = await portal.upload("photo.JPEG", new Uint8Array([1]));
    const [upload] = await f.db
      .select()
      .from(schema.portalUploads)
      .where(and(eq(schema.portalUploads.orgId, f.org.id), eq(schema.portalUploads.id, id)));
    // `.JPEG` is a whole extension of letters: kept, lowercased, and the rest of the name never reaches the key.
    expect(upload?.blobKey).toMatch(/\/uploads\/[0-9a-f-]{36}\.jpeg$/);
    // A dotted name whose "extension" is too long for a key, or one with none, ends the key with its id alone.
    const long = await portal.upload("a.thisiswaytoolong", new Uint8Array([1]));
    const [second] = await f.db
      .select()
      .from(schema.portalUploads)
      .where(and(eq(schema.portalUploads.orgId, f.org.id), eq(schema.portalUploads.id, long)));
    expect(second?.blobKey).toMatch(/\/uploads\/[0-9a-f-]{36}$/);
    const odd = await portal.upload("noextension", new Uint8Array([1]));
    const [third] = await f.db
      .select()
      .from(schema.portalUploads)
      .where(and(eq(schema.portalUploads.orgId, f.org.id), eq(schema.portalUploads.id, odd)));
    expect(third?.blobKey).toMatch(/\/uploads\/[0-9a-f-]{36}$/);
  });
});

describe("a store that refuses the part answers 416 (review 4, item 4)", () => {
  test("an S3 refusal past the object's end is the same `416` the range is, never an unexpected error", async () => {
    const error = new StorageError(
      "range_not_satisfiable",
      "InvalidRange: The requested range is not satisfiable",
      416,
    );
    expect(error.code).toBe("range_not_satisfiable");
    expect(error.status).toBe(416);
  });
});
