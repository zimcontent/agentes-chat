import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createFakeEmailSender, createFakeWhatsAppGateway, createMemoryBlobStore } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import type { ArtifactDeps, ToolContext } from "../src";
import {
  addChannelMember,
  announcePortalPost,
  clientDecision,
  createEmbeddedApprovalPortal,
  createOrganization,
  createPortalToolSource,
  listPortalClients,
  makeClientLink,
  PORTAL_CLIENTS_TOOL,
  portalBelongsTo,
  portalClientOfToken,
  portalNoticeSettingsOf,
  portalOrgId,
  postPersonMessage,
  revokeClientLink,
  sealSecret,
  setPortalNoticeNumber,
  upsertPortalClient,
} from "../src";
import { addMember, addUser, everyoneWithout, SECRET, setup } from "./fixtures";

// The review's items of the installation's own approval portal (docs/adr/doug-0031-embedded-approval-portal.md):
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
async function connectedNumber(fixture: Awaited<ReturnType<typeof setup>>, label: string, people: string[] = []) {
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
      upsertPortalClient(
        { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET },
        other,
        { client: "outra", name: "Outra" },
        f.owner.id,
      ),
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
    const rows = await listPortalClients(
      { db: f.db, publicUrl: PUBLIC_URL, secret: "another-secret".padEnd(48, "y") },
      f.org.id,
    );
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
    const changed = await upsertPortalClient(
      deps(),
      f.org.id,
      { client: "padaria-aurora", name: "Padaria Aurora Ltda" },
      f.owner.id,
    );
    expect(changed.name).toBe("Padaria Aurora Ltda");
    expect(changed.contacts).toHaveLength(1);
    expect(changed.contacts[0]?.email).toBe("ana@example.com");
    // A save that says `contacts: []` does empty them.
    const emptied = await upsertPortalClient(
      deps(),
      f.org.id,
      { client: "padaria-aurora", name: "Padaria Aurora", contacts: [] },
      f.owner.id,
    );
    expect(emptied.contacts).toEqual([]);
  });

  test("a contact's id is made on the server, and two saves never share one", async () => {
    const one = await makeClient("padaria-aurora", "Padaria Aurora", [
      { id: "fixed", name: "Ana", email: "ana@example.com" },
    ]);
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

describe("a client's notices (ADR doug-0031 §7)", () => {
  test("a v2 after an adjustment tells again; the same version tells once", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const upload = await portal.upload("reel.mp4", new Uint8Array([1, 2]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "v1" });
    const first = await announcePortalPost(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
      f.org.id,
      job.item as string,
      1,
    );
    expect(first.sent).toBe(1);
    // The same version again: nothing new went out.
    const again = await announcePortalPost(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
      f.org.id,
      job.item as string,
      1,
    );
    expect(again.sent).toBe(0);

    // The client asks a change, the team puts a v2 up: the notice names it, past the one the client was told of.
    await clientDecision(
      { db: f.db },
      { orgId: f.org.id, client: "padaria-aurora" },
      { postId: job.item as string, decision: "adjust", text: "Troca" },
    );
    const v2 = await portal.upload("reel-v2.mp4", new Uint8Array([3, 4]));
    await portal.newVersion("padaria-aurora", job.item as string, { files: [v2] });
    // Two hours later: the client's hour (one notice an hour) is well over, so the v2 tells on its own.
    const later = () => new Date(Date.now() + 2 * 3600_000);
    const told = await announcePortalPost(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email, now: later },
      f.org.id,
      job.item as string,
      2,
    );
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
    const out = await announcePortalPost(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
      f.org.id,
      job.item as string,
      1,
    );
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
    const waDeps = () => ({
      db: f.db,
      publicUrl: PUBLIC_URL,
      secret: SECRET,
      whatsapp: { gateway, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: "https://acme.example" },
    });
    const unchosen = await announcePortalPost(waDeps(), f.org.id, job.item as string, 1);
    expect(unchosen.sent).toBe(0);
    expect(gateway.last("send")).toBeUndefined();
    // Chosen in Settings: a new post's notice goes from it.
    await setPortalNoticeNumber(f.db, f.org.id, number?.id as string, { userId: f.owner.id, manages: true });
    const upload2 = await portal.upload("outro.mp4", new Uint8Array([2]));
    const job2 = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload2], caption: "Outro" });
    const chosen = await announcePortalPost(waDeps(), f.org.id, job2.item as string, 1);
    expect(chosen.sent).toBe(1);
    expect(gateway.last("send")?.to).toBe("5511999990000@s.whatsapp.net");
  });
});

