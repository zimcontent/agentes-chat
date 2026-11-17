import {
  APP_ICONS,
  type AppIconId,
  appIconNameKey,
  DEFAULT_MADE_ICON,
  MADE_ICON_COLORS,
  MADE_ICON_FACES,
  MADE_ICON_GROUNDS,
  MADE_ICON_POSES,
  type MadeIcon,
} from "@agenteschat/client/lib/app-icons";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { svgDoBot } from "@/brand/bots";
import { ICON_HEX, ICON_LOOKS, iconSvg } from "@/brand/doug-icons.js";
import DougBot from "@/brand/dougbot-avatar.js";
import { Button, GroupedFooter, GroupedHeader, GroupedList, Icon, Text, useTheme, useToast } from "@/ui";
import { useColors } from "../shared/hooks";
import { tapHaptic } from "../shared/parts";
import { APP_ICON_PICTURES, useAppIcon } from "./app-icon";
import { type PhoneIcon, samePhoneIcon } from "./app-icon-names";
import { Page } from "./parts";

/** An icon's corner on a home screen, as a share of its side. */
const CORNER = 0.225;

/**
 * A made icon as the home screen will show it: the Doug's icon drawn by the identity's code (brand/doug-icons.js),
 * the same drawing the build writes the icon's file from (scripts/made-icons.mjs).
 */
function MadeIconPicture({ icon, size }: { icon: MadeIcon; size: number }) {
  const xml = useMemo(() => iconSvg(icon), [icon]);
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * CORNER), overflow: "hidden" }}>
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
}

/** An icon's picture as the home screen shows it (a ready one in this appearance), rounded like one. */
export function AppIconPicture({ icon, size = 32 }: { icon: PhoneIcon; size?: number }) {
  const theme = useTheme();
  if (typeof icon !== "string") return <MadeIconPicture icon={icon} size={size} />;
  return (
    <Image
      source={APP_ICON_PICTURES[icon][theme.scheme === "dark" ? "dark" : "light"]}
      style={{ width: size, height: size, borderRadius: Math.round(size * CORNER) }}
      accessibilityIgnoresInvertColors
    />
  );
}

/** An icon's name: a ready one's, or "Your icon". */
export function useAppIconName(icon: PhoneIcon) {
  const { t } = useTranslation();
  return typeof icon === "string" ? t(appIconNameKey(icon)) : t("appIcon.yours");
}

/** The Doug's head with a face, as the picker's choice shows it: black with white eyes, like the shipped icon's. */
function Face({ face, size }: { face: MadeIcon["face"]; size: number }) {
  const xml = useMemo(
    () =>
      svgDoBot({
        bot: "doug",
        tamanho: size,
        peca: false,
        material: "preto",
        brilho: false,
        olhar: ICON_LOOKS[face],
        id: `face${face}`,
      }),
    [face, size],
  );
  return <SvgXml xml={xml} width={size} height={size} />;
}

/** A color's swatch: its glass, light from above. */
const swatchOf = (color: MadeIcon["color"]) => {
  const hex = ICON_HEX[color];
  return [DougBot.mix(hex, "#ffffff", 0.35), hex, DougBot.mix(hex, "#000000", 0.18)] as const;
};

/**
 * App icon (ADR 0179; DougBot's own, docs/adr/doug-0010-doug-app-icons.md), pushed from You: the icon as the home
 * screen will show it, then what it is made of (its ground, how the Doug stands, his color and his face) and the
 * ready ones. Nothing changes until "Use this icon": iOS confirms every change with an alert of its own, which trying
 * the choices one by one would show each time.
 */
export function AppIconPage() {
  const { t } = useTranslation();
  const appIcon = useAppIcon();
  return (
    <Page title={t("appIcon.title")}>
      {/* The icon in use is asked of the system: the choices start from it. */}
      {appIcon.icon ? <AppIconMaker current={appIcon.icon} set={appIcon.set} /> : null}
    </Page>
  );
}

