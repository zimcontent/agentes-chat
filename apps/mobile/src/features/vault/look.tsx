import type { VaultItem } from "@agenteschat/client";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Text as RNText, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { DB_FONTES } from "@/brand/tokens";
import { readValueSync, STORED, writeValueSync } from "@/lib/storage";
import { useTheme } from "@/ui/theme";
import { CLIPBOARD_CLEAR_MS, itemTile, parseFavorites, stillOurs, toggleFavorite } from "./logic";

/*
 * Senhas drawn the way the password managers people know draw it: their blue-black (or light gray) screen, the round
 * vault switcher, colored category tiles, the item in a sheet with its fields in one card. And what goes with it: a
 * copy that leaves the clipboard on its own, and the items starred on this phone.
 */

export function useVaultLook() {
  const { scheme } = useTheme();
  return scheme === "dark" ? DARK : LIGHT;
}

const DARK = {
  bg: "#0F1115",
  pill: "#1C2027",
  pillInk: "#AEB6C2",
  ink: "#EEF1F5",
  sub: "#A1AAB6",
  card: "#171A20",
  sep: "#232831",
  sheet: "#1A1D23",
  field: "#22262E",
  fieldSep: "#2C313A",
  label: "#6FB2FF",
  link: "#4DA3FF",
  chip: "#22262E",
  face: "#3A3F48",
};
const LIGHT: typeof DARK = {
  bg: "#F2F2F7",
  pill: "#E3E5EA",
  pillInk: "#4A505A",
  ink: "#111418",
  sub: "#5C6470",
  card: "#FFFFFF",
  sep: "#E3E5EA",
  sheet: "#F2F2F7",
  field: "#FFFFFF",
  fieldSep: "#E3E5EA",
  label: "#0A6CD6",
  link: "#0A6CD6",
  chip: "#FFFFFF",
  face: "#D5D9E0",
};

export const vaultText = {
  regular: DB_FONTES.texto400,
  medium: DB_FONTES.texto500,
  semibold: DB_FONTES.texto600,
  bold: DB_FONTES.texto700,
} as const;

/** The star of Favoritos (filled when the item is one). */
export function StarGlyph({ color, size = 17, filled = false }: { color: string; size?: number; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        fill={filled ? color : "none"}
      />
    </Svg>
  );
}

/** An item's tile: two letters of its site on its color, rounded like an app icon. */
export function ItemTile({ item, size }: { item: Pick<VaultItem, "title" | "website">; size: number }) {
  const tile = itemTile(item);
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: Math.round(size * 0.27), backgroundColor: tile.color },
      ]}
    >
      <RNText maxFontSizeMultiplier={1} style={[styles.tileText, { fontSize: Math.round(size * 0.36) }]}>
        {tile.letters}
      </RNText>
    </View>
  );
}

// ── Copy, then take it back ─────────────────────────────────────────────────────────────────────────────────

let clearing: ReturnType<typeof setTimeout> | null = null;

/**
 * Puts a field on the clipboard (marked sensitive where the system has the flag: Android keeps it out of its preview)
 * and, a minute later, takes it back if it is still what the app copied. False when the system refused.
 */
export async function copyForAMinute(text: string): Promise<boolean> {
  const ok = await Clipboard.setStringAsync(text, { android: { isSensitive: true } }).then(
    (r) => r !== false,
    () => false,
  );
  if (!ok) return false;
  if (clearing) clearTimeout(clearing);
  clearing = setTimeout(() => {
    clearing = null;
    Clipboard.getStringAsync()
      .then((now) => (stillOurs(now, text) ? Clipboard.setStringAsync("") : undefined))
      .catch(() => {});
  }, CLIPBOARD_CLEAR_MS);
  return true;
}

// ── Favorites on this phone ─────────────────────────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let raw: string | null | undefined;
const read = () => {
  if (raw === undefined) raw = readValueSync(STORED.vaultFavorites);
  return raw;
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The items this person starred in this workspace, on this phone, and the star's toggle. */
export function useVaultFavorites(orgId: string) {
  const current = useSyncExternalStore(subscribe, read, read);
  const ids = useMemo(() => new Set(parseFavorites(current, orgId)), [current, orgId]);
  const toggle = useCallback(
    (itemId: string) => {
      raw = toggleFavorite(read(), orgId, itemId);
      writeValueSync(STORED.vaultFavorites, raw);
      for (const fn of listeners) fn();
    },
    [orgId],
  );
  return { ids, toggle };
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
  tileText: { fontFamily: vaultText.bold, color: "#FFFFFF" },
});
