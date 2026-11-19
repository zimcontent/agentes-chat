import { BLANK_LOOK } from "@dougbot/client/lib/new-agent";
import { type AgentAppearance, type AgentFullLook, normalizeAppearance, type RunWho } from "@dougbot/ui";

/** An agent's look for `<Avatar appearance>` (unknown values fall back to the default). */
export const lookOf = (agent: { appearance?: unknown } | undefined | null): AgentAppearance | undefined =>
  agent?.appearance ? normalizeAppearance(agent.appearance) : undefined;

/** Who an agent is, for what draws its bot or takes its color away from its face (a routine's runs). */
export const botWhoOf = (
  agent: { name: string; handle?: string | null; role?: string | null; builtin?: string | null } | undefined | null,
): RunWho | undefined =>
  agent ? { name: agent.name, handle: agent.handle, role: agent.role, builtin: agent.builtin } : undefined;

/** Every part of a look, the blank one's where it has none (the editors need all three), and its form if picked. */
export const fullLook = (a: AgentAppearance | undefined): AgentFullLook => ({
  color: a?.color ?? BLANK_LOOK.color,
  eyes: a?.eyes ?? BLANK_LOOK.eyes,
  accessory: a?.accessory ?? BLANK_LOOK.accessory,
  ...(a?.shape ? { shape: a.shape } : {}),
});
