import { createHash } from "node:crypto";
import type { BlobStore, PubSub } from "@dougbot/adapters";
import { and, type Database, eq, schema } from "@dougbot/db";
import { HOUSE_VOICES, isHouseVoice, isLiveVoice, LIVE_VOICES } from "@dougbot/providers/live-voice";
import { type Agent, getAgent } from "./agents";
import { recordAudit } from "./audit";
import { sniffImage, stripImageMetadata } from "./avatars";
import { caches } from "./cache";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { publishAgentsChanged } from "./events";
import { can, getMembership, requirePermission } from "./organizations";

const { agents } = schema;

/** The looks the app knows how to draw; anything else is refused. */
export const AGENT_LOOK = {
  colors: ["sky", "indigo", "violet", "rose", "amber", "green", "teal", "graphite"],
  eyes: ["round", "dots", "wide", "happy", "sleepy"],
  // Pixel accessories drawn by the agent engine (packages/ui/src/agent/engine.js). Glasses were
  // dropped (2026-10-15): stored ones still load, and the app shows them with no accessory.
  accessories: [
    "none",
    "hat",
    "cap",
    "headphones",
    "bow",
    "crown",
    "antenna",
    "headset",
    "beanie",
    "party",
    "flower",
    "scarf",
    // Drawn only by the DougBot (IDENTIDADE.md §6): a tie and keys.
    "tie",
    "keys",
  ],
  // The DougBot's forms: a look with a shape was picked for the bot and draws as picked (packages/tokens/src/look.ts).
  shapes: ["squircle", "quadrado", "petala", "monitor", "torre", "moeda", "hexagono"],
} as const;

/** A custom color picked in "Personalizar": "#rrggbb", stored lowercase in the same field as a preset name. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface AgentAppearance {
  color: (typeof AGENT_LOOK.colors)[number] | `#${string}`;
  eyes: (typeof AGENT_LOOK.eyes)[number];
  accessory: (typeof AGENT_LOOK.accessories)[number];
  shape?: (typeof AGENT_LOOK.shapes)[number];
}

export function validateAppearance(input: {
  color?: unknown;
  eyes?: unknown;
  accessory?: unknown;
  shape?: unknown;
}): AgentAppearance {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], field: string, or = ""): T => {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      throw new ValidationError(`appearance.${field} must be one of: ${allowed.join(", ")}${or}`);
    }
    return value as T;
  };
  return {
    color:
      typeof input.color === "string" && HEX_COLOR.test(input.color)
        ? (input.color.toLowerCase() as `#${string}`)
        : pick(input.color, AGENT_LOOK.colors, "color", " or #rrggbb"),
    eyes: pick(input.eyes, AGENT_LOOK.eyes, "eyes"),
    accessory: pick(input.accessory ?? "none", AGENT_LOOK.accessories, "accessory"),
    ...(input.shape == null ? {} : { shape: pick(input.shape, AGENT_LOOK.shapes, "shape") }),
  };
}

/**
 * Changes an agent's look (`appearance` on PATCH/POST …/agents). Its owner or
 * an admin; audited. `null` goes back to the default look.
 */
export async function setAgentAppearance(
  db: Database,
  actorId: string,
  orgId: string,
  agentId: string,
  appearance: { color?: unknown; eyes?: unknown; accessory?: unknown; shape?: unknown } | null,
  options: { pubsub?: PubSub } = {},
): Promise<Agent> {
  const membership = await requirePermission(db, actorId, orgId, "read");
  const agent = await getAgent(db, orgId, agentId);
  if (!agent || agent.archivedAt) throw new NotFoundError("Agent not found");
  if (!can(membership, "manage_agents") && !(agent.ownerUserId && agent.ownerUserId === actorId)) {
    throw new ForbiddenError("Only the agent's owner or an admin can change its look");
  }
  const look = appearance === null ? null : validateAppearance(appearance);
  const [updated] = await db
    .update(agents)
    .set({ appearance: look, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)))
    .returning();
  if (!updated) throw new NotFoundError("Agent not found");
  caches.agents.delete(`${orgId}:${agentId}`);
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "agent.appearance_changed",
    target: { type: "agent", id: agentId },
    details: { from: agent.appearance, to: look },
  });
  await publishAgentsChanged(options.pubsub, orgId);
  return updated;
}

// ── An agent's real photo ────────────────────────────────────────────────────

