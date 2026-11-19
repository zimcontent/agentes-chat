import type { KeyWrapper, PubSub, ZimMedia } from "@dougbot/adapters";
import { and, asc, type Database, desc, eq, inArray, isNull, lt, or, schema, sql } from "@dougbot/db";
import {
  CREDIT_NANO_USD,
  DEFAULT_HOUSE_VOICE,
  DEFAULT_LIVE_VOICE,
  HOUSE_VOICE_ENGINE,
  HOUSE_VOICE_MODEL,
  HOUSE_VOICE_SAMPLE_RATE,
  HOUSE_VOICE_URL,
  houseVoiceFor,
  isHouseVoice,
  isLiveVoice,
  LIVE_VOICE_API,
  LIVE_VOICE_MIN_SECONDS,
  LIVE_VOICE_MODEL,
  type LiveVoiceEngine,
  liveVoiceChoices,
  liveVoiceCost,
  liveVoiceFor,
} from "@dougbot/providers/live-voice";
import { type Agent, getAgent } from "./agents";
import { audienceSql } from "./audience";
import { recordAudit } from "./audit";
import { addChannelMember, requireChannelAccess } from "./channels";
import { openSecret, sealSecret } from "./crypto";
import { ConflictError, ForbiddenError, NotFoundError, TooManyError, ValidationError } from "./errors";
import { publishUserEvent } from "./events";
import { assertLiveVoiceAllowed, recordLiveVoiceUsage } from "./gateway";
import { type HouseSessionSetup, houseSession, type LiveDialectEvent } from "./live-voice-house";
import {
  agentCallInstructions,
  type ChatLine,
  callInstructions,
  listenInstructions,
  sampleInstructions,
  type VoiceAgent,
} from "./live-voice-prompt";
import { readableBody } from "./message-preview";
import { can, getMembership, requirePermission } from "./organizations";
import { rightHandId } from "./right-hand";
import { monthStartUtc } from "./usage";

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
/** A socket to the house voice's model: like the sideband, and it says when it opened. */
export type OpenHouseSocket = (
  url: string,
  apiKey: string,
  on: { open(): void; message(data: string): void; close(): void },
) => SidebandSocket;

export interface LiveVoiceDeps {
  db: Database;
  pubsub?: PubSub;
  keyWrapper: KeyWrapper;
  keyWrappers: KeyWrapper[];
  fetch?: typeof fetch;
  /** Null: no sideband (tests); the clock settles each session. */
  openSideband?: OpenSideband | null;
  /**
   * The house voice (docs/adr/doug-0036-house-voice.md): the server's Empirio key, the wallet that pays it and how a
   * socket to the model opens. Absent: calls use the workspace's GPT-Live key only.
   */
  house?: { apiKey: string; media: ZimMedia; open: OpenHouseSocket } | null;
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
  /** The server's log. */
  log?: {
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
  };
  now?: () => Date;
}

const now = (deps: LiveVoiceDeps) => deps.now?.() ?? new Date();
const AAD = (orgId: string) => `live-voice-key|${orgId}`;

/** How long each kind of session may run before the server closes it. */
export const LIVE_VOICE_MAX_SECONDS = { call: 60 * 60, agent: 60 * 60, listen: 6 * 60, sample: 30 } as const;
/** A call with one agent hangs up by itself after this long without anyone speaking (as the Nordus call did). */
export const AGENT_CALL_IDLE_MS = 5 * 60_000;
/** How long the voice waits for the agent's answer before it says it will be in the chat. */
const AGENT_ANSWER_WAIT_MS = 4 * 60_000;
/** Sessions one person may have open at once: a room's agents. */
const MAX_OPEN_SESSIONS = 8;
/** Agents on one call. */
export const LIVE_ROOM_MAX_AGENTS = 5;
/** Without a ping for this long, a person left the room. */
const PERSON_GONE_MS = 60_000;
const MAX_LINES = 3000;

// ─── The key ─────────────────────────────────────────────────────────────────

export interface LiveVoiceView {
  /** `ok`: calls and "Ouvir" work. `off`: no voice (GPT-Live chosen, or no house voice here, and no key). */
  state: "off" | "ok";
  /** The voice calls use here now (docs/adr/doug-0036-house-voice.md). */
  engine: LiveVoiceEngine;
  /** What the workspace picked; null: the default (the house voice where this server has it). */
  chosenEngine: LiveVoiceEngine | null;
  /** The workspace has its own GPT-Live key. */
  gptLiveKey: boolean;
  /** The house voice, where this server has it: its price, the wallet, and the month against its limit. */
  house: HouseVoiceView | null;
  /** Its last 4 characters, for who configures the workspace. */
  hint: string | null;
  editable: boolean;
  /** How the agents behave on calls here, on top of the base rules (`CALL_STYLE`). */
  callNotes: string;
}

export async function liveVoiceView(deps: LiveVoiceDeps, userId: string, orgId: string): Promise<LiveVoiceView> {
  const membership = await getMembership(deps.db, userId, orgId);
  if (!membership) throw new ForbiddenError();
  const editable = can(membership, "configure");
  const [row] = await deps.db
    .select({ hint: liveVoiceKeys.keyHint })
    .from(liveVoiceKeys)
    .where(eq(liveVoiceKeys.orgId, orgId));
  const [settings] = await deps.db
    .select({ notes: schema.organizationSettings.liveCallNotes })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.orgId, orgId));
  const engine = await liveVoiceEngineOf(deps, orgId);
  return {
    state: engine === "house" || row ? "ok" : "off",
    engine,
    chosenEngine: (await chosenEngineOf(deps, orgId)) ?? null,
    gptLiveKey: Boolean(row),
    house: deps.house ? await houseView(deps, orgId) : null,
    hint: row && editable ? row.hint : null,
    editable,
    callNotes: settings?.notes ?? "",
  };
}

// ─── The house voice: engine, price, wallet (docs/adr/doug-0036-house-voice.md) ─────

export interface HouseVoiceView {
  /** Credits a minute, from the wallet's catalog. */
  perMinute: number;
  /** The wallet's credits now; null when the wallet didn't answer. */
  balance: number | null;
  /** The workspace's monthly limit in credits; null: none. */
  monthlyCredits: number | null;
  /** Credits the house voice took this month. */
  spentThisMonth: number;
}

/** The price when the wallet's catalog doesn't say (Zim Mídia's own default for `qwen-live`). */
const HOUSE_DEFAULT_PER_MINUTE = 20;
let priceCache: { perMinute: number; at: number } | null = null;

async function housePerMinute(deps: LiveVoiceDeps): Promise<number> {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.perMinute;
  const catalog = await deps.house?.media.catalog().catch(() => null);
  const listed = catalog?.calls?.[HOUSE_VOICE_ENGINE]?.creditsPerMinute;
  const perMinute = typeof listed === "number" && listed > 0 ? listed : HOUSE_DEFAULT_PER_MINUTE;
  if (catalog) priceCache = { perMinute, at: Date.now() };
  return perMinute;
}

