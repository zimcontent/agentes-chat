import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { MediaGeneration, MediaModel, MediaRequest, ZimMedia } from "@agenteschat/adapters";
import { ZimMediaError } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  agentMonthSpent,
  createMediaGenerationToolSource,
  estimateCredits,
  forgetMediaCatalog,
  GENERATE_IMAGE_TOOL,
  GENERATE_VIDEO_TOOL,
  listMediaGenerations,
  MEDIA_POLL_JOB,
  type MediaDeps,
  mediaPollHandler,
  startGeneration,
  type ToolContext,
  updateAgent,
} from "../src";
import { toolKind } from "../src/tools/run-policy";
import { type Fixture, setup } from "./fixtures";

// Media generation from the workspace's wallet (ADR doug-0010): the agents' tools, their allowance and approval
// threshold, and a finished file that lands in the Drive once.

const MODELS: MediaModel[] = [
  {
    id: "gpt-image-2-5",
    kind: "image",
    label: "GPT Image 2.5",
    description: "Images.",
    qualities: ["1K", "2K"],
    defaultQuality: "2K",
    aspects: ["1:1", "16:9"],
    maxRefs: 8,
    prices: { "1K": 10, "2K": 15 },
  },
  {
    id: "seedance-2.5",
    kind: "video",
    label: "Seedance 2.5",
    description: "Video.",
    qualities: ["480p", "720p"],
    defaultQuality: "720p",
    aspects: ["16:9", "9:16"],
    durations: { min: 4, max: 15, default: 5 },
    audio: "optional",
    firstFrame: true,
    prices: {
      "480p": { perSecond: true, credits: 94, silentCredits: 94 },
      "720p": { perSecond: true, credits: 211, silentCredits: 211 },
    },
  },
  {
    id: "veo-3.1",
    kind: "video",
    label: "Veo 3.1",
    description: "Video.",
    qualities: ["720p"],
    defaultQuality: "720p",
    aspects: ["16:9"],
    durations: { min: 8, max: 8, fixed: [8], default: 8 },
    audio: "optional",
    firstFrame: true,
    prices: { "720p": { perSecond: false, credits: 64, silentCredits: 64 } },
  },
];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** The service in memory: a wallet, generations that finish when the test says, the calls it got. */
function fakeZim(balance = 10_000) {
  const generations = new Map<string, MediaGeneration>();
  const byKey = new Map<string, string>();
  const calls: { orgId: string; request: MediaRequest; key: string }[] = [];
  const state = { balance, finishImagesAtOnce: true };
  const price = (r: MediaRequest) => estimateCredits(MODELS, r) ?? 10;
  const zim: ZimMedia = {
    catalog: async () => ({ models: MODELS, packs: [{ id: "topup_v3_30", brl: 30, credits: 3000 }] }),
    quote: async (r) => ({
      model: r.model,
      kind: "image",
      quality: "2K",
      aspect: "1:1",
      seconds: 0,
      audio: false,
      credits: price(r),
    }),
    balance: async () => ({ balance: state.balance }),
    uploadRef: async () => `ref_${"a".repeat(48)}`,
    async generate(orgId, input) {
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { generation: generations.get(existing)!, balance: state.balance };
      const credits = price(input.request);
      if (credits > state.balance)
        throw new ZimMediaError("Saldo insuficiente.", 402, "insufficient_credits", credits, state.balance);
      state.balance -= credits;
      calls.push({ orgId, request: input.request, key: input.idempotencyKey });
      const model = MODELS.find((m) => m.id === input.request.model)!;
      const g: MediaGeneration = {
        id: crypto.randomUUID(),
        kind: model.kind,
        model: model.id,
        options: {
          quality: input.request.quality ?? model.defaultQuality,
          aspect: "16:9",
          seconds: input.request.seconds ?? 0,
          audio: true,
        },
        prompt: input.request.prompt,
        credits,
        actor: input.actor,
        status: model.kind === "image" && state.finishImagesAtOnce ? "succeeded" : "running",
        outputType: null,
        error: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      };
      generations.set(g.id, g);
      byKey.set(input.idempotencyKey, g.id);
      return { generation: g, balance: state.balance };
    },
    generation: async (_org, id) => generations.get(id)!,
    generations: async () => [...generations.values()],
    file: async (_org, id) => ({
      bytes: generations.get(id)!.kind === "video" ? new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]) : PNG,
      contentType: generations.get(id)!.kind === "video" ? "video/mp4" : "image/png",
    }),
    topup: async () => {
      throw new Error("not in these tests");
    },
    topupStatus: async () => {
      throw new Error("not in these tests");
    },
    topups: async () => [],
  };
  const finish = (id: string, status: "succeeded" | "failed" = "succeeded") => {
    const g = generations.get(id)!;
    generations.set(id, {
      ...g,
      status,
      ...(status === "failed" ? { error: { code: "moderation", message: "Barrado pela moderação." } } : {}),
    });
  };
  return { zim, calls, state, finish };
}

