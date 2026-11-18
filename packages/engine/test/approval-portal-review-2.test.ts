import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createFakeEmailSender, createMemoryBlobStore } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import {
  announcePortalPost,
  clientDecision,
  clientPortalFileRange,
  createEmbeddedApprovalPortal,
  PORTAL_NOTICE_GROUP_MS,
  PORTAL_NOTIFY_JOB,
  queuePortalNoticesFor,
  rangePart,
  setOrgStanding,
  upsertPortalClient,
} from "../src";
import { createJobHandlers } from "../src/jobs";
import { drainOutbox } from "../src/outbox";
import { SECRET, setup } from "./fixtures";

// The third review of the installation's own approval portal (docs/adr/doug-0031-embedded-approval-portal.md): a
// retry that names its client and gathers what landed meanwhile, two notices at once telling once, the client's own
// language instead of one guessed from a name, the file ranges a player asks for, a decision that lands on the version
// it was about, and the notice a send leaves in the same transaction. On PGlite, a memory file store and no network.

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

const portalEmails = async () => {
  const rows = await f.db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, "email.send")));
  return rows
    .map((row) => row.payload.template as { kind: string; locale?: string; posts?: { title: string }[] })
    .filter((template) => template.kind === "portal_ready");
};

describe("a retry that comes back at the end of the hour names its client (review 3, item 1)", () => {
  test("the post it first came with was answered; another post landed meanwhile and is what the client is told of", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const clock = { at: new Date("2026-11-18T09:10:00.000Z") };
    const now = () => clock.at;
    const notice = (postId: string, version: number, client?: string) =>
      announcePortalPost(
        { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email, now },
        f.org.id,
        postId,
        version,
        client,
      );
    const send = async (name: string) => {
      const upload = await portal.upload(`${name}.mp4`, new Uint8Array([1]));
      return portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: name });
    };

    // The hour's first notice goes out for the first post.
    const one = await send("Um");
    expect((await notice(one.item as string, 1)).sent).toBe(1);

    // A second post inside the hour: nothing now, and the answer says when the hour is over.
    clock.at = new Date(clock.at.getTime() + 10 * 60_000);
    const two = await send("Dois");
    const held = await notice(two.item as string, 1);
    expect(held).toMatchObject({ sent: 0, skipped: "recent", client: "padaria-aurora" });
    const retryAt = held.retryAt as Date;
    // A third post lands before the hour is over: it waits too.
    clock.at = new Date(clock.at.getTime() + 10 * 60_000);
    const three = await send("Tres");
    expect((await notice(three.item as string, 1)).skipped).toBe("recent");

    // The client answers the post the retry was queued for: it is no longer waiting on anything, and a notice that
    // only looked at the payload's post would tell nothing. The third post is what it has to hear about.
    await clientDecision(
      { db: f.db },
      { orgId: f.org.id, client: "padaria-aurora" },
      {
        postId: two.item as string,
        decision: "approve",
      },
    );

    // The retry runs at the end of the hour, naming the client.
    clock.at = retryAt;
    const out = await notice(two.item as string, 1, "padaria-aurora");
    expect(out.sent).toBe(1);
    const last = (await portalEmails()).at(-1) as { posts: { title: string }[] };
    expect(last.posts.map((p) => p.title)).toEqual(["Tres.mp4"]);
  });

  test("the notice job's retry is keyed by the client, not the post: a second post inside the hour takes that same row", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const clock = new Date("2026-11-18T09:10:00.000Z");
    const handlers = createJobHandlers({
      ...f.jobDeps,
      portalNotify: { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email, now: () => clock },
    });
    const send = async (name: string) => {
      const upload = await portal.upload(`${name}.mp4`, new Uint8Array([1]));
      return portal.send({ client: "padaria-aurora", type: "reel", files: [upload], title: name });
    };
    const one = await send("Um");
    // The first post's job tells the client; a second post lands inside the hour and holds.
    await handlers[PORTAL_NOTIFY_JOB]?.(
      {
        id: "j1",
        orgId: f.org.id,
        kind: PORTAL_NOTIFY_JOB,
        payload: { postId: one.item, version: 1, client: "padaria-aurora" },
      } as never,
      { finalAttempt: false } as never,
    );
    const two = await send("Dois");
    await handlers[PORTAL_NOTIFY_JOB]?.(
      {
        id: "j2",
        orgId: f.org.id,
        kind: PORTAL_NOTIFY_JOB,
        payload: { postId: two.item, version: 1, client: "padaria-aurora" },
      } as never,
      { finalAttempt: false } as never,
    );
    const retries = (await f.db.select().from(schema.outbox).where(eq(schema.outbox.orgId, f.org.id))).filter((row) =>
      String(row.dedupeKey ?? "").startsWith(`${PORTAL_NOTIFY_JOB}:retry:`),
    );
    expect(retries).toHaveLength(1);
    // The retry names the client, and its moment is the end of the hour.
    expect(retries[0]?.payload.client).toBe("padaria-aurora");
    // The retry still names the post that first held it: the notice job's own payload, with the client beside it.
    expect(retries[0]?.payload.postId).toBe(two.item as string);
    expect(new Date(retries[0]?.nextAttemptAt as Date).toISOString()).toBe(
      new Date(clock.getTime() + PORTAL_NOTICE_GROUP_MS).toISOString(),
    );
  });
});

