import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { MediaGeneration, MediaModel, MediaRequest, ZimMedia } from "@dougbot/adapters";
import { ZimMediaError } from "@dougbot/adapters";
import { eq, schema } from "@dougbot/db";
import {
  agentMonthSpent,
  createFileArtifact,
  createMediaGenerationToolSource,
  estimateCredits,
  forgetMediaCatalog,
  GENERATE_IMAGE_TOOL,
  GENERATE_VIDEO_TOOL,
  inputsRefusal,
  listMediaGenerations,
  MEDIA_POLL_JOB,
  type MediaDeps,
  mediaPollHandler,
  mediaRefType,
  modelInputs,
  quoteCredits,
  startGeneration,
  type ToolContext,
  updateAgent,
} from "../src";
import { toolKind } from "../src/tools/run-policy";
import { type Fixture, setup } from "./fixtures";

// Media generation from the workspace's wallet (ADR doug-0011): the agents' tools, their allowance and approval
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
  {
    // Every input of the Studio: references of each kind and both frames at 480p, frames alone at 1080p.
    id: "seedance-2.5-full",
    kind: "video",
    label: "Seedance 2.5 Full",
    description: "Video with references.",
    qualities: ["480p", "1080p"],
    defaultQuality: "480p",
    aspects: ["16:9"],
    aspectsByQuality: { "1080p": ["16:9", "9:16"] },
    durations: { min: 4, max: 15, default: 5 },
    audio: "optional",
    inputs: { images: 9, videos: 3, audios: 3, firstFrame: true, lastFrame: true },
    modesByQuality: {
      "480p": ["text_to_video", "multi_reference", "first_n_last_frames", "video_reference", "edit"],
      "1080p": ["text_to_video", "first_n_last_frames"],
    },
    prices: {
      "480p": { perSecond: true, credits: 50, silentCredits: 50 },
      "1080p": { perSecond: true, credits: 300, silentCredits: 300 },
    },
  },
  {
    id: "kling-4.0",
    kind: "video",
    label: "Kling 4.0",
    description: "Video.",
    qualities: ["720p"],
    defaultQuality: "720p",
    aspects: ["16:9"],
    durations: { min: 5, max: 10, default: 5 },
    audio: "none",
    inputs: { images: 4, videos: 1, audios: 0, firstFrame: true, lastFrame: true, framesOrRefs: true },
    prices: { "720p": { perSecond: true, credits: 40, silentCredits: 40 } },
  },
  {
    id: "kling-3",
    kind: "video",
    label: "Kling 3",
    description: "Video.",
    qualities: ["720p"],
    defaultQuality: "720p",
    aspects: ["16:9"],
    durations: { min: 5, max: 10, default: 5 },
    audio: "none",
    inputs: { images: 3, videos: 0, audios: 0, firstFrame: true, lastFrame: true, firstFrameOnly: true },
    prices: { "720p": { perSecond: true, credits: 30, silentCredits: 30 } },
  },
];

