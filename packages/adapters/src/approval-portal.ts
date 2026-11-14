/**
 * Approval portal (ADR 9001): a place outside this server where a team's clients approve what the team made for
 * them (posts, reels, carousels). Optional, behind this interface: the server reaches it through a bridge, a small
 * HTTP service the installation runs next to the portal (`APPROVAL_PORTAL_URL`, `APPROVAL_PORTAL_TOKEN`), so no
 * model and no agent is in the way of a send, and the bridge's token never leaves the server.
 */

/** Where a post is at the portal. */
export const PORTAL_STATUSES = [
  "sent",
  "seen",
  "approved",
  "adjust_requested",
  "adjusting",
  "adjusted",
  "scheduled",
  "published",
] as const;
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

export const PORTAL_TYPES = ["reel", "carousel", "image", "story"] as const;
export type PortalType = (typeof PORTAL_TYPES)[number];

/** A card the team still works on: the portal only knows a post once it is sent. */
export const PORTAL_CARD_STATES = ["todo", "doing"] as const;
export type PortalCardState = (typeof PORTAL_CARD_STATES)[number];

/** What a sent post still lacks. Never shown to the client. */
export type PortalMissing = "cover" | "caption" | "editor" | "date";

export interface PortalItem {
  client: string;
  id: string;
  title: string;
  type: PortalType;
  status: PortalStatus;
  /** ISO with an offset, or null: no date yet. */
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  editor: string | null;
  caption: string;
  files: number;
  video: boolean;
  version: number;
  missing: PortalMissing[];
  /**
   * An approved post already released for scheduling: on its way to the publishing service, `scheduled` within
   * minutes. It can't be released again.
   */
  released: boolean;
  /** The last thing said on it (the client's adjustment request, an approval's note). Outside text. */
  lastNote: { at: string | null; by: string | null; text: string } | null;
  /** Where it was published, once it was. */
  postUrl: string | null;
  /** The post at the portal, for a signed-in person. */
  link: string;
}

/** The colours a label takes: names, drawn by the apps in their own palette. */
export const PORTAL_LABEL_COLORS = [
  "green",
  "mint",
  "olive",
  "yellow",
  "wine",
  "red",
  "purple",
  "lilac",
  "blue",
  "gray",
] as const;
export type PortalLabelColor = (typeof PORTAL_LABEL_COLORS)[number];

/** A list of the strategic schedule: usually a week, named by the team. */
export interface PortalList {
  id: string;
  name: string;
}

/** A label of the team's own, the same for every client. */
export interface PortalLabel {
  id: string;
  name: string;
  color: PortalLabelColor;
}

export interface PortalComment {
  id: string;
  /** Who wrote it: a member's id, or an agent's as `agent:<id>`. */
  by: string;
  text: string;
  at: number;
}

export interface PortalCheck {
  id: string;
  text: string;
  done: boolean;
}

