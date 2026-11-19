import type { ApiClient, LiveRoom, LiveRoomLine, RealtimeConnection } from "@dougbot/client";
import type { FloorAgent } from "@dougbot/client/lib/live-floor";
import { LiveHost, type Who, whoOf } from "@dougbot/client/lib/live-host";
import { type MediaStream, type MediaStreamTrack, mediaDevices, RTCPeerConnection } from "react-native-webrtc";
import { callActive } from "./active";
import { PhoneLeg } from "./leg";
import { levelsFromStats, TALKING_LEVEL } from "./logic";
import { type CallRoute, setCallRoute, startCallAudio, stopCallAudio } from "./route";

/**
 * A voice room on the phone (docs/adr/doug-0006-live-voice.md, the phone app): the same rooms as the web. People reach
 * each other directly (a WebRTC connection between each pair, signalled through the server, perfect negotiation). The
 * agents' voices come from whoever hosts: someone on the web or the desktop app when one is in (the server prefers
 * them, since a phone can't pass the agents' audio on), as tracks of their own. With nobody else on a computer, this
 * phone runs the agents itself: one GPT-Live session per agent with the microphone, the one with the word hearing and
 * heard (the others muted), turns by the shared rules (`LiveHost`).
 */

export interface Caption {
  who: Who;
  text: string;
  at: number;
  live?: boolean;
  n: number;
}

export interface PhoneRoomState {
  phase: "joining" | "live" | "ended" | "failed";
  error: unknown;
  room: LiveRoom | null;
  micOn: boolean;
  route: CallRoute;
  holder: string | null;
  agentVoices: Record<string, "connecting" | "live" | "failed">;
  working: Record<string, boolean>;
  captions: Caption[];
  /** How loud each one is now, 0 to 1. */
  levels: Partial<Record<Who, number>>;
  startedAt: number;
}

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
const PING_MS = 20_000;
const LEVELS_MS = 300;
const MAX_CAPTIONS = 40;

type Signal =
  | { kind: "desc"; description?: { type: string; sdp?: string | null } }
  | { kind: "ice"; candidate?: Record<string, unknown> }
  | { kind: "tracks"; map?: Record<string, string> };

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  unknown: Map<string, MediaStream>;
}

export class PhoneRoom {
  private state: PhoneRoomState = {
    phase: "joining",
    error: null,
    room: null,
    micOn: true,
    route: "earpiece",
    holder: null,
    agentVoices: {},
    working: {},
    captions: [],
    levels: {},
    startedAt: Date.now(),
  };
  private listeners = new Set<() => void>();
  private mic: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private agentStreams = new Map<string, string>();
  /** Remote audio tracks by id: whose voice each one is. */
  private tracks = new Map<string, Who>();
  private legs = new Map<string, PhoneLeg>();
  private host: LiveHost | null = null;
  private hosting = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private off: (() => void) | null = null;
  private torn = false;
  private said = 0;

