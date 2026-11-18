import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, inArray, isNull, schema } from "@agenteschat/db";
import { DOUG_TEAM_DIR, GENERATED, renderDougTeamFiles } from "../scripts/doug-team-build";
import {
  BRAND_SKILL,
  brandPending,
  DOUG_QGS,
  DOUG_TEAM_SKILLS_JOB,
  DOUG_TEMPLATE,
  type DougSkillItem,
  dougAgents,
  dougQgOf,
  dougSkills,
  getBrand,
  installDougSkills,
  listTeamTemplates,
  parseGithubUrl,
  parseSkillMarkdown,
  RIGHT_HAND,
  rightHandPrompt,
  saveBrand,
  saveOnboarding,
  sayTeamHello,
  TEAM_HELLO_JOB,
  type TeamProposalCard,
  undoTeam,
  updateOrgSettings,
  useDougTeam,
} from "../src";
import { SKILL_FILES } from "../src/doug-team/files.gen";
import { addMember, type Fixture, setup } from "./fixtures";

/*
 * The Doug team (docs/adr/doug-0020-time-doug.md): the house's agents as one template, made at once, with the right
 * hand as its DOUG, a channel per HQ, paused routines, the house skills, the third-party ones by a job, and the brand.
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
const agentsByHandle = async () =>
  new Map(
    (
      await f.db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.orgId, f.org.id), isNull(schema.agents.archivedAt)))
    ).map((a) => [a.handle, a]),
  );
/** A workspace whose owner is still in the onboarding, as one made through the app is. */
const onboarding = () =>
  f.db.update(schema.organizations).set({ onboardedAt: null }).where(eq(schema.organizations.id, f.org.id));

describe("the material", () => {
  test("the generated file is the material as it is now (bun run doug-team:build)", async () => {
    expect(await Bun.file(GENERATED).text()).toBe(renderDougTeamFiles(DOUG_TEAM_DIR));
  });

  test("17 templates, each skill they list is a house skill, every third-party one a GitHub link", () => {
    const all = dougAgents();
    expect(all).toHaveLength(17);
    expect(all[0]?.handle).toBe("doug");
    const house = dougSkills();
    expect(house.size).toBe(Object.keys(SKILL_FILES).length);
    for (const [slug, text] of Object.entries(SKILL_FILES)) expect(parseSkillMarkdown(text).name).toBe(slug);
    for (const a of all) {
      expect({ handle: a.handle, missing: a.skills.filter((s) => !house.has(s)) }).toEqual({
        handle: a.handle,
        missing: [],
      });
      expect(a.instructions.length).toBeGreaterThan(500);
      expect(a.routines.every((r) => r.paused && r.cron.split(" ").length === 5)).toBe(true);
      for (const s of a.thirdPartySkills) {
        expect(() => parseGithubUrl(s.source)).not.toThrow();
        expect(s.license).not.toBe("");
      }
    }
    // Every HQ has someone; the QG de Tráfego's team reports to its MARK.
    expect(new Set(all.flatMap((a) => dougQgOf(a) ?? []))).toEqual(new Set(DOUG_QGS));
    expect(all.filter((a) => a.reportsTo === "mark").map((a) => dougQgOf(a))).toEqual(Array(9).fill("trafego"));
  });
});

describe("the gallery", () => {
  test("the Doug team comes first, every agent listed and checked, in a team's workspace and a personal one", async () => {
    f = await setup({ rightHand: true });
    const list = await listTeamTemplates({ db: f.db }, f.owner.id, f.org.id, "pt-BR");
    const doug = list[0];
    expect(doug?.id).toBe(DOUG_TEMPLATE);
    if (!doug || !("members" in doug)) throw new Error("no Doug team");
    expect(doug.name).toBe("Time Doug");
    expect(doug.members).toHaveLength(17);
    expect(doug.members.filter((m) => m.rightHand).map((m) => m.handle)).toEqual(["doug"]);
    expect(doug.members.find((m) => m.handle === "rosa")).toMatchObject({ qg: "design", channel: "qg-design" });
    expect(doug.needsComputer).toEqual(expect.arrayContaining(["rosa", "sony", "junin", "kiara"]));
    // The card's team: every agent but the right hand, past the team card's limit of six.
    expect(doug.team.agents).toHaveLength(16);
    expect(doug.team.newChannels.sort()).toEqual(
      ["qg-codigo", "qg-design", "qg-estrategia", "qg-financeiro", "qg-social", "qg-trafego", "qg-video"].sort(),
    );
    const en = await listTeamTemplates({ db: f.db }, f.owner.id, f.org.id, "en");
    expect(en[0]?.name).toBe("Doug Team");
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { mode: "personal" });
    expect((await listTeamTemplates({ db: f.db }, f.owner.id, f.org.id, "pt-BR"))[0]?.id).toBe(DOUG_TEMPLATE);
  });
});

