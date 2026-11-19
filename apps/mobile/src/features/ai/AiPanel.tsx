import type { Agent, Model } from "@dougbot/client";
import {
  type AccountBar,
  type AccountCard,
  type AccountStanding,
  agentModelChip,
  renewsWhen,
} from "@dougbot/client/lib/ai-panel";
import { agentThinks } from "@dougbot/client/lib/brain";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { DB_FONTES } from "@/brand/tokens";
import { Icon, PressScale, ProviderLogo, Text, useTheme } from "@/ui";
import { AgentFace } from "../shared/Face";

/*
 * The Painel de IA's pieces (the mock's "Suas contas" and "Quem usa o quê"): an account as a card with its maker's
 * mark, whose it is, how it stands and two bars, and each agent as a row with what it does and a chip with the
 * maker's mark and the model it thinks with. The screen (`AiAccountsScreen`) wires them to the data and the sheet.
 */

/** A section's heading over its cards, on the cards' inner edge. */
export function PanelHeading({ children }: { children: string }) {
  return (
    <Text variant="footnote" tone="muted" style={[styles.heading, styles.semibold]} accessibilityRole="header">
      {children}
    </Text>
  );
}

const STANDING_WORD: Record<AccountStanding, string> = {
  ok: "mobile.aiPanel.ok",
  almost: "mobile.aiPanel.almost",
  limited: "mobile.aiPanel.limited",
  signed_out: "mobile.aiPanel.signedOut",
};

/** How a card's pill and first bar are colored: amber near or at the limit. */
const warns = (s: AccountStanding) => s === "almost" || s === "limited";

/** A bar's words: when the limit renews ("Limite renova às 15h"), else the window's name; its use on the right. */
function barLabel(t: TFunction, locale: string, bar: AccountBar) {
  const when = renewsWhen(locale, bar);
  if (when) return when.day ? t("mobile.aiPanel.renewsOn", when) : t("mobile.aiPanel.renews", { hour: when.hour });
  if (bar.window === "seven_day") return t("mobile.aiPanel.week");
  if (bar.window === "monthly") return t("mobile.aiPanel.month");
  return t(`aiAccounts.usage.window.${bar.window}`);
}

/** One account: its mark, name and owner, how it stands, the window that renews first and the week. */
export function AccountCardView({
  card,
  where,
  onPress,
}: {
  card: AccountCard;
  /** The computer it is on, where the person has accounts on more than one. */
  where?: string | undefined;
  onPress?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const warn = warns(card.standing);
  const amber = colors.amberInk;
  const body = (
    <View style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.line }]}>
      <View style={styles.cardHead}>
        <ProviderLogo id={card.mark} size="mark" off={card.standing === "signed_out"} />
        <View style={styles.grow}>
          <Text variant="subhead" tone="ink" style={[styles.semibold, styles.tight17]} numberOfLines={1}>
            {card.title}
          </Text>
          {card.owner || where ? (
            <Text variant="caption" tone="muted" style={styles.owner} numberOfLines={1}>
              {[card.owner ? t("mobile.aiPanel.of", { name: card.owner }) : null, where].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.pill,
            warn
              ? { backgroundColor: colors.warnSoft, borderColor: withAlphaOf(amber, 0.3) }
              : { backgroundColor: colors.raised2, borderColor: colors.line },
          ]}
        >
          <Text variant="caption" style={[styles.medium, { color: warn ? amber : colors.ink2 }]} numberOfLines={1}>
            {t(STANDING_WORD[card.standing])}
          </Text>
        </View>
      </View>
      {card.main ? (
        <>
          <View style={styles.meterLine}>
            <Text variant="caption" tone="muted" style={[styles.medium, styles.tight15, styles.grow]} numberOfLines={1}>
              {barLabel(t, i18n.language, card.main)}
            </Text>
            <Text
              variant="caption"
              style={[styles.medium, styles.tight15, styles.num, { color: warn ? amber : colors.muted }]}
            >
              {`${card.main.used}%`}
            </Text>
          </View>
          <Bar used={card.main.used} color={warn ? amber : colors.ink} thick />
        </>
      ) : (
        <Text variant="caption" tone="muted" style={styles.meterLine}>
          {t("usageViews.noWindows")}
        </Text>
      )}
      {card.week ? (
        <>
          <View style={styles.meterLine}>
            <Text variant="caption" tone="muted" style={[styles.medium, styles.tight15, styles.grow]}>
              {t("mobile.aiPanel.week")}
            </Text>
            <Text variant="caption" tone="muted" style={[styles.medium, styles.tight15, styles.num]}>
              {`${card.week.used}%`}
            </Text>
          </View>
          <Bar used={card.week.used} color={colors.muted} />
        </>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={card.title}>
      {body}
    </PressScale>
  );
}

/** `#rrggbb` at `alpha`, for an edge in the pill's own color. */
const withAlphaOf = (hex: string, alpha: number) =>
  hex.startsWith("#") && hex.length === 7
    ? `${hex}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0")}`
    : hex;

/** A usage bar: 6 tall for the window that renews first, 4 for the week. */
function Bar({ used, color, thick = false }: { used: number; color: string; thick?: boolean }) {
  const { colors } = useTheme();
  const h = thick ? 6 : 4;
  return (
    <View style={[styles.track, { height: h, backgroundColor: colors.plate }]}>
      <View
        style={{ width: `${Math.min(100, Math.max(0, used))}%`, height: h, borderRadius: h, backgroundColor: color }}
      />
    </View>
  );
}

/** "Quem usa o quê": each agent with what it does and the model it thinks with, a tap to change it. */
export function UsesList({
  agents,
  models,
  onAgent,
}: {
  agents: readonly Agent[];
  models: readonly Model[];
  /** Null: the viewer can't change this one (the row only reads). */
  onAgent: (agent: Agent) => (() => void) | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.uses, { backgroundColor: colors.raised, borderColor: colors.line }]}>
      {agents.map((a, i) => (
        <UseRow key={a.id} agent={a} models={models} first={i === 0} onPress={onAgent(a)} />
      ))}
    </View>
  );
}

