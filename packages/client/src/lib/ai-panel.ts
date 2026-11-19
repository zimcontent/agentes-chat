import type { ModelTier } from "@dougbot/providers";
import { planState } from "@dougbot/ui/plan-state";
import type { TFunction } from "i18next";
import type { AgentBrain, AiAccounts, MachineAccount, Model, PlanUsage, PlanWindow } from "../api/types";
import { type EffortLevel, effortOf } from "./brain-advanced";
import {
  modelPickerModels,
  modelPickerTiles,
  type PickerAccount,
  type PickerModel,
  type PickerTile,
} from "./brain-picker";
import { isContextLimit } from "./context-limits";
import { PLAN_ALIASES, type PlanAlias, planModelValue, planName, planOf } from "./plans";
import { apiProviderOf, isAuto, type ModelChoice } from "./providers";

/*
 * The phone's Painel de IA (the accounts the person pays for and which agent thinks with what) and its sheet that
 * changes an agent's AI by intent: "Mais inteligente", "Equilíbrio", "Mais rápida e econômica". Pure, so it is
 * unit-tested; the screens only draw what this decides.
 */

// ── The accounts ──

/** How an account stands, as its card's pill says it. */
export type AccountStanding = "ok" | "almost" | "limited" | "signed_out";

/** One bar of an account's card: how much of a window is used, and when it renews. */
export interface AccountBar {
  window: PlanWindow["kind"];
  /** The provider's own name for an `other` window. */
  label?: string;
  used: number;
  /** When it renews; absent: not known, or already passed (then it reads as empty). */
  resetsAt?: string;
}

/** An account as the panel's card shows it. */
export interface AccountCard {
  key: string;
  /** A `ProviderLogo` id. */
  mark: string;
  /** "Claude Max", "ChatGPT Pro", "GLM Coding". */
  title: string;
  /** Whose it is, by first name; null: nobody's. */
  owner: string | null;
  standing: AccountStanding;
  /** The window that renews first (the 5 hours where there is one); null: no reading yet. */
  main: AccountBar | null;
  /** The week, under it, thinner; null: the plan has none. */
  week: AccountBar | null;
  /** The account itself, for its actions; null for a computer's own sign-in. */
  account: AiAccounts["accounts"][number] | null;
}

/** The account's name with its plan as people say it ("Claude Max"), once: the label may already carry it. */
export const accountCardTitle = (a: Pick<MachineAccount, "label" | "plan">) =>
  a.plan && !a.label.toLowerCase().split(/\s+/).includes(a.plan.toLowerCase())
    ? `${a.label} ${planName(a.plan)}`
    : a.label;

const passed = (iso: string | undefined, now: number) => iso !== undefined && Date.parse(iso) <= now;

const barOf = (w: PlanWindow, now: number): AccountBar => ({
  window: w.kind,
  ...(w.label ? { label: w.label } : {}),
  used: passed(w.resetsAt, now) ? 0 : Math.round(w.usedPercent),
  ...(w.resetsAt && !passed(w.resetsAt, now) ? { resetsAt: w.resetsAt } : {}),
});

/** The order a plan's own windows renew in: the shortest first. */
const SHORTEST: readonly PlanWindow["kind"][] = ["five_hour", "seven_day", "monthly"];

/**
 * An account's two bars: the plan window that renews first (the 5 hours; a coding plan with only a month, that) and the
 * week under it. A model's own window never stands for the account's.
 */
export function accountBars(usage: PlanUsage | null | undefined, now = Date.now()): Pick<AccountCard, "main" | "week"> {
  const own = (usage?.windows ?? []).filter((w) => SHORTEST.includes(w.kind));
  const first = SHORTEST.map((k) => own.find((w) => w.kind === k)).find(Boolean);
  const week = own.find((w) => w.kind === "seven_day");
  return {
    main: first ? barOf(first, now) : null,
    week: week && week !== first ? barOf(week, now) : null,
  };
}

/** Where an account stands: signed out, at its limit, almost (from 80%), or fine. */
export function standingOf(
  a: { status?: string; usage: PlanUsage | null } | { usage: PlanUsage | null },
  now = Date.now(),
): AccountStanding {
  if ("status" in a && a.status === "signed_out") return "signed_out";
  if (!a.usage) return "ok";
  const { state } = planState(a.usage, now);
  return state === "limited" ? "limited" : state === "almost" ? "almost" : "ok";
}

/**
 * "Suas contas": the viewer's accounts on the workspace's computers, then the computers' own sign-ins, each as a card.
 * `ownTitle` names a computer's own sign-in (its plan, else "Conta deste computador").
 */
