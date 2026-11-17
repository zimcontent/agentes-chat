import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { ActivityIndicator, Text as RNText, StyleSheet, View } from "react-native";
import { VERDE_BOTAO } from "../brand/tokens";
import type { IconName } from "./Icon";
import { PressScale } from "./PressScale";
import { TOOL_H, TOUCH } from "./rhythm";
import { systemText } from "./Text";
import { type Theme, useTheme } from "./theme";
import { CHROME_MAX_SCALE, weights } from "./type-scale";

/** `text`: the ghost's words with no side padding, so they start where the text above does (under a message). */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "text";

export interface ButtonProps {
  variant: ButtonVariant;
  size?: ButtonSize;
  /**
   * Kept for callers, never drawn: a button is its words (the design language has no icons inside buttons; a brand's
   * mark, which is a name and not a picture, goes in `leading`).
   */
  icon?: IconName;
  /** Drawn before the label instead of an icon (a brand's mark), given the label's color. */
  leading?: (color: string) => ReactNode;
  label: string;
  onPress: () => void;
  /** Full width. */
  wide?: boolean;
  disabled?: boolean;
  /** Working on it: a spinner in the icon's place, and it can't be pressed again meanwhile. */
  loading?: boolean;
  /** What a screen reader hears after the label: the state the label is too short to say. */
  hint?: string;
}

/** In a card or a row: 32 tall and round (the site's pill), its target grown to 44 past it (`slopOf`). */
const SMALL = { height: TOOL_H, radius: TOOL_H / 2, padding: 14, text: "subhead", icon: 16 } as const;

/** DougBot's button: 44 tall and round as on dougbot.app (the site's pill buttons), Inter 600 15/22. */
export const BUTTON_SIZES = {
  md: { height: 44, radius: 22, padding: 20, text: "subhead", icon: 18 },
  // A request's footer in the conversation: the in-card small button, so the card stays a message.
  card: SMALL,
  sm: SMALL,
} as const;

export type ButtonSize = keyof typeof BUTTON_SIZES;

/** A button shorter than a finger's target grows it above and below, never sideways: two 8 apart never share one. */
export function slopOf(height: number) {
  const grow = (TOUCH - height) / 2;
  return grow > 0 ? { top: grow, bottom: grow } : undefined;
}

/**
 * The green button: the screen's one main action (IDENTIDADE.md §4 "Verde: só o Doug e a ação principal"), the three
 * greens top to bottom (`--db-verde-botao`) with ink on it, the same in both themes.
 */
export function primaryLook(theme: Pick<Theme, "colors">) {
  return {
    gradient: VERDE_BOTAO.colors,
    locations: VERDE_BOTAO.locations,
    // The site's lime button: its own rim and a soft glow under it (`.ac-btn--primary`).
    shadow:
      "0px 0px 0px 1px rgba(156, 250, 5, 0.5), 0px 10px 30px -8px rgba(156, 250, 5, 0.55), 0px 0px 22px -6px rgba(156, 250, 5, 0.45)",
    highlight: "rgba(255, 255, 255, 0.35)",
    lowlight: "rgba(77, 145, 8, 0.35)",
    text: theme.colors.greenInk,
  };
}

/** The tactile button: tonal gradient, a lit top edge, a spring press and a light haptic. */
export function Button({
  variant,
  size = "md",
  leading,
  label,
  onPress,
  wide = false,
  disabled = false,
  loading = false,
  hint,
}: ButtonProps) {
  const theme = useTheme();
  const { colors } = theme;
  const s = BUTTON_SIZES[size];
  const primary = variant === "primary";
  const look = primaryLook(theme);
  const textColor = primary ? look.text : variant === "ghost" || variant === "text" ? colors.muted : colors.ink;
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled || loading}
      sink
      fill={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint ? { accessibilityHint: hint } : {})}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      hitSlop={slopOf(s.height)}
      style={[
        {
          borderRadius: s.radius,
          alignSelf: wide ? "stretch" : "flex-start",
          opacity: disabled ? 0.5 : 1,
        },
        primary ? { boxShadow: look.shadow } : null,
      ]}
    >
      <View
        style={[
          styles.face,
          { minHeight: s.height, borderRadius: s.radius, paddingHorizontal: variant === "text" ? 0 : s.padding },
          variant === "secondary"
            ? {
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: colors.glassEdge,
                backgroundColor: colors.raised,
              }
            : null,
        ]}
      >
        {primary ? (
          <>
            <LinearGradient colors={look.gradient} locations={look.locations} style={StyleSheet.absoluteFill} />
            <View style={[styles.edge, { top: 0, backgroundColor: look.highlight }]} />
            <View style={[styles.edge, { bottom: 0, backgroundColor: look.lowlight }]} />
          </>
        ) : variant === "secondary" ? (
          <>
            <LinearGradient colors={colors.glassCard} style={StyleSheet.absoluteFill} />
            <View style={[styles.edge, { top: 0, backgroundColor: colors.glassTop }]} />
          </>
        ) : null}
        {loading ? <ActivityIndicator size="small" color={textColor} /> : leading ? leading(textColor) : null}
        <RNText
          numberOfLines={1}
          maxFontSizeMultiplier={CHROME_MAX_SCALE}
          style={[systemText(s.text, weights.semibold), { color: textColor }]}
        >
          {label}
        </RNText>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  // Sized by its content and the minimum height, never grown: a growing face inside the press's growing
  // Pressable fills whatever height Yoga offers when it measures to fit, so a button beside a row's text
  // stood as tall as the screen.
  face: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  edge: { position: "absolute", left: 0, right: 0, height: 1 },
});
