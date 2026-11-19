import type { ApiClient, LiveRoom, LiveRoomLine, RealtimeConnection } from "@agenteschat/client";
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
} from "@agenteschat/client/lib/live-floor";
import { openVoiceLeg, type VoiceLeg } from "./leg";

/**
 * A voice room in this browser (ADR doug-0006). People reach each other directly (a WebRTC connection between each pair,
 * signalled through the server). The host's browser also runs one GPT-Live session per agent: each hears the people's
 * microphones and the other agents, and its voice is sent on to every person as a track of its own, so every app can
 * light the tile of whoever speaks. Who has the word is code (`live-floor`), applied by the host: the agent with it
 * hears the call, the others get what they missed as notes when it comes to them. One voice at a time, kept by the
 * audio itself: every agent hears through a gain of its own and is heard through another, open only while it has the
 * word, so an agent without it hears nothing and is heard by nobody, whatever GPT-Live does. After an agent speaks the
 * small model may bring in one colleague, within tight limits. Work asked for during the call runs for real: an agent
 * that delegates ("já vejo") gets it done in the conversation (`ask`), and tells the answer at the next pause. The first agent leads
 * the meeting (the team's right hand, put first by the server): it has the word whenever nobody else does, so somebody
 * always hears the people. What the people say comes from the GPT-Live session with the word (its transcript of what it
 * hears), not from the browser's speech recognition, which fails quietly in some browsers and the desktop app: a name
 * said mid-sentence passes the word at once.
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
  /** Agents working on something asked during the call (everyone on the call sees it). */
  working: Record<string, boolean>;
  captions: Caption[];
}

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
const PING_MS = 20_000;
const AGENT_LINE_IDLE_MS = 1300;
const JUDGE_WAIT_MS = 900;
/** An answer to work asked on the call waits for a pause this long before it is told. */
const ANSWER_PAUSE_MS = 1500;
/** Past this an answer is told at the next breath, pause or not. */
const ANSWER_WAIT_MS = 30_000;
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
  leg: VoiceLeg | null;
  input: MediaStreamAudioDestinationNode;
  /** What it hears goes through here: open only while it has the word. */
  inGain: GainNode;
  /** Its voice as everyone hears it: after its gain, so it can be cut off. */
  out: MediaStream | null;
  outSource: AudioNode | null;
  gain: GainNode | null;
  /** Keeps OpenAI's track flowing into Web Audio (Chrome plays a remote track only while an element holds it). */
  sink: HTMLAudioElement | null;
  /** Cut off (the word left it mid-sentence): what it goes on saying is dropped until the word comes back to it. */
  cut: boolean;
  /** What it is saying now, until it pauses. */
  said: string;
  idle: ReturnType<typeof setTimeout> | null;
  /** How many lines it had when it last got the call's notes. */
  seen: number;
}

export class RoomCall {
  private state: RoomCallState = {
    phase: "joining",
    error: null,
    room: null,
    micOn: true,
    holder: null,
    agentVoices: {},
    working: {},
    captions: [],
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
  /** The agent leading the meeting: first in the room (the server puts the team's right hand there). */
  private get moderator(): string | null {
    return this.state.room?.agentIds[0] ?? null;
  }
  private get roomAgents(): FloorAgent[] {
    const ids = this.state.room?.agentIds ?? [];
    return ids.flatMap((id) => this.o.agents.filter((a) => a.id === id));
  }

  // ── Start, join, leave ──
  async start(agentIds: string[], options: { topic?: string | null; invite?: string[] } = {}) {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx = new AudioContext();
      this.micSource = this.ctx.createMediaStreamSource(this.mic);
      this.watch(`person:${this.o.me}`, this.micSource);
      this.off =
        this.o.connection?.onUserEvent((e) => this.onEvent(e as { type: string; [key: string]: unknown })) ?? null;
      const { invite, ...join } = options;
      const room = await this.o.api.liveVoice.joinRoom(this.o.orgId, this.o.channelId, agentIds, {
        ...join,
        language: this.o.language,
      });
      if (invite?.length)
        void this.o.api.liveVoice.invite(this.o.orgId, room.id, invite, this.o.language).catch(() => {});
      this.lines = [...room.lines];
      this.set({
        phase: "live",
        room,
        captions: room.lines.map((l) => ({ who: whoOf(l), text: l.text, at: Date.parse(l.at), n: ++this.said })),
      });
      this.timers.push(setInterval(() => void this.ping(), PING_MS));
      this.timers.push(setInterval(() => this.deliverAnswers(), 700));
      this.loop();
      await this.applyRoom(room);
    } catch (error) {
      this.set({ phase: "failed", error });
      this.teardown();
    }
  }

