import { describe, expect, test } from "bun:test";
import type { LiveRoom } from "@agenteschat/client";
import { elapsedText, levelsFromStats, phoneHostsOthers, tilesOf } from "../../src/features/call/logic";

/** Voice calls in the phone app (docs/adr/doug-0006-live-voice.md, the phone app): the rules apart from WebRTC. */

const room = (over: Partial<LiveRoom> = {}): LiveRoom => ({
  id: "r",
  channelId: "c",
  hostUserId: "me",
  agentIds: ["a1"],
  topic: null,
  people: [{ userId: "me", joinedAt: "", phone: true }],
  status: "live",
  startedAt: new Date(0).toISOString(),
  endedAt: null,
  lines: [],
  reportMessageId: null,
  ...over,
});

describe("a call on the phone", () => {
  test("how loud each one is, from WebRTC's stats", () => {
    const levels = levelsFromStats(
      [
        { type: "media-source", kind: "audio", audioLevel: 0.25 },
        { type: "inbound-rtp", kind: "audio", audioLevel: 0.04, trackIdentifier: "t-agent" },
        { type: "inbound-rtp", kind: "audio", audioLevel: 0.5, trackIdentifier: "t-unknown" },
        { type: "inbound-rtp", kind: "video", audioLevel: 1, trackIdentifier: "t-agent" },
      ],
      (id) => (id === "t-agent" ? "agent:a1" : null),
      "person:me",
    );
    expect(levels.get("person:me")).toBeCloseTo(0.7);
    expect(levels.get("agent:a1")).toBeCloseTo(0.28);
    expect(levels.size).toBe(2);
  });

  test("the phone says it alone hears the agents only while it runs them with others on", () => {
    expect(phoneHostsOthers(room(), "me")).toBe(false);
    const withBia = room({
      people: [
        { userId: "me", joinedAt: "", phone: true },
        { userId: "bia", joinedAt: "", phone: true },
      ],
    });
    expect(phoneHostsOthers(withBia, "me")).toBe(true);
    expect(phoneHostsOthers({ ...withBia, hostUserId: "bia" }, "me")).toBe(false);
    expect(phoneHostsOthers({ ...withBia, agentIds: [] }, "me")).toBe(false);
  });

  test("tiles: this person first, then the others, then the agents", () => {
    const r = room({
      people: [
        { userId: "bia", joinedAt: "" },
        { userId: "me", joinedAt: "", phone: true },
      ],
      agentIds: ["a1", "a2"],
    });
    expect(tilesOf(r, "me")).toEqual(["person:me", "person:bia", "agent:a1", "agent:a2"]);
    expect(tilesOf(null, "me")).toEqual(["person:me"]);
  });

  test("how long the call has been on", () => {
    expect(elapsedText(0, 187_000)).toBe("3:07");
    expect(elapsedText(0, 3_765_000)).toBe("1:02:45");
    expect(elapsedText(10, 0)).toBe("0:00");
  });
});
