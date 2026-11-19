import type { LiveSession } from "@dougbot/client";
import type { HostLeg } from "@dougbot/client/lib/live-host";
import { MediaStream, type MediaStreamTrack, RTCPeerConnection, type RTCRtpSender } from "react-native-webrtc";

type RTCDataChannel = ReturnType<RTCPeerConnection["createDataChannel"]>;

/**
 * One agent's GPT-Live session from the phone (ADR doug-0006, the phone app): the web's `LiveLeg` on react-native-webrtc.
 * The audio goes between the phone and OpenAI, the events on the `oai-events` data channel; the server opens the
 * session from this offer, so the key never comes to the phone.
 */

export type LiveEvent = { type: string; delta?: string; [key: string]: unknown };

export interface LegHandlers {
  event?(event: LiveEvent): void;
  /** The voice's audio track, once it arrives (react-native-webrtc plays it while it is enabled). */
  voice?(track: MediaStreamTrack): void;
  closed?(reason: string): void;
  /** It delegated ("já vejo"): the host takes it. Without this, it is told that nothing runs now. */
  delegation?(delegationId: string): void;
}

const ICE_WAIT_MS = 2500;

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

export class PhoneLeg implements HostLeg {
  readonly pc = new RTCPeerConnection();
  readonly channel: RTCDataChannel;
  private sender: RTCRtpSender;
  private started = false;
  private queue: string[] = [];
  private closing: Promise<void> | null = null;
  private ended = false;
  /** The voice's track: enabled only while it has the word. */
  voiceTrack: MediaStreamTrack | null = null;
  session: LiveSession | null = null;

  private constructor(
    input: MediaStreamTrack,
    private readonly handlers: LegHandlers,
  ) {
    this.sender = this.pc.addTrack(input, new MediaStream([input]));
    this.channel = this.pc.createDataChannel("oai-events");
    this.channel.addEventListener("message", (e) => this.receive(String(e.data)));
    this.pc.addEventListener("track", (e) => {
      const track = e.track;
      if (track?.kind !== "audio") return;
      this.voiceTrack = track;
      this.handlers.voice?.(track);
    });
    this.pc.addEventListener("connectionstatechange", () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") this.finish("connection_lost");
    });
  }

  static async open(
    input: MediaStreamTrack,
    start: (sdp: string) => Promise<LiveSession>,
    handlers: LegHandlers,
  ): Promise<PhoneLeg> {
    const leg = new PhoneLeg(input, handlers);
    try {
      const offer = await leg.pc.createOffer({});
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
