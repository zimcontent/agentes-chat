/**
 * Who has the word in a voice room (ADR doug-0006). Code, not a model: an agent speaks when someone calls it by name, when
 * it is a call with one person and one agent, or right after it spoke and the person answers. Agents may bring a
 * colleague in by name, but only a few times in a row: past `MAX_AGENT_CHAIN` handoffs (each agent once) or
 * `MAX_AGENT_TURNS` agent turns without a person speaking, the word goes back to the people and every agent listens
 * until a person speaks again. When a person speaks to nobody by name in a meeting, `ask` says to ask the server's
 * small model (`next`), which answers "none" unless the people clearly wait for an agent.
 */

export interface FloorAgent {
  id: string;
  name: string;
  handle: string;
}

export interface FloorState {
  /** The agent with the word; null: the people (every agent listens). */
  holder: string | null;
  /** Handoffs from agent to agent since a person last spoke. */
  chain: number;
  /** Agents that spoke since a person last spoke. */
  spoke: string[];
  /** When an agent last finished a turn (ms). */
  lastAgentAt: number;
}

export type FloorReason = "named" | "solo" | "continue" | "handoff" | "limit" | "people" | "manual" | "judge";

export interface FloorDecision {
  state: FloorState;
  /** The word changed hands (or was given again): the host's app applies it. */
  changed: boolean;
  reason: FloorReason;
  /** Nobody was named in a meeting: ask the small model whether an agent should answer. */
  ask: boolean;
}

export const MAX_AGENT_CHAIN = 2;
export const MAX_AGENT_TURNS = 3;
/** An agent that just spoke keeps the word this long for the person's answer. */
export const CONTINUE_MS = 20_000;

export const initialFloor = (holder: string | null = null): FloorState => ({
  holder,
  chain: 0,
  spoke: [],
  lastAgentAt: 0,
});

/** Lower case without accents: "Ágata" and "agata" are one name. */
export const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** What calls an agent: its full name, its first name (3 letters or more), its handle. */
export function namesOf(agent: FloorAgent): string[] {
  const full = fold(agent.name).trim();
  const first = full.split(/\s+/)[0] ?? "";
  const handle = fold(agent.handle);
  return [...new Set([full, first.length >= 3 ? first : "", handle, handle.replace(/[-_]/g, " ")].filter(Boolean))];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The agent a line speaks to: the first one named in it (whole words), or null. */
export function namedAgent(text: string, agents: FloorAgent[], except?: string | null): string | null {
  const folded = fold(text);
  let best: { id: string; at: number } | null = null;
  for (const agent of agents) {
    if (agent.id === except) continue;
    for (const name of namesOf(agent)) {
      const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, "u").exec(folded);
      if (match && (!best || match.index < best.at)) best = { id: agent.id, at: match.index };
    }
  }
  return best?.id ?? null;
}

const give = (state: FloorState, holder: string | null, reason: FloorReason, ask = false): FloorDecision => ({
  state: { ...state, holder },
  changed: holder !== state.holder || reason === "named" || reason === "judge" || reason === "manual",
  reason,
  ask,
});

/** A person said something (a whole sentence): who gets the word. */
export function afterPerson(
  state: FloorState,
  text: string,
  room: { agents: FloorAgent[]; people: number; now: number },
): FloorDecision {
  const fresh: FloorState = { ...state, chain: 0, spoke: [] };
  if (!room.agents.length) return give(fresh, null, "people");
  const named = namedAgent(text, room.agents);
  if (named) return give(fresh, named, "named");
  if (room.agents.length === 1 && room.people <= 1) return give(fresh, room.agents[0]?.id ?? null, "solo");
  if (state.holder && room.now - state.lastAgentAt < CONTINUE_MS) return give(fresh, state.holder, "continue");
  return give(fresh, null, "people", true);
}

/** An agent finished a turn: it keeps the word for the answer, hands it to a colleague it named, or the limit hits. */
export function afterAgent(
  state: FloorState,
  agentId: string,
  text: string,
  room: { agents: FloorAgent[]; now: number },
): FloorDecision {
  const spoke = state.spoke.includes(agentId) ? state.spoke : [...state.spoke, agentId];
  const turns = state.spoke.length + 1;
  const next: FloorState = { ...state, spoke, lastAgentAt: room.now };
  const named = namedAgent(text, room.agents, agentId);
  if (named && state.chain < MAX_AGENT_CHAIN && !spoke.includes(named) && turns < MAX_AGENT_TURNS)
    return give({ ...next, chain: state.chain + 1 }, named, "handoff");
  if (turns >= MAX_AGENT_TURNS || (named && state.chain >= MAX_AGENT_CHAIN)) return give(next, null, "limit");
  return give(next, agentId, "continue");
}

/** Someone gave the word by hand (a tile's "Dar a palavra"), or the small model picked an agent. */
export const giveFloor = (state: FloorState, holder: string | null, reason: "manual" | "judge"): FloorDecision =>
  give(reason === "manual" ? { ...state, chain: 0, spoke: [] } : state, holder, reason);
