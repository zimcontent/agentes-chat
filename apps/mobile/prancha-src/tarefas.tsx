import type { ApiClient, OrgSummary } from "@dougbot/client";
import { ApiProvider } from "@dougbot/client";
import { localDay } from "@dougbot/client/lib/team-agenda";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { IssuesScreen } from "@/features/issues/IssuesScreen";
import { TeamLanes } from "@/features/issues/TeamLanes";
import { agendaTasks, plusDays, teamLanes } from "@/features/issues/team-board";
import { FixedOrg } from "@/providers/org";
import { ToastHost } from "@/ui";
import { useTheme } from "@/ui/theme";

/*
 * Tarefas' Equipe view on the board: the app's own screen over a fake server with a busy team's agenda (late,
 * blocked, working, a long queue, a task with no project), the person's own lane for who doesn't administer, the empty
 * team, and a lane opened as a tap opens it.
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
const ME = "0198a4b2-0000-7000-8000-0000000000aa";
const ANA = "0198a4b2-0000-7000-8000-0000000000bb";
const LEO = "0198a4b2-0000-7000-8000-0000000000cc";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const TODAY = localDay(new Date());
const day = (n: number) => plusDays(TODAY, n);

const summary = (admin: boolean) =>
  ({
    id: ORG,
    name: "Time Zim",
    slug: "zim",
    role: admin ? "owner" : "member",
    mode: "team",
    permissions: admin ? ["administrator", "assign_work", "post"] : ["assign_work", "post"],
    start: "home",
    showActivity: true,
    chatPrefs: {},
    agentStyle: "simple",
  }) as unknown as OrgSummary;

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
  agent("a-rosa", "ROSA", "Design", "rose"),
  agent("a-sony", "SONY", "Vídeo", "violet"),
  agent("a-mark", "MARK", "Marketing", "amber"),
  agent("a-kiara", "KIARA", "Financeiro", "mint"),
];
const member = (userId: string, name: string, role: string) => ({
  userId,
  name,
  email: "",
  image: null,
  role,
  joinedAt: ago(9999),
  handle: name.split(" ")[0]?.toLowerCase(),
  timezone: "America/Sao_Paulo",
});
const MEMBERS = [
  member(ME, "Gabriel Zim", "owner"),
  member(ANA, "Ana Souza", "member"),
  member(LEO, "Leonardo Albuquerque Figueiredo", "member"),
];

const FONTES = { name: "Fontes", color: "rose" };
const LEXEER = { name: "LEXEER", color: "sky" };
const FIVE = { name: "Five Rings", color: "amber" };
let n = 100;
const t = (
  who: [type: "person" | "agent", id: string],
  title: string,
  o: { status?: string; due?: string | null; project?: { name: string; color: string } | null; blocked?: boolean } = {},
) => {
  n += 1;
  return {
    id: `t-${n}`,
    number: n,
    title,
    status: o.status ?? "todo",
    priority: "normal",
    dueDate: o.due === undefined ? TODAY : o.due,
    assignee: { type: who[0], id: who[1] },
    project: o.project === undefined ? null : o.project,
    blocked: o.blocked ?? false,
  };
};
const AGENDA_TASKS = [
  t(["agent", "a-rosa"], "Capa do carrossel da coleção de verão", {
    status: "in_progress",
    project: FONTES,
    due: null,
  }),
  t(["agent", "a-rosa"], "Lâmina 21 do Investor Pool", { project: FIVE, due: day(1) }),
  t(["agent", "a-rosa"], "Ajustar paleta do guia de marca", { project: LEXEER, due: day(2) }),
  t(["agent", "a-rosa"], "Thumbnails dos 3 cortes da live", { project: FONTES, due: day(3) }),
  t(["agent", "a-rosa"], "Mockups do site novo", { project: LEXEER, due: day(4) }),
  t(["agent", "a-rosa"], "Banner do evento de dezembro", { due: day(5) }),
  t(["person", ANA], "Aprovar roteiro do reel de bastidores", { project: FIVE, due: day(-2) }),
  t(["person", ANA], "Revisar proposta da Connor & Michelle", { status: "in_review", project: FIVE, due: TODAY }),
  t(["person", ANA], "Mandar briefing para o fotógrafo", { project: LEXEER, due: day(2) }),
  t(["agent", "a-sony"], "Exportar o 1080p dos cortes de terça", {
    status: "in_progress",
    project: FONTES,
    due: TODAY,
    blocked: true,
  }),
  t(["agent", "a-sony"], "Legendas em inglês", { project: FONTES, due: day(1) }),
  t(["person", ME], "Fechar orçamento de dezembro", { status: "in_progress", due: day(1) }),
  t(["person", ME], "Ligar para o cliente da LEXEER", { project: LEXEER, due: day(3) }),
  t(["person", LEO], "Conferir contratos do trimestre com o jurídico antes da assinatura", { due: day(6) }),
  t(["agent", "a-mark"], "Relatório semanal de anúncios", { status: "in_progress", project: FIVE, due: null }),
];
const agenda = (empty: boolean) => ({ from: TODAY, to: day(6), tasks: empty ? [] : AGENDA_TASKS });

/** The person's own tasks, as the task list sends them, for "Minhas". */
const MY_ISSUES = AGENDA_TASKS.filter((x) => x.assignee.id === ME || x.assignee.id === ANA).map((x) => ({
  ...x,
  assignee: { type: "person", id: ME },
  project: x.project ? { id: x.project.name, archived: false, ...x.project } : null,
  blocked: x.blocked ? { reason: "x", since: ago(60) } : null,
  description: "",
  columnId: null,
  boardRank: 0,
  labels: [],
  criteria: [],
  createdBy: { type: "person", id: ME },
  source: { type: "manual" },
  channelId: null,
  pullRequests: [],
  githubUrl: null,
  artifacts: [],
  createdAt: ago(600),
  updatedAt: ago(60),
}));

