import type { ApiClient } from "@agenteschat/client";

/**
 * This app's side of a maestro call (docs/adr/doug-0006-live-voice.md §11). Voice detection runs here, on the device
 * and for free: only what it hears as speech is cut out, made a small WAV and sent to be written down, so silence
 * costs nothing. The moment its person starts talking, every voice stops (`hush`). The agents' lines arrive as
 * `live.say` and play one after another, each streamed from the server as it is made; a line that belongs to a moment
 * that's gone (a newer `gen`) is dropped.
 */

export interface Say {
  gen: number;
  utteranceId: string;
  agentId: string;
  text: string;
}

const BLOCK = 2048;
/** Speech starts after this much sound over the threshold (blocks of ~43 ms). */
const START_BLOCKS = 3;
/** And ends after this much quiet: a breath inside a sentence isn't the end. */
const END_MS = 750;
const PREROLL_MS = 350;
/** Shorter is a cough or a click. */
const MIN_MS = 500;
const MAX_MS = 30_000;
const RATE = 16_000;
/** The pause between two agents' lines: a human gap, not a robot's. */
const GAP_MS = 220;

export class MaestroVoice {
  private processor: ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;
  private pre: Float32Array[] = [];
  private taken: Float32Array[] = [];
  private loud = 0;
  private quietMs = 0;
  private talking = false;
  private noise = 0.004;
  private queue: Say[] = [];
  private playing: { say: Say; audio: HTMLAudioElement } | null = null;
  private gen = 0;
  private stopped = false;
  private micOn = true;

  constructor(
    private readonly o: {
      api: ApiClient;
      orgId: string;
      roomId: string;
      language: string;
      ctx: AudioContext;
      mic: MediaStreamAudioSourceNode;
      /** Where an agent's voice goes to be heard and to light its tile. */
      bus: (agentId: string) => AudioNode;
      /** Who is speaking now (null: nobody), for the tiles. */
      speaking: (agentId: string | null) => void;
      /** The person's words, once written down. */
      heard?: (text: string) => void;
    },
  ) {}

  start() {
    const { ctx, mic } = this.o;
    this.processor = ctx.createScriptProcessor(BLOCK, 1, 1);
    // A processor runs only while connected to the output: through a silent gain, so the microphone isn't heard here.
    this.mute = ctx.createGain();
    this.mute.gain.value = 0;
    mic.connect(this.processor);
    this.processor.connect(this.mute);
    this.mute.connect(ctx.destination);
    this.processor.onaudioprocess = (e) => this.block(e.inputBuffer.getChannelData(0));
  }

  setMic(on: boolean) {
    this.micOn = on;
    if (!on && this.talking) this.finish(false);
  }

  private block(input: Float32Array) {
    if (this.stopped) return;
    const data = new Float32Array(input);
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    const blockMs = (data.length / this.o.ctx.sampleRate) * 1000;
    // While an agent plays, its voice may come back through the speakers: it takes more to count as the person.
    const echo = this.playing ? 2.2 : 1;
    // Above the room's own noise, and never below a voice's level: a fan or a keyboard isn't the person.
    const start = Math.max(0.02, this.noise * 4) * echo;
    const keep = Math.max(0.012, this.noise * 2.5) * echo;
    if (!this.micOn) return;
    if (!this.talking) {
      this.pre.push(data);
      while (this.pre.length * blockMs > PREROLL_MS) this.pre.shift();
      if (rms > start) this.loud++;
      else {
        this.loud = 0;
        this.noise = this.noise * 0.97 + rms * 0.03;
      }
      if (this.loud >= START_BLOCKS) {
        this.talking = true;
        this.quietMs = 0;
        this.taken = [...this.pre];
        this.pre = [];
        this.hush();
      }
      return;
    }
    this.taken.push(data);
    this.quietMs = rms > keep ? 0 : this.quietMs + blockMs;
    const length = this.taken.length * blockMs;
    if (this.quietMs >= END_MS || length >= MAX_MS) this.finish(true);
  }

  /** Its person started talking: every voice stops, here at once and for everyone through the server. */
  private hush() {
    this.drop(Number.POSITIVE_INFINITY);
    // The server holds what it prepares while the person talks; it cuts only a voice playing.
    void this.o.api.liveVoice.hush(this.o.orgId, this.o.roomId).catch(() => {});
  }

  private finish(send: boolean) {
    const blocks = this.taken;
    this.taken = [];
    this.talking = false;
    this.loud = 0;
    const ms = (blocks.length * BLOCK * 1000) / this.o.ctx.sampleRate - (send ? this.quietMs : 0);
    if (!send || ms < MIN_MS) return;
    const wav = toWav(blocks, this.o.ctx.sampleRate);
    void this.o.api.liveVoice
      .heard(this.o.orgId, this.o.roomId, { blob: wav, durationMs: ms, language: this.o.language })
      .then((r) => r.text && this.o.heard?.(r.text))
      .catch(() => {});
  }

  /** An agent's line: played after what is playing, unless it belongs to a moment that's gone. */
  say(say: Say) {
    if (say.gen < this.gen) return;
    this.queue.push(say);
    if (!this.playing) this.next();
  }

  /** Every line older than `gen` stops and is dropped (a person talks). */
  hushed(gen: number) {
    this.gen = Math.max(this.gen, gen);
    this.drop(gen);
  }

  private drop(gen: number) {
    this.queue = this.queue.filter((s) => s.gen >= gen);
    if (this.playing && this.playing.say.gen < gen) {
      const audio = this.playing.audio;
      audio.onerror = null;
      audio.onended = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      this.playing = null;
      this.o.speaking(null);
    }
  }

  private next() {
    const say = this.queue.shift();
    if (!say || this.stopped) {
      this.o.speaking(null);
      return;
    }
    const audio = new Audio(this.o.api.liveVoice.speechUrl(this.o.orgId, this.o.roomId, say.utteranceId));
    const source = this.o.ctx.createMediaElementSource(audio);
    source.connect(this.o.bus(say.agentId));
    this.playing = { say, audio };
    this.o.speaking(say.agentId);
    const done = () => {
      if (this.playing?.audio !== audio) return;
      this.playing = null;
      source.disconnect();
      setTimeout(() => this.next(), GAP_MS);
    };
    audio.onended = done;
    audio.onerror = done;
    void audio.play().catch(done);
  }

  stop() {
    this.stopped = true;
    this.drop(Number.POSITIVE_INFINITY);
    this.queue = [];
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.mute?.disconnect();
  }
}

/** Blocks of the microphone at `rate`, as 16 kHz mono 16-bit WAV (what speech engines take, and small). */
function toWav(blocks: Float32Array[], rate: number): Blob {
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const ratio = rate / RATE;
  const length = Math.floor(total / ratio);
  const pcm = new Int16Array(length);
  let i = 0;
  let source = 0;
  const all = new Float32Array(total);
  for (const b of blocks) {
    all.set(b, source);
    source += b.length;
  }
  for (; i < length; i++) {
    const v = all[Math.floor(i * ratio)] ?? 0;
    pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
  }
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => {
    for (let k = 0; k < s.length; k++) header.setUint8(at + k, s.charCodeAt(k));
  };
  text(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, RATE, true);
  header.setUint32(28, RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm], { type: "audio/wav" });
}
