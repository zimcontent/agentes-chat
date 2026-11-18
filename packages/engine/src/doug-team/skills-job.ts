import { and, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { publishAgentsChanged } from "../events";
import { PermanentJobError } from "../outbox";
import { importPickedSkills, importSkillFromUrl, type SkillDeps, type SkillDetail } from "../skills";
import type { DougSkillItem } from "./create";

const { agentSkills, agents, messages, skills } = schema;

/** What failed for good: the link holds no such skill now, or it is past the skill limits. Logged, never retried. */
export interface DougSkillsOutcome {
  installed: string[];
  given: string[];
  failed: { slug: string; code: string | null }[];
}

/**
 * The card is still being made (a job that ran while `useDougTeam`'s transaction was open, or not yet in `created`):
 * thrown so the outbox reads the card again, and the job installs then.
 */
export class DougTeamNotReady extends ConflictError {
  constructor(readonly state: string | null) {
    super(`The Doug team's card reads ${state ?? "nothing"}`, "doug_team.not_ready");
  }
}

/** A refusal that reading again won't change (`github.unreachable` and GitHub's limit are retried). */
const lasting = (error: unknown) =>
  (error instanceof ValidationError && error.code !== "github.unreachable" && error.code !== "github.limited") ||
  error instanceof ForbiddenError ||
  error instanceof NotFoundError;

/**
 * `doug_team.skills` (docs/adr/doug-0020-time-doug.md): one folder's third-party skills of a Doug team, installed from
 * their public links through the same path as Settings › Skills' "From a GitHub link" (`importSkillFromUrl`, read
 * once for the folder, then `importPickedSkills`), each given to the agents that list it, its license kept in its
 * `metadata` and its updates left off so a change upstream never reaches a prompt without review. A skill it made is
 * marked `metadata.dougTeam` (its card's id), so Desfazer takes it back even from a job that failed halfway. A card
 * undone (`undone`, `denied`, `superseded`) installs nothing. A card still being made (`creating`) or not yet read
 * back (`pending`) throws, and the outbox reads it again; a network failure throws too (tried again later).
 *
 * A skill the workspace already has is only given, and marked when the team's own job or a repeat made it (so a
 * repeat after a failure takes up where it stopped, and Desfazer removes what that repeat brought too).
 */
export async function installDougSkills(deps: SkillDeps, orgId: string, payload: Record<string, unknown>) {
  const cardId = String(payload.cardId ?? "");
  const userId = String(payload.userId ?? "");
  const url = String(payload.url ?? "");
  const items = (Array.isArray(payload.items) ? payload.items : []) as DougSkillItem[];
  if (!cardId || !userId || !url || items.length === 0) throw new PermanentJobError("doug_team.skills: bad payload");
  const out: DougSkillsOutcome = { installed: [], given: [], failed: [] };
  const [card] = await deps.db
    .select({
      state: sql<string>`${messages.meta}->'actionCard'->>'state'`,
      // What a try before this one already put on the card: a repeat adds none of them again.
      listed: sql<string[]>`coalesce(${messages.meta}->'actionCard'->'created'->'skillIds', '[]'::jsonb)`,
    })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.id, cardId)));
  const listed = new Set<string>(Array.isArray(card?.listed) ? card.listed : []);
  // Undone, denied or replaced: nothing to install or give.
  if (card?.state === "undone" || card?.state === "denied" || card?.state === "superseded") return out;
  // Still being made (or the card not read back yet): the outbox reads it again.
  if (card?.state !== "created") throw new DougTeamNotReady(card?.state ?? null);
  const have = new Map(
    (
      await deps.db
        .select({ id: skills.id, slug: skills.slug })
        .from(skills)
        .where(
          and(
            eq(skills.orgId, orgId),
            isNull(skills.ownerUserId),
            isNull(skills.deletedAt),
            inArray(
              skills.slug,
              items.map((i) => i.slug),
            ),
          ),
        )
    ).map((r) => [r.slug, r.id]),
  );
  const missing = items.filter((i) => !have.has(i.slug));
  const made = new Map<string, string>();
  const fresh = new Set<string>();
  if (missing.length > 0) {
    const installed: { item: DougSkillItem; skill: SkillDetail }[] = [];
    const lone = missing.filter((i) => !i.dir);
    let inFolder = missing.filter((i) => i.dir);
    let found = new Set<string>();
    if (inFolder.length > 0) {
      try {
        const listed = await importSkillFromUrl(deps, userId, orgId, url, { list: true });
        found = new Set("choices" in listed ? listed.choices.map((c) => c.path) : []);
      } catch (error) {
        if (!lasting(error)) throw error;
        // The folder can't be read as one (too many skills in it): each from its own link.
        lone.push(...inFolder);
        inFolder = [];
      }
    }
    for (const item of lone) {
      try {
        const got = await importSkillFromUrl(deps, userId, orgId, item.source);
        if ("choices" in got) out.failed.push({ slug: item.slug, code: "skill.link_holds_several" });
        else installed.push({ item, skill: got });
      } catch (error) {
        if (!lasting(error)) throw error;
        out.failed.push({ slug: item.slug, code: (error as ValidationError).code ?? null });
      }
    }
    if (inFolder.length > 0) {
      const there = inFolder.filter((i) => found.has(i.dir));
      for (const i of inFolder) if (!found.has(i.dir)) out.failed.push({ slug: i.slug, code: "skill.no_skill_md" });
      if (there.length > 0) {
        const got = await importPickedSkills(
          deps,
          userId,
          orgId,
          url,
          there.map((i) => i.dir),
        ).catch((error) => {
          if (!lasting(error)) throw error;
          for (const i of there) out.failed.push({ slug: i.slug, code: (error as ValidationError).code ?? null });
          return [] as SkillDetail[];
        });
        got.forEach((skill, n) => {
          const item = there[n];
          if (item) installed.push({ item, skill });
        });
      }
    }
    for (const { item, skill } of installed) {
      made.set(item.slug, skill.id);
      if (!listed.has(skill.id)) fresh.add(skill.id);
      out.installed.push(item.slug);
      // Marked as the Doug team's (its card's id), its license kept beside its own metadata, its updates off: an
      // upstream change never reaches a prompt without review, and Desfazer finds it even if the job never ends.
      const [row] = await deps.db.select({ metadata: skills.metadata }).from(skills).where(eq(skills.id, skill.id));
      const meta = row?.metadata ?? {};
      if (meta.dougTeam !== cardId || meta.license !== item.license)
        await deps.db
          .update(skills)
          .set({ metadata: { ...meta, dougTeam: cardId, ...(item.license ? { license: item.license } : {}) } })
          .where(eq(skills.id, skill.id));
    }
  }
  // A skill the workspace already has whose own job (or a repeat) made it: it is the team's too, so Desfazer takes it.
  for (const item of items) {
    const id = have.get(item.slug);
    if (!id || made.has(item.slug)) continue;
    const [row] = await deps.db.select({ metadata: skills.metadata }).from(skills).where(eq(skills.id, id));
    const meta = row?.metadata ?? {};
    if (meta.dougTeam === cardId) continue;
    await deps.db
      .update(skills)
      .set({ metadata: { ...meta, dougTeam: cardId, ...(item.license ? { license: item.license } : {}) } })
      .where(eq(skills.id, id));
    if (!listed.has(id)) fresh.add(id);
  }
  // Given only to the team's agents still here.
  const live = new Set(
    (
      await deps.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.orgId, orgId),
            isNull(agents.archivedAt),
            inArray(
              agents.id,
              items.flatMap((i) => i.agentIds),
            ),
          ),
        )
    ).map((a) => a.id),
  );
  for (const item of items) {
    const skillId = made.get(item.slug) ?? have.get(item.slug);
    const to = item.agentIds.filter((id) => live.has(id));
    if (!skillId || to.length === 0) continue;
    await deps.db
      .insert(agentSkills)
      .values(to.map((agentId) => ({ orgId, agentId, skillId, enabled: true })))
      .onConflictDoUpdate({ target: [agentSkills.agentId, agentSkills.skillId], set: { enabled: true } });
    out.given.push(item.slug);
  }
  // The card's own lists, merged under a row lock so two folders' jobs at once each add theirs: the skills Desfazer
  // takes back (`skillIds`) and the ones that failed for good (`failedSkills`, which the receipt shows with its code).
  if (fresh.size > 0 || out.failed.length > 0) await mergeCardCreated(deps, orgId, cardId, [...fresh], out.failed);
  if (out.given.length > 0) await publishAgentsChanged(deps.pubsub, orgId);
  return out;
}

