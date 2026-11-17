import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import type { AgentBrain, BrainOption, MachineAccount, Model, PlanUsage } from "../src/api/types";
import {
  accountBars,
  accountCards,
  accountCardTitle,
  agentModelChip,
  hourWords,
  intentChoices,
  intentOptions,
  placesFor,
  pricesInReais,
  renewsWhen,
  standInFor,
  standInOrderWith,
  standingOf,
} from "../src/lib/ai-panel";
import { AUTO, modelChoices } from "../src/lib/providers";

const t = ((key: string, o?: Record<string, unknown>) => (o ? `${key}${JSON.stringify(o)}` : key)) as TFunction;
const NOW = Date.parse("2026-11-17T12:00:00Z");
const at = new Date(NOW).toISOString();

const model = (id: string, provider: string, price: number, tier?: Model["tier"], label = id): Model => ({
  id,
  label,
  provider,
  inputUsdPerMTok: price,
  outputUsdPerMTok: price * 5,
  ...(tier ? { tier } : {}),
});
/** The catalog as the server lists it (`GET /models`). */
const MODELS: Model[] = [
  model("claude-fable-5-1", "anthropic", 10, undefined, "Claude Fable 5.1"),
  model("claude-opus-5-5", "anthropic", 4, "large", "Claude Opus 5.5"),
  model("claude-sonnet-5-5", "anthropic", 2, "medium", "Claude Sonnet 5.5"),
  model("claude-haiku-5-5", "anthropic", 0.1, "small", "Claude Haiku 5.5"),
  model("gpt-6-astra", "openai", 10, undefined, "GPT-6 Astra"),
  model("gpt-6.1-sol", "openai", 2, "medium", "GPT-6.1 Sol"),
  model("gpt-6-luna", "openai", 0.1, "small", "GPT-6 Luna"),
  model("gemini-4-argon", "gemini", 4, "large", "Gemini 4 Argon"),
  model("gemini-4-hydrogen", "gemini", 1.5, "medium", "Gemini 4 Hydrogen"),
];

