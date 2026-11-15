import type { KeyWrapper, PubSub } from "@agenteschat/adapters";
import { and, asc, type Database, desc, eq, inArray, isNull, lt, schema, sql } from "@agenteschat/db";
import {
  DEFAULT_LIVE_VOICE,
  isLiveVoice,
  LIVE_VOICE_API,
  LIVE_VOICE_MIN_SECONDS,
  LIVE_VOICE_MODEL,
  liveVoiceCost,
  liveVoiceFor,
} from "@agenteschat/providers/live-voice";
import { type Agent, getAgent } from "./agents";
import { audienceSql } from "./audience";
import { recordAudit } from "./audit";
import { requireChannelAccess } from "./channels";
import { openSecret, sealSecret } from "./crypto";
import { ConflictError, ForbiddenError, NotFoundError, TooManyError, ValidationError } from "./errors";
import { publishUserEvent } from "./events";
import { assertLiveVoiceAllowed, recordLiveVoiceUsage } from "./gateway";
import {
  type ChatLine,
  callInstructions,
  listenInstructions,
  sampleInstructions,
  type VoiceAgent,
} from "./live-voice-prompt";
import { readableBody } from "./message-preview";
import { can, getMembership, requirePermission } from "./organizations";
import { rightHandId } from "./right-hand";

type LiveRoomLine = schema.LiveRoomLine;
type LiveRoomPerson = schema.LiveRoomPerson;

/**
 * Live voice with GPT-Live (ADR doug-0006): a workspace's OpenAI key, sessions opened from the server (the key never
 * leaves it) whose audio goes between the person's browser and OpenAI over WebRTC, and voice rooms where people and
 * agents talk. Each session is billed when it ends, through the gateway's `recordLiveVoiceUsage`.
 */

const {
  liveVoiceKeys,
  liveVoiceSessions,
  liveVoiceRooms,
  organizations,
  agents,
  users,
  messages,
  channelMembers,
  messageReactions,
} = schema;

/** A socket to OpenAI beside the browser's own connection, for the session's usage and its time limit. */
export interface SidebandSocket {
  send(data: string): void;
  close(): void;
}
export type OpenSideband = (
  url: string,
  apiKey: string,
  on: { message(data: string): void; close(): void },
) => SidebandSocket;

export interface LiveVoiceDeps {
  db: Database;
  pubsub?: PubSub;
  keyWrapper: KeyWrapper;
  keyWrappers: KeyWrapper[];
  fetch?: typeof fetch;
  /** Null: no sideband (tests); the clock settles each session. */
  openSideband?: OpenSideband | null;
  /** One structured call to the workspace's small model, through the Model Gateway (`kind: router`); absent: names alone decide turns. */
  pickWithSmallModel?: (orgId: string, system: string, prompt: string) => Promise<string | null>;
  /** Posts the room's notes as a person's message (`postPersonMessage`). */
  postMessage?: (
    userId: string,
    orgId: string,
    channelId: string,
    body: string,
    meta: Record<string, unknown>,
  ) => Promise<{ id: string }>;
  now?: () => Date;
}

const now = (deps: LiveVoiceDeps) => deps.now?.() ?? new Date();
const AAD = (orgId: string) => `live-voice-key|${orgId}`;

/** How long each kind of session may run before the server closes it. */
export const LIVE_VOICE_MAX_SECONDS = { call: 60 * 60, listen: 6 * 60, sample: 30 } as const;
/** Sessions one person may have open at once: a room's agents. */
const MAX_OPEN_SESSIONS = 8;
/** Agents on one call. */
export const LIVE_ROOM_MAX_AGENTS = 5;
/** Without a ping for this long, a person left the room. */
const PERSON_GONE_MS = 60_000;
const MAX_LINES = 3000;

// ─── The key ─────────────────────────────────────────────────────────────────

export interface LiveVoiceView {
  /** `ok`: calls and "Ouvir" work. `off`: no key. */
  state: "off" | "ok";
  /** Its last 4 characters, for who configures the workspace. */
  hint: string | null;
  editable: boolean;
}

export async function liveVoiceView(deps: LiveVoiceDeps, userId: string, orgId: string): Promise<LiveVoiceView> {
  const membership = await getMembership(deps.db, userId, orgId);
  if (!membership) throw new ForbiddenError();
  const editable = can(membership, "configure");
  const [row] = await deps.db
    .select({ hint: liveVoiceKeys.keyHint })
    .from(liveVoiceKeys)
    .where(eq(liveVoiceKeys.orgId, orgId));
  return { state: row ? "ok" : "off", hint: row && editable ? row.hint : null, editable };
}

