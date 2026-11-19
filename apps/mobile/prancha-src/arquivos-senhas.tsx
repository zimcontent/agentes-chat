import type {
  Agent,
  ApiClient,
  Artifact,
  ArtifactAuthor,
  ArtifactDetail,
  Member,
  VaultItem,
  VaultItemDetail,
  VaultOverview,
} from "@dougbot/client";
import { ApiProvider } from "@dougbot/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { DriveScreen } from "@/features/drive/DriveScreen";
import { useVaultFavorites, useVaultLook } from "@/features/vault/look";
import { VaultScreen } from "@/features/vault/VaultScreen";
import { ItemSheet } from "@/features/vault/VaultSheet";
import { FixedOrg } from "@/providers/org";
import { ToastHost } from "@/ui";

/*
 * Arquivos and Senhas on the board: the app's own screens over a fake server with the prototypes' samples, so they can
 * be compared with them in a browser. The suggested slide's picture is served beside the board (`amostra/fontes.png`).
 */

const ORG = "0198a4b2-0000-7000-8000-000000000001";
const ME = "0198a4b2-0000-7000-8000-0000000000aa";
const ROSA = "0198a4b2-0000-7000-8000-0000000000cc";
const SONY = "0198a4b2-0000-7000-8000-0000000000dd";
const EDITOR = "0198a4b2-0000-7000-8000-0000000000bb";
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const origin = () => (Platform.OS === "web" ? window.location.origin : "");
const person = (id: string): ArtifactAuthor => ({ type: "person", id });
const agent = (id: string): ArtifactAuthor => ({ type: "agent", id });

const agentOf = (id: string, name: string, color: string): Agent =>
  ({
    id,
    name,
    handle: name.toLowerCase().replace(/\W+/g, "-"),
    role: "",
    instructions: "",
    model: "",
    ownerUserId: ME,
    hasCredential: true,
    createdAt: at(99_999),
    appearance: { color, eyes: "round" },
  }) as Agent;
const AGENTS = [
  agentOf(ROSA, "ROSA", "pink"),
  agentOf(SONY, "SONY", "sky"),
  agentOf(EDITOR, "Editor Alliance", "lime"),
];
const MEMBERS: Member[] = [
  {
    userId: ME,
    name: "Gabriel",
    email: "",
    image: null,
    role: "owner",
    joinedAt: at(99_999),
    handle: "gabriel",
    timezone: "America/Sao_Paulo",
  },
];

const file = (
  id: string,
  kind: Artifact["kind"],
  title: string,
  min: number,
  by: ArtifactAuthor,
  version: number,
  channel: { id: string; name: string } | null = null,
): Artifact => ({
  id,
  kind,
  title,
  version,
  channelId: channel?.id ?? null,
  threadId: null,
  createdBy: by,
  updatedBy: by,
  createdAt: at(min + 600),
  updatedAt: at(min),
  canEdit: true,
  untrusted: false,
  audience: channel ? { kind: "channel", name: channel.name, private: false } : { kind: "workspace" },
});
const LEXEER = { id: "c-lexeer", name: "Lexeer" };
const BRUTOS = { id: "c-brutos", name: "Five Rings · Brutos" };
const FILES: Artifact[] = [
  file("f-capa", "file", "Capa da Fontes.pptx", 8, agent(ROSA), 2),
  file("f-orc", "table", "Orçamento obra 3720", 20, person(ME), 3),
  file("f-rot", "document", "Roteiro Five Rings v2", 60, agent(ROSA), 2),
  file("f-inv", "html", "Investor Pool · novembro", 180, agent(ROSA), 4),
  file("f-pro", "file", "Proposta v3 Five Rings.pdf", 220, agent(SONY), 1),
  file("f-tab", "file", "Tabela de preços.pdf", 7_400, person(ME), 1, LEXEER),
  file("f-vid", "file", "Vídeo bruto 01.mp4", 90, agent(EDITOR), 1, BRUTOS),
];
const ROWS = [
  ["Item", "Qtd", "Valor"],
  ["Porcelanato", "42 m²", "R$ 5.880"],
  ["Argamassa", "18 sc", "R$ 702"],
  ["Mão de obra", "1", "R$ 4.200"],
  ["Rodapé", "30 m", "R$ 960"],
];
const detail = (id: string): ArtifactDetail => {
  const a = FILES.find((f) => f.id === id) ?? (FILES[0] as Artifact);
  const content: ArtifactDetail["content"] =
    a.kind === "table"
      ? { kind: "table", columns: ROWS[0] as string[], rows: ROWS.slice(1) }
      : a.kind === "document"
        ? {
            kind: "document",
            markdown: "# Roteiro\nAbertura com a fachada.\nEntrevista com o mestre.\nTreino ao pôr do sol.",
          }
        : a.id === "f-capa"
          ? ({ kind: "file", name: "capa.png", contentType: "image/png", size: 120_000, sha256: "" } as never)
          : { kind: "html", html: "<p></p>" };
  return { ...a, shownVersion: a.version, content } as ArtifactDetail;
};

