import type { ApiClient, Dashboard, DashboardSummary, OrgSummary, Widget, WidgetSpec } from "@agenteschat/client";
import { ApiProvider } from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { BoardPages } from "@/features/dashboards/BoardPages";
import { FixedOrg } from "@/providers/org";
import { ToastHost } from "@/ui";

/*
 * Dashboards on the board (ADR 0135): the app's own pages over a fake server, My Home with one widget of each shape
 * the prototype shows, and two more boards for the dots. Each widget's id is picked so its color (`tileHue`) is the
 * prototype's where the palette has it.
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
const SUMMARY = { id: ORG, name: "Zim", permissions: ["post"] } as unknown as OrgSummary;
const AGENT = "0198a4b2-0000-7000-8000-0000000000b1";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let position = 0;
const widget = (id: string, title: string, spec: WidgetSpec, w: 1 | 2, over: Partial<Widget> = {}): Widget => ({
  id,
  dashboardId: "home-board",
  agentId: AGENT,
  title,
  prompt: "",
  format: spec.kind,
  kind: spec.kind,
  spec,
  sources: [],
  layout: { position: position++, w, h: 1 },
  schedule: "hour",
  alert: { enabled: false, condition: "" },
  status: "ok",
  failure: null,
  wait: null,
  refreshedAt: minutesAgo(5),
  nextRunAt: null,
  routineId: null,
  sourceMessageId: null,
  createdBy: null,
  draft: false,
  lastCostUsd: null,
  createdAt: minutesAgo(600),
  updatedAt: minutesAgo(5),
  ...over,
});

const WIDGETS: Widget[] = [
  widget(
    "leads-7",
    "Leads hoje",
    {
      kind: "bars",
      labels: ["seg", "ter", "qua", "qui", "sex", "sáb", "hoje"],
      values: [8, 12, 9, 15, 11, 18, 23],
      note: "+12% vs. ontem",
    },
    2,
  ),
  widget("faturamento-11", "Faturamento", { kind: "goal", pct: 70, line: "R$ 84 mil", note: "meta R$ 120 mil" }, 1),
  widget("videos-5", "Vídeos aprovados", { kind: "goal", pct: 66.7, line: "4 faltam", note: "Revisão até sexta" }, 1),
  widget(
    "whatsapp-17",
    "WhatsApp · tempo de resposta",
    {
      kind: "kpi",
      value: 4,
      suffix: "min",
      delta: { text: "-2 min", up: true },
      note: "esta semana",
      spark: [9.4, 8.6, 8.8, 7.2, 7.6, 5.4, 4.9, 4.1],
    },
    2,
  ),
  widget("gasto-4", "Gasto de IA", { kind: "kpi", value: 312, prefix: "R$", note: "este mês" }, 1, {
    refreshedAt: minutesAgo(42),
  }),
  widget(
    "tarefas-2",
    "Tarefas abertas",
    {
      kind: "list",
      rows: [
        { text: "Pauta Five Rings", meta: "hoje", tone: "warn" },
        { text: "Fatura Connor", meta: "hoje", tone: "warn" },
        { text: "Roteiro Lexeer", meta: "sex" },
      ],
    },
    1,
  ),
];

/** Every kind in every size, and the states a widget passes through: the shapes to check on one long page. */
const SHAPES: Widget[] = [
  widget(
    "s1",
    "Faturamento recorrente mensal de todos os clientes ativos",
    { kind: "kpi", value: 18420, prefix: "R$", delta: { text: "+8%", up: true }, spark: [3, 4, 4, 6, 5, 7, 8] },
    1,
  ),
  widget(
    "s2",
    "Pedidos",
    {
      kind: "line",
      labels: ["1", "2", "3", "4", "5", "6"],
      values: [120, 140, 132, 160, 171, 190],
      unit: "pedidos por dia",
    },
    1,
  ),
  widget("s3", "Campanhas", { kind: "kpi", value: 0.25, suffix: "%", note: "taxa de clique" }, 2),
  widget(
    "s4",
    "Vendas por vendedor",
    { kind: "bars", labels: ["Ana", "Bruno", "Carla", "Davi"], values: [40, 22, 31, 12], unit: "R$ mil" },
    1,
  ),
  widget(
    "s5",
    "Resumo do dia",
    { kind: "text", items: ["Três clientes pediram ajustes no roteiro; dois já aprovados.", "Nada travado."] },
    1,
  ),
  widget(
    "s6",
    "Meta do trimestre",
    { kind: "goal", pct: 62, line: "R$ 248 mil de R$ 400 mil", note: "Nesse ritmo, chega no dia 27." },
    2,
  ),
  widget(
    "s7",
    "Chamados por mês",
    {
      kind: "bars",
      labels: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez", "jan", "fev"],
      values: [4, 6, 5, 9, 7, 11, 8, 12, 10, 13, 9, 15, 14, 18],
      alertIndex: 3,
    },
    2,
  ),
  widget(
    "s8",
    "Tempo de carregamento",
    {
      kind: "line",
      labels: ["seg", "ter", "qua", "qui", "sex"],
      values: [820, 760, 900, 640, 610],
      unit: "ms",
      note: "melhor desde março",
    },
    2,
  ),
  widget(
    "s9",
    "Pull requests abertos",
    {
      kind: "list",
      rows: [
        { text: "Corrige o login com Google no Android", meta: "há 2 dias", tone: "warn" },
        { text: "Novo painel de vendas", meta: "ontem", tone: "ok" },
        { text: "Atualiza dependências", meta: "hoje" },
        { text: "Ajusta o e-mail de convite", meta: "hoje" },
        { text: "Traduções em inglês", meta: "hoje" },
      ],
    },
    2,
  ),
  widget(
    "s10",
    "O que mudou",
    {
      kind: "text",
      items: [
        "O cliente Lexeer aprovou os três vídeos da semana.",
        "A fatura da Connor venceu ontem e ainda não foi paga.",
        "Dois roteiros esperam a sua revisão.",
        "O post de sexta saiu no horário.",
      ],
    },
    2,
  ),
  widget(
    "s11",
    "Receita por semana",
    {
      kind: "bars",
      labels: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"],
      values: [12, 18, 15, 22, 19, 25, 21, 28],
      note: "+33% no mês",
    },
    2,
    { layout: { position: 90, w: 2, h: 2 } },
  ),
  widget(
    "s12",
    "Visitas ao site",
    {
      kind: "line",
      labels: ["1 nov", "2", "3", "4", "5", "6", "7", "8", "9", "10 nov"],
      values: [1200, 1320, 1100, 1500, 1480, 1700, 1650, 1900, 1850, 2100],
      unit: "visitas",
      note: "+18% na semana",
    },
    2,
    { layout: { position: 91, w: 2, h: 2 } },
  ),
  widget("s13", "Novo widget", { kind: "kpi", value: 0 }, 1, {
    spec: null,
    kind: null,
    title: "",
    status: "building",
    refreshedAt: null,
  }),
  widget("s14", "Clientes ativos", { kind: "kpi", value: 48, delta: { text: "+3", up: true }, note: "este mês" }, 1, {
    status: "updating",
  }),
  widget("s15", "Entregas no prazo", { kind: "goal", pct: 91, line: "41 de 45", note: "este mês" }, 1, {
    status: "failed",
  }),
  widget(
    "s16",
    "Posts da semana",
    {
      kind: "list",
      rows: [
        { text: "Carrossel Lexeer", meta: "seg" },
        { text: "Reels Five Rings", meta: "qua" },
      ],
    },
    1,
  ),
];

