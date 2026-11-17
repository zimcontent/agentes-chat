import {
  AGENT_EYES,
  AGENT_SHAPES,
  type AgentAccessory,
  type AgentColor,
  type AgentEyes,
  type AgentShape,
  ALL_ACCESSORIES,
  colorOf,
} from "../shared/logic";

/** An agent's look as stored, every part spelled out ("Nenhum" for no accessory). */

export interface FullLook {
  color: AgentColor;
  eyes: AgentEyes;
  accessory: AgentAccessory;
  /** The DougBot form picked on the web: kept, so a save here doesn't undo it. */
  shape?: AgentShape;
}

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;

/** An agent's look with every part set ("none" when it wears nothing). */
export function fullLook(appearance: unknown): FullLook {
  const o = (appearance && typeof appearance === "object" ? appearance : {}) as Record<string, unknown>;
  return {
    color: colorOf(o.color) ?? "sky",
    eyes: pick(AGENT_EYES, o.eyes, "round"),
    accessory: pick(ALL_ACCESSORIES, o.accessory, "none"),
    ...(typeof o.shape === "string" && (AGENT_SHAPES as readonly string[]).includes(o.shape)
      ? { shape: o.shape as AgentShape }
      : {}),
  };
}
