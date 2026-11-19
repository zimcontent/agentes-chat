import type {
  BarsWidgetSpec,
  GoalWidgetSpec,
  KpiWidgetSpec,
  LineWidgetSpec,
  ListWidgetSpec,
  TextWidgetSpec,
} from "@agenteschat/client";
import { widgetCardStatus } from "@agenteschat/client";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, StyleSheet, type TextStyle, View } from "react-native";
import Animated from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { DB_FONTES } from "@/brand/tokens";
import { Icon, PressScale, Text, usePulse } from "@/ui";
import { useAgentLook, useWidgetWords } from "./hooks";
import { formatWidgetNumber, formatWithUnit, goalShare, shownWidgetTitle } from "./logic";
import {
  barsWidth,
  bigRoom,
  fitSize,
  focusBar,
  labelsFit,
  listShown,
  signedArrow,
  TILE_HEIGHT,
  type TileSize,
  tileHue,
  tileSize,
  trendPath,
  trendPoints,
  trendWidth,
  unitJoins,
} from "./tile-look";
import type { WidgetCardData } from "./WidgetView";

/**
 * A widget on a board as the iPhone's own widgets (ADR 0135): a colored tile (its color from its id, `tileHue`: never
 * an alert), the title small on top, the data in big Manrope numbers with a mini chart (bars, a goal's ring, a trend),
 * and under it when it last updated ("atualizado há 5 min"), or that it is updating, waiting or didn't update. Every
 * kind has its shape in each size: S is half a row, M the whole row, L the whole row twice as tall. A tap opens the
 * widget's own screen (its data in full, where it comes from, its routine).
 */
