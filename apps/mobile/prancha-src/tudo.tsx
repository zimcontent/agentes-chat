import { StyleSheet, View } from "react-native";
import { AllSheetView, type PillSection, type ToolShown } from "@/features/chats/AllSheet";
import { type ToolKey, toolsHere } from "@/features/chats/all-tools";
import { SheetTitle } from "@/features/shared/PromptForm";
import { ActionList } from "@/features/shared/parts";
import { QuickTiles } from "@/features/shared/QuickTiles";
import { AgentAvatar, Glass, useTheme } from "@/ui";
import { Inicio } from "./telas";

/** The labels and what waits, as a busy team's phone has them (Agenda on, as it will be). */
const LABELS: Record<ToolKey, string> = {
  whatsapp: "WhatsApp",
  calendar: "Agenda",
  media: "Mídia",
  search: "Buscar",
  proposals: "Propostas",
  issues: "Tarefas",
  review: "Revisão",
  portal: "Portal",
  team: "Agentes",
  routines: "Rotinas",
  dashboards: "Painéis",
  wiki: "Wiki",
  drive: "Drive",
  vault: "Cofre",
  computer: "Computador",
  people: "Pessoas",
  settings: "Ajustes",
};
const COUNTS: Partial<Record<ToolKey, number>> = { whatsapp: 4, issues: 5, review: 8 };
const TOOLS: ToolShown[] = toolsHere({
  whatsapp: true,
  media: true,
  portal: true,
  calendar: true,
  member: true,
  hidden: [],
}).map((tool) => ({ ...tool, label: LABELS[tool.key], count: COUNTS[tool.key] ?? 0 }));
const PINS: ToolKey[] = ["whatsapp", "calendar", "proposals", "issues"];

const noop = () => {};
const CONVERSATION: PillSection[] = [
  {
    title: "Nesta conversa",
    pills: [
      { key: "media", icon: "sticker", label: "GIFs", onPress: noop },
      { key: "mission", icon: "target", label: "Missão", onPress: noop },
      { key: "summary", icon: "sparkle", label: "Resumo", onPress: noop },
      { key: "remind", icon: "clock", label: "Lembrete", onPress: noop },
    ],
  },
  {
    title: "Anexar na conversa",
    pills: [
      { key: "photos", icon: "image", label: "Fotos", onPress: noop },
      { key: "camera", icon: "camera", label: "Câmera", onPress: noop },
      { key: "file", icon: "file", label: "Arquivo", onPress: noop },
    ],
  },
];
const CREATE: PillSection[] = [
  {
    title: "Criar",
    pills: [
      { key: "new", icon: "compose", label: "Nova conversa", onPress: noop },
      { key: "new-agent", icon: "plus", label: "Novo agente", onPress: noop },
    ],
  },
];

/** "Tudo" over Início, as the sheet opens: from a conversation's "+", from Início's "Mais", or editing the pins. */
export function Tudo({ from, editing = false }: { from: "conversation" | "home"; editing?: boolean }) {
  const { colors, shadows } = useTheme();
  return (
    <Inicio
      // `over` is drawn on the scrolled frame: Início at its top.
      scrolledBy={0}
      over={
        <View style={StyleSheet.absoluteFill}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
          <View style={[styles.sheet, { boxShadow: shadows.e3 }]}>
            <Glass intensity={70} style={styles.surface}>
              <View style={styles.grab}>
                <View style={[styles.grabBar, { backgroundColor: colors.grabber }]} />
              </View>
              <View style={styles.in}>
                <AllSheetView
                  tools={TOOLS}
                  pins={PINS}
                  editing={editing}
                  onEdit={noop}
                  onTool={noop}
                  onSearch={noop}
                  sections={from === "conversation" ? CONVERSATION : CREATE}
                />
              </View>
            </Glass>
          </View>
        </View>
      }
    />
  );
}

/** The conversation's "…" over its DM (`ChannelOptions`): who it is, the quick tiles, the rest as a list. */
export function ConversaOpcoes() {
  const { colors, shadows } = useTheme();
  const doug = { color: "sky", eyes: "round", id: "Doug BOSS", name: "Doug BOSS", role: "Chefe do time" } as const;
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
      <View style={[styles.sheet, { boxShadow: shadows.e3 }]}>
        <Glass intensity={70} style={styles.surface}>
          <View style={styles.grab}>
            <View style={[styles.grabBar, { backgroundColor: colors.grabber }]} />
          </View>
          <View style={[styles.in, { gap: 16 }]}>
            <SheetTitle
              leading={<AgentAvatar agent={doug} size={36} />}
              title="Doug BOSS"
              subtitle="Chefe do time · disponível"
            />
            <QuickTiles
              items={[
                { key: "call", icon: "handset", label: "Ligar", accent: true, onPress: noop },
                { key: "search", icon: "search", label: "Buscar", onPress: noop },
                { key: "pins", icon: "pin", label: "Fixadas", count: 3, onPress: noop },
                {
                  key: "profile",
                  leading: <AgentAvatar agent={doug} size={26} />,
                  label: "Perfil",
                  onPress: noop,
                },
              ]}
            />
            <ActionList
              items={[{ key: "category", icon: "list", label: "Categoria", hint: "Sem categoria", onPress: noop }]}
            />
          </View>
        </Glass>
      </View>
    </View>
  );
}

// The app's `Sheet`: 8 from the edges, 34 round, the grabber's strip, 18 inside.
const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 8, right: 8, bottom: 8, borderRadius: 34 },
  surface: { borderRadius: 34, overflow: "hidden" },
  grab: { alignItems: "center", paddingTop: 12, paddingBottom: 10 },
  grabBar: { width: 36, height: 5, borderRadius: 2.5 },
  in: { paddingHorizontal: 18, paddingBottom: 24 },
});
