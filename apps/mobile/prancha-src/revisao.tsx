import {
  type ApiClient,
  ApiProvider,
  type VideoReview,
  type VideoReviewNote,
  type VideoReviewSummary,
} from "@dougbot/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { type ReactNode, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { DesignEditor } from "@/features/review/DesignEditor";
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
  medium: "video",
  title,
  client: "Alliance",
  status,
  version,
  artifactId: `a-${id}`,
  cover: null,
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
  // An editor's own deliveries from a task (docs/adr/doug-0012-editor-delivery.md): Revisão gives them a tab.
  {
    ...summary("0198a4b2-0000-7000-8000-000000000105", "Built_to_Endure_Ep12_Corte1", 2, "in_review", 25, 2),
    agent: null,
    sender: { id: "0198a4b2-0000-7000-8000-0000000000dd", name: "Ronny Alves" },
    client: "Built to Endure",
  },
  {
    ...summary("0198a4b2-0000-7000-8000-000000000106", "Built_to_Endure_Ep12_Corte2", 1, "in_review", 70),
    agent: null,
    sender: { id: "0198a4b2-0000-7000-8000-0000000000dd", name: "Ronny Alves" },
    client: "Built to Endure",
  },
];

const note = (n: Partial<VideoReviewNote> & Pick<VideoReviewNote, "id" | "body">): VideoReviewNote => ({
  version: 3,
  atMs: null,
  endMs: null,
  page: null,
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
    {
      version: 1,
      artifactId: "v1",
      note: "Primeiro corte com letreiros.",
      light: true,
      pages: [],
      source: false,
      editedBy: null,
      createdAt: at(600),
    },
    {
      version: 2,
      artifactId: "v2",
      note: "Trilha mais baixa e cards de abertura novos.",
      light: true,
      pages: [],
      source: false,
      editedBy: null,
      createdAt: at(300),
    },
    {
      version: 3,
      artifactId: "v3",
      note: "No rocky a câmera inclina para um lado; o riser entra só no fim, 6 dB mais baixo; a cabeça aparece inteira dos 5 aos 10 s.",
      light: true,
      pages: [],
      source: false,
      editedBy: null,
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

// A design piece (docs/adr/doug-0010-design-review.md): a carousel's slides and its page, served beside the board
// (`public/amostra/design/v1/pages/<n>` and `…/v1/source`).
const ROSA = { id: "0198a4b2-0000-7000-8000-0000000000cc", name: "ROSA", handle: "rosa" };
const DESIGN_ID = "0198a4b2-0000-7000-8000-000000000201";
const DESIGN_SUMMARY: VideoReviewSummary = {
  ...summary(DESIGN_ID, "Carrossel venda 1015 N Glenwood", 1, "in_review", 3, 3),
  medium: "design",
  client: "Lexeer",
  artifactId: "p1",
  cover: "capa",
  agent: ROSA,
};
REVIEWS.unshift(DESIGN_SUMMARY);
const DESIGN: VideoReview = {
  ...DESIGN_SUMMARY,
  brief: "Carrossel de venda da casa da Glenwood, 4 lâminas, identidade LXR. Copy aprovada em inglês pela Letícia.",
  links: [{ label: "Post no portal", url: "https://mydoug.io/portal" }],
  versions: [
    {
      version: 1,
      artifactId: "p1",
      note: "Primeira versão, vidro com o título sobre a foto da entrada.",
      light: false,
      pages: ["p1", "p2", "p3", "p4"],
      source: true,
      editedBy: null,
      createdAt: at(3),
    },
  ],
  notes: [
    note({
      id: "d1",
      version: 1,
      page: 1,
      x: 0.78,
      y: 0.6,
      kind: "image",
      body: "Esse vidro está tapando todo o detalhe da casa, reposicione a imagem.",
    }),
    note({
      id: "d2",
      version: 1,
      page: 1,
      x: 0.3,
      y: 0.24,
      kind: "type",
      voice: true,
      body: "O last detail pode ficar um pouco maior.",
      author: { id: "u2", name: "Letícia" },
    }),
    note({
      id: "d3",
      version: 1,
      page: 2,
      x: 0.76,
      y: 0.24,
      kind: "layout",
      body: "Nada de quadrado, foto em tela cheia.",
    }),
    note({ id: "d4", version: 1, page: null, kind: "color", body: "Paleta ótima, mantém o tom quente em todas." }),
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
      pageUrl: (_o: string, _r: string, v: number, n: number) => `${origin()}/amostra/design/v${v}/pages/${n}`,
      get: async (_o: string, id: string) =>
        id === DESIGN_ID ? DESIGN : id === R1 ? REVIEW : { ...REVIEW, ...REVIEWS.find((r) => r.id === id) },
      addNote: async () => REVIEW.notes[0],
      addVoiceNote: async () => REVIEW.notes[2],
      deleteNote: async () => {},
      decide: async () => REVIEWS[0],
    },
    artifacts: new Proxy(
      {
        fileUrl: (_o: string, id: string) =>
          id === "foto"
            ? `${origin()}/amostra/foto.jpg`
            : id === "capa"
              ? `${origin()}/amostra/design/capa.png`
              : `${origin()}/amostra/revisao.mp4`,
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

export function RevisaoDesign() {
  return (
    <Server>
      <ReviewScreen id={DESIGN_ID} />
    </Server>
  );
}

export function RevisaoDesignEditor() {
  return (
    <Server>
      <DesignEditor id={DESIGN_ID} version={1} />
    </Server>
  );
}

function MensagemDesign() {
  const { colors: c } = useTheme();
  const body = `Arte pronta para revisão: https://dougbot.app/org/${ORG}/review/${DESIGN_ID}`;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={styles.chat}>
      <Text variant="callout">ROSA</Text>
      <Text variant="body">{body}</Text>
      <ReviewChatCards body={body} meta={null} />
    </ScrollView>
  );
}

export function RevisaoDesignConversa() {
  return (
    <Server>
      <MensagemDesign />
    </Server>
  );
}
