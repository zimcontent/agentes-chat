import type { PubSub } from "@dougbot/adapters";
import { and, type Database, type Executor, eq, isNull, schema, sql } from "@dougbot/db";
import { recordAudit } from "./audit";
import { connectionWaitId, queueConnectionCheck } from "./connection-check";
import type { ServerCatalog } from "./connectors/listing";
import { presetForServer } from "./connectors/presets";
import { cardPlace, NO_PERSON_READS } from "./consultations";
import { publishDelivery } from "./delivery";
import { firstNames } from "./device-resolve";
import { publishChannelEvent, publishMessageCreated } from "./events";
import { cutText } from "./format";
import { insertMessage, messageView } from "./messages";
import type { Notice } from "./notices";
import { adminsOf } from "./notification-producers";
import { notify, resolveNotifications } from "./notifications";
import { can, getMembership } from "./organizations";
import { enqueue } from "./outbox";
import { personBehindCall } from "./requester";
import { deliverNoticeToRun, resumeRunWithResult } from "./run-resume";
import { bodyCode } from "./run-tools";
import { CONNECT_APP_CARD, catalogConnector, hopOf } from "./setup-tools";
import { REQUEST_CONNECTION_TOOL } from "./tools/connector-first";
import { ALL_TOOLS } from "./tools/scopes";
import type { ToolContext, ToolDefinition, ToolOutput, ToolSource } from "./tools/types";

const { agentRuns, agentScopes, connectionRequests, connectorConnections, messages } = schema;

/**
 * Connect and continue (docs/adr/doug-0039-connect-and-continue.md): an agent whose task needs a service the workspace
 * hasn't connected (or that it lacks) calls `request_connection` instead of saying it has no access. A Connect card
 * goes in the conversation (the `connect_app` action card, which opens the app's own connect dialog, with
 * `params.request`), the run waits on it (`connection:<id>`, the usual pause), and once the agent holds a working
 * connection of that service (`settleConnectionRequests`, queued by whatever changes it: `queueConnectionCheck`) the
 * same run goes on, or, when it already ended, a notice starts one in the same conversation with the task. A person
 * who can't connect apps sees who can on the card, and those people are asked (`admin_ask`, reason `connector`).
 * Nobody within a day: the wait ends and the agent says so.
 */

export { REQUEST_CONNECTION_TOOL };

/** How long a run waits for a connection before it stops waiting and says so. */
export const CONNECTION_WAIT_MS = 24 * 3600_000;

/** The job that ends a request still open at its `expires_at`. */
export const CONNECTION_REQUEST_EXPIRED_JOB = "connection.request_expired";

export type ConnectionRequestState = "waiting" | "connected" | "expired";

/** `meta.actionCard.params.request` on the Connect card: what the apps read beside the card's own live check. */
export interface ConnectionRequestCard {
  id: string;
  agentId: string;
  runId: string;
  state: ConnectionRequestState;
  /** With `connected`: the agent went on with the task (its run, or a new one in the conversation). */
  resumed?: boolean;
  /** The people asked to connect it because whom the agent works for can't. */
  askedUserIds: string[];
  until: string;
  endedAt?: string;
}

export type ConnectionRequestRow = typeof connectionRequests.$inferSelect;

