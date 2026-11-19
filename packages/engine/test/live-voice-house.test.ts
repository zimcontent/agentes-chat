import { afterEach, describe, expect, test } from "bun:test";
import type { ZimMedia } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { CREDIT_NANO_USD, houseVoiceFor, isHouseVoice } from "@agenteschat/providers/live-voice";
import {
  endLiveSession,
  houseRelayWaiting,
  houseSession,
  type LiveDialectEvent,
  type LiveVoiceDeps,
  liveVoiceView,
  openHouseRelay,
  saveLiveVoiceKey,
  setAgentVoice,
  setLiveVoiceEngine,
  setLiveVoiceMonthlyCredits,
  startLiveSession,
  WORK_TOOL,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** The house voice (docs/adr/doug-0036-house-voice.md): its translation, its engine, its credits and its relay. */

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

/** A fake wallet: its price, its balance, and every call it charged. */
function wallet(balance = 1000, perMinute = 20) {
  const charged: { orgId: string; idempotencyKey: string; engine: string; seconds: number }[] = [];
  const media = {
    catalog: async () => ({
      models: [],
      packs: [],
      calls: { qwen: { creditsPerMinute: 100 }, "qwen-live": { creditsPerMinute: perMinute } },
    }),
    balance: async () => ({ balance }),
    chargeCall: async (orgId: string, input: { idempotencyKey: string; engine: string; seconds: number }) => {
      charged.push({ orgId, ...input });
      const credits = Math.ceil((perMinute * input.seconds) / 60);
      return { credits, unpaid: 0, balance: balance - credits, repeated: false };
    },
  } as unknown as ZimMedia;
  return { media, charged };
}

/** A fake model socket: what the relay sent it, and a way to play the model's events. */
function model() {
  const sent: Record<string, unknown>[] = [];
  let on: { open(): void; message(data: string): void; close(): void } | null = null;
  return {
    sent,
    open: ((_url: string, _key: string, handlers: typeof on) => {
      on = handlers;
      queueMicrotask(() => on?.open());
      return { send: (data: string) => sent.push(JSON.parse(data)), close: () => {} };
    }) as NonNullable<LiveVoiceDeps["house"]>["open"],
    emit: (event: object) => on?.message(JSON.stringify(event)),
    drop: () => on?.close(),
  };
}

function deps(extra: Partial<LiveVoiceDeps> = {}): LiveVoiceDeps {
  return { db: f.db, pubsub: f.pubsub, keyWrapper: f.keyWrapper, keyWrappers: [f.keyWrapper], ...extra };
}

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

describe("the translation between GPT-Live's events and the model's", () => {
  function bridge(setup: Partial<Parameters<typeof houseSession>[0]> = {}) {
    const up: Record<string, unknown>[] = [];
    const events: LiveDialectEvent[] = [];
    const audio: Uint8Array[] = [];
    const s = houseSession(
      {
        instructions: "Você é a Ana.",
        voice: "luna_v3.1",
        language: "pt-BR",
        delegate: true,
        speakFirst: false,
        ...setup,
      },
      {
        upstream: (e) => up.push(e as Record<string, unknown>),
        event: (e) => events.push(e),
        audio: (p) => audio.push(p),
      },
    );
    return { s, up, events, audio };
  }

  test("the session opens with its voice, the language, the tool to hand work, and says it started", () => {
    const { s, up, events } = bridge();
    s.open();
    const update = up[0] as { session: Record<string, unknown> };
    expect(update.session).toMatchObject({ type: "realtime", input_language: "pt", output_language: "pt" });
    expect(JSON.stringify(update.session)).toContain("luna_v3.1");
    expect(JSON.stringify(update.session)).toContain(WORK_TOOL);
    expect(String(update.session.instructions)).toContain("Você é a Ana.");
    s.fromModel(JSON.stringify({ type: "session.updated" }));
    s.fromModel(JSON.stringify({ type: "session.updated" }));
    expect(events.map((e) => e.type)).toEqual(["session.started"]);
    // Nothing is said until the person speaks: it doesn't speak first.
    expect(up.some((e) => e.type === "response.create")).toBe(false);
  });

  test("Ouvir and samples speak first, and have no tool", () => {
    const { s, up } = bridge({ delegate: false, speakFirst: true });
    s.open();
    expect(JSON.stringify(up[0])).not.toContain(WORK_TOOL);
    s.fromModel(JSON.stringify({ type: "session.updated" }));
    expect(JSON.stringify(up.at(-2))).toContain("The call just connected");
    expect(up.at(-1)).toEqual({ type: "response.create" });
  });

  test("audio, transcripts and the person talking over the voice", () => {
    const { s, events, audio } = bridge();
    s.fromModel(
      JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.from([1, 2, 3, 4]).toString("base64") }),
    );
    s.fromModel(JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "Oi, " }));
    s.fromModel(
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: " Quantas tarefas? ",
      }),
    );
    s.fromModel(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    expect([...(audio[0] ?? [])]).toEqual([1, 2, 3, 4]);
    expect(events).toEqual([
      { type: "session.output_transcript.delta", delta: "Oi, " },
      { type: "session.input_transcript.delta", delta: "Quantas tarefas? " },
      { type: "session.speech.started" },
    ]);
  });

  test("handing work: the function call is a delegation, and its answer the function's output, told at once", () => {
    const { s, up, events } = bridge();
    s.fromModel(JSON.stringify({ type: "response.created" }));
    s.fromModel(
      JSON.stringify({
        type: "response.done",
        response: {
          output: [{ type: "message" }, { type: "function_call", name: WORK_TOOL, call_id: "call_7", arguments: "{}" }],
          usage: {
            input_tokens_details: { text_tokens: 100, audio_tokens: 50 },
            output_tokens_details: { text_tokens: 10, audio_tokens: 200 },
          },
        },
      }),
    );
    expect(events.find((e) => e.type === "session.delegation.created")).toEqual({
      type: "session.delegation.created",
      delegation: { id: "call_7" },
    });
    s.command({ type: "session.commentary.append", delegation_id: "call_7", content: "São 12 tarefas." });
    expect(up.slice(-2)).toEqual([
      {
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: "call_7", output: "São 12 tarefas." },
      },
      { type: "response.create" },
    ]);
    // What it cost us, by the model's own usage; the audio answer pays no text output.
    expect(s.cost().costNanoUsd).toBe(100 * 460 + 50 * 1860 + 200 * 3740);
  });

  test("a line to say while it speaks waits for the answer to end", () => {
    const { s, up } = bridge();
    s.fromModel(JSON.stringify({ type: "response.created" }));
    s.command({ type: "session.commentary.append", delegation_id: null, content: "Conta da reunião de amanhã." });
    expect(up.filter((e) => e.type === "response.create")).toHaveLength(0);
    expect(JSON.stringify(up.at(-1))).toContain("Say this now");
    s.fromModel(JSON.stringify({ type: "response.done", response: {} }));
    expect(up.filter((e) => e.type === "response.create")).toHaveLength(1);
  });

  test("muted, the microphone goes nowhere; notes are quiet; instructions add up", () => {
    const { s, up } = bridge();
    s.fromModel(JSON.stringify({ type: "session.updated" }));
    s.audioIn(new Uint8Array([0, 1]));
    expect(up.at(-1)).toMatchObject({ type: "input_audio_buffer.append" });
    s.command({ type: "session.input_audio.mute" });
    const before = up.length;
    s.audioIn(new Uint8Array([0, 1]));
    expect(up.length).toBe(before);
    s.command({ type: "session.thinking.append", content: "A Bia disse que o prazo é sexta." });
    expect(up.at(-1)).toMatchObject({ type: "conversation.item.create", item: { role: "system" } });
    s.command({ type: "session.instructions.append", content: "Agora quem fala é você." });
    const update = up.at(-1) as { session: { instructions: string } };
    expect(update.session.instructions).toContain("Você é a Ana.");
    expect(update.session.instructions).toContain("Agora quem fala é você.");
  });
});

