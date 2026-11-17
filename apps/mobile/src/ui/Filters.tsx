import { type ReactNode, useEffect, useRef } from "react";
import { Pressable, Text as RNText, ScrollView, type ScrollViewInstance, View } from "react-native";
import { Count } from "./Count";
import { haptics } from "./haptics";
import type { IconName } from "./icons.data";
import { SCREEN_X, TOOL_H, TOUCH } from "./rhythm";
import { systemText } from "./Text";
import { useTheme } from "./theme";
import { CHROME_MAX_SCALE, weights } from "./type-scale";

/** How much of the pill before stays in sight when the row follows the selected one. */
const PEEK = 40;

export interface FilterItem {
  key: string;
  /** Words, or text of its own sizes inside the label's (Segmented only: Tamanho do texto's growing A's). */
  label: ReactNode;
  count?: number;
  /** A small icon before the label (Segmented only). */
  icon?: IconName;
  /** What a screen reader says where the label doesn't say it in words (Segmented only). */
  accessibilityLabel?: string;
  /** Starts another group of the same row (Filters only): a quiet rule before it. */
  divider?: boolean;
}

export interface FiltersProps {
  items: FilterItem[];
  /** The chosen key, or one per group when the row holds several groups (Revisão: who, kind, open or all). */
  value: string | readonly string[];
  onChange: (key: string) => void;
}

/** Horizontal pills over a list; the selected one is ink, and the row follows it when it changes from outside. */
export function Filters({ items, value, onChange }: FiltersProps) {
  const { colors } = useTheme();
  const row = useRef<ScrollViewInstance>(null);
  const lefts = useRef(new Map<string, number>());
  const chosen = typeof value === "string" ? [value] : value;
  // A row of groups: it follows the one alone; with several chosen, the one tapped is already in sight.
  const follow = typeof value === "string" ? value : null;
  useEffect(() => {
    const left = follow === null ? undefined : lefts.current.get(follow);
    if (left !== undefined) row.current?.scrollTo({ x: Math.max(0, left - PEEK), animated: true });
  }, [follow]);
  return (
    <ScrollView
      ref={row}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // A ScrollView grows and shrinks by default: in a screen's column beside another one, the chips took half the
      // height, and under a list that fills the rest (the tasks board) they were squeezed and cut at the bottom.
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: SCREEN_X, paddingBottom: 4 }}
    >
      {items.map((item) => {
        const on = chosen.includes(item.key);
        const color = on ? colors.ink : colors.muted;
        const pill = (
          <Pressable
            key={item.key}
            onLayout={(e) => lefts.current.set(item.key, e.nativeEvent.layout.x)}
            onPress={() => {
              if (!on) haptics.selection();
              onChange(item.key);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            // The slop makes the pill's target the 44 a finger needs without spacing the row out.
            hitSlop={{ top: (TOUCH - TOOL_H) / 2, bottom: (TOUCH - TOOL_H) / 2 }}
            style={({ pressed }) => (pressed && !on ? { opacity: 0.6 } : null)}
          >
            <View
              style={{
                minHeight: TOOL_H,
                paddingHorizontal: 14,
                // DougBot: radius 8, the chosen one on the soft green (`--db-verde-suave`) with a 1 px green edge.
                borderRadius: 8,
                backgroundColor: on ? colors.chosen : colors.sunken,
                borderWidth: 1,
                borderColor: on ? colors.greenGlow : "transparent",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <RNText
                maxFontSizeMultiplier={CHROME_MAX_SCALE}
                style={[systemText("subhead", weights.semibold), { color }]}
              >
                {item.label}
              </RNText>
              {item.count !== undefined ? <Count value={item.count} size={15} color={color} /> : null}
            </View>
          </Pressable>
        );
        if (!item.divider) return pill;
        return (
          <View key={item.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{ width: 1, height: TOOL_H / 2, backgroundColor: colors.line }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            {pill}
          </View>
        );
      })}
    </ScrollView>
  );
}
