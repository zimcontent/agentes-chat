/// <reference path="./text-modules.d.ts" />
import { firstWords, isVoiceOutId, type VoiceOutOption } from "@agenteschat/adapters";
import { eq, inArray, schema, sql } from "@agenteschat/db";
import { liveVoiceInfo } from "@agenteschat/providers/live-voice";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { publishUserEvent } from "./events";
import LIVE_CALL from "./live-call.md" with { type: "text" };
import {
  agentAnswer,
  type LiveVoiceDeps,
  linesAsChat,
  orgOf,
  presentPeople,
  type Room,
  requireInRoom,
  speakable,
  talkableAgents,
} from "./live-voice";
import { chatBlock, languageName } from "./live-voice-prompt";
import { untrustedBlock } from "./untrusted";

/**
 * The maestro (docs/adr/doug-0006-live-voice.md §11): a voice room the server runs. Each person's app cuts its own
 * microphone into utterances (on the device, free) and sends them here; the workspace's speech engine writes them
 * down; one short model call decides who on the team speaks next and writes what they say, with `live-call.md` (the
 * base every agent reads on a call) and the workspace's and each agent's notes; the agent's voice is made by text to
 * speech and streamed to every app at once. One voice at a time by construction, nothing paid while nobody talks, and
 * each line prepared while the one before it plays, so agents answer each other without a gap. A person talking stops
 * everything (`hush`). Work asked for runs for real in the conversation (as on the GPT-Live call) and is told when it
 * comes back.
 */

const { agents, liveVoiceRooms, organizationSettings, users } = schema;
type LiveRoomLine = schema.LiveRoomLine;

/** Agent lines in a row without a person: an ordinary call, and a debate on a topic. */
export const MAESTRO_TURNS = 3;
export const MAESTRO_DEBATE_TURNS = 6;
/** Spoken Portuguese runs about this many characters a second: how long a queued line will play. */
const CHARS_PER_SECOND = 15;
/** The next line is prepared this long before the one playing ends. */
const PREPARE_AHEAD_MS = 1800;
/** A line is a few sentences. */
const MAX_LINE_CHARS = 420;
/** Lines kept word for word in each call; older ones live in the running summary. */
const RECENT_LINES = 14;
const SUMMARIZE_EVERY = 16;
const SPEECH_KEEP_MS = 5 * 60_000;
/** What the maestro writes, at most. */
const THINK_TOKENS = 350;
/** Waits between lines are multiplied by this (tests run them faster). */
let PACE = 1;

// Prices to show what a call costs while it runs (the gateway records the model's real cost): ElevenLabs Flash v2.5 at
// US$ 0.04 per 1,000 characters, transcription at about US$ 0.36 an hour (checked 2026-11-15).
const TTS_NANO_PER_CHAR = 40_000;
const STT_NANO_PER_SECOND = 100_000;

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The agent a line calls by name (first name of 3 letters or more, full name or handle), first in the line. */
export function addressedIn(text: string, team: { id: string; name: string; handle: string }[]): string | null {
  const folded = fold(text);
  let best: { id: string; at: number } | null = null;
  for (const a of team) {
    const full = fold(a.name).trim();
    const first = full.split(/\s+/)[0] ?? "";
    const names = [full, first.length >= 3 ? first : "", fold(a.handle), fold(a.handle).replace(/[-_]/g, " ")];
    for (const n of new Set(names.filter(Boolean))) {
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").exec(folded);
      if (m && (!best || m.index < best.at)) best = { id: a.id, at: m.index };
    }
  }
  return best?.id ?? null;
}

export interface MaestroCost {
  ttsChars: number;
  sttSeconds: number;
  thinks: number;
  /** An estimate of voice and transcription, in nano-USD (the model calls are in the workspace's usage). */
  nanoUsd: number;
}

interface StageAgent {
  id: string;
  name: string;
  handle: string;
  role: string;
  instructions: string;
  notes: string;
  voice: string | null;
}

