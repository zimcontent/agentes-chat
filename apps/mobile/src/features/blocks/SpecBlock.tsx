import { type BlockChange, useBlockReply, useBlockValues } from "@agenteschat/client";
import type { ChartSpec } from "@agenteschat/client/lib/chart";
import { clockHour } from "@agenteschat/client/lib/format";
import type { AgentColorName } from "@agenteschat/ui/agent/engine";
import {
  type BlockViewPart,
  type BlockWords,
  compileBlock,
  inputValue,
  type MarkedText,
  parseBlockSpec,
  viewBlock,
} from "@agenteschat/ui/blocks/spec";
import * as Clipboard from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { botDoAgente, corDoBot } from "@/brand/bots";
import { Button, fieldText, haptics, Segmented, Text, ToggleSwitch, useReducedMotion, useToast } from "@/ui";
import { useTheme } from "@/ui/theme";

import { ChartView } from "../chat/ChartCard";
import { keepSize, keptHeightAfter, keptSize, PAST_RULE } from "../chat/kept-sizes";
import { useLayoutKey } from "../chat/look";
import { Table } from "../chat/MessageSpans";
import { useColors, useDirectory, useOrgId } from "../shared/hooks";
import { agentLook } from "../shared/logic";
import { tapHaptic } from "../shared/parts";
import { INLINE_HEIGHT } from "./logic";
import { PieceViewer } from "./PieceViewer";

/**
 * What the copy parts need from the block: the agent's bot color (its marks), a button's message to the agent
 * (`say`, sent at once), which buttons already sent theirs, and a note about one piece written on the whole screen
 * (`note`, true once it went).
 */
const Copy = createContext<{
  accent: string;
  say: (key: string, text: string) => void;
  said: ReadonlySet<string>;
  busy: boolean;
  agentName: string;
  note: (text: string) => Promise<boolean>;
}>({
  accent: "#9be22d",
  say: () => {},
  said: new Set(),
  busy: false,
  agentName: "",
  note: async () => false,
});

/** A "#rrggbb" with an opacity, as "#rrggbbaa". */
const alpha = (hex: string, a: number) =>
  /^#[0-9a-f]{6}$/i.test(hex)
    ? `${hex}${Math.round(a * 255)
        .toString(16)
        .padStart(2, "0")}`
    : hex;

type Sent = { text: string; at: string };
/** What this person sent from a block and whether they opened it whole, kept while the app runs. */
const kept = new Map<string, { sent?: Sent; open?: boolean; said?: Set<string> }>();
const keptOf = (key: string) => {
  let k = kept.get(key);
  if (!k) {
    k = {};
    kept.set(key, k);
  }
  return k;
};

type Values = ReturnType<typeof useBlockValues>;

/**
 * A live block drawn by the app itself (ADR 0113): the parts the agent described, with the app's own controls, over
 * the state everyone in the conversation shares. Nothing the agent wrote runs on the phone: its words reach the screen
 * only as text, and its formulas are read by our interpreter (`@agenteschat/ui/blocks/spec`). So it needs no web view,
 * draws at once with the message, and any number of them can be on screen.
 */
