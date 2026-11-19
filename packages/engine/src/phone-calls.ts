import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { KeyWrapper, PubSub, ZimMedia } from "@agenteschat/adapters";
import { and, type Database, eq, schema } from "@agenteschat/db";
import { getAgent } from "./agents";
import { recordAudit } from "./audit";
import { runPerson } from "./authority";
import { openSecret, sealSecret } from "./crypto";
import { deliverNotice, publishDelivery } from "./delivery";
import { ForbiddenError, ValidationError } from "./errors";
import { can, getMembership } from "./organizations";
import { rightHandId } from "./right-hand";
import type { ToolDefinition, ToolSource } from "./tools/types";
import { untrustedBlock } from "./untrusted";

/**
 * Phone calls (docs/adr/doug-0035-phone-calls.md): an agent calls a person's phone, with a person's approval, and talks
 * with them in its own voice. A workspace owner connects their calling service once (its address and token, sealed like
 * a provider key), for every workspace they own; the service dials, carries the call to a voice model and, when it ends, reports what was said to a
 * one-use address here. What was said comes back to the conversation that asked for the call, for the agent alone,
 * which then tells the people there what came of it.
 */
export interface PhoneDeps {
  db: Database;
  pubsub?: PubSub;
  keyWrapper: KeyWrapper;
  keyWrappers: KeyWrapper[];
  /** This server's public address: the service reports to `<publicUrl>/api/webhooks/phone-call/…`. */
  publicUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
  /** The credit wallet (Zim Mídia, ADR doug-0011) that pays the house voice; null: only GPT-Live calls. */
  media?: ZimMedia | null;
  log?: { warn(message: string, extra?: Record<string, unknown>): void };
}

/** The voices a call can go out with: GPT-Live 1 on the calling service's own key, or the house Qwen paid in credits. */
export const PHONE_ENGINES = ["gpt-live", "qwen"] as const;
export type PhoneEngine = (typeof PHONE_ENGINES)[number];
const isEngine = (v: unknown): v is PhoneEngine => PHONE_ENGINES.includes(v as PhoneEngine);
/** A house-voice call needs credits for at least this long to go out. */
export const PHONE_MIN_SECONDS = 60;

const AAD = (userId: string) => `phone-line|${userId}`;
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");
const now = (deps: Pick<PhoneDeps, "now">) => deps.now?.() ?? new Date();
const E164 = /^\+[1-9]\d{7,14}$/;
/** What the agent may tell the voice about the call. */
export const PHONE_BRIEF_MAX = 4000;
const LINES_MAX = 400;
const LINE_MAX = 2000;

/** A number as people type it ("+55 (11) 99999-8888") in E.164, or null. */
export function phoneNumberOf(raw: string) {
  const digits = raw.trim().replace(/[\s().-]/g, "");
  return E164.test(digits) ? digits : null;
}

// ─── The line ────────────────────────────────────────────────────────────────

/**
 * A line is a person's, not a workspace's: an owner connects their calling service once and the Doug of every workspace
 * they own calls through it. A workspace calls through its owners' lines, the asking person's own first.
 */
export interface PhoneLineView {
  /** `ok`: the Doug here may call (one of the workspace's owners has a line). `off`: none has. */
  state: "off" | "ok";
  /** The number calls go out from here. */
  fromNumber: string;
  /** This person's own line, shown only to them: its address, its number and its token's last 4 characters. */
  mine: { url: string; fromNumber: string; hint: string } | null;
  /** Only an owner connects a line, and only their own. */
  editable: boolean;
  /** The voice calls here go out with, and the ones the line can use. */
  engine: PhoneEngine;
  engines: PhoneEngine[];
  /** Whether this person may change the voice (`configure`). */
  canChoose: boolean;
  /** The house voice's price and the workspace's credits, when the wallet answers. */
  credits: { perMinute: number; balance: number } | null;
}

/** The owners of a workspace with a line, the given person's own first. */
async function linesFor(deps: Pick<PhoneDeps, "db">, orgId: string, preferUserId: string | null) {
  const rows = await deps.db
    .select({ line: schema.phoneLines })
    .from(schema.phoneLines)
    .innerJoin(
      schema.organizationMembers,
      and(
        eq(schema.organizationMembers.userId, schema.phoneLines.userId),
        eq(schema.organizationMembers.orgId, orgId),
        eq(schema.organizationMembers.role, "owner"),
      ),
    );
  return rows.map((r) => r.line).sort((a, b) => Number(b.userId === preferUserId) - Number(a.userId === preferUserId));
}

