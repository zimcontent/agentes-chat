import { joinDrafts, tooLongText, tooLongToSend } from "@agenteschat/client/lib/message-length";
import { applyFormat, FORMAT_KINDS, type FormatKind } from "@agenteschat/ui/format";
import { Canvas, Group, Path, Skia, vec } from "@shopify/react-native-skia";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  Platform,
  Pressable,
  Text as RNText,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputInstance,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  useLongPressGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  type EntryExitAnimationFunction,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { PixelStop } from "@/agent/PixelMarks";
import { showCaught } from "@/lib/caught";
import { readValueSync, STORED, writeValueSync } from "@/lib/storage";
import { Glass } from "./Glass";
import { haptics } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { PressScale } from "./PressScale";
import { spliceWords } from "./splice-words";
import { systemText } from "./Text";
import { useTheme } from "./theme";
import { CHROME_MAX_SCALE, weights } from "./type-scale";

/** The "@" being typed and how to finish it (the screen draws the picker). */
/** The "@" (or, with `sigil: "#"`, the channel) being typed right before the caret. */
export interface ComposerToken {
  start: number;
  query: string;
  sigil?: "#";
}

export interface ComposerMentionState {
  /** What follows "@" ("th"), or "#" when `sigil` says so. */
  query: string;
  sigil?: "#";
  /** Replaces "@th" with "@handle " and puts the caret after it. */
  pick: (handle: string) => void;
}

/**
 * How a message goes while an agent works: "join" reaches it at its next pause (a tap on send), "now"
 * makes it stop what it is doing and read the message at once (the send button held). Without an agent at work it is "join".
 */
export type SendHow = "join" | "now";

/**
 * An agent at work in the conversation: with text, the choice shows (to anyone who writes there); the empty
 * field's button stops it, only for who may stop it (`stop` is left out otherwise).
 */
export interface ComposerWorking {
  stop?: {
    /** The stop button's label ("Parar o Theo"). */
    label: string;
    onStop: () => void;
  };
}

/**
 * A pill above the field: its icon (or a mark of its own, a service's logo), its words, and what a tap does: put
 * `text` (default: the label) in the field, or `onPress` (the right hand's sector cards, docs/adr/doug-0020). `count`:
 * what waits there, drawn after the words.
 */
export interface ComposerSuggestion {
  icon: IconName;
  mark?: ReactNode;
  label: string;
  text?: string;
  count?: number;
  onPress?: () => void;
}

export interface ComposerProps {
  placeholder: string;
  onSend: (text: string, how: SendHow) => void;
  /** Someone is working here (null otherwise). */
  working?: ComposerWorking | null;
  /** The "+" for attachments and actions; left out where there are none (the agent's computer). */
  onPlus?: () => void;
  /**
   * Pills above the field while it is empty; tapping one puts its `text` (default: the `label`) in the field
   * ("Pedir revisão do Caio" fills "Pede para o Caio revisar antes").
   */
  suggestions?: ComposerSuggestion[];
  /**
   * Where the "@"/"#" picker and the suggestion pills are drawn when the screen puts them outside the box it measures
   * (`createComposerFloat`, drawn by `ComposerFloat`): they come and go with each key typed, and inside a box whose
   * height insets a list they moved the list each time. Without it they sit at the top of the composer.
   */
  float?: ComposerFloatSlot;
  /** The field's `nativeID` (the chat links it to the keyboard's drag-to-dismiss area). */
  inputNativeID?: string;
  /** While "@…" is typed right before the caret (and the field is focused): the card above the field. */
  mention?: (state: ComposerMentionState) => ReactNode;
  /** The "@" (or "#") token at the caret (`mentionQuery`); the composer doesn't know the rules itself. */
  mentionAt?: (text: string, caret: number) => ComposerToken | null;
  /** The text after a pick (`insertMention`). */
  insertMention?: (text: string, token: ComposerToken, handle: string) => { text: string; caret: number };
  /**
   * Text handed in from another screen ("Falar com o Theo" leaves "@theo " here): put in the field when it is
   * empty, and the field focused. Once per request (`at`). With `join` (a refused message coming back to be
   * changed) it goes in before whatever is being typed, so neither text is lost.
   */
  prefill?: { text: string; at: number; join?: boolean } | null;
  /** A change here brings the keyboard up ("Responder" on a message). */
  focusAt?: number;
  /** Right above the field ("Respondendo a Ana"). */
  banner?: ReactNode;
  /** Something waits above the field to go with the message (photos, files): send shows and sends with no words. */
  sendEmpty?: boolean;
  /**
   * The words are past the length limit (said above the field, the send held): this takes them as a text file
   * instead ("Enviar como arquivo"), and the field empties. Absent where no more files fit: the words say it.
   */
  onLongAsFile?: (text: string) => void;
  /** Each change that leaves text in the field ("está digitando…" for the others; the screen throttles it). */
  onType?: (text: string) => void;
  /**
   * Where the words wait when the person leaves before sending (a conversation, a thread): they are back in the field
   * when the person returns, until sent or erased. Kept while the app runs.
   */
  draftKey?: string;
  /** The button in the empty field that opens the GIFs and stickers (null where neither can be sent). */
  media?: { label: string; onPress: () => void } | null;
  /**
   * Dictation (null where voice is off): `mic` sits in the field before the send, words or not; while it records or
   * makes out the words, `overlay` takes the field's place over its own glass (drawing no surface of its own): the
   * field's words and "+" go invisible under it and its other buttons step aside.
   */
  dictation?: { mic: ReactNode; overlay: ReactNode | null; active: boolean } | null;
  /** Words to put in at the caret, as dictated: each request with a new `at`. */
  insert?: { text: string; at: number } | null;
}

