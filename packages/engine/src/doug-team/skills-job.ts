import { and, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { publishAgentsChanged } from "../events";
import { PermanentJobError } from "../outbox";
import { setSkillAutoUpdate } from "../skill-updates";
import { importPickedSkills, importSkillFromUrl, type SkillDeps, type SkillDetail } from "../skills";
import type { DougSkillItem } from "./create";

const { agentSkills, agents, messages, skills } = schema;

/** What failed for good: the link holds no such skill now, or it is past the skill limits. Logged, never retried. */
export interface DougSkillsOutcome {
  installed: string[];
  given: string[];
  failed: { slug: string; code: string | null }[];
}

/** A refusal that reading again won't change (`github.unreachable` and GitHub's limit are retried). */
const lasting = (error: unknown) =>
  (error instanceof ValidationError && error.code !== "github.unreachable" && error.code !== "github.limited") ||
  error instanceof ForbiddenError ||
  error instanceof NotFoundError;

/**
 * `doug_team.skills` (docs/adr/doug-0020-time-doug.md): one folder's third-party skills of a Doug team, installed from
 * their public links through the same path as Settings › Skills' "From a GitHub link" (`importSkillFromUrl`, read
 * once for the folder, then `importPickedSkills`), each set to update by itself and given to the agents that list it.
 * Its ids join the team card's, so Desfazer removes them too; a team already undone installs nothing. A skill the
 * workspace already has is only given. A network failure throws, and the outbox tries again later.
 */
export async function installDougSkills(deps: SkillDeps, orgId: string, payload: Record<string, unknown>) {
  const cardId = String(payload.cardId ?? "");
  const userId = String(payload.userId ?? "");
  const url = String(payload.url ?? "");
  const items = (Array.isArray(payload.items) ? payload.items : []) as DougSkillItem[];
  if (!cardId || !userId || !url || items.length === 0) throw new PermanentJobError("doug_team.skills: bad payload");
  const out: DougSkillsOutcome = { installed: [], given: [], failed: [] };
  const [card] = await deps.db
    .select({ state: sql<string>`${messages.meta}->'actionCard'->>'state'` })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.id, cardId)));
  if (card?.state !== "created") return out;
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
      fresh.add(skill.id);
      out.installed.push(item.slug);
      await setSkillAutoUpdate(deps.db, userId, orgId, skill.id, true);
    }
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
  if (fresh.size > 0) {
    // The card's own list, in one statement: two folders' jobs at once each add theirs.
    await deps.db
      .update(messages)
      .set({
        meta: sql`jsonb_set(${messages.meta}, '{actionCard,created,skillIds}', coalesce(${messages.meta}->'actionCard'->'created'->'skillIds', '[]'::jsonb) || ${JSON.stringify([...fresh])}::jsonb)`,
      })
      .where(
        and(
          eq(messages.orgId, orgId),
          eq(messages.id, cardId),
          sql`${messages.meta}->'actionCard'->>'state' = 'created'`,
        ),
      );
  }
  if (out.given.length > 0) await publishAgentsChanged(deps.pubsub, orgId);
  return out;
}