function AppIconMaker({ current, set }: { current: PhoneIcon; set: (icon: PhoneIcon) => Promise<void> }) {
  const { t } = useTranslation();
  const c = useColors();
  const toast = useToast();
  // What the choices make, and the ready icon shown instead of it while one is picked.
  const [made, setMade] = useState<MadeIcon>(typeof current === "string" ? DEFAULT_MADE_ICON : current);
  const [ready, setReady] = useState<AppIconId | null>(typeof current === "string" ? current : null);
  const [changing, setChanging] = useState(false);
  const shown: PhoneIcon = ready ?? made;
  const name = useAppIconName(shown);
  const inUse = samePhoneIcon(shown, current);

  const make = (patch: Partial<MadeIcon>) => {
    tapHaptic();
    setMade({ ...made, ...patch });
    setReady(null);
  };
  const use = () => {
    setChanging(true);
    set(shown)
      .catch(() => toast({ title: t("appIcon.failed"), icon: "x" }))
      .finally(() => setChanging(false));
  };
  const plate = (on: boolean) => [styles.plate, { backgroundColor: c.sunken, borderColor: on ? c.ink : "transparent" }];

  return (
    <>
      <View style={styles.hero}>
        <AppIconPicture icon={shown} size={96} />
        <Text variant="title" style={styles.name}>
          {name}
        </Text>
        <Text variant="footnote" tone="muted">
          {ready
            ? t("appIcon.readyOne")
            : [
                t(`appIcon.grounds.${made.ground}`),
                t(`appIcon.colors.${made.color}`),
                ...(made.pose === "peek" ? [t("appIcon.poses.peek")] : []),
                t(`appIcon.faces.${made.face}`),
              ].join(" · ")}
        </Text>
      </View>
      <Button
        variant="primary"
        wide
        label={inUse ? t("appIcon.inUse") : t("appIcon.use")}
        disabled={inUse}
        loading={changing}
        onPress={use}
      />

      <GroupedHeader>{t("appIcon.ground")}</GroupedHeader>
      <GroupedList>
        <View style={styles.pair} accessibilityRole="radiogroup" accessibilityLabel={t("appIcon.ground")}>
          {MADE_ICON_GROUNDS.map((ground) => {
            const on = !ready && made.ground === ground;
            return (
              <Choice
                key={ground}
                on={on}
                label={t(`appIcon.grounds.${ground}`)}
                onPress={() => make({ ground })}
                style={styles.half}
              >
                <View style={[plate(on), styles.option]}>
                  <MadeIconPicture icon={{ ...made, ground }} size={30} />
                  <Text variant="callout">{t(`appIcon.grounds.${ground}`)}</Text>
                </View>
              </Choice>
            );
          })}
        </View>
      </GroupedList>

      <GroupedHeader>{t("appIcon.pose")}</GroupedHeader>
      <GroupedList>
        <View style={styles.pair} accessibilityRole="radiogroup" accessibilityLabel={t("appIcon.pose")}>
          {MADE_ICON_POSES.map((pose) => {
            const on = !ready && made.pose === pose;
            return (
              <Choice
                key={pose}
                on={on}
                label={t(`appIcon.poses.${pose}`)}
                onPress={() => make({ pose })}
                style={styles.half}
              >
                <View style={[plate(on), styles.option]}>
                  <MadeIconPicture icon={{ ...made, pose }} size={30} />
                  <Text variant="callout">{t(`appIcon.poses.${pose}`)}</Text>
                </View>
              </Choice>
            );
          })}
        </View>
      </GroupedList>

      <GroupedHeader>{t("appIcon.color")}</GroupedHeader>
      <GroupedList>
        <View style={styles.colors} accessibilityRole="radiogroup" accessibilityLabel={t("appIcon.color")}>
          {MADE_ICON_COLORS.map((color) => {
            const on = !ready && made.color === color;
            return (
              <Choice key={color} on={on} label={t(`appIcon.colors.${color}`)} onPress={() => make({ color })} slop={7}>
                <LinearGradient colors={swatchOf(color)} style={[styles.color, { borderColor: c.line }]}>
                  {on ? <Icon name="check" size={16} color="#0A0A0A" /> : null}
                </LinearGradient>
              </Choice>
            );
          })}
        </View>
      </GroupedList>

      <GroupedHeader>{t("appIcon.expression")}</GroupedHeader>
      <GroupedList>
        <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t("appIcon.expression")}>
          {MADE_ICON_FACES.map((face) => {
            const on = !ready && made.face === face;
            return (
              <Choice
                key={face}
                on={on}
                label={t(`appIcon.faces.${face}`)}
                onPress={() => make({ face })}
                style={styles.fifth}
              >
                <View style={[plate(on), styles.face]}>
                  <Face face={face} size={40} />
                </View>
              </Choice>
            );
          })}
        </View>
      </GroupedList>

      <GroupedHeader>{t("appIcon.ready")}</GroupedHeader>
      <GroupedList>
        <View style={styles.readies} accessibilityRole="radiogroup" accessibilityLabel={t("appIcon.ready")}>
          {APP_ICONS.map((id) => {
            const on = ready === id;
            return (
              <Choice
                key={id}
                on={on}
                label={t(appIconNameKey(id))}
                onPress={() => {
                  tapHaptic();
                  setReady(id);
                }}
              >
                <View style={[styles.ready, { borderColor: on ? c.ink : "transparent" }]}>
                  <AppIconPicture icon={id} size={46} />
                </View>
              </Choice>
            );
          })}
        </View>
      </GroupedList>
      {/* iOS confirms with an alert of its own; Android's home screens take their time. */}
      {Platform.OS === "android" ? <GroupedFooter>{t("appIcon.hintAndroid")}</GroupedFooter> : null}
    </>
  );
}

/** One choice among its group's: pressed, it gives a little. */
function Choice({
  on,
  label,
  onPress,
  slop,
  style,
  children,
}: {
  on: boolean;
  label: string;
  onPress: () => void;
  slop?: number;
  style?: object;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      {...(slop ? { hitSlop: slop } : {})}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingTop: 14, paddingBottom: 16, gap: 2 },
  name: { marginTop: 12 },
  plate: { borderWidth: 2, alignItems: "center", justifyContent: "center" },
  pair: { flexDirection: "row", gap: 8, padding: 12 },
  half: { flex: 1 },
  option: { flexDirection: "row", justifyContent: "flex-start", gap: 10, padding: 8, borderRadius: 14 },
  colors: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  color: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 10, paddingHorizontal: 8, paddingVertical: 12 },
  fifth: { width: "20%", alignItems: "center" },
  face: { width: 52, height: 52, borderRadius: 16 },
  readies: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 12 },
  ready: { borderWidth: 2, borderRadius: 15, padding: 2 },
  pressed: { transform: [{ scale: 0.96 }] },
});