/** What OpenAI says of a key: it opens GPT-Live, it is refused, or it has no access to the model. */
async function checkKey(deps: LiveVoiceDeps, apiKey: string) {
  const res = await (deps.fetch ?? fetch)(`${LIVE_VOICE_API}/models/${LIVE_VOICE_MODEL}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (res?.ok) return;
  if (res && (res.status === 401 || res.status === 403))
    throw new ValidationError("OpenAI refused this key", "live_voice.key_invalid");
  if (res?.status === 404)
    throw new ValidationError("This key's OpenAI project has no access to GPT-Live", "live_voice.no_access");
  throw new ValidationError("Couldn't check the key with OpenAI. Try again.", "live_voice.unchecked");
}

export async function saveLiveVoiceKey(deps: LiveVoiceDeps, userId: string, orgId: string, rawKey: string) {
  await requirePermission(deps.db, userId, orgId, "configure");
  const apiKey = rawKey.trim();
  if (!/^[\x21-\x7e]{20,300}$/.test(apiKey))
    throw new ValidationError("That isn't an OpenAI key", "live_voice.key_invalid");
  await checkKey(deps, apiKey);
  const sealed = await sealSecret(deps.keyWrapper, apiKey, AAD(orgId));
  const hint = apiKey.slice(-4);
  const values = { ...sealed, keyHint: hint, updatedBy: userId, updatedAt: now(deps) };
  await deps.db
    .insert(liveVoiceKeys)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: liveVoiceKeys.orgId, set: values });
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "live_voice.key_saved",
    target: { type: "live_voice", id: orgId },
    details: { hint },
  });
  return liveVoiceView(deps, userId, orgId);
}

export async function removeLiveVoiceKey(deps: LiveVoiceDeps, userId: string, orgId: string) {
  await requirePermission(deps.db, userId, orgId, "configure");
  await deps.db.delete(liveVoiceKeys).where(eq(liveVoiceKeys.orgId, orgId));
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "live_voice.key_removed",
    target: { type: "live_voice", id: orgId },
  });
  return liveVoiceView(deps, userId, orgId);
}

async function openKey(deps: LiveVoiceDeps, orgId: string): Promise<string> {
  const [row] = await deps.db.select().from(liveVoiceKeys).where(eq(liveVoiceKeys.orgId, orgId));
  const key = row ? await openSecret(deps.keyWrappers, row, AAD(orgId)).catch(() => null) : null;
  if (!key) throw new ValidationError("This workspace has no GPT-Live key", "live_voice.off");
  return key;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

interface Watch {
  socket: SidebandSocket | null;
  seconds: number | null;
  timers: ReturnType<typeof setTimeout>[];
}
/** This process's sessions in progress: their sideband and timers. */
const watching = new Map<string, Watch>();

/** A timer that doesn't keep the process up on its own. */
const unref = (t: ReturnType<typeof setTimeout>) => {
  (t as { unref?: () => void }).unref?.();
  return t;
};

const clockSeconds = (startedAt: Date, at: Date) =>
  Math.max(0, Math.round((at.getTime() - startedAt.getTime()) / 1000));

/** Ends a session once: its seconds, its cost, one usage row. Later calls do nothing. */
async function settle(deps: LiveVoiceDeps, id: string, reason: string, reported?: number | null) {
  const watch = watching.get(id);
  watching.delete(id);
  if (watch) {
    for (const t of watch.timers) clearTimeout(t);
    try {
      watch.socket?.close();
    } catch {}
  }
  const [row] = await deps.db.select().from(liveVoiceSessions).where(eq(liveVoiceSessions.id, id));
  if (!row || row.endedAt) return;
  const at = now(deps);
  const max = LIVE_VOICE_MAX_SECONDS[row.kind] + 60;
  const counted = reported ?? watch?.seconds ?? null;
  const seconds = Math.min(max, counted ?? clockSeconds(row.startedAt, at));
  const billed = row.providerSessionId ? seconds : 0;
  const cost = row.providerSessionId ? liveVoiceCost(billed) : 0;
  const [ended] = await deps.db
    .update(liveVoiceSessions)
    .set({ endedAt: at, endReason: reason, seconds: billed, costNanoUsd: cost })
    .where(and(eq(liveVoiceSessions.id, id), isNull(liveVoiceSessions.endedAt)))
    .returning({ id: liveVoiceSessions.id });
  if (!ended || cost === 0) return;
  await recordLiveVoiceUsage(
    deps.db,
    { orgId: row.orgId, agentId: row.agentId, personId: row.userId, model: LIVE_VOICE_MODEL, costNanoUsd: cost },
    at,
  );
}

/** Sessions this process lost track of (a restart): settled by the clock, up to their limit. */
export async function sweepLiveVoiceSessions(deps: LiveVoiceDeps, orgId?: string) {
  const old = new Date(now(deps).getTime() - (LIVE_VOICE_MAX_SECONDS.call + 300) * 1000);
  const rows = await deps.db
    .select({ id: liveVoiceSessions.id })
    .from(liveVoiceSessions)
    .where(
      and(
        isNull(liveVoiceSessions.endedAt),
        lt(liveVoiceSessions.startedAt, old),
        orgId ? eq(liveVoiceSessions.orgId, orgId) : undefined,
      ),
    )
    .limit(100);
  for (const r of rows) await settle(deps, r.id, "swept");
}

function watchSession(deps: LiveVoiceDeps, id: string, providerSessionId: string, apiKey: string, maxSeconds: number) {
  const watch: Watch = { socket: null, seconds: null, timers: [] };
  watching.set(id, watch);
  const closeNow = () => watch.socket?.send(JSON.stringify({ type: "session.close" }));
  // At its limit OpenAI is asked to close it; if nothing answers, the clock settles it.
  watch.timers.push(unref(setTimeout(closeNow, maxSeconds * 1000)));
  watch.timers.push(unref(setTimeout(() => void settle(deps, id, "limit").catch(() => {}), (maxSeconds + 30) * 1000)));
  if (!deps.openSideband) return;
  try {
    watch.socket = deps.openSideband(
      `${LIVE_VOICE_API.replace(/^http/, "ws")}/live/sessions/${providerSessionId}/attach`,
      apiKey,
      {
        message(data) {
          let event: { type?: string; usage?: { seconds?: number }; reason?: string };
          try {
            event = JSON.parse(data);
          } catch {
            return;
          }
          if (typeof event.usage?.seconds === "number") watch.seconds = event.usage.seconds;
          if (event.type === "session.closed")
            void settle(deps, id, event.reason ?? "closed", watch.seconds).catch(() => {});
        },
        close() {
          // The session may still run in the browser: what OpenAI counted so far, and the clock after it.
          watch.socket = null;
        },
      },
    );
  } catch {
    watch.socket = null;
  }
}

/** A Bun WebSocket with the key in its headers (Bun's own option): the sideband. */
export const bunSideband: OpenSideband = (url, apiKey, on) => {
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } } as unknown as string[]);
  ws.onmessage = (e) =>
    on.message(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
  ws.onclose = () => on.close();
  ws.onerror = () => {};
  return {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => ws.close(),
  };
};

/** A stable, anonymous id for the person, as OpenAI asks for abuse checks. */
async function safetyId(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`agentes-live|${userId}`));
  return Buffer.from(digest).toString("hex").slice(0, 32);
}

async function createAtOpenAI(
  deps: LiveVoiceDeps,
  apiKey: string,
  userId: string,
  input: { instructions: string; voice: string; sdp: string },
): Promise<{ sessionId: string; sdp: string; voice: string }> {
  const sid = await safetyId(userId);
  const send = async (voice: string) => {
    const res = await (deps.fetch ?? fetch)(`${LIVE_VOICE_API}/live/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": sid,
      },
      body: JSON.stringify({
        session: {
          model: LIVE_VOICE_MODEL,
          instructions: input.instructions,
          audio: { output: { voice } },
          delegation: { type: "client" },
        },
        transport: { type: "webrtc", sdp: input.sdp },
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    return res;
  };
  let voice = input.voice;
  let res = await send(voice);
  // A voice OpenAI doesn't know refuses the session: once more with the default one.
  if (res && res.status === 400 && voice !== DEFAULT_LIVE_VOICE) {
    const detail = await res
      .clone()
      .text()
      .catch(() => "");
    if (/voice/i.test(detail)) {
      voice = DEFAULT_LIVE_VOICE;
      res = await send(voice);
    }
  }
  if (!res) throw new TooManyError("OpenAI didn't answer. Try again.", "live_voice.unavailable");
  if (res.status === 401 || res.status === 403)
    throw new ValidationError("OpenAI refused the workspace's GPT-Live key", "live_voice.key_invalid");
  if (res.status === 429) throw new TooManyError("OpenAI is busy or the key's quota ran out", "live_voice.busy");
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new ValidationError(`OpenAI refused the session: ${res.status} ${detail}`, "live_voice.refused");
  }
  const body = (await res.json()) as { session?: { id?: string }; transport?: { sdp?: string } };
  if (!body.session?.id || !body.transport?.sdp)
    throw new ValidationError("OpenAI's answer had no session", "live_voice.refused");
  return { sessionId: body.session.id, sdp: body.transport.sdp, voice };
}

