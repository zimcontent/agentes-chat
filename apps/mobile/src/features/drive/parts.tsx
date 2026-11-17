import type { Artifact } from "@agenteschat/client";
import { memo, type ReactNode } from "react";
import { Text as RNText, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { DB_FONTES } from "@/brand/tokens";
import { PressScale } from "@/ui";
import { useTheme } from "@/ui/theme";
import { Preview } from "./DriveCard";
import type { FileMark } from "./logic";

/*
 * The pieces of Arquivos drawn the way the phone's file apps draw them: a tile in the type's color, the rows with who
 * changed what and when, the suggested cards with their picture, the chips that open a filter.
 */

/** The screen's own colors: the file apps' near-black (or white), their gray search pill and outlined chips. */
export function useDriveLook() {
  const { scheme } = useTheme();
  return scheme === "dark" ? DARK : LIGHT;
}

const DARK = {
  bg: "#131314",
  search: "#282A2C",
  searchInk: "#C4C7C5",
  chipLine: "#444746",
  chipOn: "#004A77",
  chipOnInk: "#C2E7FF",
  ink: "#E3E3E3",
  sub: "#C4C7C5",
  card: "#1E1F20",
  fab: "#2B2F33",
  press: "rgba(255,255,255,0.06)",
};
const LIGHT: typeof DARK = {
  bg: "#FFFFFF",
  search: "#E9EEF6",
  searchInk: "#444746",
  chipLine: "#747775",
  chipOn: "#C2E7FF",
  chipOnInk: "#001D35",
  ink: "#1F1F1F",
  sub: "#444746",
  card: "#F0F4F9",
  fab: "#E9EEF6",
  press: "rgba(0,0,0,0.05)",
};

const MARK_COLOR: Record<FileMark | "folder", string> = {
  doc: "#4285F4",
  sheet: "#0F9D58",
  slide: "#F4B400",
  pdf: "#EA4335",
  image: "#EA4335",
  video: "#EA4335",
  code: "#A142F4",
  zip: "#9AA0A6",
  file: "#9AA0A6",
  folder: "#9AA0A6",
};

/** A file's tile (24 by default): a page in its type's color with its sign in white, or the gray folder. */
export function FileTile({ mark, size = 24 }: { mark: FileMark | "folder"; size?: number }) {
  const fill = MARK_COLOR[mark];
  if (mark === "folder")
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        <Path
          d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"
          fill={fill}
        />
      </Svg>
    );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Rect x={4} y={3} width={16} height={18} rx={2.5} fill={fill} />
      {SIGN[mark]}
    </Svg>
  );
}

const W = "#FFFFFF";
const SIGN: Record<FileMark, ReactNode> = {
  doc: <Path d="M8 10h8M8 13h8M8 16h5" stroke={W} strokeWidth={1.6} />,
  sheet: <Path d="M7.5 10h9v7h-9zM7.5 13.5h9M12 10v7" stroke={W} strokeWidth={1.4} fill="none" />,
  slide: <Rect x={7.5} y={10} width={9} height={6} rx={1} stroke={W} strokeWidth={1.5} fill="none" />,
  pdf: (
    <SvgText x={12} y={16.5} fontFamily={DB_FONTES.texto700} fontWeight="700" fontSize={6} fill={W} textAnchor="middle">
      PDF
    </SvgText>
  ),
  image: (
    <>
      <Circle cx={9.5} cy={10} r={1.4} fill={W} />
      <Path d="m6.5 17 3.5-3.5 2.5 2.5 2-2 3 3z" fill={W} />
    </>
  ),
  video: <Path d="M10 9.5v6l5-3z" fill={W} />,
  code: <Path d="m10 10-2.5 2.5L10 15M14 10l2.5 2.5L14 15" stroke={W} strokeWidth={1.5} fill="none" />,
  zip: <Path d="M12 5v2M12 9v2M12 13v2" stroke={W} strokeWidth={1.6} />,
  file: <Path d="M8 11h8M8 14h6" stroke={W} strokeWidth={1.5} />,
};

/** Three dots one over the other: a row's menu. */
export function DotsGlyph({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Circle cx={12} cy={5.5} r={1.7} fill={color} />
      <Circle cx={12} cy={12} r={1.7} fill={color} />
      <Circle cx={12} cy={18.5} r={1.7} fill={color} />
    </Svg>
  );
}