/**
 * DougBot's conversation field, as the phone's board draws it (docs/adr/doug-0016-doug-pinned.md): a round glass pill
 * 56 tall, its round buttons 42 at 7 from every edge ("+", the microphone and send), 8 apart. On iOS 26 the pill is
 * the system's Liquid Glass, as the bar's own buttons; a blur under the theme's glass before it.
 */
const FIELD = 56;
const SEND = 42;
/** Space around the buttons inside the field: they sit centered on the first line. */
const INSET = (FIELD - SEND) / 2;
/** Between the field's parts. */
const GAP = 8;
/**
 * Android before 9 (API 28) draws no `boxShadow`: there the field's 1 px edge is a border of the same color, inside the
 * pill, its width taken from the padding so the buttons keep their place.
 */
const EDGE_BORDER = Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version < 28 ? 1 : 0;
/** The field's geometry inside its edge, for what draws over it (the dictation's overlay). */
export const COMPOSER_FIELD = {
  button: SEND,
  inset: INSET - EDGE_BORDER,
  gap: GAP,
  radius: FIELD / 2 - EDGE_BORDER,
} as const;
/** A suggestion pill's height and the space under the pills' row: round glass, 40 tall, 10 over the field. */
const PILL = 40;
const PILLS_GAP = 10;
/** The suggestion pills' row, whole: a screen drawing it outside its measured box (`float`) keeps this room for it. */
export const PILLS_ROOM = PILL + PILLS_GAP;
const FIELD_RADIUS = FIELD / 2;
const BUTTON_RADIUS = SEND / 2;
/** The field's 1 px edge (the green at 35% while it is active) and its soft shadow. */
const FIELD_SHADOW = (line: string) => `0px 0px 0px 1px ${line}, 0px 6px 18px -10px rgba(0, 0, 0, 0.25)`;
/** What the dictation's overlay hides stays out of a screen reader's way too. */
const UNDER_OVERLAY_A11Y = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;
/** Words left in a conversation's field, by `draftKey`, while the app runs. */
const DRAFTS = new Map<string, string>();

/** How long the send button is held to stop the agent and send; the ring around it fills meanwhile. */
const HOLD_SEND_MS = 600;
/**
 * The ring waits this long before it shows and starts to fill (it still closes at `HOLD_SEND_MS`): a quick tap on send
 * never flashes it.
 */
const RING_DELAY_MS = 120;
const RING = 44;
const RING_PATH = (() => {
  // Paths are immutable in this Skia: they are made with a builder.
  const path = Skia.PathBuilder.Make();
  path.addCircle(RING / 2, RING / 2, RING / 2 - 2);
  return path.build();
})();
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/**
 * The send button comes in from 0.85 and fading, on the strong ease-out with no overshoot, and leaves the same way:
 * it shows dozens of times a conversation, so it is quick and plain. Reduced motion keeps only the fade.
 */
