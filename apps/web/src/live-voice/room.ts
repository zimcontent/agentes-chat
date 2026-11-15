import type { ApiClient, LiveRoom, LiveRoomLine, RealtimeConnection } from "@agenteschat/client";
import {
  afterAgent,
  afterPerson,
  bringIn,
  type FloorAgent,
  type FloorDecision,
  type FloorState,
  giveFloor,
  initialFloor,
  interrupt,
  mayBringIn,
} from "@agenteschat/client/lib/live-floor";
import { LiveLeg } from "./leg";

/**
 * A voice room in this browser (ADR doug-0006). People reach each other directly (a WebRTC connection between each pair,
 * signalled through the server). The host's browser also runs one GPT-Live session per agent: each hears the people's
 * microphones and the other agents, and its voice is sent on to every person as a track of its own, so every app can
 * light the tile of whoever speaks. Who has the word is code (`live-floor`), applied by the host: the agent with it
 * hears the call, the others are muted and get what they missed as notes when it comes to them. Agents talk like a
 * meeting: while one talks the small model is asked, a sentence at a time, whether a colleague cuts in or follows; one
 * cut off is faded out (each voice goes through a gain of its own) and told it was interrupted.
 */

export type Who = `person:${string}` | `agent:${string}`;

export interface Caption {
  who: Who;
  text: string;
  at: number;
  /** Still being said (this browser's own words before the sentence ends). */
  live?: boolean;
  /** Its place in this call's captions. */
  n?: number;
}

export interface RoomCallState {
  phase: "joining" | "live" | "ended" | "failed";
  error: unknown;
  room: LiveRoom | null;
  micOn: boolean;
  /** The agent with the word; null: the people. */
  holder: string | null;
  /** Each agent's voice, on the host's side: connecting, live or failed. */
  agentVoices: Record<string, "connecting" | "live" | "failed">;
  captions: Caption[];
  /** This browser writes down what its person says. */
  hearsMe: boolean;
}

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
const PING_MS = 20_000;
const AGENT_LINE_IDLE_MS = 1300;
const JUDGE_WAIT_MS = 900;
/** While an agent talks, the small model is asked at most this often whether a colleague cuts in or follows. */
const DURING_ASK_MS = 4000;
/** An agent talks at least this long before anyone cuts in. */
const CUT_IN_AFTER_MS = 2500;
/** A sentence just ended (the moment a colleague may come in). */
const SENTENCE_END = /[.!?…]["”')]?\s*$/;
/** With one person the judge only picks who answers: no wait for more words. */
const JUDGE_WAIT_SOLO_MS = 150;
/** A new call's first agent that hasn't greeted by then is asked to. */
const GREET_NUDGE_MS = 2500;
const MAX_CAPTIONS = 60;

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  agentSenders: Map<string, RTCRtpSender>;
  /** Their streams not yet known as their microphone or an agent's voice (the host's map may come after). */
  unknown: Map<string, MediaStream>;
}

