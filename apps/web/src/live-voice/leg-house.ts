import type { HouseLiveSession } from "@agenteschat/client";
import type { LegHandlers, LiveEvent } from "./leg";

/**
 * One house voice session (docs/adr/doug-0036-house-voice.md): the microphone goes to this server as 16-bit PCM at the
 * session's rate over the relay socket, and the voice comes back the same way; the server talks to the model with its
 * own key. Events are GPT-Live's (the server translates), so this leg is a drop-in for `LiveLeg`.
 *
 * The voice is played through a WebRTC connection to this same page: browsers cancel the echo of what they play only
 * for WebRTC audio, and without it the voice would hear itself in the microphone and stop to listen.
 */

/** Resamples the input to the session's rate and posts 40 ms of 16-bit PCM at a time. */
const CAPTURE_WORKLET = `
class DougbotPcm extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.rate;
    this.pos = 0;
    this.out = new Int16Array(Math.round(options.processorOptions.rate * 0.04));
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = ch[i];
      const b = i + 1 < ch.length ? ch[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        this.port.postMessage(this.out.buffer.slice(0));
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("dougbot-pcm", DougbotPcm);
`;

/** How far ahead the first chunk of an answer is scheduled, so the next ones arrive in time. */
const LEAD_S = 0.06;

/** The voice's stream, played as WebRTC audio of this page (echo cancelled); the plain stream if that fails. */
async function echoSafe(stream: MediaStream): Promise<{ stream: MediaStream; close(): void }> {
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  const close = () => {
    a.close();
    b.close();
  };
  try {
    a.onicecandidate = (e) => e.candidate && void b.addIceCandidate(e.candidate).catch(() => {});
    b.onicecandidate = (e) => e.candidate && void a.addIceCandidate(e.candidate).catch(() => {});
    const received = new Promise<MediaStream>((done, fail) => {
      const timer = setTimeout(() => fail(new Error("loopback")), 3000);
      b.ontrack = (e) => {
        clearTimeout(timer);
        done(e.streams[0] ?? new MediaStream([e.track]));
      };
    });
    for (const t of stream.getAudioTracks()) a.addTrack(t, stream);
    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    return { stream: await received, close };
  } catch {
    close();
    return { stream, close: () => {} };
  }
}

export class HouseLeg {
  session: HouseLiveSession;
  private ws: WebSocket;
  private ctx: AudioContext;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private out: MediaStreamAudioDestinationNode;
  private loop: { close(): void } | null = null;
  private playhead = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private started = false;
  private queue: string[] = [];
  private closing: Promise<void> | null = null;
  private ended = false;

  private constructor(
    session: HouseLiveSession,
    ws: WebSocket,
    ctx: AudioContext,
    private readonly handlers: LegHandlers,
  ) {
    this.session = session;
    this.ws = ws;
    this.ctx = ctx;
    this.out = ctx.createMediaStreamDestination();
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (e) => {
      if (typeof e.data === "string") this.receive(e.data);
      else this.play(new Int16Array(e.data as ArrayBuffer));
    });
    ws.addEventListener("close", () => this.finish("connection_lost"));
  }

  /** Opens the relay socket of a session the server started, and starts sending the microphone. */
  static async open(input: MediaStreamTrack, session: HouseLiveSession, handlers: LegHandlers): Promise<HouseLeg> {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${scheme}//${location.host}${session.path}?ticket=${encodeURIComponent(session.ticket)}`);
    const ctx = new AudioContext();
    try {
      await Promise.all([
        new Promise<void>((done, fail) => {
          ws.addEventListener("open", () => done(), { once: true });
          ws.addEventListener("error", () => fail(new Error("relay")), { once: true });
          ws.addEventListener("close", () => fail(new Error("relay")), { once: true });
        }),
        ctx.audioWorklet.addModule(
          URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" })),
        ),
      ]);
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const leg = new HouseLeg(session, ws, ctx, handlers);
      leg.capture = new AudioWorkletNode(ctx, "dougbot-pcm", {
        processorOptions: { rate: session.sampleRate },
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      leg.capture.port.onmessage = (e) => {
        if (leg.started && ws.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer);
      };
      leg.replaceInput(input);
      leg.loop = await echoSafe(leg.out.stream).then((played) => {
        handlers.voice?.(played.stream);
        return played;
      });
      return leg;
    } catch (error) {
      ws.close();
      void ctx.close().catch(() => {});
      throw error;
    }
  }

  private receive(data: string) {
    let event: LiveEvent;
    try {
      event = JSON.parse(data) as LiveEvent;
    } catch {
      return;
    }
    if (event.type === "session.started") {
      this.started = true;
      for (const q of this.queue.splice(0)) this.ws.send(q);
    }
    // The person talks over the voice: what it was going to say stops now.
    if (event.type === "session.speech.started") this.hush();
    if (event.type === "session.delegation.created") {
      const id = (event.delegation as { id?: string } | undefined)?.id;
      if (id && this.handlers.delegation) this.handlers.delegation(id);
      else if (id)
        this.send({
          type: "session.commentary.append",
          delegation_id: id,
          content:
            "Nothing can run during the call. Say briefly that it goes in the meeting's notes and the team picks it up after the call.",
        });
    }
    if (event.type === "session.closed") this.finish(String(event.reason ?? "closed"));
    this.handlers.event?.(event);
  }

  /** One chunk of the voice, played right after the one before. */
  private play(pcm: Int16Array) {
    if (this.ended || pcm.length === 0) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, this.session.sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] ?? 0) / 0x8000;
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.out);
    const at = Math.max(this.playhead, this.ctx.currentTime + LEAD_S);
    node.start(at);
    this.playhead = at + buffer.duration;
    this.playing.add(node);
    node.onended = () => this.playing.delete(node);
  }

  private hush() {
    for (const node of this.playing) {
      try {
        node.stop();
      } catch {}
    }
    this.playing.clear();
    this.playhead = 0;
  }

  private send(event: Record<string, unknown>) {
    const text = JSON.stringify(event);
    if (this.started && this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
    else this.queue.push(text);
  }

  hear(on: boolean) {
    this.send({ type: on ? "session.input_audio.unmute" : "session.input_audio.mute" });
  }
  instruct(content: string) {
    this.send({ type: "session.instructions.append", delegation_id: null, content: content.slice(0, 1800) });
  }
  note(content: string) {
    this.send({ type: "session.thinking.append", delegation_id: null, content: content.slice(-1800) });
  }
  answer(delegationId: string, content: string) {
    this.send({ type: "session.commentary.append", delegation_id: delegationId, content: content.slice(0, 1800) });
  }
  say(content: string) {
    this.send({ type: "session.commentary.append", delegation_id: null, content: content.slice(0, 1800) });
  }
  replaceInput(track: MediaStreamTrack) {
    this.source?.disconnect();
    this.source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    if (this.capture) this.source.connect(this.capture);
  }

  private finish(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.hush();
    this.handlers.closed?.(reason);
  }

  /** Asks the server to close it (it settles the credits), waits a moment, and lets go of the audio. */
  close(end: (sessionId: string) => Promise<void>) {
    this.closing ??= (async () => {
      if (this.started && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "session.close" }));
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 3000);
          this.ws.addEventListener("close", () => {
            clearTimeout(timer);
            done();
          });
        });
      }
      this.ws.close();
      this.loop?.close();
      this.source?.disconnect();
      void this.ctx.close().catch(() => {});
      this.finish("ended");
      await end(this.session.id).catch(() => {});
    })();
    return this.closing;
  }
}