export interface PortalCard {
  id: string;
  client: string;
  title: string;
  type: PortalType;
  state: PortalCardState;
  caption: string;
  date: string | null;
  editor: string | null;
  owner: string | null;
  note: string;
  /** Files of this workspace's Drive that go up with it. */
  files: { id: string; name: string }[];
  /**
   * The day whoever is on it makes it (`YYYY-MM-DD`). Not `date`, the day the post goes out: a video is edited
   * days before it is posted.
   */
  produceOn: string | null;
  /** The schedule's list it is in; null: in none. */
  list: string | null;
  /** Its place in the list: lower first. */
  order: number;
  description: string;
  /** Label ids. */
  labels: string[];
  /** Workspace members on it (user ids). */
  members: string[];
  checklist: PortalCheck[];
  comments: PortalComment[];
  /** The portal's post this card became, once sent: from then on its stage is the post's. */
  item: string | null;
  /** The workspace task that stands for it (its id), once it has one: where it is assigned and worked on. */
  task: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PortalCardInput {
  title?: string;
  type?: PortalType;
  state?: PortalCardState;
  caption?: string;
  date?: string | null;
  editor?: string | null;
  owner?: string | null;
  note?: string;
  files?: { id: string; name: string }[];
  produceOn?: string | null;
  list?: string | null;
  order?: number;
  description?: string;
  labels?: string[];
  members?: string[];
  checklist?: PortalCheck[];
  /** Ties the card to a post already at the portal. */
  item?: string | null;
  /** Ties the card to the workspace task that stands for it. */
  task?: string | null;
}

export interface PortalJob {
  id: string;
  state: "sending" | "done" | "failed";
  client: string;
  item: string | null;
  title: string | null;
  missing: PortalMissing[];
  link: string | null;
  error: string | null;
}

export interface PortalSend {
  client: string;
  type: PortalType;
  /** Ids `upload` answered, in the carousel's order. */
  files: string[];
  cover?: string;
  title?: string;
  caption?: string;
  /** `YYYY-MM-DDTHH:MM`, the portal's own time zone when it has no offset. */
  date?: string;
  editor?: string;
  /** The card this send finishes: it leaves the cards once the send is done. */
  card?: string;
  /** The same key never sends twice. */
  key?: string;
  /** Who asked, for the bridge's log. */
  by?: string;
}

export interface PortalItemEdit {
  title?: string;
  caption?: string;
  scheduledFor?: string | null;
  status?: PortalStatus;
  editor?: string;
}

/**
 * How fresh the portal's side is. While the portal doesn't answer, the bridge serves its last good read (`stale`,
 * read at `readAt`) and keeps what couldn't reach the portal in a queue it retries (`queued`).
 */
export interface PortalState {
  stale: boolean;
  /** When the posts shown were read from the portal (ISO), if known. */
  readAt: string | null;
  /** Edits and schedules still on their way to the portal. */
  queued: number;
}

export interface ApprovalPortal {
  state(): Promise<PortalState>;
  items(): Promise<PortalItem[]>;
  cards(client?: string): Promise<PortalCard[]>;
  createCard(client: string, input: PortalCardInput & { title: string }, by?: string): Promise<PortalCard>;
  updateCard(id: string, input: PortalCardInput, by?: string): Promise<PortalCard>;
  deleteCard(id: string, by?: string): Promise<void>;
  comment(card: string, text: string, by: string): Promise<PortalCard>;
  deleteComment(card: string, comment: string): Promise<PortalCard>;
  /** A client's lists, in the team's order. */
  lists(client: string): Promise<PortalList[]>;
  /** A list by name: the one that already has it (whatever its capitals), else a new one at the end. */
  createList(client: string, name: string): Promise<PortalList>;
  renameList(id: string, name: string): Promise<PortalList>;
  /** Every list of the client, once each, in the new order. */
  orderLists(client: string, ids: string[]): Promise<PortalList[]>;
  /** Its cards stay, in no list. */
  deleteList(id: string): Promise<void>;
  labels(): Promise<PortalLabel[]>;
  createLabel(name: string, color: PortalLabelColor): Promise<PortalLabel>;
  updateLabel(id: string, change: { name?: string; color?: PortalLabelColor }): Promise<PortalLabel>;
  deleteLabel(id: string): Promise<void>;
  /** One file's bytes; answers the id `send` takes. */
  upload(name: string, bytes: Uint8Array): Promise<string>;
  send(input: PortalSend): Promise<PortalJob>;
  job(id: string): Promise<PortalJob | null>;
  editItem(client: string, item: string, edit: PortalItemEdit, by?: string): Promise<void>;
  /**
   * Releases an approved post for publication at `when` (ISO with an offset): from there the portal's own scheduler
   * takes it to the publishing service, and the post turns `scheduled` once that service has it.
   */
  scheduleItem(client: string, item: string, when: string, by?: string): Promise<void>;
}

/** The portal answered no, in its own words (safe to show a member: never a secret). */
export class ApprovalPortalError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalPortalError";
  }
}

/** One file may be this large: it is held in memory on its way to the bridge. */
export const PORTAL_FILE_BYTES = 512 * 1024 * 1024;

const STATUS_IN: Record<string, PortalStatus> = {
  enviado: "sent",
  visto: "seen",
  aprovado: "approved",
  ajuste_pedido: "adjust_requested",
  em_ajuste: "adjusting",
  ajuste_feito: "adjusted",
  agendado: "scheduled",
  publicado: "published",
};
const STATUS_OUT = Object.fromEntries(Object.entries(STATUS_IN).map(([wire, ours]) => [ours, wire])) as Record<
  PortalStatus,
  string
