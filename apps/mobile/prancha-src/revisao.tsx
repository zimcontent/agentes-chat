import {
  type ApiClient,
  ApiProvider,
  type VideoReview,
  type VideoReviewNote,
  type VideoReviewSummary,
} from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { type ReactNode, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { ReviewChatCards } from "@/features/review/ReviewChatCard";
import { ReviewScreen } from "@/features/review/ReviewScreen";
import { ReviewsScreen } from "@/features/review/ReviewsScreen";
import { FixedOrg } from "@/providers/org";
import { Text, ToastHost } from "@/ui";
import { useTheme } from "@/ui/theme";

/*
 * The Revisor on the board (docs/adr/doug-0007-video-review.md): the app's own screens over a fake server with sample
 * reviews, so they can be looked at in a browser. The clip and the photo are served beside the board (`public/amostra`).
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
const ME = "0198a4b2-0000-7000-8000-0000000000aa";
const AGENT = { id: "0198a4b2-0000-7000-8000-0000000000bb", name: "Editor Alliance", handle: "editor-alliance" };
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const origin = () => (Platform.OS === "web" ? window.location.origin : "");

const summary = (
  id: string,
  title: string,
  version: number,
  status: VideoReviewSummary["status"],
  min: number,
  openNotes = 0,
): VideoReviewSummary => ({
  id,
  title,
  client: "Alliance",
  status,
  version,
  artifactId: `a-${id}`,
  agent: AGENT,
  channelId: "c1",
  threadId: null,
  openNotes,
  updatedAt: at(min),
  createdAt: at(min + 300),
});

const R1 = "0198a4b2-0000-7000-8000-000000000101";
const REVIEWS: VideoReviewSummary[] = [
  summary(R1, "Daley_Krom_Real_Wealth_9x16", 3, "in_review", 12, 4),
  summary("0198a4b2-0000-7000-8000-000000000102", "Daley_Krom_Protection_Afterthought_9x16", 1, "in_review", 47),
  summary("0198a4b2-0000-7000-8000-000000000103", "Daley_Krom_Overlooked_Protection_9x16", 2, "changes", 180),
  summary("0198a4b2-0000-7000-8000-000000000104", "Melissa_Vazquez_Living_Benefits_9x16", 4, "approved", 1500),
];

const note = (n: Partial<VideoReviewNote> & Pick<VideoReviewNote, "id" | "body">): VideoReviewNote => ({
  version: 3,
  atMs: null,
  endMs: null,
  kind: null,
  x: null,
  y: null,
  attachments: [],
  voice: false,
  author: { id: ME, name: "Gabriel Zim" },
  sent: false,
  createdAt: at(5),
  ...n,
});

const REVIEW: VideoReview = {
  ...(REVIEWS[0] as VideoReviewSummary),
  brief:
    "Pergunta 2 da entrevista da Daley (real wealth), pedida pela Lê no Asana. Sem direcionamento de estilo: segui o padrão azul aprovado nos shorts da Melissa, 9:16, até 60 s.",
  links: [
    { label: "Tarefa no Asana", url: "https://app.asana.com/0/1/2" },
    { label: "Brutos no Frame.io", url: "https://next.frame.io/project/x" },
  ],
  versions: [
    { version: 1, artifactId: "v1", note: "Primeiro corte com letreiros.", light: true, createdAt: at(600) },
    {
      version: 2,
      artifactId: "v2",
      note: "Trilha mais baixa e cards de abertura novos.",
      light: true,
      createdAt: at(300),
    },
    {
      version: 3,
      artifactId: "v3",
      note: "No rocky a câmera inclina para um lado; o riser entra só no fim, 6 dB mais baixo; a cabeça aparece inteira dos 5 aos 10 s.",
      light: true,
      createdAt: at(12),
    },
  ],
  notes: [
    note({
      id: "n1",
      atMs: 1_400,
      kind: "text",
      x: 0.5,
      y: 0.78,
      body: "Legenda está cobrindo o queixo, sobe um pouco.",
    }),
    note({
      id: "n2",
      atMs: 3_200,
      endMs: 6_000,
      kind: "broll",
      x: 0.62,
      y: 0.35,
      body: "Coloca essa foto da família aqui, tela cheia com zoom lento.",
      attachments: [
        { type: "file", artifactId: "foto", name: "familia.jpg", media: "image" },
        { type: "link", url: "https://www.pexels.com/video/123/", label: "www.pexels.com" },
      ],
    }),
    note({
      id: "n3",
      atMs: 8_500,
      kind: "sound",
      voice: true,
      body: "Aqui a trilha some de repente, deixa ela descer mais devagar até o fim da frase.",
      author: { id: "u2", name: "Letícia" },
    }),
    note({ id: "n4", atMs: null, kind: "color", body: "No geral a pele está um pouco laranja, puxa para o natural." }),
  ],
  decidedBy: null,
  decidedAt: null,
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
      { me: async () => ({ user: { id: ME, name: "Gabriel Zim", email: "" }, organizations: [] }) },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : empty()) },
    ),
    videoReviews: {
      list: async () => ({ reviews: REVIEWS }),
      videoUrl: () => `${origin()}/amostra/revisao.mp4`,
      get: async (_o: string, id: string) => (id === R1 ? REVIEW : { ...REVIEW, ...REVIEWS.find((r) => r.id === id) }),
      addNote: async () => REVIEW.notes[0],
      addVoiceNote: async () => REVIEW.notes[2],
      deleteNote: async () => {},
      decide: async () => REVIEWS[0],
    },
    artifacts: new Proxy(
      {
        fileUrl: (_o: string, id: string) =>
          id === "foto" ? `${origin()}/amostra/foto.jpg` : `${origin()}/amostra/revisao.mp4`,
      },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : empty()) },
    ),
  };
  return new Proxy(own, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : empty()) }) as unknown as ApiClient;
}

function Server({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG}>
          <ToastHost>
            {/* The board has no navigator: the pushed screens' header is the status bar's room. */}
            <HeaderHeightContext.Provider value={100}>
              <View style={styles.phone}>{children}</View>
            </HeaderHeightContext.Provider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export function RevisaoLista() {
  return (
    <Server>
      <ReviewsScreen />
    </Server>
  );
}

export function RevisaoVideo() {
  return (
    <Server>
      <ReviewScreen id={R1} />
    </Server>
  );
}

function Mensagem() {
  const { colors: c } = useTheme();
  const body = `Pergunta 2 (real wealth) está no Revisor, com QA OK: https://dougbot.app/org/${ORG}/review/${R1} . Ela só vai para o Frame.io depois do Aprovar de uma pessoa.`;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={styles.chat}>
      <Text variant="callout">Editor Alliance</Text>
      <Text variant="body">{body}</Text>
      <ReviewChatCards body={body} meta={null} />
    </ScrollView>
  );
}

export function RevisaoConversa() {
  return (
    <Server>
      <Mensagem />
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1 },
  chat: { padding: 16, paddingTop: 60, gap: 8 },
});
