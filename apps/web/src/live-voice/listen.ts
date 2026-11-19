import type { ApiClient } from "@agenteschat/client";
import { openVoiceLeg, type VoiceLeg } from "./leg";

/**
 * "Ouvir" (ADR doug-0006): a message told by voice, as a colleague would tell it, or a voice saying hello (`sample`). One
 * GPT-Live session that starts on silence; "Perguntar" swaps the silence for the microphone, so the person can
 * interrupt and ask. It closes by itself a few seconds after the voice goes quiet.
 */

export interface ListenState {
  phase: "connecting" | "speaking" | "waiting" | "ended" | "failed";
  error: unknown;
  asking: boolean;
  /** What the voice said so far. */
  said: string;
}

const QUIET_END_MS = 7000;
/** If it says nothing this long after connecting, it is asked once more to begin. */
const NUDGE_MS = 3500;

export class ListenCall {
  private state: ListenState = { phase: "connecting", error: null, asking: false, said: "" };
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private leg: VoiceLeg | null = null;
  private mic: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private nudge: ReturnType<typeof setTimeout> | null = null;
  private done = false;
  private level = 0;
  private frame = 0;

  constructor(
    private readonly o: {
      api: ApiClient;
      orgId: string;
      kind: "listen" | "sample";
      messageId?: string;
      agentId?: string | null;
      voice?: string | null;
      language: string;
    },
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<ListenState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  loudness = () => this.level;

  async start() {
    try {
      this.ctx = new AudioContext();
      // Silence until the person asks something: the session needs a track to hear.
      const silence = this.ctx.createMediaStreamDestination();
      const track = silence.stream.getAudioTracks()[0];
      if (!track) throw new Error("no audio track");
      this.leg = await openVoiceLeg(
        track,
        (extra) =>
          this.o.api.liveVoice.startVoice(this.o.orgId, {
            ...extra,
            kind: this.o.kind,
            messageId: this.o.messageId,
            agentId: this.o.agentId,
            voice: this.o.voice,
            language: this.o.language,
          }),
        {
          event: (e) => {
            if (e.type === "session.started") {
              this.leg?.instruct("Begin now.");
              this.nudge = setTimeout(() => {
                if (!this.state.said)
                  this.leg?.say(
                    this.o.kind === "sample" ? "Hello, introduce yourself." : "Tell them what the message says.",
                  );
              }, NUDGE_MS);
            }
            if (e.type === "session.output_transcript.delta" && e.delta) {
              this.set({ said: this.state.said + e.delta, phase: "speaking" });
              this.armQuiet();
            }
            if (e.type === "session.input_transcript.delta") this.armQuiet();
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
        },
      );
      if (this.done) void this.leg.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
      else this.armQuiet(15_000);
    } catch (error) {
      this.set({ phase: "failed", error });
      this.cleanup();
    }
  }

  /** "Perguntar": the microphone goes in, so the person can interrupt and ask. */
  async ask() {
    if (!this.leg || this.state.asking) return;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const track = this.mic.getAudioTracks()[0];
      if (track) this.leg.replaceInput(track);
      this.set({ asking: true });
      this.armQuiet(20_000);
    } catch (error) {
      this.set({ error });
    }
  }

  private armQuiet(ms = QUIET_END_MS) {
    if (this.quiet) clearTimeout(this.quiet);
    this.quiet = setTimeout(
      () => {
        // Still talking (its audio plays after its words arrive): wait more.
        if (this.level > 0.04) return this.armQuiet(1500);
        if (this.state.said) this.set({ phase: "waiting" });
        void this.stop();
      },
      this.state.asking ? Math.max(ms, 12_000) : ms,
    );
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
    this.done = true;
    const leg = this.leg;
    this.cleanup();
    this.set({ phase: this.state.phase === "failed" ? "failed" : "ended" });
    await leg?.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
  }

  private cleanup() {
    this.done = true;
    cancelAnimationFrame(this.frame);
    if (this.quiet) clearTimeout(this.quiet);
    if (this.nudge) clearTimeout(this.nudge);
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.audio?.pause();
    void this.ctx?.close().catch(() => {});
  }
}