let f: Fixture;
beforeAll(async () => {
  f = await setup();
});
afterAll(async () => {
  await f.close();
});
beforeEach(() => forgetMediaCatalog());

const ctx = (over: Partial<ToolContext> = {}): ToolContext =>
  ({
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: crypto.randomUUID(),
    channelId: f.general.id,
    threadRootId: "root",
    triggerMessageId: "root",
    toolUseId: `tool-${crypto.randomUUID()}`,
    ...over,
  }) as ToolContext;

const deps = (zim: ZimMedia | null): MediaDeps => ({ db: f.db, zimMedia: zim, artifacts: f.artifactDeps });
const tool = async (zim: ZimMedia, name: string, c = ctx()) => {
  const tools = await createMediaGenerationToolSource(deps(zim)).tools(c);
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`${name} isn't listed`);
  return found;
};

describe("price estimate", () => {
  test("the service's arithmetic: per second, per task, per image", () => {
    expect(estimateCredits(MODELS, { model: "seedance-2.5", quality: "720p", seconds: 5 })).toBe(1055);
    expect(estimateCredits(MODELS, { model: "veo-3.1", seconds: 4 })).toBe(64);
    expect(estimateCredits(MODELS, { model: "gpt-image-2-5" })).toBe(15);
    expect(estimateCredits(MODELS, { model: "nope" })).toBeNull();
  });
});

