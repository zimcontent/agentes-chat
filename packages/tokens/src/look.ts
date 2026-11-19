/** An agent's look, the allow-list the server keeps too: plain values every platform and `@dougbot/client` share. */

/** The agent symbol's preset colors (sky is the default identity); a custom "#rrggbb" is allowed too. */
export const AGENT_COLORS = ["sky", "indigo", "violet", "rose", "amber", "green", "teal", "graphite"] as const;
export type AgentColor = (typeof AGENT_COLORS)[number] | `#${string}`;

/** Mirrors `isHexColor` in packages/ui/src/agent/engine.js, which imports nothing so plain pages can load it. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const AGENT_EYES = ["round", "dots", "wide", "happy", "sleepy"] as const;
export type AgentEyes = (typeof AGENT_EYES)[number];

/** Pixel accessories drawn by the agent engine (`ACCESSORIES` in `@dougbot/ui`'s agent engine; same list, "none" first). */
export const AGENT_ACCESSORIES = [
  "none",
  "hat",
  "cap",
  "headphones",
  "bow",
  "crown",
  "antenna",
  "headset",
  "beanie",
  "party",
  "flower",
  "scarf",
] as const;
/**
 * What only the DougBot draws (IDENTIDADE.md §6), not the pixel engine: a tie and keys. Allowed beside
 * `AGENT_ACCESSORIES`; the pixel engine draws nothing for them.
 */
export const AGENT_BOT_ACCESSORIES = ["tie", "keys"] as const;
export type AgentAccessory = (typeof AGENT_ACCESSORIES)[number] | (typeof AGENT_BOT_ACCESSORIES)[number];
const ALL_ACCESSORIES: readonly AgentAccessory[] = [...AGENT_ACCESSORIES, ...AGENT_BOT_ACCESSORIES];

/**
 * The DougBot's forms (`DougBotForma`). An appearance with a `shape` was picked for the bot: it draws that form, color,
 * eyes and accessory; without one, the bot comes from the agent's trade and name (`botDoAgente`).
 */
export const AGENT_SHAPES = ["squircle", "quadrado", "petala", "monitor", "torre", "moeda", "hexagono"] as const;
export type AgentShape = (typeof AGENT_SHAPES)[number];

export interface AgentAppearance {
  color?: AgentColor;
  eyes?: AgentEyes;
  accessory?: AgentAccessory;
  shape?: AgentShape;
}

/** A look as the editors hold it: color, eyes and accessory always there, the form once one is picked. */
export type AgentFullLook = Required<Omit<AgentAppearance, "shape">> & { shape?: AgentShape };

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

/** Only known values (the backend's allow-list); anything else falls back to the default look. */
export function normalizeAppearance(raw: unknown): AgentAppearance {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    color:
      pick(AGENT_COLORS, o.color) ??
      (typeof o.color === "string" && HEX_COLOR.test(o.color) ? (o.color.toLowerCase() as AgentColor) : undefined),
    eyes: pick(AGENT_EYES, o.eyes),
    accessory: pick(ALL_ACCESSORIES, o.accessory),
    ...(pick(AGENT_SHAPES, o.shape) ? { shape: pick(AGENT_SHAPES, o.shape) } : {}),
  };
}