export function accountCards(
  ai: Pick<AiAccounts, "accounts" | "computers"> | null | undefined,
  ownTitle: (kind: string, plan: string | null) => string,
  now = Date.now(),
): AccountCard[] {
  const accounts = (ai?.accounts ?? []).map(
    (a): AccountCard => ({
      key: a.id,
      mark: a.provider ?? a.kind,
      title: accountCardTitle(a),
      owner: a.ownerName?.split(" ")[0] ?? null,
      standing: standingOf(a, now),
      ...accountBars(a.usage, now),
      account: a,
    }),
  );
  const own = (ai?.computers ?? []).flatMap((c) =>
    (["claude_code", "codex", "cursor"] as const).flatMap((kind): AccountCard[] => {
      const o = c.own?.[kind];
      if (!o) return [];
      const usage = o.usage ?? null;
      return [
        {
          key: `${c.machineId}:${kind}`,
          mark: kind,
          title: ownTitle(kind, o.plan ?? null),
          owner: null,
          standing: standingOf({ usage }, now),
          ...accountBars(usage, now),
          account: null,
        },
      ];
    }),
  );
  return [...accounts, ...own];
}

/** "15h", "15h40" in Portuguese; "3 PM", "3:40 PM" elsewhere: the hour a limit renews, in the reader's zone. */
export function hourWords(locale: string, iso: string): string {
  const d = new Date(iso);
  if (locale.startsWith("pt")) {
    const h = d.getHours();
    const m = d.getMinutes();
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    ...(d.getMinutes() === 0 ? {} : { minute: "2-digit" }),
  }).format(d);
}

/**
 * When a bar renews, in words: today its hour, another day that day's short name too ("sáb"). Null when the reading
 * didn't say.
 */
export function renewsWhen(locale: string, bar: Pick<AccountBar, "resetsAt">, now = new Date()) {
  if (!bar.resetsAt) return null;
  const at = new Date(bar.resetsAt);
  const sameDay = at.toDateString() === now.toDateString();
  const hour = hourWords(locale, bar.resetsAt);
  if (sameDay) return { day: null, hour };
  const day = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at).replace(/\.$/, "");
  return { day, hour };
}

// ── Who uses what ──

/** A model by its full name: a computer brain names it without its maker ("Opus 5.5"), the catalog with it. */
export const fullModelName = (label: string, models: readonly Pick<Model, "label">[]) =>
  models.find((m) => m.label === label || m.label.endsWith(` ${label}`))?.label ?? label;

/**
 * The model an agent thinks with as its chip says it, by its full name ("Claude Opus 5.5"): a computer brain's model
 * is named without its maker ("Opus 5.5"), which the catalog's label completes; nobody chose one: the one that last
 * answered, else `auto` (Automático's word).
 */
export function agentModelChip(
  agent: { model: string; brain?: { kind: string; model: string | null; answered?: string } | null },
  models: readonly Pick<Model, "id" | "label">[],
  auto: string,
): string {
  const full = (label: string) => fullModelName(label, models);
  const brain = agent.brain;
  if (brain && brain.kind !== "model") {
    const named = brain.model ?? brain.answered;
    return named ? full(named) : auto;
  }
  if (isAuto(agent.model)) return brain?.answered ? full(brain.answered) : auto;
  return models.find((m) => m.id === agent.model)?.label ?? agent.model;
}

// ── The sheet: three intents ──

export type Intent = "smart" | "balanced" | "fast";
export const INTENTS: readonly Intent[] = ["smart", "balanced", "fast"];

/** The size each intent asks for: the catalog's tiers, which Automático picks between too. */
export const INTENT_TIER: Record<Intent, ModelTier> = { smart: "large", balanced: "medium", fast: "small" };

const ALIAS_TIER: Record<PlanAlias, ModelTier> = { opus: "large", sonnet: "medium", haiku: "small" };
const TAG_TIER = { smart: "large", fast: "small", cheap: "small" } as const;

/** Where a model runs: a plan on the agent's computer with one account (or its own sign-in), or a workspace's key. */
export interface IntentPlace {
  tile: PickerTile;
  /** Undefined on a key. */
  account: PickerAccount | undefined;
}

/** A model the sheet could put the agent on, with what the rule reads of it. */
export interface IntentOption extends IntentPlace {
  model: PickerModel;
  /** Its full name ("Claude Opus 5.5"). */
  label: string;
  tier: ModelTier;
  /** A key's list prices in US$ per million tokens (the catalog's); null on a plan, which already pays for it. */
  prices: { input: number; output: number } | null;
  /** The agent thinks with exactly this now. */
  current: boolean;
  /** Its size came from the catalog or the plan, not from its price alone. */
  sized: boolean;
  /** Its list price (input and output per million tokens, US$) where the catalog knows it, to rank within a size. */
  cost: number;
}

