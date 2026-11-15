import { createAnthropicProvider } from "./anthropic";
import { createOpenRouterProvider } from "./openrouter";
import { type ModelProvider, type ModelResult, ProviderError } from "./types";

/** OpenDesign Go's inference host (ADR 0186); its control host, amr-api, is never called. */
export const OPENDESIGN_API = "https://amr-link.open-design.ai";

const PREFIX = "opendesign:";

export const isOpenDesignModel = (id: string) => id.startsWith(PREFIX) && id.length > PREFIX.length;

export const openDesignModelOf = (id: string) => (isOpenDesignModel(id) ? id.slice(PREFIX.length) : null);

// GLM-5.3 Flash thinks only on Anthropic Messages there; every other model thinks on Chat Completions (ADR 0186 §2).
const onMessages = (model: string) => model === "glm-5.3-flash";

/** OpenDesign Go's models (ADR 0186); the full `opendesign:` id comes back, so the catalog prices the call. */
export function createOpenDesignProvider(options: { fetch?: typeof fetch; maxRetries?: number } = {}): ModelProvider {
  // The Anthropic SDK adds `/v1/messages`, the OpenAI one `/chat/completions`.
  const messages = createAnthropicProvider({
    id: "opendesign",
    baseURL: OPENDESIGN_API,
    compat: { toolChoiceAny: true },
    fetch: options.fetch,
    maxRetries: options.maxRetries,
  });
  const chat = createOpenRouterProvider({
    compatible: { id: "opendesign", baseURL: `${OPENDESIGN_API}/v1` },
    fetch: options.fetch,
    maxRetries: options.maxRetries,
  });
  return {
    id: "opendesign",
    async stream(request, streamOptions): Promise<ModelResult> {
      const model = openDesignModelOf(request.model);
      if (!model) throw new ProviderError(`${request.model} isn't one of OpenDesign's models`, false);
      const inner = onMessages(model) ? messages : chat;
      const { costNanoUsd: _reported, ...result } = await inner.stream({ ...request, model }, streamOptions);
      return { ...result, model: request.model };
    },
  };
}