const voiceAgent = (a: Agent): VoiceAgent => ({ id: a.id, name: a.name, role: a.role, instructions: a.instructions });

async function orgOf(deps: LiveVoiceDeps, orgId: string) {
  const [org] = await deps.db
    .select({ name: organizations.name, context: organizations.context })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) throw new NotFoundError();
  return org;
}

async function personName(deps: LiveVoiceDeps, userId: string) {
  const [u] = await deps.db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name || "the person";
}

/** Agents of the workspace this person may talk to, here: the others are left out. */
async function talkableAgents(deps: LiveVoiceDeps, userId: string, orgId: string, channelId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await deps.db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.orgId, orgId),
        inArray(agents.id, ids),
        isNull(agents.archivedAt),
        isNull(agents.deletedAt),
        audienceSql("agents", sql`${userId}::text`, { channelId: sql`${channelId}::uuid` }),
      ),
    );
  return ids.flatMap((id) => rows.filter((r) => r.id === id));
}

/** The conversation's latest top-level messages, oldest first, as lines with their author's name. */
async function recentLines(
  deps: LiveVoiceDeps,
  orgId: string,
  channelId: string,
  options: { before?: Date; threadId?: string | null; limit: number },
) {
  const rows = await deps.db
    .select({
      body: messages.body,
      meta: messages.meta,
      authorType: messages.authorType,
      userName: users.name,
      agentName: agents.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(agents, eq(agents.id, messages.authorAgentId))
    .where(
      and(
        eq(messages.orgId, orgId),
        eq(messages.channelId, channelId),
        isNull(messages.deletedAt),
        options.threadId ? eq(messages.threadId, options.threadId) : isNull(messages.threadId),
        options.before ? lt(messages.createdAt, options.before) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(options.limit);
  return rows
    .reverse()
    .map((r) => ({
      author: (r.authorType === "agent" ? r.agentName : r.userName) ?? "someone",
      text: readableBody(r.body, r.meta),
    }))
    .filter((l) => l.text.trim());
}

export interface StartLiveSession {
  kind: "call" | "listen" | "sample";
  sdp: string;
  agentId?: string | null;
  roomId?: string | null;
  messageId?: string | null;
  voice?: string | null;
  /** The app's language. */
  language?: string | null;
}

export async function startLiveSession(deps: LiveVoiceDeps, userId: string, orgId: string, input: StartLiveSession) {
  const membership = await getMembership(deps.db, userId, orgId);
  if (!membership) throw new ForbiddenError();
  void sweepLiveVoiceSessions(deps, orgId).catch(() => {});
  const apiKey = await openKey(deps, orgId);
  const [{ open } = { open: 0 }] = await deps.db
    .select({ open: sql<number>`count(*)::int` })
    .from(liveVoiceSessions)
    .where(and(eq(liveVoiceSessions.userId, userId), isNull(liveVoiceSessions.endedAt)));
  if (Number(open) >= MAX_OPEN_SESSIONS) throw new TooManyError("Too many voice sessions open", "live_voice.too_many");
  const org = await orgOf(deps, orgId);
  const person = await personName(deps, userId);
  let agent: Agent | null = null;
  let instructions: string;
  let channelId: string | null = null;
  let messageId: string | null = null;
  let voice: string;

  if (input.kind === "call") {
    const room = await liveRoom(deps, orgId, input.roomId ?? "");
    if (room.hostUserId !== userId)
      throw new ForbiddenError("Only the room's host runs its agents", "live_voice.not_host");
    if (!input.agentId || !room.agentIds.includes(input.agentId)) throw new NotFoundError("Agent not in this room");
    channelId = room.channelId;
    [agent = null] = await talkableAgents(deps, userId, orgId, room.channelId, [input.agentId]);
    if (!agent) throw new NotFoundError("Agent not found");
    const all = await deps.db.select().from(agents).where(inArray(agents.id, room.agentIds));
    const people = await namesOf(
      deps,
      presentPeople(room, now(deps)).map((p) => p.userId),
    );
    const channel = await channelName(deps, room.channelId);
    instructions = callInstructions({
      agent: voiceAgent(agent),
      others: all.filter((a) => a.id !== agent?.id).map((a) => ({ name: a.name, role: a.role })),
      people: people.length ? people : [person],
      host: room.agentIds[0] === agent.id && room.lines.length === 0,
      orgName: org.name,
      orgContext: org.context,
      channel,
      recent: await recentLines(deps, orgId, room.channelId, { limit: 15 }),
      callSoFar: await linesAsChat(deps, room.lines.slice(-40)),
      language: input.language ?? null,
    });
    voice = liveVoiceFor(agent.id, agent.voice);
  } else if (input.kind === "listen") {
    const [message] = await deps.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, input.messageId ?? sql`null`), eq(messages.orgId, orgId), isNull(messages.deletedAt)));
    if (!message) throw new NotFoundError("Message not found");
    await requireChannelAccess(deps.db, userId, orgId, message.channelId);
    channelId = message.channelId;
    messageId = message.id;
    const body = readableBody(message.body, message.meta);
    if (!body.trim()) throw new ValidationError("This message has no words to tell", "live_voice.no_words");
    // An agent's own message is told by that agent; a person's, by the workspace's narrator voice.
    agent = message.authorAgentId ? await getAgent(deps.db, orgId, message.authorAgentId) : null;
    const author = agent?.name ?? (message.authorUserId ? await personName(deps, message.authorUserId) : "someone");
    instructions = listenInstructions({
      agent: agent ? voiceAgent(agent) : null,
      ownMessage: Boolean(agent),
      author,
      person,
      orgName: org.name,
      orgContext: org.context,
      channel: await channelName(deps, message.channelId),
      body,
      reactions: await reactionLines(deps, orgId, message.id),
      before: await recentLines(deps, orgId, message.channelId, {
        before: message.createdAt,
        threadId: message.threadId,
        limit: 6,
      }),
      language: input.language ?? null,
    });
    voice = agent ? liveVoiceFor(agent.id, agent.voice) : DEFAULT_LIVE_VOICE;
  } else {
    agent = input.agentId ? await getAgent(deps.db, orgId, input.agentId) : null;
    if (input.agentId && (!agent || agent.archivedAt)) throw new NotFoundError("Agent not found");
    instructions = sampleInstructions({
      agent: agent ? voiceAgent(agent) : null,
      language: input.language ?? null,
      orgName: org.name,
    });
    voice = isLiveVoice(input.voice) ? input.voice : agent ? liveVoiceFor(agent.id, agent.voice) : DEFAULT_LIVE_VOICE;
  }

  await assertLiveVoiceAllowed(deps.db, orgId, agent, userId);
  const [row] = await deps.db
    .insert(liveVoiceSessions)
    .values({
      orgId,
      userId,
      kind: input.kind,
      agentId: agent?.id ?? null,
      channelId,
      messageId,
      callId: input.kind === "call" ? (input.roomId ?? null) : null,
      voice,
      startedAt: now(deps),
    })
    .returning();
  if (!row) throw new Error("live voice session not stored");
  let made: Awaited<ReturnType<typeof createAtOpenAI>>;
  try {
    made = await createAtOpenAI(deps, apiKey, userId, { instructions, voice, sdp: input.sdp });
  } catch (error) {
    await settle(deps, row.id, "refused");
    throw error;
  }
  await deps.db
    .update(liveVoiceSessions)
    .set({ providerSessionId: made.sessionId, voice: made.voice })
    .where(eq(liveVoiceSessions.id, row.id));
  const maxSeconds = LIVE_VOICE_MAX_SECONDS[input.kind];
  watchSession(deps, row.id, made.sessionId, apiKey, maxSeconds);
  return { id: row.id, sdp: made.sdp, voice: made.voice, maxSeconds, minSeconds: LIVE_VOICE_MIN_SECONDS };
}

/** The app ended a session: OpenAI is asked to close it, and the server settles it once it says so (or soon after). */
export async function endLiveSession(deps: LiveVoiceDeps, userId: string, orgId: string, id: string) {
  const [row] = await deps.db
    .select()
    .from(liveVoiceSessions)
    .where(and(eq(liveVoiceSessions.id, id), eq(liveVoiceSessions.orgId, orgId)));
  if (!row || row.userId !== userId) throw new NotFoundError("Session not found");
  if (row.endedAt) return;
  const watch = watching.get(id);
  if (watch?.socket) {
    watch.socket.send(JSON.stringify({ type: "session.close" }));
    watch.timers.push(unref(setTimeout(() => void settle(deps, id, "ended").catch(() => {}), 15_000)));
    return;
  }
  await settle(deps, id, "ended");
}

async function channelName(deps: LiveVoiceDeps, channelId: string) {
  const [c] = await deps.db
    .select({ name: schema.channels.name, displayName: schema.channels.displayName, kind: schema.channels.kind })
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId));
  return c && c.kind === "channel" ? (c.displayName ?? c.name) : null;
}

