import { afterEach, describe, expect, test } from "bun:test";
import { createFakeVoiceOut, type SpeechEngine, userTopic } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  addressedIn,
  joinLiveRoom,
  type LiveVoiceDeps,
  MAESTRO_TURNS,
  maestroHeard,
  maestroHush,
  maestroJoined,
  maestroSpeech,
  maestroStage,
  resetMaestro,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/**
 * The maestro (docs/adr/doug-0006-live-voice.md §11): the server runs the call. Who was asked answers; one voice at a
 * time; a person talking stops everything; work asked for runs for real and is told when it comes back.
 */

let f: Fixture;
afterEach(async () => {
  resetMaestro();
  await f?.close();
  f = undefined as unknown as Fixture;
});

const wait = async (ok: () => boolean, ms = 8000) => {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await new Promise((r) => setTimeout(r, 30));
};

async function room(options: { heard?: string; plans?: (system: string, prompt: string) => string } = {}) {
  f = await setup();
  resetMaestro(0);
  const rosa = Bun.randomUUIDv7();
  const [base] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, f.agent.id));
  if (!base) throw new Error("no agent");
  await f.db.insert(schema.agents).values({ ...base, id: rosa, handle: "rosa", name: "Rosa", role: "Marketing" });
  const voiceOut = createFakeVoiceOut();
  const thoughts: { system: string; prompt: string }[] = [];
  const posted: { body: string; meta: Record<string, unknown> }[] = [];
  const speech: SpeechEngine = {
    id: "openai",
    model: "test",
    nanoUsdPerHour: 0,
    minBilledSeconds: 0,
    file: async () => ({ text: options.heard ?? "Oi, tudo bem?" }),
  };
  const d: LiveVoiceDeps = {
    db: f.db,
    pubsub: f.pubsub,
    keyWrapper: f.keyWrapper,
    keyWrappers: [f.keyWrapper],
    voiceOut,
    speech: () => [speech],
    think: async ({ system, prompt }) => {
      thoughts.push({ system, prompt });
      return options.plans?.(system, prompt) ?? `{"speaker":"${f.agent.handle}","say":"Oi, pessoal."}`;
    },
    postMessage: async (_userId, _orgId, channelId, body, meta) => {
      posted.push({ body, meta });
      const id = Bun.randomUUIDv7();
      await f.db.insert(schema.messages).values({
        id,
        orgId: f.org.id,
        channelId,
        authorType: "person",
        authorUserId: f.owner.id,
        body,
        meta,
      });
      setTimeout(async () => {
        await f.db.insert(schema.messages).values({
          id: Bun.randomUUIDv7(),
          orgId: f.org.id,
          channelId,
          authorType: "agent",
          authorAgentId: rosa,
          body: "Vendemos **12 mil** essa semana.",
        });
      }, 100);
      return { id };
    },
  };
  const events: Record<string, unknown>[] = [];
  f.pubsub.subscribe(userTopic(f.org.id, f.owner.id), (e) => events.push(e as Record<string, unknown>));
  const call = await joinLiveRoom(d, f.owner.id, f.org.id, f.general.id, {
    agentIds: [f.agent.id, rosa],
    mode: "maestro",
  });
  return { d, call, rosa, voiceOut, thoughts, posted, events };
}

