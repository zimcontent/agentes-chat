import type { ApprovalPortal, PubSub } from "@dougbot/adapters";
import { and, type Database, eq, gte, inArray, isNull, rowsOf, schema, sql } from "@dougbot/db";
import { parseBlockSpec } from "@dougbot/ui/blocks/spec";
import { type ArtifactDeps, createConversationArtifact, getArtifact } from "../artifacts";
import { markBlockActed } from "../block-state";
import { replyToBlock } from "../blocks";
import { requireChannelAccess } from "../channels";
import type { ConnectorTriggerDeps } from "../connector-triggers";
import { openDm } from "../dms";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { publishMessageCreated } from "../events";
import type { Judge } from "../judge";
import { OFFER_ACT_KINDS } from "../learned-words";
import { insertMessage, type MessageView, messageView } from "../messages";
import { can, getMembership } from "../organizations";
import { enqueue } from "../outbox";
import { personLocale } from "../requester";
import { isRightHand, rightHandReader } from "../right-hand";
import type { Talker } from "../talker";
import type { ToolDefinition, ToolSource } from "../tools/types";
import { setWhatsAppChatAgent } from "../whatsapp/agent";
import { type CalendarReader, calendarConnection, calendarReader } from "./google-calendar";
import {
  isSector,
  readSector,
  readSectors,
  SECTORS,
  type Sector,
  type SectorCard,
  type SectorInput,
  sectorDay,
} from "./sectors";
import { cardLang, cardWords } from "./words";

const { agents, blockActions, messages, organizationMembers, organizationSettings } = schema;

/**
 * The right hand's sector cards (docs/adr/doug-0020-doug-sector-cards.md): WhatsApp, Agenda, Aprovações, Propostas,
 * Tarefas, Revisão and Portal as live blocks in its conversation with each person, made by the server from what it
 * reads in code (no model). They come three ways: the day's brief at the ronda that opens the day, one card when
 * something arrives that needs the person (at a ronda's slot, at most `CARDS_PER_DAY` a day, never the same thing
 * twice), and when asked (a pill above the composer, or the right hand's own `show_sector_card`).
 */

/** Cards that arrive on their own during a day, besides the brief: the stretch of a quiet assistant. */
export const CARDS_PER_DAY = 6;
/** The tool the right hand shows a sector's card with. */
export const SHOW_SECTOR_CARD_TOOL = "show_sector_card";
/** Where a message says it carries sector cards: `{ day, why, items: [{ sector, key, artifactId }] }`. */
export const SECTOR_CARDS_META = "sectorCards";

export type SectorCardWhy = "brief" | "arrived" | "asked";

export interface SectorCardDeps extends ArtifactDeps {
  pubsub: PubSub;
  /** How the Agenda reaches the Google Calendar connection; absent: no Agenda. */
  connectors?: ConnectorTriggerDeps | null;
  portal?: ApprovalPortal | null;
  judge?: Judge;
  talker?: Talker;
  now?: () => Date;
  /** Tests: the calendar, in place of the connection. */
  calendar?: CalendarReader | null;
}