export async function phoneLineView(deps: PhoneDeps, userId: string, orgId: string): Promise<PhoneLineView> {
  const membership = await getMembership(deps.db, userId, orgId);
  if (!membership) throw new ForbiddenError();
  const [line] = await linesFor(deps, orgId, userId);
  const [mine] = await deps.db.select().from(schema.phoneLines).where(eq(schema.phoneLines.userId, userId));
  const engines = (line?.engines ?? ["gpt-live"]).filter(isEngine);
  return {
    state: line ? "ok" : "off",
    fromNumber: line?.fromNumber ?? "",
    mine: mine ? { url: mine.url, fromNumber: mine.fromNumber, hint: mine.tokenHint } : null,
    editable: membership.role === "owner",
    engine: await phoneEngineOf(deps, orgId),
    engines: engines.length ? engines : ["gpt-live"],
    canChoose: can(membership, "configure"),
    credits: await houseCredits(deps, orgId),
  };
}

async function requireOwner(deps: Pick<PhoneDeps, "db">, userId: string, orgId: string) {
  const membership = await getMembership(deps.db, userId, orgId);
  if (membership?.role !== "owner")
    throw new ForbiddenError("Only a workspace's owner connects a phone line", "phone.not_owner");
}

/** The service's own answer to its token: the number it calls from. Refused, unreachable or not one: a message. */
async function checkLine(deps: PhoneDeps, url: string, token: string) {
  const res = await (deps.fetch ?? fetch)(`${url}/line`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (res && (res.status === 401 || res.status === 403))
    throw new ValidationError("The calling service refused this token", "phone.token_invalid");
  const body = res?.ok ? ((await res.json().catch(() => null)) as { from?: unknown; engines?: unknown } | null) : null;
  if (!body) throw new ValidationError("Couldn't reach the calling service at that address", "phone.unreachable");
  const engines = Array.isArray(body.engines) ? body.engines.filter(isEngine) : [];
  return {
    fromNumber: typeof body.from === "string" ? body.from.slice(0, 20) : "",
    engines: engines.length ? engines : (["gpt-live"] as PhoneEngine[]),
  };
}

/** The voice the workspace's calls go out with. */
export async function phoneEngineOf(deps: Pick<PhoneDeps, "db">, orgId: string): Promise<PhoneEngine> {
  const [row] = await deps.db
    .select({ engine: schema.organizationSettings.phoneEngine })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.orgId, orgId));
  return isEngine(row?.engine) ? row.engine : "gpt-live";
}

/** The house voice's price per minute and the workspace's credits; null when there is no wallet or it doesn't answer. */
async function houseCredits(deps: Pick<PhoneDeps, "media">, orgId: string) {
  if (!deps.media) return null;
  try {
    const [catalog, wallet] = await Promise.all([deps.media.catalog(), deps.media.balance(orgId)]);
    const perMinute = catalog.calls?.qwen?.creditsPerMinute;
    return typeof perMinute === "number" && perMinute > 0 ? { perMinute, balance: wallet.balance } : null;
  } catch {
    return null;
  }
}

/** Picks the voice of the workspace's calls (`configure`). The house voice needs the wallet. */
export async function setPhoneEngine(deps: PhoneDeps, userId: string, orgId: string, engine: string) {
  const membership = await getMembership(deps.db, userId, orgId);
  if (!can(membership, "configure")) throw new ForbiddenError();
  if (!isEngine(engine)) throw new ValidationError("Unknown voice", "phone.engine_unknown");
  if (engine === "qwen" && !deps.media)
    throw new ValidationError("The house voice needs credits, which this server doesn't have", "phone.no_credits");
  await deps.db
    .insert(schema.organizationSettings)
    .values({ orgId, phoneEngine: engine })
    .onConflictDoUpdate({ target: schema.organizationSettings.orgId, set: { phoneEngine: engine } });
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "phone.engine_changed",
    target: { type: "phone_line", id: orgId },
    details: { engine },
  });
  return phoneLineView(deps, userId, orgId);
}