describe("the maestro", () => {
  test("the call opens with the lead's greeting at once (no model), then the team reads live-call.md", async () => {
    const { d, call, voiceOut, thoughts, events } = await room();
    expect(call.mode).toBe("maestro");
    await maestroJoined(d, f.owner.id, f.org.id, call.id, "pt-BR");
    await wait(() => events.some((e) => e.type === "live.say"));
    expect(voiceOut.spoken[0]?.text).toContain("Sobre o que a gente vai falar?");
    const say = events.find((e) => e.type === "live.say") as { utteranceId: string; agentId: string };
    expect(say.agentId).toBe(f.agent.id);
    // Every app reads the same audio, from the start.
    const stream = await maestroSpeech(d, f.owner.id, f.org.id, call.id, say.utteranceId);
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toContain("mp3:Oi");
    // What comes after the greeting is the model's, with the base every agent follows on a call.
    await wait(() => thoughts.length > 0);
    expect(thoughts[0]?.system).toContain("ONE AGENT AT A TIME");
    expect(thoughts[0]?.system).toContain("## Rosa (handle: rosa)");
    // Joining again doesn't open it twice.
    await maestroJoined(d, f.owner.id, f.org.id, call.id, "pt-BR");
    await new Promise((r) => setTimeout(r, 200));
    expect(voiceOut.spoken.filter((v) => v.text.includes("Sobre o que")).length).toBe(1);
  });

  test("who is called by name answers, whatever the model would pick; the person's words are kept as their line", async () => {
    const { d, call, rosa, voiceOut, events } = await room({ heard: "Rosa, quanto vendemos?" });
    const heard = await maestroHeard(d, f.owner.id, f.org.id, call.id, {
      audio: new Uint8Array([1]),
      contentType: "audio/wav",
      durationMs: 1500,
      language: "pt-BR",
    });
    expect(heard.text).toBe("Rosa, quanto vendemos?");
    await wait(() => events.some((e) => e.type === "live.say"));
    const say = events.find((e) => e.type === "live.say") as { agentId: string };
    expect(say.agentId).toBe(rosa);
    expect(voiceOut.spoken.length).toBeGreaterThan(0);
    const lines = events.filter((e) => e.type === "live.lines").flatMap((e) => e.lines as { text: string }[]);
    expect(lines.map((l) => l.text)).toContain("Rosa, quanto vendemos?");
  });

  test("agents answer each other, but never past the limit, and never the same one twice in a row", async () => {
    let n = 0;
    const { d, call, events } = await room({
      heard: "O que vocês acham?",
      plans: () => `{"speaker":"${n++ % 2 ? "rosa" : f.agent.handle}","say":"Fala ${n}."}`,
    });
    await maestroHeard(d, f.owner.id, f.org.id, call.id, {
      audio: new Uint8Array([1]),
      contentType: "audio/wav",
      durationMs: 1000,
      language: "pt-BR",
    });
    await wait(() => events.filter((e) => e.type === "live.say").length >= MAESTRO_TURNS);
    await new Promise((r) => setTimeout(r, 400));
    const said = events.filter((e) => e.type === "live.say") as { agentId: string }[];
    expect(said.length).toBe(MAESTRO_TURNS);
    for (let i = 1; i < said.length; i++) expect(said[i]?.agentId).not.toBe(said[i - 1]?.agentId);
  });

  test("a person talking cuts a voice that plays; a cough with nobody speaking throws nothing away", async () => {
    const { d, call, events } = await room({ heard: "Me fala do prazo" });
    // Nobody speaking: nothing is cut (what is being prepared waits for the person).
    await maestroHush(d, f.owner.id, f.org.id, call.id);
    expect(events.some((e) => e.type === "live.hush")).toBe(false);
    await maestroHeard(d, f.owner.id, f.org.id, call.id, {
      audio: new Uint8Array([1]),
      contentType: "audio/wav",
      durationMs: 1000,
      language: "pt-BR",
    });
    await wait(() => events.some((e) => e.type === "live.say"));
    // A line is playing now: the person talking cuts it, for everyone.
    await maestroHush(d, f.owner.id, f.org.id, call.id);
    expect(events.find((e) => e.type === "live.hush")).toMatchObject({ roomId: call.id });
  });

  test("work asked on the call runs for real in the conversation and comes back spoken", async () => {
    let n = 0;
    const { d, call, rosa, posted, events } = await room({
      heard: "Rosa, vê quanto vendemos essa semana",
      plans: (_system, prompt) =>
        prompt.includes("came back")
          ? `{"speaker":"rosa","say":"Vendemos doze mil essa semana."}`
          : n++ === 0
            ? `{"speaker":"rosa","say":"Já vejo isso.","work":"Quanto vendemos essa semana?"}`
            : `{"speaker":"none"}`,
    });
    await maestroHeard(d, f.owner.id, f.org.id, call.id, {
      audio: new Uint8Array([1]),
      contentType: "audio/wav",
      durationMs: 1000,
      language: "pt-BR",
    });
    await wait(
      () =>
        (events.filter((e) => e.type === "live.say") as { text: string }[]).some((e) => e.text.includes("doze mil")),
      15_000,
    );
    expect(posted[0]).toEqual({
      body: "@rosa Quanto vendemos essa semana?",
      meta: { via: "call", liveRoomId: call.id },
    });
    expect(events.find((e) => e.type === "live.working")).toMatchObject({ agentId: rosa, on: true });
    const said = (events.filter((e) => e.type === "live.say") as { text: string }[]).map((e) => e.text);
    expect(said).toEqual(["Já vejo isso.", "Vendemos doze mil essa semana."]);
    expect(maestroStage(call.id)?.cost.ttsChars).toBeGreaterThan(0);
  }, 30_000);

  test("names: first name, full name or handle, accents aside, whole words", () => {
    const team = [
      { id: "n", name: "Napoleão Bonaparte", handle: "napoleao" },
      { id: "r", name: "Rosa", handle: "rosa-mkt" },
    ];
    expect(addressedIn("e aí, napoleao?", team)).toBe("n");
    expect(addressedIn("Rosa mkt, e você?", team)).toBe("r");
    expect(addressedIn("a cor de rosa ficou boa", team)).toBe("r");
    expect(addressedIn("nada a ver", team)).toBeNull();
  });
});
