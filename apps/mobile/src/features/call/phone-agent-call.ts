import type { ApiClient } from "@dougbot/client";
import { type MediaStream, mediaDevices } from "react-native-webrtc";
import { callActive } from "./active";
import { PhoneLeg } from "./leg";
import { type CallRoute, setCallRoute, startCallAudio, stopCallAudio } from "./route";

/**
 * A call with one agent from its DM, on the phone (ADR doug-0006, as the web's `AgentCall`): the microphone and the
 * agent's voice go between the phone and OpenAI; the server hands what is asked to the agent in its conversation and
 * gives its answer back to the voice. This side carries the audio, the captions and where the sound goes.
 */

export interface PhoneAgentCallState {
  phase: "connecting" | "live" | "ended" | "failed";
  error: unknown;
  micOn: boolean;
  route: CallRoute;
  caption: { who: "agent" | "me"; text: string } | null;
  /** How loud the agent is now, 0 to 1. */
  level: number;
  startedAt: number;
}

const CAPTION_IDLE_MS = 4200;
const LEVEL_MS = 250;

export class PhoneAgentCall {
  private state: PhoneAgentCallState = {
    phase: "connecting",
    error: null,
    micOn: true,
    route: "earpiece",
    caption: null,
    level: 0,
    startedAt: Date.now(),
  };
  private listeners = new Set<() => void>();
  private mic: MediaStream | null = null;
  private leg: PhoneLeg | null = null;
  private done = false;
  private captionIdle: ReturnType<typeof setTimeout> | null = null;
  private levels: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly o: { api: ApiClient; orgId: string; agentId: string; channelId: string; language: string },
  ) {}

  get agentId() {
    return this.o.agentId;
  }
  get channelId() {
    return this.o.channelId;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<PhoneAgentCallState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  async start() {
    try {
      this.mic = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
      const track = this.mic.getAudioTracks()[0];
      if (!track) throw new Error("no microphone");
      callActive.set(true);
      startCallAudio(this.state.route);
      this.leg = await PhoneLeg.open(
        track,
        (sdp) =>
          this.o.api.liveVoice.startSession(this.o.orgId, {
            kind: "agent",
            sdp,
            agentId: this.o.agentId,
            channelId: this.o.channelId,
            language: this.o.language,
          }),
        {
          event: (e) => {
            if (e.type === "session.started") this.set({ phase: "live", startedAt: Date.now() });
            if (e.type === "session.output_transcript.delta" && e.delta) this.caption("agent", e.delta);
            if (e.type === "session.input_transcript.delta" && e.delta) this.caption("me", e.delta);
          },
          closed: () => void this.stop(),
          // The server takes what it delegates, on its sideband.
          delegation: () => {},
        },
      );
      if (this.done) void this.leg.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
      else this.levels = setInterval(() => void this.readLevel(), LEVEL_MS);
    } catch (error) {
      this.set({ phase: "failed", error });
      this.cleanup();
    }
  }

  private caption(who: "agent" | "me", delta: string) {
    const was = this.state.caption;
    const text = was && was.who === who ? `${was.text}${delta}` : delta.trimStart();
    this.set({ caption: { who, text: text.length > 220 ? `…${text.slice(-220)}` : text } });
    if (this.captionIdle) clearTimeout(this.captionIdle);
    this.captionIdle = setTimeout(() => this.set({ caption: null }), CAPTION_IDLE_MS);
  }

  private async readLevel() {
    const pc = this.leg?.pc;
    if (!pc || this.done) return;
    try {
      const stats = (await pc.getStats()) as Map<string, Record<string, unknown>>;
      let level = 0;
      for (const r of stats.values())
        if (r.type === "inbound-rtp" && r.kind === "audio" && typeof r.audioLevel === "number")
          level = Math.max(level, Math.min(1, Math.sqrt(r.audioLevel) * 1.4));
      const v = level > this.state.level ? level : this.state.level * 0.6;
      if (Math.abs(v - this.state.level) > 0.04) this.set({ level: v });
    } catch {}
  }

  toggleMic() {
    const on = !this.state.micOn;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = on;
    this.set({ micOn: on });
  }

  setRoute(route: CallRoute) {
    setCallRoute(route);
    this.set({ route });
  }

  async stop() {
    if (this.done) return;
    const leg = this.leg;
    this.cleanup();
    this.set({ phase: this.state.phase === "failed" ? "failed" : "ended" });
    await leg?.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
  }

  private cleanup() {
    this.done = true;
    if (this.captionIdle) clearTimeout(this.captionIdle);
    if (this.levels) clearInterval(this.levels);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic?.release();
    stopCallAudio();
    callActive.set(false);
  }
}
