import type { LiveSession, LiveSessionInput, LiveSessionStart } from "@dougbot/client";
import { HouseLeg } from "./leg-house";

/**
 * One GPT-Live session over WebRTC (ADR doug-0006): the audio goes between this browser and OpenAI, the events on the
 * `oai-events` data channel. The server opens the session from this offer (`start`): the key never comes here.
 */

export type LiveEvent = { type: string; delta?: string; [key: string]: unknown };

export interface LegHandlers {
  /** Every event from OpenAI. */
  event?(event: LiveEvent): void;
  /** The voice's audio, once it arrives. */
  voice?(stream: MediaStream): void;
  /** The session closed or the connection dropped. */
  closed?(reason: string): void;
  /**
   * It delegated (it said "já vejo" and wants work done): whoever runs the call takes it. Without this, it is told that
   * nothing runs now. A call with one agent leaves it to the server, which answers on its sideband.
   */
  delegation?(delegationId: string): void;
}

const ICE_WAIT_MS = 2500;

/** Waits for the offer's candidates, so one HTTP round trip carries them all (no trickling through the server). */
function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((done) => {
    const timer = setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        done();
      }
    });
  });
}

export class LiveLeg {
  readonly pc = new RTCPeerConnection();
  readonly channel: RTCDataChannel;
  private sender: RTCRtpSender;
  private started = false;
  private queue: string[] = [];
  private closing: Promise<void> | null = null;
  private ended = false;
  session: LiveSession | null = null;

  private constructor(
    input: MediaStreamTrack,
    private readonly handlers: LegHandlers,
  ) {
    this.sender = this.pc.addTrack(input, new MediaStream([input]));
    this.channel = this.pc.createDataChannel("oai-events");
    this.channel.addEventListener("message", (e) => this.receive(String(e.data)));
    this.pc.addEventListener("track", (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.handlers.voice?.(stream);
    });
    this.pc.addEventListener("connectionstatechange", () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") this.finish("connection_lost");
    });
  }

  /** Opens the session: an offer from this browser, OpenAI's answer through the server. */
  static async open(
    input: MediaStreamTrack,
    start: (sdp: string) => Promise<LiveSession>,
    handlers: LegHandlers,
  ): Promise<LiveLeg> {
    const leg = new LiveLeg(input, handlers);
    try {
      const offer = await leg.pc.createOffer();
      await leg.pc.setLocalDescription(offer);
      await gathered(leg.pc);
      leg.session = await start(leg.pc.localDescription?.sdp ?? offer.sdp ?? "");
      await leg.pc.setRemoteDescription({ type: "answer", sdp: leg.session.sdp });
      return leg;
    } catch (error) {
      leg.pc.close();
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
      for (const q of this.queue.splice(0)) this.channel.send(q);
    }
    if (event.type === "session.delegation.created") {
      const delegation = event.delegation as { id?: string; target?: string } | undefined;
      const id = delegation?.id;
      if (id && delegation?.target !== "responses" && this.handlers.delegation) this.handlers.delegation(id);
      else if (id && !this.handlers.delegation)
        this.send({
          type: "session.thinking.append",
          delegation_id: id,
          content:
            "Nothing can run during the call. Say briefly that it goes in the meeting's notes and the team picks it up after the call.",
        });
    }
    if (event.type === "session.closed") this.finish(String(event.reason ?? "closed"));
    this.handlers.event?.(event);
  }

  private send(event: Record<string, unknown>) {
    const text = JSON.stringify(event);
    if (this.started && this.channel.readyState === "open") this.channel.send(text);
    else this.queue.push(text);
  }

  /** Whether the voice hears its input (the others' audio and the people's microphones). */
  hear(on: boolean) {
    this.send({ type: on ? "session.input_audio.unmute" : "session.input_audio.mute" });
  }
  /** A trusted instruction that changes how it speaks now. GPT-Live takes 500 tokens a time. */
  instruct(content: string) {
    this.send({ type: "session.instructions.append", delegation_id: null, content: content.slice(0, 1800) });
  }
  /** Quiet context: what it missed, said by no one. */
  note(content: string) {
    this.send({ type: "session.thinking.append", delegation_id: null, content: content.slice(-1800) });
  }
  /** The result of work it delegated, for it to tell in its own words. */
  answer(delegationId: string, content: string) {
    this.send({ type: "session.commentary.append", delegation_id: delegationId, content: content.slice(0, 1800) });
  }
  /** Something for it to say now, in its own words. */
  say(content: string) {
    this.send({ type: "session.commentary.append", delegation_id: null, content: content.slice(0, 1800) });
  }
  replaceInput(track: MediaStreamTrack) {
    void this.sender.replaceTrack(track);
  }

  private finish(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.handlers.closed?.(reason);
  }

  /** Asks OpenAI to close it (its final usage comes then), waits a moment, and closes the connection. */
  close(end: (sessionId: string) => Promise<void>) {
    this.closing ??= (async () => {
      if (this.started && this.channel.readyState === "open") {
        this.channel.send(JSON.stringify({ type: "session.close" }));
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 3000);
          this.channel.addEventListener("message", (e) => {
            if (String(e.data).includes('"session.closed"')) {
              clearTimeout(timer);
              done();
            }
          });
        });
      }
      this.pc.close();
      this.finish("ended");
      if (this.session) await end(this.session.id).catch(() => {});
    })();
    return this.closing;
  }
}

/** A voice session's leg: GPT-Live over WebRTC, or the house voice through this server (docs/adr/doug-0036-house-voice.md). */
export type VoiceLeg = LiveLeg | HouseLeg;

/** What the app adds to a session's start: how it can carry the audio, and its offer once GPT-Live asks for it. */
type StartExtra = Pick<LiveSessionInput, "sdp" | "transports">;

/**
 * Opens a session on the workspace's engine: the server answers a house voice session at once, or asks for this
 * browser's WebRTC offer when the workspace is on GPT-Live.
 */
export async function openVoiceLeg(
  input: MediaStreamTrack,
  start: (extra: StartExtra) => Promise<LiveSessionStart>,
  handlers: LegHandlers,
): Promise<VoiceLeg> {
  const transports: ("webrtc" | "relay")[] = ["relay", "webrtc"];
  const first = await start({ transports });
  if (first.transport === "relay") return HouseLeg.open(input, first, handlers);
  return LiveLeg.open(
    input,
    async (sdp) => {
      const session = await start({ sdp, transports: ["webrtc"] });
      if (session.transport === "relay" || session.transport === "offer" || !("sdp" in session))
        throw new Error("the session didn't open on GPT-Live");
      return session;
    },
    handlers,
  );
}
