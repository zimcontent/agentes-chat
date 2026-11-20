import { and, type Database, type Executor, eq, isNull, schema, sql } from "@dougbot/db";
import { dougSkills } from "./doug-team";
import { RIGHT_HAND } from "./right-hand";

/**
 * What the right hand knows and does in every workspace by default (docs/adr/doug-0041-doug-defaults.md), whatever the
 * workspace's own instructions, context or knowledge say: people add their own on top, never instead. Its prompt's
 * "# How you resolve" (read on every turn, so a workspace made before it has it too) and its house skills, given once
 * to each right hand (a skill someone deleted or renamed is never given again: removing it is their choice).
 */

/**
 * How it takes a request to its end, on top of "# How you work", which every agent with tools reads (ADR 0037): what
 * that block leaves to an agent's instructions (two ways before giving up, switching the family of tool, proof with
 * the delivery, following its own hand-offs, a recipe kept, a repeat offered) is the right hand's by default.
 */
export const RIGHT_HAND_RESOLVE = [
  "# How you resolve",
  "These hold in every workspace, whatever its own instructions and knowledge add.",
  "- A request with more than two steps: say the plan in one line, then do the steps in order, checking each before the next.",
  "- Before saying something can't be done, try at least two different ways, and switch the family of tool, not only the words: a search, then the page itself in your browser, then a file or an export, then code on a computer, then the teammate whose role or tools cover it (ask_agent). A video or an audio: download and transcribe it; to see what a video shows, take frames.",
  "- Ask a person only for what only they can give (an access, a payment, a decision, a file only they have; a key or a password only through its card), in one line with why, everything you need at once.",
  "- Deliver with proof: the result itself in the conversation (the numbers, the draft, the link to the file), and in one sentence how you checked it (what you opened, ran or compared). Say it is done only after you looked at the end result, never on a tool's word alone.",
  "- Follow your own work: what you handed to an agent or opened as a task, you follow to its end and tell the person what came of it; what has to wait, you set a follow_up for and say when.",
  "- When you solved something new, keep a short recipe (remember: the problem in one line and the steps that worked), never a secret, so the next time starts from it.",
  "- A task the person does over and over: once you delivered it and they liked it, offer once to do it on its own at their time, as a routine that reports in the same conversation.",
].join("\n");

/** The house skills (`doug-team/skills/<slug>`) every right hand has from the start. */
export const RIGHT_HAND_HOUSE_SKILLS = ["resolver"] as const;

const { agents, agentSkills, organizations, skills } = schema;

/**
 * Gives this right hand its house skills, as the workspace's own: each one the workspace never had a team skill of
 * that name (live or deleted) is made and turned on for it. No audit row: they come with the right hand, as it comes
 * with the workspace. Returns how many it made.
 */
export async function giveRightHandSkills(db: Executor, orgId: string, agentId: string): Promise<number> {
  let made = 0;
  for (const slug of RIGHT_HAND_HOUSE_SKILLS) {
    const house = dougSkills().get(slug);
    if (!house) continue;
    const [had] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug), isNull(skills.ownerUserId)))
      .limit(1);
    if (had) continue;
    const [row] = await db
      .insert(skills)
      .values({
        orgId,
        slug,
        name: slug,
        description: house.description,
        body: house.body,
        metadata: house.metadata,
        source: "manual",
      })
      .onConflictDoNothing()
      .returning({ id: skills.id });
    if (!row) continue;
    await db.insert(agentSkills).values({ orgId, agentId, skillId: row.id, enabled: true }).onConflictDoNothing();
    made++;
  }
  return made;
}

/**
 * Every right hand without its house skills gets them, once: one query finds none once they all have them. A new
 * workspace's get them as its onboarding ends (`saveOnboarding`); this, on the workers' hourly right hand tick beside
 * its rondas, gives them to the ones made before and to any that skipped it. Returns how many skills it made.
 */
export async function ensureRightHandSkills(db: Database): Promise<number> {
  const slugs = sql.join(
    RIGHT_HAND_HOUSE_SKILLS.map((s) => sql`${s}`),
    sql`, `,
  );
  const hands = await db
    .select({ id: agents.id, orgId: agents.orgId })
    .from(agents)
    .innerJoin(organizations, eq(organizations.id, agents.orgId))
    .where(
      and(
        eq(agents.builtin, RIGHT_HAND),
        isNull(agents.archivedAt),
        isNull(agents.deletedAt),
        isNull(organizations.deletionDueAt),
        sql`(select count(*) from ${skills} s where s.org_id = ${agents.orgId} and s.owner_user_id is null
          and s.slug in (${slugs})) < ${RIGHT_HAND_HOUSE_SKILLS.length}`,
      ),
    );
  let made = 0;
  for (const hand of hands) made += await db.transaction((tx) => giveRightHandSkills(tx, hand.orgId, hand.id));
  return made;
}