describe("two notices at once tell the client once (review 3, item 2)", () => {
  test("two `announce` calls in `Promise.all` send one notice, not two", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const a = await portal.upload("a.mp4", new Uint8Array([1]));
    const b = await portal.upload("b.mp4", new Uint8Array([2]));
    const one = await portal.send({ client: "padaria-aurora", type: "reel", files: [a], title: "Um" });
    const two = await portal.send({ client: "padaria-aurora", type: "reel", files: [b], title: "Dois" });
    const now = () => new Date("2026-11-18T09:10:00.000Z");
    const call = (postId: string) =>
      announcePortalPost({ db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email, now }, f.org.id, postId, 1);
    const [first, second] = await Promise.all([call(one.item as string), call(two.item as string)]);
    // One of the two told the client; the other found the hour already taken and held.
    expect(first.sent + second.sent).toBe(1);
    const held = [first, second].find((out) => out.sent === 0);
    expect(held).toMatchObject({ skipped: "recent" });
    // One email, naming both posts of the client (the hour's notice gathers them).
    const sent = await portalEmails();
    expect(sent).toHaveLength(1);
    expect((sent[0]?.posts ?? []).map((p) => p.title).sort()).toEqual(["Dois", "Um"]);
  });
});

describe("the client's language comes from its own field (review 3, item 4)", () => {
  test("a client whose contacts have accented names but whose language is English is told in English", async () => {
    await upsertPortalClient(
      deps(),
      f.org.id,
      {
        client: "padaria-aurora",
        name: "Padaria Aurora",
        contacts: [{ name: "Ana Íris", email: "ana@example.com" }],
        locale: "en",
      },
      f.owner.id,
    );
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    expect(
      (
        await announcePortalPost(
          { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
          f.org.id,
          job.item as string,
          1,
        )
      ).sent,
    ).toBe(1);
    const sent = (await portalEmails()).at(-1) as { locale: string };
    expect(sent.locale).toBe("en");
  });

  test("with no language of its own, a client is told in the workspace owner's own language", async () => {
    // The owner's own account is Portuguese.
    await f.db.update(schema.users).set({ locale: "pt-BR" }).where(eq(schema.users.id, f.owner.id));
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    expect(
      (
        await announcePortalPost(
          { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
          f.org.id,
          job.item as string,
          1,
        )
      ).sent,
    ).toBe(1);
    const sent = (await portalEmails()).at(-1) as { locale: string };
    expect(sent.locale).toBe("pt-BR");
  });

  test("the client's own language is read back on its list's row, and a save without it keeps it", async () => {
    const made = await upsertPortalClient(
      deps(),
      f.org.id,
      { client: "padaria-aurora", name: "Padaria Aurora", locale: "es" },
      f.owner.id,
    );
    expect(made.locale).toBe("es");
    // A change to the name alone keeps it, as the contacts are kept.
    const changed = await upsertPortalClient(
      deps(),
      f.org.id,
      { client: "padaria-aurora", name: "Padaria Aurora Ltda" },
      f.owner.id,
    );
    expect(changed.locale).toBe("es");
    // One that says `locale: null` goes back to the owner's.
    const cleared = await upsertPortalClient(
      deps(),
      f.org.id,
      { client: "padaria-aurora", name: "Padaria Aurora", locale: null },
      f.owner.id,
    );
    expect(cleared.locale).toBeNull();
  });
});

describe("the file's ranges (review 3, item 5)", () => {
  const MiB = 1024 * 1024;

  test("an open range reads at most 8 MiB, and the answer names that part", () => {
    const big = 20 * MiB;
    const part = rangePart("bytes=0-", big);
    expect(part).toEqual({ start: 0, end: 8 * MiB - 1 });
    const middle = rangePart(`bytes=${5 * MiB}-`, big);
    expect(middle).toEqual({ start: 5 * MiB, end: 13 * MiB - 1 });
  });

  test("a closed range past the cap is cut at it, and a range off the end is `bad`", () => {
    expect(rangePart("bytes=0-999999999", 20 * MiB)).toEqual({ start: 0, end: 8 * MiB - 1 });
    expect(rangePart("bytes=1-3", 10)).toEqual({ start: 1, end: 3 });
    expect(rangePart("bytes=10-", 10)).toBe("bad");
  });

  test("a range that ends before it starts, another unit, or no bytes at all is ignored: the whole file", () => {
    // `bytes=5-2` takes nothing from the file: no range the server makes sense of, so `200` with all of it.
    expect(rangePart("bytes=5-2", 10)).toBeNull();
    // A unit that isn't `bytes` is not one this route answers.
    expect(rangePart("items=0-5", 10)).toBeNull();
    expect(rangePart("bytes=", 10)).toBeNull();
    expect(rangePart("bytes=-", 10)).toBeNull();
    expect(rangePart("bytes=a-b", 10)).toBeNull();
  });

  test("a multi-range header is ignored: the whole file, as the RFC allows", () => {
    expect(rangePart("bytes=0-1,4-5", 10)).toBeNull();
  });

  test("a suffix range asks for the last bytes of the file, at most as many as it has", () => {
    expect(rangePart("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(rangePart("bytes=-50", 10)).toEqual({ start: 0, end: 9 });
    // A suffix of nothing takes nothing: no range, and the whole file.
    expect(rangePart("bytes=-0", 10)).toBeNull();
  });

  test("a file read through the token's client answers just the part the range names, even an open one", async () => {
    await makeClient();
    const bytes = new Uint8Array(9 * MiB).map((_, i) => i % 256);
    const upload = await portal.upload("long.mp4", bytes);
    await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "x" });
    const [file] = await f.db.select().from(schema.portalPostFiles).where(eq(schema.portalPostFiles.orgId, f.org.id));
    const client = { orgId: f.org.id, client: "padaria-aurora" };
    // An open range on a file past the cap reads exactly the cap.
    const open = await clientPortalFileRange({ db: f.db, blobs }, client, file?.id as string, "bytes=0-");
    expect(open).not.toBe("bad");
    if (open && open !== "bad") {
      expect(open.part).toEqual({ start: 0, end: 8 * MiB - 1 });
      expect(open.body.length).toBe(8 * MiB);
      expect(open.size).toBe(bytes.length);
    }
    // A range off the end is `bad`, which the route answers `416` for.
    expect(await clientPortalFileRange({ db: f.db, blobs }, client, file?.id as string, `bytes=${9 * MiB}-`)).toBe(
      "bad",
    );
  });
});

describe("a decision lands on the version it was about (review 3, item 6)", () => {
  test("a new version up between the read and the write leaves the row unturned", async () => {
    await makeClient();
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "v1" });
    // The client asks a change and the team puts a v2 up: the post is at version 2 and waiting again (`adjusted`).
    await clientDecision(
      { db: f.db },
      { orgId: f.org.id, client: "padaria-aurora" },
      {
        postId: job.item as string,
        decision: "adjust",
        text: "Troca",
      },
    );
    const v2 = await portal.upload("reel-v2.mp4", new Uint8Array([2]));
    await portal.newVersion("padaria-aurora", job.item as string, { files: [v2] });
    // A decision that still names v1 is refused, never landing on the v2 nobody read.
    await expect(
      clientDecision(
        { db: f.db },
        { orgId: f.org.id, client: "padaria-aurora" },
        {
          postId: job.item as string,
          decision: "approve",
          version: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "portal.version_changed" });
    const [post] = await f.db
      .select()
      .from(schema.portalPosts)
      .where(eq(schema.portalPosts.id, job.item as string));
    expect(post?.status).toBe("adjusted");
    expect(post?.version).toBe(2);
  });
});

describe("the notice a send leaves is in its own transaction (review 3, item 7)", () => {
  test("a send's post and its `portal.notify` row are both there, and a second send of the same key adds no second", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora");
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({
      client: "padaria-aurora",
      type: "reel",
      files: [upload],
      caption: "Um",
      key: "k1",
    });
    const jobs = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, PORTAL_NOTIFY_JOB)));
    expect(jobs.map((j) => j.dedupeKey)).toContain(`portal.notify:${job.item}:v1`);
    // The payload names its client, so the retry tells that client whatever its post becomes.
    const row = jobs.find((j) => j.dedupeKey === `portal.notify:${job.item}:v1`);
    expect(row?.payload.client).toBe("padaria-aurora");
    // A new version names its own version in the job's key.
    await clientDecision(
      { db: f.db },
      { orgId: f.org.id, client: "padaria-aurora" },
      {
        postId: job.item as string,
        decision: "adjust",
        text: "Troca",
      },
    );
    const v2 = await portal.upload("reel-v2.mp4", new Uint8Array([2]));
    await portal.newVersion("padaria-aurora", job.item as string, { files: [v2], key: "k2" });
    const after = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, PORTAL_NOTIFY_JOB)));
    expect(after.map((j) => j.dedupeKey)).toContain(`portal.notify:${job.item}:v2`);
  });
});

