import type { ApiClient } from "../api/client";
import type { LiveRoomLine } from "../api/types";
import {
  addressed,
  afterAgent,
  afterPerson,
  bringIn,
  type FloorAgent,
  type FloorDecision,
  type FloorState,
  giveFloor,
  initialFloor,
  mayBringIn,
  namedAgent,
} from "./live-floor";

/**
 * The turns of a voice room, run by the app that hosts its agents (ADR doug-0006): who has the word, what each voice is
 * told when it gets it, the people's words as the agent with the word hears them, the small model's picks, and work
 * asked on the call ("já vejo") told at the next pause. No audio here: the app says how to open and close a voice
 * (`gate`) and how loud the people are, so the phone app and the web share one set of rules (`live-floor`).
 */

export type Who = `person:${string}` | `agent:${string}`;

export const whoOf = (line: Pick<LiveRoomLine, "who">): Who => `${line.who.type}:${line.who.id}`;

/** What the host can tell one agent's GPT-Live session (`LiveLeg`). */
export interface HostLeg {
  hear(on: boolean): void;
  instruct(content: string): void;
  note(content: string): void;
  answer(delegationId: string, content: string): void;
}

export interface LiveHostDeps {
  api: Pick<ApiClient["liveVoice"], "lines" | "floor" | "next" | "ask">;
  orgId: string;
  roomId: string;
  /** The room's agents in order (the first leads the meeting). */
  agents: () => FloorAgent[];
  /** People on the call now. */
  people: () => number;
  /** The agent's session, once it is open. */
  leg: (agentId: string) => HostLeg | null;
  /** Its voice is on (connected and not failed). */
  live: (agentId: string) => boolean;
  /** Opens the agent with the word (it hears and is heard) and closes the others; null: every agent listens. */
  gate: (holder: string | null) => void;
  /** A person is talking now (their microphone). */
  peopleTalking: () => boolean;
  /** Whose the words being said now are (the loudest microphone meanwhile). */
  loudestPerson: () => string;
  /** A name to tell the agents ("Bia", "Ana"). */
  nameOf: (who: Who) => string;
  /** The word changed hands. */
  onHolder: (holder: string | null) => void;
  /** A whole line said on the call. */
  onLine: (line: LiveRoomLine) => void;
  /** Words still being said; `text` empty clears them. */
  onLiveCaption: (who: Who, text: string) => void;
  now?: () => number;
}

const AGENT_LINE_IDLE_MS = 1300;
const JUDGE_WAIT_MS = 900;
/** With one person the judge only picks who answers: no wait for more words. */
const JUDGE_WAIT_SOLO_MS = 150;
/** An answer to work asked on the call waits for a pause this long before it is told. */
const ANSWER_PAUSE_MS = 1500;
/** Past this an answer is told at the next breath, pause or not. */
const ANSWER_WAIT_MS = 30_000;
/** A new call's first agent that hasn't greeted by then is asked to. */
const GREET_NUDGE_MS = 2500;

interface VoiceTurn {
  /** Cut off (the word left it mid-sentence): what it goes on saying is dropped until the word comes back to it. */
  cut: boolean;
  /** What it is saying now, until it pauses. */
  said: string;
  idle: ReturnType<typeof setTimeout> | null;
  /** How many lines it had when it last got the call's notes. */
  seen: number;
}

export class LiveHost {
  private floor: FloorState = initialFloor();
  private lines: LiveRoomLine[] = [];
  private voices = new Map<string, VoiceTurn>();
  private judging = false;
  private agentAsking = false;
  private personText = "";
  private personIdle: ReturnType<typeof setTimeout> | null = null;
  private switchedTo: string | null = null;
  private answers: { agentId: string; delegationId: string; text: string | null; at: number }[] = [];
  private lastSoundAt = 0;
  private stopped = false;

  constructor(private readonly d: LiveHostDeps) {}

  private now() {
    return this.d.now?.() ?? Date.now();
  }
  get holder() {
    return this.floor.holder;
  }
  private get moderator(): string | null {
    return this.d.agents()[0]?.id ?? null;
  }

  /** The host starts running the agents: the lead has the word (it greets a new call). */
  start(lines: LiveRoomLine[]) {
    this.lines = [...lines];
    const ids = this.d.agents().map((a) => a.id);
    for (const id of ids) this.voices.set(id, { cut: false, said: "", idle: null, seen: this.lines.length });
    this.floor = initialFloor(ids[0] ?? null, this.now());
    this.d.onHolder(this.floor.holder);
    this.d.gate(this.floor.holder);
  }

