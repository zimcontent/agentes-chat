import type { IconName } from "@/ui/Icon";

/**
 * "Tudo": every place the phone opens from one sheet (Início's "Mais" and the conversation's "+"), and which of them
 * sit on Início's front row. Pure: the screen gives what is on and the labels, these say what shows where.
 */

/** A tool's key. Where a key is also one of the web's sidebar tools, it is the same word, so `hiddenTools` hides it. */
export type ToolKey =
  | "whatsapp"
  | "calendar"
  | "media"
  | "search"
  | "proposals"
  | "issues"
  | "review"
  | "portal"
  | "team"
  | "routines"
  | "dashboards"
  | "wiki"
  | "drive"
  | "vault"
  | "computer"
  | "people"
  | "settings";

/** What a tool needs to be shown, beyond not being hidden. */
type Need = "whatsapp" | "media" | "portal" | "calendar" | "member";

export interface ToolDef {
  key: ToolKey;
  href: string;
  /** "whatsapp": the service's own mark (`WhatsAppMark`), anything else one of the kit's icons. */
  icon: IconName | "whatsapp";
  /** A tab of the app (Revisão, Portal): gone to, not pushed over the screen. */
  tab?: boolean;
  needs?: Need;
  /** Not one of the web's tools: an admin's `hiddenTools` never takes it out. */
  always?: boolean;
}

/**
 * Every tool in the sheet's order. Agenda (Google Calendar) waits behind its switch, `calendar` in `ToolsOn`: the day
 * it exists, the screen turns that on and its tile shows second, as in the design.
 */
export const TOOLS: readonly ToolDef[] = [
  { key: "whatsapp", href: "/whatsapp", icon: "whatsapp", needs: "whatsapp" },
  { key: "calendar", href: "/calendar", icon: "calendar", needs: "calendar" },
  { key: "proposals", href: "/proposals", icon: "doc" },
  { key: "issues", href: "/issues", icon: "checkc" },
  { key: "review", href: "/reviews", icon: "play", tab: true },
  { key: "portal", href: "/portal", icon: "flag", tab: true, needs: "portal" },
  // "team" is the web's key for the agents' tool: Agentes here, as Início's "Mais" had it.
  { key: "team", href: "/agents", icon: "agent" },
  { key: "routines", href: "/routines", icon: "clock" },
  { key: "dashboards", href: "/dashboards", icon: "chart" },
  { key: "wiki", href: "/wiki", icon: "book" },
  { key: "media", href: "/media", icon: "image", needs: "media" },
  { key: "drive", href: "/drive", icon: "drive" },
  { key: "vault", href: "/settings/vault", icon: "lock", needs: "member", always: true },
  { key: "computer", href: "/settings/devices", icon: "laptop", needs: "member", always: true },
  { key: "people", href: "/me/members", icon: "members", needs: "member", always: true },
  { key: "settings", href: "/settings", icon: "sliders", always: true },
  // Buscar is the sheet's own field: a tile only on Início's row, where it has been from the start.
  { key: "search", href: "/search", icon: "search", always: true },
];

/** Início's front row before anyone chose: the order it has always had, the next one taking an absent tool's place. */
export const FRONT_ORDER: readonly ToolKey[] = [
  "whatsapp",
  "media",
  "search",
  "issues",
  "drive",
  "team",
  "routines",
  "wiki",
  "dashboards",
];

/** Início shows four tools and "Mais". */
export const FRONT_MAX = 4;

export interface ToolsOn {
  whatsapp: boolean;
  media: boolean;
  portal: boolean;
  /** Agenda (Google Calendar): off until it exists. */
  calendar: boolean;
  /** The person may read the workspace's own pages (Cofre, Computador, Pessoas). */
  member: boolean;
  /** The tools an admin took out of the workspace for everyone (Settings › General). */
  hidden: readonly string[];
}

/** The tools this person has here, in the sheet's order. */
export function toolsHere(on: ToolsOn): ToolDef[] {
  return TOOLS.filter((tool) => (tool.needs ? on[tool.needs] : true) && (tool.always || !on.hidden.includes(tool.key)));
}

/** The keys a person pinned, as stored: only known keys, once each, at most `FRONT_MAX`. Anything else is null. */
export function readPins(value: unknown): ToolKey[] | null {
  if (!Array.isArray(value)) return null;
  const known = new Set<string>(TOOLS.map((t) => t.key));
  const pins: ToolKey[] = [];
  for (const key of value)
    if (typeof key === "string" && known.has(key) && !pins.includes(key as ToolKey)) pins.push(key as ToolKey);
  return pins.slice(0, FRONT_MAX);
}

/**
 * Início's front row: what the person pinned, in their order, among the tools they have here; before they chose
 * (`pins` null), the first four of `FRONT_ORDER` they have.
 */
export function frontOf(available: readonly ToolDef[], pins: readonly ToolKey[] | null): ToolKey[] {
  const here = new Set(available.map((t) => t.key));
  return (pins ?? FRONT_ORDER).filter((key) => here.has(key)).slice(0, FRONT_MAX);
}

export type PinChange = { pins: ToolKey[]; full: false } | { pins: readonly ToolKey[]; full: true };

/** A tile tapped while editing: pinned leaves, unpinned joins at the end, unless the row is full (`full`, unchanged). */
export function togglePin(pins: readonly ToolKey[], key: ToolKey): PinChange {
  if (pins.includes(key)) return { pins: pins.filter((k) => k !== key), full: false };
  if (pins.length >= FRONT_MAX) return { pins, full: true };
  return { pins: [...pins, key], full: false };
}

/** The sheet's grid: every tool here but Buscar, which the field above it is; while editing Buscar too, to pin it. */
export function gridOf<T extends ToolDef>(available: readonly T[], editing: boolean): readonly T[] {
  return editing ? available : available.filter((t) => t.key !== "search");
}

/** What waits in the tools the front row doesn't show: the badge on "Mais". */
export function waitingBehind(
  available: readonly ToolDef[],
  front: readonly ToolKey[],
  counts: Partial<Record<ToolKey, number>>,
): number {
  return available.reduce((n, t) => n + (front.includes(t.key) ? 0 : (counts[t.key] ?? 0)), 0);
}

/** The stored pins of every workspace on this phone: JSON by workspace id. */
export function pinsOf(stored: string | null, orgId: string): ToolKey[] | null {
  if (!stored) return null;
  try {
    const all = JSON.parse(stored) as Record<string, unknown>;
    return all && typeof all === "object" ? readPins(all[orgId]) : null;
  } catch {
    return null;
  }
}

export function withPins(stored: string | null, orgId: string, pins: readonly ToolKey[]): string {
  let all: Record<string, unknown> = {};
  try {
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) all = parsed as Record<string, unknown>;
  } catch {
    // An unreadable value is replaced.
  }
  return JSON.stringify({ ...all, [orgId]: pins });
}
