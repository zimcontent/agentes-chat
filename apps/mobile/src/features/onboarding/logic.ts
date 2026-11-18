import type { BrandInput, BrandView, DougTemplateMember, TeamTemplate, WorkspaceMode } from "@agenteschat/client";
import { knownErrorText } from "@agenteschat/client/lib/errors";
import type { RailStep } from "@agenteschat/client/lib/onboarding";
import { platformZoneName } from "@agenteschat/client/lib/routines";
import { webmailOf } from "@agenteschat/client/lib/text";
import type { TFunction } from "i18next";

/**
 * The phone's first run: what the workspace is for (ADR 0159), then, for a company or team, its name, asked by its
 * right hand; then its DM (ADR 0137). Pure: no React Native imports.
 */

/** The two answers to "What will you use agentes.chat for?" (ADR 0159), in this order. */
export const PURPOSES = ["personal", "team"] as const satisfies readonly WorkspaceMode[];

/**
 * The workspace an answer makes, or what one made here already is set to when a later step failed: "For me" is a
 * personal workspace named in the person's language (renamed in Settings like any other), with no name to ask; a
 * company or team is the name typed. The mode goes along either way (a server that doesn't know it ignores it).
 */
export const workspaceAnswer = (t: TFunction, purpose: WorkspaceMode, name: string) =>
  purpose === "personal"
    ? { name: t("onboarding.personal.name"), mode: "personal" as const }
    : { name: name.trim(), mode: "team" as const };

/** A save that failed: what the server's code says (a refused workspace, a restriction), else that it didn't save. */
export const stepFailedText = (t: TFunction, error: unknown, locale?: string) =>
  knownErrorText(t, error, locale) ?? t("mobile.onb.failed");

/** The phone's time zone ("America/Sao_Paulo"), or null. */
export function phoneTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** "America/Sao_Paulo" → "Sao Paulo": the city, readable. */
export function zoneCity(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

/**
 * The time zone as people read it, in their language ("Horário Padrão de Brasília"); its city ("Sao Paulo", from the
 * id, without accents) where the platform has no name for it, or only an offset ("GMT-03:00").
 */
export function zoneLabel(zone: string, locale: string): string {
  return platformZoneName(zone, locale) ?? zoneCity(zone);
}

/** Personal mailboxes beyond the big webmails (`webmailOf`): their domain names a provider, never a company. */
const PERSONAL_DOMAINS = new Set([
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "globo.com",
  "globomail.com",
  "r7.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "mail.com",
  "zoho.com",
  "tutanota.com",
  "hey.com",
  "fastmail.com",
]);

/**
 * A workspace name from a work address, for the first run's field: `ana@acme.com.br` → "Acme",
 * `bruno@loja-sol.com` → "Loja Sol". Null for a personal mailbox (Gmail, Outlook, UOL…) or no usable domain, so
 * the field starts empty there.
 */
export function orgNameFromEmail(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain.includes(".") || webmailOf(email) || PERSONAL_DOMAINS.has(domain)) return null;
  const labels = domain.split(".").filter((l) => l && l !== "www" && l !== "mail");
  const first = labels[0];
  if (!first || first.length < 2) return null;
  return first
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1))
    .join(" ");
}

/** The Doug team's template id (docs/adr/doug-0020-time-doug.md): the first card of the gallery. */
export const DOUG_TEMPLATE = "doug";

/** The Doug template of a gallery, when the server has it; an older server's gallery has none (the old step shows). */
export const dougOf = (
  templates: readonly TeamTemplate[],
): (TeamTemplate & { members: DougTemplateMember[] }) | null => {
  const t = templates.find((x) => x.id === DOUG_TEMPLATE);
  return t?.members && t.members.length > 0 ? { ...t, members: t.members } : null;
};

/** The ready-made models other than the Doug team ("Outro modelo pronto"). */
export const otherTemplates = (templates: readonly TeamTemplate[]) => templates.filter((x) => x.id !== DOUG_TEMPLATE);

/** The three ways to start the team (the first question of the team step), in this order. */
export const TEAM_STARTS = ["doug", "other", "scratch"] as const;
export type TeamStart = (typeof TEAM_STARTS)[number];

/** The team step's own screens: how to start, who joins the Doug team, or the old gallery of models. */
export type TeamPhase = "how" | "members" | "other";

