import type { ApiClient, OrgSummary, PortalItem } from "@agenteschat/client";
import { ApiProvider } from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityScreen } from "@/features/activity/ActivityScreen";
import { AboutPage } from "@/features/me/AboutPage";
import { MeScreen } from "@/features/me/MeScreen";
import { ScheduleOneSheet } from "@/features/portal/ScheduleOneSheet";
import { SheetHostProvider } from "@/features/shared/SheetHost";
import { FixedOrg } from "@/providers/org";
import { ToastHost } from "@/ui";
import { TabBar } from "./telas";

/*
 * Pendentes and Ajustes on the board: the app's own tab screens over a fake server with sample requests, running work
 * and a settings home, so they can be looked at in a browser in both themes. Anything the samples don't answer is an
 * empty list (logged once to the console, so a new call shows up while the board is read).
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
const ME = "0198a4b2-0000-7000-8000-0000000000aa";
const ANA = "0198a4b2-0000-7000-8000-0000000000bb";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

const SUMMARY = {
  id: ORG,
  name: "Time Zim",
  slug: "zim",
  role: "owner",
  mode: "team",
  permissions: ["assign_work", "post", "manage_agents", "manage_settings"],
  start: "home",
  showActivity: true,
  chatPrefs: {},
  agentStyle: "simple",
} as unknown as OrgSummary;

const agent = (id: string, name: string, role: string, color: string) => ({
  id,
  name,
  handle: name.toLowerCase(),
  role,
  instructions: "",
  model: "claude",
  ownerUserId: ME,
  hasCredential: true,
  createdAt: ago(60 * 24 * 30),
  appearance: { color, eyes: "round" },
  photo: null,
});
const AGENTS = [
  agent("a-doug", "Doug", "Chefe do time", "sky"),
  agent("a-rosa", "ROSA", "Design", "rose"),
  agent("a-sony", "SONY", "Vídeo", "violet"),
  agent("a-mark", "MARK", "Marketing", "amber"),
  agent("a-kiara", "KIARA", "Financeiro", "mint"),
];
const MEMBERS = [
  {
    userId: ME,
    name: "Gabriel Zim",
    email: "",
    image: null,
    role: "owner",
    joinedAt: ago(9999),
    handle: "gabriel",
    timezone: "America/Sao_Paulo",
  },
  {
    userId: ANA,
    name: "Ana Souza",
    email: "",
    image: null,
    role: "member",
    joinedAt: ago(9999),
    handle: "ana",
    timezone: "America/Sao_Paulo",
  },
];

const note = (id: string, kind: string, over: Record<string, unknown>) => ({
  id,
  kind,
  waiting: false,
  actors: [],
  count: 1,
  source: {},
  latest: {},
  readAt: null,
  doneAt: null,
  snoozedUntil: null,
  createdAt: ago(30),
  updatedAt: ago(30),
  ...over,
});

const APPROVAL = {
  id: "ap-1",
  runId: "r-9",
  agentId: "a-mark",
  channelId: "c-mkt",
  threadId: null,
  messageId: "m-ap",
  tool: "gmail_send",
  scope: "gmail:send",
  title: "Enviar e-mail para clientes",
  detail: "Para: lista de clientes · Assunto: Novidades de novembro",
  params: {},
  status: "pending",
  expiresAt: ahead(50),
  createdAt: ago(10),
  decidedByUserId: null,
  decidedAt: null,
  reason: null,
  canDecide: true,
  email: {
    verb: "send",
    mailbox: "contato@zim.com",
    provider: "Gmail",
    from: "contato@zim.com",
    to: ["clientes@zim.com"],
    cc: [],
    bcc: [],
    subject: "Novidades de novembro",
  },
};

const NOTES = [
  note("n-ap", "approval", {
    waiting: true,
    actors: [{ type: "agent", id: "a-mark" }],
    source: { approvalId: "ap-1", channelId: "c-mkt", label: "#marketing" },
    latest: {
      title: "Enviar e-mail para clientes",
      text: "O lançamento sai hoje e a lista pediu aviso.",
      expiresAt: ahead(50),
    },
    updatedAt: ago(10),
  }),
  note("n-q", "agent_question", {
    waiting: true,
    actors: [{ type: "agent", id: "a-rosa" }],
    source: { channelId: "c-design", messageId: "m-q", label: "#design" },
    latest: { text: "Qual das duas capas vai para o carrossel da LEXEER: a azul ou a clara?" },
    updatedAt: ago(25),
  }),
  note("n-join", "join_request", {
    waiting: true,
    count: 1,
    source: { requestId: "j-1" },
    latest: { names: ["Bruno Lima"] },
    updatedAt: ago(90),
  }),
  note("n-r1", "mention", {
    actors: [{ type: "person", id: ANA }],
    source: { channelId: "c-geral", messageId: "m-1", label: "#geral" },
    latest: { text: "@gabriel o roteiro do vídeo está no Drive, dá uma olhada quando puder" },
    updatedAt: ago(40),
  }),
  note("n-r2", "issue_done", {
    actors: [{ type: "agent", id: "a-sony" }],
    readAt: ago(10),
    source: { issueId: "i-1", issueNumber: 49, label: "Reel bastidores" },
    latest: { title: "Reel bastidores" },
    updatedAt: ago(120),
  }),
  note("n-r3", "reaction", {
    actors: [{ type: "person", id: ANA }],
    readAt: ago(10),
    source: { channelId: "c-geral", messageId: "m-2", label: "#geral" },
    latest: { emojis: ["🔥", "👏"], quote: "Subi a versão final do site" },
    updatedAt: ago(60 * 26),
  }),
];

const RUNS = [
  {
    runId: "run-1",
    agentId: "a-sony",
    channelId: "c-video",
    channelKind: "channel",
    channelName: "video",
    threadId: "t-1",
    status: "running",
    startedAt: ago(12),
    createdAt: ago(12),
    label: "Cortes da live de terça",
    work: { id: "w-1", title: "Cortes da live de terça", plan: { done: 2, total: 5 }, since: ago(12) },
  },
  {
    runId: "run-2",
    agentId: "a-doug",
    channelId: "c-geral",
    channelKind: "channel",
    channelName: "geral",
    threadId: null,
    status: "running",
    startedAt: ago(3),
    createdAt: ago(3),
    label: "Resumo da semana para o time",
  },
];

const post = (id: string, client: string, title: string, scheduledFor: string | null) => ({
  client,
  id,
  title,
  type: "carousel",
  status: "approved",
  scheduledFor,
  released: false,
  publishedAt: null,
  createdAt: ago(60 * 30),
  updatedAt: ago(60 * 5),
  editor: null,
  caption: "",
  files: 4,
  video: false,
  version: 1,
  missing: [],
  lastNote: null,
  postUrl: null,
  link: "",
});
const TO_SCHEDULE = [
  post("p-1", "lexeer", "Carrossel lançamento da coleção de verão", null),
  post("p-2", "five-rings", "Reel bastidores", null),
];

const ROUTINES = [
  { id: "ro-1", name: "Relatório financeiro", agentId: "a-kiara", active: true, nextRunAt: ahead(60 * 3) },
];

/** What each call answers, by `area.method`. */
type Answers = Record<string, (...args: unknown[]) => unknown>;
const counts = (waiting: number) => ({ unread: 2, waiting, all: NOTES.length, done: 0 });

