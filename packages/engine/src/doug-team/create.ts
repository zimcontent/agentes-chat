import { holdEvents } from "@dougbot/adapters";
import { and, type Database, eq, inArray, isNull, schema, sql } from "@dougbot/db";
import { serverText } from "@dougbot/i18n";
import type { AppLocale } from "@dougbot/i18n/locale";
import { checkRoutine, giveApps, type ProposedRoutine, suggestAgentAi } from "../agent-proposals";
import { type Agent, createAgent, freeHandle, NEW_AGENT_DEFAULTS, takenHandles } from "../agents";
import { recordAudit } from "../audit";
import { setAgentBrain } from "../brain-settings";
import { invalidateOrg } from "../cache";
import { addChannelMember, CHANNEL_NAME_PATTERN, createChannel, joinChannel, unarchiveChannel } from "../channels";
import type { ContextDeps } from "../context/summaries";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { publishAgentsChanged, publishMessageCreated } from "../events";
import { setAgentComputerTarget } from "../machines";
import { getMessage, messageView } from "../messages";
import { can, requirePermission } from "../organizations";
import { enqueue } from "../outbox";
import { personLocale } from "../requester";
import { createRoutine, deleteRoutine } from "../routines";
import { parseGithubUrl } from "../skills";
import { billingHold, TEAM_HELLO_JOB } from "../standing";
import {
  blockedError,
  channelPlaces,
  postTeamCard,
  rightHandDm,
  StepError,
  stepped,
  type TeamAgent,
  type TeamCreated,
  type TeamDeps,
  type TeamParams,
  type TeamProposalCard,
  teamFailure,
  writeCard,
} from "../team-proposals";
import { isPersonalWorkspace } from "../workspace-mode";
import { brandPending, giveBrandToReaders } from "./brand";
import {
  DOUG_QGS,
  DOUG_RIGHT_HAND,
  DOUG_TEMPLATE,
  type DougAgentTemplate,
  type DougQg,
  dougAgents,
  dougKey,
  dougQgOf,
  dougSkills,
} from "./index";

const { agents, agentSkills, messages, organizationSettings, organizations, routines: routineRows, skills } = schema;

/** `doug_team.skills`: a group of a template's third-party skills installed from their public links, after the team. */
export const DOUG_TEAM_SKILLS_JOB = "doug_team.skills";

/** A third-party skill the job installs, and the agents it goes to. */
export interface DougSkillItem {
  slug: string;
  source: string;
  license: string;
  /** Its folder in the repository (`skills/ab-testing`), empty for a repository that is the skill. */
  dir: string;
  agentIds: string[];
}

/** One agent of the template as the gallery lists it, checked by default. */
export interface DougTemplateMember {
  handle: string;
  name: string;
  role: string;
  line: string;
  /** Its QG, null for the right hand. */
  qg: DougQg | null;
  /** The channel it would live in, null for the right hand. */
  channel: string | null;
  /** The template it reports to (`mark`), or null. */
  reportsTo: string | null;
  needsComputer: boolean;
  /** The right hand takes this one's role: no agent is made for it. */
  rightHand: boolean;
  /** Its routines, all made paused. */
  routines: number;
  /** House skills and third-party skills it gets. */
  skills: number;
}

/** The gallery's Doug team: the card it would make, and every agent to check or uncheck. */
export interface DougTemplateView {
  id: typeof DOUG_TEMPLATE;
  name: string;
  sub: string;
  description: string;
  team: TeamParams;
  members: DougTemplateMember[];
  /** Handles of the agents that work on a computer: the app warns and offers to connect one. */
  needsComputer: string[];
}

/** A channel name in one language, or its English one where that language's isn't a valid name. */
const channelName = (locale: AppLocale, qg: DougQg) => {
  const key = `dougTeam.channels.${qg}`;
  const name = serverText(locale, key);
  return CHANNEL_NAME_PATTERN.test(name) ? name : serverText("en", key);
};