/** The person's time zone: theirs, else the workspace's, else UTC. */
async function zoneOf(db: Database, orgId: string, userId: string) {
  const rows = rowsOf<{ zone: string | null }>(
    await db.execute(sql`select coalesce(om.timezone, os.timezone) as zone
      from ${organizationMembers} om
      left join ${organizationSettings} os on os.org_id = om.org_id
      where om.org_id = ${orgId}::uuid and om.user_id = ${userId}`),
  );
  const zone = rows[0]?.zone;
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

async function inputFor(
  deps: SectorCardDeps,
  q: { orgId: string; agentId: string; personId: string; since?: Date; withCalendar: boolean },
): Promise<SectorInput> {
  const now = deps.now?.() ?? new Date();
  const locale = await personLocale(deps.db, q.personId);
  const calendar = !q.withCalendar
    ? null
    : deps.calendar !== undefined
      ? deps.calendar
      : await calendarReader(deps.connectors, q.orgId, q.agentId).catch(() => null);
  return {
    db: deps.db,
    orgId: q.orgId,
    agentId: q.agentId,
    personId: q.personId,
    zone: await zoneOf(deps.db, q.orgId, q.personId),
    locale,
    words: cardWords(cardLang(locale)),
    now,
    since: q.since ?? new Date(now.getTime() - 3_600_000),
    calendar,
    portal: deps.portal ?? null,
  };
}

/**
 * Posts `cards` as one message of the right hand in `channelId`: each card a block of its own (its buttons' actions
 * held in `block_actions` for `personId`), the message carrying them all (`meta.artifacts`) and what they are
 * (`meta.sectorCards`). Told like any message of the agent when `notify` (a push for what arrived on its own).
 */
export async function postSectorCards(
  deps: SectorCardDeps,
  input: {
    orgId: string;
    agentId: string;
    personId: string;
    channelId: string;
    body: string;
    cards: SectorCard[];
    why: SectorCardWhy;
    day: string;
    notify: boolean;
  },
): Promise<MessageView> {
  const actor = { type: "agent" as const, agentId: input.agentId, channelId: input.channelId, threadId: null };
  const links: { id: string; version: number; title: string }[] = [];
  const items: { sector: Sector; key: string; artifactId: string }[] = [];
  for (const card of input.cards) {
    const spec = parseBlockSpec(card.spec);
    const a = await createConversationArtifact(deps, actor, input.orgId, {
      title: card.title,
      content: { kind: "block", spec },
    });
    if (card.acts.length > 0) {
      await deps.db.insert(blockActions).values(
        card.acts.map((x) => ({
          orgId: input.orgId,
          artifactId: a.id,
          act: x.act,
          kind: x.kind,
          payload: x.payload,
          forUserId: input.personId,
        })),
      );
    }
    links.push({ id: a.id, version: a.version, title: a.title });
    items.push({ sector: card.sector, key: card.key, artifactId: a.id });
  }
  const message = await deps.db.transaction(async (tx) => {
    const m = await insertMessage(tx, {
      orgId: input.orgId,
      channelId: input.channelId,
      threadId: null,
      author: { type: "agent", agentId: input.agentId, runId: null, hop: 0, stretchId: null },
      body: input.body,
      meta: {
        ...(links.length ? { artifacts: links } : {}),
        [SECTOR_CARDS_META]: { day: input.day, why: input.why, items },
      },
    });
    if (input.notify) {
      await enqueue(tx, {
        orgId: input.orgId,
        kind: "notifications.message",
        payload: { messageId: m.id },
        dedupeKey: `notifications.message:${m.id}`,
        maxAttempts: 4,
      });
    }
    return m;
  });
  const view = messageView(message);
  await publishMessageCreated(deps.pubsub, view);
  return view;
}

/** The sector cards the right hand already showed this person today in their conversation: sector → keys. */
async function shownToday(db: Database, orgId: string, agentId: string, channelId: string, day: string, since: Date) {
  const rows = await db
    .select({ meta: messages.meta })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, orgId),
        eq(messages.channelId, channelId),
        eq(messages.authorAgentId, agentId),
        gte(messages.createdAt, since),
        isNull(messages.deletedAt),
        sql`${messages.meta} -> ${SECTOR_CARDS_META} ->> 'day' = ${day}`,
      ),
    );
  const keys = new Map<string, Set<string>>();
  let arrived = 0;
  let brief = false;
  for (const r of rows) {
    const m = r.meta[SECTOR_CARDS_META] as { why?: string; items?: { sector: string; key: string }[] } | undefined;
    if (m?.why === "arrived") arrived++;
    if (m?.why === "brief") brief = true;
    for (const it of m?.items ?? []) {
      const set = keys.get(it.sector) ?? new Set<string>();
      set.add(it.key);
      keys.set(it.sector, set);
    }
  }
  return { keys, arrived, brief };
}

/**
 * At a slot of the right hand's ronda for `personId` (ADR 9004, 9005): the day's brief when the slot opens the day,
 * else one message with the cards of what arrived since `since` and needs the person, at most `CARDS_PER_DAY` a day,
 * never a card about the same thing twice in a day. Read in code; nothing here calls a model. Returns the sectors it
 * showed (for the ronda's run not to repeat them). Never throws: a ronda goes on without its cards.
 */
export async function deliverSectorCards(
  deps: SectorCardDeps,
  input: { orgId: string; agentId: string; personId: string; channelId: string; opening: boolean; since: Date },
): Promise<Sector[]> {
  try {
    const q = await inputFor(deps, { ...input, withCalendar: input.opening });
    const day = sectorDay(q.now, q.zone);
    const shown = await shownToday(
      deps.db,
      input.orgId,
      input.agentId,
      input.channelId,
      day,
      new Date(q.now.getTime() - 36 * 3_600_000),
    );
    const fresh = (c: SectorCard) => !shown.keys.get(c.sector)?.has(c.key);
    if (input.opening && !shown.brief) {
      const cards = (await readSectors(q)).filter(fresh);
      if (cards.length === 0) return [];
      await postSectorCards(deps, { ...input, body: q.words.briefToday, cards, why: "brief", day, notify: true });
      return cards.map((c) => c.sector);
    }
    if (shown.arrived >= CARDS_PER_DAY) return [];
    const cards = (
      await readSectors(
        q,
        SECTORS.filter((s) => s !== "calendar"),
      )
    ).filter((c) => c.urgent && fresh(c));
    if (cards.length === 0) return [];
    await postSectorCards(deps, { ...input, body: q.words.arrived, cards, why: "arrived", day, notify: true });
    return cards.map((c) => c.sector);
  } catch {
    return [];
  }
}

