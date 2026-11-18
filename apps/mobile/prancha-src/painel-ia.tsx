import type {
  Agent,
  AgentBrain,
  AiAccounts,
  ApiClient,
  BrainOption,
  MachineAccount,
  Model,
  OrgSummary,
  PlanUsage,
} from "@agenteschat/client";
import { ApiProvider } from "@agenteschat/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderHeightContext } from "expo-router/react-navigation";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { DB_FONTES } from "@/brand/tokens";
import { AiAccountsScreen } from "@/features/ai/AiAccountsScreen";
import { ChangeAiSheet } from "@/features/ai/ChangeAiSheet";
import { FixedOrg } from "@/providers/org";
import { Icon, SheetSurface, Text, ToastHost, useTheme } from "@/ui";

/*
 * The Painel de IA on the board: the app's own screen and sheet over a fake server with the prototype's accounts and
 * agents, so they can be compared side by side with it in a browser.
 */

const ORG = "0198a4b2-0000-7000-8000-000000000002";
const ME = "0198a4b2-0000-7000-8000-0000000000aa";
const SUMMARY = {
  id: ORG,
  name: "Zim",
  permissions: ["manage_agents", "manage_credentials", "post"],
} as unknown as OrgSummary;

/** The next whole hour `h` from now in the reader's zone (today if still ahead, else tomorrow). */
const at = (h: number) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
};
const now = new Date().toISOString();
const usage = (five: number, week: number, resets: number): PlanUsage => ({
  windows: [
    { kind: "five_hour", usedPercent: five, resetsAt: at(resets) },
    { kind: "seven_day", usedPercent: week },
  ],
  source: "probe",
  at: now,
});
const account = (
  id: string,
  kind: MachineAccount["kind"],
  label: string,
  plan: string | null,
  owner: string,
  u: PlanUsage,
  rank: number | null,
): AiAccounts["accounts"][number] => ({
  id,
  kind,
  label,
  email: null,
  plan,
  status: "active",
  ownerId: ME,
  ownerName: owner,
  mine: true,
  usedBy: [],
  usage: u,
  provider: null,
  keyHint: null,
  shared: true,
  standInRank: rank,
  machineId: "m1",
  computer: "Mac mini",
});
const ACCOUNTS = [
  account("acc-claude", "claude_code", "Claude", "max", "Gabriel Zim", usage(62, 41, 15), null),
  account("acc-chatgpt", "codex", "ChatGPT", "pro", "Gabriel Zim", usage(88, 70, 13), 1),
  account("acc-gemini", "antigravity", "Gemini", null, "Equipe", usage(12, 9, 18), 2),
];

const model = (id: string, provider: string, label: string, price: number, tier?: Model["tier"]): Model => ({
  id,
  label,
  provider,
  inputUsdPerMTok: price,
  outputUsdPerMTok: price * 5,
  ...(tier ? { tier } : {}),
});
const MODELS: Model[] = [
  model("claude-opus-5-5", "anthropic", "Claude Opus 5.5", 4, "large"),
  model("claude-sonnet-5-5", "anthropic", "Claude Sonnet 5.5", 2, "medium"),
  model("claude-haiku-5-5", "anthropic", "Claude Haiku 5.5", 0.1, "small"),
  model("gpt-6-astra", "openai", "GPT-6 Astra", 10),
  model("gpt-6.1-sol", "openai", "GPT-6.1 Sol", 2, "medium"),
  model("gpt-6-luna", "openai", "GPT-6 Luna", 0.1, "small"),
  model("gemini-4-argon", "gemini", "Gemini 4 Argon", 4, "large"),
  model("gemini-3.8-flash", "gemini", "Gemini 3.8 Flash", 1.5, "medium"),
];
const OPTIONS: BrainOption[] = [
  {
    kind: "claude_code",
    available: true,
    models: [
      { value: "opus", label: "Opus 5.5", modelId: "claude-opus-5-5" },
      { value: "sonnet", label: "Sonnet 5.5", modelId: "claude-sonnet-5-5", recommended: true },
      { value: "haiku", label: "Haiku 5.5", modelId: "claude-haiku-5-5" },
    ],
    defaultModel: "sonnet",
  },
  {
    kind: "codex",
    available: true,
    models: [
      { value: "gpt-6-astra", label: "GPT-6 Astra", modelId: "gpt-6-astra" },
      { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", modelId: "gpt-6.1-sol", recommended: true },
      { value: "gpt-6-luna", label: "GPT-6 Luna", modelId: "gpt-6-luna" },
    ],
    defaultModel: "gpt-6.1-sol",
  },
  {
    kind: "antigravity",
    available: true,
    models: [
      { value: "gemini-4-argon", label: "Gemini 4 Argon", modelId: "gemini-4-argon" },
      { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", modelId: "gemini-3.8-flash" },
    ],
    defaultModel: null,
  },
];

let order = 0;
const agent = (name: string, role: string, brain: Agent["brain"], builtin?: "right_hand"): Agent =>
  ({
    id: `agent-${++order}`,
    name,
    handle: name.toLowerCase(),
    role,
    instructions: "",
    model: "auto",
    ownerUserId: ME,
    hasCredential: false,
    createdAt: now,
    brain,
    ...(builtin ? { builtin } : {}),
  }) as Agent;
const AGENTS: Agent[] = [
  agent("Doug", "coordena o time", { kind: "claude_code", model: "Opus 5.5" }, "right_hand"),
  agent("ROSA", "apresentações", { kind: "claude_code", model: "Opus 5.5", account: "Claude Max" }),
  agent("SONY", "comercial", { kind: "codex", model: "GPT-5" }),
  agent("JUNIN", "redes sociais", { kind: "antigravity", model: "Gemini 3 Pro" }),
  agent("CHESS", "contratos", { kind: "grok", model: "Grok 5" }),
  agent("Assistente de Atendimento ao Cliente", "responde os clientes no WhatsApp e no e-mail o dia inteiro", {
    kind: "claude_code",
    model: "DeepSeek V4.1 Flash Ultrafast",
    provider: "opencode",
  }),
];
const ROSA = AGENTS[1] as Agent;

const BRAIN: AgentBrain = {
  agentId: ROSA.id,
  brain: "claude_code",
  model: "opus",
  effectiveModel: "opus",
  fallback: false,
  extraUsage: false,
  computer: { machineId: "m1", name: "Mac mini", online: true },
  options: OPTIONS,
  machines: [],
  canEdit: true,
  account: "acc-claude",
  effort: null,
  speed: "standard",
  accounts: ACCOUNTS,
  canManageAccounts: true,
  accountsSupported: true,
  onlyOwner: false,
  canUsePlans: true,
  canUseOthersPlans: true,
  ownSignIn: false,
  ownUsage: {},
  keys: [],
};

const AI: AiAccounts = {
  accounts: ACCOUNTS,
  computers: [
    {
      machineId: "m1",
      name: "Mac mini",
      online: true,
      mine: true,
      canAdd: true,
      keys: true,
      brains: { claude_code: true, codex: true, antigravity: true },
    },
  ],
};

/** A server that answers with the samples; anything else answers an empty list. */
function fakeApi(): ApiClient {
  const empty = (): unknown =>
    new Proxy(() => Promise.resolve([]), {
      get: (_t, k) => (k === "then" ? undefined : empty()),
      apply: () => Promise.resolve([]),
    });
  const part = (own: Record<string, unknown>) =>
    new Proxy(own, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : empty()) });
  const own: Record<string, unknown> = {
    account: part({ me: async () => ({ user: { id: ME, name: "Gabriel Zim" }, organizations: [] }) }),
    agents: part({
      list: async () => AGENTS,
      former: async () => [],
      models: async () => ({ models: MODELS, defaultModel: "auto" }),
      brain: async () => BRAIN,
      credentials: async () => [],
      platformKeyAvailable: async () => false,
      aiStatus: async () => ({ agents: [], hasAi: true }),
    }),
    orgs: part({
      members: async () => [
        {
          userId: ME,
          name: "Gabriel Zim",
          email: "",
          image: null,
          role: "owner",
          joinedAt: now,
          handle: "gabriel",
          timezone: "America/Sao_Paulo",
        },
      ],
    }),
    machines: part({
      aiAccounts: async () => AI,
      list: async () => [],
      refreshAccountUsage: async () => undefined,
    }),
  };
  return part(own) as unknown as ApiClient;
}

