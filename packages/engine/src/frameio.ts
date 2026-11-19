import { createHmac, timingSafeEqual } from "node:crypto";
import { and, type Database, eq, isNull, schema } from "@dougbot/db";
import { activeConnections, type ConnectorDeps, connectionHeaders } from "./connectors/connections";
import { customScope } from "./connectors/custom";
import { connectOverHttp, type McpConnect, type McpSession } from "./connectors/mcp";
import { presetForServer } from "./connectors/presets";
import { cutText } from "./format";
import type { RoutineEvent } from "./routines";
import { hasScope } from "./tools/scopes";

/**
 * Frame.io's webhook (ADR 0130, addendum 2026-11-14): comments and uploads in Frame.io start routines. Frame.io
 * sends only ids (`type`, `account`, `workspace`, `project`, `user`, `resource`), so before a routine runs the server
 * reads the comment or the file through the workspace's Frame.io connection, in code: the agent starts with the
 * words, the file and the link, and spends its run on what to do about them.
 */

/** The Frame.io events routines listen to: what the webhook made at next.frame.io must send. */
export const FRAMEIO_HOOK_EVENTS = ["comment.created", "file.upload.completed"] as const;

/** Where Frame.io's webhooks are made (an account owner or content admin). */
export const FRAMEIO_WEBHOOKS_PAGE = "https://next.frame.io/settings/webhooks";

/** How far a signed call's timestamp may be from now (Frame.io's guide: five minutes, against replays). */
export const FRAMEIO_TIMESTAMP_SKEW_S = 300;

/**
 * Frame.io's signature: `X-Frameio-Signature: v0=<hex>`, the HMAC-SHA256 with the webhook's signing secret of
 * `v0:<X-Frameio-Request-Timestamp>:<raw body>`, the timestamp within five minutes. The guide's prose ends the signed
 * string with a period its own sample leaves out: either form is taken (both need the secret).
 */