export interface ConnectionRequestDeps {
  db: Database;
  pubsub?: PubSub;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * How the agent stands with a service (a catalog connector or a one-click preset, by id): the workspace's working
 * connections of it, the one the agent holds (a grant on it, or every tool of the workspace), and whether one waits to
 * be reconnected.
 */
export async function serviceStanding(
  db: Executor,
  orgId: string,
  agentId: string,
  service: string,
): Promise<{ working: string[]; held: string | null; reconnect: boolean }> {
  const rows = await db
    .select({
      id: connectorConnections.id,
      connector: connectorConnections.connector,
      serverUrl: connectorConnections.serverUrl,
      status: connectorConnections.status,
    })
    .from(connectorConnections)
    .where(and(eq(connectorConnections.orgId, orgId), isNull(connectorConnections.revokedAt)));
  const mine = rows.filter(
    (c) =>
      c.connector === service || (c.connector.startsWith("custom:") && presetForServer(c.serverUrl)?.id === service),
  );
  const working = mine.filter((c) => c.status !== "needs_reconnect").map((c) => c.id);
  const reconnect = mine.some((c) => c.status === "needs_reconnect");
  if (working.length === 0) return { working, held: null, reconnect };
  // Read fresh, never through the scope cache: a grant made a moment ago in another process counts.
  const grants = await db
    .select({ connectionId: agentScopes.connectionId, scope: agentScopes.scope })
    .from(agentScopes)
    .where(and(eq(agentScopes.orgId, orgId), eq(agentScopes.agentId, agentId)));
  const every = grants.some((g) => g.connectionId === null && g.scope === ALL_TOOLS);
  const held =
    working.find((id) => every || grants.some((g) => g.connectionId === id && !g.scope.startsWith("deny:"))) ?? null;
  return { working, held, reconnect };
}

/** The request card's words for the run: the people asked, by first name. */
const namesOf = async (db: Executor, ids: string[]) => {
  const names = await firstNames(db, ids);
  return ids.map((id) => names.get(id) ?? "an admin");
};

const joinWords = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** `request_connection`, for every agent; a run nobody is behind (a routine) is refused by the run policy. */
export function createConnectionRequestToolSource(deps: { pubsub?: PubSub; catalog?: ServerCatalog }): ToolSource {
  const tool: ToolDefinition = {
    name: REQUEST_CONNECTION_TOOL,
    description:
      "When the task needs an app or service this workspace hasn't connected (Google Ads, HubSpot, Notion, Google Drive…), call this instead of saying you have no access or stopping. It posts a one-tap Connect card in this conversation (it opens the app's own connect dialog; whoever can't connect apps sees who can, and they are asked) and your run pauses. Once it's connected you go on by yourself, here, with what you said in `next`: the person never asks again. A day with nobody connecting it ends the wait. Not for a key a command needs (request_secret), nor for an app that is connected but not given to you (request_permission).",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          description: "The app or service by name or id (Google Ads, HubSpot, notion).",
        },
        why: {
          type: "string",
          minLength: 1,
          maxLength: 300,
          description:
            "One short line on the card for the person, in their language: what you need it for ('Para puxar os gastos da campanha de março.').",
        },
        next: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "What you'll do once it's connected, in your words: you read it again when you go on.",
        },
      },
      required: ["service", "why", "next"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Ask to connect ${str(input.service) || "an app"}` }),
    async execute(input, ctx) {
      try {
        return await requestConnection(deps, ctx, {
          service: str(input.service),
          why: cutText(str(input.why), 300),
          next: cutText(str(input.next), 500),
        });
      } catch (error) {
        return { content: `Failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    },
  };
  return { name: "connection-requests", tools: async () => [tool] };
}