interface Stage {
  roomId: string;
  orgId: string;
  channelId: string;
  /** Bumped by every person's turn and every hush: work for an older one is dropped. */
  gen: number;
  /** Agent lines since a person last spoke. */
  agentLines: number;
  /** Who spoke since a person last spoke, in order. */
  spoke: string[];
  thinking: boolean;
  /** Something asked for another think while one ran. */
  again: Reason | null;
  /** When the queued audio should be over (ms). */
  queueEndsAt: number;
  /** A person is talking now (their app said so): nobody starts a line. */
  quietUntil: number;
  summary: string;
  summarized: number;
  team: StageAgent[];
  workspaceNotes: string;
  orgName: string;
  orgContext: string;
  language: string;
  topic: string | null;
  opened: boolean;
  /** Who asked last: whose message the agents' work goes as. */
  lastSpeaker: string | null;
  cost: MaestroCost;
}

const stages = new Map<string, Stage>();

interface Speech {
  roomId: string;
  chunks: Uint8Array[];
  done: boolean;
  waiters: Set<() => void>;
  at: number;
}
const speeches = new Map<string, Speech>();

const tell = (deps: LiveVoiceDeps, room: Room, event: { type: string; [key: string]: unknown }) =>
  Promise.all(
    presentPeople(room, new Date()).map((p) =>
      publishUserEvent(deps.pubsub, room.orgId, p.userId, { roomId: room.id, ...event }),
    ),
  ).catch(() => {});

async function freshRoom(deps: LiveVoiceDeps, roomId: string) {
  const [room] = await deps.db.select().from(liveVoiceRooms).where(eq(liveVoiceRooms.id, roomId));
  return room?.status === "live" ? room : null;
}

/** Keeps lines in the room (notes, captions) and shows them to everyone on the call. */
async function keepLines(deps: LiveVoiceDeps, room: Room, lines: LiveRoomLine[]) {
  if (!lines.length) return;
  await deps.db
    .update(liveVoiceRooms)
    .set({ lines: sql`${liveVoiceRooms.lines} || ${JSON.stringify(lines)}::jsonb` })
    .where(eq(liveVoiceRooms.id, room.id));
  await tell(deps, room, { type: "live.lines", lines });
}

/** The voices an account has, matched to the agents: its own pick, else one of the same sound as its GPT-Live voice. */
function pickVoices(
  team: StageAgent[],
  picks: Map<string, string | null>,
  gptVoice: Map<string, string>,
  all: VoiceOutOption[],
) {
  const used = new Set<string>();
  for (const a of team) {
    const own = picks.get(a.id);
    if (own && isVoiceOutId(own)) {
      a.voice = own;
      used.add(own);
    }
  }
  const sound = (labels: string[]) =>
    labels.some((l) => /female|feminine|woman/i.test(l))
      ? "feminine"
      : labels.some((l) => /\bmale|masculine|man\b/i.test(l))
        ? "masculine"
        : null;
  for (const a of team) {
    if (a.voice) continue;
    const want = liveVoiceInfo(gptVoice.get(a.id) ?? "")?.presentation ?? null;
    let hash = 0;
    for (const ch of a.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const fits = all.filter((v) => !used.has(v.id) && (!want || sound(v.labels) === want));
    const pool = fits.length ? fits : all.filter((v) => !used.has(v.id));
    const voice = pool.length ? pool[hash % pool.length] : all[hash % Math.max(1, all.length)];
    a.voice = voice?.id ?? null;
    if (a.voice) used.add(a.voice);
  }
}

async function loadStage(deps: LiveVoiceDeps, room: Room, language: string): Promise<Stage> {
  const known = stages.get(room.id);
  if (known) return known;
  const org = await orgOf(deps, room.orgId);
  const [settings] = await deps.db
    .select({ notes: organizationSettings.liveCallNotes })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, room.orgId));
  const rows = room.agentIds.length ? await deps.db.select().from(agents).where(inArray(agents.id, room.agentIds)) : [];
  const team: StageAgent[] = room.agentIds.flatMap((id) => {
    const a = rows.find((r) => r.id === id);
    return a
      ? [
          {
            id: a.id,
            name: a.name,
            handle: a.handle,
            role: a.role ?? "",
            instructions: (a.instructions ?? "").slice(0, 600),
            notes: (a.liveCallNotes ?? "").slice(0, 1500),
            voice: null,
          },
        ]
      : [];
  });
  const voices = deps.voiceOut ? await deps.voiceOut.voices().catch(() => []) : [];
  pickVoices(
    team,
    new Map(rows.map((r) => [r.id, r.callVoice])),
    new Map(rows.map((r) => [r.id, r.voice ?? ""])),
    voices,
  );
  const stage: Stage = {
    roomId: room.id,
    orgId: room.orgId,
    channelId: room.channelId,
    gen: 0,
    agentLines: 0,
    spoke: [],
    thinking: false,
    again: null,
    queueEndsAt: 0,
    quietUntil: 0,
    summary: "",
    summarized: 0,
    team,
    workspaceNotes: (settings?.notes ?? "").slice(0, 3000),
    orgName: org.name,
    orgContext: (org.context ?? "").slice(0, 1500),
    language,
    topic: room.topic,
    opened: false,
    lastSpeaker: room.hostUserId,
    cost: { ttsChars: 0, sttSeconds: 0, thinks: 0, nanoUsd: 0 },
  };
  stages.set(room.id, stage);
  return stage;
}

