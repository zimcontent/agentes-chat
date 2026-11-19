import type {
  ApiClient,
  OrgSummary,
  PlanCard,
  PortalBoard,
  PortalCard,
  PortalCardInput,
  PortalClientSummary,
  PortalItem,
  PortalPlan,
} from "@dougbot/client";
import { ApiProvider } from "@dougbot/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { DateSheet, LabelsSheet, MembersSheet } from "@/features/portal/CardEdit";
import { CardScreen } from "@/features/portal/CardScreen";
import { ClientEditSheet } from "@/features/portal/ClientEditSheet";
import { ClientScreen } from "@/features/portal/ClientScreen";
import { PortalScreen } from "@/features/portal/PortalScreen";
import { ScheduleSheet } from "@/features/portal/ScheduleSheet";
import { PickerHost } from "@/features/shared/PickerSheet";
import { SheetHostProvider, useSheet } from "@/features/shared/SheetHost";
import { FixedOrg } from "@/providers/org";
import { ToastHost } from "@/ui";

/*
 * The approval portal on the board (ADR 9001): a client's schedule as Trello's board and one card, the app's own
 * screens over a fake server with sample lists and cards, so they can be looked at in a browser. A cover picture is
 * served beside the board (`public/amostra`).
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
/** A workspace where the person changes the board: the add and move ways show. */
const SUMMARY = { id: ORG, name: "Zim", permissions: ["assign_work", "post"] } as unknown as OrgSummary;
const CLIENT = "lexeer";
const origin = () => (Platform.OS === "web" ? window.location.origin : "");
const day = (d: number) => new Date(Date.UTC(2026, 10, 17 + d, 15)).toISOString();

let order = 0;
const card = (list: string | null, title: string, over: Partial<PlanCard> = {}): PlanCard => ({
  id: `card-${++order}`,
  client: CLIENT,
  title,
  type: "image",
  state: "todo",
  caption: "",
  date: null,
  editor: null,
  owner: null,
  note: "",
  files: [],
  produceOn: null,
  list,
  order,
  description: "",
  labels: [],
  members: [],
  checklist: [],
  comments: [],
  item: null,
  task: null,
  done: false,
  material: false,
  createdAt: 0,
  updatedAt: 0,
  stage: "todo",
  postOn: null,
  link: null,
  ...over,
});

const PLAN: PortalPlan = {
  client: CLIENT,
  lists: [
    {
      id: "l1",
      name: "Material apoio",
      kind: "plan",
      cards: [
        card("l1", "Render e moodboard atualizado obras", {
          files: [{ id: "capa", name: "render.png" }],
          description: "Usar as fotos da obra da semana passada.",
          labels: ["lb1", "lb3"],
          members: ["u1", "u2"],
          produceOn: day(1).slice(0, 10),
          date: `${day(3).slice(0, 10)}T10:30`,
          postOn: `${day(3).slice(0, 10)}T10:30`,
          caption: "Obra entregue no prazo. Arrasta para ver o antes e depois.",
          checklist: [
            { id: "a", text: "Render", done: true },
            { id: "b", text: "Moodboard", done: false },
          ],
          comments: [{ id: "m1", by: "u1", text: "Pode usar o render novo", at: 1 }],
        }),
        card("l1", "Drive", { postOn: day(2), labels: ["lb2"] }),
        card("l1", "Carrossel obra entregue", {
          type: "carousel",
          stage: "doing",
          done: true,
          postOn: day(3),
          files: [
            { id: "c1", name: "obra-1.png" },
            { id: "c2", name: "obra-2.png" },
          ],
        }),
        card("l1", "3720 Mockingbird Ln. - built to endure", { stage: "approval", postOn: day(4) }),
        card("l1", "Vídeo para TV", { type: "reel", stage: "posted", done: true }),
      ],
    },
    {
      id: "l2",
      name: "Semana 17/11",
      kind: "plan",
      cards: [
        card("l2", "Carrossel lançamento", { type: "carousel", stage: "adjusting", postOn: day(1) }),
        card("l2", "Reel bastidores", { type: "reel", stage: "approved", postOn: day(3) }),
      ],
    },
    {
      id: "l3",
      name: "Semana 24/11",
      kind: "plan",
      cards: [
        card("l3", "Story enquete", { type: "story" }),
        // The worst description: long words, a link and several paragraphs, at 320 (`portal-cartao-longo`).
        card("l3", "Vídeo institucional com depoimentos dos moradores", {
          id: "card-longa",
          type: "reel",
          description:
            "Roteiro: abrir com a fachada ao entardecer, depois três depoimentos curtos (até 20 s cada) dos moradores do bloco B.\n\nReferência aprovada pelo cliente: https://www.exemplo.com.br/referencias/institucional-construtora-2026-versao-final\n\nEvitar trilha com vocal. Legendas em português e inglês, logotipo só no fim. Palavra comprida para testar a quebra: anticonstitucionalissimamente.",
        }),
      ],
    },
    { id: "m1", name: "Logins", kind: "materials", cards: [card("m1", "Instagram", { material: true })] },
  ],
  // Cards no list holds yet: "Sem lista", the schedule's last column (the case where a list added at the end used to
  // land behind it, out of sight).
  unlisted: [card(null, "Ideia: bastidores da obra", { type: "reel" }), card(null, "Post de Natal")],
  loose: [],
  labels: [
    { id: "lb1", name: "Lançamento", color: "green" },
    { id: "lb2", name: "Urgente", color: "red" },
    { id: "lb3", name: "", color: "blue" },
  ],
};