/** Connects or replaces the person's own line (an owner of this workspace): it serves every workspace they own. */
export async function savePhoneLine(
  deps: PhoneDeps,
  userId: string,
  orgId: string,
  input: { url: string; token: string },
) {
  await requireOwner(deps, userId, orgId);
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new ValidationError("That isn't an address", "phone.url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new ValidationError("The address starts with https:// and has no login or query", "phone.url_invalid");
  const base = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  const token = input.token.trim();
  if (!/^[\x21-\x7e]{16,300}$/.test(token)) throw new ValidationError("That isn't a token", "phone.token_invalid");
  const { fromNumber, engines } = await checkLine(deps, base, token);
  const sealed = await sealSecret(deps.keyWrapper, token, AAD(userId));
  const values = { url: base, fromNumber, engines, ...sealed, tokenHint: token.slice(-4), updatedAt: now(deps) };
  await deps.db
    .insert(schema.phoneLines)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.phoneLines.userId, set: values });
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "phone.line_saved",
    target: { type: "phone_line", id: userId },
    details: { hint: values.tokenHint },
  });
  return phoneLineView(deps, userId, orgId);
}

/** Removes the person's own line: the Doug of the workspaces they own stops calling through it. */
export async function removePhoneLine(deps: PhoneDeps, userId: string, orgId: string) {
  await requireOwner(deps, userId, orgId);
  await deps.db.delete(schema.phoneLines).where(eq(schema.phoneLines.userId, userId));
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: userId },
    action: "phone.line_removed",
    target: { type: "phone_line", id: userId },
  });
  return phoneLineView(deps, userId, orgId);
}

/** The line a call here goes out on, opened: the asking person's own when they own the workspace, else an owner's. */
async function openLine(deps: PhoneDeps, orgId: string, preferUserId: string | null) {
  for (const row of await linesFor(deps, orgId, preferUserId)) {
    const token = await openSecret(deps.keyWrappers, row, AAD(row.userId)).catch(() => null);
    if (token) return { userId: row.userId, url: row.url, token, engines: row.engines };
  }
  return null;
}

/** Who may ask for a call: the workspace's owners and administrators (docs/adr/doug-0035-phone-calls.md). */
async function mayAskForCalls(deps: Pick<PhoneDeps, "db">, orgId: string, userId: string | null) {
  if (!userId) return false;
  return can(await getMembership(deps.db, userId, orgId), "administrator");
}