async function reactionLines(deps: LiveVoiceDeps, orgId: string, messageId: string) {
  const rows = await deps.db
    .select({ reaction: messageReactions.reaction, userName: users.name, agentName: agents.name })
    .from(messageReactions)
    .leftJoin(users, eq(users.id, messageReactions.userId))
    .leftJoin(agents, eq(agents.id, messageReactions.agentId))
    .where(and(eq(messageReactions.orgId, orgId), eq(messageReactions.messageId, messageId)))
    .orderBy(asc(messageReactions.createdAt));
  const by = new Map<string, string[]>();
  for (const r of rows) {
    const label = r.reaction === "+1" ? "👍" : r.reaction === "-1" ? "👎" : r.reaction;
    by.set(label, [...(by.get(label) ?? []), r.userName ?? r.agentName ?? "someone"]);
  }
  return [...by].map(([emoji, who]) => `${emoji} ${who.join(", ")}`);
}

async function namesOf(deps: LiveVoiceDeps, userIds: string[]) {
  if (!userIds.length) return [];
  const rows = await deps.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
  return userIds.flatMap((id) => rows.filter((r) => r.id === id).map((r) => r.name || "someone"));
}

async function linesAsChat(deps: LiveVoiceDeps, lines: LiveRoomLine[]): Promise<ChatLine[]> {
  const names = await whoNames(deps, lines);
  return lines.map((l) => ({ author: names.get(l.who.id) ?? "someone", text: l.text }));
}