export function frameioSignatureValid(secret: string, body: string, headers: Headers, now = Date.now()) {
  const given = headers.get("x-frameio-signature")?.trim();
  const stamp = headers.get("x-frameio-request-timestamp")?.trim();
  if (!given || !stamp || !/^\d{1,12}$/.test(stamp)) return false;
  if (Math.abs(now / 1000 - Number(stamp)) > FRAMEIO_TIMESTAMP_SKEW_S) return false;
  const b = Buffer.from(given);
  return [`v0:${stamp}:${body}`, `v0:${stamp}:${body}.`].some((signed) => {
    const a = Buffer.from(`v0=${createHmac("sha256", secret).update(signed, "utf8").digest("hex")}`);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const get = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);
const id = (v: unknown) => (typeof v === "string" && /^[\w:.-]{1,200}$/.test(v) ? v : "");

/** A Frame.io call as routines see it: the event, its ids, and its identity so a retried delivery fires nothing twice. */
export interface FrameioEvent {
  event: RoutineEvent;
  summary: string;
  data: {
    accountId: string;
    workspaceId: string;
    projectId: string;
    userId: string;
    /** The comment's id (`frameio.comment_created`) or the file's (`frameio.file_uploaded`). */
    resourceId: string;
  };
  dedupeKey: string;
}

/** Frame.io's call in our event names, or null for one routines don't listen to. */
export function frameioEvent(payload: Record<string, unknown>): FrameioEvent | null {
  const type = payload.type;
  const resourceId = id(get(payload, "resource", "id"));
  if (!resourceId) return null;
  const data = {
    accountId: id(get(payload, "account", "id")),
    workspaceId: id(get(payload, "workspace", "id")),
    projectId: id(get(payload, "project", "id")),
    userId: id(get(payload, "user", "id")),
    resourceId,
  };
  if (type === "comment.created") {
    return {
      event: "frameio.comment_created",
      summary: "New comment on Frame.io",
      data,
      dedupeKey: `frameio:comment:${resourceId}`,
    };
  }
  if (type === "file.upload.completed") {
    return {
      event: "frameio.file_uploaded",
      summary: "New file on Frame.io",
      data,
      dedupeKey: `frameio:file:${resourceId}`,
    };
  }
  return null;
}

/** What a tool answered, as JSON when it is JSON. */
function parsed(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** The first string found at any of these paths (the answer's shape is Frame.io's: a few are tried). */
function pick(o: unknown, paths: string[][]): string {
  for (const p of paths) {
    const v = get(o, ...p);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** The comment (or file) the tool answered with: the item itself, its `data`, or a page's first item. */
const itemOf = (o: unknown): unknown => {
  const list = get(o, "items") ?? get(o, "data");
  if (Array.isArray(list)) return list[0];
  return get(o, "data") && typeof get(o, "data") === "object" ? get(o, "data") : o;
};

/** What the routine's agent reads of the event, as read from Frame.io: the words, who, where and the link. */
export interface FrameioDetails {
  summary: string;
  details: Record<string, string>;
}

/** How long the reads may take: Frame.io waits five seconds for an answer, then retries. */
export const FRAMEIO_READ_MS = 3_000;
const KEPT = 6_000;

/**
 * Reads the comment (and its file) or the file through the session: a comment's text, author, timecode and file;
 * a file's name, size, version and link. Whatever the answer's shape, its text is kept (cut), so nothing the agent
 * needs is lost when a field moved.
 */
export async function readFrameioDetails(session: McpSession, what: FrameioEvent): Promise<FrameioDetails | null> {
  // Frame.io's server asks for this before any other tool in a session.
  await session.callTool("mandatory_init", { include_accounts: false }).catch(() => null);
  const { accountId, resourceId } = what.data;
  if (!accountId) return null;
  const file = async (fileId: string) => {
    const res = await session.callTool("read_assets", {
      account_id: accountId,
      request: { action: "get_file", file_id: fileId },
    });
    return res.isError ? null : res.content;
  };
  const fileFields = (text: string | null) => {
    const item = itemOf(parsed(text ?? ""));
    return {
      file: pick(item, [["name"], ["file", "name"]]),
      link: pick(item, [["view_url"], ["links", "view"], ["url"], ["web_url"]]),
    };
  };
  if (what.event === "frameio.comment_created") {
    const res = await session.callTool("read_comments", {
      account_id: accountId,
      target: { type: "comment", id: resourceId },
    });
    if (res.isError) return null;
    const comment = itemOf(parsed(res.content));
    const text = pick(comment, [["text"], ["comment"], ["body"]]);
    const author = pick(comment, [["owner", "name"], ["author", "name"], ["user", "name"], ["owner_name"]]);
    const timecode = pick(comment, [["timecode"], ["timestamp"], ["anchor", "timecode"], ["start"]]);
    const fileId = id(pick(comment, [["file_id"], ["file", "id"], ["asset_id"], ["parent_id"]]));
    const fileText = fileId ? await file(fileId).catch(() => null) : null;
    const { file: name, link } = fileFields(fileText);
    const where = name ? ` on ${name}` : "";
    const who = author ? `${author}: ` : "";
    return {
      summary: text
        ? `New Frame.io comment${where}${timecode ? ` at ${timecode}` : ""}: ${who}${cutText(text, 240)}`
        : `New comment on Frame.io${where}`,
      details: {
        ...(text ? { text: cutText(text, 2_000) } : {}),
        ...(author ? { author } : {}),
        ...(timecode ? { timecode } : {}),
        ...(fileId ? { fileId } : {}),
        ...(name ? { file: name } : {}),
        ...(link ? { link } : {}),
        comment: cutText(res.content, KEPT),
        ...(fileText ? { fileRecord: cutText(fileText, KEPT) } : {}),
      },
    };
  }
  const fileText = await file(resourceId);
  if (!fileText) return null;
  const item = itemOf(parsed(fileText));
  const { file: name, link } = fileFields(fileText);
  const version = pick(item, [["version"], ["version_number"], ["head_version", "version"]]);
  return {
    summary: name ? `New file on Frame.io: ${name}${version ? ` (version ${version})` : ""}` : "New file on Frame.io",
    details: {
      ...(name ? { file: name } : {}),
      ...(version ? { version } : {}),
      ...(link ? { link } : {}),
      fileRecord: cutText(fileText, KEPT),
    },
  };
}

export type FrameioDeps = ConnectorDeps & { connect?: McpConnect };

/** The workspace's Frame.io connections (made from the Frame.io preset), newest first. */
export async function frameioConnections(db: Database, orgId: string) {
  return (await activeConnections(db, orgId))
    .filter((c) => presetForServer(c.serverUrl)?.id === "frameio")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Whether any active routine of the workspace waits on this event: the reads are made only for one.
 */
async function listened(db: Database, orgId: string, event: RoutineEvent) {
  const [row] = await db
    .select({ id: schema.routines.id })
    .from(schema.routines)
    .where(
      and(
        eq(schema.routines.orgId, orgId),
        eq(schema.routines.active, true),
        isNull(schema.routines.deletedAt),
        eq(schema.routines.triggerType, "event"),
        eq(schema.routines.event, event),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The payload each routine's run gets: the event read through the workspace's Frame.io connection, for a routine
 * whose agent may read that connection (ADR 0130 §4: an agent never hears what it couldn't read itself); the ids
 * alone for the others, or when nothing could be read in time.
 */
export async function frameioPayloads(deps: FrameioDeps | undefined, db: Database, orgId: string, what: FrameioEvent) {
  const bare = { summary: what.summary, ...what.data };
  const none = { connectionId: null as string | null, payloadFor: async () => bare };
  if (!deps || !(await listened(db, orgId, what.event))) return none;
  const connection = (await frameioConnections(db, orgId))[0];
  if (!connection) return none;
  const read = async () => {
    const session = await (deps.connect ?? connectOverHttp)(connection, await connectionHeaders(deps, connection));
    try {
      return await readFrameioDetails(session, what);
    } finally {
      await session.close().catch(() => undefined);
    }
  };
  const details = await Promise.race([
    read().catch(() => null),
    new Promise<null>((done) => setTimeout(() => done(null), FRAMEIO_READ_MS)),
  ]);
  const full = details ? { ...bare, summary: details.summary, ...details.details } : bare;
  return {
    connectionId: connection.id,
    payloadFor: async (routine: { agentId: string | null }) =>
      routine.agentId && (await hasScope(db, orgId, routine.agentId, connection.id, customScope(connection.id, "read")))
        ? full
        : bare,
  };
}
