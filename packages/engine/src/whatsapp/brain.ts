import { and, type Database, eq, schema } from "@dougbot/db";
import { isAutoModel, isKnownModel, parseCustomModel } from "@dougbot/providers";
import { type Agent, getAgent } from "../agents";
import { recordAudit } from "../audit";
import {
  type AgentBrainSummary,
  type AgentBrainView,
  agentBrainSummaries,
  type BrainEffortSetting,
  brainOf,
  defaultBrainModel,
  getAgentBrain,
  isBrainEffortSetting,
  normalizeBrainModel,
} from "../brain-settings";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { requirePermission } from "../organizations";
import { publishWhatsAppChanged, type WhatsAppAccountRow, type WhatsAppDeps } from "./accounts";

/**
 * The AI a WhatsApp number answers with, when it isn't its agent's own (docs/adr/doug-0004-whatsapp-bridge.md). The
 * agent stays who answers (its name, instructions, memory and skills, its budget and usage); only what thinks
 * changes, for this number alone. The kinds `ask` can reach: an API model through the Model Gateway, or a Claude,
 * ChatGPT or Gemini plan (a Gemini account, from `GEMINI_ROUTE_PROTOCOL`) on the agent's computer through `brain.route`.
 */
export const WHATSAPP_BRAIN_KINDS = ["model", "claude_code", "codex", "antigravity"] as const;
export type WhatsAppBrainKind = (typeof WHATSAPP_BRAIN_KINDS)[number];

export type WhatsAppBrainSetting = {
  brain: WhatsAppBrainKind;
  /** The model brain: the API model (as `agents.model`). A plan: its model (as `agents.brain_model`; null: its default). */
  model: string | null;
  /** A plan's account on the agent's computer; null: the computer's own sign-in. */
  account: string | null;
  /** How hard a plan thinks; null: the CLI's default. */
  effort: BrainEffortSetting | null;
};

const isKind = (v: unknown): v is WhatsAppBrainKind =>
  typeof v === "string" && (WHATSAPP_BRAIN_KINDS as readonly string[]).includes(v);

/** The stored setting read back: anything that isn't one is none (the agent's own AI). */
export function whatsappBrainOf(value: unknown): WhatsAppBrainSetting | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isKind(v.brain)) return null;
  return {
    brain: v.brain,
    model: typeof v.model === "string" && v.model ? v.model : null,
    account: typeof v.account === "string" && v.account ? v.account : null,
    effort: isBrainEffortSetting(v.effort) ? v.effort : null,
  };
}

/** The agent as it thinks on this number: itself, with the number's AI in place of its own when it has one. */
export function whatsappThinker(agent: Agent, setting: WhatsAppBrainSetting | null): Agent {
  if (!setting) return agent;
  if (setting.brain === "model") return { ...agent, brain: "model", model: setting.model ?? agent.model };
  return {
    ...agent,
    brain: setting.brain,
    brainModel: setting.model,
    brainAccountId: setting.account,
    brainEffort: setting.effort,
  };
}

/** What a number with no AI of its own starts from when one is picked: its agent's, where `ask` can reach it. */
function fromAgent(agent: Agent): WhatsAppBrainSetting {
  const brain = brainOf(agent.brain);
  if (!isKind(brain) || brain === "model") return { brain: "model", model: agent.model, account: null, effort: null };
  return {
    brain,
    model: agent.brainModel,
    account: agent.brainAccountId,
    effort: isBrainEffortSetting(agent.brainEffort) ? agent.brainEffort : null,
  };
}

/** The number's AI as the app's picker reads it: the agent's brain view with the number's choice in its place. */
export interface WhatsAppBrainView extends AgentBrainView {
  /** The number answers with an AI of its own; false: with its agent's. */
  own: boolean;
  /** The API model the picker marks (the number's when its AI is a model, else the agent's). */
  apiModel: string;
  /** What thinks here, for the line beside the button (`agentThinks`). */
  line: AgentBrainSummary | null;
}