const summary = (id: string, title: string, over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  id,
  kind: "board",
  title,
  about: "",
  audience: "workspace",
  roleIds: [],
  editPolicy: "viewers",
  pinned: false,
  position: 0,
  owner: null,
  ownerUserId: null,
  mine: false,
  widgetCount: 0,
  thumbs: [],
  viewerCount: 0,
  canEdit: true,
  canManage: true,
  proposal: null,
  createdAt: minutesAgo(900),
  updatedAt: minutesAgo(900),
  ...over,
});

const HOME: Dashboard = {
  ...summary("home-board", "", { kind: "home", audience: "private", widgetCount: WIDGETS.length }),
  widgets: WIDGETS,
  tiles: [],
};

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
    dashboards: new Proxy(
      {
        list: async () => ({
          home: HOME,
          dashboards: [summary("vendas", "Vendas", { position: 1 }), summary("conteudo", "Conteúdo", { position: 2 })],
          homeDashboardId: null,
        }),
        home: async () => HOME,
        get: async (_org: string, id: string) => ({
          ...summary(id, id === "formas" ? "Todas as formas" : id),
          widgets: id === "formas" ? SHAPES : [],
          tiles: [],
        }),
      },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : empty()) },
    ),
  };
  return new Proxy(own, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : empty()) }) as unknown as ApiClient;
}

/** A phone `width` wide (the browser's window may not go that narrow), from the window's top left. */
function Server({ width = 390, children }: { width?: number; children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG} org={SUMMARY}>
          <ToastHost>
            {/* An iPhone's status bar and home indicator, which a browser has none of. */}
            <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
              <View style={[styles.phone, { width, maxWidth: "100%" }]}>{children}</View>
            </SafeAreaInsetsContext.Provider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export function Paineis() {
  return (
    <Server>
      <BoardPages />
    </Server>
  );
}

/** The smallest phone: 320 points. */
export function Paineis320() {
  return (
    <Server width={320}>
      <BoardPages />
    </Server>
  );
}

/** Every shape on one page (shot tall). */
export function PaineisFormas() {
  return (
    <Server>
      <BoardPages initial="formas" />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, overflow: "hidden" },
});
