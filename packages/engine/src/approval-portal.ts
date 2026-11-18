import {
  type ApprovalPortal,
  ApprovalPortalError,
  PORTAL_CARD_STATES,
  PORTAL_FILE_BYTES,
  PORTAL_TYPES,
  type PortalCard,
  type PortalClientColor,
  type PortalItem,
  type PortalJob,
  type PortalState,
  type PortalStatus,
  type PortalType,
} from "@agenteschat/adapters";
import type { Database } from "@agenteschat/db";
import {
  labelIdsByName,
  memberIdsByName,
  myPortalWork,
  type PlanCard,
  planTool,
  portalPlan,
} from "./approval-portal-plan";
import { portalHere } from "./approval-portal-tasks";
import { type ArtifactActor, type ArtifactDeps, artifactFile, storedFileOfArtifact } from "./artifacts";
import { ValidationError } from "./errors";
import { personBehindCall } from "./requester";
import { reviewGate, reviewGateRefusal } from "./review-gate";
import { replyThreadOf } from "./runs";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "./tools/types";
import { untrustedBlock } from "./untrusted";

/**
 * The approval portal inside the workspace (ADR 9001): the team's board of what it makes for each client, and the
 * one way a post goes up for the client's approval. Two cards are the team's own (`todo`, `doing`); from the send on,
 * a post is the portal's and its column follows what the client does there. The send is code from end to end: a
 * person's button and an agent's tool both end in `sendForApproval`, and no model sits between them and the portal.
 */

/** The board's columns, in order. `posted` is the board's second tab. */
export const PORTAL_COLUMNS = ["todo", "doing", "approval", "adjusting", "approved", "scheduled", "posted"] as const;
export type PortalColumn = (typeof PORTAL_COLUMNS)[number];

/**
 * Whose move it is: the client's (`approval`), the team's (`adjusting`, and `approved`: it waits for the team to
 * schedule it), nobody's (`scheduled`, `posted`).
 */
const COLUMN_OF: Record<PortalStatus, PortalColumn> = {
  sent: "approval",
  seen: "approval",
  adjusted: "approval",
  adjust_requested: "adjusting",
  adjusting: "adjusting",
  approved: "approved",
  scheduled: "scheduled",
  published: "posted",
};

export const portalColumnOf = (item: Pick<PortalItem, "status">): PortalColumn => COLUMN_OF[item.status];

/**
 * Posts the client approved that nobody released yet, across every client, the longest waiting first: what waits for
 * a person of the team to schedule it by hand (ADR 9001, addendum 2026-11-17). Home shows them under "Waiting on you".
 */
export async function portalToSchedule(portal: ApprovalPortal): Promise<PortalItem[]> {
  return (await portal.items())
    .filter((item) => item.status === "approved" && !item.released)
    .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "") || a.id.localeCompare(b.id));
}

export interface PortalClientSummary {
  client: string;
  counts: Record<PortalColumn, number>;
  /** Everything not posted yet. */
  open: number;
  /** The next date among what is scheduled, if any. */
  next: string | null;
  /** The colour the team gave it; null: none, the apps draw its mark in a hue of its name. */
  color: PortalClientColor | null;
  /** Its logo's stored file (`portalLogoPath` makes its address); null: none. */
  logo: string | null;
}

export interface PortalBoard {
  client: string;
  state: PortalState;
  cards: { todo: PortalCard[]; doing: PortalCard[] };
  items: {
    approval: PortalItem[];
    adjusting: PortalItem[];
    approved: PortalItem[];
    scheduled: PortalItem[];
    posted: PortalItem[];
  };
}

const emptyCounts = (): Record<PortalColumn, number> => ({
  todo: 0,
  doing: 0,
  approval: 0,
  adjusting: 0,
  approved: 0,
  scheduled: 0,
  posted: 0,
});

