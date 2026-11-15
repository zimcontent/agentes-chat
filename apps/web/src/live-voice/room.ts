import type { ApiClient, LiveRoom, LiveRoomLine, RealtimeConnection } from "@agenteschat/client";
import {
  afterAgent,
  afterPerson,
  type FloorAgent,
  type FloorDecision,
  type FloorState,
  giveFloor,
  initialFloor,
} from "@agenteschat/client/lib/live-floor";
import { LiveLeg } from "./leg";

/**
 * A voice room in this browser (ADR doug-0006). People reach each other directly (a WebRTC connection between each pair,
 * signalled through the server). The host's browser also runs one GPT-Live session per agent: each hears the people's
 * microphones and the other agents, and its voice is sent on to every person as a track of its own, so every app can
 * light the tile of whoever speaks. Who has the word is code (`live-floor`), applied by the host: the agent with it
 * hears the call, the others are muted and get what they missed as notes when it comes to them.
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
  out: MediaStream | null;
  outSource: MediaStreamAudioSourceNode | null;
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
    this.floor = initialFloor(room.lines.length === 0 ? (ids[0] ?? null) : null);
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
    voice.out = stream;
    this.play(`agent:${agentId}`, stream);
    voice.outSource = this.ctx.createMediaStreamSource(stream);
    this.watch(`agent:${agentId}`, voice.outSource);
    // The other agents hear it; every person gets it as a track of its own.
    for (const [id, other] of this.voices) if (id !== agentId) voice.outSource.connect(other.input);
    for (const peer of this.peers.values()) this.sendVoice(peer, agentId, stream);
    this.sendTrackMap();
  }

  private voiceEvent(agentId: string, e: { type: string; delta?: string }) {
    const voice = this.voices.get(agentId);
    if (!voice) return;
    if (e.type === "session.output_transcript.delta" && e.delta) {
      voice.said += e.delta;
      this.liveCaption(`agent:${agentId}`, voice.said);
      if (voice.idle) clearTimeout(voice.idle);
      voice.idle = setTimeout(() => this.agentPaused(agentId), AGENT_LINE_IDLE_MS);
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
    if (!text) return;
    const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "agent", id: agentId }, text };
    this.heard(line, true);
    void this.o.api.liveVoice.lines(this.o.orgId, room.id, [{ who: line.who, text }]).catch(() => {});
    this.apply(afterAgent(this.floor, agentId, text, { agents: this.roomAgents, now: Date.now() }));
  }

  private floorRoom() {
    return { agents: this.roomAgents, people: this.state.room?.people.length ?? 1, now: Date.now() };
  }

  /** Puts a turn decision into effect: who hears, what the new speaker missed, and a cue to answer. */
  private apply(d: FloorDecision) {
    const before = this.floor.holder;
    this.floor = d.state;
    const holder = d.state.holder;
    for (const [id, voice] of this.voices) voice.leg?.hear(id === holder);
    if (holder && d.changed) {
      const voice = this.voices.get(holder);
      if (voice?.leg) {
        const missed = this.lines.slice(voice.seen);
        voice.seen = this.lines.length;
        if (missed.length) voice.leg.note(`What was said on the call while you listened:\n${this.format(missed)}`);
        const last = this.lines.at(-1);
        if (last && last.who.id !== holder && d.reason !== "continue" && d.reason !== "solo")
          voice.leg.instruct(
            `It is your turn now. ${this.nameOf(whoOf(last))} just said: "${last.text.slice(-600)}". Answer now, briefly, then stop.`,
          );
      }
    }
    if (holder !== before || d.changed) {
      this.set({ holder });
      const room = this.state.room;
      if (room) void this.o.api.liveVoice.floor(this.o.orgId, room.id, holder, d.reason).catch(() => {});
    }
    if (d.ask) this.askJudge();
  }

  /** A person spoke to nobody by name in a meeting: the workspace's small model says whether an agent should answer. */
  private askJudge() {
    const room = this.state.room;
    if (!room || this.judging || !this.isHost) return;
    this.judging = true;
    const asked = this.lines.length;
    setTimeout(async () => {
      try {
        const { agentId } = await this.o.api.liveVoice.next(this.o.orgId, room.id);
        // Only if nothing was said since and nobody took the word meanwhile.
        if (agentId && this.lines.length === asked && this.floor.holder === null)
          this.apply(giveFloor(this.floor, agentId, "judge"));
      } catch {
      } finally {
        this.judging = false;
      }
    }, JUDGE_WAIT_MS);
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