const sameAccount = (a: PickerAccount | undefined, b: PickerAccount | undefined) => (a?.id ?? null) === (b?.id ?? null);

/** Two options are the same pick: the same AI, account and model. */
export const samePick = (a: IntentOption, b: IntentOption) =>
  a.tile.key === b.tile.key && sameAccount(a.account, b.account) && a.model.value === b.model.value;

/** A place the agent thinks on now. */
const isCurrentPlace = (view: Pick<AgentBrain, "brain" | "account">, p: IntentPlace) =>
  p.tile.current &&
  (p.tile.kind === "model" || (view.brain === p.tile.kind && (p.account?.id ?? null) === view.account));

/** How full a place is now: its tightest window, unknown as empty; a key has no quota (0). */
const usedOf = (p: IntentPlace, now: number) => (p.account?.usage ? planState(p.account.usage, now).used : 0);

const limitedNow = (p: IntentPlace, now: number) =>
  p.account?.usage ? planState(p.account.usage, now).state === "limited" : false;

/** A catalog model by id, where a dated or `[1m]` id or a thinking level's slug (`gemini-4-argon-high`) names its base. */
function catalogModel(models: readonly Model[], id: string | undefined) {
  if (!id) return undefined;
  const exact = models.find((m) => m.id === id);
  if (exact) return exact;
  const base = id.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  return models.find((m) => m.id === base) ?? models.find((m) => base.startsWith(`${m.id}-`));
}

/**
 * A model's size and list prices: a key's from the catalog; a plan's by Claude's alias (Opus large, Sonnet medium,
 * Haiku small), a coding plan's alias or what its maker sells it as, else its catalog row (Codex and Gemini name one).
 */
function modelFacts(
  view: Pick<AgentBrain, "options">,
  place: IntentPlace,
  value: string,
  models: readonly Model[],
): { tier: ModelTier | undefined; price: number | undefined } {
  if (place.tile.kind === "model") {
    const m = models.find((x) => x.id === value);
    return { tier: m?.tier, price: m ? m.inputUsdPerMTok + m.outputUsdPerMTok : undefined };
  }
  const plan = planOf(place.account?.provider);
  if (plan) {
    const m = plan.claudeCode.models.find((x) => planModelValue(x) === value);
    const tier = m?.alias ? ALIAS_TIER[m.alias] : m?.tag ? TAG_TIER[m.tag] : undefined;
    return { tier, price: undefined };
  }
  const option = view.options.find((o) => o.kind === place.tile.kind)?.models.find((o) => o.value === value);
  const row = catalogModel(models, option?.modelId ?? value);
  const alias = PLAN_ALIASES.find((a) => a === value);
  return {
    tier: alias && place.tile.kind === "claude_code" ? ALIAS_TIER[alias] : row?.tier,
    price: row ? row.inputUsdPerMTok + row.outputUsdPerMTok : undefined,
  };
}

/**
 * Every model the agent could switch to in one pick (the model picker's own tiles and lists), with its size. A model
 * the catalog gives no size to counts as large when it costs more than that place's medium one: a maker's flagship,
 * which people choose (Fable, GPT-6 Astra). Automático and models the plan refused are left out.
 */
export function intentOptions(
  t: TFunction,
  locale: string,
  view: Pick<
    AgentBrain,
    "brain" | "model" | "effectiveModel" | "options" | "accounts" | "account" | "ownSignIn" | "ownUsage"
  >,
  ownerUserId: string | null,
  api: [string, ModelChoice[]][],
  apiModel: string | null,
  models: readonly Model[],
): IntentOption[] {
  const tiles = modelPickerTiles(t, view, ownerUserId, api, apiModel, models);
  const out: IntentOption[] = [];
  for (const tile of tiles) {
    const accounts: (PickerAccount | undefined)[] = tile.kind === "model" ? [undefined] : tile.accounts;
    for (const account of accounts) {
      const place = { tile, account };
      const rows = modelPickerModels(t, locale, view, tile, account, api, apiModel).filter(
        (m) => !m.auto && !m.refused,
      );
      const facts = rows.map((m) => ({ m, ...modelFacts(view, place, m.value, models) }));
      const medium = facts.find((f) => f.tier === "medium")?.price;
      for (const f of facts) {
        const tier =
          f.tier ?? (medium !== undefined && f.price !== undefined && f.price > medium ? "large" : undefined);
        if (!tier) continue;
        const key = tile.kind === "model" ? models.find((x) => x.id === f.m.value) : undefined;
        out.push({
          ...place,
          model: f.m,
          label: fullModelName(f.m.label, models),
          tier,
          prices: key ? { input: key.inputUsdPerMTok, output: key.outputUsdPerMTok } : null,
          current: f.m.checked,
          sized: f.tier !== undefined,
          cost: f.price ?? 0,
        });
      }
    }
  }
  return out;
}