  stop() {
    this.stopped = true;
    for (const v of this.voices.values()) if (v.idle) clearTimeout(v.idle);
    if (this.personIdle) clearTimeout(this.personIdle);
  }

  /** An agent's session opened: it hears only if it has the word; the lead of a new call is asked to greet. */
  voiceOpened(agentId: string) {
    const leg = this.d.leg(agentId);
    leg?.hear(this.floor.holder === agentId);
    if (this.floor.holder === agentId && this.lines.length === 0)
      setTimeout(() => {
        const voice = this.voices.get(agentId);
        if (this.stopped || voice?.said || this.lines.length || this.floor.holder !== agentId) return;
        this.d
          .leg(agentId)
          ?.instruct("The call is on. Greet everyone now in one short sentence and ask what we'll work on.");
      }, GREET_NUDGE_MS);
  }

  /** A voice that failed can't keep the word: it goes to the lead, else the people. */
  voiceFailed(agentId: string) {
    if (this.stopped || this.floor.holder !== agentId) return;
    const lead = this.moderator !== agentId && this.d.live(this.moderator ?? "");
    this.apply(giveFloor(this.floor, lead ? this.moderator : null, "manual"), false);
  }

  /** A line someone else wrote down (another person's own words, from the server). */
  heard(line: LiveRoomLine) {
    this.lines.push(line);
  }

  /** "Dar a palavra" on this app, or a person's on theirs (`live.floor`). */
  give(holder: string | null) {
    this.apply(giveFloor(this.floor, holder, "manual"));
  }

  /** What GPT-Live says of one agent's session. */
  voiceEvent(agentId: string, e: { type: string; delta?: string }) {
    const voice = this.voices.get(agentId);
    if (!voice || this.stopped) return;
    if (e.type === "session.output_transcript.delta" && e.delta) {
      // Without the word (or cut off) nobody hears it: what it says doesn't count.
      if (voice.cut || this.floor.holder !== agentId) return;
      voice.said += e.delta;
      this.lastSoundAt = this.now();
      this.d.onLiveCaption(`agent:${agentId}`, voice.said);
      if (voice.idle) clearTimeout(voice.idle);
      voice.idle = setTimeout(() => this.agentPaused(agentId), AGENT_LINE_IDLE_MS);
    }
    if (e.type === "session.input_transcript.delta" && e.delta && this.floor.holder === agentId)
      this.peopleSaid(e.delta);
  }

  /** The agent delegated ("já vejo"): what was being asked goes to the conversation for it to work on. */
  delegated(agentId: string, delegationId: string) {
    // Its last words and the person's arrive just after the delegation: wait for them.
    setTimeout(() => {
      if (this.stopped) return;
      const recent = this.lines.slice(-6);
      const lastPerson = [...recent].reverse().find((l) => l.who.type === "person")?.text ?? "";
      const now = this.personText.trim();
      const ask = [
        now || lastPerson,
        `(Pedido feito na chamada de voz. O que se disse por último:\n${this.format(recent)}${now ? `\n${this.d.nameOf(`person:${this.d.loudestPerson()}`)}: ${now}` : ""})`,
      ]
        .filter(Boolean)
        .join("\n\n");
      this.d.api.ask(this.d.orgId, this.d.roomId, { agentId, ask, delegationId }).catch(() => {
        this.d
          .leg(agentId)
          ?.answer(
            delegationId,
            "That couldn't be started right now. Say so briefly, and that it can be asked in the chat.",
          );
      });
    }, 700);
  }

  /** The answer to work asked on the call came (`live.answer`): told at the next pause. */
  answerArrived(answer: { agentId: string; delegationId: string; text: string | null }) {
    this.answers.push({ ...answer, at: this.now() });
    this.deliverAnswers();
  }

  /** Called every so often: tells an answer when the call has a pause, or after a while at the next breath. */
  deliverAnswers() {
    const next = this.answers[0];
    if (!next || this.stopped) return;
    const leg = this.d.leg(next.agentId);
    if (!leg || !this.d.live(next.agentId)) {
      this.answers.shift();
      return;
    }
    const holder = this.floor.holder ? this.voices.get(this.floor.holder) : null;
    const busy = Boolean(holder?.said.trim()) || Boolean(this.personText) || this.d.peopleTalking();
    const waited = this.now() - next.at;
    if (busy || (this.now() - this.lastSoundAt < ANSWER_PAUSE_MS && waited < ANSWER_WAIT_MS)) return;
    this.answers.shift();
    if (this.floor.holder !== next.agentId) this.apply(giveFloor(this.floor, next.agentId, "judge"), false);
    leg.answer(
      next.delegationId,
      next.text ??
        "It's taking longer than the call: say briefly that the answer will be in the conversation as soon as it's done.",
    );
  }

