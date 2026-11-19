import type { ApiClient } from "@agenteschat/client";
import { openVoiceLeg, type VoiceLeg } from "./leg";

/**
 * A call with one agent (ADR doug-0006, as the Nordus Live call): the microphone and the agent's voice go between this
 * browser and OpenAI; the server hands what is asked to the agent in its conversation and gives its answer back to the
 * voice, so the chat shows the work while the person talks. This side only carries the audio and the captions.
 */

export interface AgentCallState {
  phase: "connecting" | "live" | "ended" | "failed";
  error: unknown;
  micOn: boolean;
  /** What the agent is saying now, or what the person just said. */
  caption: { who: "agent" | "me"; text: string } | null;
  startedAt: number;
}

const CAPTION_IDLE_MS = 1400;

export class AgentCall {
  private state: AgentCallState = {
    phase: "connecting",
    error: null,
    micOn: true,
    caption: null,
    startedAt: Date.now(),
  };
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private leg: VoiceLeg | null = null;
  private audio: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private level = 0;
  private frame = 0;
  private done = false;
  private captionIdle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly o: { api: ApiClient; orgId: string; agentId: string; channelId: string; language: string },
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  loudness = () => this.level;
  private set(patch: Partial<AgentCallState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  async start() {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const track = this.mic.getAudioTracks()[0];
      if (!track) throw new Error("no microphone");
      this.ctx = new AudioContext();
      this.leg = await openVoiceLeg(
        track,
        (extra) =>
          this.o.api.liveVoice.startVoice(this.o.orgId, {
            ...extra,
            kind: "agent",
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
          voice: (stream) => {
            this.audio = new Audio();
            this.audio.autoplay = true;
            this.audio.srcObject = stream;
            void this.audio.play().catch(() => {});
            if (!this.ctx) return;
            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 512;
            this.ctx.createMediaStreamSource(stream).connect(this.analyser);
            this.loop();
          },
          closed: () => void this.stop(),
          // The server takes what it delegates, on its sideband (`agentCall`).
          delegation: () => {},
        },
      );
      if (this.done) void this.leg.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
    } catch (error) {
      this.set({ phase: "failed", error });
      this.cleanup();
    }
  }

  private caption(who: "agent" | "me", delta: string) {
    const was = this.state.caption;
    const text = was && was.who === who ? `${was.text}${delta}` : delta.trimStart();
    // The latest words only: a caption line, not a transcript (the chat has the work).
    this.set({ caption: { who, text: text.length > 220 ? `…${text.slice(-220)}` : text } });
    if (this.captionIdle) clearTimeout(this.captionIdle);
    this.captionIdle = setTimeout(() => this.set({ caption: null }), CAPTION_IDLE_MS * 3);
  }

  toggleMic() {
    const on = !this.state.micOn;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = on;
    this.set({ micOn: on });
  }

  private loop() {
    const buf = new Float32Array(512);
    const tick = () => {
      if (this.done || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 9);
      this.level = level > this.level ? level : this.level * 0.88;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
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
    cancelAnimationFrame(this.frame);
    if (this.captionIdle) clearTimeout(this.captionIdle);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.audio?.pause();
    void this.ctx?.close().catch(() => {});
  }
}