async function whoNames(deps: LiveVoiceDeps, lines: Pick<LiveRoomLine, "who">[]) {
  const people = [...new Set(lines.filter((l) => l.who.type === "person").map((l) => l.who.id))];
  const bots = [...new Set(lines.filter((l) => l.who.type === "agent").map((l) => l.who.id))];
  const [p, a] = await Promise.all([
    people.length
      ? deps.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, people))
      : [],
    bots.length
      ? deps.db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, bots))
      : [],
  ]);
  return new Map<string, string>([
    ...p.map((r) => [r.id, r.name || "someone"] as const),
    ...a.map((r) => [r.id, r.name] as const),
  ]);
}

// ─── Rooms ───────────────────────────────────────────────────────────────────

type Room = typeof liveVoiceRooms.$inferSelect;

export interface LiveRoomView {
  id: string;
  channelId: string;
  hostUserId: string | null;
  agentIds: string[];
  /** Who is in now. */
  people: { userId: string; joinedAt: string }[];
  status: "live" | "ended";
  startedAt: string;
  endedAt: string | null;
  /** The latest lines (captions for who joins late). */
  lines: LiveRoomLine[];
  reportMessageId: string | null;
}

const presentPeople = (room: Room, at: Date) =>
  room.people.filter((p) => !p.leftAt && at.getTime() - new Date(p.seenAt).getTime() < PERSON_GONE_MS);