export function SpecBlock({
  id,
  version,
  spec: raw,
  agentId,
  screen = false,
}: {
  id: string;
  version: number;
  spec: Record<string, unknown>;
  agentId: string;
  screen?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const orgId = useOrgId();
  const dir = useDirectory();
  const toast = useToast();
  const agent = dir.agentById.get(agentId);
  const look = agentLook(agent);
  const accent = look.color;
  const botColor = corDoBot(
    botDoAgente({
      name: agent?.name ?? "",
      handle: agent?.handle,
      role: agent?.role,
      id: agent?.id ?? look.color,
      look: look.shape ? { shape: look.shape, color: look.color, eyes: look.eyes, accessory: look.accessory } : null,
    }),
  );
  const blockKey = `${id}@${version}`;
  const compiled = useMemo(() => {
    try {
      return compileBlock(parseBlockSpec(raw));
    } catch {
      return null;
    }
  }, [raw]);
  const values = useBlockValues(orgId, id, version);
  const reply = useBlockReply(orgId, id);
  const thousand = t("mobile.blocks.thousand");
  const words = useMemo<BlockWords>(() => ({ locale: i18n.language, thousand }), [i18n.language, thousand]);
  const view = useMemo(
    () => (compiled ? viewBlock(compiled, values.state, words) : null),
    [compiled, values.state, words],
  );
  const [sent, setSent] = useState<Sent | null>(keptOf(blockKey).sent ?? null);
  const [open, setOpen] = useState(keptOf(blockKey).open ?? false);
  // How tall its parts are whole, kept across the list's unmounts (`kept-sizes.ts`): a block coming back is cut from
  // its first frame. Never measured yet, it shows no taller than the card, a point past it (`PAST_RULE`): a tall one
  // drew whole for a frame and then shrank, moving every row under it as the person scrolled. Its own for each version,
  // width and text size: the height of the one before is not this one's (a shorter one stayed cut over blank space).
  const sizeKey = `spec:${blockKey}:${useLayoutKey()}`;
  const [sized, setSized] = useState(() => ({ key: sizeKey, height: keptSize(sizeKey) ?? 0 }));
  if (sized.key !== sizeKey) setSized({ key: sizeKey, height: keptSize(sizeKey) ?? 0 });
  const height = sized.height;
  const [said, setSaid] = useState<ReadonlySet<string>>(() => new Set(keptOf(blockKey).said));

  if (!compiled || !view) {
    return (
      <View style={styles.broken}>
        <Text variant="subhead" style={styles.bold}>
          {t("blocks.brokenTitle")}
        </Text>
        <Text variant="footnote" tone="muted">
          {t("blocks.brokenBody")}
        </Text>
      </View>
    );
  }

  const tall = !screen && height > INLINE_HEIGHT;
  // Cut at the card's height, or under the cap before the first measure: a text there reads no taller than its room,
  // so a measure taken then only ever raises the height kept (`keptHeightAfter`). Kept as measured, a block with one
  // long text read short cut, showed whole, read tall and was cut again, on every layout. Opened, it has no cap at all.
  const capped = !screen && !open && (tall || height === 0);
  const openWhole = () => {
    tapHaptic();
    keptOf(blockKey).open = true;
    setOpen(true);
  };
  const send = () => {
    const draft = view.send;
    if (!draft?.ready || reply.isPending) return;
    tapHaptic();
    const text = draft.text;
    reply.mutate(
      { text, clientId: randomUUID() },
      {
        onSuccess: () => {
          const done = { text, at: new Date().toISOString() };
          keptOf(blockKey).sent = done;
          setSent(done);
        },
        onError: () => toast({ title: t("mobile.blocks.sendFailed"), icon: "x" }),
      },
    );
  };
  const same = sent !== null && sent.text === view.send?.text;
  const say = (key: string, text: string) => {
    if (reply.isPending) return;
    tapHaptic();
    reply.mutate(
      { text, clientId: randomUUID() },
      {
        onSuccess: () => {
          const next = new Set(said).add(key);
          keptOf(blockKey).said = next;
          setSaid(next);
          haptics.success();
        },
        onError: () => toast({ title: t("mobile.blocks.sendFailed"), icon: "x" }),
      },
    );
  };
  const note = (text: string) =>
    new Promise<boolean>((done) => {
      reply.mutate(
        { text, clientId: randomUUID() },
        {
          onSuccess: () => done(true),
          onError: () => {
            toast({ title: t("mobile.blocks.sendFailed"), icon: "x" });
            done(false);
          },
        },
      );
    });
  const time = sent
    ? new Intl.DateTimeFormat(i18n.language, { hour: clockHour(i18n.language), minute: "2-digit" }).format(
        new Date(sent.at),
      )
    : "";

  return (
    <View>
      <View style={capped ? (tall ? styles.cut : styles.unmeasured) : undefined}>
        <View
          style={styles.body}
          onLayout={(e: LayoutChangeEvent) => {
            // Under the cut a clamped text fills its room, so a reading below the cut is the parts' whole height.
            const next = keptHeightAfter(height, Math.ceil(e.nativeEvent.layout.height), capped, INLINE_HEIGHT);
            if (next === null) return;
            keepSize(sizeKey, next);
            setSized((now) => (now.key === sizeKey ? { key: sizeKey, height: next } : now));
          }}
        >
          <Copy.Provider
            value={{ accent: botColor, say, said, busy: reply.isPending, agentName: agent?.name ?? "", note }}
          >
            <Parts parts={view.parts} values={values} accent={accent} />
          </Copy.Provider>
        </View>
        {tall && !open ? (
          <LinearGradient pointerEvents="none" colors={[`${c.raised}00`, c.raised]} style={styles.fade} />
        ) : null}
      </View>
      {tall && !open ? (
        <View style={styles.more}>
          <Button variant="ghost" size="sm" icon="down" label={t("channel.long.more")} onPress={openWhole} />
        </View>
      ) : null}
      {view.send ? (
        same ? (
          <View style={[styles.foot, { borderTopColor: c.line2 }]}>
            <View style={styles.sent}>
              <View style={[styles.mark, { backgroundColor: c.ok }]} />
              <Text variant="footnote" tone="muted">
                {t("mobile.blocks.sentAt", { time })}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.foot, { borderTopColor: c.line2 }]}>
            <Text variant="footnote" tone="muted">
              {view.send.ready
                ? `${t("mobile.blocks.goesTo", { name: agent?.name ?? "" })} ${view.send.text}`
                : view.send.hint}
            </Text>
            <Button
              variant="primary"
              wide
              label={view.send.label}
              disabled={!view.send.ready}
              loading={reply.isPending}
              onPress={send}
            />
          </View>
        )
      ) : null}
    </View>
  );
}

