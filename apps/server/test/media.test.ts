import { afterEach, expect, test } from "bun:test";
import {
  type MediaGeneration,
  type MediaModel,
  type MediaRequest,
  type ZimMedia,
  ZimMediaError,
} from "@agenteschat/adapters";
import { forgetMediaCatalog } from "@agenteschat/engine";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

// The Mídia page's routes (ADR doug-0011): the wallet and catalog through the server only, a person's generation that
// lands in the Drive, and the top-up's checkout for who manages billing.

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  forgetMediaCatalog();
  await current?.close();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);
const token = (n: number) => `ref_${String(n).padStart(48, "0")}`;

function fakeZim(balance = 100) {
  const state = {
    balance,
    generations: new Map<string, MediaGeneration>(),
    topups: [] as string[],
    uploads: [] as string[],
    requests: [] as MediaRequest[],
    quotes: [] as MediaRequest[],
  };
  const zim: ZimMedia = {
    catalog: async () => ({
      models: [
        {
          id: "gpt-image-2-5",
          kind: "image",
          label: "GPT Image 2.5",
          description: "Images.",
          qualities: ["1K"],
          defaultQuality: "1K",
          aspects: ["1:1"],
          maxRefs: 8,
          prices: { "1K": 10 },
        },
        {
          id: "seedance-2.5",
          kind: "video",
          label: "Seedance 2.5",
          description: "Video.",
          qualities: ["480p"],
          defaultQuality: "480p",
          aspects: ["16:9"],
          durations: { min: 4, max: 15, default: 5 },
          audio: "optional",
          inputs: { images: 9, videos: 3, audios: 3, firstFrame: true, lastFrame: true },
          modesByQuality: { "480p": ["text_to_video", "multi_reference", "first_n_last_frames", "video_reference"] },
          prices: { "480p": { perSecond: true, credits: 10, silentCredits: 10 } },
        },
      ] as MediaModel[],
      packs: [{ id: "topup_v3_30", brl: 30, credits: 3000 }],
    }),
    quote: async (request) => {
      state.quotes.push(request);
      return {
        model: request.model,
        kind: "video",
        quality: "480p",
        aspect: "16:9",
        seconds: 5,
        audio: true,
        credits: 777,
      };
    },
    balance: async () => ({ balance: state.balance, ledger: [] }),
    uploadRef: async (_org, _bytes, contentType) => {
      state.uploads.push(contentType);
      const kind = contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "image";
      return { ref: token(state.uploads.length), kind, ...(kind === "image" ? {} : { seconds: 4.5 }) };
    },
    async generate(_org, input) {
      if (state.balance < 10)
        throw new ZimMediaError("Saldo insuficiente.", 402, "insufficient_credits", 10, state.balance);
      state.balance -= 10;
      state.requests.push(input.request);
      const g: MediaGeneration = {
        id: crypto.randomUUID(),
        kind: "image",
        model: input.request.model,
        options: { quality: "1K", aspect: "1:1", seconds: 0, audio: false },
        prompt: input.request.prompt,
        credits: 10,
        actor: input.actor,
        status: "running",
        outputType: null,
        error: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      };
      state.generations.set(g.id, g);
      return { generation: g, balance: state.balance };
    },
    generation: async (_org, id) => ({ ...state.generations.get(id)!, status: "succeeded" }),
    generations: async () => [],
    file: async () => ({ bytes: PNG, contentType: "image/png" }),
    async topup(_org, input) {
      state.topups.push(input.returnUrl);
      return {
        topup: {
          id: "tp_0123456789abcdef",
          pack: input.pack,
          amountBrl: 30,
          credits: 3000,
          status: "pending",
          createdAt: new Date().toISOString(),
          approvedAt: null,
        },
        checkoutUrl: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=x",
      };
    },
    topupStatus: async () => ({
      topup: {
        id: "tp_0123456789abcdef",
        pack: "topup_v3_30",
        amountBrl: 30,
        credits: 3000,
        status: "approved",
        createdAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
      },
      balance: 3100,
    }),
    topups: async () => [],
    chargeCall: async () => {
      throw new Error("not in these tests");
    },
  };
  return { zim, state };
}

