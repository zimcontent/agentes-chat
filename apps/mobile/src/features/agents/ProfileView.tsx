import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text as RNText, ScrollView, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import type { AgentLookInput } from "@/agent/looks";
import { botDoAgente, corDoBot } from "@/brand/bots";
import { DB_FONTES } from "@/brand/tokens";
import { AgentAvatar, type AgentMode, Button, Icon, type IconName } from "@/ui";
import { PressScale } from "@/ui/PressScale";
import { CHROME_MAX_SCALE } from "@/ui/type-scale";
import { useColors } from "../shared/hooks";

/*
 * An agent's profile on the phone, kept light: its face in its own glow, name, what it does and what it is on now,
 * Ligar / Tarefas / Ajustes, one box with what it can use, its month and who it answers to (read only), and its day.
 * Everything else about an agent is set up on the website or asked of the right hand. Drawn from plain values (the
 * screen reads them; the board shows samples).
 */

export interface ProfileFace {
  look: AgentLookInput;
  mode: AgentMode;
  expression?: "happy";
}

export interface ProfileToday {
  key: string;
  icon: IconName;
  title: string;
  sub: string;
  /** The words under the title in amber: it waits on you. */
  waiting?: boolean;
  onPress?: () => void;
}

export interface ProfileViewProps {
  face: ProfileFace;
  name: string;
  what: string | null;
  /** "Trabalhando · Capa da Fontes"; its dot lights green at work, amber when it waits on you. */
  state: { text: string; tone: "working" | "waiting" | "idle" } | null;
  actions: { key: string; icon: IconName; label: string; onPress: () => void; disabled?: boolean }[];
  /** The apps it can use, by name (the first few, then "+N"). Null: not shown to this viewer. */
  uses: string[] | null;
  /** This month's share used, 0–100, and its words ("42%"); null: nothing to show. */
  month: { percent: number; text: string; onPress?: () => void } | null;
  /** The agent it answers to; `none`: words for nobody. Null: not shown. */
  reportsTo: { look: AgentLookInput; name: string } | { none: string } | null;
  today: ProfileToday[];
  /** Words under "Hoje" when it did nothing today. */
  todayEmpty: string;
  /** The way to talk to it, at the foot. */
  talk: { label: string; onPress: () => void; disabled?: boolean } | null;
  /** A line under the box (why it can't be talked to, a notice). */
  note?: ReactNode;
  /** Room above the face for the bar (the native header in the app, a stand-in on the board). */
  top?: number;
  /** Shown over the screen's top (the board's stand-in bar). */
  header?: ReactNode;
}

/** Tags shown before "+N". */
const TAGS_SHOWN = 3;
const FACE = 96;