interface AgentVoice {
  leg: LiveLeg | null;
  input: MediaStreamAudioDestinationNode;
  /** Its voice as everyone hears it: after its gain, so it can be cut off. */
  out: MediaStream | null;
  outSource: AudioNode | null;
  gain: GainNode | null;
  /** Keeps OpenAI's track flowing into Web Audio (Chrome plays a remote track only while an element holds it). */
  sink: HTMLAudioElement | null;
  /** Cut off by a colleague: what it goes on saying is dropped until the word comes back to it. */
  cut: boolean;
  /** When it got the word (ms). */
  turnAt: number;
  /** What it is saying now, until it pauses. */
  said: string;
  idle: ReturnType<typeof setTimeout> | null;
  /** How many lines it had when it last got the call's notes. */
  seen: number;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export class RoomCall {
  private state: RoomCallState = {
    phase: "joining",
    error: null,
    room: null,
    micOn: true,
    holder: null,
    agentVoices: {},
    captions: [],
    hearsMe: false,
  };
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private peers = new Map<string, Peer>();
  private personSources = new Map<string, MediaStreamAudioSourceNode>();
  private agentStreams = new Map<string, string>();
  private voices = new Map<string, AgentVoice>();
  private analysers = new Map<Who, AnalyserNode>();
  private levels = new Map<Who, number>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private lines: LiveRoomLine[] = [];
  private floor: FloorState = initialFloor();
  private judging = false;
  private speech: SpeechRecognitionLike | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private off: (() => void) | null = null;
  private frame = 0;
  private torn = false;

  constructor(
    private readonly o: {
      api: ApiClient;
      orgId: string;
      channelId: string;
      me: string;
      /** Every agent the app knows, for their names (the room says which are on the call). */
      agents: FloorAgent[];
      connection: RealtimeConnection | null;
      /** The app's language, for the people's captions and the agents' speech (`pt-BR`). */
      language: string;
    },
  ) {}

  // ── State for React ──
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<RoomCallState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  /** How loud each one is now, 0 to 1 (read each frame by the tiles). */
  level = (who: Who) => this.levels.get(who) ?? 0;
  get isHost() {
    return this.state.room?.hostUserId === this.o.me;
  }
  private get roomAgents(): FloorAgent[] {
    const ids = this.state.room?.agentIds ?? [];
    return ids.flatMap((id) => this.o.agents.filter((a) => a.id === id));
  }

  // ── Start, join, leave ──
  async start(agentIds: string[]) {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx = new AudioContext();
      this.micSource = this.ctx.createMediaStreamSource(this.mic);
      this.watch(`person:${this.o.me}`, this.micSource);
      this.off =
        this.o.connection?.onUserEvent((e) => this.onEvent(e as { type: string; [key: string]: unknown })) ?? null;
      const room = await this.o.api.liveVoice.joinRoom(this.o.orgId, this.o.channelId, agentIds);
      this.lines = [...room.lines];
      this.set({
        phase: "live",
        room,
        captions: room.lines.map((l) => ({ who: whoOf(l), text: l.text, at: Date.parse(l.at), n: ++this.said })),
      });
      this.timers.push(setInterval(() => void this.ping(), PING_MS));
      this.startHearingMe();
      this.loop();
      await this.applyRoom(room);
    } catch (error) {
      this.set({ phase: "failed", error });
      this.teardown();
    }
  }

  /** Leaves; the others go on (the host's place passes to the next person). */
  async leave() {
    const room = this.state.room;
    this.teardown();
    this.set({ phase: "ended" });
    if (room) await this.o.api.liveVoice.leave(this.o.orgId, room.id).catch(() => {});
  }

  /** Ends the call for everyone: its notes go to the conversation, for the report. */
  async endForAll() {
    const room = this.state.room;
    if (!room) return this.leave();
    await this.closeVoices();
    const ended = await this.o.api.liveVoice.end(this.o.orgId, room.id).catch(() => null);
    this.teardown();
    this.set({ phase: "ended", room: ended?.room ?? { ...room, status: "ended" } });
  }

  toggleMic() {
    const on = !this.state.micOn;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = on;
    this.set({ micOn: on });
    if (on) this.startHearingMe();
    else this.speech?.abort();
  }

  /** "Dar a palavra": to an agent, or back to the people (null). The host applies it. */
  give(holder: string | null) {
    const room = this.state.room;
    if (!room) return;
    if (this.isHost) this.apply(giveFloor(this.floor, holder, "manual"));
    else void this.o.api.liveVoice.floor(this.o.orgId, room.id, holder, "manual").catch(() => {});
  }

  private async ping() {
    const room = this.state.room;
    if (!room || this.torn) return;
    try {
      await this.applyRoom(await this.o.api.liveVoice.ping(this.o.orgId, room.id));
    } catch {
      // The call ended, or this person was dropped for silence: what the server says next decides.
      const now = await this.o.api.liveVoice.channelRoom(this.o.orgId, this.o.channelId).catch(() => null);
      if (now && (!now.room || now.room.id !== room.id)) {
        this.teardown();
        this.set({ phase: "ended", room: { ...room, status: "ended" } });
      }
    }
  }

