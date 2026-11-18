/**
 * Test fake — the approval portal (ADR 9001), same shapes as the server's `…/portal/*` routes. Off (404 `portal.off`
 * on every call) unless the test's server says it has a portal (`authConfig.approvalPortal`). Empty until a test adds
 * cards (`fake.cards`) and posts (`fake.items`); the overview and the boards are worked out from them as the server
 * does. A send starts a job that is `sending`, then `done` on its next read (the post lands in Waiting for approval
 * and its card stays, tied to it: off the board, still on the schedule), or stays `sending` while `fake.holdSends` until `fake.finish`. `fake.fail` makes the next
 * call throw (a refusal in the portal's words, or 502). Scheduling an approved post gives it its date and leaves it
 * `approved`, as the real one does until the publishing service has it; a test sets `status: "scheduled"` itself for
 * what comes after. Every card is also a task of the workspace: a new card gets one, numbered after the last
 * (`fake.tasks`), and a test that wants a card already there to have one sets its `task` and adds the task's number.
 * Changes are logged; reads are not.
 */
import type {
  ApiClient,
  PlanCard,
  PortalCard,
  PortalClientAccount,
  PortalClientColor,
  PortalClientSummary,
  PortalColumn,
  PortalNoticeNumber,
  PortalItem,
  PortalJob,
  PortalLabel,
  PortalList,
  PortalState,
  PortalStatus,
  PortalTaskRef,
} from "@agenteschat/client";
import { ApiError } from "@agenteschat/client";
import { clone } from "./context";