async function managedNumber(db: Database, userId: string, orgId: string, accountId: string) {
  await requirePermission(db, userId, orgId, "manage_connectors");
  const [row] = await db
    .select()
    .from(schema.whatsappAccounts)
    .where(and(eq(schema.whatsappAccounts.orgId, orgId), eq(schema.whatsappAccounts.id, accountId)));
  if (!row) throw new NotFoundError("WhatsApp number not found");
  if (!row.agentId) throw new ConflictError("Choose the number's agent first", "whatsapp.no_agent");
  const agent = await getAgent(db, orgId, row.agentId);
  if (!agent || agent.archivedAt) throw new ConflictError("Choose the number's agent first", "whatsapp.no_agent");
  return { row, agent };
}

async function brainView(
  db: Database,
  userId: string,
  row: WhatsAppAccountRow,
  agent: Agent,
): Promise<WhatsAppBrainView> {
  // The agent's own view first: it is also the check that the caller may choose what thinks for this agent (an admin
  // or its owner), and it names the accounts and kinds its computer offers.
  const base = await getAgentBrain({ db }, userId, row.orgId, agent.id);
  const setting = whatsappBrainOf(row.brain);
  const thinker = whatsappThinker(agent, setting);
  const brain = brainOf(thinker.brain);
  const lines = await agentBrainSummaries(db, userId, row.orgId, [thinker]).catch(() => new Map());
  return {
    ...base,
    brain,
    model: brain === "model" ? null : thinker.brainModel,
    effectiveModel: brain === "model" ? null : (thinker.brainModel ?? defaultBrainModel(brain)),
    account: brain === "model" ? null : thinker.brainAccountId,
    effort: isBrainEffortSetting(thinker.brainEffort) ? thinker.brainEffort : null,
    own: setting !== null,
    apiModel: thinker.model,
    line: lines.get(agent.id) ?? null,
  };
}

/** `GET …/whatsapp/accounts/{id}/brain`: what thinks on the number (`manage_connectors`, and the agent's admin or owner). */
export async function getWhatsAppBrain(
  deps: Pick<WhatsAppDeps, "db">,
  userId: string,
  orgId: string,
  accountId: string,
) {
  const { row, agent } = await managedNumber(deps.db, userId, orgId, accountId);
  return brainView(deps.db, userId, row, agent);
}

export interface WhatsAppBrainInput {
  /** The picker's choice for a plan or the switch to the model brain (`AgentBrainInput`'s fields that apply here). */
  brain?: { brain?: unknown; model?: unknown; account?: unknown; effort?: unknown } | null;
  /** The API model, when the model brain is chosen. */
  model?: unknown;
}

const validApiModel = (model: unknown): model is string =>
  typeof model === "string" &&
  model.length > 0 &&
  model.length <= 200 &&
  (isKnownModel(model) || parseCustomModel(model) !== null || isAutoModel(model));

/**
 * `PUT …/whatsapp/accounts/{id}/brain`: the number answers with this AI from now on, its agent's own untouched.
 * Only what the agent's computer offers and the accounts the agent may think with (the same list as its own picker).
 * Audited as `whatsapp.brain_changed`.
 */