/** Every client with its counts per column, the ones with the most open work first. */
export async function portalOverview(portal: ApprovalPortal): Promise<PortalClientSummary[]> {
  const [items, cards, looks] = await Promise.all([portal.items(), portal.cards(), portal.clientLooks()]);
  const byClient = new Map<string, PortalClientSummary>();
  const of = (client: string) => {
    let summary = byClient.get(client);
    if (!summary) {
      summary = {
        client,
        counts: emptyCounts(),
        open: 0,
        next: null,
        color: looks.colors[client] ?? null,
        logo: looks.logos[client] ?? null,
      };
      byClient.set(client, summary);
    }
    return summary;
  };
  for (const item of items) {
    const summary = of(item.client);
    const column = portalColumnOf(item);
    summary.counts[column] += 1;
    if (column === "scheduled" && item.scheduledFor && (!summary.next || item.scheduledFor < summary.next)) {
      summary.next = item.scheduledFor;
    }
  }
  // A card that was sent is counted as its post, in the portal's column. A client's material is nobody's work.
  for (const card of cards) if (!card.item && !card.done && !card.material) of(card.client).counts[card.state] += 1;
  for (const summary of byClient.values()) {
    summary.open = PORTAL_COLUMNS.reduce((sum, c) => sum + (c === "posted" ? 0 : summary.counts[c]), 0);
  }
  return [...byClient.values()].sort((a, b) => b.open - a.open || a.client.localeCompare(b.client));
}