/** Up to 5 MB: the app sends it already cropped square; the server doesn't resize. */
export const AGENT_PHOTO_LIMITS = { maxBytes: 5 * 1024 * 1024 };
const PHOTO_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const PHOTO_FILE = /^[0-9a-f]{16}\.(jpg|png|webp)$/;
/**
 * Beside the workspace logo and the groups' photos (`org-logos/{orgId}/…`, the org's row in Postgres storage), so it
 * leaves with the workspace (`purgeOrgBlobs`) and never counts against its files. A deleted agent keeps its photo with
 * its look on the tombstone (ADR 0082: name, role and look stay for its old messages) until the workspace goes.
 */
export const agentPhotoKey = (orgId: string, agentId: string, file: string) =>
  `org-logos/${orgId}/agents/${agentId}/${file}`;
const AGENT_PHOTO_PATH = /^\/api\/app\/organizations\/([^/]+)\/agents\/([^/]+)\/photo\/([0-9a-f]{16}\.(jpg|png|webp))$/;
/** Where the photo is served (`GET …/organizations/{orgId}/agents/{agentId}/photo/{file}`), as the column keeps it. */
export const agentPhotoUrl = (orgId: string, agentId: string, file: string) =>
  `/api/app/organizations/${encodeURIComponent(orgId)}/agents/${encodeURIComponent(agentId)}/photo/${file}`;

/** The agent, when `actorId` may change its look: its owner or who manages agents (`setAgentAppearance`'s rule). */
async function lookEditableAgent(db: Database, actorId: string, orgId: string, agentId: string) {
  const membership = await requirePermission(db, actorId, orgId, "read");
  const agent = await getAgent(db, orgId, agentId);
  if (!agent || agent.archivedAt) throw new NotFoundError("Agent not found");
  if (!can(membership, "manage_agents") && !(agent.ownerUserId && agent.ownerUserId === actorId)) {
    throw new ForbiddenError("Only the agent's owner or an admin can change its look");
  }
  return agent;
}

/** JPEG, PNG or WebP up to 5 MB, told by its bytes, without metadata; named by a hash of its content. */
function readAgentPhoto(bytes: Uint8Array) {
  if (bytes.length === 0) throw new ValidationError("The image is empty", "agent_photo.empty");
  if (bytes.length > AGENT_PHOTO_LIMITS.maxBytes)
    throw new ValidationError("The image can be up to 5 MB", "agent_photo.too_large", { maxMb: 5 });
  const type = sniffImage(bytes);
  if (!type) throw new ValidationError("Use a JPEG, PNG or WebP image", "agent_photo.type");
  const body = stripImageMetadata(bytes, type);
  const file = `${createHash("sha256").update(body).digest("hex").slice(0, 16)}.${PHOTO_EXT[type]}`;
  return { body, type, file };
}

async function removeStoredAgentPhoto(
  blobs: BlobStore,
  orgId: string,
  agentId: string,
  photo: string | null | undefined,
  keep: string | null,
) {
  const m = photo ? AGENT_PHOTO_PATH.exec(photo) : null;
  if (!m || decodeURIComponent(m[1] ?? "") !== orgId || decodeURIComponent(m[2] ?? "") !== agentId) return;
  if (m[3] === keep) return;
  await blobs.delete(agentPhotoKey(orgId, agentId, m[3] as string)).catch(() => undefined);
}

/**
 * Sets an agent's real photo (`PUT /api/app/organizations/{orgId}/agents/{agentId}/photo`, multipart `file`): whoever may
 * change its look; JPEG, PNG or WebP up to 5 MB by its bytes, no metadata, in the platform bucket
 * (`org-logos/{orgId}/agents/{agentId}/{hash}.{ext}`), served to the org's members. The previous file is removed. Audited.
 */
export async function setAgentPhoto(
  deps: { db: Database; blobs: BlobStore; pubsub?: PubSub },
  actorId: string,
  orgId: string,
  agentId: string,
  bytes: Uint8Array,
): Promise<{ photo: string }> {
  const agent = await lookEditableAgent(deps.db, actorId, orgId, agentId);
  const { body, type, file } = readAgentPhoto(bytes);
  await deps.blobs.put(agentPhotoKey(orgId, agentId, file), body, { contentType: type });
  const photo = agentPhotoUrl(orgId, agentId, file);
  await deps.db
    .update(agents)
    .set({ photo, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)));
  caches.agents.delete(`${orgId}:${agentId}`);
  await removeStoredAgentPhoto(deps.blobs, orgId, agentId, agent.photo, file);
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "agent.photo_changed",
    target: { type: "agent", id: agentId },
  });
  await publishAgentsChanged(deps.pubsub, orgId);
  return { photo };
}