const claudeCode: BrainOption = {
  kind: "claude_code",
  available: true,
  models: [
    { value: "opus", label: "Opus 5.5", modelId: "claude-opus-5-5" },
    { value: "sonnet", label: "Sonnet 5.5", modelId: "claude-sonnet-5-5", recommended: true },
    { value: "haiku", label: "Haiku 5.5", modelId: "claude-haiku-5-5" },
  ],
  defaultModel: "sonnet",
};
const codex: BrainOption = {
  kind: "codex",
  available: true,
  models: [
    { value: "gpt-6-astra", label: "GPT-6 Astra", modelId: "gpt-6-astra" },
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", modelId: "gpt-6.1-sol", recommended: true },
    { value: "gpt-6-luna", label: "GPT-6 Luna", modelId: "gpt-6-luna" },
  ],
  defaultModel: "gpt-6.1-sol",
};
const gemini: BrainOption = {
  kind: "antigravity",
  available: true,
  models: [
    { value: "gemini-4-argon-high", label: "Gemini 4 Argon", modelId: "gemini-4-argon" },
    { value: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", modelId: "gemini-4-hydrogen" },
  ],
  defaultModel: null,
};

const usage = (used: number, resetsAt?: string): PlanUsage => ({
  windows: [
    { kind: "five_hour", usedPercent: used, ...(resetsAt ? { resetsAt } : {}) },
    { kind: "seven_day", usedPercent: Math.round(used / 2) },
  ],
  source: "probe",
  at,
});
const account = (id: string, kind: MachineAccount["kind"], over: Partial<MachineAccount> = {}): MachineAccount => ({
  id,
  kind,
  label: id,
  email: null,
  plan: null,
  status: "active",
  ownerId: "u1",
  ownerName: "Gabriel Zim",
  mine: true,
  usedBy: [],
  usage: usage(10),
  provider: null,
  keyHint: null,
  ...over,
});
const MAX = account("claude-max", "claude_code", { label: "Claude", plan: "max", usage: usage(62) });
const PRO = account("chatgpt-pro", "codex", { label: "ChatGPT", plan: "pro", usage: usage(88) });
const GEM = account("gemini", "antigravity", { label: "Gemini", usage: usage(12) });

type View = Parameters<typeof intentOptions>[2] & Pick<AgentBrain, "brain" | "account">;
const view = (over: Partial<View> = {}): View => ({
  brain: "claude_code",
  model: "opus",
  effectiveModel: "opus",
  options: [claudeCode, codex, gemini],
  accounts: [MAX, PRO, GEM],
  account: "claude-max",
  ownSignIn: false,
  ownUsage: {},
  ...over,
});
const keys = (providers: string[]) =>
  modelChoices(
    MODELS,
    providers.map((provider, i) => ({ id: `k${i}`, provider }) as never),
    false,
  );
const choose = (v: View, providers: string[] = [], apiModel: string | null = "claude-sonnet-5-5") => {
  const options = intentOptions(t, "pt-BR", v, "u1", keys(providers), apiModel, MODELS);
  return {
    options,
    picks: intentChoices(v, options, NOW).map(({ intent, option }) => [
      intent,
      option.tile.key,
      option.account?.id ?? null,
      option.model.value,
      option.current,
    ]),
  };
};

describe("the three intents", () => {
  test("on Opus with Claude Max: Opus is the current smartest, Sonnet and Haiku stay on the same account", () => {
    expect(choose(view()).picks).toEqual([
      ["smart", "claude", "claude-max", "opus", true],
      ["balanced", "claude", "claude-max", "sonnet", false],
      ["fast", "claude", "claude-max", "haiku", false],
    ]);
  });

  test("ChatGPT's flagship has no size in the catalog: dearer than its medium one, it is the smartest", () => {
    const v = view({ brain: "codex", model: "gpt-6.1-sol", effectiveModel: "gpt-6.1-sol", account: "chatgpt-pro" });
    expect(choose(v).picks).toEqual([
      ["smart", "chatgpt", "chatgpt-pro", "gpt-6-astra", false],
      ["balanced", "chatgpt", "chatgpt-pro", "gpt-6.1-sol", true],
      ["fast", "chatgpt", "chatgpt-pro", "gpt-6-luna", false],
    ]);
  });

  test("a size the account lacks goes to another account: plans before keys, the most room first", () => {
    const v = view({
      brain: "antigravity",
      model: "gemini-4-hydrogen",
      effectiveModel: "gemini-4-hydrogen",
      account: "gemini",
    });
    // Gemini has no small model: the fast one is Claude Max's Haiku (62% used) over ChatGPT's Luna (88%), and a key's
    // Haiku comes last.
    expect(choose(v, ["anthropic"]).picks).toEqual([
      ["smart", "gemini", "gemini", "gemini-4-argon-high", false],
      ["balanced", "gemini", "gemini", "gemini-4-hydrogen", true],
      ["fast", "claude", "claude-max", "haiku", false],
    ]);
  });

  test("an account at its limit is never offered, unless the agent thinks with it", () => {
    const full = { ...MAX, usage: usage(100) };
    const v = view({
      brain: "antigravity",
      model: "gemini-4-hydrogen",
      effectiveModel: "gemini-4-hydrogen",
      account: "gemini",
      accounts: [full, PRO, GEM],
    });
    expect(choose(v).picks.at(-1)).toEqual(["fast", "chatgpt", "chatgpt-pro", "gpt-6-luna", false]);
    const onIt = view({ accounts: [full, PRO, GEM] });
    expect(choose(onIt).picks[0]).toEqual(["smart", "claude", "claude-max", "opus", true]);
  });

  test("on a key: the catalog's sizes, Opus before the dearer Fable, and the prices come with it", () => {
    const v = view({ brain: "model", account: null, accounts: [] });
    const { options, picks } = choose(v, ["anthropic"], "claude-sonnet-5-5");
    expect(picks).toEqual([
      ["smart", "api:anthropic", null, "claude-opus-5-5", false],
      ["balanced", "api:anthropic", null, "claude-sonnet-5-5", true],
      ["fast", "api:anthropic", null, "claude-haiku-5-5", false],
    ]);
    expect(options.find((o) => o.model.value === "claude-opus-5-5")?.prices).toEqual({ input: 4, output: 20 });
    expect(options.find((o) => o.tile.kind !== "model")?.prices ?? null).toBeNull();
  });

  test("the agent's current flagship stays its smartest choice", () => {
    const v = view({ brain: "model", account: null, accounts: [] });
    expect(choose(v, ["anthropic"], "claude-fable-5-1").picks[0]).toEqual([
      "smart",
      "api:anthropic",
      null,
      "claude-fable-5-1",
      true,
    ]);
  });

  test("on Automático nothing is current: each intent still names its model", () => {
    const v = view({ model: AUTO, effectiveModel: AUTO });
    expect(choose(v).picks.map((p) => p[4])).toEqual([false, false, false]);
    expect(choose(v).picks.map((p) => p[3])).toEqual(["opus", "sonnet", "haiku"]);
  });

  test("Roda na conta: every account with that size, the chosen one first", () => {
    const v = view();
    const { options } = choose(v, ["anthropic"]);
    const fast = intentChoices(v, options, NOW).find((c) => c.intent === "fast")?.option;
    if (!fast) throw new Error("no fast choice");
    expect(
      placesFor(options, fast, "fast", NOW).map((o) => [o.tile.key, o.account?.id ?? null, o.model.value]),
    ).toEqual([
      ["claude", "claude-max", "haiku"],
      ["chatgpt", "chatgpt-pro", "gpt-6-luna"],
      ["api:anthropic", null, "claude-haiku-5-5"],
    ]);
  });
});

describe("the accounts' cards", () => {
  test("the title carries the plan once", () => {
    expect(accountCardTitle({ label: "Claude", plan: "max" })).toBe("Claude Max");
    expect(accountCardTitle({ label: "Claude Max", plan: "max" })).toBe("Claude Max");
    expect(accountCardTitle({ label: "GLM Coding", plan: null })).toBe("GLM Coding");
  });

  test("the 5 hours on top, the week under it; a passed reset reads empty", () => {
    const u: PlanUsage = {
      windows: [
        { kind: "seven_day", usedPercent: 41 },
        { kind: "five_hour", usedPercent: 62.4, resetsAt: "2026-11-17T15:00:00Z" },
        { kind: "other", label: "Opus", usedPercent: 99 },
      ],
      source: "probe",
      at,
    };
    expect(accountBars(u, NOW)).toEqual({
      main: { window: "five_hour", used: 62, resetsAt: "2026-11-17T15:00:00Z" },
      week: { window: "seven_day", used: 41 },
    });
    expect(accountBars(u, Date.parse("2026-11-17T16:00:00Z")).main).toEqual({ window: "five_hour", used: 0 });
    // A coding plan with a month only.
    expect(accountBars({ windows: [{ kind: "monthly", usedPercent: 5 }], source: "probe", at }, NOW)).toEqual({
      main: { window: "monthly", used: 5 },
      week: null,
    });
    expect(accountBars(null)).toEqual({ main: null, week: null });
  });

  test("standing: signed out, at the limit, almost from 80%, fine", () => {
    expect(standingOf({ status: "signed_out", usage: usage(10) }, NOW)).toBe("signed_out");
    expect(standingOf({ usage: usage(100) }, NOW)).toBe("limited");
    expect(standingOf({ usage: usage(88) }, NOW)).toBe("almost");
    expect(standingOf({ usage: usage(62) }, NOW)).toBe("ok");
    expect(standingOf({ usage: null }, NOW)).toBe("ok");
  });

  test("cards: the accounts with their owner, then the computers' own sign-ins", () => {
    const cards = accountCards(
      {
        accounts: [{ ...MAX, machineId: "m1", computer: "Mac" }],
        computers: [
          {
            machineId: "m1",
            name: "Mac",
            online: true,
            mine: true,
            canAdd: true,
            keys: true,
            brains: { claude_code: true, codex: true },
            own: { codex: { plan: "plus" } },
          },
        ],
      },
      (kind, plan) => `${kind}:${plan}`,
      NOW,
    );
    expect(cards.map((c) => [c.key, c.mark, c.title, c.owner, c.standing])).toEqual([
      ["claude-max", "claude_code", "Claude Max", "Gabriel", "ok"],
      ["m1:codex", "codex", "codex:plus", null, "ok"],
    ]);
  });

  test("the hour a limit renews, as each language says it", () => {
    const local = (h: number, m = 0) => new Date(2026, 10, 17, h, m).toISOString();
    expect(hourWords("pt-BR", local(15))).toBe("15h");
    expect(hourWords("pt-BR", local(9, 5))).toBe("9h05");
    expect(hourWords("en-US", local(15))).toBe("3 PM");
    expect(renewsWhen("pt-BR", { resetsAt: local(15) }, new Date(2026, 10, 17, 12))).toEqual({
      day: null,
      hour: "15h",
    });
    expect(renewsWhen("pt-BR", { resetsAt: local(15) }, new Date(2026, 10, 16, 12))?.day).toBe("ter");
    expect(renewsWhen("pt-BR", {})).toBeNull();
  });
});

describe("who uses what, the reserve and the prices", () => {
  test("the chip names the model in full", () => {
    expect(
      agentModelChip({ model: AUTO, brain: { kind: "claude_code", model: "Opus 5.5" } }, MODELS, "Automático"),
    ).toBe("Claude Opus 5.5");
    expect(agentModelChip({ model: "gpt-6.1-sol", brain: { kind: "model", model: null } }, MODELS, "Auto")).toBe(
      "GPT-6.1 Sol",
    );
    expect(agentModelChip({ model: AUTO, brain: { kind: "model", model: null } }, MODELS, "Automático")).toBe(
      "Automático",
    );
    expect(
      agentModelChip(
        { model: AUTO, brain: { kind: "antigravity", model: null, answered: "Gemini 4 Hydrogen" } },
        MODELS,
        "Auto",
      ),
    ).toBe("Gemini 4 Hydrogen");
  });

  test("the stand-in is the first of the person's order that isn't the agent's own account", () => {
    const list = [
      { ...MAX, standInRank: 1 },
      { ...PRO, standInRank: 2 },
      { ...GEM, standInRank: null },
    ];
    expect(standInFor(list, "claude-max")?.id).toBe("chatgpt-pro");
    expect(standInFor(list, "gemini")?.id).toBe("claude-max");
    expect(standInFor([{ ...PRO, standInRank: 1, status: "signed_out" as const }], "x")).toBeNull();
    expect(standInFor([{ ...PRO, standInRank: 1, mine: false }], "x")).toBeNull();
    expect(standInOrderWith(list, "gemini")).toEqual(["gemini", "claude-max", "chatgpt-pro"]);
    expect(standInOrderWith(list, "chatgpt-pro")).toEqual(["chatgpt-pro", "claude-max"]);
  });

  test("a key's prices in reais", () => {
    expect(pricesInReais({ input: 2, output: 10 })).toEqual({ input: "R$ 11", output: "R$ 54" });
    expect(pricesInReais({ input: 0.1, output: 0.5 })).toEqual({ input: "R$ 0,54", output: "R$ 2,70" });
  });
});