  private onEvent(e: { type: string; [key: string]: unknown }) {
    const room = this.state.room;
    if (!room || this.torn) return;
    if (e.type === "live.room") {
      const next = e.room as LiveRoom;
      if (next.id === room.id) void this.applyRoom(next);
      return;
    }
    if (e.roomId !== room.id) return;
    if (e.type === "live.signal") void this.onSignal(String(e.from), e.data as Signal);
    if (e.type === "live.lines") for (const line of e.lines as LiveRoomLine[]) this.heard(line, false);
    if (e.type === "live.floor") {
      const holder = (e.holder as string | null) ?? null;
      if (this.isHost && e.by !== this.o.me) this.apply(giveFloor(this.floor, holder, "manual"));
      else if (!this.isHost) this.set({ holder });
    }
  }

  private async applyRoom(room: LiveRoom) {
    if (this.torn) return;
    this.set({ room });
    if (room.status === "ended") {
      this.teardown();
      this.set({ phase: "ended" });
      return;
    }
    const others = new Set(room.people.map((p) => p.userId).filter((u) => u !== this.o.me));
    for (const userId of others) if (!this.peers.has(userId)) this.openPeer(userId);
    for (const [userId] of this.peers) if (!others.has(userId)) this.closePeer(userId);
    // This app runs the agents' voices while its person hosts the room, and stops when the room passes to another.
    if (this.isHost && !this.hosting) {
      this.hosting = true;
      await this.startVoices();
    } else if (!this.isHost && this.hosting) {
      this.hosting = false;
      await this.closeVoices();
    }
  }
  private hosting = false;

  // ── People: one connection per pair (perfect negotiation) ──
  private openPeer(userId: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer: Peer = {
      pc,
      polite: this.o.me < userId,
      makingOffer: false,
      ignoreOffer: false,
      agentSenders: new Map(),
      unknown: new Map(),
    };
    this.peers.set(userId, peer);
    const signal = (data: Signal) => {
      const room = this.state.room;
      if (room) void this.o.api.liveVoice.signal(this.o.orgId, room.id, userId, data).catch(() => {});
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        signal({ kind: "desc", description: pc.localDescription?.toJSON() });
      } catch {
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) signal({ kind: "ice", candidate: candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      const agentId = this.agentStreams.get(stream.id);
      if (agentId) this.agentVoiceArrived(agentId, stream);
      else if (this.state.room?.hostUserId === userId) {
        // From the host: an agent's voice once its map says so, else its microphone.
        peer.unknown.set(stream.id, stream);
        setTimeout(() => {
          if (peer.unknown.delete(stream.id)) this.personArrived(userId, stream);
        }, 1500);
      } else this.personArrived(userId, stream);
    };
    if (this.mic) for (const track of this.mic.getAudioTracks()) pc.addTrack(track, this.mic);
    if (this.isHost)
      for (const [agentId, voice] of this.voices) if (voice.out) this.sendVoice(peer, agentId, voice.out);
    if (this.isHost) this.sendTrackMap(userId);
  }

  private closePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(userId);
    this.personSources.get(userId)?.disconnect();
    this.personSources.delete(userId);
    this.drop(`person:${userId}`);
  }