/** A post at the portal, as the board lists it. */
let posts = 0;
const post = (title: string, over: Partial<PortalItem> = {}): PortalItem => ({
  client: CLIENT,
  id: `post-${++posts}`,
  title,
  type: "image",
  status: "sent",
  scheduledFor: null,
  released: false,
  publishedAt: null,
  createdAt: null,
  updatedAt: null,
  editor: null,
  caption: "",
  files: 1,
  video: false,
  version: 1,
  missing: [],
  lastNote: null,
  postUrl: null,
  link: "",
  ...over,
});

/** The team's own card on the board (To do, In production). */
const team = (title: string, state: "todo" | "doing", over: Partial<PortalCard> = {}): PortalCard => {
  const { stage: _s, postOn: _p, link: _l, ...rest } = card(null, title, { state, stage: state, ...over });
  return rest;
};

const BOARD: PortalBoard = {
  client: CLIENT,
  cards: {
    todo: [
      team("Carrossel: 5 erros na reforma", "todo", { type: "carousel", date: day(4), files: [] }),
      team("Reel depoimento cliente Moema", "todo", { type: "reel", date: day(6) }),
      team("Story enquete acabamento", "todo", { type: "story" }),
    ],
    doing: [
      team("Vídeo bastidores da obra", "doing", {
        type: "reel",
        date: day(2),
        files: [{ id: "v1", name: "bastidores.mp4" }],
        description: "Cortar em 30 s.",
      }),
      team("Antes e depois cozinha", "doing", {
        date: day(3),
        done: true,
        files: [
          { id: "a1", name: "antes.png" },
          { id: "a2", name: "depois.png" },
        ],
      }),
    ],
  },
  items: {
    approval: [
      post("3720 Mockingbird Ln. - built to endure", { type: "carousel", scheduledFor: day(4), files: 6 }),
      post("Lançamento coleção verão", { status: "seen", scheduledFor: day(5), editor: "Ana" }),
    ],
    adjusting: [
      post("Reel tour apartamento decorado", {
        type: "reel",
        status: "adjust_requested",
        scheduledFor: day(1),
        lastNote: { at: null, by: "Marina (cliente)", text: "Trocar a música e tirar o logo do final." },
      }),
    ],
    approved: [
      post("Post dia do arquiteto", { status: "approved", scheduledFor: day(2), missing: ["caption"] }),
      post("Reel visita técnica com o engenheiro responsável pela obra", { type: "reel", status: "approved" }),
    ],
    scheduled: [post("Carrossel dicas de iluminação", { type: "carousel", status: "scheduled", scheduledFor: day(1) })],
    posted: [
      post("Reel entrega das chaves", { type: "reel", status: "published", publishedAt: day(-2), files: 1 }),
      post("Fachada finalizada", { status: "published", publishedAt: day(-5) }),
      post("Carrossel materiais", { type: "carousel", status: "published", publishedAt: day(-30), files: 8 }),
    ],
  },
};

const counts = (over: Partial<Record<string, number>>) => ({
  todo: 0,
  doing: 0,
  approval: 0,
  adjusting: 0,
  approved: 0,
  scheduled: 0,
  posted: 0,
  ...over,
});

