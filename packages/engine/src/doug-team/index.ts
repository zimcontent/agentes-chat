import { ValidationError } from "../errors";
import { parseSkillMarkdown } from "../skills";
import { AGENT_FILES, SKILL_FILES } from "./files.gen";

/**
 * The Doug team's material (docs/adr/doug-0020-time-doug.md): the house's agents as templates, each one's trade with no
 * client's data, and the house skills they use. Kept as Markdown beside this file (`agents/<handle>.md`,
 * `skills/<slug>/SKILL.md`) and built into `files.gen.ts` (`bun run doug-team:build`), read here once, typed.
 */

/** The template's id in the gallery (`team-templates.ts`). */
export const DOUG_TEMPLATE = "doug" as const;

/** A routine as a template writes it: a 5-field cron, read in the creator's time zone. */
export interface DougRoutine {
  name: string;
  cron: string;
  prompt: string;
  paused: boolean;
}

/** A skill someone else publishes, installed from its public link under an open license. */
export interface DougThirdPartySkill {
  slug: string;
  source: string;
  license: string;
}

export interface DougAgentTemplate {
  /** Its file's name, the handle it is made with when that is free. */
  handle: string;
  name: string;
  role: string;
  line: string;
  /** The house's drawing it is (the apps draw it by name), or null. */
  bot: string | null;
  /** The team it belongs to inside its QG (`trafego`), or null. */
  team: string | null;
  /** The template it answers to (`mark`), or null. */
  reportsTo: string | null;
  needsComputer: boolean;
  routines: DougRoutine[];
  /** House skills (`skills/<slug>`) it gets. */
  skills: string[];
  thirdPartySkills: DougThirdPartySkill[];
  /** Its standing instructions, the file's body. */
  instructions: string;
}

export interface DougHouseSkill {
  slug: string;
  description: string;
  body: string;
  metadata: Record<string, unknown>;
}

/** The right hand's template: no agent is made for it, its instructions become the right hand's role here. */
export const DOUG_RIGHT_HAND = "doug";

/** The QGs, each a channel the team makes, in the order the card lists them. */
export const DOUG_QGS = ["design", "video", "trafego", "estrategia", "social", "codigo", "financeiro"] as const;
export type DougQg = (typeof DOUG_QGS)[number];

/** Each template's QG by its handle; a template of a team (`team: trafego`) goes to that team's QG. */
const QG_OF: Record<string, DougQg> = {
  rosa: "design",
  sony: "video",
  mark: "trafego",
  chess: "estrategia",
  "social-media": "social",
  junin: "codigo",
  kiara: "financeiro",
};

/** The QG a template lives in, or null for the right hand. */
export function dougQgOf(t: Pick<DougAgentTemplate, "handle" | "team">): DougQg | null {
  if (t.handle === DOUG_RIGHT_HAND) return null;
  if (t.team && (DOUG_QGS as readonly string[]).includes(t.team)) return t.team as DougQg;
  return QG_OF[t.handle] ?? null;
}

/** The order the gallery, the card and the hello list them: the right hand, then each QG's lead and its team. */
const ORDER = ["doug", "rosa", "sony", "mark", "chess", "social-media", "junin", "kiara"];

/** The i18n key of a template's words (`dougTeam.agents.<key>`): its handle in camelCase. */
export const dougKey = (handle: string) => handle.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** One agent file: YAML frontmatter, then its instructions. */
export function parseDougAgent(file: string, text: string): DougAgentTemplate {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n?/g, "\n"));
  if (!m) throw new ValidationError(`${file}: no frontmatter`);
  const y = (Bun.YAML.parse(m[1] ?? "") ?? {}) as Record<string, unknown>;
  const handle = str(y.handle);
  if (handle !== file) throw new ValidationError(`${file}: its handle is ${handle}`);
  return {
    handle,
    name: str(y.name),
    role: str(y.role),
    line: str(y.line),
    bot: str(y.bot) || null,
    team: str(y.team) || null,
    reportsTo: str(y.reports_to) || null,
    needsComputer: y.needs_computer === true,
    routines: list(y.routines).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { name: str(o.name), cron: str(o.cron), prompt: str(o.prompt), paused: o.paused !== false };
    }),
    skills: list(y.skills).map(str).filter(Boolean),
    thirdPartySkills: list(y.third_party_skills).map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { slug: str(o.slug), source: str(o.source), license: str(o.license) };
    }),
    instructions: (m[2] ?? "").trim(),
  };
}

let agentsRead: DougAgentTemplate[] | null = null;
let skillsRead: Map<string, DougHouseSkill> | null = null;

/** Every agent template, the right hand's first, then by QG. */
export function dougAgents(): readonly DougAgentTemplate[] {
  agentsRead ??= Object.entries(AGENT_FILES)
    .map(([file, text]) => parseDougAgent(file, text))
    .sort((a, b) => rank(a) - rank(b) || (a.handle < b.handle ? -1 : 1));
  return agentsRead;
}

function rank(t: DougAgentTemplate) {
  const lead = ORDER.indexOf(t.handle);
  if (lead >= 0) return lead * 100;
  // A team's members follow their lead (the 9 of the QG de Tráfego after the MARK).
  const qg = dougQgOf(t);
  const leadOfQg = Object.entries(QG_OF).find(([, q]) => q === qg)?.[0];
  return leadOfQg ? ORDER.indexOf(leadOfQg) * 100 + 1 : ORDER.length * 100;
}

export const dougAgent = (handle: string) => dougAgents().find((t) => t.handle === handle) ?? null;

/** Every house skill by its slug. */
export function dougSkills(): ReadonlyMap<string, DougHouseSkill> {
  skillsRead ??= new Map(
    Object.entries(SKILL_FILES).map(([slug, text]) => {
      const parsed = parseSkillMarkdown(text);
      return [slug, { slug, description: parsed.description, body: parsed.body, metadata: parsed.metadata }];
    }),
  );
  return skillsRead;
}