/** The message each person wrote, so a tool's `triggerMessageId` names them (`personBehindCall`). */
const messageOf = new Map<string, string>();
async function speakAs(personId: string) {
  // The owner adds them to #general, so their message is theirs to send.
  await addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { userId: personId });
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, personId, f.org.id, f.general.id, {
    body: "oi",
  });
  messageOf.set(personId, message.id);
}

/** A run id the tools read: no row names it, so a person is read from `triggerMessageId` (`personBehindCall`). */
const SOME_RUN = Bun.randomUUIDv7();

describe("the `portal_clients` tool", () => {
  const toolCtx = (personId: string | null) =>
    ({
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: SOME_RUN,
      channelId: f.general.id,
      triggerMessageId: personId ? (messageOf.get(personId) ?? null) : null,
      db: f.db,
    }) as unknown as ToolContext;

  test("listing asks for the person behind the run; making a client needs their `assign_work`", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora");
    await speakAs(f.owner.id);
    const portal = createEmbeddedApprovalPortal({ db: f.db, blobs, publicUrl: PUBLIC_URL, secret: SECRET });
    const source = createPortalToolSource({
      portal,
      artifacts: {} as ArtifactDeps,
      here: async () => true,
      clients: { publicUrl: PUBLIC_URL, secret: SECRET },
    });
    const tools = await source.tools(toolCtx(f.owner.id));
    const tool = tools.find((t) => t.name === PORTAL_CLIENTS_TOOL);
    if (!tool) throw new Error("the clients tool isn't listed on the installation's own portal");

    // A person behind the run: it lists the clients, links and all, and makes one.
    const listed = (await tool.execute({}, toolCtx(f.owner.id))) as { content: string; isError?: boolean };
    expect(listed.isError).not.toBe(true);
    expect(listed.content).toContain("padaria-aurora");
    expect(listed.content).toContain("/p/");
    const saved = (await tool.execute({ client: "cafe-sol", name: "Cafe Sol" }, toolCtx(f.owner.id))) as {
      content: string;
      isError?: boolean;
    };
    expect(saved.isError).not.toBe(true);
    expect(saved.content).toContain("cafe-sol");

    // Nobody behind the run (a routine): the tool refuses, and names nothing of the team's.
    const nobody = (await tool.execute({}, toolCtx(null))) as { content: string; isError?: boolean };
    expect(nobody.isError).toBe(true);
    expect(nobody.content).not.toContain("padaria-aurora");
    expect(nobody.content).not.toContain("/p/");
  });

  test("a workspace that isn't the portal's gets no clients and makes none", async () => {
    await makeClient();
    const other = await otherWorkspace();
    const portal = createEmbeddedApprovalPortal({ db: f.db, blobs, publicUrl: PUBLIC_URL, secret: SECRET });
    const source = createPortalToolSource({
      portal,
      artifacts: {} as ArtifactDeps,
      here: async () => true,
      clients: { publicUrl: PUBLIC_URL, secret: SECRET },
    });
    const tool = (await source.tools(toolCtx(f.owner.id))).find((t) => t.name === PORTAL_CLIENTS_TOOL);
    if (!tool) throw new Error("no clients tool");
    const out = (await tool.execute({ client: "x", name: "X" }, {
      ...toolCtx(f.owner.id),
      orgId: other,
    } as unknown as ToolContext)) as { isError?: boolean };
    expect(out.isError).toBe(true);
  });
});

describe("the client behind a token", () => {
  test("a link is only good for its own client", async () => {
    const aurora = await makeClient("padaria-aurora", "Padaria Aurora");
    await makeClient("cafe-sol", "Cafe Sol");
    const token = (aurora.link as string).split("/").at(-1) as string;
    expect((await portalClientOfToken(f.db, token, SECRET))?.client).toBe("padaria-aurora");
    // A new link revokes the one before.
    await makeClientLink(deps(), f.org.id, aurora.id, f.owner.id);
    expect(await portalClientOfToken(f.db, token, SECRET)).toBeNull();
  });
});

// ── the second review's items ────────────────────────────────────────────────────────────────────────────────