/** Whether this server can run maestro calls: a voice for the agents, words for the people, and a model. */
export const maestroAvailable = (deps: LiveVoiceDeps) =>
  Boolean(deps.voiceOut && deps.think && (deps.speech?.() ?? []).length);

/** Someone joined a maestro room: the call opens once (the lead greets, or opens the topic). */
export async function maestroJoined(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  language: string,
) {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  if (room.mode !== "maestro") return;
  if (!maestroAvailable(deps))
    throw new ValidationError("Maestro calls aren't set up on this server", "live_room.no_maestro");
  const stage = await loadStage(deps, room, language);
  if (stage.opened) return;
  stage.opened = true;
  deps.log?.info("maestro opened", {
    roomId: room.id,
    agents: stage.team.length,
    voices: stage.team.filter((a) => a.voice).length,
    topic: Boolean(stage.topic),
  });
  void think(deps, stage, { reason: stage.topic ? "open-topic" : "open" });
}

/** A person started talking: every voice stops, and nothing new starts until they pause. */
export async function maestroHush(deps: LiveVoiceDeps, userId: string, orgId: string, roomId: string) {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  const stage = stages.get(room.id);
  if (!stage) return;
  // Nothing starts while they talk; what is being prepared waits for them (their words may need it, or replace it).
  stage.quietUntil = Date.now() + 6000;
  // Only a voice actually playing is cut: a cough must not throw the next line away.
  if (Date.now() >= stage.queueEndsAt) return;
  stage.gen++;
  stage.again = null;
  stage.queueEndsAt = 0;
  deps.log?.info("maestro hush", { roomId: room.id });
  await tell(deps, room, { type: "live.hush", gen: stage.gen, by: userId });
}

/**
 * What a person said, as audio from their app: written down by the workspace's speech engine, kept as their line, and
 * the team answers. Silence costs nothing: only what their app heard as speech comes here.
 */
export async function maestroHeard(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  input: { audio: Uint8Array; contentType: string; durationMs: number; language: string },
) {
  const room = await requireInRoom(deps, userId, orgId, roomId);
  if (room.mode !== "maestro") throw new ForbiddenError("Not a maestro call");
  const stage = await loadStage(deps, room, input.language);
  const engines = deps.speech?.() ?? [];
  const seconds = Math.max(1, Math.round(input.durationMs / 1000));
  stage.cost.sttSeconds += seconds;
  stage.cost.nanoUsd += seconds * STT_NANO_PER_SECOND;
  const heard = await firstWords(
    engines,
    {
      audio: input.audio,
      contentType: input.contentType,
      language: input.language.slice(0, 2),
      terms: stage.team.map((a) => a.name),
      orgId,
      durationMs: input.durationMs,
    },
    2500,
  ).catch(() => null);
  stage.quietUntil = 0;
  const text = heard?.text.trim() ?? "";
  deps.log?.info("maestro heard", {
    roomId: room.id,
    ms: input.durationMs,
    chars: text.length,
    engine: heard?.engine.id,
  });
  if (!text) return { text: "" };
  const line: LiveRoomLine = {
    at: new Date().toISOString(),
    who: { type: "person", id: userId },
    text: text.slice(0, 2000),
  };
  await keepLines(deps, room, [line]);
  stage.gen++;
  stage.agentLines = 0;
  stage.spoke = [];
  stage.lastSpeaker = userId;
  stage.queueEndsAt = 0;
  void think(deps, stage, { reason: "person" });
  void tell(deps, room, { type: "live.cost", cost: stage.cost });
  return { text };
}