// ─── The agent's tool ────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function phoneCallTool(deps: PhoneDeps): ToolDefinition {
  return {
    name: "phone_call",
    description:
      "Call a person's phone and talk with them yourself, in your own voice: a person approves the call first. Use it when someone asks you to call them or someone else. In `brief`, write what the call is for and everything you will need to talk about it (the facts, names, dates, what to ask, what to leave out), from what you know and find with your tools first: on the phone you only know what the brief says. Never put a password, a key or anything private in it. The call starts at once; when it ends, what was said comes back to this conversation and you tell the people here what came of it.",
    scope: "",
    sensitive: true,
    inputSchema: {
      type: "object",
      required: ["to", "brief"],
      properties: {
        to: { type: "string", description: "The phone number, with its country code: +5511999998888." },
        name: { type: "string", description: "Who you are calling, if you know." },
        brief: {
          type: "string",
          description: `What the call is for and what to say, in the person's language (at most ${PHONE_BRIEF_MAX} characters).`,
        },
      },
      additionalProperties: false,
    },
    // "Aprovar sempre" for one number: calls to that number run without asking.
    rememberTarget: (input) => phoneNumberOf(str(input.to)),
    describe(input) {
      const name = str(input.name);
      const brief = str(input.brief);
      return {
        title: `Call ${name ? `${name} (${str(input.to)})` : str(input.to)}`,
        detail: brief.length > 600 ? `${brief.slice(0, 600)}…` : brief,
      };
    },
    async execute(input, ctx) {
      const to = phoneNumberOf(str(input.to));
      if (!to) return { content: "Write the number with its country code: +5511999998888.", isError: true };
      const brief = str(input.brief);
      if (!brief) return { content: "Write the brief: what the call is for and what to say.", isError: true };
      if (brief.length > PHONE_BRIEF_MAX)
        return { content: `The brief has at most ${PHONE_BRIEF_MAX} characters.`, isError: true };
      const requestedBy = await runPerson(ctx.db, ctx.orgId, ctx.runId).catch(() => null);
      if (!(await mayAskForCalls(deps, ctx.orgId, requestedBy)))
        return { content: "Only the workspace's owners and administrators may ask for a call.", isError: true };
      const line = await openLine(deps, ctx.orgId, requestedBy);
      if (!line) return { content: "This workspace has no phone line now.", isError: true };
      const agent = await getAgent(deps.db, ctx.orgId, ctx.agentId);
      if (!agent) return { content: "Agent not found.", isError: true };
      const engine = await phoneEngineOf(deps, ctx.orgId);
      if (!line.engines.includes(engine))
        return { content: `The phone line can't call with the voice chosen here (${engine}) now.`, isError: true };
      // The house voice is paid in credits: the call goes out only with a minute of them, and lasts what they pay for.
      let maxSeconds: number | null = null;
      if (engine === "qwen") {
        const credits = await houseCredits(deps, ctx.orgId);
        if (!credits) return { content: "The credits wallet didn't answer: the call can't go out now.", isError: true };
        maxSeconds = Math.floor((credits.balance / credits.perMinute) * 60);
        if (maxSeconds < PHONE_MIN_SECONDS)
          return {
            content: `Not enough credits for a call: a minute costs ${credits.perMinute} credits and the workspace has ${credits.balance}. Tell the person to add credits in Mídia, or to switch the calls' voice to GPT-Live in Settings › Voice.`,
            isError: true,
          };
      }
      const id = randomUUID();
      const secret = randomBytes(24).toString("hex");
      await deps.db.insert(schema.phoneCalls).values({
        id,
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        runId: ctx.runId,
        channelId: ctx.channelId,
        threadId: ctx.threadRootId !== ctx.triggerMessageId ? ctx.threadRootId : null,
        triggerMessageId: ctx.triggerMessageId,
        requestedBy,
        lineUserId: line.userId,
        engine,
        to,
        brief,
        hookHash: hash(secret),
      });
      const name = str(input.name).slice(0, 120);
      const res = await (deps.fetch ?? fetch)(`${line.url}/call`, {
        method: "POST",
        headers: { Authorization: `Bearer ${line.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          about: brief,
          ...(name ? { name } : {}),
          agent: { name: agent.name, role: agent.role },
          engine,
          ...(maxSeconds !== null ? { maxSeconds } : {}),
          report: `${deps.publicUrl.replace(/\/+$/, "")}/api/webhooks/phone-call/${id}/${secret}`,
        }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      const answer = (await res?.json().catch(() => null)) as { sid?: unknown; error?: unknown } | null;
      if (!res?.ok) {
        await deps.db
          .update(schema.phoneCalls)
          .set({ status: "failed", endedAt: now(deps) })
          .where(eq(schema.phoneCalls.id, id));
        const why = typeof answer?.error === "string" ? `: ${answer.error.slice(0, 200)}` : "";
        return { content: `The call didn't go out${why}.`, isError: true };
      }
      await deps.db
        .update(schema.phoneCalls)
        .set({ providerCallId: typeof answer?.sid === "string" ? answer.sid.slice(0, 80) : null })
        .where(eq(schema.phoneCalls.id, id));
      await recordAudit(deps.db, {
        orgId: ctx.orgId,
        actor: { type: "agent", id: ctx.agentId },
        action: "phone.call_started",
        target: { type: "phone_call", id },
        details: { to },
      });
      return {
        content: `Calling ${name || to} now. Tell the people here in a line that you are calling; when the call ends, what was said comes back here.`,
        data: { phoneCallId: id },
      };
    },
  };
}

/** The phone tool for a run: the right hand's, with an owner or administrator behind it, where an owner has a line. */
export function createPhoneToolSource(deps: PhoneDeps | null): ToolSource {
  return {
    name: "phone",
    async tools(ctx) {
      if (!deps || !ctx.runId || ctx.background) return [];
      // Only the workspace's Doug (its right hand) calls, for its owners and administrators, through an owner's line.
      if ((await rightHandId(ctx.db, ctx.orgId)) !== ctx.agentId) return [];
      const person = await runPerson(ctx.db, ctx.orgId, ctx.runId).catch(() => null);
      if (!(await mayAskForCalls(deps, ctx.orgId, person))) return [];
      const [line] = await linesFor(deps, ctx.orgId, person);
      return line ? [phoneCallTool(deps)] : [];
    },
  };
}

// ─── The service's report ────────────────────────────────────────────────────

export interface PhoneCallReport {
  /** `ended`: someone answered and it ended; `failed`: nobody answered, or it broke. */
  status?: unknown;
  seconds?: unknown;
  lines?: unknown;
}

const linesOf = (raw: unknown) =>
  (Array.isArray(raw) ? raw : [])
    .slice(-LINES_MAX)
    .map((l) => l as { who?: unknown; text?: unknown })
    .filter((l) => (l.who === "agent" || l.who === "person") && typeof l.text === "string" && l.text.trim())
    .map((l) => ({ who: l.who as "agent" | "person", text: (l.text as string).trim().slice(0, LINE_MAX) }));

/**
 * What the calling service reports when a call ends, at its one-use address: kept on the call, and told to the agent
 * in the conversation that asked for it (for the agent alone), which wakes it to tell the people there. Unknown or
 * spent addresses: false.
 */
export async function handlePhoneCallReport(deps: PhoneDeps, callId: string, secret: string, report: PhoneCallReport) {
  const [call] = await deps.db.select().from(schema.phoneCalls).where(eq(schema.phoneCalls.id, callId));
  if (!call || call.hookHash !== hash(secret) || call.endedAt) return false;
  const lines = linesOf(report.lines);
  const seconds =
    typeof report.seconds === "number" && Number.isFinite(report.seconds)
      ? Math.max(0, Math.min(Math.round(report.seconds), 24 * 3600))
      : null;
  const answered = report.status !== "failed" && lines.some((l) => l.who === "person");
  const [ended] = await deps.db
    .update(schema.phoneCalls)
    .set({ status: answered ? "ended" : "failed", seconds, lines, endedAt: now(deps) })
    .where(and(eq(schema.phoneCalls.id, callId), eq(schema.phoneCalls.hookHash, call.hookHash)))
    .returning({ id: schema.phoneCalls.id });
  if (!ended) return false;
  // The house voice is charged by the second from the workspace's credits, once (the call's id is the key).
  if (call.engine === "qwen" && deps.media && seconds !== null && seconds > 0) {
    try {
      const charged = await deps.media.chargeCall(call.orgId, { idempotencyKey: call.id, engine: "qwen", seconds });
      await deps.db
        .update(schema.phoneCalls)
        .set({ credits: charged.credits })
        .where(eq(schema.phoneCalls.id, call.id));
    } catch (error) {
      deps.log?.warn("phone call not charged", { callId: call.id, error: String(error) });
    }
  }
  const said = lines.map((l) => `${l.who === "agent" ? "You" : "Them"}: ${l.text}`).join("\n");
  const length = seconds === null ? "" : ` (${Math.max(1, Math.round(seconds / 60))} min)`;
  const text = answered
    ? `The call to ${call.to}${length} ended. What was said:\n${untrustedBlock("phone call", said, 60_000)}\nNow tell the people here how the call went, in their language, short and plain: what was talked about; what was decided or promised, and by whom; what is left to do, with who does it and by when (say "você" for what is theirs); and any insight worth their attention (how the person felt, a doubt, an objection, an opportunity). Then do what you promised on the call that you can do with your tools, and say so.`
    : `Nobody answered the call to ${call.to}${said ? `. What was heard:\n${untrustedBlock("phone call", said, 8000)}` : ""}.\nTell the people here in a line, and offer to try again later or to send a message instead.`;
  const [trigger] = call.triggerMessageId
    ? await deps.db
        .select({ hop: schema.messages.hop, stretchId: schema.messages.stretchId })
        .from(schema.messages)
        .where(and(eq(schema.messages.orgId, call.orgId), eq(schema.messages.id, call.triggerMessageId)))
    : [];
  const delivered = await deps.db.transaction((tx) =>
    deliverNotice(tx, {
      orgId: call.orgId,
      agentId: call.agentId,
      channelId: call.channelId,
      threadId: call.threadId,
      hop: trigger?.hop ?? 0,
      stretchId: trigger?.stretchId ?? null,
      // Agent-only: the people here hear what came of it from the agent, not this transcript.
      notice: { kind: "wait_result", from: "Your phone call", text, refs: { phoneCallId: call.id } },
      readOutside: true,
    }),
  );
  await publishDelivery(deps.pubsub, delivered);
  return true;
}