/** The right hand of the workspace, when `agentId` is it. */
async function rightHandRow(db: Database, orgId: string, agentId: string) {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId), isNull(agents.deletedAt)));
  if (!row || !isRightHand(row)) throw new NotFoundError("Agent not found");
  return row;
}

export interface SectorPill {
  sector: Sector;
  /** What waits there; 0: a pill with no number (the agenda). */
  count: number;
}

/**
 * The pills above the composer in a person's conversation with the right hand: the sectors with something for them,
 * and the agenda whenever a Google Calendar connection the right hand may read exists (no connection, no pill). The
 * calendar itself is read only when its pill is pressed.
 */
export async function sectorPills(deps: SectorCardDeps, userId: string, orgId: string, agentId: string) {
  if (!(await getMembership(deps.db, userId, orgId))) throw new NotFoundError("Agent not found");
  await rightHandRow(deps.db, orgId, agentId);
  const q = await inputFor(deps, { orgId, agentId, personId: userId, withCalendar: false });
  const cards = await readSectors(
    q,
    SECTORS.filter((s) => s !== "calendar"),
  );
  const calendar =
    deps.calendar !== undefined
      ? !!deps.calendar
      : !!(await calendarConnection(deps.db, orgId, agentId).catch(() => null));
  const pills: SectorPill[] = cards.map((c) => ({ sector: c.sector, count: c.count }));
  if (calendar) pills.splice(Math.min(1, pills.length), 0, { sector: "calendar", count: 0 });
  return pills;
}

/** A pill pressed: the right hand shows that sector's card in the person's conversation with it, now. */
export async function showSectorCard(
  deps: SectorCardDeps,
  userId: string,
  orgId: string,
  agentId: string,
  sector: string,
): Promise<MessageView> {
  if (!isSector(sector)) throw new ValidationError("No such sector");
  await rightHandRow(deps.db, orgId, agentId);
  const dm = await openDm(deps.db, userId, orgId, { agentId });
  const q = await inputFor(deps, { orgId, agentId, personId: userId, withCalendar: sector === "calendar" });
  const card = await readSector(sector, q);
  return postSectorCards(deps, {
    orgId,
    agentId,
    personId: userId,
    channelId: dm.id,
    body: card ? q.words.asked : q.words.nothing,
    cards: card ? [card] : [],
    why: "asked",
    day: sectorDay(q.now, q.zone),
    notify: false,
  });
}

/**
 * A button's server action, pressed by `userId` (docs/adr/doug-0020-doug-sector-cards.md §4). The block's row says
 * what it is; it runs once (the first press claims it), only for the person the card is for, and only for someone
 * who may post where the card is. Then the block's `_acted` state tells everyone looking that it ran. An action that
 * fails leaves the button as it was, to press again.
 */