describe("making it", () => {
  test("everyone: 16 agents, the right hand as the DOUG, a channel per HQ, reports to the MARK, routines paused", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { locale: "pt-BR" });
    expect(made).toMatchObject({ state: "created", error: null });
    const card = await cardOf(made.messageId);
    expect(card.params.template).toBe(DOUG_TEMPLATE);
    expect(card.created?.agentIds).toHaveLength(16);
    expect(card.created?.rightHandRole).toBe(true);

    const agents = await agentsByHandle();
    // One right hand, no second DOUG.
    const builtin = [...agents.values()].filter((a) => a.builtin === RIGHT_HAND);
    expect(builtin).toHaveLength(1);
    expect([...agents.keys()].filter((h) => h.startsWith("doug"))).toEqual([builtin[0]?.handle ?? ""]);
    const rosa = agents.get("rosa");
    expect(rosa?.instructions).toContain("ROSA");

    // A channel per HQ, each agent in its own.
    const channels = await f.db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.orgId, f.org.id), inArray(schema.channels.id, card.created?.channelIds ?? [])));
    expect(channels.map((c) => c.name).sort()).toEqual(
      ["qg-codigo", "qg-design", "qg-estrategia", "qg-financeiro", "qg-social", "qg-trafego", "qg-video"].sort(),
    );
    const seats = await f.db
      .select({ channelId: schema.channelMembers.channelId, agentId: schema.channelMembers.agentId })
      .from(schema.channelMembers)
      .where(inArray(schema.channelMembers.channelId, card.created?.channelIds ?? []));
    const channelOf = (handle: string) =>
      channels.find((c) => seats.some((s) => s.channelId === c.id && s.agentId === agents.get(handle)?.id))?.name;
    expect(channelOf("rosa")).toBe("qg-design");
    expect(channelOf("operador")).toBe("qg-trafego");
    expect(channelOf("kiara")).toBe("qg-financeiro");

    // The QG de Tráfego's nine report to the MARK.
    const mark = agents.get("mark");
    const team = [...agents.values()].filter((a) => a.reportsToAgentId === mark?.id).map((a) => a.handle);
    expect(team.sort()).toEqual(
      dougAgents()
        .filter((t) => t.reportsTo === "mark")
        .map((t) => t.handle)
        .sort(),
    );

    // Every routine made, none active (the right hand's too).
    const routines = await f.db
      .select()
      .from(schema.routines)
      .where(inArray(schema.routines.id, card.created?.routineIds ?? []));
    const expected = dougAgents().reduce((n, t) => n + t.routines.length, 0);
    expect(routines).toHaveLength(expected);
    expect(routines.every((r) => r.active === false)).toBe(true);
    expect(routines.some((r) => r.agentId === builtin[0]?.id)).toBe(true);

    // The house skills, the workspace's, each given to who lists it.
    const given = await f.db
      .select({ slug: schema.skills.slug, agentId: schema.agentSkills.agentId })
      .from(schema.agentSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.agentSkills.skillId))
      .where(eq(schema.skills.orgId, f.org.id));
    const has = (handle: string, slug: string) =>
      given.some((g) => g.slug === slug && g.agentId === agents.get(handle)?.id);
    expect(has("operador", "qg-trafego-operador")).toBe(true);
    expect(has("operador", "qg-trafego-manual")).toBe(true);
    expect(has("rosa", "qg-trafego-manual")).toBe(false);
    expect(given.some((g) => g.slug === "agendar-reunioes" && g.agentId === builtin[0]?.id)).toBe(true);

    // The third-party ones wait for a job, one per folder, with no network now.
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    expect(jobs.length).toBeGreaterThan(0);
    const items = jobs.flatMap((j) => j.payload.items as DougSkillItem[]);
    const chessSkills = dougAgents().find((t) => t.handle === "chess")?.thirdPartySkills ?? [];
    expect(items.filter((i) => i.agentIds.includes(agents.get("chess")?.id ?? "")).length).toBe(chessSkills.length);
    // Fewer downloads than skills: a folder's skills come from one read.
    expect(jobs.length).toBeLessThan(items.length);

    // Who works on a computer, for the notice.
    expect(made.needsComputer.map((c) => c.handle).sort()).toEqual(
      dougAgents()
        .filter((t) => t.needsComputer && t.handle !== "doug")
        .map((t) => t.handle)
        .sort(),
    );
    // The right hand reads the DOUG's role.
    const prompt = await rightHandPrompt(
      { db: f.db },
      {
        orgId: f.org.id,
        agent: { id: builtin[0]?.id ?? "", name: "Doug", handle: "doug" },
        personId: f.owner.id,
        inDm: true,
      },
    );
    expect(prompt).toContain("# Your role in this workspace");
    expect(prompt).toContain("gerente da operação");

    // Made once.
    await expect(useDougTeam(deps(), f.owner.id, f.org.id, {})).rejects.toMatchObject({ code: "doug_team.made" });
  });

  test("the choice is kept: only those checked, their HQs' channels, and no role for the right hand", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, {
      handles: ["rosa", "mark", "operador"],
      locale: "en",
    });
    expect(made.state).toBe("created");
    const card = await cardOf(made.messageId);
    expect(card.params.agents.map((a) => a.handle)).toEqual(["rosa", "mark", "operador"]);
    expect(card.params.newChannels.sort()).toEqual(["hq-ads", "hq-design"]);
    expect(card.created?.rightHandRole).toBe(false);
    const agents = await agentsByHandle();
    expect(agents.has("sony")).toBe(false);
    expect(agents.get("operador")?.reportsToAgentId).toBe(agents.get("mark")?.id ?? "");
    const prompt = await rightHandPrompt(
      { db: f.db },
      {
        orgId: f.org.id,
        agent: { id: agents.get("mark")?.id ?? "", name: "Doug", handle: "doug" },
        personId: f.owner.id,
        inDm: true,
      },
    );
    expect(prompt).not.toContain("# Your role in this workspace");
    await expect(useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["nobody"] })).rejects.toMatchObject({
      code: "doug_team.unknown",
    });
  });

  test("a taken handle gets the next free one; a member without admin rights gets the agents but not the skills", async () => {
    f = await setup({ rightHand: true });
    const member = await addMember(f.db, f.org.id, "member", "bia");
    const made = await useDougTeam(deps(), member.id, f.org.id, { handles: ["sony", "kiara"] });
    expect(made.state).toBe("created");
    const card = await cardOf(made.messageId);
    expect(card.created?.skipped).toContain("skills");
    expect(card.created?.skillIds).toEqual([]);
    expect(await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB))).toEqual([]);
  });

  test("Desfazer takes it all back: agents and channels archived, routines and skills gone, the DOUG's role off", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["doug", "rosa", "junin"] });
    const card = await cardOf(made.messageId);
    await undoTeam(deps(), f.owner.id, f.org.id, made.messageId);
    expect((await cardOf(made.messageId)).state).toBe("undone");
    const agents = await f.db
      .select()
      .from(schema.agents)
      .where(inArray(schema.agents.id, card.created?.agentIds ?? []));
    expect(agents.every((a) => a.archivedAt !== null)).toBe(true);
    const channels = await f.db
      .select()
      .from(schema.channels)
      .where(inArray(schema.channels.id, card.created?.channelIds ?? []));
    expect(channels.every((c) => c.archivedAt !== null)).toBe(true);
    const routines = await f.db
      .select()
      .from(schema.routines)
      .where(inArray(schema.routines.id, card.created?.routineIds ?? []));
    expect(routines.length).toBeGreaterThan(0);
    expect(routines.every((r) => r.deletedAt !== null)).toBe(true);
    const skills = await f.db
      .select()
      .from(schema.skills)
      .where(inArray(schema.skills.id, card.created?.skillIds ?? []));
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every((s) => s.deletedAt !== null)).toBe(true);
    const [settings] = await f.db
      .select({ dougTeam: schema.organizationSettings.dougTeam })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.orgId, f.org.id));
    expect(settings?.dougTeam ?? null).toBeNull();
    // The job of an undone team installs nothing.
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    if (!job) throw new Error("no job");
    const out = await installDougSkills(
      { db: f.db, blobs: f.artifactDeps.blobs, fetch: () => Promise.reject(new Error("no network in tests")) },
      f.org.id,
      job.payload,
    );
    expect(out).toEqual({ installed: [], given: [], failed: [] });
  });

  test("the skills job: a network failure throws for the outbox to try again; a skill already here is only given", async () => {
    f = await setup({ rightHand: true });
    const made = await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["humanizador"] });
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, DOUG_TEAM_SKILLS_JOB));
    if (!job) throw new Error("no job");
    const skillDeps = {
      db: f.db,
      blobs: f.artifactDeps.blobs,
      fetch: () => Promise.reject(new Error("no network in tests")),
      resolveHost: async () => ["140.82.112.3"],
    };
    await expect(installDougSkills(skillDeps, f.org.id, job.payload)).rejects.toThrow();
    // Already in the workspace: no download, given to the agent.
    const [humanizer] = await f.db
      .insert(schema.skills)
      .values({ orgId: f.org.id, slug: "humanizer", name: "humanizer", description: "d", body: "b", source: "manual" })
      .returning();
    const out = await installDougSkills(skillDeps, f.org.id, job.payload);
    expect(out).toEqual({ installed: [], given: ["humanizer"], failed: [] });
    const agent = (await agentsByHandle()).get("humanizador");
    const [given] = await f.db
      .select()
      .from(schema.agentSkills)
      .where(and(eq(schema.agentSkills.agentId, agent?.id ?? ""), eq(schema.agentSkills.skillId, humanizer?.id ?? "")));
    expect(given?.enabled).toBe(true);
    expect(made.state).toBe("created");
  });
});