/** Removes an agent's photo (`DELETE …/photo`): back to its drawn look. Audited. */
export async function removeAgentPhoto(
  deps: { db: Database; blobs: BlobStore; pubsub?: PubSub },
  actorId: string,
  orgId: string,
  agentId: string,
) {
  const agent = await lookEditableAgent(deps.db, actorId, orgId, agentId);
  await deps.db
    .update(agents)
    .set({ photo: null, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)));
  caches.agents.delete(`${orgId}:${agentId}`);
  await removeStoredAgentPhoto(deps.blobs, orgId, agentId, agent.photo, null);
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "agent.photo_removed",
    target: { type: "agent", id: agentId },
  });
  await publishAgentsChanged(deps.pubsub, orgId);
}

/**
 * The stored photo for `GET /api/app/organizations/{orgId}/agents/{agentId}/photo/{file}`: only for the org's members, and
 * only an agent of that org (a former one's too, which its old messages still show).
 */
export async function agentPhotoFile(
  deps: { db: Database; blobs: BlobStore },
  viewerId: string,
  orgId: string,
  agentId: string,
  file: string,
) {
  if (!PHOTO_FILE.test(file) || !/^[0-9a-f-]{36}$/i.test(agentId) || !/^[0-9a-f-]{36}$/i.test(orgId))
    throw new NotFoundError("Not found");
  if (!(await getMembership(deps.db, viewerId, orgId))) throw new NotFoundError("Not found");
  const [agent] = await deps.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)));
  if (!agent) throw new NotFoundError("Not found");
  const object = await deps.blobs.get(agentPhotoKey(orgId, agentId, file));
  if (!object) throw new NotFoundError("Not found");
  return object;
}

/**
 * Its voice on calls and when it tells a message (ADR doug-0006): like its look, its owner or an admin picks it. Null
 * goes back to the one its id gives. `engine: "house"` sets its house voice instead (docs/adr/doug-0036-house-voice.md):
 * the two engines' voices are their own, and an agent keeps one of each.
 */
export async function setAgentVoice(
  db: Database,
  actorId: string,
  orgId: string,
  agentId: string,
  voice: string | null,
  options: { pubsub?: PubSub; engine?: "gpt-live" | "house" } = {},
): Promise<Agent> {
  const membership = await requirePermission(db, actorId, orgId, "read");
  const agent = await getAgent(db, orgId, agentId);
  if (!agent || agent.archivedAt) throw new NotFoundError("Agent not found");
  if (!can(membership, "manage_agents") && !(agent.ownerUserId && agent.ownerUserId === actorId)) {
    throw new ForbiddenError("Only the agent's owner or an admin can change its voice");
  }
  const house = options.engine === "house";
  if (voice !== null && (house ? !isHouseVoice(voice) : !isLiveVoice(voice)))
    throw new ValidationError(`voice must be one of: ${(house ? HOUSE_VOICES : LIVE_VOICES).join(", ")}`);
  const [updated] = await db
    .update(agents)
    .set({ ...(house ? { houseVoice: voice } : { voice }), updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)))
    .returning();
  if (!updated) throw new NotFoundError("Agent not found");
  caches.agents.delete(`${orgId}:${agentId}`);
  caches.agents.delete(`${orgId}:team`);
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "agent.voice_changed",
    target: { type: "agent", id: agentId },
    details: { from: house ? agent.houseVoice : agent.voice, to: voice, engine: house ? "house" : "gpt-live" },
  });
  await publishAgentsChanged(options.pubsub, orgId);
  return updated;
}

/**
 * How the agent behaves on voice calls, on top of the base and the workspace's notes (docs/adr/doug-0006-live-voice.md
 * §11): its owner or an admin sets them, like its voice.
 */
export async function setAgentCallNotes(
  db: Database,
  actorId: string,
  orgId: string,
  agentId: string,
  notes: string | null,
  options: { pubsub?: PubSub } = {},
): Promise<Agent> {
  const membership = await requirePermission(db, actorId, orgId, "read");
  const agent = await getAgent(db, orgId, agentId);
  if (!agent || agent.archivedAt) throw new NotFoundError("Agent not found");
  if (!can(membership, "manage_agents") && !(agent.ownerUserId && agent.ownerUserId === actorId)) {
    throw new ForbiddenError("Only the agent's owner or an admin can change how it behaves on calls");
  }
  const text = notes?.trim().slice(0, 1500) || null;
  const [updated] = await db
    .update(agents)
    .set({ liveCallNotes: text, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)))
    .returning();
  if (!updated) throw new NotFoundError("Agent not found");
  caches.agents.delete(`${orgId}:${agentId}`);
  caches.agents.delete(`${orgId}:team`);
  await recordAudit(db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "agent.call_notes_changed",
    target: { type: "agent", id: agentId },
  });
  await publishAgentsChanged(options.pubsub, orgId);
  return updated;
}
