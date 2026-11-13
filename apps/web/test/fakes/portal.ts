/**
 * Test fake — the approval portal (ADR 9001), same shapes as the server's `…/portal/*` routes. Off (404 `portal.off`
 * on every call) unless the test's server says it has a portal (`authConfig.approvalPortal`). Empty until a test adds
 * cards (`fake.cards`) and posts (`fake.items`); the overview and the boards are worked out from them as the server
 * does. A send starts a job that is `sending`, then `done` on its next read (the post lands in Waiting for approval
 * and its card leaves), or stays `sending` while `fake.holdSends` until `fake.finish`. `fake.fail` makes the next
 * call throw (a refusal in the portal's words, or 502). Scheduling an approved post gives it its date and leaves it
 * `approved`, as the real one does until the publishing service has it; a test sets `status: "scheduled"` itself for
 * what comes after. Changes are logged; reads are not.
 */
import type {
  ApiClient,
  PortalCard,
  PortalClientSummary,
  PortalColumn,
  PortalItem,
  PortalJob,
  PortalState,
  PortalStatus,
} from "@agenteschat/client";
import { ApiError } from "@agenteschat/client";
import { clone } from "./context";

export interface FakePortal {
  client: NonNullable<ApiClient["portal"]>;
  /** Clients the portal has, even with nothing on their board. */
  clients: string[];
  cards: PortalCard[];
  items: PortalItem[];
  jobs: Map<string, PortalJob>;
  /** How fresh the portal's side is, sent with the overview and every board (default: fresh, nothing queued). */
  state: PortalState;
  /** The next call throws this, once. */
  fail: ApiError | null;
  /** Keeps a send `sending` until `finish`. */
  holdSends: boolean;
  /** A held send ends: done (what it still lacks) or failed with the portal's words. */
  finish(jobId: string, result?: { error: string } | { missing: PortalJob["missing"] }): void;
}

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