/** Who is made: the templates of `handles`, all of them when absent. Unknown handles are refused. */
function chosenTemplates(handles: readonly string[] | null | undefined) {
  const all = dougAgents();
  if (!handles) return all;
  const known = new Set(all.map((t) => t.handle));
  const strangers = handles.filter((h) => !known.has(h));
  if (strangers.length > 0) {
    throw new ValidationError(`The Doug team has no ${strangers.map((h) => `@${h}`).join(", ")}`, "doug_team.unknown", {
      handles: strangers,
    });
  }
  const picked = new Set(handles);
  const out = all.filter((t) => picked.has(t.handle));
  if (out.length === 0) throw new ValidationError("Pick at least one agent", "doug_team.none");
  return out;
}

async function orgName(db: Database, orgId: string) {
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  return org?.name ?? "";
}

/**
 * The card's team in `locale`: each chosen agent but the right hand with a free handle (`rosa-2` when ROSA's is taken)
 * and its QG's channel (`qg-design-2` when #qg-design is a private channel this person isn't in), its routines read in
 * the person's time zone. The card keeps no instructions or skill bodies: they come from the material when it is made.
 */
async function dougParams(
  deps: { db: Database; context?: ContextDeps },
  at: { orgId: string; channelId: string; personId: string },
  chosen: readonly DougAgentTemplate[],
  locale: AppLocale,
  personal = false,
) {
  const [org, taken] = await Promise.all([orgName(deps.db, at.orgId), takenHandles(deps.db, at.orgId)]);
  const t = (key: string) => serverText(locale, key, { org });
  // A personal workspace makes no channel: its agents live in their DM with the person (ADR 0159), and the routines
  // report there too (docs/adr/doug-0030-time-doug.md §8).
  if (personal) {
    const handles = new Map<string, string>();
    for (const a of chosen) {
      if (a.handle === DOUG_RIGHT_HAND) continue;
      const handle = taken.has(a.handle) ? freeHandle(a.handle, taken) : a.handle;
      taken.add(handle);
      handles.set(a.handle, handle);
    }
    const team: TeamAgent[] = [];
    const routines = new Map<string, ProposedRoutine[]>();
    for (const a of chosen) {
      const read: ProposedRoutine[] = [];
      for (const r of a.routines)
        read.push(await checkRoutine(deps, at, { schedule: r.cron, prompt: r.prompt, title: r.name }));
      routines.set(a.handle, read);
      if (a.handle === DOUG_RIGHT_HAND) continue;
      team.push({
        name: a.name,
        handle: handles.get(a.handle) as string,
        role: t(`dougTeam.agents.${dougKey(a.handle)}.role`),
        line: t(`dougTeam.agents.${dougKey(a.handle)}.line`),
        instructions: t(`dougTeam.agents.${dougKey(a.handle)}.line`),
        appearance: null,
        channel: "",
        routines: read,
        firstTask: null,
      });
    }
    const params: TeamParams = {
      lead: t("dougTeam.lead"),
      agents: team,
      newChannels: [],
      skills: [],
      weekly: null,
      approvals: t("dougTeam.approvals"),
      invite: [],
      template: DOUG_TEMPLATE,
    };
    return { params, handles, routines, channelOf: new Map<DougQg, string>() };
  }
  const qgs = DOUG_QGS.filter((q) => chosen.some((a) => dougQgOf(a) === q));
  const { blocked } = await channelPlaces(
    deps.db,
    at.orgId,
    at.personId,
    qgs.map((q) => channelName(locale, q)),
  );
  const blockedSet = new Set(blocked);
  const channelOf = new Map(
    qgs.map((q) => {
      const base = channelName(locale, q);
      let name = base;
      for (let n = 2; blockedSet.has(name); n++) name = `${base}-${n}`;
      return [q, name] as const;
    }),
  );
  if (blocked.length > 0) {
    // A `-2` name may itself be blocked: what is left is refused, as on any team card.
    const again = await channelPlaces(deps.db, at.orgId, at.personId, [...channelOf.values()]);
    if (again.blocked.length > 0) throw blockedError(again.blocked);
  }
  const handles = new Map<string, string>();
  for (const a of chosen) {
    if (a.handle === DOUG_RIGHT_HAND) continue;
    const handle = taken.has(a.handle) ? freeHandle(a.handle, taken) : a.handle;
    taken.add(handle);
    handles.set(a.handle, handle);
  }
  const team: TeamAgent[] = [];
  const routines = new Map<string, ProposedRoutine[]>();
  for (const a of chosen) {
    const read: ProposedRoutine[] = [];
    for (const r of a.routines)
      read.push(await checkRoutine(deps, at, { schedule: r.cron, prompt: r.prompt, title: r.name }));
    routines.set(a.handle, read);
    if (a.handle === DOUG_RIGHT_HAND) continue;
    const qg = dougQgOf(a);
    team.push({
      name: a.name,
      handle: handles.get(a.handle) as string,
      role: t(`dougTeam.agents.${dougKey(a.handle)}.role`),
      line: t(`dougTeam.agents.${dougKey(a.handle)}.line`),
      instructions: t(`dougTeam.agents.${dougKey(a.handle)}.line`),
      appearance: null,
      channel: qg ? (channelOf.get(qg) ?? "") : "",
      routines: read,
      firstTask: null,
    });
  }
  const { fresh } = await channelPlaces(deps.db, at.orgId, at.personId, [...channelOf.values()]);
  const params: TeamParams = {
    lead: t("dougTeam.lead"),
    agents: team,
    newChannels: fresh,
    skills: [],
    weekly: null,
    approvals: t("dougTeam.approvals"),
    invite: [],
    template: DOUG_TEMPLATE,
  };
  return { params, handles, routines, channelOf };
}