/** Adds to a created card's `created.skillIds` and `created.failedSkills`, reading it again under a row lock. */
async function mergeCardCreated(
  deps: SkillDeps,
  orgId: string,
  cardId: string,
  skillIds: string[],
  failed: DougSkillsOutcome["failed"],
) {
  await deps.db.transaction(async (raw) => {
    const tx = raw as unknown as typeof deps.db;
    const [row] = await tx
      .select({ meta: messages.meta })
      .from(messages)
      .where(and(eq(messages.orgId, orgId), eq(messages.id, cardId)))
      .for("update");
    const meta = (row?.meta ?? {}) as Record<string, unknown>;
    const actionCard = (meta.actionCard ?? {}) as Record<string, unknown>;
    if (actionCard.state !== "created") return;
    const created = (actionCard.created ?? {}) as Record<string, unknown>;
    const push = (key: string, add: unknown[]) => [
      ...((Array.isArray(created[key]) ? created[key] : []) as unknown[]),
      ...add,
    ];
    const next = {
      ...actionCard,
      created: {
        ...created,
        ...(skillIds.length > 0 ? { skillIds: push("skillIds", skillIds) } : {}),
        ...(failed.length > 0 ? { failedSkills: push("failedSkills", failed) } : {}),
      },
    };
    await tx
      .update(messages)
      .set({ meta: { ...meta, actionCard: next } })
      .where(and(eq(messages.orgId, orgId), eq(messages.id, cardId)));
  });
}
