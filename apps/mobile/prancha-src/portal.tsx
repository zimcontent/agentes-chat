import type { ApiClient, OrgSummary, PlanCard, PortalPlan } from "@agenteschat/client";
import { ApiProvider } from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { type ReactNode, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { CardScreen } from "@/features/portal/CardScreen";
import { ClientScreen } from "@/features/portal/ClientScreen";
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
          checklist: [
            { id: "a", text: "Render", done: true },
            { id: "b", text: "Moodboard", done: false },
          ],
          comments: [{ id: "m1", by: "u1", text: "Pode usar o render novo", at: 1 }],
        }),
        card("l1", "Drive", { postOn: day(2) }),
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
    { id: "l3", name: "Semana 24/11", kind: "plan", cards: [card("l3", "Story enquete", { type: "story" })] },
    { id: "m1", name: "Logins", kind: "materials", cards: [card("m1", "Instagram", { material: true })] },
  ],
  // Cards no list holds yet: "Sem lista", the schedule's last column (the case where a list added at the end used to
  // land behind it, out of sight).
  unlisted: [card(null, "Ideia: bastidores da obra", { type: "reel" }), card(null, "Post de Natal")],
  loose: [],
  labels: [],
};

/** The portal's own time to answer: longer than a frame, as the real one over the network. */
const later = () => new Promise((resolve) => setTimeout(resolve, 600));

/** A server that answers with the samples; anything else answers an empty list. */
function fakeApi(): ApiClient {
  const empty = (): unknown =>
    new Proxy(() => Promise.resolve([]), {
      get: (_t, k) => (k === "then" ? undefined : empty()),
      apply: () => Promise.resolve([]),
    });
  const own: Record<string, unknown> = {
    account: new Proxy(
      {
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
        board: async () => ({
          client: CLIENT,
          cards: { todo: [], doing: [] },
          items: { approval: [], adjusting: [], approved: [], scheduled: [], posted: [] },
        }),
        overview: async () => ({
          clients: [{ client: CLIENT, counts: {}, open: 30, next: null }],
        }),
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
              <View style={[styles.phone, { width }]}>{children}</View>
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

export function PortalCartao() {
  return (
    <Server>
      <CardScreen client={CLIENT} cardId="card-2" />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, overflow: "hidden" },
});