>;
const TYPE_IN: Record<string, PortalType> = {
  reel: "reel",
  carrossel: "carousel",
  post: "image",
  imagem: "image",
  story: "story",
};
const TYPE_OUT: Record<PortalType, string> = { reel: "reel", carousel: "carrossel", image: "imagem", story: "story" };
const MISSING_IN: Record<string, PortalMissing> = { capa: "cover", legenda: "caption", editor: "editor", data: "date" };
const CARD_STATE_IN: Record<string, PortalCardState> = { a_produzir: "todo", em_producao: "doing" };
const CARD_STATE_OUT: Record<PortalCardState, string> = { todo: "a_produzir", doing: "em_producao" };
const JOB_STATE_IN: Record<string, PortalJob["state"]> = { subindo: "sending", pronto: "done", falhou: "failed" };

type Wire = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : null);
const missingOf = (value: unknown) =>
  (Array.isArray(value) ? value : []).map((m) => MISSING_IN[String(m)]).filter((m): m is PortalMissing => !!m);

function itemOf(wire: Wire): PortalItem {
  const note = wire.ultima_nota as Wire | null | undefined;
  const by = note?.por;
  return {
    client: String(wire.tenant),
    id: String(wire.id),
    title: text(wire.titulo) ?? "",
    type: TYPE_IN[String(wire.tipo)] ?? "image",
    status: STATUS_IN[String(wire.status)] ?? "sent",
    scheduledFor: text(wire.agendado_para),
    publishedAt: text(wire.publicado_em),
    createdAt: text(wire.criado_em),
    updatedAt: text(wire.atualizado_em),
    editor: text(wire.editor),
    caption: text(wire.legenda) ?? "",
    files: Number(wire.midias) || 0,
    video: wire.video === true,
    version: Number(wire.versao) || 1,
    missing: missingOf(wire.pendencias),
    released: wire.liberado === true,
    lastNote: note
      ? {
          at: text(note.ts),
          by: typeof by === "string" ? by : (text((by as Wire | undefined)?.nome) ?? null),
          text: text(note.nota) ?? "",
        }
      : null,
    postUrl: text(wire.ig_url),
    link: text(wire.link) ?? "",
  };
}

const COLOR_IN: Record<string, PortalLabelColor> = {
  verde: "green",
  menta: "mint",
  oliva: "olive",
  amarelo: "yellow",
  vinho: "wine",
  vermelho: "red",
  roxo: "purple",
  lilas: "lilac",
  azul: "blue",
  cinza: "gray",
};
const COLOR_OUT = Object.fromEntries(Object.entries(COLOR_IN).map(([wire, ours]) => [ours, wire])) as Record<
  PortalLabelColor,
  string
>;
const rows = (value: unknown) => (Array.isArray(value) ? (value as Wire[]) : []);
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
const listOf = (wire: Wire): PortalList => ({ id: String(wire.id), name: text(wire.nome) ?? "" });
const labelOf = (wire: Wire): PortalLabel => ({
  id: String(wire.id),
  name: text(wire.nome) ?? "",
  color: COLOR_IN[String(wire.cor)] ?? "gray",
});

function cardOf(wire: Wire): PortalCard {
  const files = Array.isArray(wire.arquivos) ? (wire.arquivos as Wire[]) : [];
  return {
    id: String(wire.id),
    client: String(wire.tenant),
    title: text(wire.titulo) ?? "",
    type: TYPE_IN[String(wire.tipo)] ?? "image",
    state: CARD_STATE_IN[String(wire.estado)] ?? "todo",
    caption: text(wire.legenda) ?? "",
    date: text(wire.data),
    editor: text(wire.editor),
    owner: text(wire.responsavel),
    note: text(wire.nota) ?? "",
    files: files.map((f) => ({ id: String(f.id ?? ""), name: String(f.nome ?? "") })),
    produceOn: text(wire.producao),
    list: text(wire.lista),
    order: Number(wire.ordem) || 0,
    description: text(wire.descricao) ?? "",
    labels: strings(wire.etiquetas),
    members: strings(wire.membros),
    checklist: rows(wire.checklist).map((c) => ({
      id: String(c.id ?? ""),
      text: text(c.texto) ?? "",
      done: c.feito === true,
    })),
    comments: rows(wire.comentarios).map((m) => ({
      id: String(m.id ?? ""),
      by: text(m.por) ?? "",
      text: text(m.texto) ?? "",
      at: Math.round(Number(m.ts) * 1000) || 0,
    })),
    item: text(wire.item),
    task: text(wire.tarefa),
    createdAt: Math.round(Number(wire.criado) * 1000) || 0,
    updatedAt: Math.round(Number(wire.atualizado) * 1000) || 0,
  };
}

