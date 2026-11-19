import { createHash, randomBytes } from "node:crypto";
import { isVoiceOutId, type KeyWrapper, type PubSub, type VoiceOut, type WhatsAppGateway } from "@dougbot/adapters";
import { and, asc, type Database, eq, inArray, schema } from "@dougbot/db";
import { openSecret, sealSecret } from "../crypto";
import { NotFoundError, ValidationError } from "../errors";
import { publishUserEvent } from "../events";
import { can, requireActiveMembership, requirePermission } from "../organizations";

/**
 * WhatsApp numbers of a workspace. Who may do what:
 * - connecting, renaming, removing a number and choosing its people and its agent: `manage_connectors`;
 * - reading and answering a number's conversations: only the people on its list (`people`), whoever manages
 *   connectors included only when listed. The person who connects a number starts on its list.
 * The gateway holds the sessions; nothing here reaches it without `gateway` (no `WHATSAPP_GATEWAY_URL`: every call
 * answers "off").
 */
export interface WhatsAppDeps {
  db: Database;
  gateway: WhatsAppGateway | null;
  /** The current wrapper first, then the ones that only unwrap. */
  keyWrappers: KeyWrapper[];
  pubsub?: PubSub;
  /** This server's address as the gateway reaches it (`WHATSAPP_HOOK_URL`), without a trailing slash. */
  hookBase: string;
  /** Text to speech, for the agent's voice notes (`whatsapp/voice-notes.ts`); absent: it writes. */
  voiceOut?: VoiceOut | null;
}

export type WhatsAppAccountRow = typeof schema.whatsappAccounts.$inferSelect;

export const WHATSAPP_LABEL_MAX = 40;
/**
 * How the agent may talk on a number: the wait before it reads a conversation (seconds), how fast it types, how
 * many messages an answer may be, and how long it stays quiet after a person wrote (minutes). The wait has a floor:
 * an answer that comes back at once is what a machine does.
 */
export const WHATSAPP_AGENT_STYLE_BOUNDS = {
  waitSeconds: { min: 3, max: 300 },
  paces: ["fast", "natural", "slow"] as const,
  messages: { min: 1, max: 3 },
  quietMinutes: { min: 5, max: 24 * 60 },
};
/** The most a number's instructions for its agent may hold: a few pages, read on every answer. */
export const WHATSAPP_INSTRUCTIONS_MAX = 20_000;
/** A QR code WhatsApp still accepts: it makes a new one about every 20 s, and the gateway tells each. */
export const WHATSAPP_QR_FRESH_MS = 60_000;

export interface WhatsAppAgentStyle {
  /** Seconds it waits after a message before reading the conversation. */
  waitSeconds: number;
  /** How fast it types. */
  pace: "fast" | "natural" | "slow";
  /** The most messages one answer is split in. */
  messages: number;
  /** Minutes it stays quiet in a conversation after a person wrote there. */
  quietMinutes: number;
  /** It sends voice notes: always to a voice message, now and then on its own (`whatsapp/voice-notes.ts`). */
  voiceNotes: boolean;
  /** The voice it speaks in (the provider's id); null: the default one. */
  voice: string | null;
}

export interface WhatsAppAccountView {
  id: string;
  label: string;
  status: WhatsAppAccountRow["status"];
  phone: string | null;
  /** The name the phone shows for itself (outside text). */
  pushName: string;
  /** A `data:image/png` address to show now; null when there is none or it is too old to read. */
  qr: string | null;
  people: string[];
  agentId: string | null;
  /** How the agent carries itself on this number (Markdown); null for someone who can't change the number. */
  instructions: string | null;
  /** The agent answers this number's conversations now. */
  agentOn: boolean;
  /** How the agent talks here (`WHATSAPP_AGENT_STYLE`). */
  agentStyle: WhatsAppAgentStyle;
  /** The number answers with an AI of its own (`whatsapp/brain.ts`); false: with its agent's. */
  ownAi: boolean;
  /** Whether the asker may read and answer its conversations. */
  mine: boolean;
  /** Whether the asker may change or remove it. */
  manage: boolean;
  createdAt: string;
}