const roomView = (room: Room, at: Date): LiveRoomView => ({
  id: room.id,
  channelId: room.channelId,
  hostUserId: room.hostUserId,
  agentIds: room.agentIds,
  people:
    room.status === "live" ? presentPeople(room, at).map((p) => ({ userId: p.userId, joinedAt: p.joinedAt })) : [],
  status: room.status,
  startedAt: room.startedAt.toISOString(),
  endedAt: room.endedAt?.toISOString() ?? null,
  lines: room.lines.slice(-30),
  reportMessageId: room.reportMessageId,
});

async function liveRoom(deps: LiveVoiceDeps, orgId: string, roomId: string) {
  const [room] = await deps.db
    .select()
    .from(liveVoiceRooms)
    .where(and(eq(liveVoiceRooms.id, roomId), eq(liveVoiceRooms.orgId, orgId), eq(liveVoiceRooms.status, "live")));
  if (!room) throw new NotFoundError("This call has ended", "live_room.ended");
  return room;
}

/** Tells everyone in the room, and who reads its conversation (its "Entrar" banner), how the room is now. */
async function announce(deps: LiveVoiceDeps, room: Room, alsoChannel = false) {
  const view = roomView(room, now(deps));
  const to = new Set(view.people.map((p) => p.userId));
  if (alsoChannel) {
    const members = await deps.db
      .select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, room.channelId), eq(channelMembers.orgId, room.orgId)));
    for (const m of members) if (m.userId) to.add(m.userId);
  }
  for (const ev of room.people) if (room.status === "ended") to.add(ev.userId);
  await Promise.all(
    [...to].map((u) => publishUserEvent(deps.pubsub, room.orgId, u, { type: "live.room", room: view })),
  );
}

/** Hands the room to the next person in when its host is gone; ends it when nobody is left. */
async function tidyRoom(deps: LiveVoiceDeps, room: Room): Promise<{ room: Room; changed: boolean }> {
  const at = now(deps);
  const present = presentPeople(room, at);
  if (!present.length) {
    const ended = await endRoom(deps, null, room.orgId, room.id, "empty");
    return { room: ended ?? room, changed: true };
  }
  if (room.hostUserId && present.some((p) => p.userId === room.hostUserId)) return { room, changed: false };
  const [next] = await deps.db
    .update(liveVoiceRooms)
    .set({ hostUserId: present[0]?.userId ?? null })
    .where(eq(liveVoiceRooms.id, room.id))
    .returning();
  return { room: next ?? room, changed: true };
}

/** The live room of a conversation, for its banner; null when none. */
export async function channelLiveRoom(deps: LiveVoiceDeps, userId: string, orgId: string, channelId: string) {
  await requireChannelAccess(deps.db, userId, orgId, channelId);
  const [room] = await deps.db
    .select()
    .from(liveVoiceRooms)
    .where(
      and(eq(liveVoiceRooms.orgId, orgId), eq(liveVoiceRooms.channelId, channelId), eq(liveVoiceRooms.status, "live")),
    );
  if (!room) return null;
  const tidy = await tidyRoom(deps, room);
  if (tidy.changed) await announce(deps, tidy.room, true);
  return tidy.room.status === "live" ? roomView(tidy.room, now(deps)) : null;
}

/** Starts the conversation's room, or joins it when one is live (its agents stay as they are). */
export async function joinLiveRoom(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  channelId: string,
  input: { agentIds: string[] },
) {
  const { membership } = await requireChannelAccess(deps.db, userId, orgId, channelId);
  if (!can(membership, "post")) throw new ForbiddenError();
  const at = now(deps);
  const iso = at.toISOString();
  const existing = await channelLiveRoom(deps, userId, orgId, channelId);
  let room: Room | undefined;
  if (!existing) {
    const wanted = [...new Set(input.agentIds)].slice(0, LIVE_ROOM_MAX_AGENTS);
    const talkable = await talkableAgents(deps, userId, orgId, channelId, wanted);
    if (talkable.length) await openKey(deps, orgId);
    [room] = await deps.db
      .insert(liveVoiceRooms)
      .values({
        orgId,
        channelId,
        hostUserId: userId,
        agentIds: talkable.map((a) => a.id),
        people: [{ userId, joinedAt: iso, seenAt: iso, leftAt: null }],
        startedAt: at,
      })
      .onConflictDoNothing()
      .returning();
  }
  if (!room) {
    const current = existing ?? (await channelLiveRoom(deps, userId, orgId, channelId));
    if (!current) throw new ConflictError("The call ended. Start it again.", "live_room.ended");
    room = await touchPerson(deps, current.id, userId, iso, true);
  }
  await announce(deps, room, true);
  return roomView(room, at);
}