describe("the `portal_clients` tool gives a client's link only to someone who may manage the portal", () => {
  const sourceOf = () =>
    createPortalToolSource({
      portal: createEmbeddedApprovalPortal({ db: f.db, blobs, publicUrl: PUBLIC_URL, secret: SECRET }),
      artifacts: {} as ArtifactDeps,
      here: async () => true,
      clients: { publicUrl: PUBLIC_URL, secret: SECRET },
    });
  const toolCtx = (personId: string) =>
    ({
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: SOME_RUN,
      channelId: f.general.id,
      triggerMessageId: messageOf.get(personId) ?? null,
      db: f.db,
    }) as unknown as ToolContext;

  test("a member without `assign_work` lists the clients by name, and gets no address", async () => {
    const made = await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    expect(made.link).toMatch(/\/p\//);
    // A member of the workspace, without `assign_work` (the base role has it, so it is taken off here).
    const reader = await addMember(f.db, f.org.id, "member", "bia");
    await everyoneWithout(f.db, f.org.id, "assign_work");
    await speakAs(reader.id);
    const tool = (await sourceOf().tools(toolCtx(reader.id))).find((t) => t.name === PORTAL_CLIENTS_TOOL);
    if (!tool) throw new Error("no clients tool");
    const listed = (await tool.execute({}, toolCtx(reader.id))) as { content: string; isError?: boolean };
    expect(listed.isError).not.toBe(true);
    // The name is there; nothing of the link, and nothing of who the client is written to.
    expect(listed.content).toContain("padaria-aurora");
    expect(listed.content).not.toContain("/p/");
    expect(listed.content).not.toContain("ana@example.com");
  });

  test("someone who gives agents work reads the link and the contacts", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    await speakAs(f.owner.id);
    const tool = (await sourceOf().tools(toolCtx(f.owner.id))).find((t) => t.name === PORTAL_CLIENTS_TOOL);
    if (!tool) throw new Error("no clients tool");
    const listed = (await tool.execute({}, toolCtx(f.owner.id))) as { content: string };
    expect(listed.content).toContain("/p/");
    expect(listed.content).toContain("ana@example.com");
  });
});

describe("the number the portal's notices go out as is one the actor may use", () => {
  test("a member without `manage_connectors` sees and picks only the numbers they are on", async () => {
    const whatsapp = await addMember(f.db, f.org.id, "member", "caio");
    await everyoneWithout(f.db, f.org.id, "manage_connectors");
    await everyoneWithout(f.db, f.org.id, "assign_work");
    // Two numbers: one of another member, one of theirs.
    const other = await connectedNumber(f, "Outro time", [f.owner.id]);
    const mine = await connectedNumber(f, "Meu", [whatsapp.id]);
    // Who they are, read as the routes do: no `manage_connectors`, so only the numbers they are on.
    const actor = { userId: whatsapp.id, manages: false };
    const settings = await portalNoticeSettingsOf(f.db, f.org.id, actor);
    expect(settings.numbers.map((n) => n.id)).toEqual([mine.id]);
    expect(settings.numbers.some((n) => n.id === other.id)).toBe(false);
    // Picking the other member's number is refused; their own is taken.
    await expect(setPortalNoticeNumber(f.db, f.org.id, other.id, actor)).rejects.toThrow(/you may use/i);
    await setPortalNoticeNumber(f.db, f.org.id, mine.id, actor);
    expect((await portalNoticeSettingsOf(f.db, f.org.id, actor)).number).toBe(mine.id);
    // Someone who manages connectors is offered both, and picks either.
    const manager = { userId: f.owner.id, manages: true };
    expect((await portalNoticeSettingsOf(f.db, f.org.id, manager)).numbers.map((n) => n.id).sort()).toEqual(
      [other.id, mine.id].sort(),
    );
    await setPortalNoticeNumber(f.db, f.org.id, other.id, manager);
    expect((await portalNoticeSettingsOf(f.db, f.org.id, manager)).number).toBe(other.id);
  });

  test("a choice whose chooser may no longer use that number tells nothing", async () => {
    const chooser = await addMember(f.db, f.org.id, "member", "dora");
    const number = await connectedNumber(f, "Comercial", [chooser.id]);
    const gateway = createFakeWhatsAppGateway();
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", whatsapp: "5511999990000" }]);
    const waDeps = () => ({
      db: f.db,
      publicUrl: PUBLIC_URL,
      secret: SECRET,
      whatsapp: { gateway, keyWrappers: [f.keyWrapper], pubsub: f.pubsub, hookBase: "https://acme.example" },
    });
    await setPortalNoticeNumber(f.db, f.org.id, number.id, { userId: chooser.id, manages: false });
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Cap" });
    expect((await announcePortalPost(waDeps(), f.org.id, job.item as string, 1)).sent).toBe(1);
    // Taken off the number's people, the choice the chooser made no longer tells anyone (`chosenNumber`).
    await f.db.update(schema.whatsappAccounts).set({ people: [] }).where(eq(schema.whatsappAccounts.id, number.id));
    const other = await portal.upload("outro.mp4", new Uint8Array([2]));
    const job2 = await portal.send({ client: "padaria-aurora", type: "reel", files: [other], caption: "Outro" });
    const later = () => new Date(Date.now() + 2 * 3600_000);
    const after = await announcePortalPost({ ...waDeps(), now: later }, f.org.id, job2.item as string, 1);
    expect(after.sent).toBe(0);
  });
});