/** What the "how" button does next. */
export const phaseAfter = (start: TeamStart): TeamPhase | "scratch" =>
  start === "doug" ? "members" : start === "other" ? "other" : "scratch";

/**
 * The members the Doug team template lists as people to check: the right hand is fixed, the rest (the manager's
 * HQ under it) can be unchecked one by one. `top` are the rows of the list, `under` each one's reports.
 */
export function memberTree(members: readonly DougTemplateMember[]) {
  const handles = new Set(members.map((m) => m.handle));
  const under = new Map<string, DougTemplateMember[]>();
  const top: DougTemplateMember[] = [];
  for (const m of members) {
    if (m.reportsTo && handles.has(m.reportsTo)) under.set(m.reportsTo, [...(under.get(m.reportsTo) ?? []), m]);
    else top.push(m);
  }
  return { top, under };
}

/** The handles the person keeps: every member but the ones unchecked, the right hand always. */
export const keptHandles = (members: readonly DougTemplateMember[], unchecked: ReadonlySet<string>): string[] =>
  members.filter((m) => m.rightHand || !unchecked.has(m.handle)).map((m) => m.handle);

/** An agent besides the right hand is needed: with only the Doug, the team would still be empty. */
export const hasAgents = (members: readonly DougTemplateMember[], kept: readonly string[]) =>
  members.some((m) => !m.rightHand && kept.includes(m.handle));

/** The kept agents that work on a computer, for the notice and its button. */
export const computerMembers = (members: readonly DougTemplateMember[], kept: readonly string[]) =>
  members.filter((m) => m.needsComputer && kept.includes(m.handle));

/** A set with `handle` taken in or out. */
export function toggled(set: ReadonlySet<string>, handle: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(handle)) next.add(handle);
  return next;
}

/** The brand step is a step of the rail once the team's brand waits: right after the team, before the plan. */
export type FlowStep = RailStep | "brand";
export const withBrand = (steps: readonly RailStep[], brandPending: boolean): FlowStep[] => {
  if (!brandPending) return [...steps];
  const at = steps.indexOf("team");
  return at < 0 ? [...steps] : [...steps.slice(0, at + 1), "brand", ...steps.slice(at + 1)];
};

/**
 * The step on screen: the brand, once the team exists and its brand still waits (the data reaches the plan or the
 * opening), unless the person went back to a step they had done (`picked`).
 */
export const flowStepAt = (f: {
  step: RailStep;
  at: RailStep | "open";
  brandPending: boolean;
  picked: RailStep | null;
}): FlowStep => (f.brandPending && f.picked === null && (f.at === "plan" || f.at === "open") ? "brand" : f.step);

/** The brand step's form, as typed. */
export interface BrandForm {
  company: string;
  tones: readonly string[];
  tone: string;
  site: string;
  instagram: string;
  audience: string;
  files: readonly { id: string; title: string }[];
  link: string;
}

/** The company's name and a tone (tapped or written) are the two things the step can't go on without. */
export const brandReady = (f: Pick<BrandForm, "company" | "tones" | "tone">) =>
  f.company.trim() !== "" && (f.tones.length > 0 || f.tone.trim() !== "");

/** What `PUT …/brand` takes: only what was filled in. */
export function brandInput(f: BrandForm): BrandInput {
  const [tone, site, instagram, audience, link] = [f.tone, f.site, f.instagram, f.audience, f.link].map((v) =>
    v.trim(),
  );
  return {
    company: f.company.trim(),
    ...(f.tones.length > 0 ? { tones: [...f.tones] } : {}),
    ...(tone ? { tone } : {}),
    ...(site ? { site } : {}),
    ...(instagram ? { instagram } : {}),
    ...(audience ? { audience } : {}),
    ...(f.files.length > 0 ? { files: f.files.map((x) => x.id) } : {}),
    ...(link ? { links: [link] } : {}),
  };
}

/** The form a saved brand starts from, or the company's name alone for a first visit. */
export const brandFormOf = (brand: BrandView | null | undefined, company: string): BrandForm => ({
  company: brand?.company ?? company,
  tones: brand?.tones ?? [],
  tone: brand?.tone ?? "",
  site: brand?.site ?? "",
  instagram: brand?.instagram ?? "",
  audience: brand?.audience ?? "",
  files: brand?.files ?? [],
  link: brand?.links[0] ?? "",
});