/** Marks a person in (`join`) or alive; returns the room as it is after. */
async function touchPerson(deps: LiveVoiceDeps, roomId: string, userId: string, iso: string, join: boolean) {
  const [room] = await deps.db.select().from(liveVoiceRooms).where(eq(liveVoiceRooms.id, roomId));
  if (room?.status !== "live") throw new NotFoundError("This call has ended", "live_room.ended");
  const mine = room.people.find((p) => p.userId === userId);
  if (!join && (!mine || mine.leftAt)) throw new NotFoundError("You're not in this call", "live_room.not_in");
  const people: LiveRoomPerson[] = mine
    ? room.people.map((p) =>
        p.userId === userId ? { ...p, seenAt: iso, leftAt: null, joinedAt: p.leftAt ? iso : p.joinedAt } : p,
      )
    : [...room.people, { userId, joinedAt: iso, seenAt: iso, leftAt: null }];
  const [next] = await deps.db.update(liveVoiceRooms).set({ people }).where(eq(liveVoiceRooms.id, roomId)).returning();
  return next ?? room;
}

/** "I'm still here", every 20 seconds or so; it also hands the room over or ends it for who left without saying. */
export async function pingLiveRoom(deps: LiveVoiceDeps, userId: string, orgId: string, roomId: string) {
  const before = await liveRoom(deps, orgId, roomId);
  const presentBefore = presentPeople(before, now(deps)).length;
  const room = await touchPerson(deps, roomId, userId, now(deps).toISOString(), false);
  const tidy = await tidyRoom(deps, room);
  if (tidy.changed || presentPeople(tidy.room, now(deps)).length !== presentBefore) await announce(deps, tidy.room);
  return roomView(tidy.room, now(deps));
}

export async function leaveLiveRoom(deps: LiveVoiceDeps, userId: string, orgId: string, roomId: string) {
  const room = await liveRoom(deps, orgId, roomId);
  const iso = now(deps).toISOString();
  const people = room.people.map((p) => (p.userId === userId ? { ...p, leftAt: iso } : p));
  const [left] = await deps.db.update(liveVoiceRooms).set({ people }).where(eq(liveVoiceRooms.id, roomId)).returning();
  if (!left) return;
  const tidy = await tidyRoom(deps, left);
  if (tidy.room.status === "live") await announce(deps, tidy.room, true);
}

async function requireInRoom(deps: LiveVoiceDeps, userId: string, orgId: string, roomId: string) {
  const room = await liveRoom(deps, orgId, roomId);
  if (!presentPeople(room, now(deps)).some((p) => p.userId === userId))
    throw new ForbiddenError("You're not in this call", "live_room.not_in");
  return room;
}

/** WebRTC's offers, answers and candidates between two people in the room, passed on as they are. */
export async function relayLiveSignal(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  to: string,
  data: unknown,
) {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  if (!presentPeople(room, now(deps)).some((p) => p.userId === to)) throw new NotFoundError("Not in this call");
  await publishUserEvent(deps.pubsub, orgId, to, { type: "live.signal", roomId, from: userId, data });
}

/** What was said: a person's own words, or (from the host) the agents'. Kept for the notes and shown to the others. */
export async function addLiveLines(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  input: { who: { type: "person" | "agent"; id: string }; text: string }[],
) {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  const at = now(deps).toISOString();
  const lines: LiveRoomLine[] = input
    .filter((l) =>
      l.who.type === "person" ? l.who.id === userId : room.hostUserId === userId && room.agentIds.includes(l.who.id),
    )
    .map((l) => ({ at, who: l.who, text: l.text.trim().slice(0, 2000) }))
    .filter((l) => l.text);
  if (!lines.length) return;
  await deps.db
    .update(liveVoiceRooms)
    .set({
      lines: sql`(case when jsonb_array_length(${liveVoiceRooms.lines}) > ${MAX_LINES} then '[]'::jsonb else ${liveVoiceRooms.lines} end) || ${JSON.stringify(lines)}::jsonb`,
    })
    .where(eq(liveVoiceRooms.id, roomId));
  const others = presentPeople(room, now(deps)).filter((p) => p.userId !== userId);
  await Promise.all(
    others.map((p) => publishUserEvent(deps.pubsub, orgId, p.userId, { type: "live.lines", roomId, lines })),
  );
}

/** Who has the word now (an agent, or null: the people). Anyone in may give it; the host's app applies it. */
export async function setLiveFloor(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  holder: string | null,
  reason: string,
) {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  if (holder && !room.agentIds.includes(holder)) throw new NotFoundError("Agent not in this call");
  await Promise.all(
    presentPeople(room, now(deps)).map((p) =>
      publishUserEvent(deps.pubsub, orgId, p.userId, { type: "live.floor", roomId, holder, by: userId, reason }),
    ),
  );
}

/**
 * Whether an agent should answer what a person just said to nobody by name, and which: a judgment, so the workspace's
 * small model makes it. It answers "none" unless the people clearly wait for the AI side, which keeps agents from
 * talking over a conversation between people.
 */