  private async onSignal(from: string, data: Signal) {
    if (!this.peers.has(from)) this.openPeer(from);
    const peer = this.peers.get(from);
    if (!peer) return;
    const { pc } = peer;
    try {
      if (data.kind === "desc" && data.description) {
        const description = data.description;
        const collision = description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          const room = this.state.room;
          if (room)
            await this.o.api.liveVoice.signal(this.o.orgId, room.id, from, {
              kind: "desc",
              description: pc.localDescription?.toJSON(),
            });
        }
      } else if (data.kind === "ice" && data.candidate) {
        await pc.addIceCandidate(data.candidate).catch((error) => {
          if (!peer.ignoreOffer) throw error;
        });
      } else if (data.kind === "tracks" && data.map) {
        for (const [streamId, agentId] of Object.entries(data.map)) {
          this.agentStreams.set(streamId, agentId);
          const waiting = peer.unknown.get(streamId);
          if (waiting) {
            peer.unknown.delete(streamId);
            this.agentVoiceArrived(agentId, waiting);
          }
        }
      }
    } catch {
      // A failed step is retried by the next negotiation.
    }
  }

  private personArrived(userId: string, stream: MediaStream) {
    this.play(`person:${userId}`, stream);
    if (!this.ctx) return;
    const source = this.ctx.createMediaStreamSource(stream);
    this.personSources.get(userId)?.disconnect();
    this.personSources.set(userId, source);
    this.watch(`person:${userId}`, source);
    // The agents hear every person on the call.
    for (const voice of this.voices.values()) source.connect(voice.input);
  }

  private agentVoiceArrived(agentId: string, stream: MediaStream) {
    this.play(`agent:${agentId}`, stream);
    if (this.ctx) this.watch(`agent:${agentId}`, this.ctx.createMediaStreamSource(stream));
  }

  private sendVoice(peer: Peer, agentId: string, stream: MediaStream) {
    if (peer.agentSenders.has(agentId)) return;
    const track = stream.getAudioTracks()[0];
    if (track) peer.agentSenders.set(agentId, peer.pc.addTrack(track, stream));
  }

  private sendTrackMap(userId?: string) {
    const room = this.state.room;
    if (!room) return;
    const map: Record<string, string> = {};
    for (const [agentId, voice] of this.voices) if (voice.out) map[voice.out.id] = agentId;
    const to = userId ? [userId] : [...this.peers.keys()];
    for (const u of to)
      void this.o.api.liveVoice.signal(this.o.orgId, room.id, u, { kind: "tracks", map }).catch(() => {});
  }

  // ── Agents' voices (the host) ──
  private async startVoices() {
    const room = this.state.room;
    if (!room || !this.ctx || !this.micSource) return;
    const ids = room.agentIds;
    // The first agent greets a new call; a call taken over goes on with the people.
    this.floor = initialFloor(room.lines.length === 0 ? (ids[0] ?? null) : null, Date.now());
    this.set({ holder: this.floor.holder });
    for (const agentId of ids) {
      const input = this.ctx.createMediaStreamDestination();
      this.micSource.connect(input);
      for (const source of this.personSources.values()) source.connect(input);
      for (const other of this.voices.values()) other.outSource?.connect(input);
      this.voices.set(agentId, {
        leg: null,
        input,
        out: null,
        outSource: null,
        gain: null,
        sink: null,
        cut: false,
        turnAt: 0,
        said: "",
        idle: null,
        seen: this.lines.length,
      });
    }
    this.set({ agentVoices: Object.fromEntries(ids.map((id) => [id, "connecting" as const])) });
    await Promise.all(ids.map((agentId) => this.openVoice(agentId)));
  }

  private async openVoice(agentId: string) {
    const room = this.state.room;
    const voice = this.voices.get(agentId);
    const track = voice?.input.stream.getAudioTracks()[0];
    if (!room || !voice || !track) return;
    try {
      const leg = await LiveLeg.open(
        track,
        (sdp) =>
          this.o.api.liveVoice.startSession(this.o.orgId, {
            kind: "call",
            sdp,
            roomId: room.id,
            agentId,
            language: this.o.language,
          }),
        {
          event: (e) => this.voiceEvent(agentId, e),
          voice: (stream) => this.voiceOut(agentId, stream),
          closed: () => this.setVoice(agentId, "failed"),
        },
      );
      if (this.torn || !this.voices.has(agentId)) {
        void leg.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
        return;
      }
      voice.leg = leg;
      leg.hear(this.floor.holder === agentId);
      this.setVoice(agentId, "live");
      // GPT-Live may wait for a sound before its first words: the agent that opens a new call is asked to greet.
      if (this.floor.holder === agentId && this.lines.length === 0)
        setTimeout(() => {
          if (this.torn || voice.said || this.lines.length || this.floor.holder !== agentId) return;
          voice.leg?.instruct("The call is on. Greet everyone now in one short sentence and ask what we'll work on.");
        }, GREET_NUDGE_MS);
    } catch {
      this.setVoice(agentId, "failed");
    }
  }

  private setVoice(agentId: string, s: "connecting" | "live" | "failed") {
    if (this.state.agentVoices[agentId] === s) return;
    this.set({ agentVoices: { ...this.state.agentVoices, [agentId]: s } });
    // A voice that failed can't keep the word: it goes back to the people.
    if (s === "failed" && this.floor.holder === agentId && !this.torn)
      this.apply(giveFloor(this.floor, null, "manual"));
  }

  private voiceOut(agentId: string, stream: MediaStream) {
    const voice = this.voices.get(agentId);
    if (!voice || !this.ctx) return;
    voice.sink = new Audio();
    voice.sink.muted = true;
    voice.sink.srcObject = stream;
    void voice.sink.play().catch(() => {});
    // Through a gain of its own: a colleague cutting in fades it out for everyone at once.
    const gain = this.ctx.createGain();
    const out = this.ctx.createMediaStreamDestination();
    this.ctx.createMediaStreamSource(stream).connect(gain);
    gain.connect(out);
    voice.gain = gain;
    voice.out = out.stream;
    voice.outSource = gain;
    this.play(`agent:${agentId}`, out.stream);
    this.watch(`agent:${agentId}`, gain);
    // The other agents hear it; every person gets it as a track of its own.
    for (const [id, other] of this.voices) if (id !== agentId) gain.connect(other.input);
    for (const peer of this.peers.values()) this.sendVoice(peer, agentId, out.stream);
    this.sendTrackMap();
  }

  /** Cuts an agent off mid-sentence: its voice fades out, what it said so far is a line ending in "…". */
  private cutOff(agentId: string, by: string | null) {
    const voice = this.voices.get(agentId);
    const room = this.state.room;
    if (!voice || !room) return;
    voice.cut = true;
    if (voice.gain && this.ctx) voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    if (voice.idle) clearTimeout(voice.idle);
    voice.idle = null;
    const text = voice.said.trim();
    voice.said = "";
    if (!text) return;
    const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "agent", id: agentId }, text: `${text}…` };
    this.heard(line, true);
    void this.o.api.liveVoice.lines(this.o.orgId, room.id, [{ who: line.who, text: line.text }]).catch(() => {});
    voice.seen = this.lines.length;
    voice.leg?.note(
      `${by ? this.nameOf(`agent:${by}`) : "Someone"} cut in while you were saying: "${text.slice(-300)}". Stop there. When the word comes back to you, don't finish that sentence: react to what was said.`,
    );
  }

  /** The word comes (back) to an agent: heard again at full volume. */
  private unmute(agentId: string) {
    const voice = this.voices.get(agentId);
    if (!voice) return;
    voice.cut = false;
    voice.turnAt = Date.now();
    voice.said = "";
    if (voice.gain && this.ctx) voice.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.03);
  }

  /** A person is talking now (their microphone, as the tiles' glow reads it). */
  private peopleTalking() {
    for (const [who, level] of this.levels) if (who.startsWith("person:") && level > 0.12) return true;
    return false;
  }

  /** Agents the limits keep out now, or whose voice isn't on. */
  private skipped(extraTurn: number) {
    return this.roomAgents
      .map((a) => a.id)
      .filter((id) => this.state.agentVoices[id] !== "live" || !mayBringIn(this.floor, id, extraTurn));
  }

  /**
   * An agent ended a sentence: now and then the small model is asked whether a colleague cuts in (done at once, if it is
   * still talking) or speaks as soon as it finishes.
   */
  private askDuring(agentId: string) {
    const room = this.state.room;
    const voice = this.voices.get(agentId);
    const now = Date.now();
    if (!room || !voice || !this.isHost || this.agentAsking || this.pendingNext) return;
    if (this.roomAgents.length < 2 || this.floor.holder !== agentId || voice.cut) return;
    if (now - voice.turnAt < CUT_IN_AFTER_MS || now - this.lastDuringAsk < DURING_ASK_MS || voice.said.length < 40)
      return;
    const skip = this.skipped(1);
    if (this.roomAgents.every((a) => a.id === agentId || skip.includes(a.id))) return;
    this.lastDuringAsk = now;
    this.agentAsking = true;
    void this.o.api.liveVoice
      .next(this.o.orgId, room.id, { moment: "during", speaking: { agentId, text: voice.said }, skip })
      .then((pick) => {
        if (!pick.agentId || this.torn || this.floor.holder !== agentId || voice.cut) return;
        // Still talking: a colleague cuts in. Otherwise (or "after") it follows once this turn ends.
        if (pick.when === "now" && voice.said.trim() && !this.peopleTalking()) {
          const d = interrupt(this.floor, pick.agentId, Date.now());
          if (!d) return;
          this.cutOff(agentId, pick.agentId);
          this.apply(d);
        } else this.pendingNext = pick.agentId;
      })
      .catch(() => {})
      .finally(() => {
        this.agentAsking = false;
      });
  }
  private lastDuringAsk = 0;
  /** An ask about agents (`during`, `after`) is out: one at a time, apart from the people's (`judging`). */
  private agentAsking = false;
  /** The colleague the small model picked to speak once the agent talking finishes. */
  private pendingNext: string | null = null;

  /** An agent finished and nobody was picked yet: does a colleague build on it before the people answer? */
  private askAfter(agentId: string) {
    const room = this.state.room;
    if (!room || !this.isHost || this.agentAsking || this.roomAgents.length < 2) return;
    const skip = this.skipped(0);
    if (this.roomAgents.every((a) => a.id === agentId || skip.includes(a.id))) return;
    const asked = this.lines.length;
    this.agentAsking = true;
    void this.o.api.liveVoice
      .next(this.o.orgId, room.id, { moment: "after", speaking: { agentId }, skip })
      .then((pick) => {
        // Only if nothing was said since and nobody is talking: the people come first.
        if (!pick.agentId || this.torn || this.floor.holder !== agentId || this.lines.length !== asked) return;
        if (this.peopleTalking()) return;
        const d = bringIn(this.floor, pick.agentId, Date.now());
        if (d) this.apply(d);
      })
      .catch(() => {})
      .finally(() => {
        this.agentAsking = false;
      });
  }

  private voiceEvent(agentId: string, e: { type: string; delta?: string }) {
    const voice = this.voices.get(agentId);
    if (!voice) return;
    if (e.type === "session.output_transcript.delta" && e.delta) {
      // Cut off: the rest of what it was saying is heard by nobody.
      if (voice.cut) return;
      voice.said += e.delta;
      this.liveCaption(`agent:${agentId}`, voice.said);
      if (voice.idle) clearTimeout(voice.idle);
      voice.idle = setTimeout(() => this.agentPaused(agentId), AGENT_LINE_IDLE_MS);
      if (SENTENCE_END.test(voice.said)) this.askDuring(agentId);
    }
    // Where no browser writes the people down, the agent with the word hears them: its words count for the turns.
    if (
      e.type === "session.input_transcript.delta" &&
      e.delta &&
      !this.state.hearsMe &&
      this.floor.holder === agentId
    ) {
      this.unheard += e.delta;
      if (this.unheardIdle) clearTimeout(this.unheardIdle);
      this.unheardIdle = setTimeout(() => {
        const text = this.unheard.trim();
        this.unheard = "";
        if (text) this.apply(afterPerson(this.floor, text, this.floorRoom()));
      }, AGENT_LINE_IDLE_MS);
    }
  }
  private unheard = "";
  private unheardIdle: ReturnType<typeof setTimeout> | null = null;

  private agentPaused(agentId: string) {
    const voice = this.voices.get(agentId);
    const room = this.state.room;
    if (!voice || !room) return;
    const text = voice.said.trim();
    voice.said = "";
    voice.idle = null;
    if (!text || voice.cut) return;
    const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "agent", id: agentId }, text };
    this.heard(line, true);
    void this.o.api.liveVoice.lines(this.o.orgId, room.id, [{ who: line.who, text }]).catch(() => {});
    const next = this.pendingNext;
    this.pendingNext = null;
    const d = afterAgent(this.floor, agentId, text, { agents: this.roomAgents, now: Date.now() }, next);
    this.apply(d);
    if (d.reason === "continue") this.askAfter(agentId);
  }

  private floorRoom() {
    return { agents: this.roomAgents, people: this.state.room?.people.length ?? 1, now: Date.now() };
  }

  /** Puts a turn decision into effect: who hears, what the new speaker missed, and a cue to answer. */
  private apply(d: FloorDecision) {
    const before = this.floor.holder;
    // The word leaves an agent mid-sentence (a person named another one): it is cut off.
    if (before && before !== d.state.holder && this.voices.get(before)?.said.trim())
      this.cutOff(before, d.state.holder);
    this.floor = d.state;
    const holder = d.state.holder;
    if (holder !== before) this.pendingNext = null;
    for (const [id, voice] of this.voices) voice.leg?.hear(id === holder);
    if (holder && holder !== before) this.unmute(holder);
    if (holder && d.changed) {
      const voice = this.voices.get(holder);
      if (voice?.leg) {
        const missed = this.lines.slice(voice.seen);
        voice.seen = this.lines.length;
        if (missed.length) voice.leg.note(`What was said on the call while you listened:\n${this.format(missed)}`);
        const last = this.lines.at(-1);
        if (last && last.who.id !== holder && d.reason !== "continue" && d.reason !== "solo") {
          const who = this.nameOf(whoOf(last));
          const said = last.text.slice(-600);
          voice.leg.instruct(
            d.reason === "interrupt"
              ? `${who} is talking and just said: "${said}". Cut in now, the way a colleague does in a lively meeting (a short "let me jump in here" in the call's language), make your point in one or two sentences, then stop.`
              : last.who.type === "agent" && (d.reason === "handoff" || d.reason === "judge")
                ? `It is your turn now. ${who} just said: "${said}". Build on it, push back, or add what your role sees, in one or two sentences, then stop. Don't just agree.`
                : `It is your turn now. ${who} just said: "${said}". Answer now, briefly, then stop.`,
          );
        }
      }
    }
    if (holder !== before || d.changed) {
      this.set({ holder });
      const room = this.state.room;
      if (room) void this.o.api.liveVoice.floor(this.o.orgId, room.id, holder, d.reason).catch(() => {});
    }
    if (d.ask) this.askJudge();
  }

  /**
   * A person spoke to nobody by name: the workspace's small model says which agent answers. With one person on the call
   * someone always does (the server's pick, else the agent that spoke last, else the first); with several, it may say
   * nobody, and they go on among themselves.
   */
  private askJudge() {
    const room = this.state.room;
    if (!room || this.judging || !this.isHost) return;
    this.judging = true;
    const solo = room.people.length <= 1;
    const asked = this.lines.length;
    setTimeout(
      async () => {
        let agentId: string | null = null;
        try {
          agentId = (await this.o.api.liveVoice.next(this.o.orgId, room.id)).agentId;
        } catch {}
        this.judging = false;
        if (this.torn || this.floor.holder !== null) return;
        const live = (id: string) => this.state.agentVoices[id] === "live";
        if (solo && (!agentId || !live(agentId))) agentId = this.fallbackSpeaker(live);
        // With several people, only if nothing was said since.
        if (agentId && (solo || this.lines.length === asked)) this.apply(giveFloor(this.floor, agentId, "judge"));
      },
      solo ? JUDGE_WAIT_SOLO_MS : JUDGE_WAIT_MS,
    );
  }

  /** Who answers when the judge can't say: the agent that spoke last, else the first one whose voice is on. */
  private fallbackSpeaker(live: (id: string) => boolean): string | null {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      if (line?.who.type === "agent" && live(line.who.id)) return line.who.id;
    }
    return this.roomAgents.find((a) => live(a.id))?.id ?? null;
  }

  private async closeVoices() {
    const voices = [...this.voices.entries()];
    this.voices.clear();
    for (const peer of this.peers.values()) {
      for (const sender of peer.agentSenders.values()) {
        try {
          peer.pc.removeTrack(sender);
        } catch {}
      }
      peer.agentSenders.clear();
    }
    await Promise.all(
      voices.map(async ([agentId, v]) => {
        if (v.idle) clearTimeout(v.idle);
        v.outSource?.disconnect();
        v.sink?.pause();
        this.drop(`agent:${agentId}`);
        await v.leg?.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
      }),
    );
    this.set({ agentVoices: {} });
  }

  // ── What was said ──
  private startHearingMe() {
    const Recognition = speechRecognition();
    if (!Recognition || this.torn || !this.state.micOn) return;
    if (!this.speech) {
      const rec = new Recognition();
      rec.lang = this.o.language;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r) continue;
          const text = r[0].transcript.trim();
          if (r.isFinal && text) this.iSaid(text);
          else interim += ` ${text}`;
        }
        if (interim.trim()) this.liveCaption(`person:${this.o.me}`, interim.trim());
      };
      // Chrome ends it now and then: on again while the microphone is.
      rec.onend = () => {
        if (!this.torn && this.state.micOn) setTimeout(() => this.speechStart(), 300);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") this.set({ hearsMe: false });
      };
      this.speech = rec;
    }
    this.speechStart();
    this.set({ hearsMe: true });
  }
  private speechStart() {
    try {
      this.speech?.start();
    } catch {
      // Already on.
    }
  }

  private iSaid(text: string) {
    const room = this.state.room;
    if (!room) return;
    const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "person", id: this.o.me }, text };
    this.heard(line, true);
    void this.o.api.liveVoice.lines(this.o.orgId, room.id, [{ who: line.who, text }]).catch(() => {});
  }

  /** A whole line said on the call: kept for the turns and the captions; the host decides who speaks next. */
  private heard(line: LiveRoomLine, mine: boolean) {
    this.lines.push(line);
    const who = whoOf(line);
    const captions = this.state.captions.filter((c) => !(c.live && c.who === who));
    this.set({
      captions: [...captions, { who, text: line.text, at: Date.now(), n: ++this.said }].slice(-MAX_CAPTIONS),
    });
    if (this.isHost && line.who.type === "person") this.apply(afterPerson(this.floor, line.text, this.floorRoom()));
    void mine;
  }

  private liveCaption(who: Who, text: string) {
    const captions = this.state.captions.filter((c) => !(c.live && c.who === who));
    this.set({
      captions: [...captions, { who, text, at: Date.now(), live: true, n: ++this.said }].slice(-MAX_CAPTIONS),
    });
  }
  /** Numbers the captions, for their keys. */
  private said = 0;

  private nameOf(who: Who) {
    const [type, id] = who.split(":") as ["person" | "agent", string];
    if (type === "agent") return this.o.agents.find((a) => a.id === id)?.name ?? "A colleague";
    return this.personName?.(id) ?? "Someone";
  }
  /** Set by the view: people's names from the directory. */
  personName: ((userId: string) => string | undefined) | null = null;

  private format(lines: LiveRoomLine[]) {
    return lines.map((l) => `${this.nameOf(whoOf(l))}: ${l.text}`).join("\n");
  }

  // ── Sound ──
  private play(who: Who, stream: MediaStream) {
    let el = this.audioEls.get(who);
    if (!el) {
      el = new Audio();
      el.autoplay = true;
      this.audioEls.set(who, el);
    }
    el.srcObject = stream;
    void el.play().catch(() => {});
  }

  private watch(who: Who, source: AudioNode) {
    if (!this.ctx) return;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    this.analysers.set(who, analyser);
  }

  private drop(who: Who) {
    this.analysers.get(who)?.disconnect();
    this.analysers.delete(who);
    this.levels.delete(who);
    const el = this.audioEls.get(who);
    if (el) {
      el.pause();
      el.srcObject = null;
      this.audioEls.delete(who);
    }
  }

  private loop() {
    const buf = new Float32Array(512);
    const tick = () => {
      if (this.torn) return;
      for (const [who, analyser] of this.analysers) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.min(1, rms * 9);
        const was = this.levels.get(who) ?? 0;
        // Up at once, down slowly: the glow doesn't flicker between words.
        this.levels.set(who, level > was ? level : was * 0.88);
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private teardown() {
    if (this.torn) return;
    this.torn = true;
    cancelAnimationFrame(this.frame);
    for (const t of this.timers) clearInterval(t);
    this.off?.();
    this.speech?.abort();
    void this.closeVoices();
    for (const userId of [...this.peers.keys()]) this.closePeer(userId);
    for (const who of [...this.audioEls.keys()]) this.drop(who as Who);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    void this.ctx?.close().catch(() => {});
  }
}

type Signal =
  | { kind: "desc"; description?: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate?: RTCIceCandidateInit }
  | { kind: "tracks"; map?: Record<string, string> };

export const whoOf = (line: Pick<LiveRoomLine, "who">): Who => `${line.who.type}:${line.who.id}`;