/** A line's audio as it is made, for every app on the call (each one reads from the start). */
export async function maestroSpeech(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  roomId: string,
  utteranceId: string,
): Promise<ReadableStream<Uint8Array> | null> {
  await requireInRoom(deps, userId, orgId, roomId);
  const speech = speeches.get(utteranceId);
  if (!speech || speech.roomId !== roomId) return null;
  let sent = 0;
  let wake: (() => void) | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (sent >= speech.chunks.length && !speech.done) {
        await new Promise<void>((done) => {
          wake = done;
          speech.waiters.add(done);
        });
        if (wake) speech.waiters.delete(wake);
      }
      if (sent < speech.chunks.length) {
        const chunk = speech.chunks[sent++];
        if (chunk) controller.enqueue(chunk);
      } else controller.close();
    },
  });
}

/** Ends what the room runs here when the call ends. */
export function maestroEnded(roomId: string) {
  const stage = stages.get(roomId);
  if (stage) stage.gen++;
  stages.delete(roomId);
}

function forget() {
  const old = Date.now() - SPEECH_KEEP_MS;
  for (const [id, s] of speeches) if (s.at < old) speeches.delete(id);
}

/** Makes an agent's line heard: its voice streamed into memory, and every app told to play it after what it plays. */
async function speak(deps: LiveVoiceDeps, stage: Stage, room: Room, agent: StageAgent, text: string, gen: number) {
  const voiceOut = deps.voiceOut;
  if (!voiceOut || !agent.voice) return;
  forget();
  const utteranceId = crypto.randomUUID();
  const speech: Speech = { roomId: room.id, chunks: [], done: false, waiters: new Set(), at: Date.now() };
  speeches.set(utteranceId, speech);
  const wakeAll = () => {
    for (const w of [...speech.waiters]) w();
    speech.waiters.clear();
  };
  stage.cost.ttsChars += text.length;
  stage.cost.nanoUsd += text.length * TTS_NANO_PER_CHAR;
  void (async () => {
    try {
      const body = await voiceOut.stream({ voice: agent.voice ?? "", text });
      const reader = body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          speech.chunks.push(value);
          wakeAll();
        }
        if (stage.gen !== gen) {
          void reader.cancel().catch(() => {});
          break;
        }
      }
    } catch (error) {
      // The line is shown anyway: the captions carry it.
      deps.log?.warn("maestro voice failed", { roomId: stage.roomId, error: String(error).slice(0, 300) });
    } finally {
      speech.done = true;
      wakeAll();
    }
  })();
  const startsAt = Math.max(Date.now(), stage.queueEndsAt);
  stage.queueEndsAt = startsAt + (text.length / CHARS_PER_SECOND) * 1000 + 350;
  const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "agent", id: agent.id }, text };
  await tell(deps, room, { type: "live.say", gen, utteranceId, agentId: agent.id, text });
  await keepLines(deps, room, [line]);
  void tell(deps, room, { type: "live.cost", cost: stage.cost });
}

interface Plan {
  speaker: string | null;
  say: string;
  work: string | null;
}

function parsePlan(text: string | null, team: StageAgent[]): Plan | null {
  if (!text) return null;
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  let raw: { speaker?: unknown; say?: unknown; work?: unknown };
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const handle = typeof raw.speaker === "string" ? raw.speaker.replace(/^@/, "").toLowerCase() : "";
  const agent = team.find((a) => a.handle.toLowerCase() === handle || a.name.toLowerCase() === handle);
  const say = typeof raw.say === "string" ? speakable(raw.say).slice(0, MAX_LINE_CHARS) : "";
  const work = typeof raw.work === "string" && raw.work.trim() ? raw.work.trim().slice(0, 1500) : null;
  return { speaker: agent && say ? agent.id : null, say, work: agent ? work : null };
}