export async function pickLiveSpeaker(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
): Promise<{ agentId: string | null }> {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  if (room.hostUserId !== userId || !deps.pickWithSmallModel || !room.agentIds.length) return { agentId: null };
  const roster = await deps.db
    .select({ id: agents.id, name: agents.name, handle: agents.handle, role: agents.role })
    .from(agents)
    .where(inArray(agents.id, room.agentIds));
  const recent = await linesAsChat(deps, room.lines.slice(-14));
  if (!recent.length) return { agentId: null };
  const system = [
    "You moderate a live voice call between people and AI agents. Decide whether one agent should speak next, and which.",
    'Answer only JSON: {"speaker": "<handle>"} or {"speaker": "none"}.',
    "Pick an agent only when the last thing said is clearly waiting for an answer from the AI side: a question or request to the group that fits an agent's role, or a direct follow-up to what an agent just said.",
    'Answer "none" when people are talking to each other, thinking aloud, or when an agent just spoke and nobody asked it anything. When in doubt, "none".',
    `Agents:\n${roster.map((a) => `- ${a.handle}: ${a.name}${a.role ? `, ${a.role}` : ""}`).join("\n")}`,
  ].join("\n");
  const prompt = `The call, latest last:\n${recent.map((l) => `${l.author}: ${l.text}`).join("\n")}`;
  const text = await deps.pickWithSmallModel(orgId, system, prompt).catch(() => null);
  const handle = text ? /"speaker"\s*:\s*"([^"]+)"/.exec(text)?.[1]?.replace(/^@/, "").toLowerCase() : null;
  return { agentId: roster.find((a) => a.handle === handle)?.id ?? null };
}

/** Ends the call for everyone and leaves its notes in the conversation, for the team's right hand to report on. */
export async function endRoom(
  deps: LiveVoiceDeps,
  userId: string | null,
  orgId: string,
  roomId: string,
  reason: "ended" | "empty",
): Promise<Room | null> {
  const at = now(deps);
  const [room] = await deps.db
    .update(liveVoiceRooms)
    .set({ status: "ended", endedAt: at })
    .where(and(eq(liveVoiceRooms.id, roomId), eq(liveVoiceRooms.orgId, orgId), eq(liveVoiceRooms.status, "live")))
    .returning();
  if (!room) return null;
  await announce(deps, room, true);
  const author = userId ?? room.hostUserId ?? room.people.at(-1)?.userId ?? null;
  if (!author || !deps.postMessage || room.lines.length < 2) return room;
  try {
    const body = await notesBody(deps, room, at);
    const posted = await deps.postMessage(author, orgId, room.channelId, body, {
      liveRoom: { id: room.id, endedBy: reason },
    });
    const [done] = await deps.db
      .update(liveVoiceRooms)
      .set({ reportMessageId: posted.id })
      .where(eq(liveVoiceRooms.id, room.id))
      .returning();
    return done ?? room;
  } catch {
    return room;
  }
}

export async function endLiveRoom(deps: LiveVoiceDeps, userId: string, orgId: string, roomId: string) {
  await requireInRoom(deps, userId, orgId, roomId);
  const room = await endRoom(deps, userId, orgId, roomId, "ended");
  return room ? roomView(room, now(deps)) : null;
}

/** The notes: who was on, how long, every line; asking the right hand for the report when the workspace has one. */
async function notesBody(deps: LiveVoiceDeps, room: Room, at: Date) {
  const names = await whoNames(deps, [
    ...room.lines,
    ...room.people.map((p) => ({ who: { type: "person" as const, id: p.userId } })),
    ...room.agentIds.map((id) => ({ who: { type: "agent" as const, id } })),
  ]);
  const minutes = Math.max(1, Math.round((at.getTime() - room.startedAt.getTime()) / 60_000));
  const people = [...new Set(room.people.map((p) => names.get(p.userId) ?? "someone"))];
  const bots = room.agentIds.map((id) => names.get(id) ?? "agent");
  const lead = await rightHandId(deps.db, room.orgId).catch(() => null);
  const [boss] = lead ? await deps.db.select({ handle: agents.handle }).from(agents).where(eq(agents.id, lead)) : [];
  // Each line once, merged when the same voice goes on; the latest part when it is too long for one message.
  const merged: { who: string; text: string }[] = [];
  for (const l of room.lines) {
    const who = names.get(l.who.id) ?? "someone";
    const last = merged.at(-1);
    if (last && last.who === who) last.text = `${last.text} ${l.text}`;
    else merged.push({ who, text: l.text });
  }
  let transcript = merged.map((l) => `**${l.who}:** ${l.text}`).join("\n");
  if (transcript.length > 24_000) transcript = `…\n${transcript.slice(-24_000)}`;
  const ask = boss
    ? `@${boss.handle} a reunião de voz terminou. Mande o relatório: o que foi decidido, os próximos passos com responsável e prazo, e o que ficou em aberto.`
    : "Notas da reunião de voz.";
  return [ask, "", `**Reunião de voz** · ${minutes} min · ${[...people, ...bots].join(", ")}`, "", transcript].join(
    "\n",
  );
}