/** A reference video's own seconds, as the fake service charges them on top of the model's price. */
const VIDEO_REF_CREDITS = 600;
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** The service in memory: a wallet, generations that finish when the test says, the calls it got. */
function fakeZim(balance = 10_000) {
  const generations = new Map<string, MediaGeneration>();
  const byKey = new Map<string, string>();
  const calls: { orgId: string; request: MediaRequest; key: string }[] = [];
  const uploads: string[] = [];
  const quotes: MediaRequest[] = [];
  const state = { balance, finishImagesAtOnce: true };
  const price = (r: MediaRequest) =>
    (estimateCredits(MODELS, { ...r, videoRefs: undefined }) ?? 10) + (r.videoRefs?.length ?? 0) * VIDEO_REF_CREDITS;
  const zim: ZimMedia = {
    catalog: async () => ({ models: MODELS, packs: [{ id: "topup_v3_30", brl: 30, credits: 3000 }] }),
    quote: async (r) => {
      quotes.push(r);
      return {
        model: r.model,
        kind: "image",
        quality: "2K",
        aspect: "1:1",
        seconds: 0,
        audio: false,
        credits: price(r),
      };
    },
    balance: async () => ({ balance: state.balance }),
    uploadRef: async (_org, _bytes, contentType) => {
      uploads.push(contentType);
      const kind = contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "image";
      const token = `ref_${uploads.length.toString(16).padStart(48, "0")}`;
      return { ref: token, kind, ...(kind === "image" ? {} : { seconds: 6 }) };
    },
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
    chargeCall: async () => {
      throw new Error("not in these tests");
    },
  };
  const finish = (id: string, status: "succeeded" | "failed" = "succeeded") => {
    const g = generations.get(id)!;
    generations.set(id, {
      ...g,
      status,
      ...(status === "failed" ? { error: { code: "moderation", message: "Barrado pela moderação." } } : {}),
    });
  };
  return { zim, calls, uploads, quotes, state, finish };
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

describe("what each model takes", () => {
  const model = (id: string) => MODELS.find((m) => m.id === id)!;
  test("the catalog's inputs, narrowed by the quality's modes and by a first-frame-only model", () => {
    expect(modelInputs(model("seedance-2.5-full"), "480p")).toEqual({
      images: 9,
      videos: 3,
      audios: 3,
      firstFrame: true,
      lastFrame: true,
      framesOrRefs: true,
    });
    expect(modelInputs(model("seedance-2.5-full"), "1080p")).toMatchObject({ images: 0, videos: 0, audios: 0 });
    expect(modelInputs(model("seedance-2.5-full"), "1080p").lastFrame).toBe(true);
    expect(modelInputs(model("kling-3"))).toMatchObject({ images: 0, firstFrame: true, lastFrame: false });
    // The older fields still read: Veo's opening image, GPT Image's reference count.
    expect(modelInputs(model("veo-3.1"))).toMatchObject({ firstFrame: true, lastFrame: false, images: 0 });
    expect(modelInputs(model("gpt-image-2-5")).images).toBe(8);
  });

  test("what doesn't fit is said before anything is sent", () => {
    const none = { images: 0, videos: 0, audios: 0, firstFrame: false, lastFrame: false };
    expect(inputsRefusal(model("kling-4.0"), undefined, { ...none, images: 1, firstFrame: true })).toContain(
      "references or frames, never both",
    );
    expect(inputsRefusal(model("kling-4.0"), undefined, { ...none, images: 4 })).toBeNull();
    expect(inputsRefusal(model("seedance-2.5-full"), "480p", { ...none, lastFrame: true })).toContain(
      "needs a first frame",
    );
    expect(inputsRefusal(model("seedance-2.5-full"), "1080p", { ...none, videos: 1 })).toContain(
      "takes no reference video",
    );
    expect(inputsRefusal(model("seedance-2.5-full"), "480p", { ...none, audios: 4 })).toContain("at most 3");
  });

  test("a named mode: one the quality lists, an edit on exactly one clip and no frames", () => {
    const none = { images: 0, videos: 0, audios: 0, firstFrame: false, lastFrame: false };
    const full = model("seedance-2.5-full");
    expect(inputsRefusal(full, "480p", { ...none, videos: 1, images: 2 }, "edit")).toBeNull();
    expect(inputsRefusal(full, "1080p", { ...none, videos: 1 }, "edit")).toContain("has no edit mode");
    expect(inputsRefusal(full, "480p", { ...none, videos: 2 }, "edit")).toContain("exactly one video");
    expect(inputsRefusal(full, "480p", none, "edit")).toContain("exactly one video");
    expect(inputsRefusal(full, "480p", { ...none, videos: 1, firstFrame: true }, "edit")).toContain(
      "no opening or closing image",
    );
    expect(inputsRefusal(full, "480p", { ...none, images: 1 }, "text_to_video")).toContain("takes no files");
    // A model that lists no modes takes the name as it is: the service decides.
    expect(inputsRefusal(model("kling-4.0"), undefined, { ...none, images: 1 }, "multi_reference")).toBeNull();
  });

  test("a reference file's kind comes from its bytes", () => {
    expect(mediaRefType(PNG)?.contentType).toBe("image/png");
    expect(mediaRefType(MP4)).toEqual({ kind: "video", contentType: "video/mp4" });
    expect(mediaRefType(MP4, "audio/mp4")).toEqual({ kind: "audio", contentType: "audio/mp4" });
    const mov = MP4.slice();
    mov.set([0x71, 0x74, 0x20, 0x20], 8);
    expect(mediaRefType(mov)?.contentType).toBe("video/quicktime");
    expect(mediaRefType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))?.contentType).toBe(
      "video/webm",
    );
    expect(mediaRefType(WAV)).toEqual({ kind: "audio", contentType: "audio/wav" });
    expect(mediaRefType(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]))?.contentType).toBe("audio/mpeg");
    expect(mediaRefType(new TextEncoder().encode("just some text here"))).toBeNull();
  });

  test("a reference video's price is the service's quote", async () => {
    const fake = fakeZim();
    expect(estimateCredits(MODELS, { model: "seedance-2.5-full", seconds: 5, videoRefs: ["ref_x"] })).toBeNull();
    const request = { model: "seedance-2.5-full", prompt: "x", seconds: 5, videoRefs: ["ref_x"] };
    expect(await quoteCredits(fake.zim, MODELS, request)).toBe(250 + VIDEO_REF_CREDITS);
    expect(await quoteCredits(fake.zim, MODELS, { model: "seedance-2.5-full", prompt: "x", seconds: 5 })).toBe(250);
    expect(fake.quotes.length).toBe(1);
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

describe("the video tool's files", () => {
  const driveFile = async (runId: string, name: string, bytes: Uint8Array, contentType: string) =>
    (
      await createFileArtifact(
        f.artifactDeps,
        { type: "agent", agentId: f.agent.id, channelId: f.general.id, threadId: null, runId },
        f.org.id,
        { title: name, name, contentType, bytes },
      )
    ).id;

  test("the description says what each model takes, by quality where that changes", async () => {
    const { zim } = fakeZim();
    const video = await tool(zim, GENERATE_VIDEO_TOOL);
    expect(video.description).toContain("closing_image_id");
    expect(video.description).toContain("Kling 4.0): Video.");
    expect(video.description).toContain("(frames or references, never both)");
    expect(video.description).toContain("at 1080p opening_image_id and closing_image_id");
    expect(video.description).toContain("up to 3 video_reference_ids");
    expect(video.description).toContain("1080p: 16:9 9:16");
    const props = (video.inputSchema as { properties: Record<string, { maxItems?: number }> }).properties;
    expect(props.video_reference_ids?.maxItems).toBe(3);
    expect(props.reference_ids?.maxItems).toBe(9);
  });

  test("a reference video and an audio from the Drive go to the service, priced by its quote", async () => {
    const fake = fakeZim();
    const c = ctx();
    const clip = await driveFile(c.runId, "clip.mp4", MP4, "video/mp4");
    const voice = await driveFile(c.runId, "voice.wav", WAV, "audio/wav");
    const video = await tool(fake.zim, GENERATE_VIDEO_TOOL, c);
    const input = {
      model: "seedance-2.5-full",
      prompt: "the same dance on a beach",
      seconds: 5,
      video_reference_ids: [clip],
      audio_reference_ids: [voice],
    };
    // Its price isn't known before the service measures the clip: a person approves it first.
    expect(video.asksNobody?.(input)).toBe(false);
    expect(video.describe?.(input).title).toContain("com vídeo de referência");
    const out = await video.execute(input, c);
    expect(out.isError).toBeFalsy();
    expect(fake.uploads).toEqual(["video/mp4", "audio/wav"]);
    const sent = fake.calls[0]!.request;
    expect(sent.videoRefs?.length).toBe(1);
    expect(sent.audioRefs?.length).toBe(1);
    expect(fake.quotes.length).toBe(1);
    expect(out.content).toContain(`${250 + VIDEO_REF_CREDITS} credits`);
  });

  test("opening and closing frames go to the service; frames with references are refused before any upload", async () => {
    const fake = fakeZim();
    const c = ctx();
    const first = await driveFile(c.runId, "first.png", PNG, "image/png");
    const last = await driveFile(c.runId, "last.png", PNG, "image/png");
    const clip = await driveFile(c.runId, "clip.mp4", MP4, "video/mp4");
    const video = await tool(fake.zim, GENERATE_VIDEO_TOOL, c);
    const both = await video.execute(
      { model: "seedance-2.5-full", prompt: "x", seconds: 5, opening_image_id: first, video_reference_ids: [clip] },
      c,
    );
    expect(both.isError).toBe(true);
    expect(both.content).toContain("never both");
    expect(fake.uploads).toEqual([]);
    const out = await video.execute(
      { model: "seedance-2.5-full", prompt: "x", seconds: 5, opening_image_id: first, closing_image_id: last },
      c,
    );
    expect(out.isError).toBeFalsy();
    expect(fake.uploads).toEqual(["image/png", "image/png"]);
    const sent = fake.calls[0]!.request;
    expect(sent.firstFrame).toBeString();
    expect(sent.lastFrame).toBeString();
  });

  test("a quote past the allowance stops before the generation", async () => {
    const fake = fakeZim();
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaMonthlyCredits: 700 });
    const c = ctx();
    const clip = await driveFile(c.runId, "clip.mp4", MP4, "video/mp4");
    const out = await (await tool(fake.zim, GENERATE_VIDEO_TOOL, c)).execute(
      { model: "seedance-2.5-full", prompt: "x", seconds: 5, video_reference_ids: [clip] },
      c,
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain("monthly media allowance");
    expect(fake.calls.length).toBe(0);
    await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { mediaMonthlyCredits: 5000 });
  });

  test("an edit names its mode: the clip goes to the service with it, and a model without it is refused", async () => {
    const fake = fakeZim();
    const c = ctx();
    const clip = await driveFile(c.runId, "clip.mp4", MP4, "video/mp4");
    const video = await tool(fake.zim, GENERATE_VIDEO_TOOL, c);
    expect(video.description).toContain("mode edit with one video_reference_ids");
    const props = (video.inputSchema as { properties: Record<string, { enum?: string[]; description?: string }> })
      .properties;
    expect(props.mode?.enum).toContain("extend");
    expect(props.aspect?.description).toContain("16:9 when left out");
    const out = await video.execute(
      {
        model: "seedance-2.5-full",
        prompt: "make it night",
        quality: "480p",
        mode: "edit",
        video_reference_ids: [clip],
      },
      c,
    );
    expect(out.isError).toBeFalsy();
    expect(fake.calls[0]!.request).toMatchObject({ mode: "edit", videoRefs: [expect.any(String)] });
    const refused = await video.execute(
      { model: "seedance-2.5-full", prompt: "x", quality: "1080p", mode: "edit", video_reference_ids: [clip] },
      ctx({ runId: c.runId }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain("has no edit mode");
    expect(fake.calls.length).toBe(1);
  });

  test("files the model doesn't take, or of the wrong kind, are refused before anything is paid", async () => {
    const fake = fakeZim();
    const c = ctx();
    const picture = await driveFile(c.runId, "a.png", PNG, "image/png");
    const video = await tool(fake.zim, GENERATE_VIDEO_TOOL, c);
    const both = await video.execute(
      { model: "kling-4.0", prompt: "x", opening_image_id: picture, reference_ids: [picture] },
      c,
    );
    expect(both.isError).toBe(true);
    expect(both.content).toContain("never both");
    const wrong = await video.execute(
      { model: "seedance-2.5-full", prompt: "x", video_reference_ids: [picture] },
      ctx({ runId: c.runId }),
    );
    expect(wrong.isError).toBe(true);
    expect(wrong.content).toContain("isn't an MP4, MOV or WebM video");
    expect(fake.uploads.length).toBe(0);
    expect(fake.calls.length).toBe(0);
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