/** The gateway, or the refusal every call makes without one. */
export function whatsappGateway(deps: Pick<WhatsAppDeps, "gateway">): WhatsAppGateway {
  if (!deps.gateway) throw new NotFoundError("WhatsApp is off on this server");
  return deps.gateway;
}

const tokenAad = (orgId: string, id: string) => `whatsapp:${orgId}:${id}`;
export const hookHash = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** The number's token at the gateway, opened for one call. */
export function accountToken(deps: Pick<WhatsAppDeps, "keyWrappers">, row: WhatsAppAccountRow) {
  return openSecret(
    deps.keyWrappers,
    { ciphertext: row.tokenCiphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId },
    tokenAad(row.orgId, row.id),
  );
}

function view(row: WhatsAppAccountRow, userId: string, manage: boolean, now = Date.now()): WhatsAppAccountView {
  const fresh = row.status === "qr" && row.qrAt && now - row.qrAt.getTime() < WHATSAPP_QR_FRESH_MS;
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    phone: row.phone,
    pushName: row.pushName,
    // Only someone who may connect it reads its code: reading it is taking the number.
    qr: manage && fresh ? row.qrImage : null,
    people: row.people,
    agentId: row.agentId,
    instructions: manage ? row.instructions : null,
    agentOn: row.agentId !== null && row.agentOn,
    agentStyle: {
      waitSeconds: row.agentWaitSeconds,
      pace: row.agentPace,
      messages: row.agentMessages,
      quietMinutes: row.agentQuietMinutes,
      voiceNotes: row.agentVoiceNotes,
      voice: row.agentVoice,
    },
    ownAi: row.agentId !== null && row.brain !== null,
    mine: row.people.includes(userId),
    manage,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Tells the number's people, and whoever asked, that something of it changed: their apps read again. */
export async function publishWhatsAppChanged(
  deps: Pick<WhatsAppDeps, "pubsub">,
  row: Pick<WhatsAppAccountRow, "id" | "orgId" | "people">,
  extra: { chatId?: string; also?: string[] } = {},
) {
  const event = { type: "whatsapp.changed", accountId: row.id, ...(extra.chatId ? { chatId: extra.chatId } : {}) };
  for (const userId of new Set([...row.people, ...(extra.also ?? [])])) {
    await publishUserEvent(deps.pubsub, row.orgId, userId, event);
  }
}

/** The numbers the asker may use, and every number for someone who manages connectors. */
export async function listWhatsAppAccounts(deps: WhatsAppDeps, userId: string, orgId: string) {
  const membership = await requireActiveMembership(deps.db, userId, orgId);
  const manage = can(membership, "manage_connectors");
  const rows = await deps.db
    .select()
    .from(schema.whatsappAccounts)
    .where(eq(schema.whatsappAccounts.orgId, orgId))
    .orderBy(asc(schema.whatsappAccounts.createdAt));
  return {
    on: deps.gateway !== null,
    manage,
    accounts: rows.filter((row) => manage || row.people.includes(userId)).map((row) => view(row, userId, manage)),
  };
}

async function accountRow(db: Database, orgId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(schema.whatsappAccounts)
    .where(and(eq(schema.whatsappAccounts.orgId, orgId), eq(schema.whatsappAccounts.id, accountId)));
  if (!row) throw new NotFoundError("WhatsApp number not found");
  return row;
}

/** The number, for someone on its list. Anyone else gets "not found": a number's existence is its people's. */
export async function requireWhatsAppUse(db: Database, userId: string, orgId: string, accountId: string) {
  await requireActiveMembership(db, userId, orgId);
  const row = await accountRow(db, orgId, accountId);
  if (!row.people.includes(userId)) throw new NotFoundError("WhatsApp number not found");
  return row;
}

function cleanLabel(label: string) {
  const clean = label.trim().replace(/\s+/g, " ");
  if (!clean) throw new ValidationError("Give the number a name");
  if (clean.length > WHATSAPP_LABEL_MAX)
    throw new ValidationError(`A name has at most ${WHATSAPP_LABEL_MAX} characters`);
  return clean;
}

/** Asks the gateway to start (or restart) the number's session; its QR code arrives as an event. */
async function startSession(deps: WhatsAppDeps, row: WhatsAppAccountRow, hookSecret: string) {
  const gateway = whatsappGateway(deps);
  await gateway.connect(await accountToken(deps, row), {
    webhookUrl: `${deps.hookBase}/api/webhooks/whatsapp/${hookSecret}`,
  });
}

/** A new number: its place at the gateway, then its session. The QR code follows (`whatsapp.changed`). */
export async function createWhatsAppAccount(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  input: { label: string },
) {
  await requirePermission(deps.db, userId, orgId, "manage_connectors");
  const gateway = whatsappGateway(deps);
  const label = cleanLabel(input.label);
  const id = Bun.randomUUIDv7();
  const token = randomBytes(24).toString("hex");
  const hookSecret = randomBytes(32).toString("hex");
  // The gateway shows this name in its own logs: the row's id says which number without saying whose.
  const { instanceId } = await gateway.createInstance({ name: `agentes-${id}`, token });
  const sealed = await sealSecret(deps.keyWrappers[0] as KeyWrapper, token, tokenAad(orgId, id));
  const [row] = await deps.db
    .insert(schema.whatsappAccounts)
    .values({
      id,
      orgId,
      label,
      instanceId,
      tokenCiphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
      hookHash: hookHash(hookSecret),
      people: [userId],
      createdBy: userId,
    })
    .returning();
  if (!row) throw new Error("whatsapp account not inserted");
  try {
    await startSession(deps, row, hookSecret);
  } catch (error) {
    // Nothing to keep of a number that never started: the gateway's side goes too, as far as it answers.
    await deps.db.delete(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.id, id));
    await gateway.deleteInstance(instanceId).catch(() => {});
    throw error;
  }
  await publishWhatsAppChanged(deps, row);
  return view(row, userId, true);
}