type Answers = Record<string, (...args: unknown[]) => unknown>;
function answers(admin: boolean, empty: boolean): Answers {
  return {
    "account.me": () => ({
      user: { id: ME, name: "Gabriel Zim", email: "gabriel@zim.com", image: null },
      organizations: [summary(admin)],
    }),
    "agents.list": () => AGENTS,
    "orgs.members": () => MEMBERS,
    "issues.agenda": () => agenda(empty),
    "issues.list": () => (empty ? [] : MY_ISSUES),
    "issues.projects": () => ({ projects: [] }),
    "missions.list": () => ({ items: [], counts: { active: 0, waitingYou: 0 } }),
    "system.health": () => ({ ok: true, version: "0.1.0" }),
    "system.instance": () => ({}),
  };
}
/** A server that answers with the samples; anything else answers an empty list (and is logged once). */
function fakeApi(own: Answers): ApiClient {
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
function Server({ admin = true, empty = false, children }: { admin?: boolean; empty?: boolean; children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(() => fakeApi(answers(admin, empty)));
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG} org={summary(admin)}>
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

export function TarefasEquipe() {
  return (
    <Server>
      <IssuesScreen />
    </Server>
  );
}
export function TarefasMinhas() {
  return (
    <Server admin={false}>
      <IssuesScreen />
    </Server>
  );
}
export function TarefasEquipeVazia() {
  return (
    <Server empty>
      <IssuesScreen />
    </Server>
  );
}
/** ROSA's lane opened (as a tap on her opens it): the whole queue. */
export function TarefasEquipeAberta() {
  const { colors: c } = useTheme();
  const lanes = teamLanes(agendaTasks(agenda(false) as never), { today: TODAY, range: "week" });
  return (
    <Server>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.open}>
        <TeamLanes lanes={lanes} today={TODAY} range="week" initialOpen={["agent:a-rosa"]} onOpen={() => {}} />
      </ScrollView>
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, width: "100%", maxWidth: 390, overflow: "hidden" },
  open: { paddingTop: 60, paddingBottom: 40 },
});