export async function runBlockAct(
  deps: SectorCardDeps,
  userId: string,
  orgId: string,
  artifactId: string,
  act: string,
): Promise<{ act: string; done: true; messageId: string | null }> {
  const a = await getArtifact(deps, { type: "person", userId }, orgId, artifactId);
  if (a.kind !== "block" || !a.channelId) throw new NotFoundError("Block not found");
  const [row] = await deps.db
    .select()
    .from(blockActions)
    .where(and(eq(blockActions.orgId, orgId), eq(blockActions.artifactId, artifactId), eq(blockActions.act, act)));
  if (!row) throw new NotFoundError("This button does nothing on the server");
  if (row.forUserId && row.forUserId !== userId) throw new ForbiddenError("This card is someone else's");
  const { membership } = await requireChannelAccess(deps.db, userId, orgId, a.channelId);
  if (!can(membership, "post")) throw new ForbiddenError();
  // The offer to make a routine ("Aprendi a fazer isso", ADR 0120 addendum 2026-11-20) is one choice: pressing any of
  // its buttons claims them all, so two cadences can't both become routines.
  const oneChoice = OFFER_ACT_KINDS.has(row.kind);
  const claimed = await deps.db
    .update(blockActions)
    .set({ doneAt: new Date(), doneByUserId: userId })
    .where(
      and(
        oneChoice ? eq(blockActions.artifactId, artifactId) : eq(blockActions.id, row.id),
        isNull(blockActions.doneAt),
      ),
    )
    .returning({ id: blockActions.id });
  const release = () =>
    claimed.length > 0
      ? deps.db
          .update(blockActions)
          .set({ doneAt: null, doneByUserId: null })
          .where(
            inArray(
              blockActions.id,
              claimed.map((c) => c.id),
            ),
          )
      : Promise.resolve();
  if (!claimed.some((c) => c.id === row.id)) {
    await release();
    throw new ConflictError("This was already done", "block_act.done");
  }
  let messageId: string | null = null;
  try {
    if (row.kind === "make_routine") {
      const { acceptRoutineOffer } = await import("../learned-line");
      await acceptRoutineOffer(deps, userId, orgId, row.payload);
    } else if (row.kind === "skip_routine") {
      // "Agora não": nothing to run, the choice is made.
    } else if (row.kind === "ask_agent") {
      const text = typeof row.payload.text === "string" ? row.payload.text : "";
      const m = await replyToBlock(deps, userId, orgId, artifactId, { text });
      messageId = m.id;
    } else if (row.kind === "whatsapp_mine") {
      const { accountId, chatId } = row.payload as { accountId?: string; chatId?: string };
      if (!accountId || !chatId) throw new ValidationError("Nothing to hand over");
      await setWhatsAppChatAgent(
        { db: deps.db, gateway: null, keyWrappers: [], hookBase: "", pubsub: deps.pubsub },
        userId,
        orgId,
        accountId,
        chatId,
        false,
      );
    } else throw new ValidationError("Unknown action");
  } catch (error) {
    await release();
    throw error;
  }
  await markBlockActed(deps, userId, orgId, artifactId, a.version, act).catch(() => undefined);
  return { act, done: true, messageId };
}

/**
 * `show_sector_card`: the right hand shows a sector's card when the person asks in its conversation ("como está o
 * WhatsApp?", "minha agenda"). Only in a private conversation with that person, like `team_status`; no scope, since
 * it shows the person only what they may see, read as them.
 */
export function createSectorCardToolSource(deps: SectorCardDeps): ToolSource {
  const tool: ToolDefinition = {
    name: SHOW_SECTOR_CARD_TOOL,
    description: `Show the person a sector's card in your reply, with its live numbers and buttons: ${SECTORS.join(", ")} (calendar is their Google Calendar for today). Use it when they ask how a sector is ("how's WhatsApp?", "my agenda", "what needs me?") instead of describing it: the card is read live and its buttons act. One call per sector. Write at most one short line around it.`,
    scope: "",
    inputSchema: {
      type: "object",
      properties: { sector: { type: "string", enum: [...SECTORS] } },
      required: ["sector"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Show ${String(input.sector)}` }),
    async execute(input, ctx) {
      const person = await rightHandReader(ctx);
      if (!person) return { content: "Only in your private conversation with a person.", isError: true };
      const sector = input.sector;
      if (!isSector(sector)) return { content: `sector is one of ${SECTORS.join(", ")}`, isError: true };
      const q = await inputFor(deps, {
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        personId: person,
        withCalendar: sector === "calendar",
      });
      const card = await readSector(sector, q);
      if (!card) {
        return {
          content:
            sector === "calendar" && !q.calendar
              ? "There is no Google Calendar connection you may read: say so, and that an admin can connect it in Settings › Connectors."
              : "Nothing there for them right now: say so in a line.",
        };
      }
      const a = await createConversationArtifact(
        deps,
        { type: "agent", agentId: ctx.agentId, channelId: ctx.channelId, threadId: null, runId: ctx.runId },
        ctx.orgId,
        { title: card.title, content: { kind: "block", spec: parseBlockSpec(card.spec) } },
      );
      if (card.acts.length > 0) {
        await deps.db.insert(blockActions).values(
          card.acts.map((x) => ({
            orgId: ctx.orgId,
            artifactId: a.id,
            act: x.act,
            kind: x.kind,
            payload: x.payload,
            forUserId: person,
          })),
        );
      }
      return {
        content: `Showing the ${sector} card in your reply. Don't repeat its numbers; add a line only if you have something to say about it.`,
        data: { artifact: { id: a.id, version: a.version, title: a.title } },
      };
    },
  };
  return {
    name: "sector-cards",
    tools: async (ctx) => {
      const [row] = await ctx.db.select({ builtin: agents.builtin }).from(agents).where(eq(agents.id, ctx.agentId));
      return isRightHand(row) ? [tool] : [];
    },
  };
}
