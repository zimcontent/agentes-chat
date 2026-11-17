import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text as RNText, StyleSheet, View } from "react-native";
import type { AgentLookInput } from "@/agent/looks";
import { DB_FONTES } from "@/brand/tokens";
import { ProfileView, pill } from "@/features/agents/ProfileView";
import { TeamNowView } from "@/features/agents/TeamNowView";
import { Icon } from "@/ui";
import { useTheme } from "@/ui/theme";

/*
 * The agents' light screens on the board: an agent's profile and "Seu time agora", the app's own views with sample
 * values. The bar is a stand-in for the system's (the board has no navigation).
 */

const bot = (name: string, role: string): AgentLookInput => ({ color: "sky", eyes: "round", id: name, name, role });
const DOUG = bot("Doug", "Chefe do time");
const ROSA = bot("ROSA", "Design");
const SONY = bot("SONY", "Vendas");
const MARK = bot("MARK", "Marketing");
const CHESS = bot("CHESS", "Estratégia");
const KIARA = bot("KIARA", "Financeiro");
const noop = () => {};

/** The system bar's stand-in: the back button's glass plate, a title, and what goes on the right. */
function Bar({ title, right, size = 46 }: { title?: string; right?: ReactNode; size?: number }) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.bar, size < 46 ? styles.barSmall : null]}>
      <View style={[styles.round, { width: size, height: size }, pill(c)]}>
        <Icon name="back" size={22} color={c.ink} />
      </View>
      <View style={styles.title}>
        {title ? <RNText style={[styles.titleText, { color: c.ink }]}>{title}</RNText> : null}
      </View>
      {right ?? <View style={{ width: size }} />}
    </View>
  );
}

export function AgentePerfil() {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  return (
    <ProfileView
      top={47 + 56}
      face={{ look: ROSA, mode: "run" }}
      name="ROSA"
      what="Designer de apresentações"
      state={{ text: "Trabalhando · Capa da Fontes", tone: "working" }}
      actions={[
        { key: "call", icon: "handset", label: t("mobile.agentLite.call"), onPress: noop },
        { key: "tasks", icon: "checkc", label: t("mobile.agentLite.tasks"), onPress: noop },
        { key: "settings", icon: "sun", label: t("mobile.agentLite.settings"), onPress: noop },
      ]}
      uses={["Drive", "Canva", "Gmail", "Slack", "Figma", "Notion"]}
      month={{ percent: 42, text: "42%", onPress: noop }}
      reportsTo={{ look: DOUG, name: "Doug" }}
      today={[
        {
          key: "a",
          icon: "checkc",
          title: "Lâmina 20 do Investor Pool",
          sub: t("mobile.agentLite.doneAt", { time: "15:10" }),
          onPress: noop,
        },
        { key: "b", icon: "clock", title: "Capa da Fontes", sub: t("mobile.agentLite.inProgress"), onPress: noop },
      ]}
      todayEmpty=""
      talk={{ label: t("mobile.agentLite.talk"), onPress: noop }}
      header={
        <View style={styles.over}>
          <Bar
            right={
              <View style={[styles.round, pill(c)]}>
                <Icon name="more" size={20} color={c.ink} />
              </View>
            }
          />
        </View>
      }
    />
  );
}

export function TimeAgora() {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const row = (
    a: AgentLookInput,
    trade: string,
    line: string,
    sub: string,
    o: { progress?: number; waiting?: boolean; mode?: "run" | "think" | "sleep" | "idle" } = {},
  ) => ({
    key: a.id ?? "",
    look: a,
    mode: o.mode ?? "run",
    name: a.name ?? "",
    trade,
    line,
    sub,
    waiting: o.waiting ?? false,
    progress: o.progress ?? null,
    onPress: noop,
  });
  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <View style={{ height: 47 }} />
      <Bar title={t("mobile.teamNow.title")} size={40} />
      <TeamNowView
        lead={{
          look: DOUG,
          title: t("mobile.teamNow.lead", { name: "Doug", count: 5 }),
          sub: [t("mobile.teamNow.working", { count: 3 }), t("mobile.teamNow.asking", { count: 1 })].join(" · "),
        }}
        rows={[
          row(ROSA, "design", "Lâmina 21 do Investor Pool", "começou há 10 min", { progress: 0.6 }),
          row(SONY, "vendas", "Proposta da Five Rings", t("mobile.teamNow.waitsYou"), { waiting: true, mode: "think" }),
          row(MARK, "anúncios", "Relatório da semana", "começou há 25 min", { progress: 0.85 }),
          row(CHESS, "contratos", "Conferindo 2 contratos", "começou há 12 min", { progress: 0.3 }),
          row(KIARA, "atendimento", t("mobile.teamNow.stoppedF"), "volta amanhã às 8h", { mode: "sleep" }),
        ]}
        empty=""
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  over: { position: "absolute", top: 47, left: 0, right: 0 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 6 },
  round: { width: 46, height: 46, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  barSmall: { paddingHorizontal: 16 },
  title: { flex: 1, alignItems: "center" },
  titleText: { fontFamily: DB_FONTES.titulo700, fontSize: 17, lineHeight: 22 },
});