async function start(zim: ZimMedia | null) {
  t = await createTestServer({ zimMedia: zim, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  return { owner, base: `/api/app/organizations/${orgId}`, orgId };
}

test("without the service: no flag, and the routes answer media.off", async () => {
  const { owner, base } = await start(null);
  const config = (await (await owner("/api/app/auth-config")).json()) as { zimMedia: boolean };
  expect(config.zimMedia).toBe(false);
  const res = await owner(`${base}/media`);
  expect(res.status).toBe(404);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("media.off");
});

test("a person generates an image: charged once, saved to the Drive, listed as theirs", async () => {
  const { zim, state } = fakeZim();
  const { owner, base } = await start(zim);
  expect(((await (await owner("/api/app/auth-config")).json()) as { zimMedia: boolean }).zimMedia).toBe(true);
  const overview = (await (await owner(`${base}/media`)).json()) as {
    balance: number;
    models: unknown[];
    canTopUp: boolean;
  };
  expect(overview.balance).toBe(100);
  expect(overview.models.length).toBe(2);
  expect(overview.canTopUp).toBe(true);

  const started = await owner(`${base}/media/generations`, {
    json: { model: "gpt-image-2-5", prompt: "a lighthouse", clientId: "click-0001" },
  });
  expect(started.status).toBe(200);
  const { generation, balance } = (await started.json()) as {
    generation: { id: string; status: string };
    balance: number;
  };
  expect(balance).toBe(90);
  expect(generation.status).toBe("running");

  const done = (await (await owner(`${base}/media/generations/${generation.id}`)).json()) as {
    generation: { status: string; artifactId: string | null };
  };
  expect(done.generation.status).toBe("succeeded");
  expect(done.generation.artifactId).toBeString();
  const file = await owner(`${base}/artifacts/${done.generation.artifactId}`);
  expect(file.status).toBe(200);

  const mine = (await (await owner(`${base}/media/generations?mine=1`)).json()) as { generations: { id: string }[] };
  expect(mine.generations.map((g) => g.id)).toEqual([generation.id]);
  expect(state.balance).toBe(90);
});

test("an empty wallet answers 402 media.no_credits", async () => {
  const { zim } = fakeZim(0);
  const { owner, base } = await start(zim);
  const res = await owner(`${base}/media/generations`, {
    json: { model: "gpt-image-2-5", prompt: "x", clientId: "click-0002" },
  });
  expect(res.status).toBe(402);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("media.no_credits");
});

test("a top-up opens Mercado Pago's checkout and comes back to the Mídia page", async () => {
  const { zim, state } = fakeZim();
  const { owner, base, orgId } = await start(zim);
  const res = await owner(`${base}/media/topups`, { json: { pack: "topup_v3_30" } });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { checkoutUrl: string }).checkoutUrl).toStartWith("https://www.mercadopago.com.br/");
  expect(state.topups[0]).toEndWith(`/org/${orgId}/media`);
  const status = (await (await owner(`${base}/media/topups/tp_0123456789abcdef`)).json()) as {
    topup: { status: string };
    balance: number;
  };
  expect(status.topup.status).toBe("approved");
  expect(status.balance).toBe(3100);
});

/** A file in the form's `file` field, as the page sends it. */
const formWith = (bytes: Uint8Array, name: string, type: string) => {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return form;
};

test("reference files: a picture, a video and an audio, each by its bytes and its own size limit", async () => {
  const { zim, state } = fakeZim();
  const { owner, base } = await start(zim);
  const send = (bytes: Uint8Array, name: string, type: string) =>
    owner(`${base}/media/refs`, { method: "POST", body: formWith(bytes, name, type) });

  const image = await send(PNG, "a.png", "image/png");
  expect(image.status).toBe(200);
  expect(await image.json()).toEqual({ ref: token(1), kind: "image" });

  const video = await send(MP4, "clip.mp4", "video/mp4");
  expect(video.status).toBe(200);
  expect(await video.json()).toEqual({ ref: token(2), kind: "video", seconds: 4.5 });

  const audio = await send(WAV, "voice.wav", "audio/wav");
  expect(((await audio.json()) as { kind: string }).kind).toBe("audio");
  // An MP4 the browser calls audio is an audio.
  expect(((await (await send(MP4, "voice.m4a", "audio/mp4")).json()) as { kind: string }).kind).toBe("audio");
  expect(state.uploads).toEqual(["image/png", "video/mp4", "audio/wav", "audio/mp4"]);

  // A text file named like a video is refused by its bytes, before the service hears of it.
  const wrong = await send(new TextEncoder().encode("not a video at all, just words"), "clip.mp4", "video/mp4");
  expect(wrong.status).toBe(400);
  expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("media.ref_type");

  // A picture past 12 MB is too large even though a video may be 50.
  const big = new Uint8Array(13 * 1024 * 1024);
  big.set(PNG);
  const large = await send(big, "big.png", "image/png");
  expect(large.status).toBe(413);
  const answer = (await large.json()) as { error: { code: string; message: string } };
  expect(answer.error.code).toBe("media.ref_too_large");
  expect(answer.error.message).toContain("12 MB");
  expect(state.uploads.length).toBe(4);
});