async function requestConnection(
  deps: { pubsub?: PubSub; catalog?: ServerCatalog },
  ctx: ToolContext,
  input: { service: string; why: string; next: string },
): Promise<ToolOutput> {
  const forUserId = await personBehindCall(ctx);
  if (!forUserId) {
    return {
      content:
        "Only a person's own request can ask to connect an app (not a routine or another agent). Say in one line which app the work needs.",
      isError: true,
    };
  }
  if (!input.why || !input.next) return { content: "Give `why` and `next`: one short line each.", isError: true };
  const found = catalogConnector(input.service, deps.catalog);
  if (!found) {
    return {
      content: `"${input.service}" isn't an app this workspace connects in one click. If it has an MCP server, ask the person for its https address and offer it with offer_connect_app; if it has a web version, use it in your browser with the person signing in.`,
      isError: true,
    };
  }
  if (!found.available) {
    return {
      content: found.soon
        ? `${found.label} doesn't let agentes.chat connect in one click yet. If it gives an API key, ask the person for its MCP server's https address and offer it with offer_connect_app; else use its web version in your browser.`
        : `${found.label} isn't available on this installation: whoever runs it has to turn it on first. Tell the person, and use its web version in your browser if it has one.`,
      isError: true,
    };
  }
  const standing = await serviceStanding(ctx.db, ctx.orgId, ctx.agentId, found.id);
  if (standing.held) {
    return {
      content: `${found.label} is connected and yours already: use its tools (find_tools "${found.label}" when they aren't listed) and carry on.`,
    };
  }
  if (standing.working.length > 0) {
    return {
      content: `${found.label} is connected in this workspace but not given to you: ask for it with request_permission (permission "connector:${standing.working[0]}"). Its card asks whoever gives access, and you go on once they do.`,
      isError: true,
    };
  }
  // Asked again while it still waits (a person wrote meanwhile): the open request is waited on, no second card.
  const [open] = await ctx.db
    .select({ id: connectionRequests.id })
    .from(connectionRequests)
    .where(
      and(
        eq(connectionRequests.orgId, ctx.orgId),
        eq(connectionRequests.runId, ctx.runId),
        eq(connectionRequests.service, found.id),
        eq(connectionRequests.state, "waiting"),
      ),
    )
    .limit(1);
  if (open) {
    return {
      content: `This is the same request to connect ${found.label} that is still open: waiting for it.`,
      data: { pause: { kind: "connection", id: connectionWaitId(open.id) } },
    };
  }
  const at = await cardPlace(ctx);
  if (!at) return { content: NO_PERSON_READS, isError: true };
  const may = can(await getMembership(ctx.db, forUserId, ctx.orgId), "manage_connectors");
  const asked = may
    ? []
    : (await adminsOf({ db: ctx.db }, ctx.orgId, "manage_connectors")).filter((id) => id !== forUserId);
  if (!may && asked.length === 0) {
    return {
      content: `Nobody in this workspace can connect apps, so ${found.label} can't be connected now. Tell the person in one line.`,
      isError: true,
    };
  }
  const id = Bun.randomUUIDv7();
  const now = new Date();
  const until = new Date(now.getTime() + CONNECTION_WAIT_MS);
  const request: ConnectionRequestCard = {
    id,
    agentId: ctx.agentId,
    runId: ctx.runId,
    state: "waiting",
    askedUserIds: asked,
    until: until.toISOString(),
  };
  await ctx.db.insert(connectionRequests).values({
    id,
    orgId: ctx.orgId,
    agentId: ctx.agentId,
    runId: ctx.runId,
    channelId: at.channelId,
    threadId: at.threadId,
    requestedForUserId: forUserId,
    service: found.id,
    label: found.label,
    why: input.why,
    nextStep: input.next,
    askedUserIds: asked,
    expiresAt: until,
  });
  const message = await insertMessage(ctx.db, {
    orgId: ctx.orgId,
    ...at,
    author: { type: "agent", agentId: ctx.agentId, runId: ctx.runId, hop: await hopOf(ctx) },
    body: `Connect ${found.label}: ${input.why}`,
    meta: {
      ...bodyCode(CONNECT_APP_CARD, { name: found.label }),
      actionCard: { kind: "connect_app", forUserId, params: { connector: found.id, why: input.why, request } },
    },
  });
  await ctx.db
    .update(connectionRequests)
    .set({ messageId: message.id })
    .where(and(eq(connectionRequests.orgId, ctx.orgId), eq(connectionRequests.id, id)));
  if (deps.pubsub) await publishMessageCreated(deps.pubsub, messageView(message)).catch(() => undefined);
  if (asked.length > 0) {
    await notify(
      { db: ctx.db, pubsub: deps.pubsub },
      {
        orgId: ctx.orgId,
        userIds: asked,
        kind: "admin_ask",
        groupKey: askGroup(id),
        waiting: true,
        actor: { type: "agent", id: ctx.agentId },
        source: {
          channelId: at.channelId,
          ...(at.threadId ? { threadId: at.threadId } : {}),
          messageId: message.id,
          agentId: ctx.agentId,
          userId: forUserId,
          runId: ctx.runId,
        },
        latest: { reason: "connector", title: found.label, text: input.why },
      },
    ).catch(() => undefined);
  }
  await recordAudit(ctx.db, {
    orgId: ctx.orgId,
    actor: { type: "agent", id: ctx.agentId },
    action: "connector.requested",
    target: { type: "agent", id: ctx.agentId },
    details: { requestId: id, service: found.id, requestedFor: forUserId, asked: asked.length },
  });
  await enqueue(ctx.db, {
    orgId: ctx.orgId,
    kind: CONNECTION_REQUEST_EXPIRED_JOB,
    payload: { requestId: id },
    dedupeKey: `${CONNECTION_REQUEST_EXPIRED_JOB}:${id}`,
    runAt: until,
  });
  // Connected between the check above and now (another tab): the job settles it at once.
  await queueConnectionCheck(ctx.db, ctx.orgId);
  const who = asked.length > 0 ? joinWords(await namesOf(ctx.db, asked.slice(0, 3))) : "";
  return {
    content: may
      ? `Posted the card to connect ${found.label}: the person connects it from there. You wait here and go on by yourself once it's connected.`
      : `Posted the card to connect ${found.label}. The person who asked can't connect apps: ${who} ${asked.length === 1 ? "was" : "were"} asked to. You wait here and go on by yourself once it's connected.`,
    data: { pause: { kind: "connection", id: connectionWaitId(id) }, actionCard: { messageId: message.id } },
  };
}

