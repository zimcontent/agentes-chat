import type { LiveRoom } from "@agenteschat/client";
import type { Who } from "@agenteschat/client/lib/live-host";

/** Pure rules of a call on the phone (docs/adr/doug-0006-live-voice.md, the phone app), kept apart to be tested. */

/** A sound past this (0 to 1, WebRTC's `audioLevel`) is someone talking. */
export const TALKING_LEVEL = 0.06;

/**
 * How loud each one is, from WebRTC's stats: the remote tracks (`inbound-rtp`, by their track) and this phone's
 * microphone (`media-source`). Levels come squared up a little so a voice lights its tile like the web's glow.
 */
export function levelsFromStats(
  reports: Iterable<Record<string, unknown>>,
  whoOfTrack: (trackId: string) => Who | null,
  me: Who,
): Map<Who, number> {
  const out = new Map<Who, number>();
  const put = (who: Who, level: number) =>
    out.set(who, Math.max(out.get(who) ?? 0, Math.min(1, Math.sqrt(level) * 1.4)));
  for (const r of reports) {
    const level = typeof r.audioLevel === "number" ? r.audioLevel : null;
    if (level === null || r.kind !== "audio") continue;
    if (r.type === "media-source") put(me, level);
    else if (r.type === "inbound-rtp") {
      const track = typeof r.trackIdentifier === "string" ? r.trackIdentifier : "";
      const who = whoOfTrack(track);
      if (who) put(who, level);
    }
  }
  return out;
}

/**
 * This phone runs the agents' voices while other people are on the call: they can't hear the agents (a phone can't
 * pass the agents' audio on), so the call says that someone on a computer fixes it.
 */
export function phoneHostsOthers(room: LiveRoom | null, me: string): boolean {
  if (!room || room.hostUserId !== me || room.agentIds.length === 0) return false;
  return room.people.some((p) => p.userId !== me);
}

/** "3:07", "1:02:45": how long the call has been on. */
export function elapsedText(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The people and agents on the call, as tiles: the people first (this phone's person leading), then the agents. */
export function tilesOf(room: LiveRoom | null, me: string): Who[] {
  if (!room) return [`person:${me}`];
  const people = room.people.map((p) => p.userId);
  const ordered = [me, ...people.filter((id) => id !== me)];
  return [...ordered.map((id): Who => `person:${id}`), ...room.agentIds.map((id): Who => `agent:${id}`)];
}

/** What the conversation's call button does when pressed (`CallButton`). */
export type CallPress = "open" | "join" | "call-agent" | "start" | "needs-key";

/**
 * The call button's press, from what is known: the call this phone is on, a call live here, an agent's DM, and
 * whether the workspace's voice key works (`null` while asked). The button never hides: an agent's DM with no voice
 * key says what is missing (`needs-key`); while the key is still being asked it calls as if it works (the call itself
 * says so). A group opens "Chamada de voz", where people can call with no key.
 */
export function callPress({
  inThisCall,
  live,
  dmAgent,
  keyOk,
}: {
  inThisCall: boolean;
  live: boolean;
  dmAgent: boolean;
  keyOk: boolean | null;
}): CallPress {
  if (inThisCall) return "open";
  if (live) return "join";
  if (dmAgent) return keyOk === false ? "needs-key" : "call-agent";
  return "start";
}
