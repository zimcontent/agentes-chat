import type { ApiClient } from "@agenteschat/client";
import { openVoiceLeg, type VoiceLeg } from "./leg";

/**
 * A voice's preview in the voice picker (ADR doug-0006): the agent says hello in that voice through a short GPT-Live
 * session (`sample`), recorded as it plays, so hearing the same voice again plays the recording and costs nothing. When
 * the workspace's key doesn't have the voice, OpenAI's answer says which one spoke instead (`fellBack`).
 */

export interface PreviewState {
  /** The voice being previewed (agent + voice), or null. */
  key: string | null;
  phase: "idle" | "connecting" | "playing" | "failed";
  error: unknown;
}

interface Take {
  url: string;
  /** The voice that actually spoke: another when the key doesn't have the one asked for. */
  spoke: string;
}

/** Recordings of this page's previews, by agent, voice and language. */
const takes = new Map<string, Take>();
/** Voices this workspace's key turned down, so the picker can say so before anyone clicks again. */
const refused = new Set<string>();

const QUIET_END_MS = 2500;
const NUDGE_MS = 3500;
const MAX_MS = 25_000;

export const voiceRefused = (voice: string) => refused.has(voice);

export class VoicePreview {
  private state: PreviewState = { key: null, phase: "idle", error: null };
  private listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private stopLive: (() => void) | null = null;
  private run = 0;

  constructor(private readonly o: { api: ApiClient; orgId: string; language: string }) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<PreviewState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** The voice that answered for this one last time, when it wasn't the one asked for. */
  fellBack(agentId: string, voice: string): string | null {
    const take = takes.get(this.keyOf(agentId, voice));
    return take && take.spoke !== voice ? take.spoke : null;
  }

  /** This agent's preview in this voice is the one connecting, playing or failed now. */
  isOn(agentId: string, voice: string) {
    return this.state.key === this.keyOf(agentId, voice);
  }

  private keyOf(agentId: string, voice: string) {
    return `${agentId}:${voice}:${this.o.language}`;
  }

  /** Plays the voice (again from its recording when there is one); the same one again stops it. */
  toggle(agentId: string, voice: string) {
    const key = this.keyOf(agentId, voice);
    const same = this.state.key === key && this.state.phase !== "idle" && this.state.phase !== "failed";
    this.stop();
    if (same) return;
    const take = takes.get(key);
    if (take) this.playTake(key, take.url);
    else void this.record(key, agentId, voice);
  }

  stop() {
    this.run++;
    this.stopLive?.();
    this.stopLive = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio = null;
    }
    if (this.state.phase !== "failed") this.set({ key: null, phase: "idle", error: null });
  }

  private playTake(key: string, url: string) {
    const audio = new Audio(url);
    this.audio = audio;
    this.set({ key, phase: "playing", error: null });
    audio.onended = () => {
      if (this.audio === audio) this.stop();
    };
    void audio.play().catch(() => this.stop());
  }

  private async record(key: string, agentId: string, voice: string) {
    const run = this.run;
    this.set({ key, phase: "connecting", error: null });
    const ctx = new AudioContext();
    const silence = ctx.createMediaStreamDestination();
    const track = silence.stream.getAudioTracks()[0];
    let leg: VoiceLeg | null = null;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    let said = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      for (const t of timers) clearTimeout(t);
      if (quiet) clearTimeout(quiet);
      if (recorder?.state === "recording") recorder.stop();
      void leg?.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
      void ctx.close().catch(() => {});
    };
    this.stopLive = close;
    const armQuiet = () => {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(() => {
        close();
        if (this.run === run) this.stop();
      }, QUIET_END_MS);
    };
    try {
      if (!track) throw new Error("no audio track");
      leg = await openVoiceLeg(
        track,
        (extra) =>
          this.o.api.liveVoice.startVoice(this.o.orgId, {
            ...extra,
            kind: "sample",
            agentId,
            voice,
            language: this.o.language,
          }),
        {
          event: (e) => {
            if (e.type === "session.started") {
              leg?.instruct("Begin now.");
              timers.push(setTimeout(() => !said && leg?.say("Hello, introduce yourself."), NUDGE_MS));
            }
            if (e.type === "session.output_transcript.delta" && e.delta) {
              said = true;
              if (this.run === run) this.set({ phase: "playing" });
              // The audio plays a moment after its words: the end waits past the last ones.
              armQuiet();
            }
          },
          voice: (stream) => {
            if (closed) return;
            this.audio = new Audio();
            this.audio.autoplay = true;
            this.audio.srcObject = stream;
            void this.audio.play().catch(() => {});
            try {
              recorder = new MediaRecorder(stream);
              recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
              recorder.onstop = () => {
                if (!said || !chunks.length) return;
                const spoke = leg?.session?.voice ?? voice;
                takes.set(key, { url: URL.createObjectURL(new Blob(chunks, { type: recorder?.mimeType })), spoke });
                if (spoke !== voice) refused.add(voice);
                for (const fn of this.listeners) fn();
              };
              recorder.start();
            } catch {
              // No recording here: the preview plays, and plays live again next time.
            }
          },
          closed: () => {
            close();
            if (this.run === run) this.stop();
          },
        },
      );
      if (closed) void leg.close((id) => this.o.api.liveVoice.endSession(this.o.orgId, id));
      if (leg.session && leg.session.voice !== voice) refused.add(voice);
      timers.push(
        setTimeout(() => {
          close();
          if (this.run === run) this.stop();
        }, MAX_MS),
      );
    } catch (error) {
      close();
      if (this.run === run) this.set({ phase: "failed", error });
    }
  }
}
