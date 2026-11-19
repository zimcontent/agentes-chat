import type { AgentColorName, EyeStyle } from "@dougbot/ui/agent/engine";

/** What the engine needs to draw an agent. */
export interface AgentLookInput {
  color: AgentColorName;
  eyes: EyeStyle;
  /** An accessory name from the engine (`hat`, `cap`, …); "none" or unknown draws nothing. */
  accessory?: string;
  /** Optional: keeps this agent's idle life out of step with the others. */
  id?: string;
  /** Who it is, for its DougBot (`botDoAgente`: the identity's bot by name or handle, else a free bot by its trade). */
  name?: string;
  handle?: string;
  role?: string;
  /** Its real photo (a backend path), shown instead of the drawing when it loads. */
  photo?: string | null;
  /** The DougBot form picked for it: with one, the bot is drawn as picked (form, color, eyes, accessory). */
  shape?: string;
}

/**
 * Agents' looks by id, for places that only know an id (a toast with `agentId`). Screens that load the
 * agents call `rememberAgentLooks`; nothing else is stored.
 */
const looks = new Map<string, AgentLookInput>();

export function rememberAgentLooks(list: Iterable<{ id: string } & AgentLookInput>): void {
  for (const a of list)
    looks.set(a.id, {
      color: a.color,
      eyes: a.eyes,
      accessory: a.accessory,
      id: a.id,
      ...(a.name ? { name: a.name } : {}),
      ...(a.handle ? { handle: a.handle } : {}),
      ...(a.role ? { role: a.role } : {}),
      ...(a.photo ? { photo: a.photo } : {}),
      ...(a.shape ? { shape: a.shape } : {}),
    });
}

export const lookOf = (id: string): AgentLookInput | undefined => looks.get(id);
