import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Count, Icon, type IconName, PressScale, Text, useTheme } from "@/ui";
import { pillSurface, surfaceStyle } from "@/ui/surfaces";
import { useColors } from "./hooks";

/** A tile's square, its glyph and the room under it: "Tudo"'s own (`AllSheet`), so both sheets read as one family. */
export const QUICK_TILE = 56;
const GLYPH = 22;

export interface QuickTile {
  key: string;
  icon?: IconName;
  /** In place of the icon (an agent's face). */
  leading?: ReactNode;
  label: string;
  /** What waits there (a conversation's pinned messages): a small count at the tile's corner. */
  count?: number;
  /** The one thing this sheet puts first (Ligar): the lime's edge around its glass. */
  accent?: boolean;
  onPress: () => void;
}

/**
 * A sheet's quick actions as a row of glass tiles, the name under each (a conversation's "…": Ligar, Buscar, Fixadas,
 * Perfil). They share the row's width, at most four: more go to the list under them.
 */
export function QuickTiles({ items }: { items: readonly QuickTile[] }) {
  const c = useColors();
  const { scheme } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      {items.slice(0, 4).map((it) => (
        <PressScale
          key={it.key}
          onPress={it.onPress}
          accessibilityRole="button"
          accessibilityLabel={it.count ? `${it.label}, ${it.count}` : it.label}
          style={styles.cell}
          contentStyle={styles.cellIn}
        >
          <View
            style={[
              styles.tile,
              surfaceStyle(pillSurface(scheme), Math.round(QUICK_TILE * 0.3)),
              it.accent ? { borderWidth: 1, borderColor: c.greenGlow } : null,
            ]}
          >
            {it.leading ??
              (it.icon ? <Icon name={it.icon} size={GLYPH} color={it.accent ? c.greenText : c.ink} /> : null)}
            {it.count ? (
              <View style={styles.count}>
                <Count value={it.count} max={99} inverted size={11} />
              </View>
            ) : null}
          </View>
          <Text
            variant="caption"
            tone="ink2"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={styles.label}
          >
            {it.label}
          </Text>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  cell: { flex: 1 },
  cellIn: { alignItems: "center", gap: 6, paddingTop: 4 },
  tile: { width: QUICK_TILE, height: QUICK_TILE, alignItems: "center", justifyContent: "center" },
  count: { position: "absolute", top: -4, right: -6 },
  label: { alignSelf: "stretch", textAlign: "center", fontWeight: "500" },
});
