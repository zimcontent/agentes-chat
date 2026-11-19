import type {
  BrainKind,
  WhatsAppAccount,
  WhatsAppAccountPatch,
  WhatsAppAgentStyle,
  WhatsAppBrain,
  WhatsAppPace,
} from "@dougbot/client";

/*
 * A number's settings on the phone (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-17), as pure rules: the
 * same choices as the web's settings dialog, and what a save sends. The screens are `WhatsAppNumberScreen` and
 * `WhatsAppNumberAiScreen`.
 */

/** Seconds the agent may wait before it reads a conversation, as the web offers them. */
export const WAITS = [3, 8, 15, 30, 60, 120];
/** Minutes it stays quiet after a person answered. */
export const QUIETS = [15, 60, 240, 1440];
export const PACES: readonly WhatsAppPace[] = ["fast", "natural", "slow"];
export const MESSAGES = [1, 2, 3];

/** A list with the number's own value in it, where it was saved as something the list doesn't offer. */
export const withOwn = (list: readonly number[], own: number) =>
  list.includes(own) ? [...list] : [...list, own].sort((a, b) => a - b);

/** What the settings hold while they're changed, before Save. */
export interface NumberDraft {
  label: string;
  /** null: only people answer. */
  agentId: string | null;
  agentOn: boolean;
  style: WhatsAppAgentStyle;
  instructions: string;
}

export const draftOf = (a: WhatsAppAccount): NumberDraft => ({
  label: a.label,
  agentId: a.agentId,
  agentOn: a.agentOn,
  style: a.agentStyle,
  instructions: a.instructions ?? "",
});

/** Choosing who answers: an agent for a number that had none starts answering, nobody turns it off. */
export function chooseAgent(draft: NumberDraft, agentId: string | null): NumberDraft {
  if (agentId === draft.agentId) return draft;
  return { ...draft, agentId, agentOn: agentId === null ? false : draft.agentId === null ? true : draft.agentOn };
}

/** What Save sends: only what changed, so a save never writes back a value someone else changed meanwhile. */
export function patchOf(saved: WhatsAppAccount, draft: NumberDraft): WhatsAppAccountPatch {
  const was = draftOf(saved);
  const patch: WhatsAppAccountPatch = {};
  const label = draft.label.trim();
  if (label && label !== was.label) patch.label = label;
  if (draft.agentId !== was.agentId) patch.agentId = draft.agentId;
  const on = draft.agentId !== null && draft.agentOn;
  if (on !== was.agentOn) patch.agentOn = on;
  const style: Partial<WhatsAppAgentStyle> = {};
  for (const key of Object.keys(draft.style) as (keyof WhatsAppAgentStyle)[]) {
    if (draft.style[key] !== was.style[key]) Object.assign(style, { [key]: draft.style[key] });
  }
  if (Object.keys(style).length > 0) patch.agentStyle = style;
  if (draft.instructions !== was.instructions) patch.instructions = draft.instructions;
  return patch;
}

export const changed = (saved: WhatsAppAccount, draft: NumberDraft) => Object.keys(patchOf(saved, draft)).length > 0;

/** The kinds of AI a number may think with: an API model, or a plan on its agent's computer. */
export const NUMBER_KINDS = ["model", "claude_code", "codex", "antigravity"] as const;
export type NumberKind = (typeof NUMBER_KINDS)[number];

/** The kinds this number may pick now: the API, and each plan its agent's computer offers. */
export function kindsOffered(view: Pick<WhatsAppBrain, "options" | "brain">): NumberKind[] {
  return NUMBER_KINDS.filter(
    (kind) => kind === "model" || kind === view.brain || view.options.some((o) => o.kind === kind && o.available),
  );
}

/** How hard a plan thinks on WhatsApp: the runner takes these three (`ROUTE_EFFORTS`); null, its default. */
export const NUMBER_EFFORTS = ["low", "medium", "high"] as const;

/** The effort shown: one of the three, else the default. */
export const effortShown = (effort: string | null | undefined) => NUMBER_EFFORTS.find((e) => e === effort) ?? "auto";

/** A plan's account the number may think with: the agent's accounts of that kind. */
export const accountsOf = (view: Pick<WhatsAppBrain, "accounts">, kind: BrainKind) =>
  view.accounts.filter((a) => a.kind === kind);