/**
 * A new QR code for a number that is out (`logged_out`, `disconnected`, or one whose code was never read). Its
 * events' address changes with it: the old secret stops being one.
 */
export async function reconnectWhatsAppAccount(deps: WhatsAppDeps, userId: string, orgId: string, accountId: string) {
  await requirePermission(deps.db, userId, orgId, "manage_connectors");
  const current = await accountRow(deps.db, orgId, accountId);
  if (current.status === "connected") throw new ValidationError("This number is connected");
  const hookSecret = randomBytes(32).toString("hex");
  const [row] = await deps.db
    .update(schema.whatsappAccounts)
    .set({ hookHash: hookHash(hookSecret), status: "pending", qrImage: null, qrAt: null, lastError: null })
    .where(eq(schema.whatsappAccounts.id, accountId))
    .returning();
  if (!row) throw new NotFoundError("WhatsApp number not found");
  await startSession(deps, row, hookSecret);
  await publishWhatsAppChanged(deps, row, { also: [userId] });
  return view(row, userId, true);
}

/** Its name, its people (members of the workspace) and the agent that answers it (null: nobody but people). */
export async function updateWhatsAppAccount(
  deps: WhatsAppDeps,
  userId: string,
  orgId: string,
  accountId: string,
  input: {
    label?: string;
    people?: string[];
    agentId?: string | null;
    instructions?: string;
    agentOn?: boolean;
    agentStyle?: Partial<WhatsAppAgentStyle>;
  },
) {
  await requirePermission(deps.db, userId, orgId, "manage_connectors");
  const current = await accountRow(deps.db, orgId, accountId);
  const set: Partial<WhatsAppAccountRow> = {};
  if (input.label !== undefined) set.label = cleanLabel(input.label);
  if (input.people !== undefined) {
    const people = [...new Set(input.people)];
    const members = people.length
      ? await deps.db
          .select({ userId: schema.organizationMembers.userId })
          .from(schema.organizationMembers)
          .where(and(eq(schema.organizationMembers.orgId, orgId), inArray(schema.organizationMembers.userId, people)))
      : [];
    if (members.length !== people.length) throw new ValidationError("Everyone on the list must be a member");
    set.people = people;
  }
  if (input.agentId !== undefined) {
    if (input.agentId !== null) {
      const [agent] = await deps.db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.id, input.agentId)));
      if (!agent) throw new ValidationError("That agent isn't in this workspace");
    }
    set.agentId = input.agentId;
    // The number's own AI was chosen among that agent's accounts and computer: another agent starts on its own.
    if (input.agentId !== current.agentId) set.brain = null;
    // A number with no agent has nothing to turn on.
    if (input.agentId === null) set.agentOn = false;
  }
  if (input.agentOn !== undefined) {
    const agentId = input.agentId !== undefined ? input.agentId : current.agentId;
    if (input.agentOn && !agentId) throw new ValidationError("Choose the agent that answers first");
    set.agentOn = input.agentOn && agentId !== null;
  }
  if (input.instructions !== undefined) {
    const instructions = input.instructions.replace(/\r\n?/g, "\n").trim();
    if (instructions.length > WHATSAPP_INSTRUCTIONS_MAX) {
      throw new ValidationError(`Instructions have at most ${WHATSAPP_INSTRUCTIONS_MAX} characters`);
    }
    set.instructions = instructions;
  }
  if (input.agentStyle) {
    const style = input.agentStyle;
    const within = (value: number, range: { min: number; max: number }, what: string) => {
      if (!Number.isInteger(value) || value < range.min || value > range.max) {
        throw new ValidationError(`${what} goes from ${range.min} to ${range.max}`);
      }
      return value;
    };
    const bounds = WHATSAPP_AGENT_STYLE_BOUNDS;
    if (style.waitSeconds !== undefined)
      set.agentWaitSeconds = within(style.waitSeconds, bounds.waitSeconds, "The wait");
    if (style.messages !== undefined) set.agentMessages = within(style.messages, bounds.messages, "Messages");
    if (style.quietMinutes !== undefined) {
      set.agentQuietMinutes = within(style.quietMinutes, bounds.quietMinutes, "The quiet time");
    }
    if (style.voiceNotes !== undefined) {
      if (typeof style.voiceNotes !== "boolean") throw new ValidationError("Voice notes are on or off");
      set.agentVoiceNotes = style.voiceNotes;
    }
    if (style.voice !== undefined) {
      if (style.voice !== null && !isVoiceOutId(style.voice)) throw new ValidationError("Not a voice");
      set.agentVoice = style.voice;
    }
    if (style.pace !== undefined) {
      if (!bounds.paces.includes(style.pace)) throw new ValidationError("Unknown pace");
      set.agentPace = style.pace;
    }
  }
  if (Object.keys(set).length === 0) return view(current, userId, true);
  const [row] = await deps.db
    .update(schema.whatsappAccounts)
    .set(set)
    .where(eq(schema.whatsappAccounts.id, accountId))
    .returning();
  if (!row) throw new NotFoundError("WhatsApp number not found");
  // Whoever left the list hears it too: their app drops the number.
  await publishWhatsAppChanged(deps, row, { also: [...current.people, userId] });
  return view(row, userId, true);
}

/**
 * Removes the number: its session ends on the phone too, and its conversations here go with it. A gateway that
 * doesn't answer doesn't keep the number here: its side is cleaned by hand then, and the error says so.
 */
export async function removeWhatsAppAccount(deps: WhatsAppDeps, userId: string, orgId: string, accountId: string) {
  await requirePermission(deps.db, userId, orgId, "manage_connectors");
  const row = await accountRow(deps.db, orgId, accountId);
  let leftover: string | null = null;
  if (deps.gateway) {
    const gateway = deps.gateway;
    try {
      if (row.status === "connected") await gateway.logout(await accountToken(deps, row)).catch(() => {});
      await gateway.deleteInstance(row.instanceId);
    } catch (error) {
      leftover = String(error);
    }
  } else {
    leftover = "the gateway is off";
  }
  await deps.db.delete(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.id, accountId));
  await publishWhatsAppChanged(deps, row, { also: [userId] });
  return { removed: true, leftover };
}