export interface FakePortal {
  client: NonNullable<ApiClient["portal"]>;
  /** Clients the portal has, even with nothing on their board. */
  clients: string[];
  cards: PortalCard[];
  items: PortalItem[];
  /** Each card's task: its id and number. */
  tasks: PortalTaskRef[];
  /** The schedule's lists, each a client's, in the team's order. */
  /** With no `kind`, a list of the schedule. */
  lists: (Omit<PortalList, "kind"> & { kind?: PortalList["kind"]; client: string })[];
  /** The team's labels, one set for every client. */
  labels: PortalLabel[];
  /** The colour the team gave each client. */
  colors: Record<string, PortalClientColor>;
  /** Each client's logo: where it is read. */
  logos: Record<string, string>;
  /** The installation's own portal's clients (docs/adr/doug-0022), by id. */
  accounts: Record<string, PortalClientAccount>;
  /** The number the portal's notices go out as, and the connected ones to pick from (ADR doug-0022 §7). */
  noticeNumber: string | null;
  noticeNumbers: PortalNoticeNumber[];
  /** The portal's own today (`YYYY-MM-DD`), which `mine` reads production dates against (default: this machine's). */
  day: string;
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
    produceOn: null,
    list: null,
    order: 0,
    description: "",
    labels: [],
    members: [],
    checklist: [],
    comments: [],
    item: null,
    task: null,
    done: false,
    material: false,
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

export function createFakePortal(
  log: (method: string, ...args: unknown[]) => void,
  on: () => boolean,
  me: () => string | null = () => null,
): FakePortal {
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
    // A card that was sent stands for its post: the post is what counts from then on.
    for (const c of fake.cards) if (c.client === client && !c.item) counts[c.state] += 1;
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
    // The card stays, tied to its post.
    const card = fake.cards.find((c) => c.id === sent?.card);
    if (card) card.item = id;
  };
  const sends = new Map<string, { type: PortalItem["type"]; files: number; card?: string }>();
  const stageOf = (card: PortalCard): PlanCard => {
    const item = card.item ? fake.items.find((i) => i.client === card.client && i.id === card.item) : undefined;
    return {
      ...card,
      stage: item ? COLUMN_OF[item.status] : card.item ? "approval" : card.state,
      postOn: item?.scheduledFor ?? card.date,
      link: item?.link ?? null,
    };
  };
  const byOrder = (a: PortalCard, b: PortalCard) => a.order - b.order || a.createdAt - b.createdAt;
  const cardOf = (cardId: string) => {
    const card = fake.cards.find((c) => c.id === cardId);
    if (!card) throw new ApiError(400, "portal.refused", "No such card");
    return card;
  };
  const today = new Date();
  const fake: FakePortal = {
    clients: [],
    accounts: {},
    noticeNumber: null,
    noticeNumbers: [],
    cards: [],
    items: [],
    tasks: [],
    lists: [],
    labels: [],
    colors: {},
    logos: {},
    day: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
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
            color: fake.colors[client] ?? null,
            logo: fake.logos[client] ?? null,
          };
        });
        return clone({ clients, state: fake.state });
      },
      board: async (_orgId, client) => {
        guard();
        const shelf = new Set(fake.lists.filter((l) => l.kind === "materials").map((l) => l.id));
        const cards = fake.cards.filter((c) => c.client === client && !c.item && !(c.list && shelf.has(c.list)));
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
        const last = Math.max(0, ...fake.cards.filter((c) => c.client === input.client).map((c) => c.order));
        const card = portalCard({ id: `c-${hex()}`, order: last + 1, ...input, task: `i-${hex()}` });
        fake.cards.push(card);
        // The card's task, numbered after the workspace's last.
        const number = Math.max(0, ...fake.tasks.map((ref) => ref.number)) + 1;
        fake.tasks.push({ cardId: card.id, id: card.task as string, number });
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
      plan: async (_orgId, client) => {
        guard();
        const lists = fake.lists.filter((l) => l.client === client);
        const shelf = new Set(lists.filter((l) => l.kind === "materials").map((l) => l.id));
        const cards = fake.cards
          .filter((c) => c.client === client)
          .sort(byOrder)
          .map((c) => ({ ...stageOf(c), material: !!c.list && shelf.has(c.list) }));
        const known = new Set(lists.map((l) => l.id));
        const carded = new Set(cards.map((c) => c.item).filter(Boolean));
        return clone({
          client,
          state: fake.state,
          lists: lists.map(({ id, name, kind }) => ({
            id,
            name,
            kind: kind ?? "plan",
            cards: cards.filter((c) => c.list === id),
          })),
          unlisted: cards.filter((c) => !c.list || !known.has(c.list)),
          loose: fake.items.filter((i) => i.client === client && !carded.has(i.id)),
          labels: fake.labels,
        });
      },
      mine: async () => {
        guard();
        const user = me();
        const open = fake.cards
          .filter((c) => user !== null && c.members.includes(user))
          .map(stageOf)
          .filter((c) => c.stage === "todo" || c.stage === "doing" || c.stage === "adjusting");
        const byDay = (a: PlanCard, b: PlanCard) =>
          (a.produceOn ?? "").localeCompare(b.produceOn ?? "") || byOrder(a, b);
        return clone({
          day: fake.day,
          late: open.filter((c) => c.produceOn !== null && c.produceOn < fake.day).sort(byDay),
          today: open.filter((c) => c.produceOn === fake.day).sort(byOrder),
          next: open.filter((c) => c.produceOn !== null && c.produceOn > fake.day).sort(byDay),
          undated: open.filter((c) => c.produceOn === null).sort(byOrder),
        });
      },
      toSchedule: async () => {
        guard();
        return clone({
          items: fake.items
            .filter((i) => i.status === "approved" && !i.released)
            .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "") || a.id.localeCompare(b.id)),
        });
      },
      pipeline: async () => {
        guard();
        const carded = new Set<string>();
        const fromCards = fake.cards.map(stageOf).flatMap((card) => {
          const item = card.item ? fake.items.find((i) => i.client === card.client && i.id === card.item) : undefined;
          if (item) carded.add(`${item.client}/${item.id}`);
          if (card.stage === "posted") return [];
          const open = card.stage === "todo" || card.stage === "doing" || card.stage === "adjusting";
          return [
            {
              client: card.client,
              kind: "card" as const,
              id: card.id,
              title: card.title,
              type: card.type,
              stage: card.stage,
              members: card.members,
              produceOn: card.produceOn,
              postOn: card.postOn,
              late: Boolean(card.produceOn && card.produceOn < fake.day && open),
              note: card.stage === "adjusting" ? (item?.lastNote?.text ?? null) : null,
              link: card.link,
              updatedAt: card.updatedAt,
            },
          ];
        });
        const fromItems = fake.items
          .filter((i) => COLUMN_OF[i.status] !== "posted" && !carded.has(`${i.client}/${i.id}`))
          .map((i) => ({
            client: i.client,
            kind: "post" as const,
            id: i.id,
            title: i.title,
            type: i.type,
            stage: COLUMN_OF[i.status],
            members: [],
            produceOn: null,
            postOn: i.scheduledFor,
            late: false,
            note: COLUMN_OF[i.status] === "adjusting" ? (i.lastNote?.text ?? null) : null,
            link: i.link,
            updatedAt: 0,
          }));
        return clone({ day: fake.day, state: fake.state, entries: [...fromCards, ...fromItems] });
      },
      tasks: async () => {
        guard();
        const cards = new Set(fake.cards.map((c) => c.id));
        return clone(fake.tasks.filter((ref) => cards.has(ref.cardId)));
      },
      createList: async (orgId, client, name, kind) => {
        log("portal.createList", orgId, client, name, ...(kind && kind !== "plan" ? [kind] : []));
        guard();
        const same = fake.lists.find((l) => l.client === client && l.name.toLowerCase() === name.trim().toLowerCase());
        if (same) return { id: same.id, name: same.name, kind: same.kind ?? "plan" };
        const list = { id: `l-${hex()}`, name: name.trim(), client, kind: kind ?? "plan" };
        fake.lists.push(list);
        return { id: list.id, name: list.name, kind: list.kind };
      },
      orderLists: async (orgId, client, ids) => {
        log("portal.orderLists", orgId, client, ids);
        guard();
        const mine = fake.lists.filter((l) => l.client === client);
        const ordered = [
          ...ids.flatMap((id) => mine.find((l) => l.id === id) ?? []),
          ...mine.filter((l) => !ids.includes(l.id)),
        ];
        fake.lists = [...fake.lists.filter((l) => l.client !== client), ...ordered];
        return ordered.map(({ id, name, kind }) => ({ id, name, kind: kind ?? "plan" }));
      },
      renameList: async (orgId, listId, name) => {
        log("portal.renameList", orgId, listId, name);
        guard();
        const list = fake.lists.find((l) => l.id === listId);
        if (!list) throw new ApiError(400, "portal.refused", "No such list");
        list.name = name.trim();
        return { id: list.id, name: list.name, kind: list.kind ?? "plan" };
      },
      setListKind: async (orgId, listId, kind) => {
        log("portal.setListKind", orgId, listId, kind);
        guard();
        const list = fake.lists.find((l) => l.id === listId);
        if (!list) throw new ApiError(400, "portal.refused", "No such list");
        list.kind = kind;
        return { id: list.id, name: list.name, kind };
      },
      deleteList: async (orgId, listId) => {
        log("portal.deleteList", orgId, listId);
        guard();
        fake.lists = fake.lists.filter((l) => l.id !== listId);
        for (const card of fake.cards) if (card.list === listId) card.list = null;
      },
      labels: async () => {
        guard();
        return clone(fake.labels);
      },
      createLabel: async (orgId, input) => {
        log("portal.createLabel", orgId, input);
        guard();
        const label = { id: `e-${hex()}`, name: input.name.trim(), color: input.color };
        fake.labels.push(label);
        return clone(label);
      },
      updateLabel: async (orgId, labelId, change) => {
        log("portal.updateLabel", orgId, labelId, change);
        guard();
        const label = fake.labels.find((l) => l.id === labelId);
        if (!label) throw new ApiError(400, "portal.refused", "No such label");
        Object.assign(label, change);
        return clone(label);
      },
      deleteLabel: async (orgId, labelId) => {
        log("portal.deleteLabel", orgId, labelId);
        guard();
        fake.labels = fake.labels.filter((l) => l.id !== labelId);
        for (const card of fake.cards) card.labels = card.labels.filter((id) => id !== labelId);
      },
      setClientColor: async (orgId, client, color) => {
        log("portal.setClientColor", orgId, client, color);
        guard();
        if (color) fake.colors[client] = color;
        else delete fake.colors[client];
      },
      setClientLogo: async (orgId, client, image) => {
        log("portal.setClientLogo", orgId, client, image?.contentType ?? null);
        guard();
        if (image) fake.logos[client] = `/api/app/portal-logos/${orgId}/${client}/0123456789abcdef.png`;
        else delete fake.logos[client];
      },
      addComment: async (orgId, cardId, text) => {
        log("portal.addComment", orgId, cardId, text);
        guard();
        const card = cardOf(cardId);
        card.comments.push({ id: `m-${hex()}`, by: me() ?? "", text: text.trim(), at: Date.now() });
        return clone(card);
      },
      deleteComment: async (orgId, cardId, commentId) => {
        log("portal.deleteComment", orgId, cardId, commentId);
        guard();
        const card = cardOf(cardId);
        card.comments = card.comments.filter((m) => m.id !== commentId);
        return clone(card);
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
      approveForClient: async (orgId, client, itemId, note) => {
        log("portal.approveForClient", orgId, client, itemId, note);
        guard();
        const item = fake.items.find((i) => i.client === client && i.id === itemId);
        if (!item || !["sent", "seen", "adjusted"].includes(item.status)) {
          throw new ApiError(400, "portal.refused", "Only a post waiting on the client's approval can be approved");
        }
        item.status = "approved";
      },
      clients: async (orgId) => {
        log("portal.clients", orgId);
        guard();
        const accounts = Object.values(fake.accounts);
        // The links only for who may manage: the fake gives them to everyone, as a server without a test person in mind
        // would; a test of that rule reads the client routes themselves.
        return clone({
          clients: accounts.map(({ link: _link, ...rest }) => rest),
          links: Object.fromEntries(accounts.filter((a) => a.link).map((a) => [a.client, a.link as string])),
        });
      },
      saveClient: async (orgId, client, input) => {
        log("portal.saveClient", orgId, client, input);
        guard();
        const before = fake.accounts[client];
        const account: PortalClientAccount = {
          id: before?.id ?? `acc-${hex()}`,
          client,
          name: input.name,
          contacts: (input.contacts ?? []).map((c) => ({
            id: c.id ?? `ct-${hex()}`,
            name: c.name,
            email: c.email ?? null,
            whatsapp: c.whatsapp ?? null,
          })),
          color: input.color ?? null,
          link: before?.link ?? `https://test.example/p/${hex().padEnd(24, "0")}`,
          revoked: false,
          linkStale: false,
          createdAt: before?.createdAt ?? new Date().toISOString(),
        };
        fake.accounts[client] = account;
        return clone(account);
      },
      removeClient: async (orgId, client) => {
        log("portal.removeClient", orgId, client);
        guard();
        delete fake.accounts[client];
      },
      newClientLink: async (orgId, client) => {
        log("portal.newClientLink", orgId, client);
        guard();
        const account = fake.accounts[client];
        const link = `https://test.example/p/${hex().padEnd(24, "0")}`;
        if (account) {
          account.link = link;
          account.revoked = false;
          account.linkStale = false;
        }
        return link;
      },
      revokeClientLink: async (orgId, client) => {
        log("portal.revokeClientLink", orgId, client);
        guard();
        const account = fake.accounts[client];
        if (account) {
          account.link = null;
          account.revoked = true;
          account.linkStale = false;
        }
      },
      noticeSettings: async (orgId) => {
        log("portal.noticeSettings", orgId);
        guard();
        return clone({ number: fake.noticeNumber, numbers: fake.noticeNumbers });
      },
      setNoticeNumber: async (orgId, number) => {
        log("portal.setNoticeNumber", orgId, number);
        guard();
        fake.noticeNumber = number;
      },
      markPublished: async (orgId, client, item, input = {}) => {
        log("portal.markPublished", orgId, client, item, input);
        guard();
        const found = fake.items.find((i) => i.client === client && i.id === item);
        if (!found) throw new ApiError(404, "not_found", "item not found");
        if (found.status !== "scheduled") throw new ApiError(409, "conflict", "only a scheduled post is marked posted");
        found.status = "published";
        found.publishedAt = input.at ?? new Date().toISOString();
        if (input.postUrl) found.postUrl = input.postUrl;
      },
    },
  };
  return fake;
}
