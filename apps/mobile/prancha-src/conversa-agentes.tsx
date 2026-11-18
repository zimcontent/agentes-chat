import { type ApiClient, ApiProvider, keys, type Message, type OrgSummary } from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { ChatBackdrop } from "@/features/chat/ChatBackdrop";
import { RowLookContext, useConversationLook } from "@/features/chat/look";
import { MessageRow } from "@/features/chat/MessageRow";
import { SheetHostProvider } from "@/features/shared/SheetHost";
import { FixedOrg } from "@/providers/org";
import { ToastHost, useTheme } from "@/ui";

/*
 * A group conversation on the board with the app's own rows (`MessageRow`) over a fake server: people and agents in
 * bubbles, a reply whose agent asked another first (the two agents' pair row, `ConsultPairRow`), and an agent's
 * message whose @mentions it handed over by direct message or couldn't (its reach lines, `ReachLines`). For the
 * screenshots of the bubbles' fill and of what shows when one agent talks to another.
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
const CHANNEL = "0198a4b2-0000-7000-8000-000000000a01";
const ME = "0198a4b2-0000-7000-8000-0000000000aa";
const LETICIA = "0198a4b2-0000-7000-8000-0000000000ab";
const SOCIAL = "0198a4b2-0000-7000-8000-0000000000c1";
const SONY = "0198a4b2-0000-7000-8000-0000000000c2";
const DOUG = "0198a4b2-0000-7000-8000-0000000000c3";
const ROSA = "0198a4b2-0000-7000-8000-0000000000c4";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const SUMMARY = {
  id: ORG,
  name: "Time Zim",
  slug: "zim",
  role: "owner",
  mode: "team",
  permissions: ["assign_work", "post", "manage_agents", "manage_settings", "manage_channels"],
  start: "home",
  showActivity: true,
  chatPrefs: {},
  agentStyle: "simple",
} as unknown as OrgSummary;

const agent = (id: string, name: string, handle: string, role: string, color: string) => ({
  id,
  name,
  handle,
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
  agent(SOCIAL, "SOCIAL MEDIA", "social", "Social media da LEXEER", "violet"),
  agent(SONY, "SONY", "sony", "Vídeo", "sky"),
  agent(DOUG, "Doug", "doug", "Chefe do time", "green"),
  agent(ROSA, "ROSA", "rosa", "Design", "rose"),
];
const member = (userId: string, name: string, handle: string) => ({
  userId,
  name,
  email: "",
  image: null,
  role: "member",
  joinedAt: ago(9999),
  handle,
  timezone: "America/Sao_Paulo",
});
const MEMBERS = [member(ME, "Gabriel Zim", "gabriel"), member(LETICIA, "Leticia Zim", "leticia")];

const msg = (id: string, author: Message["author"], body: string, min: number, over: Partial<Message> = {}) =>
  ({
    id,
    channelId: CHANNEL,
    threadId: null,
    author,
    body,
    mentionedAgentIds: [],
    agentRunId: null,
    meta: {},
    createdAt: ago(min),
    ...over,
  }) as Message;

const person = (id: string) => ({ type: "person" as const, id });
const bot = (id: string) => ({ type: "agent" as const, id });

const MESSAGES: Message[] = [
  msg("m1", person(LETICIA), "Suba a capa agora", 30),
  msg("m2", bot(SOCIAL), "Capa no portal, feita pelo SONY.", 26, { agentRunId: "r1" }),
  msg("m3", person(ME), "Perfeito, obrigado!", 20),
  msg("m4", bot(SOCIAL), "@doug @rosa usem essa capa.", 18, {
    agentRunId: "r2",
    meta: {
      reach: [
        { agentId: DOUG, handle: "doug", reason: "not_in_channel", consultationId: "c2", outside: true },
        { agentId: ROSA, handle: "rosa", reason: "not_in_channel", private: true, outside: true },
      ],
    },
  }),
];

const CONSULTATIONS = [
  {
    id: "c1",
    kind: "question",
    runId: "r1",
    agentId: SOCIAL,
    consultedAgentId: SONY,
    consultedRunId: "r1s",
    status: "answered",
    waiting: null,
    question: "Exporta a capa do reel da LEXEER em 1080x1920?",
    answer: "Feito, está na pasta da LEXEER.",
    createdAt: ago(29),
    answeredAt: ago(28.3),
    expiresAt: ago(-60),
  },
  {
    id: "c2",
    kind: "note",
    runId: "r2",
    agentId: SOCIAL,
    consultedAgentId: DOUG,
    consultedRunId: "r2d",
    status: "answered",
    waiting: null,
    question: "A capa nova está no portal, usem a mesma no carrossel.",
    answer: "Anotado.",
    createdAt: ago(18),
    answeredAt: ago(17),
    expiresAt: ago(-60),
  },
];

const CHANNELS = [
  {
    id: CHANNEL,
    name: "lexeer",
    displayName: "LEXEER",
    topic: "",
    visibility: "public",
    isMember: true,
    createdAt: ago(9999),
  },
];

type Answers = Record<string, (...args: unknown[]) => unknown>;
const ANSWERS: Answers = {
  "account.me": () => ({
    user: { id: ME, name: "Gabriel Zim", email: "gabriel@zim.com", image: null },
    organizations: [SUMMARY],
  }),
  "agents.list": () => AGENTS,
  "agents.former": () => [],
  "agents.consultations": () => CONSULTATIONS,
  "orgs.members": () => MEMBERS,
  "chat.channels": () => CHANNELS,
  "chat.messages": () => MESSAGES,
  "agents.aiStatus": () => ({ agents: [] }),
};

/** A server that answers with the samples; anything else answers an empty list. */
function fakeApi(): ApiClient {
  const area = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === "then") return undefined;
          const key = `${name}.${String(k)}`;
          return async (...args: unknown[]) => ANSWERS[key]?.(...args) ?? [];
        },
      },
    );
  return new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : area(String(k))) }) as unknown as ApiClient;
}

function Server({ children }: { children: ReactNode }) {
  const [qc] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The rows read the conversation's messages from the cache (which of a run's messages draws its pair row).
    client.setQueryData(keys.messages(ORG, CHANNEL), MESSAGES);
    return client;
  });
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG} org={SUMMARY}>
          <ToastHost>
            <SheetHostProvider>
              <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
                <View style={styles.phone}>{children}</View>
              </SafeAreaInsetsContext.Provider>
            </SheetHostProvider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

function Rows() {
  const look = useConversationLook(false);
  const { colors } = useTheme();
  return (
    <RowLookContext.Provider value={look}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
        <ChatBackdrop accent={null} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {MESSAGES.map((m) => (
          <MessageRow key={m.id} message={m} grouped={false} meId={ME} />
        ))}
      </ScrollView>
    </RowLookContext.Provider>
  );
}

/** `/conversa-agentes`: a group in bubbles, two agents talking. */
export function ConversaAgentes() {
  return (
    <Server>
      <Rows />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1 },
  list: { paddingTop: 60, paddingBottom: 40 },
});