export function WidgetTile({
  id,
  widget: w,
  onPress,
  label,
}: {
  /** The widget's id: its color. */
  id: string;
  widget: WidgetCardData;
  onPress?: () => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const words = useWidgetWords();
  const look = useAgentLook(w.agentId);
  const size = tileSize(w.w, w.h ?? 1);
  // The room inside the tile, measured (0 until then: the sizes of a 390-point phone stand in).
  const [inner, setInner] = useState(0);
  const hue = tileHue(id);
  const title = shownWidgetTitle(w.title, w.kind, (key) => t(key));
  const status = widgetCardStatus({ status: w.status, wait: w.wait ?? null }, words.now);
  const wait = words.wait(w);
  const shows = w.spec && status !== "building";
  const body = shows ? (
    <View style={[styles.fill, status === "failed" || status === "updating" ? styles.dim : null]}>
      <TileBody spec={w.spec as NonNullable<WidgetCardData["spec"]>} size={size} />
    </View>
  ) : (
    <Waiting
      text={
        w.needsAi
          ? t("widgets.needsAi.body", { name: look.name })
          : wait ||
            (status === "failed" ? t("widgets.status.failed") : t("widgets.status.building", { name: look.name }))
      }
      still={Boolean(w.needsAi || wait || status === "failed")}
    />
  );
  // The foot: a wait, an update under way or a failure says so; otherwise when it last updated.
  const foot: { icon?: "pause" | "info" | "bolt"; text: string } | null = !shows
    ? null
    : wait
      ? { icon: "pause", text: wait }
      : status === "updating"
        ? { text: t("widgets.status.updating", { name: look.name }) }
        : status === "failed"
          ? {
              icon: w.needsAi ? "bolt" : "info",
              text: w.needsAi ? t("widgets.needsAi.short") : t("widgets.status.failed"),
            }
          : w.refreshedAt
            ? { text: t("widgets.updatedAgo", { when: words.ago(w.refreshedAt) }) }
            : null;
  const labels = shows && size === "m" && w.spec?.kind === "bars" && status !== "failed" ? w.spec : null;
  const content = (
    <TileInner.Provider value={inner}>
      <LinearGradient
        colors={[hue.top, hue.bottom]}
        start={{ x: 0.32, y: 0 }}
        end={{ x: 0.68, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* The lit top edge of the iPhone's widgets. */}
      <View pointerEvents="none" style={styles.rim} />
      <Words style={styles.title} lines={size === "l" ? 2 : 1}>
        {title}
      </Words>
      {body}
      {foot || labels ? (
        <View style={styles.foot}>
          {foot?.icon ? <Icon name={foot.icon} size={12} color={INK} /> : null}
          <Words style={styles.footText} lines={1}>
            {foot?.text ?? ""}
          </Words>
          {labels ? <BarLabels spec={labels} /> : null}
        </View>
      ) : null}
    </TileInner.Provider>
  );
  const box = [styles.tile, { height: TILE_HEIGHT[size] }];
  const measure = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width) - 2 * PAD_X;
    if (w > 0 && w !== inner) setInner(w);
  };
  if (!onPress)
    return (
      <View style={box}>
        <View style={styles.inside} onLayout={measure}>
          {content}
        </View>
      </View>
    );
  return (
    <PressScale
      to={0.97}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      style={box}
      contentStyle={styles.inside}
      onLayout={measure}
      fill={false}
    >
      {content}
    </PressScale>
  );
}

/** The room inside the tile being drawn, its padding off (0 until measured). */
const TileInner = createContext(0);

/** The tiles' ink: white, and a softer white for what is said under the numbers. */
const INK = "#FFFFFF";
const SOFT = "rgba(255,255,255,0.9)";
/** The most the labels under an M tile's columns may take, beside the foot's words. */
const LABELS_M_ROOM = 170;
/** A tile's sides (its top and bottom are `PAD_TOP`, `PAD_BOTTOM`). */
const PAD_X = 15;

/** Text on a tile: the app's Text in white, kept to its lines and from growing past what the tile holds. */
function Words({
  children,
  style,
  lines,
  fit = false,
}: {
  children: ReactNode;
  style: TextStyle | TextStyle[];
  lines?: number;
  fit?: boolean;
}) {
  return (
    <Text
      numberOfLines={lines}
      maxFontSizeMultiplier={1.15}
      {...(fit ? { adjustsFontSizeToFit: true, minimumFontScale: 0.5 } : {})}
      style={style}
    >
      {children}
    </Text>
  );
}

function TileBody({ spec, size }: { spec: NonNullable<WidgetCardData["spec"]>; size: TileSize }) {
  switch (spec.kind) {
    case "kpi":
      return <Kpi spec={spec} size={size} />;
    case "goal":
      return <Goal spec={spec} size={size} />;
    case "bars":
      return <Bars spec={spec} size={size} />;
    case "line":
      return <LineTile spec={spec} size={size} />;
    case "list":
      return <ListTile spec={spec} size={size} />;
    case "text":
      return <TextTile spec={spec} size={size} />;
  }
}

/** The big number of a tile, its size fitted to its room (`fitSize`). */
function Big({ text, size, place }: { text: string; size: TileSize; place: "m" | "fill" }) {
  const base = place === "m" ? styles.big : size === "l" ? styles.huge : styles.big2;
  const inner = useContext(TileInner);
  const fontSize = fitSize(text, base.fontSize ?? 40, bigRoom(place === "m" ? "m" : size, inner));
  return (
    <Words style={[base, { fontSize, lineHeight: Math.round(fontSize * 1.06) }]} lines={1} fit>
      {text}
    </Words>
  );
}

/** A number with what goes before and after it: "R$ 312", "4 min", "42%". */
function kpiText(spec: KpiWidgetSpec, locale: string): string {
  const n = formatWidgetNumber(spec.value, locale);
  const before = spec.prefix ? `${spec.prefix} ` : "";
  const after = spec.suffix ? (spec.suffix === "%" ? "%" : ` ${spec.suffix}`) : "";
  return `${before}${n}${after}`;
}

/** "↑ 12% vs. ontem": the change with its arrow, then the note (a note that starts with a sign gets its arrow too). */
function ChangeLine({
  change,
  note,
  lines = 1,
}: {
  change?: string | undefined;
  note?: string | undefined;
  lines?: number;
}) {
  if (!change && !note) return null;
  const arrowed = (s: string) => {
    const moved = signedArrow(s);
    return [moved.arrow, moved.text].filter(Boolean).join(" ");
  };
  const text = change ? [arrowed(change), note ?? ""].filter(Boolean).join(" ") : arrowed(note ?? "");
  return (
    <Words style={styles.change} lines={lines}>
      {text}
    </Words>
  );
}

/** The big number: big on M and L with the trend beside or under it; on S a little smaller, the trend at the foot. */
function Kpi({ spec, size }: { spec: KpiWidgetSpec; size: TileSize }) {
  const { i18n } = useTranslation();
  const text = kpiText(spec, i18n.language);
  const trend = spec.spark && spec.spark.length > 1 ? spec.spark : null;
  return (
    <BigWithTrend
      big={text}
      under={<ChangeLine change={spec.delta?.text} note={spec.note} lines={size === "s" ? 1 : 2} />}
      trend={trend}
      size={size}
    />
  );
}

/** A line widget: its latest value big, its line beside (M) or under it. */
function LineTile({ spec, size }: { spec: LineWidgetSpec; size: TileSize }) {
  const { i18n } = useTranslation();
  const last = spec.values[spec.values.length - 1];
  const joins = unitJoins(spec.unit);
  const big = last === undefined ? "" : formatWithUnit(last, joins ? spec.unit?.trim() : undefined, i18n.language);
  const sub = [joins ? "" : (spec.unit?.trim() ?? ""), spec.note ?? ""].filter(Boolean).join(" · ");
  return (
    <BigWithTrend
      big={big}
      under={<ChangeLine note={sub} lines={size === "s" ? 1 : 2} />}
      trend={spec.values.length > 1 ? spec.values : null}
      size={size}
      ends={size === "l" ? [spec.labels[0] ?? "", spec.labels[spec.labels.length - 1] ?? ""] : null}
    />
  );
}

function BigWithTrend({
  big,
  under,
  trend,
  size,
  ends = null,
}: {
  big: string;
  under: ReactNode;
  trend: number[] | null;
  size: TileSize;
  /** The first and last labels under a large tile's line. */
  ends?: [string, string] | null;
}) {
  const inner = useContext(TileInner);
  if (size === "m")
    return (
      <View style={styles.mRow}>
        <View style={styles.grow}>
          <Big text={big} size={size} place="m" />
          {under}
        </View>
        {trend ? <Trend values={trend} width={trendWidth(inner)} height={60} /> : null}
      </View>
    );
  return (
    <View style={styles.fill}>
      <Big text={big} size={size} place="fill" />
      {under}
      {trend ? (
        <View style={styles.trendFoot}>
          <Measured height={size === "l" ? 150 : 34}>
            {(width, height) => <Trend values={trend} width={width} height={height} />}
          </Measured>
          {ends ? (
            <View style={styles.ends}>
              <Words style={styles.axis} lines={1}>
                {ends[0]}
              </Words>
              <Words style={styles.axis} lines={1}>
                {ends[1]}
              </Words>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A box `height` tall as wide as its row, drawn once its width is known. */
function Measured({ height, children }: { height: number; children: (width: number, height: number) => ReactNode }) {
  const [width, setWidth] = useWidthState();
  return (
    <View style={{ height }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width > 0 ? children(width, height) : null}
    </View>
  );
}

function useWidthState(): [number, (n: number) => void] {
  const [width, setWidth] = useState(0);
  return [width, setWidth];
}

/** A trend in white, oldest on the left, a dot on the latest point. */
function Trend({ values, width, height }: { values: number[]; width: number; height: number }) {
  const points = trendPoints(values, width, height, 5);
  const last = points[points.length - 1];
  if (!last) return null;
  return (
    <Svg width={width} height={height} accessible={false}>
      <Path
        d={trendPath(points)}
        fill="none"
        stroke={INK}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={last[0]} cy={last[1]} r={4.5} fill={INK} />
    </Svg>
  );
}

/** Progress towards a goal: a ring with the share in it, the line big under it and the note. */
function Goal({ spec, size }: { spec: GoalWidgetSpec; size: TileSize }) {
  const pct = `${Math.round(spec.pct)}%`;
  if (size === "s")
    return (
      <View style={styles.fill}>
        <Ring share={goalShare(spec.pct)} side={58} text={pct} textStyle={styles.ringS} style={styles.ringBoxS} />
        <Words style={styles.mid} lines={1} fit>
          {spec.line}
        </Words>
        {spec.note ? (
          <Words style={styles.sm} lines={1}>
            {spec.note}
          </Words>
        ) : null}
      </View>
    );
  const big = size === "l";
  return (
    <View style={[styles.fill, big ? styles.goalL : styles.goalM]}>
      <Ring
        share={goalShare(spec.pct)}
        side={big ? 132 : 84}
        text={pct}
        textStyle={big ? styles.ringL : styles.ringM}
      />
      <View style={[styles.grow, big ? null : styles.goalWords]}>
        <Words style={big ? styles.goalLineL : styles.goalLineM} lines={2}>
          {spec.line}
        </Words>
        {spec.note ? (
          <Words style={styles.sm} lines={big ? 4 : 2}>
            {spec.note}
          </Words>
        ) : null}
      </View>
    </View>
  );
}

function Ring({
  share,
  side,
  text,
  textStyle,
  style,
}: {
  share: number;
  side: number;
  text: string;
  textStyle: TextStyle;
  style?: object;
}) {
  // A 40-unit box with a radius-16 ring, as the iPhone's own activity rings: the length of its circle is 2π·16.
  const length = 2 * Math.PI * 16;
  return (
    <View style={[{ width: side, height: side }, style]}>
      <Svg width={side} height={side} viewBox="0 0 40 40">
        <Circle cx={20} cy={20} r={16} stroke="rgba(255,255,255,0.22)" strokeWidth={5} fill="none" />
        {share > 0 ? (
          <Circle
            cx={20}
            cy={20}
            r={16}
            stroke={INK}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${length} ${length}`}
            strokeDashoffset={length * (1 - share)}
            transform="rotate(-90 20 20)"
          />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Words style={textStyle} lines={1}>
          {text}
        </Words>
      </View>
    </View>
  );
}

/**
 * Columns: the one it calls out (the alert's, else the tallest) in solid white and its value big beside them (M) or
 * over them; the note, or that column's label, under the number.
 */
function Bars({ spec, size }: { spec: BarsWidgetSpec; size: TileSize }) {
  const { i18n } = useTranslation();
  const at = focusBar(spec.values, spec.alertIndex);
  const value = spec.values[at];
  const joins = unitJoins(spec.unit);
  const big = value === undefined ? "" : formatWithUnit(value, joins ? spec.unit?.trim() : undefined, i18n.language);
  const sub = spec.note ?? [spec.labels[at] ?? "", joins ? "" : (spec.unit?.trim() ?? "")].filter(Boolean).join(" · ");
  if (size === "m")
    return (
      <View style={styles.mRow}>
        <View style={styles.grow}>
          <Big text={big} size={size} place="m" />
          <ChangeLine note={sub} lines={2} />
        </View>
        <Columns values={spec.values} focus={at} width={barsWidth(spec.values.length)} height={64} />
      </View>
    );
  return (
    <View style={styles.fill}>
      <Big text={big} size={size} place="fill" />
      <ChangeLine note={sub} lines={size === "l" ? 2 : 1} />
      <View style={styles.trendFoot}>
        <Measured height={size === "l" ? 140 : 40}>
          {(width, height) => <Columns values={spec.values} focus={at} width={width} height={height} />}
        </Measured>
        {size === "l" ? <BarLabels spec={spec} slotted /> : null}
      </View>
    </View>
  );
}

/** The column slots of a `width` box: each column's width and the gap between them. */
function columnSlots(n: number, width: number): { col: number; gap: number; bar: number } {
  const gap = n > 12 ? 2 : 6;
  const col = n > 0 ? Math.max(1, (width - gap * (n - 1)) / n) : 0;
  return { col, gap, bar: Math.max(2, Math.min(12, col)) };
}

function Columns({ values, focus, width, height }: { values: number[]; focus: number; width: number; height: number }) {
  const max = Math.max(0, ...values) || 1;
  const { col, gap, bar } = columnSlots(values.length, width);
  return (
    <View style={[styles.columns, { width, height, gap }]} accessible={false}>
      {values.map((v, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the columns of one widget, in order
        <View key={i} style={[styles.column, { width: col }]}>
          <View
            style={{
              width: bar,
              height: Math.max(4, Math.round((Math.max(0, v) / max) * height)),
              borderRadius: Math.min(4, bar / 2),
              backgroundColor: i === focus ? INK : "rgba(255,255,255,0.4)",
            }}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * The columns' labels. On M, in a row ending under the last column ("seg ter qua … hoje"); on L (`slotted`), each
 * under its own column. When they don't all fit, the first and the last, at the two ends.
 */
function BarLabels({ spec, slotted = false }: { spec: BarsWidgetSpec; slotted?: boolean }) {
  const n = spec.values.length;
  const labels = spec.labels.slice(0, n);
  const [measured, setMeasured] = useWidthState();
  // On M the row takes what its words need, up to its room; on L it is the columns' width, measured.
  const room = slotted ? measured : LABELS_M_ROOM;
  const { col, gap } = columnSlots(n, room);
  const all = room > 0 && labelsFit(labels, room, slotted ? { slot: col } : {});
  const label = (text: string, i: number, style?: TextStyle) => (
    <Text key={i} numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.axis, style ?? null]}>
      {text}
    </Text>
  );
  const shown =
    room <= 0
      ? null
      : all
        ? slotted
          ? labels.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the labels, in order
              <View key={i} style={{ width: col, alignItems: "center" }}>
                {label(l, i)}
              </View>
            ))
          : labels.map((l, i) => label(l, i))
        : [label(labels[0] ?? "", 0, styles.endLabel), label(labels[n - 1] ?? "", n - 1, styles.endLabel)];
  return (
    <View
      style={[
        styles.labels,
        slotted ? { gap } : styles.labelsM,
        !all ? styles.labelsEnds : null,
        !slotted && !all ? { width: barsWidth(n) } : null,
      ]}
      onLayout={slotted ? (e) => setMeasured(Math.round(e.nativeEvent.layout.width)) : undefined}
    >
      {shown}
    </View>
  );
}

/** A list: its rows as soft pills, what each says on the right; "mais 3" when they don't all fit. */
function ListTile({ spec, size }: { spec: ListWidgetSpec; size: TileSize }) {
  const { t } = useTranslation();
  const { shown, hidden } = listShown(spec.rows, size);
  return (
    <View style={[styles.fill, styles.rows]}>
      {shown.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the rows of one widget, in order
        <View key={i} style={styles.pill}>
          <Words style={[styles.pillText, size === "s" ? styles.pillTextS : styles.pillTextM, styles.grow]} lines={1}>
            {row.text}
          </Words>
          {row.meta ? (
            <View style={styles.pillMeta}>
              {/* The agent's own word on the row: a light mark beside it, never the tile's color. */}
              {row.tone ? <View style={[styles.toneDot, row.tone === "warn" ? styles.toneWarn : null]} /> : null}
              <Words
                style={[styles.pillText, size === "s" ? styles.pillTextS : styles.pillTextM, styles.metaText]}
                lines={1}
              >
                {row.meta}
              </Words>
            </View>
          ) : null}
        </View>
      ))}
      {hidden > 0 ? (
        <Words style={styles.sm} lines={1}>
          {t("widgets.seeMoreHidden", { count: hidden })}
        </Words>
      ) : null}
    </View>
  );
}

/** A few sentences: on S the first one big; on M and L each after a small mark. */
function TextTile({ spec, size }: { spec: TextWidgetSpec; size: TileSize }) {
  if (size === "s")
    return (
      <View style={[styles.fill, styles.textS]}>
        <Words style={styles.lead} lines={5}>
          {spec.items[0] ?? ""}
        </Words>
      </View>
    );
  const items = size === "l" ? spec.items : spec.items.slice(0, 2);
  return (
    <View style={[styles.fill, styles.items]}>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the sentences of one widget, in order
        <View key={i} style={styles.item}>
          <View style={styles.mark} />
          <Words style={[styles.itemText, styles.grow]} lines={size === "l" ? 4 : 2}>
            {item}
          </Words>
        </View>
      ))}
    </View>
  );
}

/** Before its first data: a soft bar breathing (still once it waits or failed) and what is happening. */
function Waiting({ text, still }: { text: string; still: boolean }) {
  const pulse = usePulse();
  return (
    <View
      style={[styles.fill, styles.waiting]}
      accessibilityRole={still ? "text" : "progressbar"}
      accessibilityLabel={text}
    >
      <Animated.View style={[styles.placeholder, still ? styles.placeholderStill : pulse]} />
      <Words style={styles.sm} lines={3}>
        {text}
      </Words>
    </View>
  );
}

const manrope = (size: number, track = -0.03): TextStyle => ({
  fontFamily: DB_FONTES.titulo800,
  fontWeight: "800",
  fontSize: size,
  lineHeight: Math.round(size * 1.05),
  letterSpacing: track * size,
  color: INK,
  fontVariant: ["tabular-nums"],
});

const styles = StyleSheet.create({
  // The rounded box and its shadow; what is in it (and the gradient behind it) fills `inside`, padded.
  // No box shadow: tiles repeat on a scrolling board, and each shadow is a masked layer the GPU redraws (`surfaces.ts`).
  tile: { borderRadius: 24, overflow: "hidden", minWidth: 0 },
  inside: { flex: 1, minWidth: 0, paddingHorizontal: PAD_X, paddingTop: 14, paddingBottom: 11 },
  rim: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  title: { fontFamily: DB_FONTES.texto600, fontWeight: "600", fontSize: 13, lineHeight: 16, color: INK },
  // What a tile shows never runs into its foot: it is cut at the tile's room (its screen has it whole).
  fill: { flex: 1, minHeight: 0, overflow: "hidden" },
  dim: { opacity: 0.55 },
  grow: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
  mRow: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 6 },
  big: { ...manrope(46), lineHeight: 48 },
  big2: { ...manrope(40), lineHeight: 44, marginTop: 10 },
  huge: { ...manrope(60), lineHeight: 64, marginTop: 12 },
  change: { fontFamily: DB_FONTES.texto600, fontWeight: "600", fontSize: 13, lineHeight: 17, color: SOFT },
  mid: { ...manrope(20, -0.02), lineHeight: 24, marginTop: "auto" },
  sm: { fontFamily: DB_FONTES.texto500, fontWeight: "500", fontSize: 12, lineHeight: 15, color: SOFT },
  trendFoot: { marginTop: "auto", paddingTop: 6, gap: 4 },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  axis: { fontFamily: DB_FONTES.texto500, fontWeight: "500", fontSize: 9.5, lineHeight: 12, color: SOFT },
  endLabel: { textAlign: "left" },
  ringBoxS: { marginTop: 6, marginBottom: 2 },
  ringS: manrope(15, -0.02),
  ringM: manrope(19, -0.02),
  ringL: manrope(30, -0.02),
  goalM: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
  goalL: { gap: 14, marginTop: 12 },
  goalWords: { gap: 2 },
  goalLineM: { ...manrope(24, -0.02), lineHeight: 28 },
  goalLineL: { ...manrope(30, -0.02), lineHeight: 34 },
  columns: { flexDirection: "row", alignItems: "flex-end" },
  column: { alignItems: "center", justifyContent: "flex-end", height: "100%" },
  labels: { flexDirection: "row", flexGrow: 1, flexShrink: 1, minWidth: 0 },
  labelsM: { justifyContent: "flex-end", gap: 5, flexGrow: 0, maxWidth: 170 },
  labelsEnds: { justifyContent: "space-between" },
  rows: { gap: 4, marginTop: 10 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  pillText: { fontFamily: DB_FONTES.texto500, fontWeight: "500", color: INK },
  pillTextS: { fontSize: 12, lineHeight: 16 },
  pillTextM: { fontSize: 13, lineHeight: 18 },
  pillMeta: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0, maxWidth: "50%" },
  metaText: { fontFamily: DB_FONTES.texto600, fontWeight: "600" },
  toneDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: INK },
  toneWarn: { backgroundColor: "#FFE08A" },
  textS: { marginTop: 8 },
  lead: { fontFamily: DB_FONTES.texto600, fontWeight: "600", fontSize: 15, lineHeight: 20, color: INK },
  items: { gap: 6, marginTop: 10 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  mark: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7, backgroundColor: INK },
  itemText: { fontFamily: DB_FONTES.texto500, fontWeight: "500", fontSize: 14, lineHeight: 19, color: INK },
  waiting: { gap: 10, marginTop: 12 },
  placeholder: { height: 28, width: "62%", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.22)" },
  placeholderStill: { opacity: 0.7 },
  foot: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, minHeight: 13 },
  footText: {
    flex: 1,
    minWidth: 0,
    fontFamily: DB_FONTES.texto500,
    fontWeight: "500",
    fontSize: 11,
    lineHeight: 13,
    color: SOFT,
  },
});
