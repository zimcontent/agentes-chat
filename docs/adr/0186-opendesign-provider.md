# 0186. OpenDesign Go: one key for many makers' models, GLM-5.3 Flash on Messages and the rest on Chat Completions

- Status: Proposed
- Date: 2026-11-15
- Extends 0007, 0018 and 0174.
- Code: `packages/providers/src/opendesign.ts` (`createOpenDesignProvider`, `openDesignModelOf`, `OPENDESIGN_API`), `packages/providers/src/catalog.ts` (`opendesign` in `PROVIDERS`, its catalog rows), `packages/providers/src/index.ts`, `packages/engine/src/router.ts` (`SMALL_MODEL_ORDER`), `packages/client/src/lib/providers.ts`, `packages/ui/src/brand/marks.ts`, `packages/i18n`

## Context

OpenDesign Go sells a subscription whose usage reaches many makers' models through one key: Claude, GPT, DeepSeek, GLM, Kimi, MiMo, MiniMax and others. People who pay for it want their agents to think with it, as with Command Code (ADR 0174).

Its public plugin (magpie-community/plugins, `packages/opendesign`, read 2026-11-15) names one inference host, `https://amr-link.open-design.ai/v1`, with Chat Completions at `/v1/chat/completions` and Anthropic Messages at `/v1/messages`. Its other host, `amr-api.open-design.ai`, is the account's control plane, not for inference. A published measurement (magpie plugins #141) shows Chat Completions carrying thinking for most models, while GLM-5.3 Flash thinks only on Anthropic Messages.

A workspace's own endpoint (ADR 0146) speaks one API and its models are never Automático's, the router's or the summaries' picks, for the same reasons as in ADR 0174.

Its model page (go.open-design.ai/models, read 2026-11-15) lists each model's price in dollars per million tokens and its API id, but no context windows. Its plan pages speak in credits; a credit multiplier is never a price here.

## Decision

1. **A catalog provider, `opendesign`,** labelled OpenDesign, with its own adapter (protocol `opendesign`). A model's id is `opendesign:<its own id>` (`opendesign:deepseek-v4.1-flash`): OpenDesign's ids for Claude and GPT read like the makers' own, and the prefix keeps them apart from the rows the catalog already has under those makers' keys. The prefix is stripped only on the wire.
2. **One adapter, two routes, no new client.** `createOpenDesignProvider` sends `glm-5.3-flash` to Anthropic's adapter in its compatible mode (base `https://amr-link.open-design.ai`, to which the SDK adds `/v1/messages`; `x-api-key`; `tool_choice: any`, so structured output is a forced tool) and every other model, Claude Haiku 5.5 and DeepSeek V4 Pro included, to the Chat Completions adapter OpenRouter uses, in its compatible mode (base `https://amr-link.open-design.ai/v1`, to which the SDK adds `/chat/completions`; no attribution, routing or reasoning fields; `stream_options.include_usage`). Its own id is sent; the full `opendesign:` id comes back, so the catalog prices the call. A cost field in the answer is ignored. No Responses client is built.
3. **Twelve models in the catalog, all choosable only with its key (`pick: false`).** A model that is a row the catalog already has keeps that row's prices, long-context prices and off-peak prices, named in a comment: Claude Haiku 5.5 (`claude-haiku-5-5`), GPT-6 Luna (`gpt-6-luna`), DeepSeek V4 Pro (`deepseek-v4-pro`), GLM-5.3 Flash (`glm-5.3-flash`), MiniMax M3.1 Flash (`MiniMax-M3.1-Flash`), and DeepSeek V4.1 Flash and its Eco variant (`deepseek-flash`, which is V4.1 Flash). The rest are at the dollar prices OpenDesign's model page lists: DeepSeek V4 Flash, GLM-5.3 FlashX, Kimi K2.7 Code, MiMo V2.6 Flash and Pro. Where it lists no cache write, the input's rate counts; a price below a thousandth of a dollar per million tokens rounds up. Context windows, output caps and efforts (low, high and max; none listed for GPT-6 Luna) are OpenDesign's own. Automático's tiers are DeepSeek V4.1 Flash (small, recommended, the system tasks' cheap model and the routing pick), MiMo V2.6 Pro (medium) and DeepSeek V4 Pro (large, the strongest model priced here, ahead of Claude Haiku 5.5). The routing pick's thinking can't be turned off on Chat Completions in compatible mode, which sends no reasoning field, so its least is `minimal`. GLM-5.3 FlashX, MiniMax M3.1 Flash and the MiMo models don't follow a JSON schema (`structuredOutput: false`), as in ADR 0174.
4. **Left out.** DeepSeek V4 Flash Vision: the Chat Completions path sends no images, so it would see none. Hy4 Preview: its page has a dollar price but neither the catalog nor OpenDesign publishes a context window, and a model is never cataloged with a guessed one. Every other model OpenDesign lists is outside this first set.
5. **Its key** is a provider key like any other (ADR 0007), checked on save with the cheap model (`keyCheckRequest`). OpenDesign publishes no key format, so the client checks none beyond a whole key without spaces, and never guesses a pasted key to be OpenDesign's. Keys are made at open-design.ai/cloud/dashboard.
6. **Routing order:** a workspace with only an OpenDesign key routes with it; it comes after Command Code and before OpenRouter (`SMALL_MODEL_ORDER`).

## Consequences

- An OpenDesign key works with Automático, routing, the judge and summaries, like a maker's own key.
- Rows copied from a maker's own cost what the maker charges, which can be more than OpenDesign's page says (GLM-5.3 Flash is listed there at half Z.ai's price): budgets err high, never low.
- Its model list and prices change; the catalog rows are a code change, as for the other catalog providers.
- The pickers list some models twice, under their maker's name and under OpenDesign's, each in its provider's group.
- Not checked against the live API before this was written: the routes, the URLs and the split come from OpenDesign's plugin and the published measurement, and the adapter's tests run on a scripted transport.
- Its mark is the symbol its own site serves (`https://go.open-design.ai/favicon.svg`, read 2026-11-15), one color, scaled from its 82×82 grid, so it takes the theme's ink (ADR 0059 §9).

## Alternatives considered

- **Every model on Chat Completions, as most are.** GLM-5.3 Flash would answer without thinking.
- **Every model on Anthropic Messages.** The measurement shows most models thinking only on Chat Completions.
- **A Responses client for the GPT models.** Not needed for GPT-6 Luna on Chat Completions, and a third route to keep.
- **Its whole list, priced from its credit table.** A credit multiplier isn't a dollar price; a call that can't be priced is never made.
- **A workspace endpoint (ADR 0146).** One API per endpoint, never Automático's or the router's picks.
