import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createFakeEmailSender, createFakeWhatsAppGateway, createMemoryBlobStore } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import {
  announcePortalPost,
  clientDecision,
  createEmbeddedApprovalPortal,
  listPortalClients,
  makeClientLink,
  portalBelongsTo,
  portalClientOfToken,
  portalOrgId,
  revokeClientLink,
  setPortalNoticeNumber,
  upsertPortalClient,
  createOrganization,
  sealSecret,
} from "../src";
import { addUser, SECRET, setup } from "./fixtures";

// The review's items of the installation's own approval portal (docs/adr/doug-0020-embedded-approval-portal.md):
// the portal belongs to one workspace of the server, a client's link is only shown while its token still matches the
// hash kept for it, saving a client without its contacts keeps them, and a post takes one decision however many
// arrive at once. On PGlite, a memory file store and no network.

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

/**
 * A connected WhatsApp number of the workspace, sealed as `createWhatsAppAccount` does: what a notice needs to be sent
 * as a real one, without the gateway's own session.
 */
async function connectedNumber(fixture: Awaited<ReturnType<typeof setup>>, label: string) {
  const id = Bun.randomUUIDv7();
  const token = "token-for-tests";
  const sealed = await sealSecret(fixture.keyWrapper, token, `whatsapp:${fixture.org.id}:${id}`);
  const [row] = await fixture.db
    .insert(schema.whatsappAccounts)
    .values({
      id,
      orgId: fixture.org.id,
      label,
      status: "connected",
      instanceId: `i-${id.slice(0, 6)}`,
      tokenCiphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
      hookHash: "h",
    })
    .returning();
  return row;
}

/** A second workspace on the same server: the other business. */
async function otherWorkspace() {
  const owner = await addUser(f.db, "bia");
  const created = await createOrganization(f.db, owner.id, { name: "Consig" });
  return created.organization.id;
}

describe("the portal belongs to one workspace (ADR 9001 §18)", () => {
  test("another workspace is refused a client, a link and a client's list", async () => {
    await makeClient();
    const other = await otherWorkspace();
    // The first workspace that made a client is the portal's; the other answers as if there were no portal.
    expect(await portalOrgId(f.db)).toBe(f.org.id);
    expect(await portalBelongsTo(f.db, f.org.id)).toBe(true);
    expect(await portalBelongsTo(f.db, other)).toBe(false);
    await expect(
      upsertPortalClient({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET }, other, { client: "outra", name: "Outra" }, f.owner.id),
    ).rejects.toThrow();
    // The list is empty there: the portal's clients aren't its.
    expect(await listPortalClients({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET }, other)).toEqual([]);
  });

  test("the portal's workspace is the same one `portalHere` names, whoever made the first task or the first client", async () => {
    await makeClient();
    expect(await portalOrgId(f.db)).toBe(f.org.id);
  });
});