/** One agent of "Quem usa o quê": its face, name and what it does, the chip with its model, a chevron when it opens. */
function UseRow({
  agent: a,
  models,
  first,
  onPress,
}: {
  agent: Agent;
  models: readonly Model[];
  first: boolean;
  onPress: (() => void) | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const mark = agentThinks(t, a, { models }).mark;
  const chip = agentModelChip(a, models, t("brain.auto.label"));
  const row = (
    <View
      style={[styles.useRow, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }]}
    >
      <AgentFace agentId={a.id} size={36} live={false} />
      {/* Who it is and the chip share a line while both fit; else the chip goes under, never cutting the words. */}
      <View style={styles.useBody}>
        <View style={styles.useText}>
          <Text variant="subhead" tone="ink" style={styles.name} numberOfLines={2}>
            {a.name}
          </Text>
          {a.role ? (
            <Text variant="footnote" tone="muted" numberOfLines={2}>
              {a.role}
            </Text>
          ) : null}
        </View>
        <View style={[styles.chip, { backgroundColor: colors.raised2, borderColor: colors.line }]}>
          {mark ? <ProviderLogo id={mark} size="xs" /> : null}
          <Text variant="footnote" tone="ink" style={[styles.medium, styles.shrink]} numberOfLines={1}>
            {chip}
          </Text>
        </View>
      </View>
      {onPress ? <Icon name="right" size={15} color={colors.muted} /> : <View style={styles.noChevron} />}
    </View>
  );
  return onPress ? (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${a.name}, ${chip}`}>
      {row}
    </PressScale>
  ) : (
    row
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  // The card's lines as tight as the prototype's: a name over its owner, a meter's words over its bar.
  tight17: { lineHeight: 17 },
  tight15: { lineHeight: 14.5 },
  owner: { lineHeight: 18 },
  // Names in the identity's title face, as the mock sets them.
  name: { fontFamily: DB_FONTES.titulo700, fontWeight: "700" },
  heading: { paddingTop: 16, paddingBottom: 8, paddingHorizontal: 6, lineHeight: 16 },
  // 12 × 14 inside, its 1 pt edge counted in: the prototype draws the edge inside the box.
  card: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  pill: {
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  meterLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9 },
  num: { fontVariant: ["tabular-nums"] },
  track: { borderRadius: 999, overflow: "hidden", marginTop: 5 },
  uses: { borderRadius: 22, paddingHorizontal: 11, paddingVertical: 1, borderWidth: 1 },
  useRow: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 58, paddingVertical: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: "100%",
  },
  useBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 11,
    rowGap: 6,
  },
  useText: { flexGrow: 1, flexShrink: 1, maxWidth: "100%" },
  shrink: { flexShrink: 1 },
  noChevron: { width: 15 },
});