/** Clients for the Portal tab: one with a lot waiting, a long name, a quiet one. */
const CLIENTS: PortalClientSummary[] = [
  {
    client: CLIENT,
    counts: counts({ todo: 3, doing: 2, approval: 2, adjusting: 1, approved: 1 }),
    open: 9,
    next: day(1),
    color: "green",
  },
  {
    client: "casa-moema",
    counts: counts({ approval: 3, doing: 1, adjusting: 1 }),
    open: 5,
    next: day(3),
    color: "navy",
  },
  {
    client: "studio-arquitetura-e-interiores-ribeiro",
    counts: counts({ todo: 1, approved: 2 }),
    open: 3,
    next: null,
    color: "orange",
  },
  { client: "padaria-sol", counts: counts({ todo: 2 }), open: 2, next: day(6), color: null },
  { client: "zim", counts: counts({}), open: 0, next: null, color: "purple" },
  // The test client the team removes (ADR 9001, addendum 2026-11-18), with a name of its own.
  { client: "teste-ajustes", counts: counts({ todo: 1 }), open: 1, next: null, color: null, name: "Teste Ajustes" },
];
/** Clients the team removed: out of every list until shown again. */
const HIDDEN = new Set<string>();

/** Everything not posted yet, from the clients' counts: one entry per piece of work, at its stage. */
const PIPELINE = CLIENTS.flatMap((c) =>
  (["todo", "doing", "approval", "adjusting", "approved"] as const).flatMap((stage) =>
    Array.from({ length: c.counts[stage] }, (_, i) => ({
      client: c.client,
      kind: stage === "todo" || stage === "doing" ? ("card" as const) : ("post" as const),
      id: `${c.client}-${stage}-${i}`,
      title: "",
      type: "image" as const,
      stage,
      members: [],
      produceOn: null,
      postOn: c.next,
      late: false,
      note: null,
      link: null,
      updatedAt: 0,
    })),
  ),
);

/** The portal's own time to answer: longer than a frame, as the real one over the network. */
const later = () => new Promise((resolve) => setTimeout(resolve, 600));

/** A schedule card wherever it sits: in a list or in none. */
const planCardOf = (id: string): PlanCard | undefined =>
  [...PLAN.lists.flatMap((l) => l.cards), ...PLAN.unlisted].find((c) => c.id === id);

/** A schedule card's change, kept: its fields, and its place when the list or the order changes. */
const patchPlanCard = (target: PlanCard, patch: PortalCardInput): PlanCard => {
  const { list, order: at, date, ...fields } = patch;
  Object.assign(target, fields, date !== undefined ? { date, postOn: date } : {}, { updatedAt: Date.now() });
  if (list !== undefined || at !== undefined) {
    for (const l of PLAN.lists) l.cards = l.cards.filter((c) => c.id !== target.id);
    PLAN.unlisted = PLAN.unlisted.filter((c) => c.id !== target.id);
    if (list !== undefined) target.list = list;
    if (at !== undefined) target.order = at;
    const home = PLAN.lists.find((l) => l.id === target.list);
    const into = home ? home.cards : PLAN.unlisted;
    into.push(target);
    into.sort((a, b) => a.order - b.order);
  }
  return target;
};