// ── Vault ──
const login = (n: number, title: string, website: string, username: string): VaultItem => ({
  id: `v-${n}`,
  kind: "login",
  scope: "team",
  ownerUserId: null,
  title,
  description: "",
  website,
  match: "exact",
  username,
  keyName: null,
  keyHint: null,
  hasSecret: true,
  contact: null,
  connectionId: null,
  sourceName: null,
  accessFromConnection: false,
  access: { everyone: false, roleIds: [], userIds: [ME], allAgents: false, agentIds: [ROSA] },
  missing: false,
  createdByUserId: ME,
  createdByAgentId: null,
  lastUsedAt: at(120),
  createdAt: at(9_999),
  updatedAt: at(9_999),
  can: { edit: true, delete: true },
});
const SITES = ["github.com", "notion.so", "figma.com", "canva.com", "meta.com", "google.com", "frame.io", "vimeo.com"];
const ITEMS: VaultItem[] = [
  login(0, "Instagram da Lexeer", "https://instagram.com", "@lexeer.reformas"),
  ...Array.from({ length: 29 }, (_, i) =>
    login(i + 1, `Conta ${i + 1}`, `https://${SITES[i % SITES.length]}`, "time@lexeer.com"),
  ),
  ...Array.from({ length: 8 }, (_, i) => ({
    ...login(100 + i, `Chave ${i + 1}`, "", ""),
    kind: "key" as const,
    website: null,
    username: null,
    keyName: `API_KEY_${i + 1}`,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    ...login(200 + i, `Contato ${i + 1}`, "", ""),
    kind: "contact" as const,
    website: null,
    username: null,
    hasSecret: false,
  })),
];
const OVERVIEW: VaultOverview = { items: ITEMS, connections: [], sources: [], canManageTeam: true };
const INSTAGRAM: VaultItemDetail = {
  ...(ITEMS[0] as VaultItem),
  uses: [
    {
      id: "u1",
      action: "fill",
      agentId: ROSA,
      userId: null,
      onBehalfOfUserId: ME,
      routineName: null,
      origin: "https://instagram.com",
      at: at(120),
    },
  ],
  unreadable: false,
};

/** A server that answers with the samples; anything else answers an empty list. */
function fakeApi(): ApiClient {
  const empty = (): unknown =>
    new Proxy(() => Promise.resolve([]), {
      get: (_t, k) => (k === "then" ? undefined : empty()),
      apply: () => Promise.resolve([]),
    });
  const part = (o: Record<string, unknown>) =>
    new Proxy(o, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : empty()) });
  const own: Record<string, unknown> = {
    account: part({ me: async () => ({ user: { id: ME, name: "Gabriel", email: "" }, organizations: [] }) }),
    orgs: part({ members: async () => MEMBERS }),
    agents: part({ list: async () => AGENTS }),
    roles: part({ list: async () => ({ roles: [] }) }),
    artifacts: part({
      page: async () => ({ artifacts: FILES, nextCursor: null }),
      get: async (_o: string, id: string) => detail(id),
      download: async () => ({ url: `${origin()}/amostra/fontes.png` }),
    }),
    vault: part({ overview: async () => OVERVIEW, item: async () => INSTAGRAM }),
  };
  return new Proxy(own, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : empty()) }) as unknown as ApiClient;
}

function Server({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg
          orgId={ORG}
          org={{ id: ORG, name: "Lexeer", role: "owner", permissions: ["upload_files", "read"] } as never}
        >
          <ToastHost>
            {/* The phone's status bar and home bar, as the prototypes draw them. */}
            <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
              <View style={styles.phone}>{children}</View>
            </SafeAreaInsetsContext.Provider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

/** Five starred items, as a person would have on their phone. */
let seeded = false;
function Starred() {
  const favorites = useVaultFavorites(ORG);
  useEffect(() => {
    if (seeded) return;
    seeded = true;
    for (const n of [0, 1, 2, 3, 100]) favorites.toggle(`v-${n}`);
  }, [favorites]);
  return null;
}

export function Arquivos() {
  return (
    <Server>
      <DriveScreen />
    </Server>
  );
}

export function Senhas() {
  return (
    <Server>
      <Starred />
      <VaultScreen />
    </Server>
  );
}

export function SenhasLogins() {
  return (
    <Server>
      <Starred />
      <VaultScreen start="login" />
    </Server>
  );
}

function Sheet({ children }: { children: ReactNode }) {
  const look = useVaultLook();
  return (
    <View style={[styles.sheet, { backgroundColor: look.sheet }]}>
      <View style={styles.grabber} />
      {children}
    </View>
  );
}

/** The item's sheet over Senhas, as the phone presents it (the system draws the real sheet). */
export function SenhasItem() {
  return (
    <Server>
      <Starred />
      <VaultScreen />
      <View style={styles.scrim} />
      <Sheet>
        <ItemSheet item={INSTAGRAM} />
      </Sheet>
    </Server>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    paddingBottom: 18,
  },
  grabber: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(128,128,128,0.4)",
    zIndex: 1,
  },
});