function Server({ children, width = 390 }: { children: ReactNode; width?: number }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [api] = useState(fakeApi);
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider client={api}>
        <FixedOrg orgId={ORG} org={SUMMARY}>
          <ToastHost>
            <HeaderHeightContext.Provider value={100}>
              <View style={[styles.phone, { width, maxWidth: "100%" }]}>{children}</View>
            </HeaderHeightContext.Provider>
          </ToastHost>
        </FixedOrg>
      </ApiProvider>
    </QueryClientProvider>
  );
}

/** The native bar the app draws over the screen (the board has none): back, the title, "+". */
function Bar() {
  const { colors } = useTheme();
  const round = [styles.round, { backgroundColor: colors.plate, borderColor: colors.glassEdge }];
  return (
    <View style={styles.bar}>
      <View style={round}>
        <Icon name="left" size={20} color={colors.ink} />
      </View>
      <Text variant="title" tone="ink" style={styles.barTitle}>
        Painel de IA
      </Text>
      <View style={round}>
        <Icon name="plus" size={20} color={colors.ink} />
      </View>
    </View>
  );
}

export function PainelIa({ width }: { width?: number } = {}) {
  const { colors } = useTheme();
  return (
    <Server {...(width ? { width } : {})}>
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <View style={styles.status} />
        <Bar />
        <AiAccountsScreen />
      </View>
    </Server>
  );
}

/** The worst case at the narrowest phone: long names, roles and models. */
export const PainelIa320 = () => <PainelIa width={320} />;
export const PainelIaFolha320 = () => <PainelIaFolha width={320} />;

export function PainelIaFolha({ width }: { width?: number } = {}) {
  const { colors } = useTheme();
  return (
    <Server {...(width ? { width } : {})}>
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <View style={styles.status} />
        <View style={styles.behind}>
          <Bar />
        </View>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
        <View style={styles.sheet}>
          <SheetSurface>
            <SheetBody>
              <ChangeAiSheet agentId={ROSA.id} onClose={() => undefined} initialIntent="balanced" />
            </SheetBody>
          </SheetSurface>
        </View>
      </View>
    </Server>
  );
}

/** The native sheet's own surface and grabber, which the system draws in the app. */
function SheetBody({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sheetFace, { backgroundColor: colors.bg }]}>
      <View style={[styles.grabber, { backgroundColor: colors.grabber }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, overflow: "hidden" },
  fill: { flex: 1 },
  status: { height: 47 },
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginTop: 6, height: 40 },
  barTitle: { flex: 1, textAlign: "center", fontFamily: DB_FONTES.titulo700, fontWeight: "700", fontSize: 17 },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  behind: { opacity: 0.3 },
  sheet: { position: "absolute", left: 8, right: 8, bottom: 8 },
  sheetFace: { borderRadius: 38, overflow: "hidden", paddingTop: 10, marginBottom: -6 },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginBottom: -12 },
});