function Parts({ parts, values, accent }: { parts: BlockViewPart[]; values: Values; accent: AgentColorName }) {
  return (
    <>
      {parts.map((p) => (
        <Part key={p.key} part={p} values={values} accent={accent} />
      ))}
    </>
  );
}

function Part({ part: p, values, accent }: { part: BlockViewPart; values: Values; accent: AgentColorName }) {
  const c = useColors();
  const copy = useContext(Copy);
  const { t } = useTranslation();
  const set = (raw: unknown) => {
    const name = "name" in p ? p.name : undefined;
    if (typeof name !== "string") return;
    const v = inputValue(p, raw);
    if (v !== undefined) values.set({ [name]: v });
  };
  switch (p.kind) {
    case "heading":
      return (
        <Text variant="callout" style={styles.heading}>
          {p.text}
        </Text>
      );
    case "text":
      return (
        <Text variant="subhead" tone="ink2">
          {p.text}
        </Text>
      );
    case "note":
      return (
        <Text variant="footnote" tone="faint">
          {p.text}
        </Text>
      );
    case "list":
      return (
        <View style={styles.list}>
          {p.items.map((item, i) => (
            // Lines of one list have no id but their place.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <View key={i} style={styles.listRow}>
              <Text variant="subhead" tone="faint">
                •
              </Text>
              <Text variant="subhead" tone="ink2" style={styles.flex}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      );
    case "slider":
      return (
        <View>
          <Label text={p.label} value={p.shown} />
          <Slider part={p} onChange={set} />
        </View>
      );
    case "choice":
      return (
        <View>
          {p.label ? <Label text={p.label} /> : null}
          <Segmented items={p.options.map((o) => ({ key: o, label: o }))} value={p.value ?? ""} onChange={set} />
        </View>
      );
    case "field":
      return <Field part={p} onChange={set} />;
    case "switch":
      return (
        <Pressable
          onPress={() => {
            haptics.selection();
            set(!p.value);
          }}
          accessibilityRole="switch"
          accessibilityLabel={p.label}
          accessibilityState={{ checked: p.value }}
          style={styles.switch}
        >
          <Text variant="subhead" tone="ink2" style={[styles.flex, styles.semi]}>
            {p.label}
          </Text>
          <ToggleSwitch value={p.value} />
        </Pressable>
      );
    case "stats":
      return (
        <View style={styles.stats}>
          {p.items.map((s) => (
            <View key={s.key} style={[styles.stat, { backgroundColor: c.sunken, borderColor: c.line }]}>
              <Text variant="footnote" tone="muted">
                {s.label}
              </Text>
              <Text variant="title2" numberOfLines={1} adjustsFontSizeToFit style={styles.number}>
                {s.text}
              </Text>
              {s.sub ? (
                <Text variant="caption" tone={s.tone === "up" ? "ok" : s.tone === "down" ? "danger" : "faint"}>
                  {s.sub}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      );
    case "result":
      return <Result label={p.label} text={p.text} change={p.name ? values.changes[p.name] : undefined} />;
    case "progress":
      return (
        <View>
          <Label text={p.label} value={p.text} />
          <View style={[styles.track, { backgroundColor: c.plate }]}>
            <View style={[styles.fill, { width: `${p.share * 100}%`, backgroundColor: c.ink }]} />
          </View>
        </View>
      );
    case "chart":
      return <BlockChart part={p} accent={accent} />;
    case "table":
      return (
        <Table
          header={p.columns.map((text) => [{ kind: "text", text }])}
          rows={p.rows.map((row) => row.map((text) => [{ kind: "text", text }]))}
          align={p.columns.map(() => "left")}
          surface={c.raised}
        />
      );
    case "more":
      return <More label={p.label} parts={p.parts} values={values} accent={accent} />;
    case "row":
      return (
        <View style={styles.row}>
          {p.parts.map((child) => (
            <View key={child.key} style={styles.rowItem}>
              <Part part={child} values={values} accent={accent} />
            </View>
          ))}
        </View>
      );
    case "card": {
      const inner = (
        <>
          {p.label || p.sub ? (
            <View style={styles.cardHead}>
              {p.label ? (
                <Text variant="subhead" style={styles.bold}>
                  {p.label}
                </Text>
              ) : null}
              {p.sub ? (
                <Text variant="footnote" tone="faint">
                  {p.sub}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Parts parts={p.parts} values={values} accent={accent} />
        </>
      );
      const look = [
        styles.card,
        { backgroundColor: c.raised, borderColor: p.selected ? c.ink : c.line2 },
        p.selected ? styles.cardOn : null,
      ];
      if (!p.pick) return <View style={look}>{inner}</View>;
      const pick = p.pick;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: p.selected }}
          onPress={() => {
            haptics.selection();
            values.set({ [pick.name]: pick.value });
          }}
          style={({ pressed }) => [look, pressed ? styles.pressed : null]}
        >
          {inner}
        </Pressable>
      );
    }
    case "actions":
      // Buttons that speak for the person ("Pedir ajuste", "Aprovar"): the last is the main answer, full width.
      if (p.buttons.some((b) => b.say !== null)) {
        const rest = p.buttons.slice(0, -1);
        const main = p.buttons[p.buttons.length - 1];
        const button = (b: (typeof p.buttons)[number], lead: boolean) => {
          const done = copy.said.has(b.key);
          return (
            <Button
              key={b.key}
              variant={lead ? "primary" : "secondary"}
              wide
              label={done ? t("blocks.said") : b.label}
              icon={done ? "check" : undefined}
              disabled={done || (b.say !== null && copy.busy)}
              onPress={() => {
                if (b.set) values.set(b.set);
                if (b.draw) void values.draw(b.draw.name, b.draw.options);
                if (b.say) copy.say(b.key, b.say);
                else tapHaptic();
              }}
            />
          );
        };
        return (
          <View style={styles.sayActions}>
            {rest.length ? (
              <View style={styles.sayRow}>
                {rest.map((b) => (
                  <View key={b.key} style={styles.sayCell}>
                    {button(b, false)}
                  </View>
                ))}
              </View>
            ) : null}
            {main ? button(main, true) : null}
          </View>
        );
      }
      return (
        <View
          style={[
            styles.actions,
            { justifyContent: p.align === "center" ? "center" : p.align === "start" ? "flex-start" : "flex-end" },
          ]}
        >
          {p.buttons.map((b) => (
            <Button
              key={b.key}
              variant={b.lead ? "primary" : "secondary"}
              size="sm"
              label={b.label}
              onPress={() => {
                tapHaptic();
                if (b.set) values.set(b.set);
                if (b.draw) void values.draw(b.draw.name, b.draw.options);
              }}
            />
          ))}
        </View>
      );
    case "tags":
      return (
        <View style={styles.tags}>
          {p.items.map((tag, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: tags have no id but their place
              key={i}
              style={[
                styles.tag,
                i === 0
                  ? { backgroundColor: alpha(copy.accent, 0.24), borderColor: alpha(copy.accent, 0.7) }
                  : { backgroundColor: c.sunken, borderColor: c.line2 },
              ]}
            >
              <Text variant="caption" tone={i === 0 ? "ink" : "ink2"} style={i === 0 ? styles.bold : styles.semi}>
                {tag}
              </Text>
            </View>
          ))}
        </View>
      );
    case "hook":
      return (
        <View>
          {p.label ? <Eyebrow text={p.label} /> : null}
          <Text variant="title" style={styles.hook}>
            <Marked text={p.text} color={copy.accent} />
          </Text>
        </View>
      );
    case "slides":
      return <Slides part={p} />;
    case "poster":
      return <Poster part={p} />;
    case "fields":
      return (
        <View style={styles.fields}>
          {p.items.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one list, in order
            <View key={i}>
              <Text variant="footnote" tone="muted">
                {f.label}
              </Text>
              <Text variant="subhead">{f.value}</Text>
            </View>
          ))}
        </View>
      );
    case "copy":
      return <CopyText label={p.label} text={p.text} />;
    case "timeline":
      return <Timeline part={p} />;
  }
}

function Eyebrow({ text }: { text: string }) {
  return (
    <Text variant="caption" tone="muted" style={styles.eyebrow}>
      {text.toUpperCase()}
    </Text>
  );
}

/** A text with its marked words on a band of the agent's color. */
function Marked({ text, color }: { text: MarkedText; color: string }) {
  return (
    <>
      {text.before}
      {text.mark ? <Text style={{ backgroundColor: alpha(color, 0.42) }}>{text.mark}</Text> : null}
      {text.after}
    </>
  );
}

const SLIDE = 132;
/** The viewer draws a piece at the screen's width and the type grows with it, up to what a 4:5 card still holds. */
const BIG_FROM = 240;

/** One slide of a carousel at a given width: its number and tag, its title and its text, larger when it is large. */
function SlideFace({
  item: x,
  index: i,
  width,
}: {
  item: Extract<BlockViewPart, { kind: "slides" }>["items"][number];
  index: number;
  width: number;
}) {
  const c = useColors();
  const copy = useContext(Copy);
  const big = width >= BIG_FROM;
  return (
    <View
      style={[
        styles.slide,
        big ? styles.slideBig : null,
        { width, backgroundColor: c.sunken, borderColor: x.tag ? alpha(copy.accent, 0.7) : c.line2 },
      ]}
    >
      {x.tag && i === 0 ? (
        <LinearGradient
          pointerEvents="none"
          colors={[alpha(copy.accent, 0.32), alpha(copy.accent, 0)]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.6, y: 0.8 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Text variant={big ? "footnote" : "caption"} tone="faint" style={styles.bold}>
        {String(i + 1).padStart(2, "0")}
        {x.tag ? ` · ${x.tag.toUpperCase()}` : ""}
      </Text>
      <Text variant={big ? "title2" : "footnote"} style={[big ? styles.posterTitle : styles.bold, styles.slideTitle]}>
        {x.title}
      </Text>
      {x.text ? (
        <Text variant={big ? "body" : "caption"} tone={big ? "ink2" : "muted"}>
          {x.text}
        </Text>
      ) : null}
    </View>
  );
}

/** A static post as it will look, at a given width (the conversation caps it, the viewer fills the screen). */
function PosterFace({ part: p, width }: { part: Extract<BlockViewPart, { kind: "poster" }>; width?: number }) {
  const c = useColors();
  const copy = useContext(Copy);
  const big = width !== undefined && width >= BIG_FROM;
  return (
    <View
      style={[
        styles.poster,
        width !== undefined ? { width, maxWidth: width } : null,
        big ? styles.posterBig : null,
        { backgroundColor: c.sunken, borderColor: alpha(copy.accent, 0.6) },
      ]}
      accessible
      accessibilityLabel={[p.eyebrow, `${p.title.before}${p.title.mark}${p.title.after}`, p.sub, p.button]
        .filter(Boolean)
        .join(". ")}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(copy.accent, 0.38), alpha(copy.accent, 0)]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 0.75 }}
        style={StyleSheet.absoluteFill}
      />
      {p.eyebrow ? (
        <Text variant={big ? "footnote" : "caption"} tone="ink2" style={styles.posterEyebrow}>
          {p.eyebrow}
        </Text>
      ) : null}
      <Text variant={big ? "display2" : "title2"} style={styles.posterTitle}>
        {p.title.before}
        {p.title.mark ? <Text style={{ color: copy.accent }}>{p.title.mark}</Text> : null}
        {p.title.after}
      </Text>
      {p.sub ? (
        <Text variant={big ? "body" : "footnote"} tone="ink2">
          {p.sub}
        </Text>
      ) : null}
      {p.button ? (
        <View style={[styles.posterButton, { backgroundColor: copy.accent }]}>
          <Text variant={big ? "subhead" : "footnote"} style={[styles.bold, { color: "#0b0b0b" }]}>
            {p.button}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A tap opens the piece on the whole screen: what a thumbnail can't show, and where a note about it is written. */
function Opens({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {children}
    </Pressable>
  );
}

/** A static post in the conversation: tapped, it opens on the whole screen. */
function Poster({ part }: { part: Extract<BlockViewPart, { kind: "poster" }> }) {
  const { t } = useTranslation();
  const copy = useContext(Copy);
  const [open, setOpen] = useState(false);
  const title = `${part.title.before}${part.title.mark}${part.title.after}`.trim();
  return (
    <>
      <Opens label={t("mobile.blocks.openPiece")} onPress={() => setOpen(true)}>
        <PosterFace part={part} />
      </Opens>
      <PieceViewer
        visible={open}
        title={part.eyebrow || t("mobile.blocks.posterTitle")}
        pages={[
          { about: t("mobile.blocks.aboutPoster", { title }), face: (w) => <PosterFace part={part} width={w} /> },
        ]}
        start={0}
        agentName={copy.agentName}
        onClose={() => setOpen(false)}
        onNote={copy.note}
      />
    </>
  );
}

/** A reel's script beat by beat; a tapped beat opens the script on the whole screen at that beat. */
function Timeline({ part: p }: { part: Extract<BlockViewPart, { kind: "timeline" }> }) {
  const { t } = useTranslation();
  const c = useColors();
  const copy = useContext(Copy);
  const { fonts } = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  const beat = (x: (typeof p.items)[number], big: boolean) => (
    <>
      <Text
        variant={big ? "subhead" : "caption"}
        style={[styles.time, styles.bold, { color: copy.accent, fontFamily: fonts.mono }]}
      >
        {x.time}
      </Text>
      <Text variant={big ? "title" : "subhead"}>{x.text}</Text>
      {x.note ? (
        <Text variant={big ? "body" : "footnote"} tone="muted">
          {x.note}
        </Text>
      ) : null}
      {x.screen ? (
        <View style={[styles.screen, { backgroundColor: c.sunken, borderColor: c.line2 }]}>
          <Text variant={big ? "subhead" : "caption"} tone="ink2" style={styles.bold}>
            {x.screen}
          </Text>
        </View>
      ) : null}
    </>
  );
  return (
    <View>
      {p.label ? <Eyebrow text={p.label} /> : null}
      <View style={[styles.timeline, { borderLeftColor: c.line2 }]}>
        {p.items.map((x, i) => (
          <Opens
            // biome-ignore lint/suspicious/noArrayIndexKey: the beats of one script, in order
            key={i}
            label={t("mobile.blocks.openPiece")}
            onPress={() => setOpen(i)}
          >
            <View
              style={[styles.beat, i > 0 ? { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth } : null]}
            >
              <View style={[styles.dot, { backgroundColor: i === 0 ? copy.accent : c.faint }]} />
              {beat(x, false)}
            </View>
          </Opens>
        ))}
      </View>
      <PieceViewer
        visible={open !== null}
        title={p.label || t("mobile.blocks.reelTitle")}
        pages={p.items.map((x) => ({
          about: t("mobile.blocks.aboutBeat", { time: x.time }),
          face: (w) => (
            <View style={[styles.beatBig, { width: w, backgroundColor: c.raised, borderColor: c.line2 }]}>
              {beat(x, true)}
            </View>
          ),
        }))}
        start={open ?? 0}
        agentName={copy.agentName}
        onClose={() => setOpen(null)}
        onNote={copy.note}
      />
    </View>
  );
}

/** A carousel's slides side by side, swiped sideways and snapping per slide, with a dot for each; a tap opens them big. */
function Slides({ part }: { part: Extract<BlockViewPart, { kind: "slides" }> }) {
  const { t } = useTranslation();
  const c = useColors();
  const copy = useContext(Copy);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <View style={styles.slidesWrap}>
      {part.label ? <Eyebrow text={part.label} /> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SLIDE + 8}
        decelerationRate="fast"
        style={styles.slidesScroll}
        contentContainerStyle={styles.slides}
        scrollEventThrottle={32}
        onScroll={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / (SLIDE + 8)))}
      >
        {part.items.map((x, i) => (
          <Opens
            // biome-ignore lint/suspicious/noArrayIndexKey: the slides of one carousel, in order
            key={i}
            label={t("mobile.blocks.openSlide", { at: i + 1 })}
            onPress={() => setOpen(i)}
          >
            <SlideFace item={x} index={i} width={SLIDE} />
          </Opens>
        ))}
      </ScrollView>
      {part.items.length > 2 ? (
        <View style={styles.dots}>
          {part.items.map((_, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: one dot per slide
              key={i}
              style={[styles.dotSmall, { backgroundColor: i === at ? copy.accent : c.line2 }]}
            />
          ))}
        </View>
      ) : null}
      <PieceViewer
        visible={open !== null}
        title={part.label || t("mobile.blocks.carouselTitle")}
        pages={part.items.map((x, i) => ({
          about: t("mobile.blocks.aboutSlide", { at: i + 1, title: x.title }),
          face: (w) => <SlideFace item={x} index={i} width={w} />,
        }))}
        start={open ?? 0}
        agentName={copy.agentName}
        onClose={() => setOpen(null)}
        onNote={copy.note}
      />
    </View>
  );
}

/** Text to paste as is (a caption), with its Copy button on the label's line. */
function CopyText({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <View>
      <View style={styles.copyHead}>
        <View style={styles.flex}>{label ? <Eyebrow text={label} /> : null}</View>
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? "check" : "copy"}
          label={copied ? t("blocks.copied") : t("blocks.copy")}
          onPress={() => {
            void Clipboard.setStringAsync(text).then(() => {
              haptics.success();
              setCopied(true);
            });
          }}
        />
      </View>
      <View style={[styles.copyBox, { backgroundColor: c.sunken, borderColor: c.line2 }]}>
        <Text variant="subhead" tone="ink2" selectable>
          {text}
        </Text>
      </View>
    </View>
  );
}

function Label({ text, value }: { text: string; value?: string }) {
  return (
    <View style={styles.label}>
      <Text variant="footnote" tone="muted" style={[styles.flex, styles.semi]}>
        {text}
      </Text>
      {value !== undefined ? (
        <Text variant="footnote" style={[styles.bold, styles.number]}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

const THUMB = 22;

/**
 * The kit's slider on the phone: a track that fills with ink and a cut-corner thumb, dragged sideways (a vertical
 * drag stays the conversation's scroll) or tapped. It snaps to the part's step and says each new value as it lands.
 */
function Slider({
  part,
  onChange,
}: {
  part: Extract<BlockViewPart, { kind: "slider" }>;
  onChange: (value: number) => void;
}) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const { min, max, step, value } = part;
  const share = (value - min) / (max - min);
  const x = useSharedValue(share);
  const track = useSharedValue(0);
  const dragging = useSharedValue(false);
  useEffect(() => {
    if (!dragging.value) x.value = share;
  }, [share, x, dragging]);
  const last = useRef(value);
  const shareNow = useRef(share);
  shareNow.current = share;
  // Let go between two steps: the thumb lands on the step the value took.
  const settle = () => {
    x.value = withTiming(shareNow.current, { duration: 120 });
  };
  const land = (to: number) => {
    const exact = min + Math.round((to * (max - min)) / step) * step;
    const next = Number(Math.min(max, Math.max(min, exact)).toFixed(10));
    if (next === last.current) return;
    last.current = next;
    haptics.selection();
    onChange(next);
  };
  const follow = (px: number) => {
    "worklet";
    const w = track.value;
    if (w <= 0) return;
    const to = Math.min(1, Math.max(0, (px - THUMB / 2) / Math.max(1, w - THUMB)));
    x.value = to;
    scheduleOnRN(land, to);
  };
  const pan = usePanGesture({
    // Sideways only: a vertical drag stays the conversation's scroll.
    activeOffsetX: [-3, 3],
    failOffsetY: [-14, 14],
    maxPointers: 1,
    onActivate: (e) => {
      "worklet";
      dragging.value = true;
      follow(e.x);
    },
    onUpdate: (e) => {
      "worklet";
      follow(e.x);
    },
    onDeactivate: () => {
      "worklet";
      dragging.value = false;
      scheduleOnRN(settle);
    },
  });
  const tap = useTapGesture({
    onDeactivate: (e) => {
      "worklet";
      if (e.canceled) return;
      follow(e.x);
      scheduleOnRN(settle);
    },
  });
  const gesture = useExclusiveGestures(pan, tap);
  const fill = useAnimatedStyle(() => ({ width: THUMB / 2 + x.value * Math.max(0, track.value - THUMB) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * Math.max(0, track.value - THUMB) }] }));
  const nudge = (by: number) => onChange(Math.min(max, Math.max(min, Number((value + by).toFixed(10)))));
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.slider}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
          track.value = e.nativeEvent.layout.width;
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={part.label}
        accessibilityValue={{ text: part.shown }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === "increment" ? step : -step)}
      >
        <View style={[styles.rail, { backgroundColor: c.line2 }]} />
        {width > 0 ? (
          <>
            <Animated.View style={[styles.rail, { backgroundColor: c.ink }, fill]} />
            <Animated.View style={[styles.thumb, { borderColor: c.line2 }, thumb]} />
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function Field({
  part,
  onChange,
}: {
  part: Extract<BlockViewPart, { kind: "field" }>;
  onChange: (value: string) => void;
}) {
  const c = useColors();
  const big = part.input === "textarea";
  return (
    <View>
      <Label text={part.label} />
      <TextInput
        value={part.value}
        onChangeText={onChange}
        placeholder={part.placeholder}
        placeholderTextColor={c.faint}
        multiline={big}
        keyboardType={part.input === "number" ? "decimal-pad" : "default"}
        accessibilityLabel={part.label}
        style={[
          styles.field,
          fieldText("body"),
          { color: c.ink, backgroundColor: c.raised, borderColor: c.line2 },
          big ? styles.fieldBig : null,
        ]}
      />
    </View>
  );
}

function More({
  label,
  parts,
  values,
  accent,
}: {
  label: string;
  parts: BlockViewPart[];
  values: Values;
  accent: AgentColorName;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tapHaptic();
          setOpen((o) => !o);
        }}
        hitSlop={8}
        style={styles.moreHead}
      >
        <Text variant="footnote" tone="muted" style={styles.bold}>
          {open ? "▾" : "▸"} {label || t("mobile.blocks.more")}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.moreBody}>
          <Parts parts={parts} values={values} accent={accent} />
        </View>
      ) : null}
    </View>
  );
}

/** The block's answer, large. A value the server just drew rolls into place, the same moment for everyone. */
function Result({ label, text, change }: { label: string; text: string; change: BlockChange | undefined }) {
  const c = useColors();
  const reduced = useReducedMotion();
  const y = useSharedValue(0);
  const fade = useSharedValue(1);
  const first = useRef(true);
  const drawnAt = change?.drawn ? change.at : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new draw is a new `at`
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!drawnAt || reduced) return;
    y.value = withSequence(withTiming(-28, { duration: 0 }), withSpring(0, { stiffness: 260, damping: 14 }));
    fade.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
    haptics.success();
  }, [drawnAt]);
  const rolled = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: fade.value }));
  return (
    <View style={[styles.result, { backgroundColor: c.sunken, borderColor: c.line }]}>
      <Text variant="footnote" tone="muted">
        {label}
      </Text>
      <Animated.View style={rolled}>
        <Text variant="title2" style={styles.number} accessibilityLiveRegion="polite">
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

/** A chart in the block, drawn like a message's chart. Too few points to draw shows nothing. */
function BlockChart({ part, accent }: { part: Extract<BlockViewPart, { kind: "chart" }>; accent: AgentColorName }) {
  const values = part.chart === "pie" ? part.values.map((v) => Math.max(0, v)) : part.values;
  const spec: ChartSpec = {
    type: part.chart,
    title: part.label,
    labels: part.labels,
    series: [{ name: "", values }],
    ...(part.unit ? { unit: part.unit } : {}),
  };
  const enough =
    part.chart === "bar"
      ? values.length >= 1
      : values.length >= 2 && (part.chart !== "pie" || values.some((v) => v > 0));
  if (!enough) return null;
  return (
    <View>
      {part.label ? <Label text={part.label} /> : null}
      <ChartView spec={spec} accent={accent} still />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 14 },
  cut: { height: INLINE_HEIGHT, overflow: "hidden" },
  unmeasured: { maxHeight: INLINE_HEIGHT + PAST_RULE, overflow: "hidden" },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 56 },
  more: { alignItems: "center", paddingBottom: 8 },
  foot: { gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  sent: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 5, height: 5 },
  broken: { gap: 2, padding: 14 },
  bold: { fontWeight: "600" },
  semi: { fontWeight: "500" },
  heading: { fontWeight: "600" },
  flex: { flex: 1 },
  number: { fontVariant: ["tabular-nums"], fontWeight: "600" },
  list: { gap: 2 },
  listRow: { flexDirection: "row", gap: 8 },
  label: { flexDirection: "row", alignItems: "baseline", gap: 12, marginBottom: 6 },
  slider: { height: 36, justifyContent: "center" },
  rail: { position: "absolute", left: 0, height: 6, borderRadius: 999, right: 0 },
  thumb: {
    position: "absolute",
    left: 0,
    width: THUMB,
    height: THUMB,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    borderBottomLeftRadius: 3,
    backgroundColor: "#ffffff",
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0px 2px 5px 0px rgba(23, 23, 22, 0.2)",
  },
  switch: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    flexGrow: 1,
    flexBasis: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  result: {
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  track: { height: 8, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  rowItem: { flexGrow: 1, flexBasis: 140, gap: 12 },
  card: {
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardOn: { borderWidth: 1.6 },
  pressed: { opacity: 0.85 },
  cardHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldBig: { minHeight: 88, textAlignVertical: "top" },
  moreHead: { alignSelf: "flex-start", minHeight: 28, justifyContent: "center" },
  moreBody: { gap: 10, marginTop: 6 },
  sayActions: { gap: 8 },
  sayRow: { flexDirection: "row", gap: 8 },
  sayCell: { flex: 1 },
  eyebrow: { fontWeight: "600", letterSpacing: 0.6, marginBottom: 4 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  hook: { fontWeight: "700", letterSpacing: -0.2 },
  slidesWrap: { gap: 6 },
  slidesScroll: { marginHorizontal: -14 },
  slides: { gap: 8, paddingHorizontal: 14 },
  slide: {
    width: SLIDE,
    aspectRatio: 4 / 5,
    gap: 4,
    padding: 10,
    borderRadius: 12,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    overflow: "hidden",
  },
  slideBig: { gap: 8, padding: 20, borderRadius: 20, borderBottomLeftRadius: 6 },
  slideTitle: { marginTop: "auto" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 5 },
  dotSmall: { width: 5, height: 5, borderRadius: 3 },
  poster: {
    width: "100%",
    maxWidth: 300,
    aspectRatio: 4 / 5,
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    overflow: "hidden",
  },
  posterBig: { gap: 14, padding: 24, borderRadius: 20, borderBottomLeftRadius: 6 },
  posterEyebrow: { fontWeight: "600", letterSpacing: 0.6 },
  posterTitle: { marginTop: "auto", fontWeight: "800", letterSpacing: -0.4 },
  posterButton: {
    alignSelf: "flex-start",
    marginTop: "auto",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  fields: { gap: 8 },
  copyHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  copyBox: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timeline: { marginLeft: 5, borderLeftWidth: 2 },
  beat: { gap: 2, paddingLeft: 14, paddingVertical: 8 },
  dot: { position: "absolute", left: -6, top: 13, width: 10, height: 10, borderRadius: 5 },
  time: { fontVariant: ["tabular-nums"] },
  beatBig: { gap: 8, padding: 20, borderRadius: 16, borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  screen: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