/** Rows one under the other (list) or two by two (grid). */
export function ViewGlyph({ grid, color }: { grid: boolean; color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" accessible={false}>
      {grid ? (
        <Path
          d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z"
          stroke={color}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      ) : (
        <Path
          d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

/** The plus of "Novo" in four colors. */
export function NewGlyph() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" accessible={false}>
      <Path d="M12 4v8" stroke="#EA4335" strokeWidth={3} strokeLinecap="round" />
      <Path d="M12 12v8" stroke="#34A853" strokeWidth={3} strokeLinecap="round" />
      <Path d="M4 12h8" stroke="#FBBC04" strokeWidth={3} strokeLinecap="round" />
      <Path d="M12 12h8" stroke="#4285F4" strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

/** A row of the list: the tile, the name, who changed it and when, and its menu. */
export const DriveRow = memo(function DriveRow({
  tile,
  title,
  sub,
  label,
  menuLabel,
  highlighted = false,
  onPress,
  onMenu,
}: {
  tile: ReactNode;
  title: string;
  sub: string;
  label: string;
  menuLabel: string;
  highlighted?: boolean;
  onPress: () => void;
  onMenu: () => void;
}) {
  const look = useDriveLook();
  return (
    <View style={[styles.row, highlighted && { backgroundColor: look.chipOn }]}>
      <PressScale
        to={0.98}
        haptic={false}
        fill={false}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={styles.rowMain}
        contentStyle={styles.rowMainIn}
      >
        <View style={styles.rowTile}>{tile}</View>
        <View style={styles.rowText}>
          <RNText numberOfLines={1} style={[styles.rowTitle, { color: highlighted ? look.chipOnInk : look.ink }]}>
            {title}
          </RNText>
          <RNText numberOfLines={1} style={[styles.rowSub, { color: highlighted ? look.chipOnInk : look.sub }]}>
            {sub}
          </RNText>
        </View>
      </PressScale>
      <PressScale
        to={0.85}
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel={menuLabel}
        hitSlop={4}
        style={styles.dots}
        contentStyle={styles.centered}
      >
        <DotsGlyph color={look.sub} />
      </PressScale>
    </View>
  );
});

/** A suggested file: its picture, then its tile and name, and who touched it last. */
export function SuggestedCard({
  artifact,
  mark,
  sub,
  label,
  onPress,
}: {
  artifact: Artifact;
  mark: FileMark;
  sub: string;
  label: string;
  onPress: () => void;
}) {
  const look = useDriveLook();
  return (
    <PressScale
      to={0.97}
      haptic={false}
      fill={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.card, { backgroundColor: look.card }]}
    >
      <View style={styles.thumb}>
        <Preview artifact={artifact} />
      </View>
      <View style={styles.cardName}>
        <FileTile mark={mark} size={18} />
        <RNText numberOfLines={1} style={[styles.cardTitle, { color: look.ink }]}>
          {artifact.title}
        </RNText>
      </View>
      <RNText numberOfLines={1} style={[styles.cardSub, { color: look.sub }]}>
        {sub}
      </RNText>
    </PressScale>
  );
}

/** A filter that opens its choices: outlined while it is "any", filled once something is picked. */
export function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const look = useDriveLook();
  return (
    <PressScale
      to={0.95}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      hitSlop={6}
      style={[styles.chip, on ? { backgroundColor: look.chipOn } : { borderWidth: 1, borderColor: look.chipLine }]}
      contentStyle={styles.chipIn}
    >
      <RNText numberOfLines={1} style={[styles.chipText, { color: on ? look.chipOnInk : look.ink }]}>
        {label}
      </RNText>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" accessible={false}>
        <Path d="m6 9 6 6 6-6" stroke={on ? look.chipOnInk : look.sub} strokeWidth={1.8} strokeLinecap="round" />
      </Svg>
    </PressScale>
  );
}

export const driveText = {
  regular: DB_FONTES.texto400,
  medium: DB_FONTES.texto500,
  semibold: DB_FONTES.texto600,
} as const;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", height: 60, paddingRight: 10 },
  rowMain: { flex: 1, minWidth: 0, height: 60 },
  rowMainIn: { flexDirection: "row", alignItems: "center", gap: 16, paddingLeft: 20 },
  centered: { alignItems: "center", justifyContent: "center" },
  rowTile: { width: 24, alignItems: "center" },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: driveText.medium, fontSize: 15, lineHeight: 20 },
  rowSub: { fontFamily: driveText.regular, fontSize: 12.5, lineHeight: 17 },
  dots: { width: 40, height: 40, borderRadius: 20 },
  card: { flex: 1, minWidth: 0, borderRadius: 14, padding: 8, paddingBottom: 10 },
  thumb: { height: 96, borderRadius: 9, overflow: "hidden" },
  cardName: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  cardTitle: { flex: 1, minWidth: 0, fontFamily: driveText.medium, fontSize: 13, lineHeight: 17 },
  cardSub: { fontFamily: driveText.regular, fontSize: 11.5, lineHeight: 15, marginTop: 2, paddingLeft: 24 },
  chip: { height: 32, borderRadius: 8, maxWidth: 160 },
  chipIn: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 14, paddingRight: 10 },
  chipText: { fontFamily: driveText.medium, fontSize: 13.5, flexShrink: 1 },
});