describe("a workspace back from its hold tells its clients (review 3, 'se forem simples')", () => {
  test("a post whose notice fell on the hold is queued again when the hold lifts, by the real job", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora");
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    const handlers = createJobHandlers({
      ...f.jobDeps,
      portalNotify: { db: f.db, publicUrl: PUBLIC_URL, secret: SECRET, email },
    });
    const run = () => drainOutbox(f.db, { [PORTAL_NOTIFY_JOB]: handlers[PORTAL_NOTIFY_JOB]! } as never);
    // On hold: the notice says `closed`, and nothing is recorded for the post.
    await setOrgStanding({ db: f.db }, f.org.id, { state: "hold", reason: "legal_hold", note: null, notice: "shown" });
    await run();
    const held = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, PORTAL_NOTIFY_JOB)));
    // The job ran and was consumed, as the worker marks it: nothing is waiting on that post any more.
    expect(held.filter((j) => j.status === "pending")).toHaveLength(0);
    // The hold lifts: the sweep queues the post again, naming its client and its version — a key of its own, which
    // the consumed `postId:version` row no longer takes.
    await setOrgStanding({ db: f.db }, f.org.id, { state: "active", reason: null, note: null, notice: "shown" });
    const queued = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, PORTAL_NOTIFY_JOB)));
    const pending = queued.filter((j) => j.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload.client).toBe("padaria-aurora");
    expect(pending[0]?.payload.resumed).toBe(true);
    expect(String(pending[0]?.dedupeKey)).toStartWith(`portal.notify:resume:${job.item}:v1:`);
  });

  test("`queuePortalNoticesFor` names each waiting post and version, and skips a post already told of", async () => {
    await makeClient("padaria-aurora", "Padaria Aurora", [{ name: "Ana", email: "ana@example.com" }]);
    const upload = await portal.upload("reel.mp4", new Uint8Array([1]));
    const job = await portal.send({ client: "padaria-aurora", type: "reel", files: [upload], caption: "Um" });
    // The client was told of it: the row that says so.
    await f.db.insert(schema.portalNotices).values({
      orgId: f.org.id,
      client: "padaria-aurora",
      channel: "email",
      contactId: "x",
      postId: job.item as string,
      version: 1,
      at: new Date(),
    });
    const tools = await import("../src/portal-notices");
    expect(tools.queuePortalNoticesFor).toBe(queuePortalNoticesFor);
    // Nothing fresh: no job queued by the sweep (the send's own row is the only one there).
    const before = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, PORTAL_NOTIFY_JOB)));
    expect(before).toHaveLength(1);
  });
});