describe("the hello", () => {
  test("the right hand, then each agent with its own line, in #general", async () => {
    f = await setup({ rightHand: true });
    await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["rosa", "sony"], locale: "pt-BR" });
    const [first] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, TEAM_HELLO_JOB));
    if (!first) throw new Error("no hello");
    await sayTeamHello({ db: f.db }, f.org.id, first.payload);
    const each = (await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, TEAM_HELLO_JOB))).filter(
      (j) => typeof j.payload.agentId === "string",
    );
    expect(each).toHaveLength(3);
    for (const j of each) await sayTeamHello({ db: f.db }, f.org.id, j.payload);
    const said = await f.db
      .select({ body: schema.messages.body })
      .from(schema.messages)
      .where(eq(schema.messages.channelId, f.general.id));
    const bodies = said.map((m) => m.body);
    expect(bodies).toContain("Oi. Capas, carrosséis e posts ficam comigo, sempre na identidade da marca.");
    expect(bodies).toContain("Oi. Me mande o bruto que eu devolvo o vídeo editado.");
  });
});

describe("the brand", () => {
  test("pending after the Doug team in the onboarding; saved as the skill Marca <empresa>, given to its readers", async () => {
    f = await setup({ rightHand: true });
    await onboarding();
    expect(await brandPending(f.db, f.org.id)).toBe(false);
    await useDougTeam(deps(), f.owner.id, f.org.id, { handles: ["rosa", "sony", "chess", "social-media", "kiara"] });
    expect(await brandPending(f.db, f.org.id)).toBe(true);
    await expect(saveOnboarding(f.db, f.owner.id, f.org.id, { finished: true })).rejects.toMatchObject({
      code: "onboarding.brand_pending",
    });
    await expect(saveBrand(deps(), f.owner.id, f.org.id, { company: "Acme", tones: [] })).rejects.toMatchObject({
      code: "brand.tone_required",
    });
    await expect(saveBrand(deps(), f.owner.id, f.org.id, { company: " ", tones: ["direto"] })).rejects.toMatchObject({
      code: "brand.company_required",
    });
    const saved = await saveBrand(deps(), f.owner.id, f.org.id, {
      company: "Acme",
      tones: ["proximo", "direto"],
      tone: "Fala como gente, sem jargão.",
      site: "acme.com.br",
      instagram: "https://www.instagram.com/acme.oficial/",
      audience: "Donos de pequenas lojas",
      links: ["drive.google.com/manual"],
    });
    expect(saved.pending).toBe(false);
    expect(saved.brand).toMatchObject({ site: "https://acme.com.br/", instagram: "@acme.oficial" });
    const [skill] = await f.db
      .select()
      .from(schema.skills)
      .where(and(eq(schema.skills.orgId, f.org.id), eq(schema.skills.slug, BRAND_SKILL)));
    expect(skill?.metadata.title).toBe("Marca Acme");
    // Every section the agents that read a brand look for (ROSA, SONY, SOCIAL MEDIA, CHESS).
    for (const section of [
      "# Marca Acme",
      "## Público",
      "## Tom de voz",
      "## Identidade visual",
      "## Vídeo: som, trilha e níveis",
      "## Redes e formatos",
      "## Pilares de conteúdo",
      "## Compliance e o que não citar",
      "## Manual de marca",
    ])
      expect(skill?.body).toContain(section);
    expect(skill?.body).toContain("próximo, direto");
    const agents = await agentsByHandle();
    const readers = (
      await f.db
        .select()
        .from(schema.agentSkills)
        .where(eq(schema.agentSkills.skillId, skill?.id ?? ""))
    ).map((r) => r.agentId);
    expect(readers.sort()).toEqual(
      ["rosa", "sony", "chess", "social-media"].map((h) => agents.get(h)?.id ?? "").sort(),
    );
    expect(await saveOnboarding(f.db, f.owner.id, f.org.id, { finished: true })).toMatchObject({ finished: true });
    // Read back for the step, and saved again as a new version.
    expect((await getBrand(f.db, f.owner.id, f.org.id, "en")).brand?.company).toBe("Acme");
    await saveBrand(deps(), f.owner.id, f.org.id, { company: "Acme Lojas", tone: "Sério" });
    const [again] = await f.db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skill?.id ?? ""));
    expect(again?.version).toBe((skill?.version ?? 0) + 1);
    expect(again?.metadata.title).toBe("Marca Acme Lojas");
  });
});