function answers(kind: Sample): Answers {
  const empty = kind === "vazio";
  const notes = empty ? NOTES.filter((n) => !n.waiting) : NOTES;
  const waiting = notes.filter((n) => n.waiting).length;
  return {
    "account.me": () => ({
      user: { id: ME, name: "Gabriel Zim", email: "gabriel@zim.com", image: null },
      organizations: [SUMMARY],
    }),
    "agents.list": () => AGENTS,
    "orgs.members": () => MEMBERS,
    "approvals.list": () => (empty ? [] : [APPROVAL]),
    "working.list": () => RUNS,
    "routines.list": () => ROUTINES,
    "notifications.list": (_org, q) => {
      const filter = (q as { filter?: string } | undefined)?.filter;
      const items = filter === "waiting" ? notes.filter((n) => n.waiting) : filter === "done" ? [] : notes;
      return { items, counts: counts(waiting), nextCursor: null };
    },
    "notifications.count": () => counts(waiting),
    "orgs.overview": () => ({ proposalsWaitingForMe: 1 }),
    "issues.list": () => [],
    "system.health": () => ({ ok: true, version: "0.1.0" }),
    "agents.aiStatus": () => ({ agents: [] }),
    "account.unread": () => ({ organizations: [] }),
    "account.authConfig": () => ({ about: true, approvalPortal: true }),
    "portal.toSchedule": () => ({ items: empty ? [] : TO_SCHEDULE }),
    "system.instance": () => ({}),
  };
}

type Sample = "cheio" | "vazio";

/** A server that answers with the samples; anything else answers an empty list (and is logged once). */
function fakeApi(kind: Sample): ApiClient {
  const own = answers(kind);
  const told = new Set<string>();
  const area = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === "then") return undefined;
          const key = `${name}.${String(k)}`;
          return async (...args: unknown[]) => {
            const answer = own[key];
            if (answer) return answer(...args);
            if (!told.has(key)) {
              told.add(key);
              console.warn(`[prancha] sem amostra: ${key}`);
            }
            return [];
          };
        },
      },
    );
  return new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : area(String(k))) }) as unknown as ApiClient;
}

function Server({ kind = "cheio", children }: { kind?: Sample; children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(() => fakeApi(kind));
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG} org={SUMMARY}>
          <ToastHost>
            <HeaderHeightContext.Provider value={100}>
              <View style={styles.phone}>{children}</View>
            </HeaderHeightContext.Provider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export function Pendentes() {
  return (
    <Server>
      <ActivityScreen />
      <TabBar on="waiting" />
    </Server>
  );
}

export function PendentesVazio() {
  return (
    <Server kind="vazio">
      <ActivityScreen />
      <TabBar on="waiting" />
    </Server>
  );
}

/** The schedule sheet on its own (a tap opens it in the app; the board can't tap). */
export function PendentesAgendar() {
  return (
    <Server>
      <SheetHostProvider>
        <View style={styles.sheet}>
          <ScheduleOneSheet item={TO_SCHEDULE[0] as unknown as PortalItem} />
        </View>
      </SheetHostProvider>
    </Server>
  );
}

export function Ajustes() {
  return (
    <Server>
      <MeScreen tab />
      <TabBar on="settings" />
    </Server>
  );
}

export function AjustesSobre() {
  return (
    <Server>
      <AboutPage />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, width: 390, maxWidth: "100%", overflow: "hidden" },
  sheet: { padding: 16, paddingTop: 64, gap: 12 },
});