function cardWire(input: PortalCardInput): Wire {
  const wire: Wire = {};
  if (input.title !== undefined) wire.titulo = input.title;
  if (input.type !== undefined) wire.tipo = TYPE_OUT[input.type];
  if (input.state !== undefined) wire.estado = CARD_STATE_OUT[input.state];
  if (input.caption !== undefined) wire.legenda = input.caption;
  if (input.date !== undefined) wire.data = input.date;
  if (input.editor !== undefined) wire.editor = input.editor;
  if (input.owner !== undefined) wire.responsavel = input.owner;
  if (input.note !== undefined) wire.nota = input.note;
  if (input.files !== undefined) wire.arquivos = input.files.map((f) => ({ id: f.id, nome: f.name }));
  if (input.produceOn !== undefined) wire.producao = input.produceOn;
  if (input.list !== undefined) wire.lista = input.list;
  if (input.order !== undefined) wire.ordem = input.order;
  if (input.description !== undefined) wire.descricao = input.description;
  if (input.labels !== undefined) wire.etiquetas = input.labels;
  if (input.members !== undefined) wire.membros = input.members;
  if (input.checklist !== undefined) {
    wire.checklist = input.checklist.map((c) => ({ id: c.id, texto: c.text, feito: c.done }));
  }
  if (input.item !== undefined) wire.item = input.item;
  if (input.task !== undefined) wire.tarefa = input.task;
  return wire;
}

function jobOf(wire: Wire): PortalJob {
  return {
    id: String(wire.id),
    state: JOB_STATE_IN[String(wire.estado)] ?? "failed",
    client: String(wire.tenant ?? ""),
    item: text(wire.item),
    title: text(wire.titulo),
    missing: missingOf(wire.pendencias),
    link: text(wire.link),
    error: text(wire.erro),
  };
}

export interface BridgePortalOptions {
  /** The bridge's address, with no path. */
  url: string;
  token: string;
  fetch?: typeof fetch;
}