/** A server that answers with the samples; anything else answers an empty list. */
function fakeApi(): ApiClient {
  const empty = (): unknown =>
    new Proxy(() => Promise.resolve([]), {
      get: (_t, k) => (k === "then" ? undefined : empty()),
      apply: () => Promise.resolve([]),
    });
  const own: Record<string, unknown> = {
    orgs: new Proxy(
      {
        members: async () => [
          { userId: "u1", name: "Gabriel Zim", email: "", image: null, role: "owner", handle: "gabriel" },
          { userId: "u2", name: "Rosa Lima", email: "", image: null, role: "member", handle: "rosa" },
          { userId: "u3", name: "Messi Duarte", email: "", image: null, role: "member", handle: "messi" },
        ],
      },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : empty()) },
    ),
    account: new Proxy(
      {
        authConfig: async () => ({ approvalPortal: true }),
        me: async () => ({ user: { id: "0198a4b2-0000-7000-8000-0000000000aa", name: "Gabriel" }, organizations: [] }),
      },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : empty()) },
    ),
    portal: new Proxy(
      {
        // The lists change as the real portal changes them: a new list goes last, an existing name answers that
        // list, an order puts the named ones first, a deleted list leaves its cards in no list.
        plan: async () => structuredClone(PLAN),
        createList: async (_org: string, _client: string, name: string, kind: "plan" | "materials" = "plan") => {
          await later();
          const same = PLAN.lists.find((l) => l.name === name);
          if (same) return { id: same.id, name: same.name, kind: same.kind };
          const list = { id: `l-${++order}`, name, kind, cards: [] };
          PLAN.lists.push(list);
          return { id: list.id, name, kind };
        },
        orderLists: async (_org: string, _client: string, ids: string[]) => {
          await later();
          const byId = new Map(PLAN.lists.map((l) => [l.id, l]));
          PLAN.lists = [...ids.flatMap((id) => byId.get(id) ?? []), ...PLAN.lists.filter((l) => !ids.includes(l.id))];
          return PLAN.lists.map(({ id, name, kind }) => ({ id, name, kind }));
        },
        renameList: async (_org: string, id: string, name: string) => {
          await later();
          const list = PLAN.lists.find((l) => l.id === id);
          if (list) list.name = name;
          return list;
        },
        setListKind: async (_org: string, id: string, kind: "plan" | "materials") => {
          await later();
          const list = PLAN.lists.find((l) => l.id === id);
          if (list) list.kind = kind;
          return list;
        },
        deleteList: async (_org: string, id: string) => {
          await later();
          const list = PLAN.lists.find((l) => l.id === id);
          PLAN.lists = PLAN.lists.filter((l) => l.id !== id);
          PLAN.unlisted.push(...(list?.cards ?? []).map((c) => ({ ...c, list: null })));
        },
        board: async () => structuredClone(BOARD),
        // A card changed as the portal changes it: a schedule card takes the fields (its description, list, order,
        // checklist…), moving to the list it names; a team card moves between To do and In production.
        updateCard: async (_org: string, id: string, patch: PortalCardInput) => {
          await later();
          const planned = planCardOf(id);
          if (planned) return patchPlanCard(planned, patch);
          const all = [...BOARD.cards.todo, ...BOARD.cards.doing];
          const moved = all.find((c) => c.id === id);
          const state = patch.state === "todo" || patch.state === "doing" ? patch.state : null;
          if (moved && state) {
            BOARD.cards.todo = BOARD.cards.todo.filter((c) => c.id !== id);
            BOARD.cards.doing = BOARD.cards.doing.filter((c) => c.id !== id);
            BOARD.cards[state].push({ ...moved, state });
          }
          return moved;
        },
        // A new card goes last in its list (or in no list).
        createCard: async (_org: string, input: { title: string } & PortalCardInput) => {
          await later();
          const made = card(null, input.title);
          PLAN.unlisted.push(made);
          return patchPlanCard(made, { ...input, list: input.list ?? null });
        },
        overview: async () => ({
          clients: CLIENTS.filter((c) => !HIDDEN.has(c.client)),
          hidden: [...HIDDEN].map((client) => ({
            client,
            name: CLIENTS.find((c) => c.client === client)?.name ?? null,
          })),
        }),
        // A client's name, picture, colour and removal, kept as the server keeps them.
        setClientName: async (_org: string, client: string, name: string | null) => {
          await later();
          const kept = name?.replace(/\s+/g, " ").trim() || null;
          const found = CLIENTS.find((c) => c.client === client);
          if (found) found.name = kept;
          return { name: kept };
        },
        setClientHidden: async (_org: string, client: string, hidden: boolean) => {
          await later();
          if (hidden) HIDDEN.add(client);
          else HIDDEN.delete(client);
        },
        setClientColor: async (_org: string, client: string, color: PortalClientSummary["color"]) => {
          await later();
          const found = CLIENTS.find((c) => c.client === client);
          if (found) found.color = color ?? null;
        },
        setClientLogo: async (_org: string, client: string, image: { imageBase64: string } | null) => {
          await later();
          const found = CLIENTS.find((c) => c.client === client);
          if (found) found.logo = image ? `data:image/png;base64,${image.imageBase64}` : null;
        },
        toSchedule: async () => ({ items: structuredClone(BOARD.items.approved) }),
        schedule: async () => {
          await later();
          return {};
        },
        pipeline: async () => ({ day: "2026-11-17", entries: PIPELINE }),
        tasks: async () => [{ cardId: "card-1", id: "t1", number: 49 }],
      },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : empty()) },
    ),
    artifacts: new Proxy(
      { fileUrl: () => `${origin()}/amostra/capa-portal.png` },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : empty()) },
    ),
  };
  return new Proxy(own, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : empty()) }) as unknown as ApiClient;
}

