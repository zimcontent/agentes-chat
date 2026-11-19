import { mixHex } from "@agenteschat/ui/agent/engine";
import { sourceMarkOf } from "@agenteschat/ui/blocks/source-marks";
import type { AgendaTone, BlockOpen, BlockViewPart } from "@agenteschat/ui/blocks/spec";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Icon, type IconName, Text, useTheme } from "@/ui";
import { useColors } from "../shared/hooks";

/**
 * A sector card's pieces on the phone (docs/adr/doug-0020-doug-sector-cards.md), as the web draws them: the source
 * (the service's official mark, its title, a quiet count) and a day's agenda (a time column, each event a block tinted
 * in its colour, as Google Calendar draws one).
 */

const SOURCE_ICONS: Record<string, IconName> = {
  proposals: "bulb",
  approvals: "shield",
  tasks: "issue",
  review: "eye",
  portal: "globe",
  mail: "mail",
  other: "sparkle",
};

export function SourceMark({ service, size = 16 }: { service: string; size?: number }) {
  const c = useColors();
  const mark = sourceMarkOf(service);
  if (mark) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={mark.d} fill={mark.color} />
      </Svg>
    );
  }
  return <Icon name={SOURCE_ICONS[service] ?? "sparkle"} size={size} color={c.muted} />;
}

export function SourcePart({ service, title, count }: { service: string; title: string; count: string }) {
  return (
    <View style={styles.source}>
      <SourceMark service={service} />
      <Text variant="footnote" tone="muted" style={styles.sourceTitle}>
        {title}
      </Text>
      {count ? (
        <Text variant="footnote" tone="faint">
          {count}
        </Text>
      ) : null}
    </View>
  );
}

/** The tones as Google Calendar's colours: the deep one on light, the light one on dark. */
const TONES: Record<AgendaTone, [string, string]> = {
  blue: ["#1a73e8", "#8ab4f8"],
  green: ["#0b8043", "#33b679"],
  orange: ["#e8710a", "#f4a35c"],
  red: ["#d50000", "#f06767"],
  purple: ["#8e24aa", "#b884cf"],
  yellow: ["#b48600", "#f6bf26"],
  teal: ["#039be5", "#4fc3f7"],
  gray: ["#5f6368", "#9aa0a6"],
};

export function AgendaPart({
  part,
  onOpen,
}: {
  part: Extract<BlockViewPart, { kind: "agenda" }>;
  onOpen: (to: BlockOpen) => void;
}) {
  const c = useColors();
  const { scheme } = useTheme();
  const dark = scheme === "dark";
  const link = part.link;
  return (
    <View style={styles.agenda}>
      {part.items.map((e, i) => {
        const [deep, light] = TONES[e.tone] ?? TONES.blue;
        const fill = mixHex(c.raised, deep, dark ? 0.24 : 0.14);
        const ink = mixHex(c.ink, dark ? light : deep, dark ? 0.45 : 0.58);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the events of one day, in order
          <View key={i} style={styles.row}>
            <Text variant="footnote" tone="muted" style={styles.time}>
              {e.time}
            </Text>
            <View style={[styles.event, { backgroundColor: fill }]}>
              <Text variant="subhead" style={[styles.eventTitle, { color: ink }]}>
                {e.title}
              </Text>
              {e.sub ? (
                <Text variant="footnote" style={{ color: ink }}>
                  {e.sub}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      {part.note || link ? (
        <Text variant="footnote" tone="muted">
          {part.note}
          {link ? (part.note ? " " : "") : null}
          {link ? (
            <Text
              variant="footnote"
              style={styles.link}
              accessibilityRole="link"
              suppressHighlighting
              onPress={() => onOpen(link.open)}
            >
              {link.label}
            </Text>
          ) : null}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  source: { flexDirection: "row", alignItems: "center", gap: 8 },
  sourceTitle: { flex: 1, fontWeight: "600" },
  agenda: { gap: 8 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  time: { width: 44, paddingTop: 8, fontVariant: ["tabular-nums"] },
  event: { flex: 1, minWidth: 0, gap: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  eventTitle: { fontWeight: "600" },
  link: { fontWeight: "600", textDecorationLine: "underline" },
});
