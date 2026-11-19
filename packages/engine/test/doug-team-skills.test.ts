import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, inArray, schema } from "@dougbot/db";
import {
  DOUG_TEAM_SKILLS_JOB,
  type DougSkillItem,
  DougTeamNotReady,
  installDougSkills,
  type TeamProposalCard,
  undoTeam,
  useDougTeam,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/*
 * The Doug team's third-party skills (docs/adr/doug-0030-time-doug.md): installed after the card is created by a job,
 * marked as the card's, their license kept, updates off; a failure halfway is taken up by the next try and Desfazer
 * takes all of it back.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const deps = () => ({ db: f.db, pubsub: f.pubsub });
const cardOf = async (id: string) => {
  const [m] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, id));
  return m?.meta.actionCard as TeamProposalCard;
};
const skillBySlug = async (slug: string) => {
  const [row] = await f.db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.orgId, f.org.id), eq(schema.skills.slug, slug)));
  return row;
};

/** A minimal zip writer (stored entries): a repository's archive as git archive writes it. */
function zip(files: Record<string, string>) {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = enc.encode(text);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Fake GitHub for `acme/skills` at a pinned commit `abc123`: a folder link redirects to codeload, which sends the
 * archive; a raw link reads a file. `down`: the archive throws (a network failure), so the job throws too. Every
 * repository's archive is the same one folder (`skills-abc/skills/...`): the job's links are rewritten to `acme/skills`
 * at that commit by `asTheRepo`.
 */
function fakeGithub(files: Record<string, string>, options: { down?: boolean } = {}) {
  const ref = "abc123";
  const fetched: string[] = [];
  const archive = zip(files);
  const fetch = async (url: string) => {
    fetched.push(url);
    if (options.down) throw new TypeError("fetch failed");
    if (/^https:\/\/github\.com\/acme\/skills\/archive\/abc123\.zip$/.test(url))
      return new Response(null, {
        status: 302,
        headers: { location: `https://codeload.github.com/acme/skills/zip/${ref}` },
      });
    if (/^https:\/\/codeload\.github\.com\/acme\/skills\/zip\/(refs\/heads\/main|abc123)$/.test(url))
      return new Response(archive);
    const raw = /^https:\/\/raw\.githubusercontent\.com\/acme\/skills\/([^/]+)\/(.+)$/.exec(url);
    if (raw) {
      const text = files[`skills-abc/${raw[2]}`];
      if (text === undefined) return new Response("404", { status: 404 });
      return new Response(text);
    }
    return new Response("404: Not Found", { status: 404 });
  };
  return { fetch, fetched };
}

/** A job's links rewritten to the fake repository, its folder kept: one folder's skills read once. */
function asTheRepo(payload: Record<string, unknown>) {
  const items = (payload.items as DougSkillItem[]).map((i) => ({
    ...i,
    dir: `skills/${i.dir.split("/").pop()}`,
    source: `https://github.com/acme/skills/tree/abc123/skills/${i.dir.split("/").pop()}`,
  }));
  return { ...payload, url: "https://github.com/acme/skills/tree/abc123/skills", items };
}

const skillDeps = (fetch: (url: string, init?: RequestInit) => Promise<Response>) => ({
  db: f.db,
  blobs: f.artifactDeps.blobs,
  fetch,
  resolveHost: async () => ["140.82.112.3"],
});

/** The fake repository's files: one skill per listed item, at the folder the job names it by. */
function repoOf(items: DougSkillItem[]) {
  const files: Record<string, string> = {};
  for (const i of items) {
    // The skill's name is what its SKILL.md says, which the item names by `slug`; its folder is `dir`'s last part.
    const folder = i.dir.split("/").pop() ?? i.slug;
    files[`skills-abc/skills/${folder}/SKILL.md`] =
      `---\nname: ${i.slug}\ndescription: Uma skill do time.\n---\n# ${i.slug}`;
  }
  return files;
}

describe("the skills job", () => {
  test("a card still being made throws (the outbox reads it again); undone installs nothing", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["junin"] });
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    if (!job) throw new Error("no job");
    const gh = fakeGithub(repoOf(job.payload.items as DougSkillItem[]));
    const [before] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, made.messageId));
    const card = await cardOf(made.messageId);
    // Still `creating`: the job throws, so the outbox reads the card again rather than give up.
    await f.db
      .update(schema.messages)
      .set({ meta: { ...before?.meta, actionCard: { ...card, state: "creating" } } })
      .where(eq(schema.messages.id, made.messageId));
    await expect(installDougSkills(skillDeps(gh.fetch), f.org.id, job.payload)).rejects.toBeInstanceOf(
      DougTeamNotReady,
    );
    expect(gh.fetched).toEqual([]);
    // Undone: installs nothing either, without throwing.
    await f.db
      .update(schema.messages)
      .set({ meta: { ...before?.meta, actionCard: { ...card, state: "undone" } } })
      .where(eq(schema.messages.id, made.messageId));
    expect(await installDougSkills(skillDeps(gh.fetch), f.org.id, job.payload)).toEqual({
      installed: [],
      given: [],
      failed: [],
    });
    expect(gh.fetched).toEqual([]);
  });

  test("happy path: installs, gives to the agents, keeps the license, leaves updates off, marks for Desfazer", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["junin"] });
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    const items = jobs.flatMap((j) => j.payload.items as DougSkillItem[]);
    const gh = fakeGithub(repoOf(items));
    const seen: { installed: string[]; given: string[]; failed: unknown[] }[] = [];
    for (const job of jobs) seen.push(await installDougSkills(skillDeps(gh.fetch), f.org.id, asTheRepo(job.payload)));
    const installed = seen.flatMap((o) => o.installed);
    // Every third-party skill JUNIN lists, from its pinned folder, installed once.
    expect(new Set(installed).size).toBe(items.length);
    const card = await cardOf(made.messageId);
    // Each made skill is on the card's list (Desfazer takes it back) and marked as the card's, with its license.
    expect(card.created?.skillIds).toHaveLength(items.length);
    for (const item of items) {
      const row = await skillBySlug(item.slug);
      expect(row?.metadata).toMatchObject({ dougTeam: made.messageId, license: item.license });
      expect(row?.autoUpdate).toBe(false);
      expect(card.created?.skillIds).toContain(row?.id ?? "");
    }
    // Given to JUNIN.
    const [junin] = await f.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, f.org.id), eq(schema.agents.handle, "junin")));
    const given = await f.db
      .select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, junin?.id ?? ""));
    expect(given).toHaveLength(items.length);
    // Desfazer removes what the job made.
    await undoTeam(deps(), f.owner.id, f.org.id, made.messageId);
    for (const item of items) expect((await skillBySlug(item.slug))?.deletedAt).not.toBeNull();
  });

  test("a skill a person installed before is only given: Desfazer takes it back not, its `metadata` untouched", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["humanizador"] });
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    if (!job) throw new Error("no job");
    const items = job.payload.items as DougSkillItem[];
    const humanizer = items.find((i) => i.slug === "humanizer");
    if (!humanizer) throw new Error("no humanizer");
    // The person installed `humanizer` before the team, from the very same link, with their own metadata.
    const keptMeta = { title: "Humanizer", notes: "a pessoa escreveu isto" };
    const [before] = await f.db
      .insert(schema.skills)
      .values({
        orgId: f.org.id,
        slug: "humanizer",
        name: "humanizer",
        description: "Deixa a copy com cara de gente.",
        body: "# humanizer",
        source: "url",
        sourceUrl: humanizer.source,
        metadata: keptMeta,
        // Before the card: the job's own installs come after it (`createdAt` past the card).
        createdAt: new Date(Date.now() - 3600_000),
      })
      .returning();
    const gh = fakeGithub(repoOf(items));
    // The job gives it to JUNIN and marks nothing: it is the person's, not the card's.
    const out = await installDougSkills(skillDeps(gh.fetch), f.org.id, asTheRepo(job.payload));
    expect(out.given).toContain("humanizer");
    expect(out.installed).toEqual([]);
    const [after] = await f.db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, before?.id ?? ""));
    expect(after?.metadata).toEqual(keptMeta);
    expect(after?.deletedAt).toBeNull();
    // The receipt counts none of it (the house skills the team made are its own; the person's `humanizer` isn't).
    expect((await cardOf(made.messageId)).created?.skillIds ?? []).not.toContain(before?.id ?? "");
    // Desfazer takes the team back, and the person's skill stays as it was, given to no one it isn't theirs to keep.
    await undoTeam(deps(), f.owner.id, f.org.id, made.messageId);
    const [still] = await f.db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, before?.id ?? ""));
    expect(still?.deletedAt).toBeNull();
    expect(still?.metadata).toEqual(keptMeta);
  });

  test("Desfazer during the job: a card undone after it was read takes back what that try installed", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["humanizador"] });
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    if (!job) throw new Error("no job");
    const items = job.payload.items as DougSkillItem[];
    const gh = fakeGithub(repoOf(items));
    // The download is slow: the job reads the card as created, installs, and only then sees it undone. The fake
    // fetch, standing for the slow download, undoes the card on the first request — after the job's read.
    let undone = false;
    const slow = async (url: string) => {
      if (!undone) {
        undone = true;
        await undoTeam(deps(), f.owner.id, f.org.id, made.messageId);
      }
      return gh.fetch(url);
    };
    const out = await installDougSkills(skillDeps(slow), f.org.id, asTheRepo(job.payload));
    // The try installed them and was told nothing: the card is undone, so they are gone, with their deliveries.
    expect(out.installed.length).toBe(items.length);
    for (const item of items) {
      const row = await skillBySlug(item.slug);
      expect(row?.deletedAt).not.toBeNull();
    }
    const [humanizador] = await f.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, f.org.id), eq(schema.agents.handle, "humanizador")));
    // None of the job's skills is left given to it, nor any row of them.
    const jobSkillIds = (await f.db.select().from(schema.skills).where(eq(schema.skills.orgId, f.org.id)))
      .filter((s) => items.some((i) => i.slug === s.slug))
      .map((s) => s.id);
    const given = await f.db
      .select()
      .from(schema.agentSkills)
      .where(
        and(eq(schema.agentSkills.agentId, humanizador?.id ?? ""), inArray(schema.agentSkills.skillId, jobSkillIds)),
      );
    expect(given).toEqual([]);
    // Nor is any of it on the card's list: an undone card keeps none.
    const listed = (await cardOf(made.messageId)).created?.skillIds ?? [];
    expect(listed.filter((id) => jobSkillIds.includes(id))).toEqual([]);
  });

  test("a folder that names another skill than the one asked for is refused (`skill.name_mismatch`)", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["junin"] });
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    if (!job) throw new Error("no job");
    const items = job.payload.items as DougSkillItem[];
    // Upstream renamed the skill: its folder is the same, its SKILL.md says another name.
    const renamed = items.map((i) => ({ ...i, slug: `${i.slug}-renamed` }));
    const gh = fakeGithub(repoOf(renamed));
    const out = await installDougSkills(skillDeps(gh.fetch), f.org.id, asTheRepo(job.payload));
    expect(out.installed).toEqual([]);
    expect(out.given).toEqual([]);
    // Each is on the receipt with the code, and none is in the workspace.
    expect(out.failed.map((x) => x.code)).toEqual(items.map(() => "skill.name_mismatch"));
    expect(out.failed.map((x) => x.slug).sort()).toEqual(items.map((i) => i.slug).sort());
    const rows = await f.db.select().from(schema.skills).where(eq(schema.skills.orgId, f.org.id));
    for (const item of items) expect(rows.some((r) => r.slug === item.slug)).toBe(false);
    const card = await cardOf(made.messageId);
    expect(card.created?.failedSkills?.map((x) => x.code)).toEqual(items.map(() => "skill.name_mismatch"));
  });

  test("a failure halfway: the next try takes up where it stopped, and Desfazer takes all of it back", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["junin"] });
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    const items = jobs.flatMap((j) => j.payload.items as DougSkillItem[]);
    // The first try reaches GitHub and fails (a network failure): nothing installed, the outbox tries again later.
    await expect(
      installDougSkills(
        skillDeps(fakeGithub(repoOf(items), { down: true }).fetch),
        f.org.id,
        asTheRepo(jobs[0]?.payload ?? {}),
      ),
    ).rejects.toThrow();
    expect(await f.db.select().from(schema.skills).where(eq(schema.skills.orgId, f.org.id))).toEqual([]);
    // A repeat installs none of the skills already here; it takes up where it stopped.
    const gh = fakeGithub(repoOf(items));
    for (const job of jobs) await installDougSkills(skillDeps(gh.fetch), f.org.id, asTheRepo(job.payload));
    // Every listed skill is the card's now; a repeat is a no-op for what it already made.
    const before = (await cardOf(made.messageId)).created?.skillIds ?? [];
    for (const job of jobs) await installDougSkills(skillDeps(gh.fetch), f.org.id, asTheRepo(job.payload));
    const after = (await cardOf(made.messageId)).created?.skillIds ?? [];
    expect(after).toEqual(before);
    expect(new Set(after).size).toBe(items.length);
    await undoTeam(deps(), f.owner.id, f.org.id, made.messageId);
    const live = await f.db
      .select()
      .from(schema.skills)
      .where(and(eq(schema.skills.orgId, f.org.id), inArray(schema.skills.id, after)));
    expect(live.every((s) => s.deletedAt !== null)).toBe(true);
  });
});
