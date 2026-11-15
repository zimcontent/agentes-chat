/**
 * Who has the word in a voice room (ADR doug-0006). Code, not a model, decides when; the server's small model (`next`)
 * only says who would add something. An agent speaks when someone calls it by name, when it is a call with one person
 * and one agent, or right after it spoke and the person answers. Among agents: one may bring a colleague in by name, or
 * the small model may pick one to add to what was said (`after`). That never runs away: past `MAX_AGENT_TURNS` agent
 * turns without a person speaking (each agent once), the word goes back to the people, the meeting's lead listening for
 * them. With one person on the call, everything they say is for the agents: the agent with the word keeps it, and
 * with nobody, the lead. With several people, an agent keeps the word for a while after it got it or spoke, and past
 * that `ask` says to ask the small model, which answers "none" unless the people clearly wait for an agent.
 */

export interface FloorAgent {
  id: string;
  name: string;
  handle: string;
}

export interface FloorState {
  /** The agent with the word; null: the people (every agent listens). */
  holder: string | null;
  /** Handoffs and interruptions from agent to agent since a person last spoke. */
  chain: number;
  /** Each agent turn since a person last spoke, in order (an agent twice when it spoke twice). */
  spoke: string[];
  /** When an agent last finished a turn (ms). */
  lastAgentAt: number;
  /** When the agent with the word got it (ms): one that hasn't spoken yet keeps it as long as one that just did. */
  givenAt: number;
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

/** Agent-to-agent passes (by name or picked) before a person must speak again. */
export const MAX_AGENT_CHAIN = 2;
/** Agent turns in a row without a person: an answer and two colleagues on it, then the people. */
export const MAX_AGENT_TURNS = 3;
/** Turns one agent may take in that stretch: never back and forth. */
export const MAX_TURNS_EACH = 1;
/** An agent that just spoke keeps the word this long for the person's answer. */
export const CONTINUE_MS = 20_000;

export const initialFloor = (holder: string | null = null, now = 0): FloorState => ({
  holder,
  chain: 0,
  spoke: [],
  lastAgentAt: 0,
  givenAt: holder ? now : 0,
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

const give = (
  state: FloorState,
  holder: string | null,
  reason: FloorReason,
  ask = false,
  now?: number,
): FloorDecision => ({
  state: { ...state, holder, givenAt: holder && holder !== state.holder && now !== undefined ? now : state.givenAt },
  changed: holder !== state.holder || reason === "judge" || reason === "manual",
  reason,
  ask,
});

/** A person said something (a whole sentence): who gets the word. */
export function afterPerson(
  state: FloorState,
  text: string,
  room: { agents: FloorAgent[]; people: number; now: number; moderator?: string | null },
): FloorDecision {
  const fresh: FloorState = { ...state, chain: 0, spoke: [] };
  if (!room.agents.length) return give(fresh, null, "people");
  const named = namedAgent(text, room.agents);
  if (named) return give(fresh, named, "named", false, room.now);
  if (room.agents.length === 1 && room.people <= 1)
    return give(fresh, room.agents[0]?.id ?? null, "solo", false, room.now);
  const lead = room.moderator ?? null;
  // One person talks to the agents: whoever has the word goes on answering; with nobody, the meeting's lead.
  if (room.people <= 1) {
    const to = state.holder ?? lead;
    return give(fresh, to, "continue", !to, room.now);
  }
  if (state.holder && state.holder !== lead && room.now - Math.max(state.lastAgentAt, state.givenAt) < CONTINUE_MS)
    return give(fresh, state.holder, "continue");
  // Several people: the lead listens while the small model says whether an agent should answer.
  return give(fresh, lead, "people", true, room.now);
}

/** A person names an agent while still talking: it takes the word at once and hears the rest. */
export const addressed = (state: FloorState, agentId: string, now: number): FloorDecision =>
  give({ ...state, chain: 0, spoke: [] }, agentId, "named", false, now);

const turnsOf = (state: FloorState, agentId: string) => state.spoke.filter((id) => id === agentId).length;

/** Whether another agent may take the word now, among agents, without a person speaking first. */
export function mayBringIn(state: FloorState, agentId: string, extraTurn = 0): boolean {
  return (
    agentId !== state.holder &&
    state.chain < MAX_AGENT_CHAIN &&
    state.spoke.length + extraTurn < MAX_AGENT_TURNS &&
    turnsOf(state, agentId) < MAX_TURNS_EACH
  );
}

/**
 * An agent finished a turn: it hands the word to a colleague it named, or to the one the small model picked to follow
 * (`next`), or keeps it for the answer; past the limits the people have it.
 */
export function afterAgent(
  state: FloorState,
  agentId: string,
  text: string,
  room: { agents: FloorAgent[]; now: number; moderator?: string | null },
  next?: string | null,
): FloorDecision {
  const after: FloorState = { ...state, spoke: [...state.spoke, agentId], lastAgentAt: room.now };
  // Past the limits the people have the word, the meeting's lead listening for them.
  const rest = () => give(after, room.moderator ?? null, "limit", false, room.now);
  if (after.spoke.length >= MAX_AGENT_TURNS) return rest();
  const named = namedAgent(text, room.agents, agentId);
  const to = [named, next].find((id) => id && room.agents.some((a) => a.id === id) && mayBringIn(after, id));
  if (to) return give({ ...after, chain: after.chain + 1 }, to, "handoff", false, room.now);
  if (named) return rest();
  return give(after, agentId, "continue");
}

/** A colleague follows the agent that just finished (the small model's pick): null when the limits say no. */
export function bringIn(state: FloorState, to: string, now: number): FloorDecision | null {
  if (!mayBringIn(state, to)) return null;
  return give({ ...state, chain: state.chain + 1 }, to, "handoff", false, now);
}

/** Someone gave the word by hand (a tile's "Dar a palavra"), or the small model picked an agent. */
export const giveFloor = (
  state: FloorState,
  holder: string | null,
  reason: "manual" | "judge",
  now = Date.now(),
): FloorDecision => give(reason === "manual" ? { ...state, chain: 0, spoke: [] } : state, holder, reason, false, now);