const askGroup = (requestId: string) => `admin-ask:connector:${requestId}`;

/** The card's `request` with `patch` applied, and the apps told (`action_card.updated`). */
async function updateCard(
  deps: ConnectionRequestDeps,
  row: ConnectionRequestRow,
  patch: Partial<ConnectionRequestCard>,
) {
  if (!row.messageId) return;
  const [updated] = await deps.db
    .update(messages)
    .set({
      meta: sql`jsonb_set(${messages.meta}, '{actionCard,params,request}', coalesce(${messages.meta}->'actionCard'->'params'->'request', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
    })
    .where(
      and(
        eq(messages.orgId, row.orgId),
        eq(messages.id, row.messageId),
        sql`${messages.meta}->'actionCard'->>'kind' = 'connect_app'`,
      ),
    )
    .returning({ meta: messages.meta, threadId: messages.threadId });
  const card = updated?.meta?.actionCard as Record<string, unknown> | undefined;
  if (!card) return;
  await publishChannelEvent(deps.pubsub, {
    type: "action_card.updated",
    channelId: row.channelId,
    threadId: updated?.threadId ?? null,
    messageId: row.messageId,
    card,
  });
}

/** The request's state moves on once: the row as it is now, or null when it had already moved on. */
async function claim(db: Executor, id: string, state: ConnectionRequestState, connectionId: string | null = null) {
  const [row] = await db
    .update(connectionRequests)
    .set({ state, endedAt: new Date(), ...(connectionId ? { connectionId } : {}) })
    .where(and(eq(connectionRequests.id, id), eq(connectionRequests.state, "waiting")))
    .returning();
  return row ?? null;
}

/** What the agent goes on with: the request it was working on, read from its run's trigger. */
async function askedFor(db: Executor, row: ConnectionRequestRow) {
  const [run] = await db
    .select({ triggerMessageId: agentRuns.triggerMessageId })
    .from(agentRuns)
    .where(eq(agentRuns.id, row.runId));
  if (!run?.triggerMessageId) return "";
  const [m] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.orgId, row.orgId), eq(messages.id, run.triggerMessageId)));
  return m?.body ? cutText(m.body, 600) : "";
}

/**
 * The agent goes on once the service is connected: the run still waiting on it reads the result and resumes; a run
 * that stopped waiting (a person wrote meanwhile) or ended gets a notice in its conversation, which joins its next run
 * or starts one, with the task. A canceled run stays stopped. True when the agent goes on.
 */
async function goOn(deps: ConnectionRequestDeps, row: ConnectionRequestRow): Promise<boolean> {
  const label = row.label;
  const task = await askedFor(deps.db, row);
  const from = `Your request to connect ${label}`;
  const later = `${label} is connected now and its tools are yours (find_tools "${label}" when they aren't listed). You were waiting on it to: ${row.nextStep}${task ? `\nWhat you were asked: «${task}»` : ""}\nCarry on with it now, without asking the person again.`;
  const resumed = await resumeRunWithResult(deps.db, {
    runId: row.runId,
    waitId: connectionWaitId(row.id),
    result: {
      content: `${label} is connected now and its tools are yours from your next step (find_tools "${label}" when they aren't listed). Carry on with the task: ${row.nextStep}`,
    },
    late: { kind: "wait_result", from, text: later },
    pubsub: deps.pubsub,
  });
  if (resumed) return true;
  const [run] = await deps.db.select().from(agentRuns).where(eq(agentRuns.id, row.runId));
  if (!run || run.status === "canceled") return false;
  const notice: Notice = { kind: "wait_result", from, text: later, refs: { waitId: connectionWaitId(row.id) } };
  const delivered = await deps.db.transaction((tx) => deliverNoticeToRun(tx, run, notice));
  await publishDelivery(deps.pubsub, delivered).catch(() => undefined);
  return true;
}

/**
 * Settles the workspace's open requests: each one whose agent now holds a working connection of its service is
 * `connected`, its card says so (and whether the agent goes on), its asks are done, and the agent goes on (`goOn`).
 * Returns the requests settled.
 */
export async function settleConnectionRequests(deps: ConnectionRequestDeps, orgId: string): Promise<string[]> {
  const open = await deps.db
    .select()
    .from(connectionRequests)
    .where(and(eq(connectionRequests.orgId, orgId), eq(connectionRequests.state, "waiting")))
    .limit(200);
  const settled: string[] = [];
  for (const r of open) {
    const standing = await serviceStanding(deps.db, orgId, r.agentId, r.service);
    if (!standing.held) continue;
    const row = await claim(deps.db, r.id, "connected", standing.held);
    if (!row) continue;
    const resumed = await goOn(deps, row).catch(() => false);
    await updateCard(deps, row, {
      state: "connected",
      resumed,
      endedAt: (row.endedAt ?? new Date()).toISOString(),
    });
    await resolveNotifications(deps, orgId, { groupKey: askGroup(row.id) }).catch(() => 0);
    settled.push(row.id);
  }
  return settled;
}

/**
 * A day went by: a request still open (checked once more first) ends, its card says so, and a run still waiting on it
 * reads that it stopped waiting. False: it had already ended.
 */
export async function expireConnectionRequest(deps: ConnectionRequestDeps, requestId: string): Promise<boolean> {
  const [r] = await deps.db.select().from(connectionRequests).where(eq(connectionRequests.id, requestId));
  if (r?.state !== "waiting") return false;
  if ((await settleConnectionRequests(deps, r.orgId)).includes(requestId)) return false;
  const row = await claim(deps.db, requestId, "expired");
  if (!row) return false;
  await resumeRunWithResult(deps.db, {
    runId: row.runId,
    waitId: connectionWaitId(row.id),
    result: {
      content: `Nobody connected ${row.label} within a day, so you stopped waiting. Tell the person in one line that once it's connected they can ask you again.`,
    },
    waitingOnly: true,
  });
  await updateCard(deps, row, { state: "expired", endedAt: (row.endedAt ?? new Date()).toISOString() });
  await resolveNotifications(deps, row.orgId, { groupKey: askGroup(row.id) }).catch(() => 0);
  return true;
}
