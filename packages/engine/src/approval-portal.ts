import {
  type ApprovalPortal,
  ApprovalPortalError,
  PORTAL_CARD_STATES,
  PORTAL_FILE_BYTES,
  PORTAL_TYPES,
  type PortalCard,
  type PortalItem,
  type PortalJob,
  type PortalState,
  type PortalStatus,
  type PortalType,
} from "@agenteschat/adapters";
import { type ArtifactActor, type ArtifactDeps, artifactFile, storedFileOfArtifact } from "./artifacts";
import { ValidationError } from "./errors";
import { personBehindCall } from "./requester";
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

export interface PortalClientSummary {
  client: string;
  counts: Record<PortalColumn, number>;
  /** Everything not posted yet. */
  open: number;
  /** The next date among what is scheduled, if any. */
  next: string | null;
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
  const [items, cards] = await Promise.all([portal.items(), portal.cards()]);
  const byClient = new Map<string, PortalClientSummary>();
  const of = (client: string) => {
    let summary = byClient.get(client);
    if (!summary) {
      summary = { client, counts: emptyCounts(), open: 0, next: null };
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
  for (const card of cards) of(card.client).counts[card.state] += 1;
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
  for (const card of cards) board.cards[card.state].push(card);
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
  date?: string;
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
  const uploaded = [];
  for (const file of files) uploaded.push(await portal.upload(file.name, file.bytes));
  return portal.send({
    client: input.client,
    type: input.type,
    files: uploaded,
    cover: cover ? await portal.upload(cover.name, cover.bytes) : undefined,
    title: input.title?.trim() || undefined,
    caption: input.caption,
    date: input.date,
    editor: input.editor,
    card: input.card,
    key: input.key,
    by: input.by,
  });
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
export const SCHEDULE_POST_TOOL = "schedule_post";

export interface PortalToolDeps {
  /** null: this server has no approval portal, and the tools aren't listed. */
  portal: ApprovalPortal | null;
  artifacts: ArtifactDeps;
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
      "The approval portal's board: what the team makes for each client and where each post is (to do, in production, waiting for the client's approval, adjustment asked by the client, approved, scheduled, posted). With no `client`: every client and its counts. With a `client`: that client's cards and posts, with ids, dates, what is missing and the client's adjustment notes.",
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
      "Create, change or delete a card of the approval portal's board: a post the team still has to make (`todo`) or is making (`doing`). A card isn't at the portal yet: `send_for_approval` sends it. `action` `create` needs `client` and `title`; `update` and `delete` need `card`.",
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
        };
        if (input.action === "create") {
          const title = str(input.title).trim();
          if (!str(input.client) || !title) throw new ValidationError("create needs `client` and `title`");
          const card = await portal.createCard(str(input.client), { ...fields, title }, by);
          return { content: `Created card ${card.id} for ${card.client}: "${card.title}" (${card.state}).` };
        }
        if (!str(input.card)) throw new ValidationError(`${String(input.action)} needs \`card\``);
        if (input.action === "delete") {
          await portal.deleteCard(str(input.card), by);
          return { content: `Deleted card ${str(input.card)}.` };
        }
        const card = await portal.updateCard(str(input.card), fields, by);
        return { content: `Card ${card.id} is now "${card.title}" (${card.state}).` };
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function sendTool(deps: PortalToolDeps, portal: ApprovalPortal): ToolDefinition {
  return {
    name: SEND_FOR_APPROVAL_TOOL,
    description:
      'Send a post to the client\'s approval at the approval portal. Use it when a person of the team tells you to send something for approval ("sobe para aprovação", "send it for approval"), never on your own judgment. `artifact_ids` are uploaded files of this conversation or the Drive (a file on your computer goes to the Drive first, with `upload_file`). A reel is one video, and its cover goes in `cover_artifact_id`; a carousel takes its images in order. Nothing is required beyond the client, the type and the files: a missing title, caption, date or cover is listed back as missing and can be completed later. The send goes on by itself after this answers; the answer carries the post\'s link.',
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
        date: { type: "string", maxLength: 40, description: "Proposed date and time: YYYY-MM-DDTHH:MM." },
        editor: { type: "string", maxLength: 40, description: "Who edited the video, when the team said." },
        card: { type: "string", maxLength: 40, description: "The board's card this post finishes, if it has one." },
      },
      required: ["client", "type", "artifact_ids"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Send "${str(input.title) || "a post"}" to ${str(input.client)}'s approval` }),
    async execute(input, ctx) {
      try {
        const by = (await personBehindCall(ctx)) ?? `agent:${ctx.agentId}`;
        const job = await sendForApproval(portal, agentPortalReader(deps.artifacts, actorOf(ctx), ctx.orgId), {
          client: str(input.client),
          type: input.type as PortalType,
          artifactIds: (input.artifact_ids as string[]) ?? [],
          coverArtifactId: str(input.cover_artifact_id) || undefined,
          title: str(input.title) || undefined,
          caption: str(input.caption) || undefined,
          date: str(input.date) || undefined,
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

/** `YYYY-MM-DDTHH:MM`, with or without seconds and an offset: what a schedule's time looks like. */
export const PORTAL_WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/;

function scheduleTool(portal: ApprovalPortal): ToolDefinition {
  return {
    name: SCHEDULE_POST_TOOL,
    description:
      "Schedule a post the client already approved: it is released at the approval portal and goes to the publishing service by itself, with the portal's own caption and files. Use it when a person of the team tells you to schedule an approved post, never on your own judgment. Only a post in the board's approved column is scheduled, at a time in the future.",
    scope: "",
    external: true,
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", maxLength: 64 },
        item: { type: "string", maxLength: 80, description: "The post's id, as `portal_board` lists it." },
        when: { type: "string", maxLength: 40, description: "YYYY-MM-DDTHH:MM, the portal's own time zone." },
      },
      required: ["client", "item", "when"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Schedule ${str(input.client)}'s post ${str(input.item)} for ${str(input.when)}` }),
    async execute(input, ctx) {
      try {
        if (!PORTAL_WHEN.test(str(input.when))) throw new ValidationError("`when` is YYYY-MM-DDTHH:MM");
        const by = (await personBehindCall(ctx)) ?? `agent:${ctx.agentId}`;
        await portal.scheduleItem(str(input.client), str(input.item), str(input.when), by);
        return {
          content: `Released for ${str(input.when)}: the portal takes it to the publishing service within minutes.`,
        };
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
 * The portal's tools for a run: listed only on a server with an approval portal, and only where a person is behind
 * the run (a routine reads and sends nothing here).
 */
export function createPortalToolSource(deps: PortalToolDeps): ToolSource {
  return {
    name: "approval-portal",
    async tools(ctx) {
      const portal = deps.portal;
      if (!portal || !ctx.runId || ctx.background) return [];
      return [boardTool(portal), cardTool(portal), sendTool(deps, portal), scheduleTool(portal)];
    },
  };
}