describe("which voice a workspace's calls use", () => {
  test("the house voice by default where the server has it; GPT-Live otherwise or when picked", async () => {
    f = await setup();
    expect((await liveVoiceView(deps(), f.owner.id, f.org.id)).engine).toBe("gpt-live");
    const { media } = wallet(1000);
    const d = deps({ house: { apiKey: "k", media, open: model().open } });
    expect(await liveVoiceView(d, f.owner.id, f.org.id)).toMatchObject({
      state: "ok",
      engine: "house",
      chosenEngine: null,
      gptLiveKey: false,
      house: { perMinute: 20, balance: 1000, monthlyCredits: null, spentThisMonth: 0 },
    });
    expect((await setLiveVoiceEngine(d, f.owner.id, f.org.id, "gpt-live")).engine).toBe("gpt-live");
    expect((await setLiveVoiceEngine(d, f.owner.id, f.org.id, null)).engine).toBe("house");
    expect((await setLiveVoiceMonthlyCredits(d, f.owner.id, f.org.id, 600)).house?.monthlyCredits).toBe(600);
    const bia = await addMember(f.db, f.org.id, "member", "Bia");
    await expect(setLiveVoiceEngine(d, bia.id, f.org.id, "gpt-live")).rejects.toThrow();
    await expect(setLiveVoiceEngine(deps(), f.owner.id, f.org.id, "house")).rejects.toThrow("no house voice");
  });

  test("each agent has a house voice of its own, like its GPT-Live one; its owner or an admin picks another", async () => {
    f = await setup();
    expect(isHouseVoice(houseVoiceFor(f.agent.id))).toBe(true);
    expect(houseVoiceFor(f.agent.id, null, "cedar")).toMatch(/eric|luca|brian|david|andy|daniel/);
    const agent = await setAgentVoice(f.db, f.owner.id, f.org.id, f.agent.id, "luca_v3.1", { engine: "house" });
    expect(agent).toMatchObject({ houseVoice: "luca_v3.1", voice: null });
    await expect(setAgentVoice(f.db, f.owner.id, f.org.id, f.agent.id, "cedar", { engine: "house" })).rejects.toThrow(
      "voice must be one of",
    );
  });
});