/**
 * Of one place's models of a size, the one an intent takes: one the catalog or the plan sized before one only its price
 * called large (Opus before Fable), then the costliest for the smartest and the cheapest otherwise, then the list's order.
 */
function bestOf(options: IntentOption[], intent: Intent): IntentOption | undefined {
  return [...options].sort(
    (a, b) => Number(b.sized) - Number(a.sized) || (intent === "smart" ? b.cost - a.cost : a.cost - b.cost),
  )[0];
}

/**
 * The sheet's three choices, one per intent, by one rule:
 *
 * 1. The model the agent runs now, when it has the intent's size: that intent shows it, marked "Atual".
 * 2. Else a model of that size where the agent thinks now (its account, or its key): changing how smart it is
 *    never moves it to another account by itself.
 * 3. Else that size on another of the agent's accounts or keys: plans before keys (a plan is already paid for),
 *    the one with the most room first, then the picker's order. An account at its limit is never offered.
 *
 * An intent with nothing of its size anywhere is left out.
 */
export function intentChoices(
  view: Pick<AgentBrain, "brain" | "account">,
  options: readonly IntentOption[],
  now = Date.now(),
): { intent: Intent; option: IntentOption }[] {
  const open = options.filter((o) => isCurrentPlace(view, o) || !limitedNow(o, now));
  return INTENTS.flatMap((intent) => {
    const tier = INTENT_TIER[intent];
    const sized = open.filter((o) => o.tier === tier);
    const current = sized.find((o) => o.current);
    if (current) return [{ intent, option: current }];
    const here = bestOf(
      sized.filter((o) => isCurrentPlace(view, o)),
      intent,
    );
    if (here) return [{ intent, option: here }];
    const places = [...new Set(sized.map((o) => `${o.tile.key}|${o.account?.id ?? ""}`))];
    const ranked = places
      .map((key) => sized.filter((o) => `${o.tile.key}|${o.account?.id ?? ""}` === key))
      .sort(
        (a, b) =>
          Number(a[0]?.tile.kind === "model") - Number(b[0]?.tile.kind === "model") ||
          usedOf(a[0] as IntentOption, now) - usedOf(b[0] as IntentOption, now),
      );
    const pick = ranked[0] ? bestOf(ranked[0], intent) : undefined;
    return pick ? [{ intent, option: pick }] : [];
  });
}

/**
 * The other places a chosen size runs on ("Roda na conta"): every account or key with a model of that size, the
 * chosen one first, each with the model the rule would take there.
 */
export function placesFor(
  options: readonly IntentOption[],
  chosen: IntentOption,
  intent: Intent,
  now = Date.now(),
): IntentOption[] {
  const sized = options.filter((o) => o.tier === chosen.tier && (o.current || !limitedNow(o, now)));
  const keys = [...new Set(sized.map((o) => `${o.tile.key}|${o.account?.id ?? ""}`))];
  const picks = keys.flatMap((key) => {
    const here = sized.filter((o) => `${o.tile.key}|${o.account?.id ?? ""}` === key);
    const same = here.find((o) => samePick(o, chosen));
    const best = same ?? here.find((o) => o.current) ?? bestOf(here, intent);
    return best ? [best] : [];
  });
  return picks.sort((a, b) => Number(samePick(b, chosen)) - Number(samePick(a, chosen)));
}

/** "Automático" where the agent thinks now: a pick of the same account or key, with no size of its own. */
export interface AutoOption extends IntentPlace {
  model: PickerModel;
  /** The agent is on Automático there now. */
  current: boolean;
}

/**
 * "Automático" as the sheet's fourth choice: the model (and its effort) picked per task, on the account or key the
 * agent thinks with now, so it never moves it. Null where that place lists no Automático.
 */