  // ── The people's words, as the agent with the word hears them ──
  private peopleSaid(delta: string) {
    this.personText += delta;
    this.lastSoundAt = this.now();
    const who = this.d.loudestPerson();
    this.d.onLiveCaption(`person:${who}`, this.personText.trim());
    // Once per sentence: passing the word back and forth on every name said would be worse than none.
    const named = this.switchedTo ? null : namedAgent(this.personText, this.d.agents(), this.floor.holder);
    if (named && this.d.live(named)) {
      this.apply(addressed(this.floor, named, this.now()), false);
      this.switchedTo = named;
      this.d
        .leg(named)
        ?.note(
          `${this.d.nameOf(`person:${who}`)} is talking to you and said so far: "${this.personText.trim().slice(-600)}"`,
        );
    }
    if (this.personIdle) clearTimeout(this.personIdle);
    this.personIdle = setTimeout(() => this.personPaused(), AGENT_LINE_IDLE_MS);
  }

  private personPaused() {
    const text = this.personText.trim();
    const who = this.d.loudestPerson();
    this.personText = "";
    this.personIdle = null;
    const switched = this.switchedTo;
    this.switchedTo = null;
    this.d.onLiveCaption(`person:${who}`, "");
    if (!text || this.stopped) return;
    const line: LiveRoomLine = { at: new Date(this.now()).toISOString(), who: { type: "person", id: who }, text };
    this.write(line);
    const d = afterPerson(this.floor, text, this.floorRoom());
    if (switched && d.state.holder === switched) {
      this.floor = d.state;
      const voice = this.voices.get(switched);
      if (voice && !voice.said.trim())
        this.d
          .leg(switched)
          ?.instruct(
            `${this.d.nameOf(`person:${who}`)} just said to you: "${text.slice(-600)}". Answer now, briefly, then stop.`,
          );
      return;
    }
    this.apply(d);
  }

  private agentPaused(agentId: string) {
    const voice = this.voices.get(agentId);
    if (!voice || this.stopped) return;
    const text = voice.said.trim();
    voice.said = "";
    voice.idle = null;
    if (!text || voice.cut) return;
    this.write({ at: new Date(this.now()).toISOString(), who: { type: "agent", id: agentId }, text });
    const d = afterAgent(this.floor, agentId, text, {
      agents: this.d.agents(),
      now: this.now(),
      moderator: this.moderator,
    });
    this.apply(d);
    if (d.reason === "continue") this.askAfter(agentId);
  }

  /** A whole line: shown, and kept for the notes. */
  private write(line: LiveRoomLine) {
    this.lines.push(line);
    this.d.onLine(line);
    void this.d.api.lines(this.d.orgId, this.d.roomId, [{ who: line.who, text: line.text }]).catch(() => {});
  }

  /** Cuts an agent off mid-sentence: what it said so far is a line ending in "…". */
  private cutOff(agentId: string, by: string | null) {
    const voice = this.voices.get(agentId);
    if (!voice) return;
    voice.cut = true;
    if (voice.idle) clearTimeout(voice.idle);
    voice.idle = null;
    const text = voice.said.trim();
    voice.said = "";
    if (!text) return;
    this.write({ at: new Date(this.now()).toISOString(), who: { type: "agent", id: agentId }, text: `${text}…` });
    voice.seen = this.lines.length;
    this.d
      .leg(agentId)
      ?.note(
        `${by ? `The word went to ${this.d.nameOf(`agent:${by}`)}` : "The word went to the people"} while you were saying: "${text.slice(-300)}". Stop there. When the word comes back to you, don't finish that sentence: react to what was said.`,
      );
  }

  private floorRoom() {
    return { agents: this.d.agents(), people: this.d.people(), now: this.now(), moderator: this.moderator };
  }

  /** Agents the limits keep out now, or whose voice isn't on. */
  private skipped(extraTurn: number) {
    return this.d
      .agents()
      .map((a) => a.id)
      .filter((id) => !this.d.live(id) || !mayBringIn(this.floor, id, extraTurn));
  }