describe("one notice an hour for a client (ADR doug-0031 §8)", () => {
  test("posts inside the hour wait for the window's end, and go in one notice there", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const start = new Date("2026-11-18T09:10:00.000Z");
    const clock = { at: start };
    const now = () => clock.at;
    const notice = (postId: string, version = 1) =>
      announcePortalPost({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email, now }, f.org.id, postId, version);
    const send = async (name: string) => {
      const upload = await portal.upload(name, new Uint8Array([1]));
      return portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: name });
    };

    // The first post of the hour: its notice goes out.
    const one = await send("Um");
    expect((await notice(one.item as string)).sent).toBe(1);

    // Two more inside the same hour: neither goes now, and each says when the window ends.
    clock.at = new Date(start.getTime() + 10 * 60_000);
    const two = await send("Dois");
    const held = await notice(two.item as string);
    expect(held).toMatchObject({ sent: 0, skipped: "recent", client: "padaria-aurora" });
    const ends = new Date(start.getTime() + 3600_000);
    expect(held.retryAt?.toISOString()).toBe(ends.toISOString());
    clock.at = new Date(start.getTime() + 20 * 60_000);
    const three = await send("Tres");
    expect((await notice(three.item as string)).retryAt?.toISOString()).toBe(ends.toISOString());

    // At the end of the hour: one notice, both of the posts nobody was told of, `posts[]` and all.
    clock.at = ends;
    expect((await notice(three.item as string)).sent).toBe(1);
    const emails = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, "email.send")));
    const portalReady = emails.filter((e) => (e.payload.template as { kind: string }).kind === "portal_ready");
    // The window's first post, and the one the hour's end gathered the other two into.
    expect(portalReady).toHaveLength(2);
    const last = portalReady.at(-1)?.payload.template as { kind: string; posts: { title: string }[] };
    expect(last.posts.map((p) => p.title).sort()).toEqual(["Dois", "Tres"]);
  });
});

describe("a send at the same moment", () => {
  test("two sends with one key make one post, and both answers name the same job", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora");
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const key = "send-key-1";
    const input = { client: "padaria-aurora", type: "reel" as const, files: [upload], caption: "Cap", key };
    const [a, b] = await Promise.all([portal.send(input), portal.send(input)]);
    expect(a.id).toBe(b.id);
    // One post, and one job: the second's read found the first's row.
    const posts = await f.db.select().from(schema.portalPosts).where(eq(schema.portalPosts.orgId, f.org.id));
    expect(posts).toHaveLength(1);
    const jobs = await f.db.select().from(schema.portalJobs).where(eq(schema.portalJobs.orgId, f.org.id));
    expect(jobs).toHaveLength(1);
  });
});

describe("`AGENTES_SECRET` rotation (ADR doug-0031 §4)", () => {
  test("a link made under the old secret opens nothing after it changes", async () => {
    const made = await makeClient("padaria-aurora", "Padaria Aurora");
    const token = (made.link as string).split("/").at(-1) as string;
    expect((await portalClientOfToken(f.db, token, SECRET))?.client).toBe("padaria-aurora");
    // The same token under another secret: the row's hash names it, but the token derived from the secret doesn't
    // match, so it is not a link of this server any more.
    expect(await portalClientOfToken(f.db, token, "outro-segredo".padEnd(48, "z"))).toBeNull();
  });
});

describe("the client decides on the version they saw (ADR doug-0031 §7)", () => {
  test("a decision naming a version the post left goes 409 `portal.version_changed`", async () => {
    await makeClient();
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "v1" });
    const client = { orgId: f.org.id, client: "padaria-aurora" };
    // The client had v1 on screen, and the post already moved on: refused, and nothing written.
    await expect(
      clientDecision({ db: f.db }, client, { postId: job.item as string, decision: "approve", version: 2 }),
    ).rejects.toMatchObject({ code: "portal.version_changed" });
    const [post] = await f.db
      .select()
      .from(schema.portalPosts)
      .where(eq(schema.portalPosts.id, job.item as string));
    expect(post?.status).toBe("sent");
    // The version they saw: taken.
    const done = await clientDecision({ db: f.db }, client, {
      postId: job.item as string,
      decision: "approve",
      version: 1,
    });
    expect(done.version).toBe(1);
  });
});

describe("a workspace closed to work", () => {
  test("tells the client nothing, as its page opens nothing", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Cap" });
    await f.db.update(schema.organizations).set({ standing: "hold" }).where(eq(schema.organizations.id, f.org.id));
    const out = await announcePortalPost(
      { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
      f.org.id,
      job.item as string,
      1,
    );
    expect(out).toMatchObject({ sent: 0, skipped: "closed" });
  });
});