export function autoOption(
  t: TFunction,
  locale: string,
  view: Pick<
    AgentBrain,
    "brain" | "model" | "effectiveModel" | "options" | "accounts" | "account" | "ownSignIn" | "ownUsage"
  >,
  ownerUserId: string | null,
  api: [string, ModelChoice[]][],
  apiModel: string | null,
  models: readonly Model[],
): AutoOption | null {
  const tiles = modelPickerTiles(t, view, ownerUserId, api, apiModel, models);
  // On a key Automático is any maker's model, so no key's tile is current: the first stands for them all.
  const tile =
    tiles.find((x) => x.current) ?? (view.brain === "model" ? tiles.find((x) => x.kind === "model") : undefined);
  if (!tile) return null;
  const account = tile.kind === "model" ? undefined : tile.accounts.find((a) => a.id === view.account);
  if (tile.kind !== "model" && !account) return null;
  const model = modelPickerModels(t, locale, view, tile, account, api, apiModel).find((m) => m.auto);
  if (!model) return null;
  return { tile, account, model, current: tile.kind === "model" ? isAuto(apiModel) : model.checked };
}

/** How the agent thinks now, as the sheet's "Agora" lists it, each fact one row. */
export interface AgentNow {
  /** On a plan: the account by its card's title, its login (its owner's eyes only) and whose it is; null on a key. */
  account: { mark: string; title: string; login: string | null; owner: string | null; mine: boolean } | null;
  /** On a plan with no account chosen: the computer's own sign-in. */
  ownSignIn: boolean;
  /** On a key: its maker (a `ProviderLogo` id). */
  keyProvider: string | null;
  /** The model is picked per task. */
  auto: boolean;
  /** `auto` with Automático (or chosen so); null: the model's own default (a key with none chosen). */
  effort: EffortLevel | "auto" | null;
  /** The context limit; null: the model's whole window. */
  contextTokens: number | null;
}

export function agentNow(
  view: Pick<AgentBrain, "brain" | "account" | "accounts" | "effectiveModel" | "effort" | "contextTokens">,
  apiModel: string | null,
  models: readonly Model[],
): AgentNow {
  const onKey = view.brain === "model";
  const a = onKey ? undefined : view.accounts.find((x) => x.id === view.account);
  const auto = isAuto(onKey ? apiModel : view.effectiveModel);
  return {
    account: a
      ? {
          mark: a.provider ?? a.kind,
          title: accountCardTitle(a),
          login: a.email,
          owner: a.ownerName?.split(" ")[0] ?? null,
          mine: a.mine,
        }
      : null,
    ownSignIn: !onKey && !a,
    keyProvider: onKey ? (apiProviderOf(apiModel, models) ?? null) : null,
    auto,
    effort: auto || isAuto(view.effort) ? "auto" : effortOf(view.brain, view.effort),
    contextTokens: isContextLimit(view.contextTokens) ? view.contextTokens : null,
  };
}

/** A rough dollar in reais for list prices (a fixed rate, read 2026-11-17): the line says "≈". */
export const BRL_PER_USD = 5.4;

/** A key's list prices in reais per million tokens, input and output: cents under R$ 10 ("R$ 2,70"), whole above ("R$ 54"). */
export function pricesInReais(prices: { input: number; output: number }, locale = "pt-BR") {
  const fmt = (usd: number) => {
    const digits = usd * BRL_PER_USD < 10 ? 2 : 0;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
      .format(usd * BRL_PER_USD)
      .replace(/\u00a0/g, " ");
  };
  return { input: fmt(prices.input), output: fmt(prices.output) };
}

// ── "Se a cota acabar, usar" ──

/**
 * The account an agent's turn goes to when its own reaches 90% (ADR doug-0003, addendum 2026-11-14): the first of the
 * viewer's stand-in order on the agent's computer that isn't the one it thinks with and is signed in. Null: none.
 */
export function standInFor<A extends Pick<MachineAccount, "id" | "mine" | "status" | "standInRank">>(
  accounts: readonly A[],
  thinksWith: string | null | undefined,
): A | null {
  return (
    [...accounts]
      .filter((a) => a.mine && typeof a.standInRank === "number" && a.id !== thinksWith && a.status === "active")
      .sort((a, b) => (a.standInRank ?? 0) - (b.standInRank ?? 0))[0] ?? null
  );
}

/**
 * The viewer's order after making `first` its first stand-in, the rest kept after it in their order. The order is the
 * person's, for every agent of theirs, as Contas reserva sets it.
 */
export function standInOrderWith(
  accounts: readonly Pick<MachineAccount, "id" | "mine" | "standInRank">[],
  first: string,
): string[] {
  const order = accounts
    .filter((a) => a.mine && typeof a.standInRank === "number")
    .sort((a, b) => (a.standInRank ?? 0) - (b.standInRank ?? 0))
    .map((a) => a.id);
  return [first, ...order.filter((id) => id !== first)];
}