  /** An agent finished and nobody was picked yet: does a colleague build on it before the people answer? */
  private askAfter(agentId: string) {
    const agents = this.d.agents();
    if (this.agentAsking || agents.length < 2) return;
    const skip = this.skipped(0);
    if (agents.every((a) => a.id === agentId || skip.includes(a.id))) return;
    const asked = this.lines.length;
    this.agentAsking = true;
    void this.d.api
      .next(this.d.orgId, this.d.roomId, { moment: "after", speaking: { agentId }, skip })
      .then((pick) => {
        // Only if nothing was said since and nobody is talking: the people come first.
        if (!pick.agentId || this.stopped || this.floor.holder !== agentId || this.lines.length !== asked) return;
        if (this.d.peopleTalking()) return;
        const d = bringIn(this.floor, pick.agentId, this.now());
        if (d) this.apply(d);
      })
      .catch(() => {})
      .finally(() => {
        this.agentAsking = false;
      });
  }

  /**
   * A person spoke to nobody by name: the small model says which agent answers. With one person someone always does;
   * with several, it may say nobody.
   */
  private askJudge() {
    if (this.judging) return;
    this.judging = true;
    const solo = this.d.people() <= 1;
    const asked = this.lines.length;
    setTimeout(
      async () => {
        let agentId: string | null = null;
        try {
          agentId = (await this.d.api.next(this.d.orgId, this.d.roomId)).agentId;
        } catch {}
        this.judging = false;
        if (this.stopped || (this.floor.holder !== null && this.floor.holder !== this.moderator)) return;
        if (solo && (!agentId || !this.d.live(agentId))) agentId = this.fallbackSpeaker();
        if (agentId && (solo || this.lines.length === asked)) this.apply(giveFloor(this.floor, agentId, "judge"));
      },
      solo ? JUDGE_WAIT_SOLO_MS : JUDGE_WAIT_MS,
    );
  }

  /** Who answers when the judge can't say: the agent that spoke last, else the first one whose voice is on. */
  private fallbackSpeaker(): string | null {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      if (line?.who.type === "agent" && this.d.live(line.who.id)) return line.who.id;
    }
    return this.d.agents().find((a) => this.d.live(a.id))?.id ?? null;
  }

  /**
   * Puts a turn decision into effect: who hears, what the new speaker missed, and a cue to answer (`cue: false` when it
   * hears what comes next anyway).
   */
  private apply(d: FloorDecision, cue = true) {
    const before = this.floor.holder;
    if (before && before !== d.state.holder && this.voices.get(before)?.said.trim())
      this.cutOff(before, d.state.holder);
    this.floor = d.state;
    const holder = d.state.holder;
    for (const a of this.d.agents()) this.d.leg(a.id)?.hear(a.id === holder);
    if (holder && holder !== before) {
      const voice = this.voices.get(holder);
      if (voice) {
        voice.cut = false;
        voice.said = "";
      }
    }
    this.d.gate(holder);
    if (holder && d.changed) {
      const voice = this.voices.get(holder);
      const leg = this.d.leg(holder);
      if (voice && leg) {
        const missed = this.lines.slice(voice.seen);
        voice.seen = this.lines.length;
        if (missed.length) leg.note(`What was said on the call while you listened:\n${this.format(missed)}`);
        const last = this.lines.at(-1);
        const quiet = ["continue", "solo", "limit", "people"].includes(d.reason);
        if (cue && last && last.who.id !== holder && !quiet) {
          const who = this.d.nameOf(whoOf(last));
          const said = last.text.slice(-600);
          leg.instruct(
            last.who.type === "agent" && (d.reason === "handoff" || d.reason === "judge")
              ? `It is your turn now. ${who} just said: "${said}". Build on it, push back, or add what your role sees, in one or two sentences, then stop. Don't just agree.`
              : `It is your turn now. ${who} just said: "${said}". Answer now, briefly, then stop.`,
          );
        }
      }
    }
    if (holder !== before || d.changed) {
      this.d.onHolder(holder);
      void this.d.api.floor(this.d.orgId, this.d.roomId, holder, d.reason).catch(() => {});
    }
    if (d.ask) this.askJudge();
  }

  private format(lines: LiveRoomLine[]) {
    return lines.map((l) => `${this.d.nameOf(whoOf(l))}: ${l.text}`).join("\n");
  }
}
