import { afterEach, expect, test } from "bun:test";
import { type MediaGeneration, type ZimMedia, ZimMediaError } from "@agenteschat/adapters";
import { forgetMediaCatalog } from "@agenteschat/engine";
import { browser, createTestServer, seedOrg, signUp, type TestServer } from "./harness";

// The Mídia page's routes (ADR doug-0010): the wallet and catalog through the server only, a person's generation that
// lands in the Drive, and the top-up's checkout for who manages billing.

let t: TestServer;
afterEach(async () => {
  const current = t;
  t = undefined as unknown as TestServer;
  forgetMediaCatalog();
  await current?.close();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function fakeZim(balance = 100) {
  const state = { balance, generations: new Map<string, MediaGeneration>(), topups: [] as string[] };
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
      ],
      packs: [{ id: "topup_v3_30", brl: 30, credits: 3000 }],
    }),
    quote: async () => {
      throw new Error("unused");
    },
    balance: async () => ({ balance: state.balance, ledger: [] }),
    uploadRef: async () => `ref_${"b".repeat(48)}`,
    async generate(_org, input) {
      if (state.balance < 10)
        throw new ZimMediaError("Saldo insuficiente.", 402, "insufficient_credits", 10, state.balance);
      state.balance -= 10;
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
  expect(overview.models.length).toBe(1);
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