const SEND_MS = 140;
const SEND_FROM = 0.85;
const SEND_IN: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: SEND_FROM }] },
    animations: {
      opacity: withTiming(1, { duration: SEND_MS, easing: EASE_OUT }),
      transform: [{ scale: withTiming(1, { duration: SEND_MS, easing: EASE_OUT }) }],
    },
  };
};
const SEND_OUT: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: SEND_MS, easing: EASE_OUT }),
      transform: [{ scale: withTiming(SEND_FROM, { duration: SEND_MS, easing: EASE_OUT }) }],
    },
  };
};
const SEND_FADE_IN = FadeIn.duration(SEND_MS);
const SEND_FADE_OUT = FadeOut.duration(SEND_MS);

/** Where a composer's floating parts go when the screen draws them outside its measured box (`ComposerProps.float`). */
export interface ComposerFloatSlot {
  get: () => ReactNode;
  set: (node: ReactNode) => void;
  subscribe: (listener: () => void) => () => void;
}

/** A slot for one composer's floating parts, made once per screen (`useState(createComposerFloat)`). */
export function createComposerFloat(): ComposerFloatSlot {
  let node: ReactNode = null;
  const listeners = new Set<() => void>();
  return {
    get: () => node,
    set: (next) => {
      if (next === node) return;
      node = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Draws what the composer put in its slot, where the screen places this: the "@"/"#" picker or the suggestion pills. It
 * redraws in the same frame as the composer (the slot is set in a layout effect), so nothing lags the keys.
 */
export function ComposerFloat({ slot }: { slot: ComposerFloatSlot }) {
  const node = useSyncExternalStore(slot.subscribe, slot.get, slot.get);
  return <>{node}</>;
}

/**
 * The center of the app: a round glass "+" for attachments and actions,
 * then the field, a raised pill; with text, the round ink send button comes in. One line keeps "+", text and send on the
 * same center line; longer text grows the pill upward and everything stays at the bottom. GIFs and stickers (`media`)
 * have their button at the empty field's end: they go as a message of their own, never with words.
 * Formatting has no button in the row: while words are selected in the field, a bar of them (bold, italic, lists…)
 * shows right over it and writes Markdown around the selection, which stays selected.
 *
 * While an agent works: the empty field's button is "Parar" (a rounded square), one
 * tap and it stops, no question asked (what it did stays and can continue); with text, a tap on send joins
 * what it is doing and holding the button (a ring of ink fills around it) stops it and sends. A light tap on
 * send, a firm one on stop. A line under the field says so until the person has held it once.
 */
export function Composer({
  placeholder,
  onSend,
  working = null,
  onPlus,
  suggestions,
  float,
  inputNativeID,
  mention,
  mentionAt,
  insertMention,
  prefill,
  focusAt,
  banner,
  sendEmpty = false,
  onLongAsFile,
  onType,
  draftKey,
  media,
  dictation,
  insert,
}: ComposerProps) {
  const theme = useTheme();
  const { colors, shadows, reducedMotion } = theme;
  // The words grow with the system's text size only while one line still fits the buttons' height, and the padding
  // around that line is what is left of it: words and placeholder stay on the buttons' middle at any size.
  const lineScale = Math.min(useWindowDimensions().fontScale, INPUT_MAX_SCALE);
  const linePad =
    Platform.OS === "web" ? null : { paddingTop: inputPad(lineScale), paddingBottom: inputPad(lineScale) };
  const { t, i18n } = useTranslation();
  const [text, setText] = useState(() => (draftKey ? (DRAFTS.get(draftKey) ?? "") : ""));
  const tooLong = tooLongToSend(text);
  // Every change of the words is the draft too; an empty field leaves none behind.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the conversation the field belongs to
  useEffect(() => {
    if (!draftKey) return;
    if (text.trim()) DRAFTS.set(draftKey, text);
    else DRAFTS.delete(draftKey);
  }, [text]);
  // At the end of a draft brought back: words dictated before the person taps the field go after it, not before.
  const [caret, setCaret] = useState(text.length);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  // The words selected in the field: with some, the formatting bar shows over the field.
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [taught, setTaught] = useState(() => readValueSync(STORED.stopSendTaught) === "1");
  const input = useRef<TextInputInstance | null>(null);
  const prefillAt = prefill?.at;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per request (its time), whatever the text
  useEffect(() => {
    if (!prefill) return;
    const handed = prefill.text;
    const current = text;
    const next = prefill.join ? joinDrafts(handed, current) : current.trim() ? current : handed;
    // Words handed in put the caret at their end (a dictation goes after them); a field left as it was keeps its caret.
    if (next !== current) put(next);
    input.current?.focus();
  }, [prefillAt]);
  useEffect(() => {
    if (focusAt) input.current?.focus();
  }, [focusAt]);
  const insertAt = insert?.at;
  const caretRef = useRef(caret);
  caretRef.current = caret;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per request (its time), wherever the caret is
  useEffect(() => {
    const words = insert?.text.trim();
    if (!words) return;
    const at = Math.min(caretRef.current, text.length);
    const next = spliceWords(text, at, words);
    put(next.text, next.caret);
    input.current?.focus();
  }, [insertAt]);
  const typed = text.trim().length > 0;
  const has = typed || sendEmpty;
  // Dictating: the field is the recording, nothing else shows around it but its own buttons.
  const dictating = Boolean(dictation?.active);
  const holding = Boolean(dictation?.overlay);
  const token = focused && mention && mentionAt ? mentionAt(text, caret) : null;
  const stopMode = Boolean(working?.stop) && !has && !dictating;
  const button = (has || stopMode) && !dictating;
  const mediaButton = media && !has && !dictating ? media : null;
  const mic = dictation?.mic ?? null;

  const put = (next: string, at = next.length) => {
    setText(next);
    setCaret(at);
    setSelection({ start: at, end: at });
  };

  const send = (how: SendHow) => {
    const value = text.trim();
    if ((!value && !sendEmpty) || tooLong) return;
    // What sending throws stops here, the words kept in the field: a tap never closes the app (`showCaught`).
    try {
      onSend(value, working ? how : "join");
    } catch (error) {
      showCaught("composer.send", error);
      return;
    }
    put("", 0);
  };

  const press = () => {
    if (tooLong) return;
    if (has) {
      haptics.light();
      send("join");
      return;
    }
    if (!working?.stop) return;
    haptics.firm();
    working.stop.onStop();
  };
  // The button held while an agent works here: it stops and reads this at once. The haptic is the hold's own.
  const holdSend = () => {
    send("now");
    if (taught) return;
    setTaught(true);
    writeValueSync(STORED.stopSendTaught, "1");
  };
  const hold = working && has && !tooLong ? { hint: t("mobile.composer.holdToStop"), onHold: holdSend } : null;

  const formatting = focused && range.end > range.start && !holding;
  const format = (kind: FormatKind) => {
    haptics.selection();
    const next = applyFormat(text, range.start, range.end, kind, { link: t("composer.format.linkText") });
    setText(next.value);
    setCaret(next.end);
    setRange({ start: next.start, end: next.end });
    setSelection({ start: next.start, end: next.end });
  };

  const pick = (handle: string) => {
    if (!token || !insertMention) return;
    haptics.selection();
    const next = insertMention(text, token, handle);
    put(next.text, next.caret);
  };

  // The picker while "@…" or "#…" is typed, else the pills while the field is empty: above the field, in the screen's
  // slot when it gives one.
  const floating =
    token && mention ? (
      mention({ query: token.query, sigil: token.sigil, pick })
    ) : suggestions && suggestions.length > 0 && !typed && !sendEmpty && !holding ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.pillsBleed}
        contentContainerStyle={styles.pills}
      >
        {suggestions.map((s) => (
          <PressScale
            key={s.label}
            onPress={() => (s.onPress ? s.onPress() : put(s.text ?? s.label))}
            accessibilityRole="button"
            // 32 tall: the slop reaches 44 without pushing the field down.
            hitSlop={{ top: 6, bottom: 6 }}
            style={[
              styles.pill,
              { boxShadow: `${shadows.e1}, 0px 0px 0px 1px ${colors.glassEdge}` },
              EDGE_BORDER ? { borderWidth: EDGE_BORDER, borderColor: colors.glassEdge } : null,
            ]}
          >
            <Glass liquid style={styles.pillGlass} />
            <View style={styles.pillIn}>
              {s.mark ?? <Icon name={s.icon} size={17} color={colors.muted} />}
              <RNText
                maxFontSizeMultiplier={CHROME_MAX_SCALE}
                style={[systemText("subhead", weights.medium), { color: colors.ink }]}
              >
                {s.label}
              </RNText>
              {s.count ? (
                <View style={[styles.pillCount, { backgroundColor: colors.line2 }]}>
                  <RNText
                    maxFontSizeMultiplier={CHROME_MAX_SCALE}
                    style={[systemText("caption", weights.semibold), { color: colors.ink }]}
                  >
                    {s.count > 99 ? "99+" : s.count}
                  </RNText>
                </View>
              ) : null}
            </View>
          </PressScale>
        ))}
      </ScrollView>
    ) : null;
  // Handed to the slot after every draw, in the same frame (a layout effect), and taken back when the field goes.
  useLayoutEffect(() => {
    float?.set(floating);
  });
  useLayoutEffect(() => () => float?.set(null), [float]);

  return (
    <View>
      {float ? null : floating}
      {banner}
      {tooLong ? (
        <View accessibilityRole="alert" style={styles.tooLong}>
          <RNText
            maxFontSizeMultiplier={CHROME_MAX_SCALE}
            style={[systemText("footnote", weights.regular), { color: colors.danger }]}
          >
            {tooLongText(t, i18n.language, text.trim().length)}
            {onLongAsFile ? "" : ` ${t("channel.tooLong.fix")}`}
          </RNText>
          {onLongAsFile ? (
            // An 18-point line: 13 of slop around it gives the 44-point target.
            <Pressable
              accessibilityRole="button"
              hitSlop={13}
              onPress={() => {
                onLongAsFile(text.trim());
                put("", 0);
              }}
            >
              <RNText
                maxFontSizeMultiplier={CHROME_MAX_SCALE}
                style={[systemText("footnote", weights.semibold), styles.tooLongAct, { color: colors.ink }]}
              >
                {t("channel.tooLong.asFile")}
              </RNText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {formatting ? (
        <Animated.View
          entering={reducedMotion ? undefined : FadeIn.duration(140)}
          exiting={reducedMotion ? undefined : FadeOut.duration(100)}
          style={styles.formatBleed}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.formatRow}
          >
            <View
              accessibilityRole="toolbar"
              accessibilityLabel={t("composer.format.toolbar")}
              style={[styles.format, { backgroundColor: colors.raised, boxShadow: `${shadows.e1}, ${shadows.top}` }]}
            >
              {FORMAT_KINDS.map((kind) => (
                <PressScale
                  key={kind}
                  to={0.9}
                  haptic={false}
                  onPress={() => format(kind)}
                  accessibilityRole="button"
                  accessibilityLabel={t(`composer.format.${kind}`)}
                  // 36 wide and tall: the slop reaches 44 up and down without pushing the field.
                  hitSlop={{ top: 4, bottom: 4 }}
                  style={styles.formatButton}
                >
                  <View style={styles.center}>
                    <Icon name={kind} size={20} color={colors.ink2} />
                  </View>
                </PressScale>
              ))}
            </View>
          </ScrollView>
        </Animated.View>
      ) : null}
      <View style={styles.row}>
        <View
          style={[
            styles.field,
            {
              boxShadow: FIELD_SHADOW(focused ? colors.greenGlow : colors.glassEdge),
              paddingRight: INSET - EDGE_BORDER,
            },
            EDGE_BORDER
              ? { borderWidth: EDGE_BORDER, borderColor: focused ? colors.greenGlow : colors.glassEdge }
              : null,
          ]}
        >
          {/*
           * The glass behind everything in the pill: its own layer, so its clip never cuts the field's edge. While the
           * dictation's overlay holds the field, the words and "+" go invisible under it and the overlay draws no
           * surface: it sits on this same glass on every platform (iOS 26's Liquid Glass, the blur, Android's color).
           */}
          <Glass liquid style={styles.fieldGlass} />
          {/* The "+" button, inside the field at its start. */}
          {onPlus ? (
            <PressScale
              to={0.9}
              onPress={onPlus}
              disabled={holding}
              accessibilityRole="button"
              accessibilityLabel={t("mobile.a11y.attach")}
              hitSlop={6}
              style={[styles.plus, { backgroundColor: colors.plate }, holding && styles.underOverlay]}
              {...(holding ? UNDER_OVERLAY_A11Y : {})}
            >
              <View style={styles.center}>
                <Icon name="plus" size={20} color={colors.ink2} />
              </View>
            </PressScale>
          ) : null}
          {/* The placeholder is ours, on one line (cut with "…"): a long one wrapped and grew the empty field. */}
          <View style={[styles.inputBox, holding && styles.underOverlay]} {...(holding ? UNDER_OVERLAY_A11Y : {})}>
            {!text ? (
              <View style={styles.placeholder} pointerEvents="none">
                <RNText
                  numberOfLines={1}
                  maxFontSizeMultiplier={INPUT_MAX_SCALE}
                  style={[placeholderText, { color: colors.faint }]}
                >
                  {placeholder}
                </RNText>
              </View>
            ) : null}
            <TextInput
              ref={input}
              {...(inputNativeID ? { nativeID: inputNativeID } : {})}
              value={text}
              onChangeText={(next) => {
                setText(next);
                if (next.trim()) onType?.(next);
              }}
              {...(selection ? { selection } : {})}
              onSelectionChange={(e) => {
                setCaret(e.nativeEvent.selection.end);
                setRange(e.nativeEvent.selection);
                if (selection) setSelection(undefined);
              }}
              multiline
              // A browser's textarea starts two rows tall: one row, so a one-line field is the 64 with its words on the
              // buttons' middle (the phones size it from the text already).
              {...(Platform.OS === "web" ? { numberOfLines: 1 } : {})}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              accessibilityLabel={placeholder}
              maxFontSizeMultiplier={INPUT_MAX_SCALE}
              style={[inputText, styles.inputFill, linePad, { color: colors.ink }]}
            />
          </View>
          {mediaButton ? (
            <Animated.View
              entering={reducedMotion ? undefined : FadeIn.duration(140)}
              exiting={reducedMotion ? undefined : FadeOut.duration(100)}
              style={styles.sendBox}
            >
              <PressScale
                to={0.9}
                onPress={mediaButton.onPress}
                accessibilityRole="button"
                accessibilityLabel={mediaButton.label}
                hitSlop={6}
                style={styles.media}
              >
                <View style={styles.center}>
                  <Icon name="sticker" size={20} color={colors.muted} />
                </View>
              </PressScale>
            </Animated.View>
          ) : null}
          {mic ? <View style={styles.micBox}>{mic}</View> : null}
          {!button && !mediaButton && !dictating && !holding ? (
            // Nothing to send yet: the send's place stays, quiet, so the field never shifts when words come.
            <View
              style={[styles.send, styles.idle, { backgroundColor: colors.plate }]}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <Icon name="send" size={17} color={colors.faint} />
            </View>
          ) : null}
          {button ? (
            <SendButton
              stop={stopMode}
              label={stopMode && working?.stop ? working.stop.label : t("mobile.a11y.send")}
              onPress={press}
              hold={hold}
            />
          ) : null}
          {dictation?.overlay ?? null}
        </View>
      </View>
      {hold && !taught && !token ? (
        <Animated.View
          entering={reducedMotion ? undefined : FadeIn.duration(140)}
          exiting={reducedMotion ? undefined : FadeOut.duration(100)}
          style={styles.holdHint}
          pointerEvents="none"
        >
          <RNText
            numberOfLines={1}
            maxFontSizeMultiplier={CHROME_MAX_SCALE}
            style={[systemText("footnote"), { color: colors.faint }]}
          >
            {hold.hint}
          </RNText>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * The field's round button: the send arrow, or the stop square. It comes in (`SEND_IN`: from 0.85, fading, no
 * overshoot) on the glyph it shows, its value born with it: iOS draws a glyph still turning inside that entrance
 * blurry. On a button already there the two swap in place, one turning away as the other turns in.
 *
 * With `hold` (an agent at work and text to send), a tap sends and holding fills a ring of ink around the button,
 * linear, for as long as the hold takes; the ring and its track show only after `RING_DELAY_MS`, so a tap never
 * flashes them. Let go early and it empties fast. The ring closed, a firm haptic lands with it and the message goes
 * "now". Both run on the UI thread; React hears of the tap and the hold only.
 */
function SendButton({
  stop,
  label,
  onPress,
  hold = null,
}: {
  stop: boolean;
  label: string;
  onPress: () => void;
  hold?: { hint: string; onHold: () => void } | null;
}) {
  const { colors, reducedMotion, motion } = useTheme();
  const mode = useSharedValue(stop ? 1 : 0);
  const ring = useSharedValue(0);
  const pressed = useSharedValue(0);
  const held = useSharedValue(false);
  const trackOpacity = useDerivedValue(() => (ring.value > 0.001 ? 1 : 0));
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const holdNow = () => {
    haptics.firm();
    holdRef.current?.onHold();
  };
  const longPress = useLongPressGesture({
    enabled: Boolean(hold),
    minDuration: HOLD_SEND_MS,
    maxDistance: 24,
    onBegin: () => {
      "worklet";
      held.value = false;
      pressed.value = reducedMotion ? 1 : withSpring(1, motion.press);
      // Linear, as time passes, and only once the touch has lasted past a tap: it still closes when the hold lands.
      ring.value = withDelay(
        RING_DELAY_MS,
        withTiming(1, { duration: HOLD_SEND_MS - RING_DELAY_MS, easing: Easing.linear }),
      );
    },
    onActivate: () => {
      "worklet";
      held.value = true;
      ring.value = withTiming(0, { duration: 200, easing: EASE_OUT });
      scheduleOnRN(holdNow);
    },
    onFinalize: () => {
      "worklet";
      pressed.value = reducedMotion ? 0 : withSpring(0, motion.press);
      if (held.value) return;
      cancelAnimation(ring);
      ring.value = withTiming(0, { duration: 150, easing: EASE_OUT });
    },
  });
  const tap = useTapGesture({
    enabled: Boolean(hold),
    maxDuration: HOLD_SEND_MS - 20,
    onDeactivate: () => {
      "worklet";
      scheduleOnRN(onPress);
    },
  });
  const gesture = useExclusiveGestures(longPress, tap);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.1 * pressed.value }] }));
  useEffect(() => {
    const to = stop ? 1 : 0;
    // Both springs give their mass: with Reanimated 4's default of 4 they overshoot by half and take seconds to settle.
    mode.value = reducedMotion ? to : withSpring(to, { damping: 16, stiffness: 320, mass: 1 });
  }, [stop, reducedMotion, mode]);
  const sendGlyph = useAnimatedStyle(() => ({
    opacity: 1 - mode.value,
    transform: [{ scale: 1 - 0.6 * mode.value }, { rotate: `${45 * mode.value}deg` }],
  }));
  const stopGlyph = useAnimatedStyle(() => ({
    opacity: mode.value,
    transform: [{ scale: 0.4 + 0.6 * mode.value }, { rotate: `${-45 * (1 - mode.value)}deg` }],
  }));
  const glyphs = (
    <>
      <Animated.View style={[styles.glyph, sendGlyph]}>
        <Icon name="send" size={17} color={colors.greenInk} />
      </Animated.View>
      <Animated.View style={[styles.glyph, stopGlyph]}>
        <PixelStop size={12} color={colors.greenInk} moving={stop} />
      </Animated.View>
    </>
  );
  return (
    <Animated.View
      entering={reducedMotion ? SEND_FADE_IN : SEND_IN}
      exiting={reducedMotion ? SEND_FADE_OUT : SEND_OUT}
      style={styles.sendBox}
    >
      {hold ? (
        <>
          <Canvas style={styles.ring} pointerEvents="none">
            <Group origin={vec(RING / 2, RING / 2)} transform={[{ rotate: -Math.PI / 2 }]}>
              <Path path={RING_PATH} style="stroke" strokeWidth={2} color={colors.line2} opacity={trackOpacity} />
              <Path
                path={RING_PATH}
                style="stroke"
                strokeWidth={2.5}
                strokeCap="round"
                color={colors.greenText}
                start={0}
                end={ring}
              />
            </Group>
          </Canvas>
          <GestureDetector gesture={gesture}>
            <Animated.View
              accessible
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint={hold.hint}
              style={[styles.send, { backgroundColor: colors.green }, pressStyle]}
            >
              {glyphs}
            </Animated.View>
          </GestureDetector>
        </>
      ) : (
        <PressScale
          to={0.9}
          haptic={false}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={6}
          style={[styles.send, { backgroundColor: colors.green }]}
        >
          {glyphs}
        </PressScale>
      )}
    </Animated.View>
  );
}

/**
 * The field's text: one line is exactly the send button's height, so text, "+" and send share a center
 * line. iOS draws a multiline field's `lineHeight` from the top (the text sits low), so there the line
 * keeps the font's own height and the padding centers it; Android centers it itself.
 */
const body = { ...systemText("body"), fontSize: 16, lineHeight: 24 };
/** One line of the field's words at the default text size: the system font's 16 is a 20-point line on iOS. */
const INPUT_LINE = Platform.OS === "ios" ? 20 : body.lineHeight;
/** The most the field's words grow with the system's text size: one line still fits in the buttons' height. */
const INPUT_MAX_SCALE = SEND / INPUT_LINE;
/** Above and below the field's one line, at a text size: the line and the two make the buttons' height. */
const inputPad = (scale: number) => Math.max(0, (SEND - INPUT_LINE * scale) / 2);
const inputText: TextStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: SEND,
  maxHeight: 140,
  fontSize: body.fontSize,
  fontWeight: body.fontWeight,
  fontFamily: body.fontFamily,
  letterSpacing: body.letterSpacing,
  paddingHorizontal: 0,
  ...Platform.select<TextStyle>({
    // The board in a browser (prancha): no focus outline, the field's green edge says it.
    web: { outlineStyle: "none", paddingTop: 4, paddingBottom: 4, lineHeight: body.lineHeight } as unknown as TextStyle,
    // The padding above and below the one line comes with the text size (`inputPad`): line and padding make the 42
    // of the buttons beside it. Android centers the line in that height itself.
    ios: {},
    default: { lineHeight: body.lineHeight, textAlignVertical: "center", includeFontPadding: false },
  }),
};

/** The placeholder's words, as the field's own text sits on its first line. */
const placeholderText: TextStyle = {
  fontSize: body.fontSize,
  fontWeight: body.fontWeight,
  fontFamily: body.fontFamily,
  letterSpacing: body.letterSpacing,
  ...Platform.select<TextStyle>({ android: { lineHeight: body.lineHeight, includeFontPadding: false } }),
};

const styles = StyleSheet.create({
  // Why the words can't go, then the way out after them, or under them when it doesn't fit.
  tooLong: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tooLongAct: { textDecorationLine: "underline" },
  inputBox: { flex: 1, minWidth: 0 },
  // Under the dictation's overlay: kept in place (the field keeps its height), not seen.
  underOverlay: { opacity: 0 },
  inputFill: { flex: 0, width: "100%" },
  // Over the empty field's one line, centered on it.
  placeholder: { position: "absolute", left: 0, right: 0, bottom: 0, height: SEND, justifyContent: "center" },
  // The row runs to the screen edges (past the composer's own inset) so a long last chip scrolls instead of
  // being cut at the padding.
  pillsBleed: { marginHorizontal: -12 },
  pills: { gap: 8, paddingHorizontal: 12, paddingBottom: PILLS_GAP },
  pill: { height: PILL, borderRadius: PILL / 2 },
  pillGlass: { ...StyleSheet.absoluteFill, borderRadius: PILL / 2 },
  pillCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  // As the pills: to the screen edges, so on a narrow phone the last buttons scroll in instead of being cut.
  formatBleed: { marginHorizontal: -12 },
  formatRow: { paddingHorizontal: 10, paddingBottom: 8 },
  format: { flexDirection: "row", height: 44, padding: 6, gap: 2, borderRadius: 12 },
  formatButton: { width: SEND, height: SEND, borderRadius: 6 },
  pillIn: { flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 14 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: GAP },
  plus: { width: SEND, height: SEND, borderRadius: BUTTON_RADIUS },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  field: {
    flex: 1,
    minWidth: 0,
    minHeight: FIELD,
    borderRadius: FIELD_RADIUS,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: GAP,
    paddingVertical: INSET - EDGE_BORDER,
    paddingLeft: INSET - EDGE_BORDER,
  },
  fieldGlass: { ...StyleSheet.absoluteFill, borderRadius: FIELD_RADIUS - EDGE_BORDER },
  idle: { alignItems: "center", justifyContent: "center" },
  holdHint: { paddingTop: 8, minHeight: 20, alignItems: "center" },
  sendBox: { width: SEND, height: SEND },
  // Around the button, 4 past it on every side.
  ring: { position: "absolute", left: (SEND - RING) / 2, top: (SEND - RING) / 2, width: RING, height: RING },
  // Above the dictation's overlay: the same button stops what it started.
  micBox: { width: SEND, height: SEND, zIndex: 2 },
  send: { width: SEND, height: SEND, borderRadius: BUTTON_RADIUS },
  media: { width: SEND, height: SEND, borderRadius: BUTTON_RADIUS },
  glyph: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
