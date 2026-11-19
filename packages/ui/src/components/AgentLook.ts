import { AGENT_COLORS, AGENT_SHAPES, type AgentAppearance, type AgentColor } from "@dougbot/tokens/look";
import type { CSSProperties } from "react";
import { gradientOf } from "../agent/engine.js";

export {
  AGENT_ACCESSORIES,
  AGENT_BOT_ACCESSORIES,
  AGENT_COLORS,
  AGENT_EYES,
  AGENT_SHAPES,
  type AgentAccessory,
  type AgentAppearance,
  type AgentColor,
  type AgentEyes,
  type AgentFullLook,
  type AgentShape,
  normalizeAppearance,
} from "@dougbot/tokens/look";

/**
 * A random look ("Sortear") for the DougBot: a form, a color, eyes and an accessory it draws (IDENTIDADE.md §6), different
 * from `current` when possible.
 */
export function randomAppearance(current: AgentAppearance = {}, rand: () => number = Math.random): AgentAppearance {
  const one = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;
  const roll = (): AgentAppearance => ({
    shape: one(AGENT_SHAPES),
    color: one(AGENT_COLORS),
    eyes: one(RANDOM_EYES),
    accessory: one(RANDOM_ACCESSORIES),
  });
  for (let i = 0; i < 5; i++) {
    const next = roll();
    if (
      next.shape !== current.shape ||
      next.color !== current.color ||
      next.eyes !== current.eyes ||
      next.accessory !== current.accessory
    )
      return next;
  }
  return roll();
}

/** What the bot draws differently (`OLHOS_DO_PICKER`, `ACESSORIOS_DO_PICKER` in `brand/dougbot-time.ts`). */
const RANDOM_EYES = ["round", "dots", "wide", "sleepy"] as const;
const RANDOM_ACCESSORIES = ["none", "headphones", "tie", "keys"] as const;

/** Top and bottom of an agent color as fixed hex (sky as on the landing: the same in both themes). For drawing, e.g. the pixel sky. */
export function agentGradient(color: AgentColor = "sky"): [string, string] {
  return gradientOf(color);
}

/** CSS variables for the symbol's color (none for sky: the tokens). */
export function appearanceStyle(a: AgentAppearance | undefined): CSSProperties | undefined {
  if (!a?.color || a.color === "sky") return undefined;
  const [top, bottom] = gradientOf(a.color);
  return { "--av-top": top, "--av-bottom": bottom } as CSSProperties;
}
