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
  agent(SOCIAL, "SOCIAL MEDIA ( LEXEER )", "social", "Social media da LEXEER", "violet"),
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

const FENCE = "```";
/** The worst a bubble gets: what can't break, what is wide, lists, chips, marks (`/conversa-pior`). */
const WORST: Message[] = [
  msg(
    "w1",
    bot(SOCIAL),
    "Abrir no portal: https://mydoug.io/portal/i/lexeer/up-08fdd3d7-abcdef0123456789-very-long-path",
    60,
  ),
  msg("w2", person(ME), "Antidisestablishmentarianismoextraordinariamentecomprido123456", 58),
  msg("w3", bot(SOCIAL), "Supercalifragilisticexpialidociousmentecomprida_sem_espaco_nenhum_aqui", 57),
  msg(
    "w4",
    bot(SOCIAL),
    "@doug @rosa @sony vejam a capa nova do reel da LEXEER antes de publicar amanhã cedo, por favor, e me digam se o lettering cobre a boca.",
    56,
  ),
  msg("w5", person(ME), "@doug @rosa @sony", 55),
  msg(
    "w6",
    bot(SOCIAL),
    `Rode \`bun run --cwd apps/mobile typecheck --pretty false\` e depois:\n\n${FENCE}sh\ncurl -sS https://mydoug.io/api/app/orgs/0198a4b2-0000-7000-8000-000000000001/channels/0198a4b2-0000-7000-8000-000000000a01/messages?limit=200\n${FENCE}`,
    54,
  ),
  msg(
    "w7",
    bot(SOCIAL),
    "Para hoje:\n\n- Subir a capa nova do reel da LEXEER no portal com o lettering ajustado para não cobrir a boca\n- Avisar a ROSA para usar a mesma capa no carrossel da coleção de verão\n\n1. Exportar em 1080x1920 com a trilha nova e o corte aprovado ontem\n2. Agendar para amanhã às 9h no Instagram e no TikTok da LEXEER",
    53,
  ),
  msg(
    "w8",
    bot(SOCIAL),
    "⚠ Model produced invalid output. Não consigo subir só a capa no item up-08fdd3d7 (https://mydoug.io/portal/i/lexeer/up-08fdd3d7): a ferramenta de nova versão do portal exige enviar o vídeo do reel inteiro novamente.",
    52,
  ),
  msg("w9", person(LETICIA), "🎉🎉🎉", 51),
  msg("w10", person(ME), "🔥", 50),
  msg(
    "w11",
    bot(SOCIAL),
    "Veja [o item no portal da LEXEER com o nome bem comprido](https://mydoug.io/portal/i/lexeer/up-08fdd3d7) e me diga.",
    49,
  ),
  msg(
    "w12",
    person(ME),
    "Abrir no portal: https://mydoug.io/portal/i/lexeer/up-08fdd3d7-abcdef0123456789-very-long-path e `bun run --cwd apps/mobile typecheck`",
    48,
  ),
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

function Server({ messages = MESSAGES, children }: { messages?: Message[]; children: ReactNode }) {
  const [qc] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The rows read the conversation's messages from the cache (which of a run's messages draws its pair row).
    client.setQueryData(keys.messages(ORG, CHANNEL), messages);
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

function Rows({ messages = MESSAGES }: { messages?: Message[] }) {
  const look = useConversationLook(false);
  const { colors } = useTheme();
  return (
    <RowLookContext.Provider value={look}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
        <ChatBackdrop accent={null} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {messages.map((m) => (
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

/** `/conversa-pior`: the worst a bubble holds, to check nothing leaves it (mine and the others'). */
export function ConversaPior() {
  return (
    <Server messages={WORST}>
      <Rows messages={WORST} />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1 },
  list: { paddingTop: 60, paddingBottom: 40 },
});
