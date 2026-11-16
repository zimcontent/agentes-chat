import { useRoles } from "@agenteschat/client";
import { agentsByAnyHandle } from "@agenteschat/client/lib/directory";
import { everyoneWord, isEveryoneWord } from "@agenteschat/client/lib/everyone";
import { linkPill } from "@agenteschat/client/lib/link-pills";
import { memberRoleColor } from "@agenteschat/client/lib/member-groups";
import { parseFileLink, parseMessageLink } from "@agenteschat/client/lib/message-links";
import { LinearGradient } from "expo-linear-gradient";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text as RNText, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import { serverUrl } from "@/lib/server";
import { Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { withAlpha } from "@/ui/palette";
import { variantStyle } from "@/ui/Text";
import { openPage } from "../ai/parts";
import { ownLinkHref } from "../links/app-links";
import { Face } from "../shared/Face";
import { useColors, useDirectory, useMyHandle, useOrgId } from "../shared/hooks";
import { MONO } from "../shared/parts";
import { ChannelRefText } from "./ChannelRefText";
import { FileRefText } from "./FileRefText";
import { IdRefText } from "./IdRefText";
import { keepColumns, keptColumns } from "./kept-sizes";
import { LinkPillText } from "./LinkPillText";
import {
  type Block,
  CHAT_TEXT_MAX_SCALE,
  chatCellOf,
  chatCodeOf,
  type Inline,
  mentionTint,
  personMentionTint,
  tableColumnWidths,
  tableHidden,
  tableKey,
} from "./logic";
import { useLayoutKey, useRowLook } from "./look";
import { MessageRefText } from "./MessageRefText";

/**
 * Inline marks of a message (bold, italic, `code`, links, a message's or a file's link as its pill, an internal id as
 * what it names, @mentions, #channels), inside a Text. `channelRefs`: the
 * message's `meta.channelRefs` (a renamed channel still links).
 */
export function Spans({
  inline,
  channelRefs,
  everyone = false,
  ink,
}: {
  inline: Inline[];
  channelRefs?: Record<string, string>;
  /** The message mentions everyone (`meta.mentionsEveryone`): its word shows in the reader's language. */
  everyone?: boolean;
  /** Over a solid bubble: a mention's color and plate in place of its own. */
  ink?: string | undefined;
}) {
  const c = useColors();
  // In a conversation, the size of code in its card (`chatCodeOf`), so inline and fenced code agree at every step.
  const sized = useRowLook().text;
  const codeSize = sized ? { fontSize: chatCodeOf(sized).fontSize } : undefined;
  // A mentioned person's face at the words' size (the web's 1.15em).
  const faceSize = Math.round((sized?.fontSize ?? variantStyle("body").fontSize ?? 17) * 1.15);
  return (
    <>
      {inline.map((s, i) => {
        const key = `${i}-${s.kind}`;
        switch (s.kind) {
          case "bold":
            return (
              <RNText key={key} style={styles.bold}>
                {s.text}
              </RNText>
            );
          case "italic":
            return (
              <RNText key={key} style={styles.italic}>
                {s.text}
              </RNText>
            );
          case "code":
            return (
              <RNText key={key} style={[styles.inlineCode, codeSize, { backgroundColor: c.sunken, color: c.ink2 }]}>
                {s.text}
              </RNText>
            );
          case "link": {
            // A message or a file here: its pill, opening it in the app.
            const message = parseMessageLink(s.href, [serverUrl()]);
            if (message) return <MessageRefText key={key} link={message} />;
            const file = parseFileLink(s.href, [serverUrl()]);
            if (file) return <FileRefText key={key} link={file} />;
            // An address as written, whatever way: the words of a link written with its own stay.
            const pill = s.text === s.href ? linkPill(s.href) : null;
            if (pill) return <LinkPillText key={key} href={s.href} pill={pill} />;
            // A page of this server opens its screen here; any other site the in-app browser. A press on a link wins
            // over the row's long press.
            const own = ownLinkHref(s.href, serverUrl());
            return (
              <RNText
                key={key}
                accessibilityRole="link"
                onPress={() => (own ? router.push(own as never) : openPage(s.href))}
                style={styles.link}
              >
                {s.text}
              </RNText>
            );
          }
          case "channel":
            return <ChannelRefText key={key} name={s.name} text={s.text} refs={channelRefs} />;
          case "id": {
            const shown = (
              <RNText
                key={key}
                style={s.code ? [styles.inlineCode, { backgroundColor: c.sunken, color: c.ink2 }] : undefined}
              >
                {s.text}
              </RNText>
            );
            return <IdRefText key={key} id={s.id} shown={shown} />;
          }
          case "mention":
            return <MentionText key={key} text={s.text} everyone={everyone} ink={ink} faceSize={faceSize} />;
          default:
            return <RNText key={key}>{s.text}</RNText>;
        }
      })}
    </>
  );
}

/**
 * An @mention in a text: the agent's chip in its tone, mine and everyone's in amber, a person's in ink; a handle nobody
 * here has stays as written. A piece of its own, so only a text with a mention reads the directory, the reader's handle
 * and the language: every paragraph, list item and table cell of a conversation is a `Spans`, and each paid for them.
 */
function MentionText({
  text,
  everyone,
  ink,
  faceSize,
}: {
  text: string;
  everyone: boolean;
  ink: string | undefined;
  faceSize: number;
}) {
  const c = useColors();
  const myHandle = useMyHandle();
  const { i18n } = useTranslation();
  const { agents, memberByHandle } = useDirectory();
  const roles = useRoles(useOrgId()).data?.roles;
  const { scheme } = useTheme();
  const handle = text.slice(1);
  const all = everyone && isEveryoneWord(handle);
  const agentTint = mentionTint(handle, agents, scheme);
  const agent = agentTint ? agentsByAnyHandle(agents).get(handle.toLowerCase()) : undefined;
  const person = all || agentTint ? undefined : memberByHandle.get(handle.toLowerCase());
  if (!all && !agentTint && !person) return <RNText>{text}</RNText>;
  // A person: their role's tone, else a neutral plate that stands out from the words, as an agent's does.
  const tint = agentTint ??
    personMentionTint(person ? memberRoleColor(person, roles ?? []) : undefined, scheme) ?? {
      color: c.ink,
      backgroundColor: withAlpha(c.ink, 0.1),
    };
  return (
    <RNText
      style={[
        styles.bold,
        ink
          ? { color: ink, backgroundColor: "rgba(0,0,0,0.16)" }
          : all || handle.toLowerCase() === myHandle
            ? { color: c.amber, backgroundColor: `${c.amber}2e` }
            : tint,
      ]}
    >
      {person || agent ? (
        <MentionFace
          who={person ? { type: "person", id: person.userId } : { type: "agent", id: agent?.id ?? null }}
          size={faceSize}
        />
      ) : null}
      {all ? `@${everyoneWord(i18n.language)}` : text}
    </RNText>
  );
}

/**
 * The face of who a mention names (an agent's still bot, a person's photo or initials) inside their chip, then a narrow
 * space before the name (the web's `.ac-mention__face`). A view inside a line of text sits on the baseline: lowered to
 * sit on the words' middle, as `AgentWho`'s. Hidden from screen readers, which read the name.
 */
function MentionFace({ who, size }: { who: { type: "agent" | "person"; id: string | null }; size: number }) {
  return (
    <>
      <View
        style={{ width: size, height: size, transform: [{ translateY: Math.round(size * 0.2) }] }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Face who={who} size={size} live={false} />
      </View>
      {NARROW}
    </>
  );
}

/** A narrow no-break space: the gap between an inline face and its name, as text. */
const NARROW = "\u202F";

type TableBlock = Extract<Block, { kind: "table" }>;

/**
 * A table (the web's `md__table`): a quiet box with a hairline, the header on a soft band, rows split by
 * hairlines, numbers on the right in tabular figures. Each column is as wide as its widest cell as drawn (measured
 * on an unseen copy that never wraps, since a guess by letters came out narrow and broke words), up to a max that
 * grows with the text size (`tableColumnWidths`); a table wider than the message scrolls sideways inside its box,
 * its hidden side fading out at the edge, and the scroll bar flashes once when it first shows there is more.
 * `surface`: the color under the table (the fade's), the chat's background unless said.
 */
export function Table({
  header,
  rows,
  align,
  surface,
}: Pick<TableBlock, "header" | "rows" | "align"> & { surface?: string }) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  // Each column's width as drawn, kept across the list's unmounts (`kept-sizes.ts`): a table coming back lays out at
  // its widths from its first frame. At the letters' guess its cells wrapped otherwise (another height) until they
  // were measured again, and every row under it moved. Measured anew when what they depend on changes (the cells,
  // the width, the text size).
  const content = useMemo(() => tableKey(header, rows), [header, rows]);
  const columnsKey = `table:${content}:${useLayoutKey()}`;
  const [measured, setMeasured] = useState(() => ({ key: columnsKey, columns: { ...keptColumns(columnsKey) } }));
  if (measured.key !== columnsKey) setMeasured({ key: columnsKey, columns: { ...keptColumns(columnsKey) } });
  const drawn: Record<number, number> = measured.columns;
  useEffect(() => {
    if (Object.keys(drawn).length > 0) keepColumns(columnsKey, drawn);
  }, [columnsKey, drawn]);
  // The unseen copy only until every column has its width: a table coming back has them all, and drew each of its
  // cells twice on every mount for nothing.
  const unmeasured = header.some((_, col) => drawn[col] === undefined);
  const [frame, setFrame] = useState(0);
  const [x, setX] = useState(0);
  const scroller = useRef<ComponentRef<typeof GestureScrollView>>(null);
  const flashed = useRef(false);
  const widths = tableColumnWidths(header, rows, drawn, fontScale);
  // The content's width said outright (not left to layout), so the box always knows it has more to scroll.
  const total = widths.reduce((sum, w) => sum + w, 0);
  const hidden = tableHidden(x, frame, total);
  // A table wider than the message says so once: the system's scroll bar flashes, then the fade keeps saying it.
  useEffect(() => {
    if (flashed.current || !hidden.right) return;
    flashed.current = true;
    scroller.current?.flashScrollIndicators();
  }, [hidden.right]);
  const fadeTo = surface ?? c.bg;
  // In a conversation the cells follow the person's Tamanho do texto, as the words around the table do.
  const sized = useRowLook().text;
  const words = (inline: Inline[], col: number, head: boolean) => (
    <Text
      variant={head ? "label" : "subhead"}
      tone={head ? "muted" : "ink"}
      style={[
        styles.cellText,
        sized ? chatCellOf(variantStyle(head ? "label" : "subhead"), sized) : null,
        { textAlign: align[col] ?? "left" },
      ]}
      maxFontSizeMultiplier={sized ? CHAT_TEXT_MAX_SCALE : undefined}
    >
      <Spans inline={inline} />
    </Text>
  );
  const cell = (inline: Inline[], col: number, head: boolean) => (
    <View key={col} style={[styles.cell, { width: widths[col] }]}>
      {words(inline, col, head)}
    </View>
  );
  return (
    <View>
      {/* Each column's cells unseen, on a sideways strip with no width to wrap them: their widths. */}
      {unmeasured ? (
        <View
          pointerEvents="none"
          style={styles.measure}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}>
            {header.map((h, col) => (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: the columns of one table, in order
                key={col}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  setMeasured((m) =>
                    m.key !== columnsKey || m.columns[col] === w
                      ? m
                      : { key: m.key, columns: { ...m.columns, [col]: w } },
                  );
                }}
              >
                {[h, ...rows.map((r) => r[col] ?? [])].map((inline, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the cells of one column, in order
                  <View key={j} style={styles.cell}>
                    {words(inline, col, j === 0)}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {/* The message's long-press (select) is a Pressable around the whole row: the table takes its own touches so a
          sideways drag scrolls it instead of starting the press, and its scroller is the gesture handler's (native
          gesture first, ahead of the row's JS responder). Long-press elsewhere on the message still selects it. */}
      <View
        style={[styles.table, { borderColor: c.line2 ?? c.line }]}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => true}
      >
        <GestureScrollView
          ref={scroller}
          horizontal
          directionalLockEnabled
          nestedScrollEnabled
          alwaysBounceHorizontal={false}
          showsHorizontalScrollIndicator
          scrollEventThrottle={16}
          onLayout={(e) => setFrame(e.nativeEvent.layout.width)}
          onScroll={(e) => setX(e.nativeEvent.contentOffset.x)}
          contentContainerStyle={{ width: total }}
        >
          <View style={{ width: total }}>
            <View style={[styles.tr, { backgroundColor: c.plate }]}>{header.map((h, col) => cell(h, col, true))}</View>
            {rows.map((r, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the rows of one table, in order
              <View key={j} style={[styles.tr, { borderTopColor: c.line }, styles.trLine]}>
                {header.map((_, col) => cell(r[col] ?? [], col, false))}
              </View>
            ))}
          </View>
        </GestureScrollView>
        {hidden.left ? (
          <LinearGradient
            pointerEvents="none"
            colors={[fadeTo, withAlpha(fadeTo, 0)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fade, styles.fadeLeft]}
          />
        ) : null}
        {hidden.right ? (
          <LinearGradient
            pointerEvents="none"
            colors={[withAlpha(fadeTo, 0), fadeTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fade, styles.fadeRight]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  fade: { position: "absolute", top: 0, bottom: 0, width: 28 },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  tr: { flexDirection: "row" },
  trLine: { borderTopWidth: StyleSheet.hairlineWidth },
  cell: { paddingHorizontal: 12, paddingVertical: 8 },
  cellText: { fontVariant: ["tabular-nums"] },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  link: { textDecorationLine: "underline" },
  inlineCode: { fontFamily: MONO, fontSize: 15 },
});
