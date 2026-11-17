import {
  type Agent,
  type ApiClient,
  ApiProvider,
  type WhatsAppAccount,
  type WhatsAppChat,
  type WhatsAppMessage,
} from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { WhatsAppChatsScreen } from "@/features/whatsapp/WhatsAppChatsScreen";
import { WhatsAppConversationScreen } from "@/features/whatsapp/WhatsAppConversationScreen";
import { FixedOrg } from "@/providers/org";
import { ToastHost } from "@/ui";

/*
 * WhatsApp on the board (docs/adr/doug-0001-whatsapp-numbers.md): the app's own list and conversation over a fake
 * server with the samples of the screens' drawings, so they can be compared in a browser. Times are counted back from
 * now, so "is answering…" and "Hoje" hold whenever the board is opened.
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
const ME = "0198a4b2-0000-7000-8000-0000000000aa";
const ROSA = "0198a4b2-0000-7000-8000-0000000000cc";
const ACCOUNT = "0198a4b2-0000-7000-8000-000000000301";
const FERNANDA = "0198a4b2-0000-7000-8000-000000000408";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const daysAgo = (days: number, hour: number, minute: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const account = (id: string, label: string, phone: string): WhatsAppAccount => ({
  id,
  label,
  status: "connected",
  phone,
  pushName: label,
  qr: null,
  people: [ME],
  agentId: ROSA,
  instructions: null,
  agentOn: true,
  agentStyle: { waitSeconds: 8, pace: "natural", messages: 3, quietMinutes: 60, voiceNotes: true, voice: null },
  ownAi: false,
  mine: true,
  manage: true,
  createdAt: ago(60 * 24 * 30),
});

const ACCOUNTS = [
  account(ACCOUNT, "Lexeer Reformas", "5511950256967"),
  account("0198a4b2-0000-7000-8000-000000000302", "Lexeer Comercial", "5511950250000"),
];

const chat = (over: Partial<WhatsAppChat> & Pick<WhatsAppChat, "id" | "name">): WhatsAppChat => ({
  phone: "5511999990000",
  group: false,
  lastAt: ago(1),
  lastText: "",
  lastKind: "text",
  lastFromMe: false,
  lastStatus: null,
  unread: 0,
  agent: "off",
  agentQuietUntil: null,
  agentNote: "",
  photo: false,
  member: null,
  client: null,
  ...over,
});

const CHATS: WhatsAppChat[] = [
  chat({ id: FERNANDA, name: "Fernanda Lima", lastText: "15h!", unread: 2, agent: "on", lastAt: ago(1) }),
  chat({
    id: "0198a4b2-0000-7000-8000-000000000409",
    name: "Alliance Group",
    phone: null,
    group: true,
    agent: null,
    lastText: "Ronny: vídeo novo no Drive, revisa?",
    unread: 3,
    lastAt: ago(26),
  }),
  chat({
    id: "0198a4b2-0000-7000-8000-000000000413",
    name: "Marcos · Obra 3720",
    lastText: "Combinado, amanhã às 8h",
    lastFromMe: true,
    lastStatus: "read",
    lastAt: ago(115),
  }),
  chat({
    id: "0198a4b2-0000-7000-8000-000000000414",
    name: "Ana Paula",
    lastKind: "audio",
    unread: 1,
    lastAt: daysAgo(1, 18, 20),
  }),
  chat({
    id: "0198a4b2-0000-7000-8000-000000000415",
    name: "Lexeer Comercial",
    lastText: "Tabela nova enviada",
    lastFromMe: true,
    lastAt: daysAgo(1, 9, 12),
  }),
  chat({
    id: "0198a4b2-0000-7000-8000-000000000416",
    name: "Dr. Mancini",
    lastKind: "image",
    agent: "person",
    lastAt: daysAgo(4, 16, 0),
  }),
];

const message = (
  id: string,
  over: Partial<WhatsAppMessage> & Pick<WhatsAppMessage, "body" | "at">,
): WhatsAppMessage => ({
  id,
  chatId: FERNANDA,
  fromMe: false,
  senderName: "Fernanda Lima",
  senderPhone: "5511999990000",
  kind: "text",
  replyToId: null,
  media: null,
  file: false,
  status: "received",
  sentByUserId: null,
  sentByAgentId: null,
  ...over,
});

const ours = { fromMe: true, status: "read" as const, sentByAgentId: ROSA };
/** Latest first, as the server sends a page. */
const MESSAGES: WhatsAppMessage[] = [
  message("m6", { body: "15h!", at: ago(1) }),
  message("m5", { ...ours, body: "Quinta temos às 10h ou às 15h. Qual fica melhor pra você?", at: ago(2) }),
  message("m4", { body: "Dá pra vir ver o banheiro na quinta?", at: ago(2) }),
  message("m3", {
    body: "",
    kind: "audio",
    file: true,
    media: { mimeType: "audio/ogg", fileName: null, seconds: 21 },
    at: ago(3),
  }),
  message("m2", {
    ...ours,
    body: "Oi, Fernanda! Fazemos sim 😊 Banheiro completo a partir de R$ 18 mil, pronto em até 15 dias.",
    at: ago(5),
  }),
  message("m1", { body: "Oi! Vi o anúncio de vocês. Fazem reforma de banheiro completo?", at: ago(5) }),
];

const ROSA_AGENT = {
  id: ROSA,
  name: "ROSA",
  handle: "rosa",
  role: "Atendimento",
  instructions: "",
  model: "",
  ownerUserId: ME,
  hasCredential: true,
  createdAt: ago(60 * 24 * 90),
  appearance: { color: "rose", eyes: "round" },
} as unknown as Agent;

/** A server that answers with the samples; anything else answers an empty list. */
function fakeApi(): ApiClient {
  const empty = (): unknown =>
    new Proxy(() => Promise.resolve([]), {
      get: (_t, k) => (k === "then" ? undefined : empty()),
      apply: () => Promise.resolve([]),
    });
  const partial = (own: Record<string, unknown>) =>
    new Proxy(own, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : empty()) });
  const own: Record<string, unknown> = {
    account: partial({
      me: async () => ({ user: { id: ME, name: "Gabriel Zim", email: "" }, organizations: [] }),
    }),
    agents: partial({ list: async () => [ROSA_AGENT], former: async () => [] }),
    orgs: partial({ members: async () => [] }),
    whatsapp: partial({
      overview: async () => ({ on: true, manage: true, accounts: ACCOUNTS }),
      chats: async () => ({ chats: CHATS, next: null }),
      messages: async (_o: string, _a: string, chatId: string) => ({
        chat: CHATS.find((c) => c.id === chatId) ?? CHATS[0],
        messages: chatId === FERNANDA ? MESSAGES : [],
        next: null,
      }),
      read: async () => ({ read: 0 }),
      typing: async () => ({ told: false }),
      stickers: async () => ({ stickers: [] }),
    }),
  };
  return partial(own) as unknown as ApiClient;
}

function Server({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG}>
          <ToastHost>
            {/* An iPhone's status bar and home bar, as the drawings have them. */}
            <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
              <View style={styles.phone}>{children}</View>
            </SafeAreaInsetsContext.Provider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export function WhatsAppLista() {
  return (
    <Server>
      <WhatsAppChatsScreen accountId={ACCOUNT} />
    </Server>
  );
}

export function WhatsAppConversa() {
  return (
    <Server>
      <WhatsAppConversationScreen accountId={ACCOUNT} chatId={FERNANDA} />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1 },
});