test("a video's frames and references reach the service, and its price is the service's quote", async () => {
  const { zim, state } = fakeZim(5000);
  const { owner, base } = await start(zim);
  const files = {
    firstFrame: token(1),
    lastFrame: token(2),
    refs: [token(3)],
    videoRefs: [token(4)],
    audioRefs: [token(5)],
  };
  const quoted = await owner(`${base}/media/quote`, { json: { model: "seedance-2.5", seconds: 5, ...files } });
  expect(quoted.status).toBe(200);
  expect(await quoted.json()).toEqual({ credits: 777 });
  // Without a reference video the catalog's arithmetic answers, the service isn't asked.
  const plain = await owner(`${base}/media/quote`, { json: { model: "seedance-2.5", seconds: 5 } });
  expect(await plain.json()).toEqual({ credits: 50 });
  expect(state.quotes.length).toBe(1);

  const started = await owner(`${base}/media/generations`, {
    json: { model: "seedance-2.5", prompt: "the same dance", seconds: 5, clientId: "click-0003", ...files },
  });
  expect(started.status).toBe(200);
  expect(state.requests[0]).toMatchObject(files);

  const bad = await owner(`${base}/media/generations`, {
    json: { model: "seedance-2.5", prompt: "x", videoRefs: ["not-a-token"], clientId: "click-0004" },
  });
  expect(bad.status).toBe(400);
});

test("a Drive file as a reference: sent as the person reads it, refused to who can't read it", async () => {
  const { zim, state } = fakeZim();
  const { owner, base, orgId } = await start(zim);
  const intoDrive = async (bytes: Uint8Array, name: string, type: string, channelId?: string) => {
    const form = formWith(bytes, name, type);
    if (channelId) form.append("channelId", channelId);
    const res = await owner(`${base}/artifacts/files`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const secret = (await (
    await owner(`${base}/channels`, { json: { name: "secreto", visibility: "private" } })
  ).json()) as {
    id: string;
  };
  const picture = await intoDrive(PNG, "garrafa.png", "image/png", secret.id);
  const clip = await intoDrive(MP4, "clip.mp4", "video/mp4");
  const words = await intoDrive(new TextEncoder().encode("only words, not a picture"), "notes.txt", "text/plain");

  const use = (who: typeof owner, artifactId: string) => who(`${base}/media/refs/drive`, { json: { artifactId } });
  const own = await use(owner, picture);
  expect(own.status).toBe(200);
  expect(await own.json()).toEqual({ ref: token(1), kind: "image", name: "garrafa.png" });
  const video = await use(owner, clip);
  expect(await video.json()).toEqual({ ref: token(2), kind: "video", seconds: 4.5, name: "clip.mp4" });
  expect(state.uploads).toEqual(["image/png", "video/mp4"]);

  // A file the models don't take is refused by its bytes, before the service hears of it.
  const text = await use(owner, words);
  expect(text.status).toBe(400);
  expect(((await text.json()) as { error: { code: string } }).error.code).toBe("media.ref_type");

  // A member outside the private conversation can't read its file, so can't send it either.
  const member = await joinByInvitation(t, owner, orgId, "member@example.com");
  const refused = await use(member, picture);
  expect([403, 404]).toContain(refused.status);
  expect((await use(member, clip)).status).toBe(200);
  expect(state.uploads.length).toBe(3);
});

test("the page's mode reaches the service, in the price and the generation", async () => {
  const { zim, state } = fakeZim(5000);
  const { owner, base } = await start(zim);
  const ask = { model: "seedance-2.5", videoRefs: [token(1)], refs: [token(2)], mode: "edit" };
  expect((await owner(`${base}/media/quote`, { json: ask })).status).toBe(200);
  expect(state.quotes[0]).toMatchObject({ mode: "edit", videoRefs: [token(1)] });
  const started = await owner(`${base}/media/generations`, {
    json: { ...ask, prompt: "make it night", clientId: "click-0005" },
  });
  expect(started.status).toBe(200);
  expect(state.requests[0]).toMatchObject({ mode: "edit", videoRefs: [token(1)], refs: [token(2)] });
  // Left out, the service works it out: nothing is added.
  await owner(`${base}/media/generations`, { json: { model: "seedance-2.5", prompt: "x", clientId: "click-0006" } });
  expect(state.requests[1]?.mode).toBeUndefined();
  const unknown = await owner(`${base}/media/generations`, {
    json: { ...ask, mode: "zoom", prompt: "x", clientId: "click-0007" },
  });
  expect(unknown.status).toBe(400);
});