describe("the agents' tools", () => {
  test("listed only with the service and an allowance; internal work for routines", async () => {
    const { zim } = fakeZim();
    expect(await createMediaGenerationToolSource(deps(null)).tools(ctx())).toEqual([]);
    const names = (await createMediaGenerationToolSource(deps(zim)).tools(ctx())).map((t) => t.name);
    expect(names).toEqual([GENERATE_IMAGE_TOOL, GENERATE_VIDEO_TOOL]);
    const image = await tool(zim, GENERATE_IMAGE_TOOL);
    expect(toolKind(image)).toEqual({ kind: "internal", area: "media" });
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaMonthlyCredits: 0 });
    expect(await createMediaGenerationToolSource(deps(zim)).tools(ctx())).toEqual([]);
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaMonthlyCredits: 5000 });
  });

  test("a cheap generation asks nobody; one above the threshold asks first", async () => {
    const { zim } = fakeZim();
    const video = await tool(zim, GENERATE_VIDEO_TOOL);
    expect(video.sensitive).toBe(true);
    expect(video.asksNobody?.({ model: "seedance-2.5", prompt: "x", quality: "480p", seconds: 5 })).toBe(true);
    expect(video.asksNobody?.({ model: "seedance-2.5", prompt: "x", quality: "720p", seconds: 5 })).toBe(false);
    expect(video.describe?.({ model: "seedance-2.5", prompt: "um barco", seconds: 5 }).title).toContain(
      "1.055 créditos",
    );
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaAskAbove: null });
    expect((await tool(zim, GENERATE_VIDEO_TOOL)).sensitive).toBe(false);
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaAskAbove: 500 });
  });

  test("an image comes back saved in the Drive and attached to the reply; a retried call doesn't pay twice", async () => {
    const fake = fakeZim();
    const c = ctx();
    const image = await tool(fake.zim, GENERATE_IMAGE_TOOL, c);
    const out = await image.execute({ model: "gpt-image-2-5", prompt: "a lighthouse at dusk" }, c);
    expect(out.isError).toBeFalsy();
    const artifact = out.data?.artifact as { id: string };
    expect(artifact.id).toBeString();
    const [file] = await f.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, artifact.id));
    expect(file?.title).toBe("Imagem: a lighthouse at dusk");
    await image.execute({ model: "gpt-image-2-5", prompt: "a lighthouse at dusk" }, c);
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]!.key).toBe(`run:${c.runId}:${c.toolUseId}`);
    expect(fake.state.balance).toBe(10_000 - 15);
  });

  test("a video returns at once and the job posts it in the conversation when it's ready", async () => {
    const fake = fakeZim();
    const c = ctx();
    const video = await tool(fake.zim, GENERATE_VIDEO_TOOL, c);
    const out = await video.execute({ model: "seedance-2.5", prompt: "a paper boat", quality: "480p", seconds: 4 }, c);
    expect(out.content).toContain("posted in this conversation");
    const [row] = await f.db.select().from(schema.mediaGenerations).where(eq(schema.mediaGenerations.runId, c.runId));
    expect(row?.status).toBe("running");
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, MEDIA_POLL_JOB));
    expect(jobs.some((j) => (j.payload as { generationId: string }).generationId === row!.id)).toBe(true);

    const poll = mediaPollHandler(deps(fake.zim));
    const job = { orgId: f.org.id, payload: { generationId: row!.id } } as never;
    await poll(job, {} as never);
    expect(
      (await f.db.select().from(schema.mediaGenerations).where(eq(schema.mediaGenerations.id, row!.id)))[0]?.status,
    ).toBe("running");

    fake.finish(row!.id);
    await poll(job, {} as never);
    await poll(job, {} as never);
    const [done] = await f.db.select().from(schema.mediaGenerations).where(eq(schema.mediaGenerations.id, row!.id));
    expect(done?.status).toBe("succeeded");
    const posted = await f.db.select().from(schema.messages).where(eq(schema.messages.authorAgentId, f.agent.id));
    const withFile = posted.filter((m) => JSON.stringify(m.meta).includes(done!.artifactId!));
    expect(withFile.length).toBe(1);
    expect(withFile[0]!.body).toContain("Vídeo pronto");
  });

  test("a failed video says so where the agent asked, and stops counting against its allowance", async () => {
    const fake = fakeZim();
    const c = ctx();
    const video = await tool(fake.zim, GENERATE_VIDEO_TOOL, c);
    await video.execute({ model: "veo-3.1", prompt: "a storm" }, c);
    const [row] = await f.db.select().from(schema.mediaGenerations).where(eq(schema.mediaGenerations.runId, c.runId));
    const before = await agentMonthSpent(f.db, f.org.id, f.agent.id);
    fake.finish(row!.id, "failed");
    await mediaPollHandler(deps(fake.zim))(
      { orgId: f.org.id, payload: { generationId: row!.id } } as never,
      {} as never,
    );
    expect(await agentMonthSpent(f.db, f.org.id, f.agent.id)).toBe(before - 64);
    const posted = await f.db.select().from(schema.messages).where(eq(schema.messages.authorAgentId, f.agent.id));
    expect(posted.some((m) => m.body.includes("Barrado pela moderação") && m.body.includes("créditos voltaram"))).toBe(
      true,
    );
  });

  test("past the monthly allowance nothing is asked of the service", async () => {
    const fake = fakeZim();
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaMonthlyCredits: 100 });
    const c = ctx();
    const video = await tool(fake.zim, GENERATE_VIDEO_TOOL, c);
    const out = await video.execute({ model: "seedance-2.5", prompt: "x", quality: "480p", seconds: 4 }, c);
    expect(out.isError).toBe(true);
    expect(out.content).toContain("monthly media allowance");
    expect(fake.calls.length).toBe(0);
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaMonthlyCredits: 5000 });
  });

  test("an empty wallet tells the agent who can top it up", async () => {
    const fake = fakeZim(5);
    const c = ctx();
    const out = await (await tool(fake.zim, GENERATE_IMAGE_TOOL, c)).execute(
      { model: "gpt-image-2-5", prompt: "x" },
      c,
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain("doesn't have enough credits");
  });
});

describe("people's generations", () => {
  test("a person's image lands in their Drive and in the list", async () => {
    const fake = fakeZim();
    fake.state.finishImagesAtOnce = false;
    const started = await startGeneration(
      deps(fake.zim),
      f.org.id,
      { type: "person", userId: f.owner.id },
      {
        idempotencyKey: "person:click-1",
        request: { model: "gpt-image-2-5", prompt: "a red chair" },
      },
    );
    fake.finish(started.row.id);
    await mediaPollHandler(deps(fake.zim))(
      { orgId: f.org.id, payload: { generationId: started.row.id } } as never,
      {} as never,
    );
    const mine = await listMediaGenerations(f.db, f.org.id, { userId: f.owner.id });
    const it = mine.find((g) => g.id === started.row.id);
    expect(it?.status).toBe("succeeded");
    expect(it?.artifactId).toBeString();
    // A person's file posts no message.
    const posted = await f.db.select().from(schema.messages).where(eq(schema.messages.authorAgentId, f.agent.id));
    expect(posted.some((m) => JSON.stringify(m.meta).includes(it!.artifactId!))).toBe(false);
  });
});