  /** Calls people in: they are mentioned in the conversation (a notification on their devices) and their apps ring. */
  async invite(userIds: string[]) {
    const room = this.state.room;
    if (!room || !userIds.length) return { invited: [], refused: [] };
    return this.o.api.liveVoice.invite(this.o.orgId, room.id, userIds, this.o.language);
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
    if (e.type === "live.lines") for (const line of e.lines as LiveRoomLine[]) this.heard(line);
    if (e.type === "live.working") this.set({ working: { ...this.state.working, [String(e.agentId)]: Boolean(e.on) } });
    if (e.type === "live.answer" && this.isHost) {
      this.answers.push({
        agentId: String(e.agentId),
        delegationId: String(e.delegationId),
        text: typeof e.text === "string" ? e.text : null,
        at: Date.now(),
      });
      this.deliverAnswers();
    }
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
    for (const voice of this.voices.values()) source.connect(voice.inGain);
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
    // The lead has the word from the start (it greets a new call), so somebody always hears the people.
    this.floor = initialFloor(ids[0] ?? null, Date.now());
    this.set({ holder: this.floor.holder });
    for (const agentId of ids) {
      const input = this.ctx.createMediaStreamDestination();
      const inGain = this.ctx.createGain();
      inGain.gain.value = this.floor.holder === agentId ? 1 : 0;
      inGain.connect(input);
      this.micSource.connect(inGain);
      for (const source of this.personSources.values()) source.connect(inGain);
      for (const other of this.voices.values()) other.outSource?.connect(inGain);
      this.voices.set(agentId, {
        leg: null,
        input,
        inGain,
        out: null,
        outSource: null,
        gain: null,
        sink: null,
        cut: false,
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
      const leg = await openVoiceLeg(
        track,
        (extra) =>
          this.o.api.liveVoice.startVoice(this.o.orgId, {
            ...extra,
            kind: "call",
            roomId: room.id,
            agentId,
            language: this.o.language,
          }),
        {
          event: (e) => this.voiceEvent(agentId, e),
          voice: (stream) => this.voiceOut(agentId, stream),
          closed: () => this.setVoice(agentId, "failed"),
          delegation: (id) => this.delegated(agentId, id),
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
    if (s === "failed" && this.floor.holder === agentId && !this.torn) {
      const lead = this.moderator !== agentId && this.state.agentVoices[this.moderator ?? ""] === "live";
      this.apply(giveFloor(this.floor, lead ? this.moderator : null, "manual"), false);
    }
  }

  private voiceOut(agentId: string, stream: MediaStream) {
    const voice = this.voices.get(agentId);
    if (!voice || !this.ctx) return;
    voice.sink = new Audio();
    voice.sink.muted = true;
    voice.sink.srcObject = stream;
    void voice.sink.play().catch(() => {});
    // Through a gain of its own, open only while it has the word: one voice at a time, for everyone.
    const gain = this.ctx.createGain();
    gain.gain.value = this.floor.holder === agentId ? 1 : 0;
    const out = this.ctx.createMediaStreamDestination();
    this.ctx.createMediaStreamSource(stream).connect(gain);
    gain.connect(out);
    voice.gain = gain;
    voice.out = out.stream;
    voice.outSource = gain;
    this.play(`agent:${agentId}`, out.stream);
    this.watch(`agent:${agentId}`, gain);
    // The other agents hear it; every person gets it as a track of its own.
    for (const [id, other] of this.voices) if (id !== agentId) gain.connect(other.inGain);
    for (const peer of this.peers.values()) this.sendVoice(peer, agentId, out.stream);
    this.sendTrackMap();
  }

  /** Cuts an agent off mid-sentence: its voice fades out, what it said so far is a line ending in "…". */
  private cutOff(agentId: string, by: string | null) {
    const voice = this.voices.get(agentId);
    const room = this.state.room;
    if (!voice || !room) return;
    voice.cut = true;
    if (voice.idle) clearTimeout(voice.idle);
    voice.idle = null;
    const text = voice.said.trim();
    voice.said = "";
    if (!text) return;
    const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "agent", id: agentId }, text: `${text}…` };
    this.heard(line);
    void this.o.api.liveVoice.lines(this.o.orgId, room.id, [{ who: line.who, text: line.text }]).catch(() => {});
    voice.seen = this.lines.length;
    voice.leg?.note(
      `${by ? `The word went to ${this.nameOf(`agent:${by}`)}` : "The word went to the people"} while you were saying: "${text.slice(-300)}". Stop there. When the word comes back to you, don't finish that sentence: react to what was said.`,
    );
  }

  /** The word comes (back) to an agent: what it says from now on counts. */
  private unmute(agentId: string) {
    const voice = this.voices.get(agentId);
    if (!voice) return;
    voice.cut = false;
    voice.said = "";
  }

  /** Opens the agent with the word (hears, is heard) and closes every other one, fading so nothing clicks. */
  private gate() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    for (const [id, voice] of this.voices) {
      const on = id === this.floor.holder ? 1 : 0;
      voice.inGain.gain.setTargetAtTime(on, at, 0.02);
      voice.gain?.gain.setTargetAtTime(on, at, on ? 0.03 : 0.06);
    }
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

  /** An ask about agents (`after`) is out: one at a time, apart from the people's (`judging`). */
  private agentAsking = false;

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
      // Without the word (or cut off) nobody hears it: what it says doesn't count.
      if (voice.cut || this.floor.holder !== agentId) return;
      voice.said += e.delta;
      this.lastSoundAt = Date.now();
      this.liveCaption(`agent:${agentId}`, voice.said);
      if (voice.idle) clearTimeout(voice.idle);
      voice.idle = setTimeout(() => this.agentPaused(agentId), AGENT_LINE_IDLE_MS);
    }
    if (e.type === "session.input_transcript.delta" && e.delta && this.floor.holder === agentId)
      this.peopleSaid(e.delta);
  }

  /**
   * What the people say, as the agent with the word hears it: a caption as it comes, the word passed at once when an agent
   * is named, and a line once they pause (who said it: the loudest microphone meanwhile).
   */
  private peopleSaid(delta: string) {
    this.personText += delta;
    this.lastSoundAt = Date.now();
    const who = this.loudestPerson();
    this.liveCaption(`person:${who}`, this.personText.trim());
    // Once per sentence: passing the word back and forth on every name said would be worse than none.
    const named = this.switchedTo ? null : namedAgent(this.personText, this.roomAgents, this.floor.holder);
    if (named && this.state.agentVoices[named] === "live") {
      this.apply(addressed(this.floor, named, Date.now()), false);
      this.switchedTo = named;
      // It hears the rest; what came before its name reaches it as a note.
      this.voices
        .get(named)
        ?.leg?.note(
          `${this.nameOf(`person:${who}`)} is talking to you and said so far: "${this.personText.trim().slice(-600)}"`,
        );
    }
    if (this.personIdle) clearTimeout(this.personIdle);
    this.personIdle = setTimeout(() => this.personPaused(), AGENT_LINE_IDLE_MS);
  }
  private personText = "";
  private personIdle: ReturnType<typeof setTimeout> | null = null;
  /** The agent the word went to mid-sentence: it heard the rest, so it gets a cue only if it stays quiet. */
  private switchedTo: string | null = null;
  /** How long each person was loud while the current words came (for whose they are). */
  private talk = new Map<string, number>();

  private loudestPerson() {
    let best = this.o.me;
    let most = -1;
    for (const [userId, t] of this.talk)
      if (t > most) {
        best = userId;
        most = t;
      }
    return best;
  }

  private personPaused() {
    const room = this.state.room;
    const text = this.personText.trim();
    const who = this.loudestPerson();
    this.personText = "";
    this.personIdle = null;
    this.talk.clear();
    const switched = this.switchedTo;
    this.switchedTo = null;
    // Its live caption may have shown under another person while the words came.
    this.set({ captions: this.state.captions.filter((c) => !(c.live && c.who.startsWith("person:"))) });
    if (!room || !text) return;
    const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "person", id: who }, text };
    this.heard(line);
    void this.o.api.liveVoice.lines(this.o.orgId, room.id, [{ who: line.who, text }]).catch(() => {});
    const d = afterPerson(this.floor, text, this.floorRoom());
    if (switched && d.state.holder === switched) {
      this.floor = d.state;
      // It took the word mid-sentence and heard the rest; if the name came last it may still be waiting.
      const voice = this.voices.get(switched);
      if (voice && !voice.said.trim())
        voice.leg?.instruct(
          `${this.nameOf(`person:${who}`)} just said to you: "${text.slice(-600)}". Answer now, briefly, then stop.`,
        );
      return;
    }
    this.apply(d);
  }

  private agentPaused(agentId: string) {
    const voice = this.voices.get(agentId);
    const room = this.state.room;
    if (!voice || !room) return;
    const text = voice.said.trim();
    voice.said = "";
    voice.idle = null;
    if (!text || voice.cut) return;
    const line: LiveRoomLine = { at: new Date().toISOString(), who: { type: "agent", id: agentId }, text };
    this.heard(line);
    void this.o.api.liveVoice.lines(this.o.orgId, room.id, [{ who: line.who, text }]).catch(() => {});
    const d = afterAgent(this.floor, agentId, text, {
      agents: this.roomAgents,
      now: Date.now(),
      moderator: this.moderator,
    });
    this.apply(d);
    if (d.reason === "continue") this.askAfter(agentId);
  }

  /**
   * The agent delegated ("já vejo"): what was being asked goes to the conversation for it to work on with its tools
   * while the call goes on. The ask is the call's latest lines, the person's last words first.
   */
  private delegated(agentId: string, delegationId: string) {
    const room = this.state.room;
    if (!room) return;
    // Its last words and the person's arrive just after the delegation: wait for them.
    setTimeout(() => {
      const recent = this.lines.slice(-6);
      const lastPerson = [...recent].reverse().find((l) => l.who.type === "person")?.text ?? "";
      const now = this.personText.trim();
      const ask = [
        now || lastPerson,
        `(Pedido feito na chamada de voz. O que se disse por último:\n${this.format(recent)}${now ? `\n${this.nameOf(`person:${this.loudestPerson()}`)}: ${now}` : ""})`,
      ]
        .filter(Boolean)
        .join("\n\n");
      this.o.api.liveVoice.ask(this.o.orgId, room.id, { agentId, ask, delegationId }).catch(() => {
        this.voices
          .get(agentId)
          ?.leg?.answer(
            delegationId,
            "That couldn't be started right now. Say so briefly, and that it can be asked in the chat.",
          );
      });
    }, 700);
  }

  /** Answers to work asked on the call, waiting for a pause to be told. */
  private answers: { agentId: string; delegationId: string; text: string | null; at: number }[] = [];
  /** The last time anyone said something (an agent's words or a person's). */
  private lastSoundAt = 0;

  /**
   * Tells an answer when the call has a pause (nobody talking, no words for a moment), or after a while at the next
   * breath: the agent gets the word, no cue, and says it in its own words.
   */
  private deliverAnswers() {
    const next = this.answers[0];
    if (!next || !this.isHost) return;
    const voice = this.voices.get(next.agentId);
    if (!voice?.leg || this.state.agentVoices[next.agentId] !== "live") {
      this.answers.shift();
      return;
    }
    const holder = this.floor.holder ? this.voices.get(this.floor.holder) : null;
    const busy = Boolean(holder?.said.trim()) || Boolean(this.personText) || this.peopleTalking();
    const waited = Date.now() - next.at;
    if (busy || (Date.now() - this.lastSoundAt < ANSWER_PAUSE_MS && waited < ANSWER_WAIT_MS)) return;
    this.answers.shift();
    if (this.floor.holder !== next.agentId) this.apply(giveFloor(this.floor, next.agentId, "judge"), false);
    voice.leg.answer(
      next.delegationId,
      next.text ??
        "It's taking longer than the call: say briefly that the answer will be in the conversation as soon as it's done.",
    );
  }

  private floorRoom() {
    return {
      agents: this.roomAgents,
      people: this.state.room?.people.length ?? 1,
      now: Date.now(),
      moderator: this.moderator,
    };
  }

  /**
   * Puts a turn decision into effect: who hears, what the new speaker missed, and a cue to answer (`cue: false` when it
   * hears what comes next anyway). The lead taking the word back to listen (`limit`, `people`) gets no cue.
   */
  private apply(d: FloorDecision, cue = true) {
    const before = this.floor.holder;
    // The word leaves an agent mid-sentence (a person named another one): it is cut off.
    if (before && before !== d.state.holder && this.voices.get(before)?.said.trim())
      this.cutOff(before, d.state.holder);
    this.floor = d.state;
    const holder = d.state.holder;
    for (const [id, voice] of this.voices) voice.leg?.hear(id === holder);
    if (holder && holder !== before) this.unmute(holder);
    this.gate();
    if (holder && d.changed) {
      const voice = this.voices.get(holder);
      if (voice?.leg) {
        const missed = this.lines.slice(voice.seen);
        voice.seen = this.lines.length;
        if (missed.length) voice.leg.note(`What was said on the call while you listened:\n${this.format(missed)}`);
        const last = this.lines.at(-1);
        const quiet = ["continue", "solo", "limit", "people"].includes(d.reason);
        if (cue && last && last.who.id !== holder && !quiet) {
          const who = this.nameOf(whoOf(last));
          const said = last.text.slice(-600);
          voice.leg.instruct(
            last.who.type === "agent" && (d.reason === "handoff" || d.reason === "judge")
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
        if (this.torn || (this.floor.holder !== null && this.floor.holder !== this.moderator)) return;
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
  /** A whole line said on the call: kept for the notes and the captions. */
  private heard(line: LiveRoomLine) {
    this.lines.push(line);
    const who = whoOf(line);
    const captions = this.state.captions.filter((c) => !(c.live && c.who === who));
    this.set({
      captions: [...captions, { who, text: line.text, at: Date.now(), n: ++this.said }].slice(-MAX_CAPTIONS),
    });
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
        if (this.personText && level > 0.12 && who.startsWith("person:")) {
          const userId = who.slice("person:".length);
          this.talk.set(userId, (this.talk.get(userId) ?? 0) + level);
        }
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