/** One client's board. Dated posts by date, the rest by the last change. */
export async function portalBoard(portal: ApprovalPortal, client: string): Promise<PortalBoard> {
  const [items, cards] = await Promise.all([portal.items(), portal.cards(client)]);
  const board: PortalBoard = {
    client,
    // Read after the posts: it says how fresh that very read was.
    state: await portal.state(),
    cards: { todo: [], doing: [] },
    items: { approval: [], adjusting: [], approved: [], scheduled: [], posted: [] },
  };
  for (const card of cards) if (!card.item && !card.done && !card.material) board.cards[card.state].push(card);
  for (const item of items) {
    if (item.client !== client) continue;
    board.items[portalColumnOf(item) as keyof PortalBoard["items"]].push(item);
  }
  const byDate = (a: PortalItem, b: PortalItem) =>
    (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999") ||
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  board.items.approved.sort(byDate);
  board.items.scheduled.sort(byDate);
  board.items.posted.sort((a, b) =>
    (b.publishedAt ?? b.scheduledFor ?? "").localeCompare(a.publishedAt ?? a.scheduledFor ?? ""),
  );
  return board;
}

export interface SendForApproval {
  client: string;
  type: PortalType;
  /** Drive files (artifact ids), in the carousel's order. */
  artifactIds: string[];
  coverArtifactId?: string;
  title?: string;
  caption?: string;
  editor?: string;
  card?: string;
  key?: string;
  by?: string;
}

/** A send takes this many files: a carousel's most. */
export const PORTAL_SEND_FILES = 20;

/**
 * Sends Drive files to the portal for the client's approval. `read` is the caller's own reader (a person's or an
 * agent's), so each file passes that caller's access check before a byte leaves. The send goes on in the bridge: the
 * job answered here says how it ended (`ApprovalPortal.job`).
 */
export async function sendForApproval(
  portal: ApprovalPortal,
  read: (artifactId: string) => Promise<{ name: string; bytes: Uint8Array }>,
  input: SendForApproval,
): Promise<PortalJob> {
  if (!input.artifactIds.length) throw new ValidationError("Nothing to send: pick at least one file");
  if (input.artifactIds.length > PORTAL_SEND_FILES) {
    throw new ValidationError(`A send takes at most ${PORTAL_SEND_FILES} files`);
  }
  if (input.type === "reel" && input.artifactIds.length !== 1) {
    throw new ValidationError("A reel is one video; its cover goes as the cover, not as a second file");
  }
  // Every file is read before the first goes up: a file the caller can't open stops the send with nothing sent.
  const files = [];
  for (const id of input.artifactIds) files.push(await read(id));
  const cover = input.coverArtifactId ? await read(input.coverArtifactId) : null;
  for (const file of cover ? [...files, cover] : files) {
    if (file.bytes.byteLength > PORTAL_FILE_BYTES) throw new ValidationError(`"${file.name}" is too large to send`);
  }
  // A send that finishes a card and says no caption takes the card's: the caption is written on the card (ADR 9001
  // §11), and a post that went up without it reached the client with none.
  let caption = input.caption?.trim() || undefined;
  if (!caption && input.card) {
    const cards = await portal.cards(input.client).catch(() => []);
    caption = cards.find((c) => c.id === input.card)?.caption.trim() || undefined;
  }
  const uploaded = [];
  for (const file of files) uploaded.push(await portal.upload(file.name, file.bytes));
  return portal.send({
    client: input.client,
    type: input.type,
    files: uploaded,
    cover: cover ? await portal.upload(cover.name, cover.bytes) : undefined,
    title: input.title?.trim() || undefined,
    caption,
    editor: input.editor,
    card: input.card,
    key: input.key,
    by: input.by,
  });
}

export interface SendNewVersion {
  client: string;
  /** The post's id at the portal. */
  item: string;
  /** Drive files (artifact ids): the whole post again, in the carousel's order. */
  artifactIds: string[];
  /** What changed. */
  note?: string;
  key?: string;
  by?: string;
}

/**
 * Puts the new version of a post the client sent back at the portal (ADR 9001 §17). Code from end to end, like the
 * first send: the files pass the caller's own reader, all are read before the first goes up, and the version is the
 * client's to approve the moment the bridge has it. Nobody of the team is asked in between.
 */
export async function sendNewVersion(
  portal: ApprovalPortal,
  read: (artifactId: string) => Promise<{ name: string; bytes: Uint8Array }>,
  input: SendNewVersion,
): Promise<PortalJob> {
  if (!input.artifactIds.length) throw new ValidationError("Nothing to send: pick at least one file");
  if (input.artifactIds.length > PORTAL_SEND_FILES) {
    throw new ValidationError(`A version takes at most ${PORTAL_SEND_FILES} files`);
  }
  const post = (await portal.items()).find((item) => item.client === input.client && item.id === input.item);
  if (!post) throw new ValidationError(`No post ${input.item} of ${input.client} at the portal`);
  if (post.status === "adjusted") {
    throw new ValidationError("This post's new version is already with the client: nothing to send again");
  }
  if (portalColumnOf(post) !== "adjusting") {
    throw new ValidationError(
      `A new version only goes up on a post the client asked a change on; this one is ${post.status}`,
    );
  }
  if (post.type === "reel" && input.artifactIds.length !== 1) {
    throw new ValidationError("A reel's new version is one video");
  }
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (const id of input.artifactIds) files.push(await read(id));
  for (const file of files) {
    if (file.bytes.byteLength > PORTAL_FILE_BYTES) throw new ValidationError(`"${file.name}" is too large to send`);
  }
  const uploaded = [];
  for (const file of files) uploaded.push(await portal.upload(file.name, file.bytes));
  const job = await portal.newVersion(input.client, input.item, {
    files: uploaded,
    note: input.note?.trim() || undefined,
    key: input.key,
    by: input.by,
  });
  // The card keeps the post's files: the new ones take the old ones' place.
  const card = (await portal.cards(input.client).catch(() => [])).find((c) => c.item === input.item);
  if (card && job.state !== "failed") {
    await portal
      .updateCard(card.id, { files: input.artifactIds.map((id, i) => ({ id, name: files[i]?.name ?? "" })) }, input.by)
      .catch(() => {});
  }
  return job;
}

/** The reason a team approval keeps at most. */
export const TEAM_APPROVAL_NOTE = 500;

export interface ApproveForClient {
  client: string;
  item: string;
  /** Why the team approves in the client's place (the client went quiet, said yes elsewhere). */
  note?: string;
  /** Who approved (a user id), for the bridge's log and the card's comment. */
  by: string;
  /** Their name, written on the card's comment. */
  byName: string;
}

/**
 * The team approves a post in its client's place (ADR 9001 §19): an administrator's last resort when the client
 * stopped answering at the portal. Only a post waiting on the client (`approval`: sent, seen, or its new version
 * sent) can be: it turns `approved` at the portal, which keeps the change in the post's history, and from there it
 * is the same as a client's approval (the workspace's watch sees it change, the card's task follows, what the client
 * set for "after approve" runs). The card it came from says who approved it and why.
 */
export async function approveForClient(portal: ApprovalPortal, input: ApproveForClient): Promise<PortalItem> {
  const post = (await portal.items()).find((item) => item.client === input.client && item.id === input.item);
  if (!post) throw new ValidationError(`No post ${input.item} of ${input.client} at the portal`);
  if (portalColumnOf(post) !== "approval") {
    throw new ValidationError(
      `Only a post waiting on the client's approval can be approved; this one is ${post.status}`,
    );
  }
  const note = input.note?.trim().slice(0, TEAM_APPROVAL_NOTE) ?? "";
  await portal.editItem(input.client, input.item, { status: "approved" }, input.by);
  const card = (await portal.cards(input.client).catch(() => [])).find((c) => c.item === input.item);
  if (card) {
    const said = `Aprovado pela equipe no lugar do cliente, por ${input.byName}.${note ? ` Motivo: ${note}` : ""}`;
    await portal.comment(card.id, said, input.by).catch(() => {});
  }
  return { ...post, status: "approved" };
}

/** A person's reader: the file as they may download it. */
export const personPortalReader = (deps: ArtifactDeps, userId: string, orgId: string) => async (artifactId: string) => {
  const file = await artifactFile(deps, userId, orgId, artifactId);
  return { name: file.filename, bytes: file.body };
};

/** An agent's reader: an uploaded file it may see from the run's conversation. */
export const agentPortalReader = (deps: ArtifactDeps, actor: ArtifactActor, orgId: string) => async (id: string) => {
  const stored = await storedFileOfArtifact(deps, actor, orgId, id);
  const object = await (await deps.blobs.forConfig(orgId, stored.storageConfigId)).get(stored.blobKey);
  if (!object) throw new ValidationError(`The stored file of artifact ${id} is missing`);
  return { name: stored.name, bytes: object.body };
};

// ---------- agents' tools ----------

export const PORTAL_BOARD_TOOL = "portal_board";
export const PORTAL_CARD_TOOL = "portal_card";
export const SEND_FOR_APPROVAL_TOOL = "send_for_approval";
export const SEND_NEW_VERSION_TOOL = "send_new_version";

export interface PortalToolDeps {
  /** null: this server has no approval portal, and the tools aren't listed. */
  portal: ApprovalPortal | null;
  artifacts: ArtifactDeps;
  /** Whether the portal is the run's workspace's (ADR 9001 §18); `portalHere` unless a test says otherwise. */
  here?: (ctx: ToolContext) => Promise<boolean>;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const failed = (error: unknown): ToolOutput => {
  if (error instanceof ApprovalPortalError || error instanceof ValidationError) {
    return { content: `The approval portal refused: ${error.message}`, isError: true };
  }
  throw error;
};
const actorOf = (ctx: ToolContext): ArtifactActor => ({
  type: "agent",
  agentId: ctx.agentId,
  channelId: ctx.channelId,
  threadId: replyThreadOf(ctx),
  runId: ctx.runId,
});

const itemLine = (item: PortalItem) =>
  `- [${item.status}] ${item.type} "${item.title}" (item ${item.id})` +
  (item.scheduledFor ? `, date ${item.scheduledFor}` : "") +
  (item.missing.length ? `, missing: ${item.missing.join(", ")}` : "") +
  (item.released ? ", already released for scheduling" : "") +
  // The post's address is read here, so no agent builds one or asks another for it.
  (item.link ? `, at the portal: ${item.link}` : "") +
  (item.lastNote?.text && portalColumnOf(item) === "adjusting" ? `\n  client's note: ${item.lastNote.text}` : "");
const cardLine = (card: PortalCard) =>
  `- ${card.type} "${card.title}" (card ${card.id})` +
  (card.date ? `, date ${card.date}` : "") +
  (card.owner ? `, with ${card.owner}` : "") +
  (card.files.length ? `, ${card.files.length} file(s)` : "") +
  (card.note ? `\n  note: ${card.note}` : "");

function boardTool(portal: ApprovalPortal): ToolDefinition {
  return {
    name: PORTAL_BOARD_TOOL,
    description:
      "The approval portal's board: what the team makes for each client and where each post is (to do, in production, waiting for the client's approval, adjustment asked by the client, approved, scheduled, posted). With no `client`: every client and its counts. With a `client`: that client's cards and posts, with ids, dates, what is missing, each post's address at the portal and the client's adjustment notes.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", maxLength: 64, description: "A client's id, as the overview lists it." },
        posted: { type: "boolean", description: "Also list what was already posted (default false)." },
      },
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const client = str(input.client).trim();
        if (!client) {
          const clients = await portalOverview(portal);
          if (!clients.length) return { content: "The approval portal has no clients yet." };
          return {
            content: clients
              .map(
                (c) =>
                  `- ${c.client}: to do ${c.counts.todo}, in production ${c.counts.doing}, waiting for approval ${c.counts.approval}, adjustment asked ${c.counts.adjusting}, approved ${c.counts.approved}, scheduled ${c.counts.scheduled}, posted ${c.counts.posted}` +
                  (c.next ? `, next date ${c.next}` : ""),
              )
              .join("\n"),
          };
        }
        const board = await portalBoard(portal, client);
        const section = (title: string, lines: string[]) => (lines.length ? `## ${title}\n${lines.join("\n")}` : "");
        const text = [
          section("To do", board.cards.todo.map(cardLine)),
          section("In production", board.cards.doing.map(cardLine)),
          section("Waiting for the client's approval", board.items.approval.map(itemLine)),
          section("Adjustment asked by the client", board.items.adjusting.map(itemLine)),
          section("Approved by the client (to schedule)", board.items.approved.map(itemLine)),
          section("Scheduled", board.items.scheduled.map(itemLine)),
          input.posted === true ? section("Posted", board.items.posted.slice(0, 40).map(itemLine)) : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        // Titles, captions and notes are typed by clients and by the team: outside text for a model.
        return { content: text ? untrustedBlock(`approval portal, ${client}`, text) : `Nothing open for ${client}.` };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function cardTool(portal: ApprovalPortal): ToolDefinition {
  return {
    name: PORTAL_CARD_TOOL,
    description:
      "Create, change or delete a card of the approval portal's board: a post the team still has to make (`todo`) or is making (`doing`). A card isn't at the portal yet: `send_for_approval` sends it. `action` `create` needs `client` and `title`; `update` and `delete` need `card`. To move a card, `update` it with another `list` (it goes last there) and or a `position` in its list (1 is first); `state` moves it between to do and in production.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        action: { enum: ["create", "update", "delete"] },
        client: { type: "string", maxLength: 64 },
        card: { type: "string", maxLength: 40 },
        title: { type: "string", maxLength: 120 },
        type: { enum: [...PORTAL_TYPES] },
        state: { enum: [...PORTAL_CARD_STATES] },
        caption: { type: "string", maxLength: 5000 },
        date: { type: "string", maxLength: 40, description: "When it should go out: YYYY-MM-DDTHH:MM." },
        owner: { type: "string", maxLength: 120, description: "Who makes it (a person's or an agent's name)." },
        note: { type: "string", maxLength: 2000 },
        description: { type: "string", maxLength: 20000, description: "The brief: idea, script, references." },
        list: { type: "string", maxLength: 80, description: "The schedule's list by name (a week); made if new." },
        position: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description:
            "Its place in its list, 1 first (in `list` when given). With none, a card moved to a list goes last.",
        },
        produce_on: {
          type: "string",
          maxLength: 10,
          description: "The day whoever is on it makes it (YYYY-MM-DD). Not the day it goes out (`date`).",
        },
        members: {
          type: "array",
          items: { type: "string", maxLength: 120 },
          maxItems: 10,
          description: "People of the workspace on it, by name. Replaces who was on it.",
        },
        labels: {
          type: "array",
          items: { type: "string", maxLength: 40 },
          maxItems: 10,
          description: "The team's labels by name. Replaces the card's labels.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      try {
        const by = (await personBehindCall(ctx)) ?? `agent:${ctx.agentId}`;
        const fields = {
          ...(input.title !== undefined ? { title: str(input.title) } : {}),
          ...(input.type !== undefined ? { type: input.type as PortalType } : {}),
          ...(input.state !== undefined ? { state: input.state as PortalCard["state"] } : {}),
          ...(input.caption !== undefined ? { caption: str(input.caption) } : {}),
          ...(input.date !== undefined ? { date: str(input.date) || null } : {}),
          ...(input.owner !== undefined ? { owner: str(input.owner) || null } : {}),
          ...(input.note !== undefined ? { note: str(input.note) } : {}),
          ...(input.description !== undefined ? { description: str(input.description) } : {}),
          ...(input.produce_on !== undefined ? { produceOn: str(input.produce_on) || null } : {}),
          ...(input.labels !== undefined
            ? { labels: await labelIdsByName(portal, (input.labels as string[]) ?? []) }
            : {}),
          ...(input.members !== undefined
            ? { members: await memberIdsByName(ctx.db as Database, ctx.orgId, (input.members as string[]) ?? []) }
            : {}),
        };
        if (fields.produceOn && !/^\d{4}-\d{2}-\d{2}$/.test(fields.produceOn)) {
          throw new ValidationError("`produce_on` is YYYY-MM-DD");
        }
        const listName = str(input.list).trim();
        const position = typeof input.position === "number" ? input.position : undefined;
        const listed = async (client: string) =>
          listName ? (await portal.createList(client, listName)).id : undefined;
        if (input.action === "create") {
          const title = str(input.title).trim();
          if (!str(input.client) || !title) throw new ValidationError("create needs `client` and `title`");
          const client = str(input.client);
          const list = await listed(client);
          const order = position === undefined ? undefined : await orderIn(portal, client, list ?? null, "", position);
          const card = await portal.createCard(
            client,
            { ...fields, ...(list ? { list } : {}), ...(order === undefined ? {} : { order }), title },
            by,
          );
          return { content: `Created card ${card.id} for ${card.client}: "${card.title}" (${card.state}).` };
        }
        if (!str(input.card)) throw new ValidationError(`${String(input.action)} needs \`card\``);
        if (input.action === "delete") {
          await portal.deleteCard(str(input.card), by);
          return { content: `Deleted card ${str(input.card)}.` };
        }
        // A move: another list (made if new) and or a place in the list. Its order is set between its new
        // neighbours, as the apps' drag sets it.
        const moving = Boolean(listName) || position !== undefined;
        const current = moving ? (await portal.cards()).find((c) => c.id === str(input.card)) : undefined;
        if (moving && !current) throw new ValidationError("no such card");
        let place = {};
        if (current) {
          const list = (await listed(current.client)) ?? current.list;
          place =
            list !== current.list || position !== undefined
              ? { list, order: await orderIn(portal, current.client, list, current.id, position) }
              : {};
        }
        const card = await portal.updateCard(str(input.card), { ...fields, ...place }, by);
        return { content: `Card ${card.id} is now "${card.title}" (${card.state}).` };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

/**
 * The order that puts a card at `position` (1 first) among the other cards of `list` (null: no list), or last with
 * none: halfway between its new neighbours, one past the end, one before the first.
 */
async function orderIn(
  portal: ApprovalPortal,
  client: string,
  list: string | null,
  cardId: string,
  position: number | undefined,
): Promise<number> {
  const others = (await portal.cards())
    .filter((c) => c.client === client && c.list === list && c.id !== cardId)
    .sort((a, b) => a.order - b.order);
  const at = position === undefined ? others.length : Math.max(0, Math.min(position - 1, others.length));
  const before = others[at - 1]?.order;
  const after = others[at]?.order;
  if (before === undefined) return after === undefined ? 1 : after - 1;
  return after === undefined ? before + 1 : (before + after) / 2;
}

function sendTool(deps: PortalToolDeps, portal: ApprovalPortal): ToolDefinition {
  return {
    name: SEND_FOR_APPROVAL_TOOL,
    description:
      'Send a post to the client\'s approval at the approval portal. Only what the team already approved in Review goes up: every file must be the approved version of a review (`send_for_review` first, then wait for "Aprovado"; an approved piece usually goes to the portal by itself), and anything else is refused. Use it when a person of the team tells you to send something for approval ("sobe para aprovação", "send it for approval"), never on your own judgment. `artifact_ids` are uploaded files of this conversation or the Drive (a file on your computer goes to the Drive first, with `upload_file`). A reel is one video, and its cover goes in `cover_artifact_id`; a carousel takes its images in order. Nothing is required beyond the client, the type and the files: a missing title, caption or cover is listed back as missing and can be completed later. With `card`, the card\'s caption goes up when you give none. The send goes on by itself after this answers; the answer carries the post\'s link.',
    scope: "",
    external: true,
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", maxLength: 64, description: "The client's id, as `portal_board` lists it." },
        type: { enum: [...PORTAL_TYPES] },
        artifact_ids: {
          type: "array",
          items: { type: "string", minLength: 36, maxLength: 36 },
          minItems: 1,
          maxItems: PORTAL_SEND_FILES,
        },
        cover_artifact_id: { type: "string", minLength: 36, maxLength: 36 },
        title: { type: "string", maxLength: 120 },
        caption: { type: "string", maxLength: 5000 },
        editor: { type: "string", maxLength: 40, description: "Who edited the video, when the team said." },
        card: { type: "string", maxLength: 40, description: "The board's card this post finishes, if it has one." },
        review_id: {
          type: "string",
          minLength: 36,
          maxLength: 36,
          description:
            "The approved review this post is. Needed only for a design piece approved as its page alone: its slides, exported after the approval, go up under it.",
        },
      },
      required: ["client", "type", "artifact_ids"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Send "${str(input.title) || "a post"}" to ${str(input.client)}'s approval` }),
    async execute(input, ctx) {
      try {
        // Only what the team approved in Review goes up (doug-0019): held here, before a byte is read or sent.
        const gate = await reviewGate(ctx.db as Database, ctx.orgId, {
          artifactIds: (input.artifact_ids as string[]) ?? [],
          coverArtifactId: str(input.cover_artifact_id) || undefined,
          reviewId: str(input.review_id) || undefined,
        });
        if (gate.unapproved.length) return { content: reviewGateRefusal(gate), isError: true };
        const by = (await personBehindCall(ctx)) ?? `agent:${ctx.agentId}`;
        const job = await sendForApproval(portal, agentPortalReader(deps.artifacts, actorOf(ctx), ctx.orgId), {
          client: str(input.client),
          type: input.type as PortalType,
          artifactIds: (input.artifact_ids as string[]) ?? [],
          coverArtifactId: str(input.cover_artifact_id) || undefined,
          title: str(input.title) || undefined,
          caption: str(input.caption) || undefined,
          editor: str(input.editor) || undefined,
          card: str(input.card) || undefined,
          // One call sends once, however many times it is retried.
          key: ctx.toolUseId ? `run:${ctx.runId}:${ctx.toolUseId}` : undefined,
          by,
        });
        // An image is at the portal within seconds; a video goes on converting there, and its link works meanwhile.
        const done = await settled(portal, job);
        if (done.state === "failed") {
          return { content: `The send failed: ${done.error ?? "the portal gave no reason"}`, isError: true };
        }
        return {
          content:
            (done.state === "done"
              ? `Sent to ${done.client}'s approval: "${done.title ?? ""}" (item ${done.item ?? "?"}).`
              : `Sending to ${job.client}'s approval; a video takes a few minutes to finish at the portal.`) +
            (done.link ? ` Link: ${done.link}` : "") +
            (done.missing.length ? ` Still missing: ${done.missing.join(", ")}.` : ""),
        };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function versionTool(deps: PortalToolDeps, portal: ApprovalPortal): ToolDefinition {
  return {
    name: SEND_NEW_VERSION_TOOL,
    description:
      "Put the new version of a post at the approval portal, once you made the change its client asked for. It goes to the client at once: nobody of the team approves it first, so don't ask anyone and don't wait for an OK. `item` is the post's id, as `portal_board` lists it under the adjustment the client asked. `artifact_ids` are the whole post again, in order (every slide of a carousel, changed or not; a reel's one video): uploaded files of this conversation or the Drive (a file on your computer goes to the Drive first, with `upload_file`). `note` says what changed, in one or two lines, in the client's language. Only a post the client asked a change on takes a new version. The answer carries the post's link: say it is up, with that link.",
    scope: "",
    external: true,
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", maxLength: 64, description: "The client's id, as `portal_board` lists it." },
        item: { type: "string", maxLength: 80, description: "The post's id at the portal." },
        artifact_ids: {
          type: "array",
          items: { type: "string", minLength: 36, maxLength: 36 },
          minItems: 1,
          maxItems: PORTAL_SEND_FILES,
        },
        note: { type: "string", maxLength: 2000, description: "What changed in this version." },
      },
      required: ["client", "item", "artifact_ids"],
      additionalProperties: false,
    },
    describe: (input) => ({
      title: `Put a new version of ${str(input.client)}'s post ${str(input.item)} at the portal`,
    }),
    async execute(input, ctx) {
      try {
        const by = (await personBehindCall(ctx)) ?? `agent:${ctx.agentId}`;
        const job = await sendNewVersion(portal, agentPortalReader(deps.artifacts, actorOf(ctx), ctx.orgId), {
          client: str(input.client),
          item: str(input.item),
          artifactIds: (input.artifact_ids as string[]) ?? [],
          note: str(input.note) || undefined,
          key: ctx.toolUseId ? `run:${ctx.runId}:${ctx.toolUseId}` : undefined,
          by,
        });
        const done = await settled(portal, job);
        if (done.state === "failed") {
          return {
            content: `The new version didn't go up: ${done.error ?? "the portal gave no reason"}`,
            isError: true,
          };
        }
        return {
          content:
            (done.state === "done"
              ? `The new version of "${done.title ?? ""}" is at the portal, with the client to approve.`
              : "The new version is going up; a video takes a few minutes to finish at the portal.") +
            (done.link ? ` Link: ${done.link}` : ""),
        };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

/** `YYYY-MM-DDTHH:MM`, with or without seconds and an offset: what a schedule's time looks like. */
export const PORTAL_WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/;

export const PORTAL_WORK_TOOL = "portal_work";

const workLine = (card: PlanCard, labels: Map<string, string>) =>
  `- ${card.type} "${card.title}" for ${card.client} (card ${card.id}, ${card.stage})` +
  (card.produceOn ? `, to make on ${card.produceOn}` : "") +
  (card.postOn ? `, goes out ${card.postOn}` : "") +
  (card.labels.length ? `, labels: ${card.labels.map((id) => labels.get(id) ?? id).join(", ")}` : "") +
  (card.files.length ? `, files: ${card.files.map((f) => `"${f.name}" (artifact ${f.id})`).join(", ")}` : "") +
  (card.link ? `, at the portal: ${card.link}` : "") +
  (card.description ? `\n  brief: ${card.description.slice(0, 1500)}` : "") +
  (card.checklist.length
    ? `\n  checklist: ${card.checklist.map((c) => `[${c.done ? "x" : " "}] ${c.text}`).join("; ")}`
    : "") +
  (card.comments.length ? `\n  last comment: ${card.comments.at(-1)?.text.slice(0, 500)}` : "");

function workTool(portal: ApprovalPortal): ToolDefinition {
  return {
    name: PORTAL_WORK_TOOL,
    description:
      "What a person of the workspace has to make at the approval portal's board: the cards they are on that aren't out yet, late ones first, then today's, then what comes next, each with its brief, checklist, files and links. `member` is the person's name; with none, the person behind this conversation. With a `client`, that client's whole strategic schedule instead (lists, cards, stages). Use it to tell someone their day, or to answer a question about a task.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        member: { type: "string", maxLength: 120 },
        client: { type: "string", maxLength: 64 },
      },
      additionalProperties: false,
    },
    async execute(input, ctx) {
      try {
        const names = new Map((await portal.labels()).map((label) => [label.id, label.name]));
        if (str(input.client)) {
          const plan = await portalPlan(portal, str(input.client));
          const text = [...plan.lists, { name: "In no list", cards: plan.unlisted }]
            .filter((list) => list.cards.length)
            .map((list) => `## ${list.name}\n${list.cards.map((card) => workLine(card, names)).join("\n")}`)
            .join("\n\n");
          return {
            content: text
              ? untrustedBlock(`approval portal schedule, ${plan.client}`, text)
              : `${plan.client}'s schedule is empty.`,
          };
        }
        const member = str(input.member)
          ? (await memberIdsByName(ctx.db as Database, ctx.orgId, [str(input.member)]))[0]
          : await personBehindCall(ctx);
        if (!member) throw new ValidationError("say whose work: `member` is a person's name");
        const work = await myPortalWork(portal, member);
        const section = (title: string, cards: PlanCard[]) =>
          cards.length ? `## ${title}\n${cards.map((card) => workLine(card, names)).join("\n")}` : "";
        const text = [
          section("Late", work.late),
          section(`Today (${work.today})`, work.today_),
          section("Next", work.next),
          section("With no production date", work.undated),
        ]
          .filter(Boolean)
          .join("\n\n");
        return { content: text ? untrustedBlock("approval portal work", text) : "Nothing to make right now." };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

/** Waits a short while for a send to end, so the answer usually carries the link. */
async function settled(portal: ApprovalPortal, job: PortalJob, waitMs = 20_000): Promise<PortalJob> {
  const until = Date.now() + waitMs;
  let last = job;
  while (last.state === "sending" && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    last = (await portal.job(job.id)) ?? last;
  }
  return last;
}

/**
 * The portal's tools for a run: listed only on a server with an approval portal. A routine gets the two that read,
 * its plan and card changes go to the run-policy table, and the sends need a person behind the run.
 */
export function createPortalToolSource(deps: PortalToolDeps): ToolSource {
  return {
    name: "approval-portal",
    async tools(ctx) {
      const portal = deps.portal;
      if (!portal || !ctx.runId) return [];
      // Another workspace on this server is another operation: the portal's clients aren't its (ADR 9001 §18).
      if (!(await (deps.here ?? ((c) => portalHere(c.db as Database, c.orgId)))(ctx))) return [];
      // A routine reads (it tells each person their day). Its plan and card changes are listed for the run-policy
      // table to judge: refused to routines, but the right hand's own at "never" reach them (ADR 9005 §7). The
      // sends to a client stay with runs a person is behind.
      const reads = [boardTool(portal), workTool(portal)];
      if (ctx.background) return [...reads, cardTool(portal), planTool(portal)];
      return [...reads, cardTool(portal), planTool(portal), sendTool(deps, portal), versionTool(deps, portal)];
    },
  };
}