/** The gallery's entry (`GET …/team-templates?with=doug`), in the person's language. */
export async function dougTemplateView(
  deps: { db: Database; context?: ContextDeps },
  userId: string,
  orgId: string,
  preferred?: string | null,
): Promise<DougTemplateView> {
  const locale = await personLocale(deps.db, userId, preferred);
  const personal = await isPersonalWorkspace(deps.db, orgId);
  const all = dougAgents();
  const { params, channelOf } = await dougParams(
    deps,
    { orgId, channelId: "", personId: userId },
    all,
    locale,
    personal,
  );
  return {
    id: DOUG_TEMPLATE,
    name: serverText(locale, "dougTeam.name"),
    sub: serverText(locale, "dougTeam.sub"),
    description: serverText(locale, "dougTeam.desc"),
    team: params,
    members: all.map((a) => {
      const qg = dougQgOf(a);
      return {
        handle: a.handle,
        name: a.name,
        role: serverText(locale, `dougTeam.agents.${dougKey(a.handle)}.role`),
        line: serverText(locale, `dougTeam.agents.${dougKey(a.handle)}.line`),
        qg,
        channel: qg ? (channelOf.get(qg) ?? null) : null,
        reportsTo: a.reportsTo,
        needsComputer: a.needsComputer,
        rightHand: a.handle === DOUG_RIGHT_HAND,
        routines: a.routines.length,
        skills: a.skills.length + a.thirdPartySkills.length,
      };
    }),
    needsComputer: all.filter((a) => a.needsComputer).map((a) => a.handle),
  };
}

/** The Doug team made here, if any: what the brand step and the right hand read. */
export async function dougTeamOf(db: Database, orgId: string) {
  const [row] = await db
    .select({ dougTeam: organizationSettings.dougTeam })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId));
  return row?.dougTeam ?? null;
}