describe("a house voice session", () => {
  test("it opens with a ticket, carries the call through the relay, and is paid in credits when it ends", async () => {
    f = await setup();
    const { media, charged } = wallet(1000, 20);
    const m = model();
    const d = deps({ house: { apiKey: "k", media, open: m.open } });
    await setAgentVoice(f.db, f.owner.id, f.org.id, f.agent.id, "luca_v3.1", { engine: "house" });

    const session = await startLiveSession(d, f.owner.id, f.org.id, {
      kind: "sample",
      agentId: f.agent.id,
      transports: ["relay", "webrtc"],
      language: "pt-BR",
    });
    if (session.transport !== "relay") throw new Error(session.transport);
    expect(session).toMatchObject({ voice: "luca_v3.1", sampleRate: 24000, maxSeconds: 30 });
    expect(houseRelayWaiting(session.ticket)).toBe(true);

    const toApp: string[] = [];
    const audio: Uint8Array[] = [];
    let closed = false;
    const relay = openHouseRelay(d, session.ticket, {
      text: (t) => toApp.push(t),
      binary: (p) => audio.push(p),
      close: () => {
        closed = true;
      },
    });
    if (!relay) throw new Error("no relay");
    // The ticket opens one socket, once.
    expect(houseRelayWaiting(session.ticket)).toBe(false);
    expect(openHouseRelay(d, session.ticket, { text() {}, binary() {}, close() {} })).toBeNull();

    await tick();
    expect(m.sent[0]).toMatchObject({ type: "session.update" });
    m.emit({ type: "session.created", session: { id: "sess_q1" } });
    m.emit({ type: "session.updated" });
    m.emit({ type: "response.output_audio.delta", delta: Buffer.from([9, 9]).toString("base64") });
    expect(toApp.map((t) => JSON.parse(t).type)).toContain("session.started");
    expect(audio).toHaveLength(1);
    relay.message(new Uint8Array([1, 2, 3, 4]));
    expect(m.sent.some((e) => e.type === "input_audio_buffer.append")).toBe(true);

    await tick(1100);
    relay.message(JSON.stringify({ type: "session.close" }));
    expect(closed).toBe(true);
    const until = Date.now() + 3000;
    while (!charged.length && Date.now() < until) await tick(50);
    expect(charged).toEqual([{ orgId: f.org.id, idempotencyKey: session.id, engine: "qwen-live", seconds: 1 }]);
    await tick(50);
    const [row] = await f.db.select().from(schema.liveVoiceSessions).where(eq(schema.liveVoiceSessions.id, session.id));
    expect(row).toMatchObject({ engine: "house", providerSessionId: "sess_q1", seconds: 1, credits: 1 });
    expect(row?.costNanoUsd).toBe(CREDIT_NANO_USD);
    const usage = await f.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.provider, "empirio"));
    expect(usage).toHaveLength(1);
    // Ending again charges nothing more.
    await endLiveSession(d, f.owner.id, f.org.id, session.id);
    expect(charged).toHaveLength(1);
  });

  test("no credits for a minute, or the month's limit reached: no call", async () => {
    f = await setup();
    const poor = deps({ house: { apiKey: "k", media: wallet(10, 20).media, open: model().open } });
    await expect(
      startLiveSession(poor, f.owner.id, f.org.id, { kind: "sample", transports: ["relay"] }),
    ).rejects.toThrow("Not enough credits");
    const d = deps({ house: { apiKey: "k", media: wallet(1000, 20).media, open: model().open } });
    await setLiveVoiceMonthlyCredits(d, f.owner.id, f.org.id, 10);
    await expect(startLiveSession(d, f.owner.id, f.org.id, { kind: "sample", transports: ["relay"] })).rejects.toThrow(
      "limit",
    );
    // It lasts what the wallet pays for: 50 credits at 20 a minute is two and a half minutes.
    await setLiveVoiceMonthlyCredits(d, f.owner.id, f.org.id, null);
    const short = deps({ house: { apiKey: "k", media: wallet(50, 20).media, open: model().open } });
    const s = await startLiveSession(short, f.owner.id, f.org.id, {
      kind: "agent",
      agentId: f.agent.id,
      channelId: f.general.id,
      transports: ["relay"],
    });
    expect(s).toMatchObject({ transport: "relay", maxSeconds: 150 });
  });

  test("an app that only carries WebRTC: GPT-Live with the workspace's key, else it is asked to update", async () => {
    f = await setup();
    const fetch = (async (url: string | URL) =>
      String(url).endsWith("/live/sessions")
        ? Response.json({ session: { id: "sess_1" }, transport: { sdp: "v=0 answer" } }, { status: 201 })
        : Response.json({ id: "gpt-live-1" })) as unknown as typeof globalThis.fetch;
    const d = deps({ fetch, house: { apiKey: "k", media: wallet().media, open: model().open } });
    await expect(startLiveSession(d, f.owner.id, f.org.id, { kind: "sample", sdp: "v=0" })).rejects.toThrow(
      "Update the app",
    );
    await saveLiveVoiceKey(d, f.owner.id, f.org.id, "sk-proj-live-voice-test-key-9f3c");
    expect(await startLiveSession(d, f.owner.id, f.org.id, { kind: "sample", sdp: "v=0" })).toMatchObject({
      transport: "webrtc",
      sdp: "v=0 answer",
    });
    // On GPT-Live, an app that can do both is asked for its offer first.
    await setLiveVoiceEngine(d, f.owner.id, f.org.id, "gpt-live");
    expect(
      await startLiveSession(d, f.owner.id, f.org.id, { kind: "sample", transports: ["relay", "webrtc"] }),
    ).toEqual({ transport: "offer" });
  });

  test("a call with one agent: what it hands over goes to the agent's conversation, and the summary when it ends", async () => {
    f = await setup();
    const m = model();
    const posted: { body: string; meta: Record<string, unknown> }[] = [];
    const d = deps({
      house: { apiKey: "k", media: wallet().media, open: m.open },
      postMessage: async (_userId, _orgId, _channelId, body, meta) => {
        posted.push({ body, meta });
        return { id: Bun.randomUUIDv7() };
      },
    });
    const s = await startLiveSession(d, f.owner.id, f.org.id, {
      kind: "agent",
      agentId: f.agent.id,
      channelId: f.general.id,
      transports: ["relay"],
    });
    if (s.transport !== "relay") throw new Error(s.transport);
    const relay = openHouseRelay(d, s.ticket, { text() {}, binary() {}, close() {} });
    await tick();
    expect(JSON.stringify(m.sent[0])).toContain(WORK_TOOL);
    m.emit({ type: "session.updated" });
    // It speaks first: the agent greets.
    expect(m.sent.at(-1)).toEqual({ type: "response.create" });
    m.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Faz o relatório de vendas" });
    m.emit({ type: "response.created" });
    m.emit({ type: "response.output_audio_transcript.delta", delta: "Já vejo." });
    m.emit({
      type: "response.done",
      response: { output: [{ type: "function_call", name: WORK_TOOL, call_id: "call_1" }] },
    });
    const until = Date.now() + 5000;
    while (!posted.length && Date.now() < until) await tick(50);
    expect(posted[0]).toEqual({ body: "Faz o relatório de vendas", meta: { via: "call", liveSessionId: s.id } });
    relay?.close();
    const end = Date.now() + 5000;
    while (posted.length < 2 && Date.now() < end) await tick(50);
    expect(posted[1]?.meta).toMatchObject({ callSummary: true });
    expect(posted[1]?.body).toContain("Já vejo.");
  }, 20_000);
});