describe("a client's link", () => {
  test("a token that no longer matches the hash (`AGENTES_SECRET` changed) is shown as needing a new link, never as a link", async () => {
    const made = await makeClient();
    expect(made.link).toMatch(/^https:\/\/acme\.example\/p\//);
    expect(made.linkStale).toBe(false);
    // The same row read with another secret: the token made from it doesn't match what was kept.
    const rows = await listPortalClients({ db: f.db, publicUrl: PUBLIC_URL, secret: "another-secret".padEnd(48, "y") }, f.org.id);
    expect(rows[0]?.link).toBeNull();
    expect(rows[0]?.linkStale).toBe(true);
    // A revoked link is `revoked`, not stale.
    await revokeClientLink({ db: f.db }, f.org.id, "padaria-aurora");
    const revoked = await listPortalClients(deps(), f.org.id);
    expect(revoked[0]?.link).toBeNull();
    expect(revoked[0]?.revoked).toBe(true);
    expect(revoked[0]?.linkStale).toBe(false);
  });
});

describe("saving a client", () => {
  test("a save without `contacts` keeps the client's contacts", async () => {
    const made = await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    expect(made.contacts).toHaveLength(1);
    // A change to the name alone (no `contacts` in the input) keeps them.
    const changed = await upsertPortalClient(deps(), f.org.id, { client: "padaria-aurora", name: "Padaria Aurora Ltda" }, f.owner.id);
    expect(changed.name).toBe("Padaria Aurora Ltda");
    expect(changed.contacts).toHaveLength(1);
    expect(changed.contacts[0]?.email).toBe("ana@example.com");
    // A save that says `contacts: []` does empty them.
    const emptied = await upsertPortalClient(deps(), f.org.id, { client: "padaria-aurora", name: "Padaria Aurora", contacts: [] }, f.owner.id);
    expect(emptied.contacts).toEqual([]);
  });

  test("a contact's id is made on the server, and two saves never share one", async () => {
    const one = await makeClient("padaria-aurora", "Padaria Aurora", [{ id: "fixed", name: "Ana", email: "ana@example.com" }]);
    const two = await makeClient("cafe-sol", "Cafe Sol", [{ id: "fixed", name: "Bea", email: "bea@example.com" }]);
    expect(one.contacts[0]?.id).not.toBe("fixed");
    expect(two.contacts[0]?.id).not.toBe("fixed");
    expect(one.contacts[0]?.id).not.toBe(two.contacts[0]?.id);
  });
});

describe("the client's decision", () => {
  test("two decisions at once: one takes the post, the other is the 409 a second decision gets", async () => {
    await makeClient();
    const upload = await portal.upload("reel.mp4", new Uint8Array([1, 2, 3]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Cap" });
    const client = { orgId: f.org.id, client: "padaria-aurora" };
    const results = await Promise.allSettled([
      clientDecision({ db: f.db }, client, { postId: job.item as string, decision: "approve" }),
      clientDecision({ db: f.db }, client, { postId: job.item as string, decision: "adjust", text: "Troca" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String((failed[0] as PromiseRejectedResult).reason)).toMatch(/already answered/i);
    // One note, from the decision that went through.
    const notes = await f.db
      .select()
      .from(schema.portalPostNotes)
      .where(and(eq(schema.portalPostNotes.orgId, f.org.id), eq(schema.portalPostNotes.postId, job.item as string)));
    expect(notes).toHaveLength(1);
  });
});

describe("a client's notices (ADR doug-0020 §7)", () => {
  test("a v2 after an adjustment tells again; the same version tells once", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const upload = await portal.upload("reel.mp4", new Uint8Array([1, 2]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "v1" });
    const first = await announcePortalPost({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email }, f.org.id, job.item as string, 1);
    expect(first.sent).toBe(1);
    // The same version again: nothing new went out.
    const again = await announcePortalPost({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email }, f.org.id, job.item as string, 1);
    expect(again.sent).toBe(0);

    // The client asks a change, the team puts a v2 up: the notice names it, past the one the client was told of.
    await clientDecision({ db: f.db }, { orgId: f.org.id, client: "padaria-aurora" }, { postId: job.item as string, decision: "adjust", text: "Troca" });
    const v2 = await portal.upload("reel-v2.mp4", new Uint8Array([3, 4]));
    await portal.newVersion("padaria-aurora", job.item as string, { files: [v2] });
    const told = await announcePortalPost({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email }, f.org.id, job.item as string, 2);
    expect(told.sent).toBe(1);
    const emails = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, "email.send")));
    const last = emails.at(-1)?.payload.template as { kind: string; posts: { version: number }[] };
    expect(last.kind).toBe("portal_ready");
    expect(last.posts.map((p) => p.version)).toContain(2);
  });

  test("nothing goes while the client has no live link, and the notice says so", async () => {
    const made = await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    void made;
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Cap" });
    await revokeClientLink({ db: f.db }, f.org.id, "padaria-aurora");
    const out = await announcePortalPost({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email }, f.org.id, job.item as string, 1);
    expect(out).toMatchObject({ sent: 0, skipped: "link" });
  });

  test("the number the notices go out as is the one the workspace chose, never one picked on its own", async () => {
    const made = await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", whatsapp: "5511999990000" }]);
    void made;
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Cap" });
    const gateway = createFakeWhatsAppGateway();
    // A connected number of the workspace, with nobody having chosen it: no WhatsApp, whatever else the workspace has.
    const number = await connectedNumber(f, "Comercial");
    const waDeps = () => ({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, whatsapp: { gateway, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: "https://acme.example" } });
    const unchosen = await announcePortalPost(waDeps(), f.org.id, job.item as string, 1);
    expect(unchosen.sent).toBe(0);
    expect(gateway.last("send")).toBeUndefined();
    // Chosen in Settings: a new post's notice goes from it.
    await setPortalNoticeNumber(f.db, f.org.id, number?.id as string);
    const upload2 = await portal.upload("outro.mp4", new Uint8Array([2]));
    const job2 = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload2], caption: "Outro" });
    const chosen = await announcePortalPost(waDeps(), f.org.id, job2.item as string, 1);
    expect(chosen.sent).toBe(1);
    expect(gateway.last("send")?.to).toBe("5511999990000@s.whatsapp.net");
  });
});

describe("the client behind a token", () => {
  test("a link is only good for its own client", async () => {
    const aurora = await makeClient("padaria-aurora", "Padaria Aurora");
    await makeClient("cafe-sol", "Cafe Sol");
    const token = (aurora.link as string).split("/").at(-1) as string;
    expect((await portalClientOfToken(f.db, token))?.client).toBe("padaria-aurora");
    // A new link revokes the one before.
    await makeClientLink(deps(), f.org.id, aurora.id, f.owner.id);
    expect(await portalClientOfToken(f.db, token)).toBeNull();
  });
});