/** The portal behind the installation's bridge. Reads answer within 30 s; a file's upload within 10 minutes. */
export function createBridgeApprovalPortal(options: BridgePortalOptions): ApprovalPortal {
  const base = `${options.url.replace(/\/+$/, "")}/v1`;
  const call = options.fetch ?? fetch;
  const request = async (path: string, init: { json?: unknown; bytes?: Uint8Array; timeoutMs?: number } = {}) => {
    const post = init.json !== undefined || init.bytes !== undefined;
    let response: Response;
    try {
      response = await call(`${base}${path}`, {
        method: post ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "application/json",
          ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(init.bytes ? { "Content-Type": "application/octet-stream" } : {}),
        },
        body: init.bytes ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
        signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
      });
    } catch {
      throw new ApprovalPortalError(502, "The approval portal didn't answer");
    }
    const answer = (await response.json().catch(() => null)) as Wire | null;
    if (!response.ok) {
      throw new ApprovalPortalError(
        response.status,
        text(answer?.erro) ?? `The approval portal answered ${response.status}`,
      );
    }
    return answer ?? {};
  };
  const list = (value: unknown) => (Array.isArray(value) ? (value as Wire[]) : []);
  // The freshness of the last read of the posts: the bridge says it on every answer.
  let read: { stale: boolean; readAt: string | null } = { stale: false, readAt: null };
  return {
    state: async () => {
      const answer = await request("/estado");
      return { ...read, queued: list(answer.fila).length };
    },
    items: async () => {
      const answer = await request("/itens");
      read = { stale: answer.desatualizado === true, readAt: text(answer.lido_em) };
      return list(answer.itens).map(itemOf);
    },
    cards: async (client) =>
      list((await request(`/cartoes${client ? `?tenant=${encodeURIComponent(client)}` : ""}`)).cartoes).map(cardOf),
    createCard: async (client, input, by) =>
      cardOf((await request("/cartoes", { json: { ...cardWire(input), tenant: client, por: by } })).cartao as Wire),
    updateCard: async (id, input, by) =>
      cardOf(
        (await request(`/cartoes/${encodeURIComponent(id)}`, { json: { ...cardWire(input), por: by } })).cartao as Wire,
      ),
    deleteCard: async (id, by) => {
      await request(`/cartoes/${encodeURIComponent(id)}/apagar`, { json: { por: by } });
    },
    comment: async (card, body, by) =>
      cardOf(
        (await request(`/cartoes/${encodeURIComponent(card)}/comentarios`, { json: { texto: body, por: by } }))
          .cartao as Wire,
      ),
    deleteComment: async (card, comment) =>
      cardOf(
        (
          await request(`/cartoes/${encodeURIComponent(card)}/comentarios/${encodeURIComponent(comment)}/apagar`, {
            json: {},
          })
        ).cartao as Wire,
      ),
    lists: async (client) => rows((await request(`/listas?tenant=${encodeURIComponent(client)}`)).listas).map(listOf),
    createList: async (client, name) =>
      listOf((await request("/listas", { json: { tenant: client, nome: name } })).lista as Wire),
    renameList: async (id, name) =>
      listOf((await request(`/listas/${encodeURIComponent(id)}`, { json: { nome: name } })).lista as Wire),
    orderLists: async (client, ids) =>
      rows((await request("/listas/ordem", { json: { tenant: client, ids } })).listas).map(listOf),
    deleteList: async (id) => {
      await request(`/listas/${encodeURIComponent(id)}/apagar`, { json: {} });
    },
    labels: async () => rows((await request("/etiquetas")).etiquetas).map(labelOf),
    createLabel: async (name, color) =>
      labelOf((await request("/etiquetas", { json: { nome: name, cor: COLOR_OUT[color] } })).etiqueta as Wire),
    updateLabel: async (id, change) =>
      labelOf(
        (
          await request(`/etiquetas/${encodeURIComponent(id)}`, {
            json: {
              ...(change.name !== undefined ? { nome: change.name } : {}),
              ...(change.color !== undefined ? { cor: COLOR_OUT[change.color] } : {}),
            },
          })
        ).etiqueta as Wire,
      ),
    deleteLabel: async (id) => {
      await request(`/etiquetas/${encodeURIComponent(id)}/apagar`, { json: {} });
    },
    upload: async (name, bytes) => {
      if (bytes.byteLength > PORTAL_FILE_BYTES) throw new ApprovalPortalError(413, "That file is too large to send");
      const answer = await request(`/arquivos?nome=${encodeURIComponent(name)}`, { bytes, timeoutMs: 600_000 });
      return String(answer.arquivo);
    },
    send: async (input) =>
      jobOf(
        (
          await request("/subir", {
            json: {
              tenant: input.client,
              tipo: TYPE_OUT[input.type],
              arquivos: input.files,
              capa: input.cover,
              titulo: input.title,
              legenda: input.caption,
              data: input.date,
              editor: input.editor,
              cartao: input.card,
              chave: input.key,
              por: input.by,
            },
          })
        ).trabalho as Wire,
      ),
    job: async (id) => {
      try {
        return jobOf((await request(`/trabalhos/${encodeURIComponent(id)}`)).trabalho as Wire);
      } catch (error) {
        if (error instanceof ApprovalPortalError && error.status === 404) return null;
        throw error;
      }
    },
    editItem: async (client, item, edit, by) => {
      const json: Wire = { por: by };
      if (edit.title !== undefined) json.titulo = edit.title;
      if (edit.caption !== undefined) json.legenda = edit.caption;
      if (edit.scheduledFor !== undefined) json.agendado_para = edit.scheduledFor;
      if (edit.status !== undefined) json.status = STATUS_OUT[edit.status];
      if (edit.editor !== undefined) json.editor = edit.editor;
      await request(`/itens/${encodeURIComponent(client)}/${encodeURIComponent(item)}/editar`, { json });
    },
    scheduleItem: async (client, item, when, by) => {
      await request(`/itens/${encodeURIComponent(client)}/${encodeURIComponent(item)}/agendar`, {
        json: { agendado_para: when, por: by },
        timeoutMs: 60_000,
      });
    },
  };
}