/** The routines a card made, from its own receipt (`created.routineIds`), empty when it isn't there. */
async function cardRoutineIds(db: Database, orgId: string, cardId: string) {
  const [row] = await db
    .select({
      routineIds: sql<string[]>`coalesce(${messages.meta}->'actionCard'->'created'->'routineIds', '[]'::jsonb)`,
    })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.id, cardId)));
  return Array.isArray(row?.routineIds) ? row.routineIds : [];
}

/**
 * The Doug team made here whose agents are still here, or null: an archived agent is gone (`doug_team.made` allows a
 * new team while none of the team's is left), and the brand step and the DOUG's role go with it.
 *
 * The right hand's id is not one of the team's agents: it is the workspace's own right hand, which is never archived.
 * Counting it would make a team of the DOUG alone look made forever, and the workspace could never make another.
 */
async function liveDougTeam(db: Database, orgId: string) {
  const team = await dougTeamOf(db, orgId);
  if (!team) return null;
  const ids = Object.entries(team.agents)
    .filter(([handle]) => handle !== DOUG_RIGHT_HAND)
    .map(([, id]) => id);
  if (ids.length === 0) return null;
  const [left] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), inArray(agents.id, ids), isNull(agents.archivedAt)))
    .limit(1);
  return left ? team : null;
}

/**
 * A house skill as the workspace's own: one already there by that name is used as it is; one deleted comes back with
 * the material's text. `made`: Desfazer takes it back.
 */
async function houseSkill(db: Database, userId: string, orgId: string, slug: string, via: string) {
  const s = dougSkills().get(slug);
  if (!s) throw new ValidationError(`No house skill ${slug}`);
  const [had] = await db
    .select({ id: skills.id, deletedAt: skills.deletedAt })
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug), isNull(skills.ownerUserId)));
  if (had && !had.deletedAt) return { id: had.id, made: false };
  const values = {
    description: s.description,
    body: s.body,
    metadata: s.metadata,
    source: "manual" as const,
  };
  const [row] = had
    ? await db
        .update(skills)
        .set({
          ...values,
          deletedAt: null,
          version: sql`${skills.version} + 1`,
          editedSinceSource: false,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, had.id))
        .returning({ id: skills.id })
    : await db
        .insert(skills)
        .values({ orgId, slug, name: slug, ...values, createdByUserId: userId })
        .returning({ id: skills.id });
  if (!row) throw new Error("skill write returned nothing");
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: userId },
    action: had ? "skill.restored" : "skill.created",
    target: { type: "skill", id: row.id },
    details: { name: slug, via },
  });
  return { id: row.id, made: true };
}

/** A link's repository and the folder above the skill's: the third-party skills of one folder install from one read. */
function groupOf(source: string) {
  const target = parseGithubUrl(source);
  const dir = target.path.replace(/\/+$/, "");
  const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  const repo = `https://github.com/${target.owner}/${target.repo}`;
  // A link to the repository itself is the skill: it is read alone.
  if (!dir) return { key: source, url: source, dir: "" };
  return {
    key: `${repo}#${target.ref}#${parent}`,
    url: `${repo}/tree/${target.ref}${parent ? `/${parent}` : ""}`,
    dir,
  };
}

/**
 * A template's third-party skills grouped by the folder they install from (one read per folder), each with the agents
 * that list it named by the handle they were made with.
 */
function madeSkillGroups(chosen: readonly DougAgentTemplate[], byTemplate: Record<string, string>) {
  const groups = new Map<string, { url: string; items: DougSkillItem[] }>();
  for (const a of chosen) {
    const agentId = byTemplate[a.handle];
    if (!agentId) continue;
    for (const s of a.thirdPartySkills) {
      const g = groupOf(s.source);
      const group = groups.get(g.url) ?? { url: g.url, items: [] };
      const item = group.items.find((i) => i.slug === s.slug);
      if (item) item.agentIds.push(agentId);
      else group.items.push({ slug: s.slug, source: s.source, license: s.license, dir: g.dir, agentIds: [agentId] });
      groups.set(g.url, group);
    }
  }
  return [...groups.values()].map((g) => [g.url, g.items] as const);
}