export function ProfileView(p: ProfileViewProps) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const glow = botColor(p.face.look);
  const extra = p.uses ? p.uses.length - TAGS_SHOWN : 0;
  const dot = p.state?.tone === "working" ? c.green : p.state?.tone === "waiting" ? c.amber : c.faint;
  const foot = p.talk ? TALK_H + DOCK_FOOT : 0;
  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: p.top ?? 0, paddingBottom: insets.bottom + foot + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Its color's light around the face, as the identity's ambient (a soft radial, 16%). */}
        <View pointerEvents="none" style={styles.ambient}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="amb" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={glow} stopOpacity={0.16} />
                <Stop offset="1" stopColor={glow} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#amb)" />
          </Svg>
        </View>
        <View style={styles.prof}>
          <View style={styles.face}>
            <AgentAvatar
              agent={p.face.look}
              size={FACE}
              mode={p.face.mode}
              name={p.name}
              {...(p.face.expression ? { expression: p.face.expression } : {})}
            />
          </View>
          <RNText
            accessibilityRole="header"
            maxFontSizeMultiplier={CHROME_MAX_SCALE}
            style={[styles.name, { color: c.ink }]}
          >
            {p.name}
          </RNText>
          {p.what ? (
            <RNText numberOfLines={2} style={[styles.role, { color: c.muted }]}>
              {p.what}
            </RNText>
          ) : null}
          {p.state ? (
            <View style={[styles.now, pill(c)]}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: dot },
                  p.state.tone === "idle" ? null : { boxShadow: `0 0 0 3px ${withOpacity(dot, 0.12)}, 0 0 8px ${dot}` },
                ]}
              />
              <RNText numberOfLines={1} style={[styles.nowText, { color: c.ink }]}>
                {p.state.text}
              </RNText>
            </View>
          ) : null}
          <View style={styles.acts}>
            {p.actions.map((a) => (
              <PressScale
                key={a.key}
                onPress={a.onPress}
                disabled={a.disabled}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={[styles.act, pill(c), a.disabled ? styles.off : null]}
                contentStyle={styles.actIn}
              >
                <Icon name={a.icon} size={20} color={c.ink} />
                <RNText numberOfLines={1} style={[styles.actText, { color: c.ink }]}>
                  {a.label}
                </RNText>
              </PressScale>
            ))}
          </View>

          {p.uses || p.month || p.reportsTo ? (
            <View style={[styles.box, card(c)]}>
              {p.uses ? (
                <Line label={t("mobile.agentLite.uses")} first>
                  <View style={styles.tags}>
                    {p.uses.length === 0 ? (
                      <RNText style={[styles.lineText, { color: c.muted }]}>{t("mobile.agentLite.usesNone")}</RNText>
                    ) : (
                      p.uses.slice(0, TAGS_SHOWN).map((u) => <Tag key={u} label={u} />)
                    )}
                    {extra > 0 ? <Tag label={`+${extra}`} /> : null}
                  </View>
                </Line>
              ) : null}
              {p.month ? (
                <Line label={t("mobile.agentLite.month")} first={!p.uses} onPress={p.month.onPress}>
                  <View style={styles.monthRow}>
                    <View style={[styles.track, { backgroundColor: c.plate }]}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${Math.max(0, Math.min(100, p.month.percent))}%`,
                            backgroundColor: p.month.percent >= 90 ? c.amber : c.green,
                            boxShadow: `0 0 10px ${withOpacity(p.month.percent >= 90 ? c.amber : c.green, 0.5)}`,
                          },
                        ]}
                      />
                    </View>
                    <RNText style={[styles.percent, { color: c.ink }]}>{p.month.text}</RNText>
                  </View>
                </Line>
              ) : null}
              {p.reportsTo ? (
                <Line label={t("mobile.agentLite.reportsTo")} first={!p.uses && !p.month}>
                  {"none" in p.reportsTo ? (
                    <RNText style={[styles.lineText, { color: c.muted }]}>{p.reportsTo.none}</RNText>
                  ) : (
                    <View style={styles.tags}>
                      <Tag
                        label={p.reportsTo.name}
                        leading={<AgentAvatar agent={p.reportsTo.look} size={18} name={p.reportsTo.name} />}
                      />
                    </View>
                  )}
                </Line>
              ) : null}
            </View>
          ) : null}
          {p.note}

          <RNText accessibilityRole="header" style={[styles.section, { color: c.ink }]}>
            {t("common.today")}
          </RNText>
          <View style={[styles.box, card(c)]}>
            {p.today.length === 0 ? (
              <View style={[styles.line, styles.first]}>
                <RNText style={[styles.lineText, { color: c.muted }]}>{p.todayEmpty}</RNText>
              </View>
            ) : (
              p.today.map((d, i) => (
                <Pressable
                  key={d.key}
                  onPress={d.onPress}
                  disabled={!d.onPress}
                  accessibilityRole={d.onPress ? "button" : undefined}
                  accessibilityLabel={`${d.title}, ${d.sub}`}
                  style={({ pressed }) => [
                    styles.line,
                    styles.todayLine,
                    i === 0 ? styles.first : { borderTopColor: c.line },
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <View style={[styles.tick, pill(c)]}>
                    <Icon name={d.icon} size={16} color={c.ink} />
                  </View>
                  <View style={styles.grow}>
                    <RNText numberOfLines={2} style={[styles.todayTitle, { color: c.ink }]}>
                      {d.title}
                    </RNText>
                    <RNText numberOfLines={1} style={[styles.todaySub, { color: d.waiting ? c.amberInk : c.muted }]}>
                      {d.sub}
                    </RNText>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </View>
      </ScrollView>
      {p.talk ? (
        // The page fades out under the button, as it did under the composer it replaces.
        <LinearGradient
          pointerEvents="none"
          colors={[withOpacity(c.bg, 0), withOpacity(c.bg, 0.92), withOpacity(c.bg, 0.92)]}
          locations={[0, 0.62, 1]}
          style={[styles.fade, { height: FADE_H + insets.bottom }]}
        />
      ) : null}
      {p.talk ? (
        <View pointerEvents="box-none" style={[styles.dock, { bottom: insets.bottom + DOCK_FOOT }]}>
          <Button variant="primary" wide label={p.talk.label} disabled={p.talk.disabled} onPress={p.talk.onPress} />
        </View>
      ) : null}
      {p.header}
    </View>
  );
}

function Line({
  label,
  first,
  onPress,
  children,
}: {
  label: string;
  first?: boolean;
  onPress?: (() => void) | undefined;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [
        styles.line,
        first ? styles.first : { borderTopColor: c.line },
        pressed ? styles.pressed : null,
      ]}
    >
      <RNText numberOfLines={1} style={[styles.lineLabel, { color: c.muted }]}>
        {label}
      </RNText>
      <View style={styles.grow}>{children}</View>
    </Pressable>
  );
}

function Tag({ label, leading }: { label: string; leading?: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.tag, pill(c)]}>
      {leading}
      <RNText numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={[styles.tagText, { color: c.ink }]}>
        {label}
      </RNText>
    </View>
  );
}

/** The bot's own color (the identity's §4), for its glow. */
export function botColor(look: AgentLookInput): string {
  return corDoBot(
    botDoAgente({
      name: look.name ?? "",
      handle: look.handle,
      role: look.role,
      id: look.id ?? look.color,
      look: look.shape ? { shape: look.shape, color: look.color, eyes: look.eyes, accessory: look.accessory } : null,
    }),
  );
}

/** `#RRGGBB` at an opacity (anything else as it is). */
export function withOpacity(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return hex;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

type Colors = ReturnType<typeof useColors>;

/** The identity's small glass piece: a faint fill, its 1-point edge, the lit top line. */
export const pill = (c: Colors): StyleProp<ViewStyle> => ({
  backgroundColor: c.plate,
  borderWidth: 1,
  borderColor: c.glassEdge,
  borderTopColor: c.glassTop,
});

/** A card on the stage: one step up, its edge. */
export const card = (c: Colors): StyleProp<ViewStyle> => ({
  backgroundColor: c.raised,
  borderWidth: 1,
  borderColor: c.glassEdge,
});

const TALK_H = 44;
/** The fade under the talk button (the composer's, 170 tall). */
const FADE_H = 130;
/** The talk button 28 over the home indicator's area, where the composer it replaces sat. */
const DOCK_FOOT = 28;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  ambient: { position: "absolute", left: "50%", top: 0, width: 440, height: 380, marginLeft: -220 },
  // 16 from the sides; the face 4 under the bar.
  prof: { alignItems: "center", paddingHorizontal: 16, paddingTop: 4 },
  face: { width: FACE, height: FACE },
  name: { fontFamily: DB_FONTES.titulo700, fontSize: 28, lineHeight: 34, letterSpacing: -0.56, marginTop: 14 },
  role: { fontFamily: DB_FONTES.texto400, fontSize: 15, lineHeight: 20, marginTop: 2, textAlign: "center" },
  now: {
    marginTop: 12,
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  nowText: { fontFamily: DB_FONTES.texto500, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  acts: { flexDirection: "row", gap: 10, marginTop: 20, alignSelf: "stretch" },
  act: { flex: 1, height: 64, borderRadius: 22 },
  actIn: { alignItems: "center", justifyContent: "center", gap: 5 },
  actText: { fontFamily: DB_FONTES.texto500, fontSize: 12.5, lineHeight: 16 },
  off: { opacity: 0.5 },
  box: { alignSelf: "stretch", marginTop: 12, borderRadius: 26, paddingHorizontal: 16, paddingVertical: 6 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  first: { borderTopWidth: 0 },
  pressed: { opacity: 0.6 },
  lineLabel: { fontFamily: DB_FONTES.texto500, fontSize: 14, lineHeight: 20, width: 86 },
  lineText: { fontFamily: DB_FONTES.texto400, fontSize: 14, lineHeight: 20 },
  grow: { flex: 1, minWidth: 0 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { height: 28, paddingHorizontal: 10, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 6 },
  tagText: { fontFamily: DB_FONTES.texto500, fontSize: 12.5, lineHeight: 16 },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  track: { flex: 1, height: 8, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  percent: { fontFamily: DB_FONTES.texto600, fontSize: 13, lineHeight: 18 },
  section: {
    alignSelf: "stretch",
    fontFamily: DB_FONTES.titulo700,
    fontSize: 16,
    lineHeight: 22,
    paddingTop: 18,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  todayLine: { minHeight: 52, paddingVertical: 6 },
  tick: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  todayTitle: { fontFamily: DB_FONTES.texto500, fontSize: 14.5, lineHeight: 18 },
  todaySub: { fontFamily: DB_FONTES.texto400, fontSize: 12.5, lineHeight: 16 },
  dock: { position: "absolute", left: 12, right: 12 },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
