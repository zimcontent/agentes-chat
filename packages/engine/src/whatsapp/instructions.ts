import { firstWords, ROUTE_LIMITS } from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import { getAgent } from "../agents";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { requirePermission } from "../organizations";
import { WHATSAPP_INSTRUCTIONS_MAX } from "./accounts";
import { thinkOnce, type WhatsAppAgentDeps } from "./agent";
import { whatsappBrainOf, whatsappThinker } from "./brain";

/**
 * A new direction for a number's instructions, typed or spoken (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-17): what a
 * person of the team said is put into words by the server's speech engines (the same that hear voice messages, ADR
 * 0100), and the AI that answers on the number rewrites the whole Markdown with it. Nothing is saved here: the draft
 * goes back to the settings, where the person reads it and saves it as any other change to the instructions.
 */

/** The longest typed direction. */
export const WHATSAPP_DIRECTION_MAX = 4000;
/** The largest recording taken: a few minutes of speech from the phone's recorder, under the 8 MiB every request body is capped at. */
export const WHATSAPP_DIRECTION_AUDIO_MAX_BYTES = 7 * 1024 * 1024;
/** The longest recording heard. */
export const WHATSAPP_DIRECTION_AUDIO_MAX_SECONDS = 5 * 60;
/** An engine works alone this long before the next starts beside it. */
const ALONE_MS = 8000;

export interface WhatsAppDirectionInput {
  /** The instructions as the settings hold them now, saved or not; absent: the saved ones. */
  current?: string;
  /** What the person typed. */
  text?: string;
  /** What the person recorded. */
  audio?: { bytes: Uint8Array; contentType: string; durationMs?: number };
}

export interface WhatsAppInstructionsDraft {
  /** The recording in words; empty when only text came. */
  heard: string;
  /** The whole instructions with the direction in them, to be read and saved by the person. */
  instructions: string;
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["instructions"],
  properties: { instructions: { type: "string" } },
} as const;

const SYSTEM = `You keep the instructions a business's agent follows on one of its WhatsApp numbers: a Markdown document that says how the agent behaves with the people who write to that number (what it answers, its tone, what it never says, when it hands the conversation to a person).

A person of the team gives you a new direction. It may have been spoken and put into words by a machine, so it can ramble, repeat itself or carry small transcription mistakes: take what they mean.

Rewrite the whole document with the direction in it:
- Keep everything that is still true, in its place.
- Change what the direction changes, and remove what it contradicts.
- Add what is new where it belongs, under a fitting heading.
- Never invent a rule, a price, a date or a fact nobody gave.
- Write to the agent, in the language the document is written in (the direction's language when the document is empty), with short headings and plain bullets.
- At most ${WHATSAPP_INSTRUCTIONS_MAX} characters.

Answer with one JSON object and nothing else: {"instructions": "<the whole Markdown document>"}`;

/** The model's answer, checked: the document in `instructions`, or a bare Markdown answer from a model that forgot. */
export function parseInstructionsDraft(value: unknown): string | null {
  let found = value;
  if (typeof value === "string") {
    const text = value.trim();
    const from = text.indexOf("{");
    const to = text.lastIndexOf("}");
    found = null;
    if (from === 0 && to > from) {
      try {
        found = JSON.parse(text.slice(from, to + 1));
      } catch {}
    }
    if (found === null) return text && !text.startsWith("{") ? text.slice(0, WHATSAPP_INSTRUCTIONS_MAX) : null;
  }
  if (typeof found !== "object" || found === null) return null;
  const { instructions } = found as Record<string, unknown>;
  if (typeof instructions !== "string" || !instructions.trim()) return null;
  return instructions.trim().slice(0, WHATSAPP_INSTRUCTIONS_MAX);
}

/**
 * `POST …/whatsapp/accounts/{id}/instructions/draft`: the number's instructions rewritten with a new direction, by
 * the AI that answers there (the number's own, else its agent's). Whoever may change the number (`manage_connectors`);
 * the number needs its agent. The model's use is the agent's, as any answer of it.
 */
export async function draftWhatsAppInstructions(
  deps: Pick<WhatsAppAgentDeps, "db" | "models" | "machines" | "speech">,
  userId: string,
  orgId: string,
  accountId: string,
  input: WhatsAppDirectionInput,
): Promise<WhatsAppInstructionsDraft> {
  await requirePermission(deps.db, userId, orgId, "manage_connectors");
  const [row] = await deps.db
    .select()
    .from(schema.whatsappAccounts)
    .where(and(eq(schema.whatsappAccounts.orgId, orgId), eq(schema.whatsappAccounts.id, accountId)));
  if (!row) throw new NotFoundError("WhatsApp number not found");
  const agent = row.agentId ? await getAgent(deps.db, orgId, row.agentId) : null;
  if (!agent || agent.archivedAt) throw new ConflictError("Choose the number's agent first", "whatsapp.no_agent");

  const typed = (input.text ?? "").trim();
  if (typed.length > WHATSAPP_DIRECTION_MAX) {
    throw new ValidationError(`A direction has at most ${WHATSAPP_DIRECTION_MAX} characters`);
  }
  let heard = "";
  if (input.audio) {
    if (input.audio.bytes.byteLength > WHATSAPP_DIRECTION_AUDIO_MAX_BYTES) {
      throw new ValidationError("The recording is too long", "whatsapp.recording_long");
    }
    if ((input.audio.durationMs ?? 0) > WHATSAPP_DIRECTION_AUDIO_MAX_SECONDS * 1000) {
      throw new ValidationError("The recording is too long", "whatsapp.recording_long");
    }
    const engines = deps.speech?.() ?? [];
    if (engines.length === 0) throw new ConflictError("This server doesn't hear recordings", "whatsapp.voice_off");
    const words = await firstWords(
      engines,
      {
        audio: input.audio.bytes,
        contentType: input.audio.contentType,
        language: null,
        terms: [agent.name, row.label].filter(Boolean),
        orgId,
        ...(input.audio.durationMs ? { durationMs: input.audio.durationMs } : {}),
      },
      ALONE_MS,
    ).catch(() => null);
    heard = (words?.text ?? "").replace(/\s+/g, " ").trim().slice(0, WHATSAPP_DIRECTION_MAX);
    if (!heard && !typed) throw new ValidationError("Nothing could be heard in the recording", "whatsapp.unheard");
  }
  const direction = [typed, heard].filter(Boolean).join("\n\n");
  if (!direction) throw new ValidationError("Say or write what changes");

  const current = (input.current ?? row.instructions ?? "").slice(0, WHATSAPP_INSTRUCTIONS_MAX);
  const prompt = [
    `# The agent\n${agent.name} (@${agent.handle}), on the number "${row.label}".`,
    `# The instructions now\n${current.trim() || "(empty: write them from the direction)"}`,
    `# The new direction\n${direction}`,
  ]
    .join("\n\n")
    .slice(0, ROUTE_LIMITS.prompt);
  const thinker = whatsappThinker(agent, whatsappBrainOf(row.brain));
  const raw = await thinkOnce(deps, thinker, { system: SYSTEM, prompt, schema: DRAFT_SCHEMA, maxTokens: 8000 });
  const instructions = parseInstructionsDraft(raw);
  if (!instructions) throw new Error("the agent's AI didn't answer with the instructions");
  return { heard, instructions };
}