/** A card as the server would send it. */
export function portalCard(over: Partial<PortalCard> & Pick<PortalCard, "id" | "client" | "title">): PortalCard {
  return {
    type: "reel",
    state: "todo",
    caption: "",
    date: null,
    editor: null,
    owner: null,
    note: "",
    files: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/** A post as the server would send it. */
export function portalItem(over: Partial<PortalItem> & Pick<PortalItem, "id" | "client" | "title">): PortalItem {
  return {
    type: "reel",
    status: "sent",
    scheduledFor: null,
    released: false,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
    editor: null,
    caption: "",
    files: 1,
    video: true,
    version: 1,
    missing: [],
    lastNote: null,
    postUrl: null,
    link: `https://portal.example/${over.client}/${over.id}`,
    ...over,
  };
}

export function createFakePortal(log: (method: string, ...args: unknown[]) => void, on: () => boolean): FakePortal {
  let seq = 0;
  const hex = () => (++seq).toString(16).padStart(8, "0");
  const guard = () => {
    if (!on()) throw new ApiError(404, "portal.off", "This server has no approval portal");
    const fail = fake.fail;
    if (fail) {
      fake.fail = null;
      throw fail;
    }
  };
  const columnsOf = (client: string) => {
    const counts: Record<PortalColumn, number> = {
      todo: 0,
      doing: 0,
      approval: 0,
      adjusting: 0,
      approved: 0,
      scheduled: 0,
      posted: 0,
    };
    for (const c of fake.cards) if (c.client === client) counts[c.state] += 1;
    for (const i of fake.items) if (i.client === client) counts[COLUMN_OF[i.status]] += 1;
    return counts;
  };
  const end = (job: PortalJob, result: { error: string } | { missing: PortalJob["missing"] } = { missing: [] }) => {
    if (job.state !== "sending") return;
    if ("error" in result) {
      job.state = "failed";
      job.error = result.error;
      return;
    }
    const sent = sends.get(job.id);
    const id = `p${hex()}`;
    job.state = "done";
    job.item = id;
    job.missing = result.missing;
    job.link = `https://portal.example/${job.client}/${id}`;
    fake.items.push(
      portalItem({
        id,
        client: job.client,
        title: job.title ?? "Untitled",
        type: sent?.type ?? "reel",
        files: sent?.files ?? 1,
        missing: result.missing,
      }),
    );
    if (sent?.card) fake.cards = fake.cards.filter((c) => c.id !== sent.card);
  };
  const sends = new Map<string, { type: PortalItem["type"]; files: number; card?: string }>();
  const fake: FakePortal = {
    clients: [],
    cards: [],
    items: [],
    jobs: new Map(),
    state: { stale: false, readAt: null, queued: 0 },
    fail: null,
    holdSends: false,
    finish(jobId, result) {
      const job = fake.jobs.get(jobId);
      if (job) end(job, result);
    },
    client: {
      overview: async () => {
        guard();
        const names = [
          ...new Set([...fake.clients, ...fake.cards.map((c) => c.client), ...fake.items.map((i) => i.client)]),
        ];
        const clients = names.sort().map((client): PortalClientSummary => {
          const counts = columnsOf(client);
          const dates = fake.items
            .filter((i) => i.client === client && i.status === "scheduled" && i.scheduledFor)
            .map((i) => i.scheduledFor as string)
            .sort();
          return {
            client,
            counts,
            open: counts.todo + counts.doing + counts.approval + counts.adjusting + counts.approved + counts.scheduled,
            next: dates[0] ?? null,
          };
        });
        return clone({ clients, state: fake.state });
      },
      board: async (_orgId, client) => {
        guard();
        const cards = fake.cards.filter((c) => c.client === client);
        const items = fake.items.filter((i) => i.client === client);
        const at = (column: PortalColumn) => items.filter((i) => COLUMN_OF[i.status] === column);
        return clone({
          client,
          state: fake.state,
          cards: { todo: cards.filter((c) => c.state === "todo"), doing: cards.filter((c) => c.state === "doing") },
          items: {
            approval: at("approval"),
            adjusting: at("adjusting"),
            approved: at("approved"),
            scheduled: at("scheduled"),
            posted: at("posted"),
          },
        });
      },
      createCard: async (orgId, input) => {
        log("portal.createCard", orgId, input);
        guard();
        const card = portalCard({ id: `c-${hex()}`, ...input });
        fake.cards.push(card);
        return clone(card);
      },
      updateCard: async (orgId, cardId, input) => {
        log("portal.updateCard", orgId, cardId, input);
        guard();
        const card = fake.cards.find((c) => c.id === cardId);
        if (!card) throw new ApiError(400, "portal.refused", "No such card");
        Object.assign(card, input, { updatedAt: card.updatedAt + 1 });
        return clone(card);
      },
      deleteCard: async (orgId, cardId) => {
        log("portal.deleteCard", orgId, cardId);
        guard();
        fake.cards = fake.cards.filter((c) => c.id !== cardId);
      },
      send: async (orgId, input) => {
        log("portal.send", orgId, input);
        guard();
        const job: PortalJob = {
          id: hex(),
          state: "sending",
          client: input.client,
          item: null,
          title: input.title ?? null,
          missing: [],
          link: null,
          error: null,
        };
        fake.jobs.set(job.id, job);
        sends.set(job.id, { type: input.type, files: input.artifactIds.length, card: input.card });
        return clone(job);
      },
      job: async (_orgId, jobId) => {
        guard();
        const job = fake.jobs.get(jobId);
        if (!job) throw new ApiError(404, "not_found", "No such send");
        if (!fake.holdSends) end(job);
        return clone(job);
      },
      editItem: async (orgId, client, itemId, edit) => {
        log("portal.editItem", orgId, client, itemId, edit);
        guard();
        const item = fake.items.find((i) => i.client === client && i.id === itemId);
        if (!item) throw new ApiError(400, "portal.refused", "No such post");
        Object.assign(item, edit);
      },
      schedule: async (orgId, client, itemId, scheduledFor) => {
        log("portal.schedule", orgId, client, itemId, scheduledFor);
        guard();
        const item = fake.items.find((i) => i.client === client && i.id === itemId);
        if (!item || item.status !== "approved") {
          throw new ApiError(400, "portal.refused", "Only an approved post can be scheduled");
        }
        if (item.released) throw new ApiError(400, "portal.refused", "This post was already released");
        // Released: it keeps `approved` with its date until the publishing service has it.
        item.scheduledFor = `${scheduledFor}:00-03:00`;
        item.released = true;
      },
    },
  };
  return fake;
}