/** The part of the maestro's prompt that stays the same all call long (the provider's prompt cache keeps it). */
function stageSystem(stage: Stage, people: string[], turnsLeft: number) {
  const team = stage.team
    .map((a, i) =>
      [
        `## ${a.name} (handle: ${a.handle})${i === 0 && stage.team.length > 1 ? " — leads the meeting" : ""}`,
        a.role ? `Role: ${a.role}` : "",
        a.instructions ? `How they work: ${a.instructions}` : "",
        a.notes ? `On calls: ${a.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return [
    LIVE_CALL.trim(),
    stage.workspaceNotes ? `# This workspace's notes for calls\n${stage.workspaceNotes}` : "",
    `# The team at ${stage.orgName}\n${team}`,
    stage.orgContext ? `# About ${stage.orgName}\n${stage.orgContext}` : "",
    `# People on the call\n${people.join(", ")}`,
    [
      "# Your job now",
      "You are the meeting's maestro: you decide which ONE agent speaks next, if any, and write exactly what they say, in their voice and from their role. Write the line as speech, in " +
        languageName(stage.language) +
        ".",
      `Agents may speak ${turnsLeft} more time(s) before the people must speak again: use them only when a colleague would really add something (build on it, push back, bring their role's angle). Never two lines from the same agent in a row.`,
      'When the line needs something looked up, checked or done (data, the web, files, the team\'s systems, a task), the agent says one short natural line ("já vejo", "deixa eu ver isso") and you put the request in "work", written as the person would ask it, with what it needs. Only an agent whose role it is takes it.',
      'Answer only JSON: {"speaker": "<handle>", "say": "<what they say>", "work": "<request or empty>"} or {"speaker": "none"}.',
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function namesOfPeople(deps: LiveVoiceDeps, room: Room) {
  const ids = presentPeople(room, new Date()).map((p) => p.userId);
  if (!ids.length) return [];
  const rows = await deps.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return rows.map((r) => r.name || "someone");
}

/** What the lead says when a call opens with no topic: no model needed, so it comes at once. */
function openingLine(stage: Stage, people: string[]) {
  const lead = stage.team[0];
  if (!lead) return null;
  const names = people.map((p) => p.split(/\s+/)[0]).filter(Boolean);
  const who = names.length === 1 ? names[0] : names.length ? "pessoal" : "";
  const pt = stage.language.toLowerCase().startsWith("pt");
  const say = pt
    ? `Oi${who ? `, ${who}` : ""}! Tá todo mundo aqui. Sobre o que a gente vai falar?`
    : `Hi${who ? `, ${who}` : ""}! Everyone's here. What shall we talk about?`;
  return JSON.stringify({ speaker: lead.handle, say });
}

/** Older lines folded into a short running summary, so each call reads a few lines word for word and not the meeting. */
async function summarize(deps: LiveVoiceDeps, stage: Stage, room: Room) {
  const old = room.lines.length - RECENT_LINES;
  if (old - stage.summarized < SUMMARIZE_EVERY || !deps.think) return;
  const chunk = await linesAsChat(deps, room.lines.slice(stage.summarized, old));
  stage.summarized = old;
  const text = await deps
    .think({
      orgId: stage.orgId,
      agentId: stage.team[0]?.id ?? null,
      system:
        "You keep the running summary of a voice meeting: what was discussed, what was decided, who took what. Under 120 words, plain sentences, the meeting's language.",
      prompt: `${stage.summary ? `Summary so far:\n${stage.summary}\n\n` : ""}New lines:\n${chunk.map((l) => `${l.author}: ${l.text}`).join("\n")}`,
      maxTokens: 300,
    })
    .catch(() => null);
  if (text) stage.summary = text.trim().slice(0, 1200);
}

type Reason =
  | { reason: "open" }
  | { reason: "open-topic" }
  | { reason: "person" }
  | { reason: "agent"; after: string }
  | { reason: "answer"; agentId: string; answer: string | null; asked: string };

/** One decision: who speaks next and what. Then the line is spoken, and the next one is prepared while it plays. */
function think(deps: LiveVoiceDeps, stage: Stage, why: Reason): Promise<void> {
  return thinkNow(deps, stage, why).catch((error) => {
    stage.thinking = false;
    deps.log?.warn("maestro think failed", {
      roomId: stage.roomId,
      reason: why.reason,
      error: String(error).slice(0, 300),
    });
  });
}

async function thinkNow(deps: LiveVoiceDeps, stage: Stage, why: Reason): Promise<void> {
  if (!deps.think) return;
  if (stage.thinking) {
    // An answer waits for its turn; anything else is replaced by the newer reason.
    if (why.reason !== "answer") stage.again = why;
    else setTimeout(() => void think(deps, stage, why), 1500);
    return;
  }
  const room = await freshRoom(deps, stage.roomId);
  if (!room) return maestroEnded(stage.roomId);
  const gen = stage.gen;
  const limit = stage.topic ? MAESTRO_DEBATE_TURNS : MAESTRO_TURNS;
  const turnsLeft = limit - stage.agentLines;
  if (why.reason === "agent" && turnsLeft <= 0) return;
  stage.thinking = true;
  try {
    await summarize(deps, stage, room);
    const people = await namesOfPeople(deps, room);
    const recent = await linesAsChat(deps, room.lines.slice(-RECENT_LINES));
    const name = (id: string) => stage.team.find((a) => a.id === id)?.name ?? "an agent";
    // Who was asked answers: decided here, not left to the model (adjacency pairs, docs/adr/doug-0006 §11).
    const lastLine = room.lines.at(-1);
    const addressed =
      lastLine && why.reason !== "open" && why.reason !== "open-topic" && why.reason !== "answer"
        ? addressedIn(
            lastLine.text,
            stage.team.filter((a) => a.id !== lastLine.who.id),
          )
        : null;
    const moment =
      why.reason === "open"
        ? `The call just started. ${stage.team[0]?.name ?? "The lead"} greets ${people.join(", ") || "everyone"} in one short sentence and asks what we'll work on.`
        : why.reason === "open-topic"
          ? `The call just started to debate this topic: ${untrustedBlock("topic", stage.topic ?? "", 600)}\n${stage.team[0]?.name ?? "The lead"} opens it in two sentences and hands it to the colleague whose role fits best, by name.`
          : why.reason === "person"
            ? addressed
              ? `A person just spoke to ${name(addressed)} by name (the last line): ${name(addressed)} answers.`
              : "A person just spoke (the last line). Who on the team answers, and what? Small talk goes to the lead."
            : why.reason === "agent"
              ? `${name(why.after)} just spoke (the last line). Does a colleague react before the people answer? "none" when it asked the people something or nothing real would be added.`
              : `${name(why.agentId)}'s work on "${why.asked.slice(0, 200)}" came back. ${name(why.agentId)} tells it now, briefly and naturally, as speech.\n${why.answer ? untrustedBlock("work-result", why.answer, 3000) : "It isn't done yet: say it'll be in the conversation as soon as it's ready."}`;
    const prompt = [
      stage.summary ? `# Earlier in the call\n${stage.summary}` : "",
      recent.length ? `# The call, latest last\n${chatBlock(recent, "call")}` : "",
      `# Now\n${moment}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    stage.cost.thinks++;
    const started = Date.now();
    // The opening greeting needs no model: it is said at once.
    const greeting = why.reason === "open" ? openingLine(stage, people) : null;
    const text =
      greeting ??
      (await deps
        .think({
          orgId: stage.orgId,
          agentId: stage.team[0]?.id ?? null,
          system: stageSystem(stage, people, Math.max(1, turnsLeft)),
          prompt,
          maxTokens: THINK_TOKENS,
        })
        .catch(() => null));
    // A person spoke (or hushed) meanwhile: this answer is for a moment that's gone.
    if (stage.gen !== gen && why.reason !== "answer") return;
    const plan = parsePlan(text, stage.team);
    deps.log?.info("maestro think", {
      roomId: stage.roomId,
      reason: why.reason,
      ms: Date.now() - started,
      speaker: plan?.speaker ? stage.team.find((a) => a.id === plan.speaker)?.handle : null,
      ...(plan ? {} : { answer: (text ?? "").slice(0, 160) }),
      stale: stage.gen !== gen,
    });
    const forced =
      why.reason === "answer"
        ? stage.team.find((a) => a.id === why.agentId)
        : addressed
          ? stage.team.find((a) => a.id === addressed)
          : null;
    const agent = forced ?? stage.team.find((a) => a.id === plan?.speaker);
    if (!agent || !plan?.say) return;
    // Never the same agent twice in a row; an answer comes from who did the work.
    if (!forced && stage.spoke.at(-1) === agent.id && why.reason === "agent") return;
    // Wait for a pause: a person talking, or the line before still playing far ahead.
    while (Date.now() < stage.quietUntil && stage.gen === gen) await new Promise((r) => setTimeout(r, 300));
    if (stage.gen !== gen && why.reason !== "answer") return;
    stage.agentLines++;
    stage.spoke.push(agent.id);
    await speak(deps, stage, room, agent, plan.say, stage.gen);
    if (plan.work) void startWork(deps, stage, room, agent, plan.work);
    // The next line is prepared while this one plays.
    const ready = stage.queueEndsAt - PREPARE_AHEAD_MS;
    const after = agent.id;
    const at = stage.gen;
    setTimeout(
      () => {
        if (stage.gen === at && stages.get(stage.roomId) === stage) void think(deps, stage, { reason: "agent", after });
      },
      Math.max(0, ready - Date.now()) * PACE,
    );
  } finally {
    stage.thinking = false;
    const again = stage.again;
    stage.again = null;
    if (again && stage.gen >= gen) void think(deps, stage, again);
  }
}

/**
 * Work an agent took on during the call: asked in the conversation as the person's message mentioning it, so it runs
 * with the agent's tools; everyone sees it working, and its answer is told at the next pause.
 */
async function startWork(deps: LiveVoiceDeps, stage: Stage, room: Room, agent: StageAgent, ask: string) {
  if (!deps.postMessage) return;
  const userId = stage.lastSpeaker ?? room.hostUserId;
  if (!userId) return;
  const [talkable] = await talkableAgents(deps, userId, stage.orgId, stage.channelId, [agent.id]);
  if (!talkable) return;
  const since = new Date(Date.now() - 1000);
  const posted = await deps.postMessage(userId, stage.orgId, stage.channelId, `@${agent.handle} ${ask}`, {
    via: "call",
    liveRoomId: room.id,
  });
  await tell(deps, room, { type: "live.working", agentId: agent.id, on: true });
  const answer = await agentAnswer(
    deps,
    { orgId: stage.orgId, userId, channelId: stage.channelId, agentId: agent.id },
    posted.id,
    since,
    () => {},
  ).catch(() => null);
  await tell(deps, room, { type: "live.working", agentId: agent.id, on: false });
  if (stages.get(stage.roomId) !== stage) return;
  await think(deps, stage, {
    reason: "answer",
    agentId: agent.id,
    answer: answer ? speakable(answer) : null,
    asked: ask,
  });
}

/** For tests: the room's stage, a clean slate, and the pace of the waits between lines (1 = real time). */
export const maestroStage = (roomId: string) => stages.get(roomId) ?? null;
export function resetMaestro(pace = 1) {
  stages.clear();
  speeches.clear();
  PACE = pace;
}

/** The agents a person may bring to a maestro call, checked like any call's. */
export async function maestroTeam(
  deps: LiveVoiceDeps,
  userId: string,
  orgId: string,
  channelId: string,
  ids: string[],
) {
  const talkable = await talkableAgents(deps, userId, orgId, channelId, ids);
  if (!talkable.length) throw new NotFoundError("No agent to call");
  return talkable;
}