/** A phone as wide as `width` (the browser's window may not go that narrow), from the window's top left. */
function Server({ width = 390, children }: { width?: number; children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG} org={SUMMARY}>
          <ToastHost>
            <HeaderHeightContext.Provider value={100}>
              <View style={[styles.phone, { width, maxWidth: "100%" }]}>{children}</View>
              {/* The app's root host of action menus and pickers (a list's "…", a card held in place). */}
              <PickerHost />
            </HeaderHeightContext.Provider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export function PortalCronograma() {
  return (
    <Server>
      <ClientScreen client={CLIENT} initialTab="plan" />
    </Server>
  );
}

export function PortalCronograma320() {
  return (
    <Server width={320}>
      <ClientScreen client={CLIENT} initialTab="plan" />
    </Server>
  );
}

export function PortalQuadro() {
  return (
    <Server>
      <ClientScreen client={CLIENT} initialTab="board" />
    </Server>
  );
}

export function PortalQuadro320() {
  return (
    <Server width={320}>
      <ClientScreen client={CLIENT} initialTab="board" />
    </Server>
  );
}

export function PortalPostados() {
  return (
    <Server>
      <ClientScreen client={CLIENT} initialTab="posted" />
    </Server>
  );
}

export function PortalClientes() {
  return (
    <Server>
      <PortalScreen />
    </Server>
  );
}

/** A client's own sheet, opened over the Portal tab as a long press opens it (ADR 9001, addendum 2026-11-18). */
export function PortalClienteEditar() {
  return (
    <Server>
      <SheetHostProvider>
        <PortalScreen />
        <OpenOnce>{<ClientEditSheet client={CLIENT} />}</OpenOnce>
      </SheetHostProvider>
    </Server>
  );
}

/** Opens its content in the screen's sheet once, as the press would. */
function OpenOnce({ children }: { children: ReactNode }) {
  const sheet = useSheet();
  const [content] = useState(() => children);
  useEffect(() => {
    const timer = setTimeout(() => sheet.open(content), 600);
    return () => clearTimeout(timer);
  }, [sheet, content]);
  return null;
}

export function PortalAgendar() {
  return (
    <Server>
      <ScheduleSheet open items={BOARD.items.approved} start={null} onClose={() => {}} />
    </Server>
  );
}

export function PortalAgendarPost() {
  return (
    <Server>
      <ScheduleSheet open items={BOARD.items.approved} start={BOARD.items.approved[0] ?? null} onClose={() => {}} />
    </Server>
  );
}

export function PortalCronogramaPostados320() {
  return (
    <Server width={320}>
      <ClientScreen client={CLIENT} initialTab="posted" />
    </Server>
  );
}

/** The card everything is on (files, labels, members, dates, checklist, caption), each part changed in place. */
export function PortalCartaoEditar() {
  return (
    <Server>
      <CardScreen client={CLIENT} cardId="card-1" />
    </Server>
  );
}

/** A sheet of the card's editing, opened over it as its row's press opens it. */
function OverCard({ children }: { children: ReactNode }) {
  return (
    <Server>
      <SheetHostProvider>
        <CardScreen client={CLIENT} cardId="card-1" />
        <OpenOnce>{children}</OpenOnce>
      </SheetHostProvider>
    </Server>
  );
}

export function PortalCartaoData() {
  return (
    <OverCard>
      <DateSheet title="Data do post" day={day(3).slice(0, 10)} time="10:30" onSave={() => {}} />
    </OverCard>
  );
}

export function PortalCartaoEtiquetas() {
  return (
    <OverCard>
      <LabelsSheet client={CLIENT} cardId="card-1" />
    </OverCard>
  );
}

export function PortalCartaoMembros() {
  return (
    <OverCard>
      <MembersSheet client={CLIENT} cardId="card-1" />
    </OverCard>
  );
}

export function PortalCartao() {
  return (
    <Server>
      <CardScreen client={CLIENT} cardId="card-2" />
    </Server>
  );
}

/** A card with a long description at the narrowest phone: it wraps, and it opens to edit. */
export function PortalCartaoLongo() {
  return (
    <Server width={320}>
      <CardScreen client={CLIENT} cardId="card-longa" />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, overflow: "hidden" },
});