  constructor(
    private readonly o: {
      api: ApiClient;
      orgId: string;
      channelId: string;
      me: string;
      agents: FloorAgent[];
      connection: RealtimeConnection | null;
      language: string;
      personName: (userId: string) => string | undefined;
    },
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<PhoneRoomState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  get channelId() {
    return this.o.channelId;
  }
  get isHost() {
    return this.state.room?.hostUserId === this.o.me;
  }
  private roomAgents(): FloorAgent[] {
    const ids = this.state.room?.agentIds ?? [];
    return ids.flatMap((id) => this.o.agents.filter((a) => a.id === id));
  }

  // ── Start, join, leave ──
  async start(agentIds: string[], options: { topic?: string | null; invite?: string[] } = {}) {
    try {
      this.mic = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
      callActive.set(true);
      startCallAudio(this.state.route);
      this.off =
        this.o.connection?.onUserEvent((e) => this.onEvent(e as { type: string; [key: string]: unknown })) ?? null;
      const room = await this.o.api.liveVoice.joinRoom(this.o.orgId, this.o.channelId, agentIds, {
        topic: options.topic ?? null,
        language: this.o.language,
        phone: true,
      });
      if (options.invite?.length)
        void this.o.api.liveVoice.invite(this.o.orgId, room.id, options.invite, this.o.language).catch(() => {});
      this.set({
        phase: "live",
        room,
        startedAt: Date.parse(room.startedAt) || Date.now(),
        captions: room.lines.map((l) => ({ who: whoOf(l), text: l.text, at: Date.parse(l.at), n: ++this.said })),
      });
      this.timers.push(setInterval(() => void this.ping(), PING_MS));
      this.timers.push(setInterval(() => this.host?.deliverAnswers(), 700));
      this.timers.push(setInterval(() => void this.readLevels(), LEVELS_MS));
      await this.applyRoom(room);
    } catch (error) {
      this.set({ phase: "failed", error });
      this.teardown();
    }
  }

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

  /** Ends the call for everyone: its notes go to the conversation. */
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

  /** "Modo telefone" (the earpiece) or "viva voz" (the loudspeaker). */
  setRoute(route: CallRoute) {
    setCallRoute(route);
    this.set({ route });
  }

  /** "Dar a palavra": to an agent, or back to the people (null). The host applies it. */
  give(holder: string | null) {
    const room = this.state.room;
    if (!room) return;
    if (this.isHost && this.host) this.host.give(holder);
    else void this.o.api.liveVoice.floor(this.o.orgId, room.id, holder, "manual").catch(() => {});
  }

  private async ping() {
    const room = this.state.room;
    if (!room || this.torn) return;
    try {
      await this.applyRoom(await this.o.api.liveVoice.ping(this.o.orgId, room.id));
    } catch {
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
    if (e.type === "live.lines")
      for (const line of e.lines as LiveRoomLine[]) {
        this.host?.heard(line);
        this.line(line);
      }
    if (e.type === "live.working") this.set({ working: { ...this.state.working, [String(e.agentId)]: Boolean(e.on) } });
    if (e.type === "live.answer" && this.isHost)
      this.host?.answerArrived({
        agentId: String(e.agentId),
        delegationId: String(e.delegationId),
        text: typeof e.text === "string" ? e.text : null,
      });
    if (e.type === "live.floor") {
      const holder = (e.holder as string | null) ?? null;
      if (this.isHost && e.by !== this.o.me) this.host?.give(holder);
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
    if (this.isHost && !this.hosting) {
      this.hosting = true;
      await this.startVoices();
    } else if (!this.isHost && this.hosting) {
      this.hosting = false;
      await this.closeVoices();
    }
  }

  // ── People: one connection per pair (perfect negotiation) ──
  private signal(to: string, data: Signal) {
    const room = this.state.room;
    if (room) void this.o.api.liveVoice.signal(this.o.orgId, room.id, to, data).catch(() => {});
  }

  private openPeer(userId: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer: Peer = { pc, polite: this.o.me < userId, makingOffer: false, ignoreOffer: false, unknown: new Map() };
    this.peers.set(userId, peer);
    pc.addEventListener("negotiationneeded", async () => {
      try {
        peer.makingOffer = true;
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        const desc = pc.localDescription;
        if (desc) this.signal(userId, { kind: "desc", description: { type: String(desc.type), sdp: desc.sdp } });
      } catch {
      } finally {
        peer.makingOffer = false;
      }
    });
    pc.addEventListener("icecandidate", (e) => {
      const c = e.candidate;
      if (c)
        this.signal(userId, {
          kind: "ice",
          candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex },
        });
    });
    pc.addEventListener("track", (e) => {
      const stream = e.streams[0];
      const track = e.track;
      if (!stream || !track || track.kind !== "audio") return;
      const agentId = this.agentStreams.get(stream.id);
      if (agentId) this.tracks.set(track.id, `agent:${agentId}`);
      else if (this.state.room?.hostUserId === userId) {
        // From the host: an agent's voice once its map says so, else its microphone.
        peer.unknown.set(stream.id, stream);
        setTimeout(() => {
          if (peer.unknown.delete(stream.id)) this.tracks.set(track.id, `person:${userId}`);
        }, 1500);
      } else this.tracks.set(track.id, `person:${userId}`);
    });
    if (this.mic) for (const track of this.mic.getAudioTracks()) pc.addTrack(track, this.mic);
  }

  private closePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(userId);
    for (const [id, who] of this.tracks) if (who === `person:${userId}`) this.tracks.delete(id);
  }

  private async onSignal(from: string, data: Signal) {
    if (!this.peers.has(from)) this.openPeer(from);
    const peer = this.peers.get(from);
    if (!peer) return;
    const { pc } = peer;
    try {
      if (data.kind === "desc" && data.description?.sdp) {
        const description = { type: data.description.type, sdp: data.description.sdp };
        const collision = description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        // The polite side gives way: its own offer goes back before it takes the other's.
        if (collision) await pc.setLocalDescription({ type: "rollback", sdp: "" }).catch(() => {});
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const desc = pc.localDescription;
          if (desc) this.signal(from, { kind: "desc", description: { type: String(desc.type), sdp: desc.sdp } });
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
            for (const t of waiting.getAudioTracks()) this.tracks.set(t.id, `agent:${agentId}`);
          }
        }
      }
    } catch {
      // A failed step is retried by the next negotiation.
    }
  }

  // ── Agents' voices, when this phone hosts ──
  private async startVoices() {
    const room = this.state.room;
    const track = this.mic?.getAudioTracks()[0];
    if (!room || !track) return;
    const ids = room.agentIds;
    if (!ids.length) return;
    this.host = new LiveHost({
      api: this.o.api.liveVoice,
      orgId: this.o.orgId,
      roomId: room.id,
      agents: () => this.roomAgents(),
      people: () => this.state.room?.people.length ?? 1,
      leg: (id) => this.legs.get(id) ?? null,
      live: (id) => this.state.agentVoices[id] === "live",
      gate: (holder) => {
        for (const [id, leg] of this.legs) if (leg.voiceTrack) leg.voiceTrack.enabled = id === holder;
      },
      peopleTalking: () => (this.state.levels[`person:${this.o.me}`] ?? 0) > TALKING_LEVEL,
      // The agents here hear this phone's microphone only.
      loudestPerson: () => this.o.me,
      nameOf: (who) => this.nameOf(who),
      onHolder: (holder) => this.set({ holder }),
      onLine: (line) => this.line(line),
      onLiveCaption: (who, text) => this.liveCaption(who, text),
    });
    this.host.start(this.lines());
    this.set({ agentVoices: Object.fromEntries(ids.map((id) => [id, "connecting" as const])) });
    await Promise.all(ids.map((agentId) => this.openVoice(agentId, track)));
  }

  private lines(): LiveRoomLine[] {
    return this.state.room?.lines ?? [];
  }

  private async openVoice(agentId: string, track: MediaStreamTrack) {
    const room = this.state.room;
    if (!room) return;
    try {
      const leg = await PhoneLeg.open(
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
          event: (e) => this.host?.voiceEvent(agentId, e),
          voice: (t) => {
            t.enabled = this.host?.holder === agentId;
            this.tracks.set(t.id, `agent:${agentId}`);
          },
          closed: () => this.setVoice(agentId, "failed"),
          delegation: (id) => this.host?.delegated(agentId, id),
        },
      );
      if (this.torn || !this.hosting) {
        void leg.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
        return;
      }
      this.legs.set(agentId, leg);
      this.setVoice(agentId, "live");
      this.host?.voiceOpened(agentId);
    } catch {
      this.setVoice(agentId, "failed");
    }
  }

  private setVoice(agentId: string, s: "connecting" | "live" | "failed") {
    if (this.state.agentVoices[agentId] === s) return;
    this.set({ agentVoices: { ...this.state.agentVoices, [agentId]: s } });
    if (s === "failed") this.host?.voiceFailed(agentId);
  }

  private async closeVoices() {
    this.host?.stop();
    this.host = null;
    const legs = [...this.legs.values()];
    this.legs.clear();
    this.set({ agentVoices: {} });
    await Promise.all(legs.map((leg) => leg.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id))));
  }

  // ── What was said ──
  private line(line: LiveRoomLine) {
    const who = whoOf(line);
    const captions = this.state.captions.filter((c) => !(c.live && c.who === who));
    this.set({
      captions: [...captions, { who, text: line.text, at: Date.now(), n: ++this.said }].slice(-MAX_CAPTIONS),
    });
  }

  private liveCaption(who: Who, text: string) {
    const captions = this.state.captions.filter((c) => !(c.live && c.who === who));
    this.set({
      captions: text
        ? [...captions, { who, text, at: Date.now(), live: true, n: ++this.said }].slice(-MAX_CAPTIONS)
        : captions,
    });
  }

  nameOf(who: Who) {
    const [type, id] = who.split(":") as ["person" | "agent", string];
    if (type === "agent") return this.o.agents.find((a) => a.id === id)?.name ?? "A colleague";
    return this.o.personName(id) ?? "Someone";
  }

  // ── Sound levels ──
  private async readLevels() {
    if (this.torn) return;
    const reports: Record<string, unknown>[] = [];
    const pcs = [...[...this.peers.values()].map((p) => p.pc), ...[...this.legs.values()].map((l) => l.pc)];
    await Promise.all(
      pcs.map(async (pc) => {
        try {
          const stats = (await pc.getStats()) as Map<string, Record<string, unknown>>;
          for (const r of stats.values()) reports.push(r);
        } catch {}
      }),
    );
    const levels = levelsFromStats(reports, (id) => this.tracks.get(id) ?? null, `person:${this.o.me}`);
    if (!this.state.micOn) levels.set(`person:${this.o.me}`, 0);
    const next: Partial<Record<Who, number>> = {};
    let changed = false;
    for (const [who, level] of levels) {
      const was = this.state.levels[who] ?? 0;
      // Up at once, down slowly: the glow doesn't flicker between words.
      const v = level > was ? level : was * 0.6;
      next[who] = v;
      if (Math.abs(v - was) > 0.04) changed = true;
    }
    for (const who of Object.keys(this.state.levels) as Who[])
      if (!(who in next) && (this.state.levels[who] ?? 0) > 0.04) changed = true;
    if (changed) this.set({ levels: next });
  }

  private teardown() {
    if (this.torn) return;
    this.torn = true;
    for (const t of this.timers) clearInterval(t);
    this.off?.();
    void this.closeVoices();
    for (const userId of [...this.peers.keys()]) this.closePeer(userId);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic?.release?.();
    stopCallAudio();
    callActive.set(false);
  }
}