async function chosenEngineOf(deps: LiveVoiceDeps, orgId: string): Promise<LiveVoiceEngine | null> {
  const [s] = await deps.db
    .select({ engine: schema.organizationSettings.liveVoiceEngine })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.orgId, orgId));
  return s?.engine === "house" || s?.engine === "gpt-live" ? s.engine : null;
}

/** The voice calls use here: the one picked, the house voice by default where this server has it, else GPT-Live. */
export async function liveVoiceEngineOf(deps: LiveVoiceDeps, orgId: string): Promise<LiveVoiceEngine> {
  const chosen = await chosenEngineOf(deps, orgId);
  if (chosen === "gpt-live" || !deps.house) return "gpt-live";
  return "house";
}

async function houseSpentThisMonth(deps: LiveVoiceDeps, orgId: string) {
  const [row] = await deps.db
    .select({ credits: sql<number>`coalesce(sum(${liveVoiceSessions.credits}), 0)::int` })
    .from(liveVoiceSessions)
    .where(
      and(
        eq(liveVoiceSessions.orgId, orgId),
        eq(liveVoiceSessions.engine, "house"),
        sql`${liveVoiceSessions.startedAt} >= ${monthStartUtc(now(deps)).toISOString()}::timestamptz`,
      ),
    );
  return Number(row?.credits ?? 0);
}

async function houseView(deps: LiveVoiceDeps, orgId: string): Promise<HouseVoiceView> {
  const [perMinute, wallet, spentThisMonth, settings] = await Promise.all([
    housePerMinute(deps),
    deps.house?.media.balance(orgId).catch(() => null),
    houseSpentThisMonth(deps, orgId),
    deps.db
      .select({ monthly: schema.organizationSettings.liveVoiceMonthlyCredits })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.orgId, orgId)),
  ]);
  return {
    perMinute,
    balance: wallet?.balance ?? null,
    monthlyCredits: settings[0]?.monthly ?? null,
    spentThisMonth,
  };
}

/** Picks the voice of calls here (`configure`): the house voice, GPT-Live, or null for the default. */
export async function setLiveVoiceEngine(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  engine: LiveVoiceEngine | null,
) {
  await requirePermission(deps.db, userId, orgId, "configure");
  if (engine === "house" && !deps.house)
    throw new ValidationError("This server has no house voice", "live_voice.no_house");
  await deps.db
    .insert(schema.organizationSettings)
    .values({ orgId, liveVoiceEngine: engine })
    .onConflictDoUpdate({ target: schema.organizationSettings.orgId, set: { liveVoiceEngine: engine } });
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "live_voice.engine_changed",
    target: { type: "live_voice", id: orgId },
    details: { engine: engine ?? "default" },
  });
  return liveVoiceView(deps, userId, orgId);
}

/** The most credits the house voice may spend here in a month (`configure`); null: no limit but the wallet. */
export async function setLiveVoiceMonthlyCredits(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  credits: number | null,
) {
  await requirePermission(deps.db, userId, orgId, "configure");
  if (credits !== null && (!Number.isInteger(credits) || credits < 0 || credits > 10_000_000))
    throw new ValidationError("A monthly limit is a whole number of credits", "live_voice.bad_limit");
  await deps.db
    .insert(schema.organizationSettings)
    .values({ orgId, liveVoiceMonthlyCredits: credits })
    .onConflictDoUpdate({
      target: schema.organizationSettings.orgId,
      set: { liveVoiceMonthlyCredits: credits },
    });
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "live_voice.monthly_limit_changed",
    target: { type: "live_voice", id: orgId },
    details: { credits },
  });
  return liveVoiceView(deps, userId, orgId);
}

/** The workspace's notes on how its agents behave on calls (on top of the base rules); who configures sets them. */
export async function saveLiveCallNotes(deps: LiveVoiceDeps, userId: string, orgId: string, notes: string) {
  await requirePermission(deps.db, userId, orgId, "configure");
  const text = notes.trim().slice(0, 3000) || null;
  await deps.db
    .insert(schema.organizationSettings)
    .values({ orgId, liveCallNotes: text })
    .onConflictDoUpdate({ target: schema.organizationSettings.orgId, set: { liveCallNotes: text } });
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "live_voice.call_notes_changed",
    target: { type: "live_voice", id: orgId },
  });
  return liveVoiceView(deps, userId, orgId);
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
  /** Runs once when the session ends (a call with one agent: its summary). */
  onEnd?: () => Promise<void>;
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
    for (const t of watch.timers) {
      clearTimeout(t);
      clearInterval(t as unknown as ReturnType<typeof setInterval>);
    }
    try {
      watch.socket?.close();
    } catch {}
    void watch.onEnd?.().catch(() => {});
  }
  const [row] = await deps.db.select().from(liveVoiceSessions).where(eq(liveVoiceSessions.id, id));
  if (!row || row.endedAt) return;
  const at = now(deps);
  const max = LIVE_VOICE_MAX_SECONDS[row.kind] + 60;
  const counted = reported ?? watch?.seconds ?? null;
  const seconds = Math.min(max, counted ?? clockSeconds(row.startedAt, at));
  if (row.engine === "house") return settleHouse(deps, row, seconds, reason, at);
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

/**
 * A house voice session ended: its seconds (the relay's count: a muted voice on a room costs nothing) charged once to
 * the wallet, by the session's id, and what the wallet took kept on the row and in the usage file, at a credit's worth.
 */
