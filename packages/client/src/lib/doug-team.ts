import type { Brand, BrandInput, BrandTone, DougQg, DougTemplateMember, TeamTemplate } from "../api/types";

/**
 * The Doug team's template on the web and the phone (docs/adr/doug-0020-time-doug.md), platform-neutral: the id its
 * card answers to, the agents the person may uncheck, and the QG de Tráfego's team, which opens under its MARK.
 */

/** The template's id in the gallery (the server's `DOUG_TEMPLATE`). */
export const DOUG_TEMPLATE = "doug";

/** The QG de Tráfego's team (`team` of these in the material): its MARK holds them, each one uncheckable. */
export const TRAFFIC_QG: DougQg = "trafego";

/** Whether a template is the Doug team's (`members` says who it holds). */
export const isDougTemplate = (t: { id: string } | null | undefined): boolean => t?.id === DOUG_TEMPLATE;

/** The right hand's template: no agent is made for it, it takes the role its workspace already has. */
export const isRightHandMember = (m: Pick<DougTemplateMember, "rightHand">) => m.rightHand;

/**
 * The checkable agents of a Doug template in the order its card lists them: each QG's lead, its team under it (the QG
 * de Tráfego's MARK, then its nine). The right hand leads, uncheckable.
 */
export function dougMembers(members: readonly DougTemplateMember[]) {
  const lead = members.find(isRightHandMember) ?? null;
  const others = members.filter((m) => !m.rightHand);
  // The QG de Tráfego's team, which its MARK opens: `reportsTo` names its lead.
  const team = others.filter((m) => m.reportsTo !== null);
  return { lead, others, team };
}

/** A template's members, the right hand first when it is there. */
export const dougOrder = (members: readonly DougTemplateMember[]): DougTemplateMember[] => {
  const { lead, others } = dougMembers(members);
  return lead ? [lead, ...others] : [...others];
};

/**
 * The handles a Doug card creates: every one not `off`, the right hand's included (the workspace already has it, so
 * the server makes no agent for it and gives its role to the one that's there).
 */
export function dougHandles(members: readonly DougTemplateMember[], off: ReadonlySet<string>): string[] {
  return dougOrder(members)
    .filter((m) => !off.has(m.handle))
    .map((m) => m.handle);
}

/** What "Quem entra no seu time?" counts under its list: the agents, the skills and the routines it would make. */
export function dougCounts(members: readonly DougTemplateMember[], off: ReadonlySet<string>) {
  const kept = dougOrder(members).filter((m) => !off.has(m.handle));
  return {
    agents: kept.length,
    skills: kept.reduce((n, m) => n + m.skills, 0),
    routines: kept.reduce((n, m) => n + m.routines, 0),
  };
}

/** The Doug template of a gallery list, or null (a server older than the Doug team). */
export const dougOf = (templates: readonly TeamTemplate[]): TeamTemplate | null =>
  templates.find(isDougTemplate) ?? null;

/** The QG an agent belongs to, for its row's channel ("no QG de Design"), or null for the right hand. */
export const qgOf = (m: Pick<DougTemplateMember, "qg" | "channel">): DougQg | null => (m.channel ? m.qg : null);

/**
 * "Sua marca" (docs/adr/doug-0020-time-doug.md): the tones to tap, in the server's order (`BRAND_TONES`). Their words
 * come from the server, `GET …/brand` (`tones`), in the person's language; the ids are fixed here.
 */
export { BRAND_TONES } from "../api/types";
export type { Brand, BrandInput, BrandTone };

/**
 * What a brand's step needs before saving: a company's name and a tone, tapped or in the person's own words. Null when
 * it may be saved; otherwise the field that is missing, so the step says which.
 */
export function brandMissing(input: Pick<BrandInput, "company" | "tones" | "tone">): "company" | "tone" | null {
  if ((input.company ?? "").trim() === "") return "company";
  const tapped = (input.tones ?? []).length > 0;
  const written = (input.tone ?? "").trim() !== "";
  return tapped || written ? null : "tone";
}

/** The brand as the step's fields start from a saved one (a step gone back to): every value, empty when unsaid. */
export const brandFields = (b: Brand | null) => ({
  company: b?.company ?? "",
  tones: new Set<string>(b?.tones ?? []),
  tone: b?.tone ?? "",
  site: b?.site ?? "",
  instagram: b?.instagram ?? "",
  audience: b?.audience ?? "",
  files: b?.files ?? [],
  links: b?.links ?? [],
});