/**
 * A portal kept in memory, for tests: no bridge, no network. A send ends at once (`done`), and `fail` makes the next
 * call answer like a portal that said no.
 */
export function createFakeApprovalPortal(seed: { items?: PortalItem[]; cards?: PortalCard[] } = {}) {
  const items = [...(seed.items ?? [])];
  const cards = new Map((seed.cards ?? []).map((card) => [card.id, card]));
  const jobs = new Map<string, PortalJob>();
  const lists = new Map<string, PortalList[]>();
  const labels: PortalLabel[] = [];
  const uploads = new Map<string, { name: string; bytes: Uint8Array }>();
  const sends: (PortalSend & { names: string[] })[] = [];
  const edits: { client: string; item: string; edit: PortalItemEdit; by?: string }[] = [];
  const scheduled: { client: string; item: string; when: string; by?: string }[] = [];
  let failure: ApprovalPortalError | null = null;
  let count = 0;
  const next = (prefix: string) => `${prefix}${(++count).toString(16).padStart(12, "0")}`;
  const check = () => {
    const error = failure;
    failure = null;
    if (error) throw error;
  };
  const cardOrRefuse = (id: string) => {
    const card = cards.get(id);
    if (!card) throw new ApprovalPortalError(404, "card not found");
    return card;
  };
  let state: PortalState = { stale: false, readAt: null, queued: 0 };
  const portal: ApprovalPortal = {
    state: async () => state,
    items: async () => {
      check();
      return [...items];
    },
    cards: async (client) => {
      check();
      return [...cards.values()].filter((card) => !client || card.client === client);
    },
    createCard: async (client, input) => {
      check();
      const card: PortalCard = {
        id: next("c-"),
        client,
        type: "image",
        state: "todo",
        caption: "",
        date: null,
        editor: null,
        owner: null,
        note: "",
        files: [],
        produceOn: null,
        list: null,
        order: count + 1,
        description: "",
        labels: [],
        members: [],
        checklist: [],
        comments: [],
        item: null,
        task: null,
        ...input,
        createdAt: count,
        updatedAt: count,
      };
      cards.set(card.id, card);
      return card;
    },
    updateCard: async (id, input) => {
      check();
      const card = { ...cardOrRefuse(id), ...input, updatedAt: ++count };
      cards.set(id, card);
      return card;
    },
    deleteCard: async (id) => {
      check();
      cards.delete(id);
    },
    comment: async (id, body, by) => {
      check();
      const card = cardOrRefuse(id);
      const next_ = { ...card, comments: [...card.comments, { id: next("m-"), by, text: body, at: count }] };
      cards.set(id, next_);
      return next_;
    },
    deleteComment: async (id, comment) => {
      check();
      const card = cardOrRefuse(id);
      const next_ = { ...card, comments: card.comments.filter((m) => m.id !== comment) };
      cards.set(id, next_);
      return next_;
    },
    lists: async (client) => {
      check();
      return [...(lists.get(client) ?? [])];
    },
    createList: async (client, name) => {
      check();
      const of = lists.get(client) ?? [];
      const same = of.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (same) return same;
      const list = { id: next("l-"), name };
      lists.set(client, [...of, list]);
      return list;
    },
    renameList: async (id, name) => {
      check();
      for (const of of lists.values()) {
        const list = of.find((l) => l.id === id);
        if (list) {
          list.name = name;
          return list;
        }
      }
      throw new ApprovalPortalError(404, "list not found");
    },
    orderLists: async (client, ids) => {
      check();
      const of = lists.get(client) ?? [];
      if (ids.length !== of.length || of.some((l) => !ids.includes(l.id))) {
        throw new ApprovalPortalError(409, "the order must carry every list once");
      }
      const ordered = ids.map((id) => of.find((l) => l.id === id) as PortalList);
      lists.set(client, ordered);
      return ordered;
    },
    deleteList: async (id) => {
      check();
      for (const [client, of] of lists)
        lists.set(
          client,
          of.filter((l) => l.id !== id),
        );
      for (const [key, card] of cards) if (card.list === id) cards.set(key, { ...card, list: null });
    },
    labels: async () => {
      check();
      return [...labels];
    },
    createLabel: async (name, color) => {
      check();
      const label = { id: next("e-"), name, color };
      labels.push(label);
      return label;
    },
    updateLabel: async (id, change) => {
      check();
      const label = labels.find((l) => l.id === id);
      if (!label) throw new ApprovalPortalError(404, "label not found");
      Object.assign(label, change);
      return label;
    },
    deleteLabel: async (id) => {
      check();
      const at = labels.findIndex((l) => l.id === id);
      if (at >= 0) labels.splice(at, 1);
      for (const [key, card] of cards) {
        if (card.labels.includes(id)) cards.set(key, { ...card, labels: card.labels.filter((l) => l !== id) });
      }
    },
    upload: async (name, bytes) => {
      check();
      const id = next("f");
      uploads.set(id, { name, bytes });
      return id;
    },
    send: async (input) => {
      check();
      const again = input.key ? [...jobs.values()].find((job) => keys.get(job.id) === input.key) : undefined;
      if (again) return again;
      const names = input.files.map((id) => uploads.get(id)?.name ?? "?");
      sends.push({ ...input, names });
      const id = next("");
      const item: PortalItem = {
        client: input.client,
        id: `up-${id}`,
        title: input.title ?? names[0] ?? "",
        type: input.type,
        status: "sent",
        scheduledFor: input.date ?? null,
        publishedAt: null,
        createdAt: null,
        updatedAt: null,
        editor: input.editor ?? null,
        caption: input.caption ?? "",
        files: input.files.length,
        video: input.type === "reel",
        version: 1,
        missing: [...(input.caption ? [] : (["caption"] as const)), ...(input.date ? [] : (["date"] as const))],
        released: false,
        lastNote: null,
        postUrl: null,
        link: `https://portal.example.com/i/${input.client}/up-${id}`,
      };
      items.push(item);
      // The card stays in the schedule, tied to the post it became.
      const sent = input.card ? cards.get(input.card) : undefined;
      if (sent) cards.set(sent.id, { ...sent, item: item.id });
      const job: PortalJob = {
        id,
        state: "done",
        client: input.client,
        item: item.id,
        title: item.title,
        missing: item.missing,
        link: item.link,
        error: null,
      };
      jobs.set(id, job);
      if (input.key) keys.set(id, input.key);
      return job;
    },
    job: async (id) => {
      check();
      return jobs.get(id) ?? null;
    },
    editItem: async (client, item, edit, by) => {
      check();
      const found = items.find((i) => i.client === client && i.id === item);
      if (!found) throw new ApprovalPortalError(404, "item not found");
      edits.push({ client, item, edit, by });
      if (edit.title !== undefined) found.title = edit.title;
      if (edit.caption !== undefined) found.caption = edit.caption;
      if (edit.scheduledFor !== undefined) found.scheduledFor = edit.scheduledFor;
      if (edit.status !== undefined) found.status = edit.status;
      if (edit.editor !== undefined) found.editor = edit.editor;
    },
    scheduleItem: async (client, item, when, by) => {
      check();
      const found = items.find((i) => i.client === client && i.id === item);
      if (!found) throw new ApprovalPortalError(404, "item not found");
      if (found.status !== "approved") throw new ApprovalPortalError(409, "only an approved post is scheduled");
      if (found.released) throw new ApprovalPortalError(409, "this post was already released");
      scheduled.push({ client, item, when, by });
      // As at a real portal: released at once, `scheduled` only when the publishing service has it.
      found.scheduledFor = when;
      found.released = true;
    },
  };
  const keys = new Map<string, string>();
  return Object.assign(portal, {
    sends,
    edits,
    scheduled,
    /** What `state()` answers from now on. */
    setState: (next: Partial<PortalState>) => {
      state = { ...state, ...next };
    },
    uploads,
    /** The next call fails with this status and message. */
    fail: (status: number, message: string) => {
      failure = new ApprovalPortalError(status, message);
    },
  });
}