export async function setWhatsAppBrain(
  deps: Pick<WhatsAppDeps, "db" | "pubsub">,
  userId: string,
  orgId: string,
  accountId: string,
  input: WhatsAppBrainInput,
) {
  const { row, agent } = await managedNumber(deps.db, userId, orgId, accountId);
  const base = await getAgentBrain({ db: deps.db }, userId, orgId, agent.id);
  if (!base.canEdit) throw new ConflictError("Only an admin or the agent's owner chooses its AI", "brain.not_allowed");
  const current = whatsappBrainOf(row.brain) ?? fromAgent(agent);
  const asked = input.brain ?? {};
  const kind = asked.brain === undefined ? (input.model !== undefined ? "model" : current.brain) : asked.brain;
  if (!isKind(kind)) {
    throw new ValidationError(
      "WhatsApp answers with an API model, or a Claude, ChatGPT or Gemini plan",
      "brain.invalid",
    );
  }
  let next: WhatsAppBrainSetting;
  if (kind === "model") {
    const model = input.model ?? (current.brain === "model" ? current.model : agent.model);
    if (!validApiModel(model)) throw new ValidationError("Choose a model of the catalog", "brain.invalid_model");
    next = { brain: "model", model, account: null, effort: null };
  } else {
    const option = base.options.find((o) => o.kind === kind);
    if (!option?.available) {
      throw new ConflictError(
        base.computer
          ? `${kind === "codex" ? "Codex" : kind === "antigravity" ? "Gemini" : "Claude Code"} isn't available on ${base.computer.name}`
          : "The agent needs a connected computer first",
        base.computer ? "brain.unavailable" : "brain.no_computer",
        { brain: kind },
      );
    }
    const changed = kind !== current.brain;
    const model =
      asked.model !== undefined
        ? normalizeBrainModel(kind, asked.model, changed ? null : current.model)
        : changed
          ? null
          : current.model;
    let account = asked.account !== undefined ? asked.account : changed ? null : current.account;
    // Gemini thinks only with an account (never the computer's own sign-in): none chosen, the agent's first one.
    if (kind === "antigravity" && account === null) {
      const gemini =
        base.accounts.find((a) => a.kind === "antigravity" && a.status === "active") ??
        base.accounts.find((a) => a.kind === "antigravity");
      if (!gemini) {
        throw new ValidationError("Connect a Gemini account for the agent first", "account.invalid");
      }
      account = gemini.id;
    }
    if (account !== null) {
      const listed = base.accounts.find((a) => a.id === account);
      if (typeof account !== "string" || !listed || listed.kind !== kind) {
        throw new ValidationError("Choose one of the agent's accounts of that kind", "account.invalid");
      }
    }
    const effort = asked.effort !== undefined ? asked.effort : changed ? null : current.effort;
    if (effort !== null && !isBrainEffortSetting(effort)) {
      throw new ValidationError("Choose auto, low, medium, high, xhigh or max", "brain.invalid_effort");
    }
    next = { brain: kind, model, account: account as string | null, effort: effort as BrainEffortSetting | null };
  }
  const [saved] = await deps.db
    .update(schema.whatsappAccounts)
    .set({ brain: next })
    .where(eq(schema.whatsappAccounts.id, row.id))
    .returning();
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "whatsapp.brain_changed",
    target: { type: "whatsapp_account", id: row.id },
    details: { agentId: agent.id, from: whatsappBrainOf(row.brain), to: next },
  });
  await publishWhatsAppChanged(deps, row, { also: [userId] });
  return brainView(deps.db, userId, saved ?? { ...row, brain: next }, agent);
}

/** `DELETE …/whatsapp/accounts/{id}/brain`: the number answers with its agent's own AI again. Audited. */
export async function clearWhatsAppBrain(
  deps: Pick<WhatsAppDeps, "db" | "pubsub">,
  userId: string,
  orgId: string,
  accountId: string,
) {
  const { row, agent } = await managedNumber(deps.db, userId, orgId, accountId);
  if (row.brain !== null) {
    await deps.db.update(schema.whatsappAccounts).set({ brain: null }).where(eq(schema.whatsappAccounts.id, row.id));
    await recordAudit(deps.db, {
      orgId,
      actor: { type: "person", id: userId },
      action: "whatsapp.brain_changed",
      target: { type: "whatsapp_account", id: row.id },
      details: { agentId: agent.id, from: whatsappBrainOf(row.brain), to: null },
    });
    await publishWhatsAppChanged(deps, row, { also: [userId] });
  }
  return brainView(deps.db, userId, { ...row, brain: null }, agent);
}
