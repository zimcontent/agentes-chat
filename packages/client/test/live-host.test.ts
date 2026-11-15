import { afterEach, describe, expect, test } from "bun:test";
import type { LiveRoomLine } from "../src/api/types";
import { type HostLeg, LiveHost, type LiveHostDeps } from "../src/lib/live-host";

/** The turns a host app runs (ADR doug-0006), with fake voices: what each is told, and who has the word. */

const ANA = { id: "a1", name: "Ana", handle: "ana" };
const BRUNO = { id: "b2", name: "Bruno", handle: "bruno" };

interface FakeLeg extends HostLeg {
  told: string[];
  hearing: boolean;
}

function fakeLeg(): FakeLeg {
  const leg: FakeLeg = {
    told: [],
    hearing: false,
    hear: (on) => {
      leg.hearing = on;
    },
    instruct: (s) => leg.told.push(`instruct:${s}`),
    note: (s) => leg.told.push(`note:${s}`),
    answer: (id, s) => leg.told.push(`answer:${id}:${s}`),
  };
  return leg;
}

let hosts: LiveHost[] = [];
afterEach(() => {
  for (const h of hosts) h.stop();
  hosts = [];
});

function room(options: { people?: number; next?: string | null } = {}) {
  const legs = new Map<string, FakeLeg>([
    [ANA.id, fakeLeg()],
    [BRUNO.id, fakeLeg()],
  ]);
  const calls: { kind: string; input: unknown }[] = [];
  const gates: (string | null)[] = [];
  const lines: LiveRoomLine[] = [];
  const holders: (string | null)[] = [];
  const api: LiveHostDeps["api"] = {
    lines: async (_o, _r, input) => {
      calls.push({ kind: "lines", input });
    },
    floor: async (_o, _r, holder, reason) => {
      calls.push({ kind: "floor", input: { holder, reason } });
    },
    next: async () => ({ agentId: options.next ?? null, when: null }),
    ask: async (_o, _r, input) => {
      calls.push({ kind: "ask", input });
      return { askId: "x" };
    },
  };
  const host = new LiveHost({
    api,
    orgId: "o",
    roomId: "r",
    agents: () => [ANA, BRUNO],
    people: () => options.people ?? 1,
    leg: (id) => legs.get(id) ?? null,
    live: () => true,
    gate: (h) => gates.push(h),
    peopleTalking: () => false,
    loudestPerson: () => "me",
    nameOf: (who) => (who === "person:me" ? "Gabriel" : who === `agent:${ANA.id}` ? "Ana" : "Bruno"),
    onHolder: (h) => holders.push(h),
    onLine: (l) => lines.push(l),
    onLiveCaption: () => {},
  });
  hosts.push(host);
  return { host, legs, calls, gates, lines, holders };
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("the host's turns, shared by the web and the phone app", () => {
  test("the lead has the word from the start and only it hears", () => {
    const r = room();
    r.host.start([]);
    r.host.voiceOpened(ANA.id);
    r.host.voiceOpened(BRUNO.id);
    expect(r.host.holder).toBe(ANA.id);
    expect(r.gates.at(-1)).toBe(ANA.id);
    expect(r.legs.get(ANA.id)?.hearing).toBe(true);
    expect(r.legs.get(BRUNO.id)?.hearing).toBe(false);
  });

  test("a person names an agent mid-sentence: the word goes to it, with what was said so far", async () => {
    const r = room();
    r.host.start([]);
    r.host.voiceEvent(ANA.id, { type: "session.input_transcript.delta", delta: "Bruno, quanto custa o servidor" });
    expect(r.host.holder).toBe(BRUNO.id);
    expect(r.legs.get(BRUNO.id)?.hearing).toBe(true);
    expect(r.legs.get(ANA.id)?.hearing).toBe(false);
    expect(r.legs.get(BRUNO.id)?.told.some((t) => t.includes("quanto custa o servidor"))).toBe(true);
    // The pause writes the person's line down.
    await wait(1400);
    expect(r.lines.map((l) => l.text)).toEqual(["Bruno, quanto custa o servidor"]);
    expect(r.calls.some((c) => c.kind === "lines")).toBe(true);
  });

  test("an agent without the word isn't heard: what it says doesn't count", () => {
    const r = room();
    r.host.start([]);
    r.host.voiceEvent(BRUNO.id, { type: "session.output_transcript.delta", delta: "Eu acho que" });
    expect(r.lines).toHaveLength(0);
  });

  test("work asked on the call is told at the next pause, by the agent that took it", async () => {
    const r = room();
    r.host.start([]);
    r.host.delegated(BRUNO.id, "d1");
    await wait(800);
    expect(r.calls.find((c) => c.kind === "ask")?.input).toMatchObject({ agentId: BRUNO.id, delegationId: "d1" });
    r.host.answerArrived({ agentId: BRUNO.id, delegationId: "d1", text: "São três servidores." });
    await wait(1600);
    r.host.deliverAnswers();
    expect(r.host.holder).toBe(BRUNO.id);
    expect(r.legs.get(BRUNO.id)?.told).toContain("answer:d1:São três servidores.");
  });

  test("a voice that fails gives the word back to the lead", () => {
    const r = room();
    r.host.start([]);
    r.host.give(BRUNO.id);
    expect(r.host.holder).toBe(BRUNO.id);
    r.host.voiceFailed(BRUNO.id);
    expect(r.host.holder).toBe(ANA.id);
  });
});