async function settleHouse(
  deps: LiveVoiceDeps,
  row: typeof liveVoiceSessions.$inferSelect,
  seconds: number,
  reason: string,
  at: Date,
) {
  const billed = row.providerSessionId ? seconds : 0;
  const [ended] = await deps.db
    .update(liveVoiceSessions)
    .set({ endedAt: at, endReason: reason, seconds: billed })
    .where(and(eq(liveVoiceSessions.id, row.id), isNull(liveVoiceSessions.endedAt)))
    .returning({ id: liveVoiceSessions.id });
  if (!ended || billed === 0 || !deps.house) return;
  let credits: number | null = null;
  for (let attempt = 0; attempt < 3 && credits === null; attempt++) {
    if (attempt) await new Promise((done) => setTimeout(done, attempt * 2000));
    try {
      const charged = await deps.house.media.chargeCall(row.orgId, {
        idempotencyKey: row.id,
        engine: HOUSE_VOICE_ENGINE,
        seconds: billed,
      });
      credits = charged.credits;
    } catch (error) {
      deps.log?.warn("live voice: the wallet didn't take a house voice session", {
        sessionId: row.id,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!credits) return;
  const cost = credits * CREDIT_NANO_USD;
  await deps.db.update(liveVoiceSessions).set({ credits, costNanoUsd: cost }).where(eq(liveVoiceSessions.id, row.id));
  await recordLiveVoiceUsage(
    deps.db,
    {
      orgId: row.orgId,
      agentId: row.agentId,
      personId: row.userId,
      model: HOUSE_VOICE_MODEL,
      costNanoUsd: cost,
      provider: "empirio",
    },
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

function watchSession(
  deps: LiveVoiceDeps,
  id: string,
  providerSessionId: string,
  apiKey: string,
  maxSeconds: number,
  brain: AgentBrain | null = null,
) {
  const watch: Watch = { socket: null, seconds: null, timers: [] };
  watching.set(id, watch);
  const call = brain ? agentCall(deps, id, brain, (event) => watch.socket?.send(JSON.stringify(event))) : null;
  if (call && brain) {
    const startedAt = Date.now();
    watch.onEnd = () => postCallSummary(deps, brain, id, call.lines(), startedAt);
    const idle = setInterval(() => {
      if (call.idleFor() > AGENT_CALL_IDLE_MS) watch.socket?.send(JSON.stringify({ type: "session.close" }));
    }, 30_000);
    watch.timers.push(unref(idle as unknown as ReturnType<typeof setTimeout>));
  }
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
          call?.event(event as LiveServerEvent);
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

export async function orgOf(deps: LiveVoiceDeps, orgId: string) {
  const [org] = await deps.db
    .select({ name: organizations.name, context: organizations.context })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) throw new NotFoundError();
  return org;
}

export async function personName(deps: LiveVoiceDeps, userId: string) {
  const [u] = await deps.db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return u?.name || "the person";
}

/** Agents of the workspace this person may talk to, here: the others are left out. */
export async function talkableAgents(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  channelId: string,
  ids: string[],
) {
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
  kind: "call" | "agent" | "listen" | "sample";
  /** The app's WebRTC offer, for GPT-Live. Without one, a workspace on GPT-Live answers `{ transport: "offer" }`. */
  sdp?: string | null;
  /**
   * How the app can carry the audio: `webrtc` (GPT-Live) and `relay` (the house voice, through this server). Absent:
   * `webrtc` alone, as apps before the house voice.
   */
  transports?: ("webrtc" | "relay")[] | null;
  agentId?: string | null;
  roomId?: string | null;
  /** `agent`: the conversation with the agent (its DM), where what is asked by voice goes. */
  channelId?: string | null;
  messageId?: string | null;
  voice?: string | null;
  /** The app's language. */
  language?: string | null;
}

export async function startLiveSession(deps: LiveVoiceDeps, userId: string, orgId: string, input: StartLiveSession) {
  const membership = await getMembership(deps.db, userId, orgId);
  if (!membership) throw new ForbiddenError();
  void sweepLiveVoiceSessions(deps, orgId).catch(() => {});
  const engine = await liveVoiceEngineOf(deps, orgId);
  const relay = Boolean(input.transports?.includes("relay"));
  const house = engine === "house" && relay;
  if (engine === "house" && !relay) {
    // An app that only carries WebRTC (a phone build from before the house voice): GPT-Live if the workspace has a key.
    const [key] = await deps.db
      .select({ orgId: liveVoiceKeys.orgId })
      .from(liveVoiceKeys)
      .where(eq(liveVoiceKeys.orgId, orgId));
    if (!key) throw new ValidationError("Update the app to call with the house voice", "live_voice.update_app");
  }
  if (!house && !input.sdp) return { transport: "offer" as const };
  const apiKey = house ? "" : await openKey(deps, orgId);
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
  let brain: AgentBrain | null = null;

  if (input.kind === "agent") {
    if (!input.channelId || !input.agentId) throw new ValidationError("A call needs its agent and conversation");
    await requireChannelAccess(deps.db, userId, orgId, input.channelId);
    [agent = null] = await talkableAgents(deps, userId, orgId, input.channelId, [input.agentId]);
    if (!agent) throw new NotFoundError("Agent not found");
    await keepLiveVoices(deps, orgId, [agent.id]);
    agent = (await getAgent(deps.db, orgId, agent.id)) ?? agent;
    channelId = input.channelId;
    instructions = agentCallInstructions({
      agent: voiceAgent(agent),
      person,
      orgName: org.name,
      orgContext: org.context,
      recent: await recentLines(deps, orgId, input.channelId, { limit: 15 }),
      language: input.language ?? null,
    });
    voice = liveVoiceFor(agent.id, agent.voice);
    brain = { orgId, userId, channelId: input.channelId, agentId: agent.id };
  } else if (input.kind === "call") {
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
    const leader = all.find((a) => a.id === room.agentIds[0]);
    const [settings] = await deps.db
      .select({ notes: schema.organizationSettings.liveCallNotes })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.orgId, orgId));
    instructions = callInstructions({
      agent: voiceAgent(agent),
      others: all.filter((a) => a.id !== agent?.id).map((a) => ({ name: a.name, role: a.role })),
      lead: room.agentIds.length > 1 && leader ? leader.name : null,
      isLead: room.agentIds.length > 1 && room.agentIds[0] === agent.id,
      people: people.length ? people : [person],
      host: room.agentIds[0] === agent.id && room.lines.length === 0,
      orgName: org.name,
      orgContext: org.context,
      channel,
      recent: await recentLines(deps, orgId, room.channelId, { limit: 15 }),
      callSoFar: await linesAsChat(deps, room.lines.slice(-40)),
      language: input.language ?? null,
      topic: room.topic,
      workspaceNotes: settings?.notes ?? null,
      agentNotes: all.find((a) => a.id === agent?.id)?.liveCallNotes ?? null,
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
  if (house) {
    const houseVoice =
      input.kind === "sample" && isHouseVoice(input.voice)
        ? input.voice
        : agent
          ? houseVoiceFor(agent.id, agent.houseVoice, agent.voice)
          : DEFAULT_HOUSE_VOICE;
    return startHouseSession(deps, userId, orgId, {
      kind: input.kind,
      agentId: agent?.id ?? null,
      channelId,
      messageId,
      callId: input.kind === "call" ? (input.roomId ?? null) : null,
      voice: houseVoice,
      setup: {
        instructions,
        voice: houseVoice,
        language: input.language ?? null,
        delegate: input.kind === "agent" || input.kind === "call",
        speakFirst: input.kind !== "call",
      },
      brain,
    });
  }
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
    made = await createAtOpenAI(deps, apiKey, userId, { instructions, voice, sdp: input.sdp ?? "" });
  } catch (error) {
    await settle(deps, row.id, "refused");
    throw error;
  }
  await deps.db
    .update(liveVoiceSessions)
    .set({ providerSessionId: made.sessionId, voice: made.voice })
    .where(eq(liveVoiceSessions.id, row.id));
  const maxSeconds = LIVE_VOICE_MAX_SECONDS[input.kind];
  watchSession(deps, row.id, made.sessionId, apiKey, maxSeconds, brain);
  return {
    transport: "webrtc" as const,
    id: row.id,
    sdp: made.sdp,
    voice: made.voice,
    maxSeconds,
    minSeconds: LIVE_VOICE_MIN_SECONDS,
  };
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

export async function linesAsChat(deps: LiveVoiceDeps, lines: LiveRoomLine[]): Promise<ChatLine[]> {
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

export type Room = typeof liveVoiceRooms.$inferSelect;

export interface LiveRoomView {
  id: string;
  channelId: string;
  hostUserId: string | null;
  agentIds: string[];
  /** What the call opens on: the host agent brings it up first. */
  topic: string | null;
  /** Who is in now (`phone`: from the phone app). */
  people: { userId: string; joinedAt: string; phone?: boolean }[];
  status: "live" | "ended";
  startedAt: string;
  endedAt: string | null;
  /** The latest lines (captions for who joins late). */
  lines: LiveRoomLine[];
  reportMessageId: string | null;
}

export const presentPeople = (room: Room, at: Date) =>
  room.people.filter((p) => !p.leftAt && at.getTime() - new Date(p.seenAt).getTime() < PERSON_GONE_MS);

const roomView = (room: Room, at: Date): LiveRoomView => ({
  id: room.id,
  channelId: room.channelId,
  hostUserId: room.hostUserId,
  agentIds: room.agentIds,
  topic: room.topic,
  people:
    room.status === "live"
      ? presentPeople(room, at).map((p) => ({
          userId: p.userId,
          joinedAt: p.joinedAt,
          ...(p.phone ? { phone: true } : {}),
        }))
      : [],
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

/**
 * Who runs the agents' voices: the host while they are in, unless they are on the phone and someone on the web or the
 * desktop app is in (a phone can't pass the agents' voices on to the others); else the first one in on a computer,
 * else the first one in.
 */
export function pickLiveHost(present: Pick<LiveRoomPerson, "userId" | "phone">[], host: string | null) {
  const current = present.find((p) => p.userId === host);
  const computer = present.find((p) => !p.phone);
  if (current && (!current.phone || !computer)) return current.userId;
  return (computer ?? present[0])?.userId ?? null;
}

/** Hands the room to the next person in when its host is gone; ends it when nobody is left. */
async function tidyRoom(deps: LiveVoiceDeps, room: Room): Promise<{ room: Room; changed: boolean }> {
  const at = now(deps);
  const present = presentPeople(room, at);
  if (!present.length) {
    const ended = await endRoom(deps, null, room.orgId, room.id, "empty");
    return { room: ended ?? room, changed: true };
  }
  const host = pickLiveHost(present, room.hostUserId);
  if (host === room.hostUserId) return { room, changed: false };
  const [next] = await deps.db
    .update(liveVoiceRooms)
    .set({ hostUserId: host })
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

/**
 * Gives every agent here that has no voice picked one of its own and keeps it (`agents.voice`): no two agents of the
 * workspace share one while there are voices left, and nobody's voice changes from one call to the next, whoever else
 * is on it. An agent keeps the voice it had unless a colleague already has it.
 */
export async function keepLiveVoices(deps: LiveVoiceDeps, orgId: string, agentIds: string[]) {
  if (!agentIds.length) return;
  const rows = await deps.db
    .select({ id: agents.id, voice: agents.voice })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), isNull(agents.deletedAt)));
  const used = new Set<string>(rows.flatMap((r) => (isLiveVoice(r.voice) ? [r.voice] : [])));
  for (const id of agentIds) {
    const row = rows.find((r) => r.id === id);
    if (!row || isLiveVoice(row.voice)) continue;
    const voice = liveVoiceChoices(id).find((v) => !used.has(v)) ?? liveVoiceFor(id);
    used.add(voice);
    await deps.db
      .update(agents)
      .set({ voice })
      .where(and(eq(agents.id, id), row.voice === null ? isNull(agents.voice) : eq(agents.voice, row.voice)));
  }
}

/** Starts the conversation's room, or joins it when one is live (its agents stay as they are). */
export async function joinLiveRoom(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  channelId: string,
  input: { agentIds: string[]; topic?: string | null; phone?: boolean },
) {
  const { membership } = await requireChannelAccess(deps.db, userId, orgId, channelId);
  if (!can(membership, "post")) throw new ForbiddenError();
  const at = now(deps);
  const iso = at.toISOString();
  const existing = await channelLiveRoom(deps, userId, orgId, channelId);
  let room: Room | undefined;
  if (!existing) {
    // A call with agents is led by the team's right hand (ADR 0137): always on it, first (it opens and moderates).
    const lead = input.agentIds.length ? await rightHandId(deps.db, orgId).catch(() => null) : null;
    const wanted = [...new Set(lead ? [lead, ...input.agentIds] : input.agentIds)].slice(0, LIVE_ROOM_MAX_AGENTS);
    const talkable = (await talkableAgents(deps, userId, orgId, channelId, wanted)).sort(
      (a, b) => wanted.indexOf(a.id) - wanted.indexOf(b.id),
    );
    if (talkable.length) await openKey(deps, orgId);
    await keepLiveVoices(
      deps,
      orgId,
      talkable.map((a) => a.id),
    );
    [room] = await deps.db
      .insert(liveVoiceRooms)
      .values({
        orgId,
        channelId,
        hostUserId: userId,
        agentIds: talkable.map((a) => a.id),
        topic: input.topic?.trim().slice(0, 500) || null,
        people: [{ userId, joinedAt: iso, seenAt: iso, leftAt: null, ...(input.phone ? { phone: true } : {}) }],
        startedAt: at,
      })
      .onConflictDoNothing()
      .returning();
  }
  if (!room) {
    const current = existing ?? (await channelLiveRoom(deps, userId, orgId, channelId));
    if (!current) throw new ConflictError("The call ended. Start it again.", "live_room.ended");
    room = (await tidyRoom(deps, await touchPerson(deps, current.id, userId, iso, true, input.phone))).room;
  }
  await announce(deps, room, true);
  return roomView(room, at);
}

/** Marks a person in (`join`) or alive; returns the room as it is after. */
async function touchPerson(
  deps: LiveVoiceDeps,
  roomId: string,
  userId: string,
  iso: string,
  join: boolean,
  phone?: boolean,
) {
  const [room] = await deps.db.select().from(liveVoiceRooms).where(eq(liveVoiceRooms.id, roomId));
  if (room?.status !== "live") throw new NotFoundError("This call has ended", "live_room.ended");
  const mine = room.people.find((p) => p.userId === userId);
  if (!join && (!mine || mine.leftAt)) throw new NotFoundError("You're not in this call", "live_room.not_in");
  // Joining says where from again (the same person may come back on another device); a ping keeps it.
  const device = join ? (phone ? { phone: true } : { phone: undefined }) : {};
  const people: LiveRoomPerson[] = mine
    ? room.people.map((p) =>
        p.userId === userId ? { ...p, ...device, seenAt: iso, leftAt: null, joinedAt: p.leftAt ? iso : p.joinedAt } : p,
      )
    : [...room.people, { userId, joinedAt: iso, seenAt: iso, leftAt: null, ...(phone ? { phone: true } : {}) }];
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

/** People one call may ring at once. */
export const LIVE_ROOM_MAX_INVITES = 10;

/**
 * Someone on the call calls a person in: one who can't see the conversation is added to it (when the caller may add
 * people there), a message there mentions them (their inbox, phone and browsers, through the mention's notification),
 * and their open apps ring (`live.ring`) with a way in. Returns who was called and who couldn't be.
 */
export async function inviteToLiveRoom(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  input: { userIds: string[]; language?: string | null },
) {
  const room = await liveRoom(deps, orgId, roomId);
  if (room.status !== "live") throw new NotFoundError("This call has ended", "live_room.ended");
  await requireChannelAccess(deps.db, userId, orgId, room.channelId);
  const wanted = [...new Set(input.userIds)].filter((id) => id !== userId).slice(0, LIVE_ROOM_MAX_INVITES);
  if (!wanted.length) return { invited: [] as string[], refused: [] as string[] };
  const members = await deps.db
    .select({ userId: schema.organizationMembers.userId, handle: schema.organizationMembers.handle })
    .from(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.orgId, orgId), inArray(schema.organizationMembers.userId, wanted)));
  const invited: { userId: string; handle: string | null }[] = [];
  const refused: string[] = wanted.filter((id) => !members.some((m) => m.userId === id));
  for (const m of members) {
    const sees = await requireChannelAccess(deps.db, m.userId, orgId, room.channelId).then(
      () => true,
      () => false,
    );
    const added =
      sees ||
      (await addChannelMember(
        deps.db,
        userId,
        orgId,
        room.channelId,
        { userId: m.userId },
        { pubsub: deps.pubsub },
      ).then(
        () => true,
        () => false,
      ));
    if (added) invited.push(m);
    else refused.push(m.userId);
  }
  if (!invited.length) return { invited: [], refused };
  const pt = (input.language ?? "pt").toLowerCase().startsWith("pt");
  const tags = invited
    .map((m) => (m.handle ? `@${m.handle}` : null))
    .filter(Boolean)
    .join(" ");
  if (tags && deps.postMessage)
    await deps
      .postMessage(
        userId,
        orgId,
        room.channelId,
        pt
          ? `${tags} te chamei pra chamada de voz aqui. Toque em Entrar no topo da conversa.`
          : `${tags} I'm calling you into the voice call here. Tap Join at the top of the conversation.`,
        { liveInvite: { roomId: room.id } },
      )
      .catch(() => null);
  const by = await personName(deps, userId);
  const channel = await channelName(deps, room.channelId);
  for (const m of invited)
    await publishUserEvent(deps.pubsub, orgId, m.userId, {
      type: "live.ring",
      roomId: room.id,
      channelId: room.channelId,
      channelName: channel,
      byUserId: userId,
      byName: by,
    });
  return { invited: invited.map((m) => m.userId), refused };
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

export async function requireInRoom(deps: LiveVoiceDeps, userId: string, orgId: string, roomId: string) {
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

/**
 * Work asked for on a call (ADR doug-0006 §10): an agent on the room delegated ("já vejo"), and what was asked goes to
 * the conversation as the host's message mentioning it, marked as said on the call (`meta.via`), so the agent works on
 * it with its tools like on any message while the call goes on. Its answer, once it comes, goes to the host's app
 * (`live.answer`), which gives it the word at the next pause to tell it; everyone on the call sees it working
 * (`live.working`).
 */
export async function askFromLiveRoom(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  input: { agentId: string; ask: string; delegationId: string },
): Promise<{ askId: string }> {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  if (room.hostUserId !== userId)
    throw new ForbiddenError("Only the room's host runs its agents", "live_voice.not_host");
  if (!room.agentIds.includes(input.agentId)) throw new NotFoundError("Agent not in this room");
  const [agent] = await talkableAgents(deps, userId, orgId, room.channelId, [input.agentId]);
  if (!agent) throw new NotFoundError("Agent not found");
  // Wired by the server (`postPersonMessage`); missing only in a misconfigured build.
  if (!deps.postMessage) throw new Error("live voice: postMessage is not wired");
  const since = new Date(Date.now() - 1000);
  const posted = await deps.postMessage(userId, orgId, room.channelId, `@${agent.handle} ${input.ask.trim()}`, {
    via: "call",
    liveRoomId: room.id,
  });
  const tell = (event: { type: string; [key: string]: unknown }) =>
    Promise.all(
      presentPeople(room, now(deps)).map((p) =>
        publishUserEvent(deps.pubsub, orgId, p.userId, { roomId: room.id, agentId: agent.id, ...event }),
      ),
    ).catch(() => {});
  void tell({ type: "live.working", on: true });
  void (async () => {
    const answer = await agentAnswer(
      deps,
      { orgId, userId, channelId: room.channelId, agentId: agent.id },
      posted.id,
      since,
      () => {},
    ).catch(() => null);
    await tell({ type: "live.working", on: false });
    await publishUserEvent(deps.pubsub, orgId, room.hostUserId ?? userId, {
      type: "live.answer",
      roomId: room.id,
      agentId: agent.id,
      delegationId: input.delegationId,
      text: answer ? speakable(answer).slice(0, 1800) : null,
    });
  })();
  return { askId: posted.id };
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
 * When the small model is asked who speaks: after a person spoke to nobody by name (`person`), after an agent finished
 * (`after`: does a colleague build on it?), or while an agent talks (`during`: does a colleague jump in now?).
 */
export interface LiveSpeakerAsk {
  moment?: "person" | "after" | "during";
  /** The agent talking now and its words so far (`during`), or the one that just finished (`after`). */
  speaking?: { agentId: string; text?: string } | null;
  /** Agents that may not take the word now (the room's limits, kept by the host's app). */
  skip?: string[];
}

/**
 * Who speaks next, and when: a judgment, so the workspace's small model makes it. After a person: with several people
 * it answers "none" unless they clearly wait for the AI side, which keeps agents from talking over a conversation
 * between people; with one person everything said is for the agents, so it only picks who fits best (the host's app
 * falls back to an agent when it can't say). Among agents it is a lively meeting: a colleague builds on what was said,
 * pushes back or adds their role's angle, now and then cutting in (`when: "now"`); "none" when nothing real would be
 * added. The host's app keeps the limits, so this never runs away.
 */
export async function pickLiveSpeaker(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  ask: LiveSpeakerAsk = {},
): Promise<{ agentId: string | null; when: "now" | "after" | null }> {
  const none = { agentId: null, when: null } as const;
  const room = await requireInRoom(deps, userId, orgId, roomId);
  if (room.hostUserId !== userId || !deps.pickWithSmallModel || !room.agentIds.length) return none;
  const moment = ask.moment ?? "person";
  const speaker = ask.speaking?.agentId ?? null;
  const roster = (
    await deps.db
      .select({ id: agents.id, name: agents.name, handle: agents.handle, role: agents.role })
      .from(agents)
      .where(inArray(agents.id, room.agentIds))
  ).filter((a) => moment === "person" || (a.id !== speaker && !ask.skip?.includes(a.id)));
  if (!roster.length) return none;
  const recent = await linesAsChat(deps, room.lines.slice(-14));
  const [speakerRow] = speaker
    ? await deps.db.select({ name: agents.name }).from(agents).where(eq(agents.id, speaker))
    : [];
  const now = moment === "during" && ask.speaking?.text?.trim() ? ask.speaking.text.trim().slice(-1200) : "";
  if (!recent.length && !now) return none;
  const lead = room.agentIds.length > 1 ? room.agentIds[0] : null;
  const roles = `Agents who may speak:\n${roster
    .map((a) => `- ${a.handle}: ${a.name}${a.role ? `, ${a.role}` : ""}${a.id === lead ? " (leads the meeting)" : ""}`)
    .join("\n")}`;
  const meeting =
    "It is a lively meeting, like a real one: colleagues build on each other's ideas, push back when they disagree and bring their own role's angle. Pick an agent only when they would add something real: never to agree, thank, repeat or summarize. Spread the word: prefer an agent who has said little.";
  const system = (
    moment === "during"
      ? [
          `You moderate a live voice call between people and AI agents. ${speakerRow?.name ?? "An agent"} is talking right now. Decide whether another agent should jump in.`,
          'Answer only JSON: {"speaker": "<handle>", "when": "now"} to cut in right away, {"speaker": "<handle>", "when": "after"} to speak as soon as they finish, or {"speaker": "none"}.',
          meeting,
          '"now" only for something that can\'t wait: a clear disagreement, a wrong fact, or an idea sparked by the very sentence just said. Cutting in is occasional; "after" is the usual way. When in doubt, "none".',
          roles,
        ]
      : moment === "after"
        ? [
            `You moderate a live voice call between people and AI agents. ${speakerRow?.name ?? "An agent"} just finished talking. Decide whether another agent should speak next, before the people answer.`,
            'Answer only JSON: {"speaker": "<handle>"} or {"speaker": "none"}.',
            meeting,
            "Everyone on the team takes part: usually one colleague who hasn't spoken on this yet should add their angle, push back or build on it. Prefer a colleague over the one who leads the meeting.",
            'Answer "none" only when the agent asked the people a direct question or handed the decision to them (they answer first), or when every colleague already spoke on it.',
            roles,
          ]
        : room.people.length <= 1
          ? [
              "You moderate a live voice call between one person and AI agents. Everything the person says is for the agents: pick the one agent that should answer now.",
              'Answer only JSON: {"speaker": "<handle>"}.',
              "Pick the agent whose role fits what was just said best; for a greeting, small talk or a general question, the agent that spoke last, or the one leading the team.",
              roles,
            ]
          : [
              "You moderate a live voice call between people and AI agents. Decide whether one agent should speak next, and which.",
              'Answer only JSON: {"speaker": "<handle>"} or {"speaker": "none"}.',
              "Pick an agent only when the last thing said is clearly waiting for an answer from the AI side: a question or request to the group that fits an agent's role, or a direct follow-up to what an agent just said.",
              'Answer "none" when people are talking to each other, thinking aloud, or when an agent just spoke and nobody asked it anything. When in doubt, "none".',
              roles,
            ]
  ).join("\n");
  const prompt = [
    recent.length ? `The call, latest last:\n${recent.map((l) => `${l.author}: ${l.text}`).join("\n")}` : "",
    now ? `${speakerRow?.name ?? "The agent"}, saying now: ${now}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const text = await deps.pickWithSmallModel(orgId, system, prompt).catch(() => null);
  const handle = text ? /"speaker"\s*:\s*"([^"]+)"/.exec(text)?.[1]?.replace(/^@/, "").toLowerCase() : null;
  const agentId = roster.find((a) => a.handle === handle)?.id ?? null;
  if (!agentId) return none;
  const when = moment === "during" && text && /"when"\s*:\s*"now"/.test(text) ? "now" : "after";
  return { agentId, when };
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
  // The right hand writes the report; a workspace without one gets it from the call's first agent.
  const lead = (await rightHandId(deps.db, room.orgId).catch(() => null)) ?? room.agentIds[0] ?? null;
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
    ? `@${boss.handle} a reunião de voz terminou. Mande o resumo: o que falamos, o que foi decidido, os próximos passos daqui pra frente com responsável e prazo, e o que ficou em aberto.`
    : "Notas da reunião de voz.";
  return [ask, "", `**Reunião de voz** · ${minutes} min · ${[...people, ...bots].join(", ")}`, "", transcript].join(
    "\n",
  );
}

// ─── A call with one agent ───────────────────────────────────────────────────

/** Whose call it is and where its asks go: the agent's conversation with the person. */
interface AgentBrain {
  orgId: string;
  userId: string;
  channelId: string;
  agentId: string;
}

type LiveServerEvent = {
  type?: string;
  delta?: string;
  delegation?: { id?: string; target?: string };
};

/**
 * The agent behind its voice (ADR doug-0006, as the Nordus Live call): when GPT-Live delegates, what the person said
 * since the last ask becomes their message in the agent's conversation, marked as said on a call (`meta.via`), so the
 * agent works on it like any other, with its tools, and the chat shows it. Its answer goes back to the voice to be
 * told. All of it on the server's sideband: the app only carries the audio.
 */
function agentCall(deps: LiveVoiceDeps, sessionId: string, brain: AgentBrain, send: (event: object) => void) {
  let heard = "";
  // The whole call, turn by turn, for its summary.
  const said: CallLine[] = [];
  const add = (who: CallLine["who"], delta: string) => {
    const last = said.at(-1);
    if (last && last.who === who) last.text += delta;
    else said.push({ who, text: delta });
  };
  let lastActivity = Date.now();
  const pending = new Set<string>();

  const askAgent = async (delegationId: string) => {
    // The last words of the ask arrive just after the delegation: wait for them.
    await new Promise((done) => setTimeout(done, 700));
    const ask = heard.trim();
    heard = "";
    if (!ask) {
      send({
        type: "session.instructions.append",
        delegation_id: delegationId,
        content: "You didn't catch what to do. Ask the person to say it again.",
      });
      return;
    }
    if (!deps.postMessage) return;
    const since = new Date(Date.now() - 1000);
    const posted = await deps.postMessage(brain.userId, brain.orgId, brain.channelId, ask, {
      via: "call",
      liveSessionId: sessionId,
    });
    const answer = await agentAnswer(deps, brain, posted.id, since, () =>
      send({ type: "session.thinking.append", delegation_id: delegationId, content: "Still working on it." }),
    );
    send({
      type: "session.commentary.append",
      delegation_id: delegationId,
      content: answer
        ? speakable(answer).slice(0, 1800)
        : "This is taking longer. It will be in our chat as soon as it's done.",
    });
  };

  return {
    idleFor: () => Date.now() - lastActivity,
    lines: () => said.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text),
    event(e: LiveServerEvent) {
      if (e.type === "session.input_transcript.delta" && e.delta) {
        heard += e.delta;
        add("person", e.delta);
        lastActivity = Date.now();
      }
      if (e.type === "session.output_transcript.delta") {
        if (e.delta) add("agent", e.delta);
        lastActivity = Date.now();
      }
      const id = e.delegation?.id;
      if (e.type !== "session.delegation.created" || !id || e.delegation?.target === "responses" || pending.has(id))
        return;
      pending.add(id);
      void askAgent(id)
        .catch(() =>
          send({
            type: "session.commentary.append",
            delegation_id: id,
            content: "Something went wrong on my side. Say it again, please.",
          }),
        )
        .finally(() => pending.delete(id));
    },
  };
}

interface CallLine {
  who: "person" | "agent";
  text: string;
}

/**
 * After a call with one agent, always: what was said goes to the conversation as the person's message, asking the agent
 * for the summary (what was talked about, what was decided, the next steps), so the agent writes it with what it knows
 * and the work it did during the call. Nothing when the call had no conversation.
 */
export async function postCallSummary(
  deps: LiveVoiceDeps,
  brain: AgentBrain,
  sessionId: string,
  lines: CallLine[],
  startedAt: number,
) {
  if (!deps.postMessage || !lines.some((l) => l.who === "person") || !lines.some((l) => l.who === "agent")) return;
  const [agent] = await deps.db
    .select({ name: agents.name, handle: agents.handle })
    .from(agents)
    .where(eq(agents.id, brain.agentId));
  if (!agent) return;
  const person = await personName(deps, brain.userId);
  const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
  let transcript = lines.map((l) => `**${l.who === "agent" ? agent.name : person}:** ${l.text}`).join("\n");
  if (transcript.length > 24_000) transcript = `…\n${transcript.slice(-24_000)}`;
  const body = [
    `@${agent.handle} a ligação terminou. Mande o resumo: o que falamos, o que decidimos e os próximos passos daqui pra frente (com responsável e prazo quando houver).`,
    "",
    `**Ligação** · ${minutes} min · ${person}, ${agent.name}`,
    "",
    transcript,
  ].join("\n");
  await deps.postMessage(brain.userId, brain.orgId, brain.channelId, body, {
    via: "call",
    liveSessionId: sessionId,
    callSummary: true,
  });
}

/**
 * The agent's answer to a message: its messages in the conversation after it, once they stop coming for a moment. Null
 * when none came in time. `waiting` runs now and then while it works.
 */
export async function agentAnswer(
  deps: LiveVoiceDeps,
  brain: AgentBrain,
  messageId: string,
  since: Date,
  waiting: () => void,
): Promise<string | null> {
  const started = Date.now();
  let lastCount = 0;
  let quietSince = Date.now();
  let nudged = Date.now();
  while (Date.now() - started < AGENT_ANSWER_WAIT_MS) {
    await new Promise((done) => setTimeout(done, 1500));
    const rows = await deps.db
      .select({ body: messages.body, meta: messages.meta })
      .from(messages)
      .where(
        and(
          eq(messages.orgId, brain.orgId),
          eq(messages.channelId, brain.channelId),
          eq(messages.authorAgentId, brain.agentId),
          isNull(messages.deletedAt),
          or(isNull(messages.threadId), eq(messages.threadId, messageId)),
          sql`${messages.createdAt} >= ${since.toISOString()}::timestamptz`,
          sql`${messages.id} <> ${messageId}::uuid`,
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(10);
    const said = rows.map((r) => readableBody(r.body, r.meta)).filter((t) => t.trim());
    if (said.length && said.length === lastCount) {
      if (Date.now() - quietSince > 3000) return said.join("\n\n");
    } else {
      lastCount = said.length;
      quietSince = Date.now();
    }
    if (!said.length && Date.now() - nudged > 20_000) {
      nudged = Date.now();
      waiting();
    }
  }
  return null;
}

/** An answer written for a screen, as something to say: no markdown, links or code read out. */
export function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " (the code is in the chat) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " (the link is in the chat) ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── The house voice's relay (docs/adr/doug-0036-house-voice.md) ─────────────

/** The path of the relay socket the app opens with its ticket. */
export const HOUSE_RELAY_PATH = "/api/live-voice/relay";
/** A ticket opens its socket within this long, once. */
const RELAY_TICKET_MS = 60_000;

interface PendingRelay {
  sessionId: string;
  orgId: string;
  userId: string;
  kind: StartLiveSession["kind"];
  setup: HouseSessionSetup;
  brain: AgentBrain | null;
  maxSeconds: number;
  expires: number;
}
/** Sessions started and waiting for the app's socket, by their ticket's hash (this process's: the socket comes here). */
const pendingRelays = new Map<string, PendingRelay>();

const ticketHash = (ticket: string) => new Bun.CryptoHasher("sha256").update(`live-relay|${ticket}`).digest("hex");

async function startHouseSession(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  input: {
    kind: StartLiveSession["kind"];
    agentId: string | null;
    channelId: string | null;
    messageId: string | null;
    callId: string | null;
    voice: string;
    setup: HouseSessionSetup;
    brain: AgentBrain | null;
  },
) {
  const house = deps.house;
  if (!house) throw new ValidationError("This server has no house voice", "live_voice.no_house");
  const [perMinute, wallet, spent, [settings]] = await Promise.all([
    housePerMinute(deps),
    house.media.balance(orgId).catch(() => null),
    houseSpentThisMonth(deps, orgId),
    deps.db
      .select({ monthly: schema.organizationSettings.liveVoiceMonthlyCredits })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.orgId, orgId)),
  ]);
  if (!wallet) throw new TooManyError("The credit wallet didn't answer. Try again.", "live_voice.unavailable");
  const monthLeft = settings?.monthly == null ? Number.POSITIVE_INFINITY : settings.monthly - spent;
  if (monthLeft < perMinute)
    throw new ValidationError("The house voice reached this month's limit here", "live_voice.month_limit");
  if (wallet.balance < perMinute)
    throw new ValidationError(
      `Not enough credits: a minute costs ${perMinute} and the workspace has ${wallet.balance}`,
      "live_voice.no_credits",
    );
  // It lasts what the wallet (and the month's limit) pays for, up to the kind's own limit.
  const paid = Math.floor((Math.min(wallet.balance, monthLeft) / perMinute) * 60);
  const maxSeconds = Math.min(LIVE_VOICE_MAX_SECONDS[input.kind], paid);
  for (const [hash, p] of pendingRelays) if (p.expires < Date.now()) pendingRelays.delete(hash);
  const [row] = await deps.db
    .insert(liveVoiceSessions)
    .values({
      orgId,
      userId,
      kind: input.kind,
      agentId: input.agentId,
      channelId: input.channelId,
      messageId: input.messageId,
      callId: input.callId,
      voice: input.voice,
      engine: "house",
      startedAt: now(deps),
    })
    .returning();
  if (!row) throw new Error("live voice session not stored");
  const ticket = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  pendingRelays.set(ticketHash(ticket), {
    sessionId: row.id,
    orgId,
    userId,
    kind: input.kind,
    setup: input.setup,
    brain: input.brain,
    maxSeconds,
    expires: Date.now() + RELAY_TICKET_MS,
  });
  // Never opened: settled with nothing to pay.
  unref(
    setTimeout(() => {
      const hash = ticketHash(ticket);
      if (pendingRelays.get(hash)?.sessionId !== row.id) return;
      pendingRelays.delete(hash);
      void settle(deps, row.id, "never_opened").catch(() => {});
    }, RELAY_TICKET_MS + 5000),
  );
  return {
    transport: "relay" as const,
    id: row.id,
    ticket,
    path: HOUSE_RELAY_PATH,
    sampleRate: HOUSE_VOICE_SAMPLE_RATE,
    voice: input.voice,
    maxSeconds,
    minSeconds: 0,
  };
}

/** Whether a ticket waits for its socket (the upgrade's check; opening the relay spends it). */
export function houseRelayWaiting(ticket: string) {
  const p = pendingRelays.get(ticketHash(ticket));
  return Boolean(p && p.expires >= Date.now());
}

/** The app's side of a relay: what the server sends it. */
export interface RelayClient {
  /** A GPT-Live dialect event, as JSON. */
  text(data: string): void;
  /** The voice's audio, PCM16 at 24 kHz. */
  binary(pcm: Uint8Array): void;
  close(): void;
}

/**
 * The app opened its relay socket with a ticket: the model's socket opens with the server's key, and the session runs
 * here until either side closes. What the app sends: JSON commands (GPT-Live's dialect) and its microphone as binary
 * PCM16 frames. A call with one agent also runs its brain here (`agentCall`), as GPT-Live's does on its sideband.
 * Null: no such ticket (unknown, used or expired).
 */
export function openHouseRelay(deps: LiveVoiceDeps, ticket: string, client: RelayClient) {
  const hash = ticketHash(ticket);
  const pending = pendingRelays.get(hash);
  pendingRelays.delete(hash);
  const house = deps.house;
  if (!pending || pending.expires < Date.now() || !house) return null;
  const { sessionId: id, setup, brain, maxSeconds, kind } = pending;

  let upstream: SidebandSocket | null = null;
  let ended = false;
  // What is billed: every second it runs, except, on a room, the seconds its voice is muted (the model hears nothing).
  let activeMs = 0;
  let lastTick = Date.now();
  const watch: Watch = { socket: null, seconds: 0, timers: [] };
  watching.set(id, watch);

  const call = brain ? agentCall(deps, id, brain, (event) => session.command(event as never)) : null;
  const session = houseSession(setup, {
    upstream: (event) => upstream?.send(JSON.stringify(event)),
    event: (event: LiveDialectEvent) => {
      if (!ended) client.text(JSON.stringify(event));
      call?.event(event);
      if (event.type === "session.closed") finish(event.reason ?? "closed");
    },
    audio: (pcm) => {
      if (!ended) client.binary(pcm);
    },
  });
  // Ending (the app, a limit, the model's socket): the app hears it once, then everything is settled.
  watch.socket = {
    send: (data) => {
      try {
        session.command(JSON.parse(data));
      } catch {}
    },
    close: () => upstream?.close(),
  };

  const tick = () => {
    const at = Date.now();
    if (session.started() && !(kind === "call" && session.muted())) activeMs += at - lastTick;
    lastTick = at;
    watch.seconds = Math.round(activeMs / 1000);
  };
  const ticker = setInterval(tick, 1000);
  watch.timers.push(unref(ticker as unknown as ReturnType<typeof setTimeout>));
  watch.timers.push(unref(setTimeout(() => session.command({ type: "session.close" }), maxSeconds * 1000)));
  if (call && brain) {
    const startedAt = Date.now();
    watch.onEnd = () => postCallSummary(deps, brain, id, call.lines(), startedAt);
    const idle = setInterval(() => {
      if (call.idleFor() > AGENT_CALL_IDLE_MS) session.command({ type: "session.close" });
    }, 30_000);
    watch.timers.push(unref(idle as unknown as ReturnType<typeof setTimeout>));
  }

  function finish(reason: string) {
    if (ended) return;
    tick();
    ended = true;
    const seconds = watch.seconds;
    try {
      upstream?.close();
    } catch {}
    try {
      client.close();
    } catch {}
    void settle(deps, id, reason, seconds).catch(() => {});
  }

  try {
    upstream = house.open(HOUSE_VOICE_URL, house.apiKey, {
      open: () => session.open(),
      message: (data) => {
        // The model's id for the session, once: a session that opened is billed.
        if (data.includes('"session.created"')) {
          try {
            const sid = (JSON.parse(data) as { session?: { id?: string } }).session?.id;
            if (sid)
              void deps.db
                .update(liveVoiceSessions)
                .set({ providerSessionId: sid })
                .where(eq(liveVoiceSessions.id, id))
                .catch(() => {});
          } catch {}
        }
        session.fromModel(data);
      },
      close: () => {
        upstream = null;
        if (!ended) {
          client.text(JSON.stringify({ type: "session.closed", reason: "connection_lost" }));
          finish("connection_lost");
        }
      },
    });
  } catch {
    finish("unavailable");
    return null;
  }

  return {
    /** From the app: a command, or its microphone. */
    message(data: string | Uint8Array) {
      if (ended) return;
      if (typeof data === "string") {
        try {
          session.command(JSON.parse(data));
        } catch {}
      } else session.audioIn(data);
    },
    /** The app's socket closed. */
    close() {
      finish("ended");
    },
  };
}

/** A Bun WebSocket to the house voice's model, with the key in its headers (Bun's own option). */
export const bunHouseSocket: OpenHouseSocket = (url, apiKey, on) => {
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } } as unknown as string[]);
  ws.onopen = () => on.open();
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
