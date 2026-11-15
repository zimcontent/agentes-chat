import { describe, expect, test } from "bun:test";
import {
  costNanoUsd,
  createModelProviders,
  createOpenDesignProvider,
  isOpenRouterModel,
  MODEL_CATALOG,
  modelProvider,
  OPENDESIGN_API,
  openDesignModelOf,
  ProviderError,
} from "../src";
import { scripted, sse } from "./scripted";

const chat = (chunks: Record<string, unknown>[]) =>
  `${chunks.map((c) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, ...c })}\n\n`).join("")}data: [DONE]\n\n`;

const textChat = () =>
  chat([
    { model: "x", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 10, cost: 9 } },
  ]);

const message = (events: Record<string, unknown>[]) =>
  sse([
    {
      type: "message_start",
      message: {
        id: "m",
        type: "message",
        role: "assistant",
        model: "glm-5.3-flash",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 50, output_tokens: 1 },
      },
    },
    ...events,
    { type: "message_stop" },
  ]);

const textMessage = () =>
  message([
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "oi" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
  ]);

const KEY = ["od", "k".repeat(24)].join("_");
const ask = (model: string) => ({
  model,
  system: "s",
  messages: [{ role: "user" as const, content: "hi" }],
  maxTokens: 100,
});

const OURS = Object.keys(MODEL_CATALOG).filter((id) => id.startsWith("opendesign:"));

describe("OpenDesign's ids", () => {
  test("its own id after the prefix; never read as OpenRouter's", () => {
    expect(openDesignModelOf("opendesign:deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
    expect(openDesignModelOf("opendesign:")).toBeNull();
    expect(openDesignModelOf("deepseek-v4.1-flash")).toBeNull();
    expect(isOpenRouterModel("opendesign:deepseek-v4.1-flash")).toBe(false);
    expect(modelProvider("opendesign:glm-5.3-flash")).toBe("opendesign");
  });

  test("the server registers its adapter", () => {
    expect(createModelProviders().opendesign?.id).toBe("opendesign");
  });

  test("the catalog's rows: no vision model, Hy4 left out (no context window published)", () => {
    expect(OURS.sort()).toEqual([
      "opendesign:claude-haiku-5.5",
      "opendesign:deepseek-v4-flash",
      "opendesign:deepseek-v4-pro",
      "opendesign:deepseek-v4.1-flash",
      "opendesign:deepseek-v4.1-flash-eco",
      "opendesign:glm-5.3-flash",
      "opendesign:glm-5.3-flashx",
      "opendesign:gpt-6-luna",
      "opendesign:kimi-k2.7-code",
      "opendesign:mimo-v2.6-flash",
      "opendesign:mimo-v2.6-pro",
      "opendesign:minimax-m3.1-flash",
    ]);
  });
});

describe("OpenDesign's prices", () => {
  test("a model that is a maker's row costs what that row costs, long prompts too", () => {
    const same = {
      "claude-haiku-5.5": "claude-haiku-5-5",
      "gpt-6-luna": "gpt-6-luna",
      "deepseek-v4-pro": "deepseek-v4-pro",
      "deepseek-v4.1-flash": "deepseek-flash",
      "deepseek-v4.1-flash-eco": "deepseek-flash",
      "glm-5.3-flash": "glm-5.3-flash",
      "minimax-m3.1-flash": "MiniMax-M3.1-Flash",
    };
    for (const [own, maker] of Object.entries(same)) {
      for (const inputTokens of [50_000, 300_000]) {
        const usage = { inputTokens, outputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 500 };
        expect(costNanoUsd(`opendesign:${own}`, usage)).toBe(costNanoUsd(maker, usage));
      }
    }
  });
});

describe("calls (scripted transport)", () => {
  test("an open model: Chat Completions at amr-link's /v1, its own id sent, usage asked, its cost ignored", async () => {
    const { fetcher, requests } = scripted(textChat());
    const model = "opendesign:deepseek-v4.1-flash";
    const result = await createOpenDesignProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      { ...ask(model), effort: "high" },
      { apiKey: KEY, onDelta: () => {} },
    );
    const req = requests[0];
    expect(req?.url).toBe("https://amr-link.open-design.ai/v1/chat/completions");
    expect(req?.url).toBe(`${OPENDESIGN_API}/v1/chat/completions`);
    expect(req?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(req?.headers.get("http-referer")).toBeNull();
    expect(req?.body).toMatchObject({ model: "deepseek-v4.1-flash", stream_options: { include_usage: true } });
    expect(req?.body.provider).toBeUndefined();
    expect(result.model).toBe(model);
    expect(result.costNanoUsd).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(costNanoUsd(result.model, result.usage)).toBe(1000 * 300 + 10 * 1200);
  });

  test("GLM-5.3 Flash: Anthropic Messages at amr-link's /v1/messages with its key, its own id sent", async () => {
    const { fetcher, requests } = scripted(textMessage());
    const result = await createOpenDesignProvider({ fetch: fetcher, maxRetries: 0 }).stream(
      ask("opendesign:glm-5.3-flash"),
      {
        apiKey: KEY,
        onDelta: () => {},
      },
    );
    const req = requests[0];
    expect(new URL(req?.url ?? "").origin + new URL(req?.url ?? "").pathname).toBe(
      "https://amr-link.open-design.ai/v1/messages",
    );
    expect(req?.headers.get("x-api-key")).toBe(KEY);
    expect(req?.body.model).toBe("glm-5.3-flash");
    for (const field of ["cache_control", "fallbacks"]) expect(req?.body).not.toHaveProperty(field);
    expect(result.model).toBe("opendesign:glm-5.3-flash");
    expect(result.content).toEqual([{ type: "text", text: "oi" }]);
  });

  test("GLM-5.3 Flash is the only model sent to Messages; Claude Haiku and DeepSeek V4 Pro stay on Chat Completions", async () => {
    for (const id of OURS) {
      const onMessages = id === "opendesign:glm-5.3-flash";
      const { fetcher, requests } = scripted(onMessages ? textMessage() : textChat());
      await createOpenDesignProvider({ fetch: fetcher, maxRetries: 0 }).stream(ask(id), {
        apiKey: KEY,
        onDelta: () => {},
      });
      const path = new URL(requests[0]?.url ?? "").pathname;
      expect({ id, path }).toEqual({ id, path: onMessages ? "/v1/messages" : "/v1/chat/completions" });
      expect(requests[0]?.body.model).toBe(id.slice("opendesign:".length));
    }
  });

  test("a refusal keeps OpenDesign's words; an id that isn't its own fails before any call", async () => {
    const refused = scripted(
      JSON.stringify({ error: { message: "Model not in plan.", type: "invalid_request_error" } }),
      400,
    );
    const error = await createOpenDesignProvider({ fetch: refused.fetcher, maxRetries: 0 })
      .stream(ask("opendesign:x"), { apiKey: KEY, onDelta() {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain("Model not in plan");

    const none = scripted("");
    const wrong = await createOpenDesignProvider({ fetch: none.fetcher, maxRetries: 0 })
      .stream(ask("glm-5.3-flash"), { apiKey: KEY, onDelta() {} })
      .catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(ProviderError);
    expect(none.requests).toHaveLength(0);
  });
});