/**
 * "Usar este modelo" on the Doug team (`POST …/team-templates/doug/use`, docs/adr/doug-0030-time-doug.md): the chosen
 * agents (`handles`, every one when absent) made at once in one transaction, as the right hand's card in the person's
 * DM, which then reads created with Undo like any template's. No limit of the team card applies: the template is ours.
 * Each QG gets its channel; the QG de Tráfego's agents report to its MARK; every routine is made paused; the house
 * skills become the workspace's, each given to the agents that list it; the third-party ones are installed after, by a
 * job, from their public links. The DOUG is the right hand that is already here: its instructions become its role in
 * this workspace. Skills are an admin's (`manage_agents`) and the right hand's routines are for who manages them:
 * without that right they are left out, named on the receipt (`skipped`), and the rest is made.
 */
export async function useDougTeam(
  deps: TeamDeps & { context?: ContextDeps },
  userId: string,
  orgId: string,
  input: { handles?: readonly string[] | null; locale?: string | null } = {},
) {
  const membership = await requirePermission(deps.db, userId, orgId, "create_agents");
  const admin = can(membership, "manage_agents");
  const chosen = chosenTemplates(input.handles);
  // Made once, while its agents are still here; after Desfazer (or with every one archived) it may be made again.
  const had = await liveDougTeam(deps.db, orgId);
  if (had) throw new ConflictError("This workspace already has the Doug team", "doug_team.made");
  const [locale, { lodi, dm }] = await Promise.all([
    personLocale(deps.db, userId, input.locale),
    rightHandDm(deps.db, orgId, userId),
  ]);
  const at = { orgId, channelId: dm.id, personId: userId };
  // A personal workspace's agents live in their DM with the person: no channel (ADR 0159, docs/adr/doug-0030-time-doug.md §8).
  const personal = await isPersonalWorkspace(deps.db, orgId);
  const { params, handles, routines, channelOf } = await dougParams(deps, at, chosen, locale, personal);
  // The DOUG is the workspace's right hand, whose role only an admin gives it (`manage_agents`): a member who may
  // create agents gets the team, and the receipt says the DOUG's role waits for an admin (`skipped`).
  const wantsRightHand = chosen.some((a) => a.handle === DOUG_RIGHT_HAND);
  const rightHand = admin ? (chosen.find((a) => a.handle === DOUG_RIGHT_HAND) ?? null) : null;
  const skipped: TeamCreated["skipped"] = [];
  if (wantsRightHand && !rightHand) skipped.push("rightHand");
  const members = chosen.filter((a) => a.handle !== DOUG_RIGHT_HAND);
  const place = { orgId, channelId: dm.id, threadId: null, agentId: lodi.id, runId: null, hop: 0 };
  const card = await postTeamCard(deps, place, params, userId, undefined, false);
  const pending = (await getMessage(deps.db, orgId, card.id)) ?? card;
  const proposal = pending.meta.actionCard as TeamProposalCard;
  const claimed: TeamProposalCard = { ...proposal, state: "creating", error: null };
  // Claimed only while it is still open: a click that replaced this card with a newer one (two clicks at once) makes
  // no team from it, and the card it posted goes, so the person reads one card and no second one reading `denied`.
  if (!(await writeCard(deps, pending, claimed, "pending"))) {
    await deps.db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.orgId, orgId), eq(messages.id, card.id)));
    throw new ConflictError("A newer click replaced this card", "team_proposal.decided");
  }
  const events = holdEvents(deps.pubsub);
  type Made = Omit<TeamCreated, "noAi" | "skipped"> & { agents: Agent[]; byTemplate: Record<string, string> };
  let made: Made;
  try {
    made = await deps.db.transaction(async (raw) => {
      const tx = raw as unknown as Database;
      // Two clicks at once: the second waits here, then finds the team already made and makes none of it.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`doug-team:${orgId}`}, 0))`);
      if (await liveDougTeam(tx, orgId))
        throw new ConflictError("This workspace already has the Doug team", "doug_team.made");
      const out: Made = { agentIds: [], channelIds: [], routineIds: [], skillIds: [], agents: [], byTemplate: {} };
      const names = [...new Set(channelOf.values())];
      const channelStep = names.map((n) => `#${n}`).join(", ");
      const { existing, archived, outside, blocked } = await stepped(channelStep, () =>
        channelPlaces(tx, orgId, userId, names),
      );
      if (blocked.length > 0) throw new StepError(channelStep, blockedError(blocked));
      for (const id of outside) await stepped(channelStep, () => joinChannel(tx, userId, orgId, id, events));
      const channelId = new Map(existing);
      for (const name of names) {
        if (channelId.has(name)) continue;
        const back = archived.get(name);
        const id = await stepped(`#${name}`, async () => {
          if (!back) return (await createChannel(tx, userId, orgId, { name }, events)).id;
          await unarchiveChannel(tx, userId, orgId, back, events);
          return back;
        });
        channelId.set(name, id);
        out.channelIds.push(id);
      }
      const taken = await takenHandles(tx, orgId);
      for (const a of members) {
        const draft = params.agents.find((d) => d.handle === handles.get(a.handle)) as TeamAgent;
        const agent = await stepped(a.name, async () => {
          if (taken.has(draft.handle)) {
            const suggestion = freeHandle(draft.handle, taken);
            throw new ConflictError(
              `@${draft.handle} is already taken. How about @${suggestion}?`,
              "agent.handle_taken",
              { handle: draft.handle, suggestion },
            );
          }
          const row = await createAgent(
            tx,
            userId,
            orgId,
            { name: a.name, handle: draft.handle, role: draft.role, instructions: a.instructions },
            NEW_AGENT_DEFAULTS,
            { via: lodi.id, pubsub: events.pubsub },
          );
          if (admin) await giveApps(tx, userId, orgId, row.id, []);
          const where = draft.channel ? (channelId.get(draft.channel) as string) : null;
          if (where) await addChannelMember(tx, userId, orgId, where, { agentId: row.id }, events);
          for (const r of routines.get(a.handle) ?? []) {
            const routine = await createRoutine({ db: tx, pubsub: events.pubsub }, userId, orgId, {
              name: r.name,
              agentId: row.id,
              prompt: r.prompt,
              target: where
                ? { type: "conversation", channelId: where, threadId: null, reminder: false }
                : { type: "dm" },
              trigger: r.rule
                ? { type: "schedule", rule: r.rule }
                : { type: "schedule", phrase: r.cron, timezone: r.timezone },
              access: r.access,
              report: r.report,
              // Every routine starts paused: the person turns on the ones they want (docs/adr/doug-0030-time-doug.md).
              paused: true,
            });
            out.routineIds.push(routine.id);
          }
          return row;
        });
        out.agents.push(agent);
        out.agentIds.push(agent.id);
        out.byTemplate[a.handle] = agent.id;
      }
      // The QG de Tráfego's agents answer to its MARK (one level, `reporting.ts`).
      for (const a of members) {
        const lead = a.reportsTo ? out.byTemplate[a.reportsTo] : undefined;
        const id = out.byTemplate[a.handle];
        if (lead && id) await tx.update(agents).set({ reportsToAgentId: lead }).where(eq(agents.id, id));
      }
      if (rightHand) {
        out.byTemplate[DOUG_RIGHT_HAND] = lodi.id;
        // A team made again (after Desfazer, or with every agent of the last one archived) must not leave the last
        // one's routines on the right hand, which is never archived: the ones the last card made there go first. Their
        // ids are the card's own list, so a routine the right hand had by another name is no business of this one.
        const previous = await dougTeamOf(tx, orgId);
        const made = previous ? await cardRoutineIds(tx, orgId, previous.cardId) : [];
        if (made.length > 0) {
          const theirs = await tx
            .select({ id: routineRows.id, name: routineRows.name })
            .from(routineRows)
            .where(
              and(
                eq(routineRows.orgId, orgId),
                eq(routineRows.agentId, lodi.id),
                inArray(routineRows.id, made),
                isNull(routineRows.deletedAt),
              ),
            );
          for (const old of theirs) {
            await raw
              .transaction(async (sp) =>
                deleteRoutine({ db: sp as unknown as Database, pubsub: events.pubsub }, userId, orgId, old.id),
              )
              .catch((error) => {
                if (error instanceof ForbiddenError || error instanceof NotFoundError) return;
                throw new StepError(old.name, error);
              });
          }
        }
        // Its routines are for who manages the right hand's (its owner, or `manage_routines`): a savepoint each, so a
        // refusal leaves them out without undoing the team.
        let refused = false;
        for (const r of routines.get(DOUG_RIGHT_HAND) ?? []) {
          const routine = await raw
            .transaction(async (sp) =>
              createRoutine({ db: sp as unknown as Database, pubsub: events.pubsub }, userId, orgId, {
                name: r.name,
                agentId: lodi.id,
                prompt: r.prompt,
                target: { type: "dm" },
                trigger: r.rule
                  ? { type: "schedule", rule: r.rule }
                  : { type: "schedule", phrase: r.cron, timezone: r.timezone },
                access: r.access,
                report: r.report,
                paused: true,
              }),
            )
            .catch((error) => {
              if (error instanceof ForbiddenError) return null;
              throw new StepError(r.name, error);
            });
          if (routine) out.routineIds.push(routine.id);
          else refused = true;
        }
        if (refused) skipped.push("weekly");
      }
      const wanted = chosen.flatMap((a) => (a.skills.length || a.thirdPartySkills.length ? [a] : []));
      if (wanted.length > 0 && !admin) skipped.push("skills");
      if (wanted.length > 0 && admin) {
        const given = new Map<string, Set<string>>();
        for (const a of chosen) {
          const agentId = out.byTemplate[a.handle];
          if (!agentId) continue;
          for (const slug of a.skills) given.set(slug, (given.get(slug) ?? new Set()).add(agentId));
        }
        for (const [slug, to] of given) {
          const { id, made: fresh } = await stepped(slug, () => houseSkill(tx, userId, orgId, slug, lodi.id));
          if (fresh) out.skillIds.push(id);
          await tx
            .insert(agentSkills)
            .values([...to].map((agentId) => ({ orgId, agentId, skillId: id, enabled: true })))
            .onConflictDoUpdate({ target: [agentSkills.agentId, agentSkills.skillId], set: { enabled: true } });
        }
      }
      const dougTeam = { cardId: card.id, agents: out.byTemplate, rightHand: rightHand !== null };
      await tx
        .insert(organizationSettings)
        .values({ orgId, dougTeam })
        .onConflictDoUpdate({ target: organizationSettings.orgId, set: { dougTeam } });
      return out;
    });
  } catch (error) {
    const step = error instanceof StepError ? error.step : members.map((a) => a.name).join(", ");
    // A second click that got this far while the first was making the team: the team is made, once, from the first
    // card, and this one leaves nothing behind — no second card reading `denied` in the person's DM.
    if (error instanceof ConflictError && error.code === "doug_team.made") {
      await deps.db
        .update(messages)
        .set({ deletedAt: new Date() })
        .where(and(eq(messages.orgId, orgId), eq(messages.id, card.id)));
      throw error;
    }
    // Any other failure takes the card to a terminal state (`denied`, with its reason on the receipt), never leaves it
    // `pending` or `creating` where another click would try again: the team is made once, from its own card.
    const back: TeamProposalCard = {
      ...claimed,
      state: "denied",
      error: teamFailure(step, error),
      decidedByUserId: userId,
      decidedAt: new Date().toISOString(),
    };
    await writeCard(deps, pending, back, "creating");
    const now = await getMessage(deps.db, orgId, card.id);
    if (deps.pubsub && now) await publishMessageCreated(deps.pubsub, messageView(now));
    return {
      channelId: dm.id,
      messageId: card.id,
      state: back.state,
      error: back.error ?? null,
      needsComputer: [] as { agentId: string; handle: string; name: string }[],
      brandPending: false,
    };
  }
  invalidateOrg(orgId);
  await events.flush();
  // Its AI, one agent after the other, as for any team card: an account of the clicker's thinks for one agent at most.
  const noAi: string[] = [];
  let thinking = false;
  for (const agent of made.agents) {
    const ai = await suggestAgentAi(deps, orgId, userId);
    if (ai.kind === "none") noAi.push(agent.id);
    if (ai.kind !== "account") continue;
    try {
      await setAgentComputerTarget({ db: deps.db, pubsub: deps.pubsub }, userId, orgId, agent.id, ai.machineId);
      await setAgentBrain({ db: deps.db }, userId, orgId, agent.id, { brain: ai.brain, account: ai.accountId });
      thinking = true;
    } catch {
      noAi.push(agent.id);
    }
  }
  if (thinking) await publishAgentsChanged(deps.pubsub, orgId);
  const computers = members.flatMap((a) => {
    const agent = made.agents.find((m) => m.id === made.byTemplate[a.handle]);
    return a.needsComputer && agent ? [{ agentId: agent.id, handle: agent.handle, name: agent.name }] : [];
  });
  const { agents: _agents, byTemplate: _byTemplate, ...ids } = made;
  const done: TeamProposalCard = {
    ...claimed,
    state: "created",
    error: null,
    decidedByUserId: userId,
    decidedAt: new Date().toISOString(),
    created: {
      ...ids,
      skipped,
      noAi,
      needsComputer: computers.map((c) => c.agentId),
      rightHandRole: rightHand !== null,
    },
  };
  await writeCard(deps, pending, done, "creating");
  // The third-party skills from their links, after the card reads created: a slow or failed download never holds the
  // team up. The job only installs once the card is created (it throws while creating, so the outbox reads it again).
  // Skills are an admin's, as on the team card: a member who made the team gets the agents, and the receipt says the
  // skills wait for an admin (`skipped`).
  if (admin) {
    for (const [url, items] of madeSkillGroups(chosen, made.byTemplate)) {
      await enqueue(deps.db, {
        orgId,
        kind: DOUG_TEAM_SKILLS_JOB,
        payload: { cardId: card.id, userId, url, items },
        dedupeKey: `${DOUG_TEAM_SKILLS_JOB}:${card.id}:${url}`,
      });
    }
  }
  const now = await getMessage(deps.db, orgId, card.id);
  if (deps.pubsub && now) await publishMessageCreated(deps.pubsub, messageView(now));
  // A brand that already exists (a team made again after Desfazer) goes to the readers it just gained.
  await giveBrandToReaders(deps.db, orgId, made.byTemplate).catch(() => {});
  // Only the hello in #general after it (docs/adr/doug-0030-time-doug.md): the right hand, then each agent in the card's order.
  if ((await billingHold(deps.db, orgId)) === null)
    await enqueue(deps.db, {
      orgId,
      kind: TEAM_HELLO_JOB,
      payload: {
        how: "created",
        userId,
        doug: members.flatMap((a) =>
          made.byTemplate[a.handle] ? [{ agentId: made.byTemplate[a.handle], key: a.handle }] : [],
        ),
      },
      dedupeKey: `${TEAM_HELLO_JOB}:${orgId}:${DOUG_TEMPLATE}:${card.id}`,
    });
  return {
    channelId: dm.id,
    messageId: card.id,
    state: done.state,
    error: null,
    needsComputer: computers,
    brandPending: await brandPending(deps.db, orgId),
  };
}
