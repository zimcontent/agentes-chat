import {
  keys,
  type Message,
  type MessageConsultation,
  type RunConsultation,
  useConsultationConversation,
  useConsultations,
} from "@agenteschat/client";
import { handoffAsk } from "@agenteschat/client/lib/agent-work";
import {
  asExchanges,
  type ConsultLineState,
  type ConsultPairItem,
  consultLineKey,
  consultPair,
  firstOfRun,
  groupsByRun,
  openableConsultation,
  pairItemOf,
} from "@agenteschat/client/lib/consult-group";
import { consultSubject, consultTimeText, withoutRelayLine } from "@agenteschat/client/lib/consultations";
import { joinNames, namesText } from "@agenteschat/client/lib/format";
import type { agentGrammar } from "@agenteschat/client/lib/grammar";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Icon, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { consultationHref } from "../links/logic";
import { AgentFace } from "../shared/Face";
import { useColors, useDirectory, useOrgId } from "../shared/hooks";
import { usePresenceOf } from "../status/hooks";
import { rowBodyInset } from "./logic";
import { useCardTop, useRowLook } from "./look";
import { WaitMark } from "./WaitMark";

/** A question's state in words, on the conversation's screen ("A Iris espera uma aprovação"). */
export const consultLineLabel = (
  t: TFunction,
  state: ConsultLineState,
  c: Pick<RunConsultation, "waiting" | "kind">,
  to: ReturnType<typeof agentGrammar>,
) => t(consultLineKey(state, c), { name: to.name, context: to.context });

/** A clock for the open questions' times; still once none is out. */
function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const NO_ITEMS: ConsultPairItem[] = [];
const NO_CONSULTED: MessageConsultation[] = [];

const NO_REACHED: ReadonlySet<string> = new Set();

/**
 * The questions a pair row stands for: those of run `runId` on the run's first message here (`messageId`; null: its
 * live turn, which shows them until the run posts), with the rest of their exchange when `runId` asked first
 * (`asExchanges`), and those a reply's `meta.consulted` names that the list doesn't have. `reached`: hand-offs the
 * message's reach lines show (`reachHandoffs`), left out here.
 */
export function useRunConsults(
  runId: string | null | undefined,
  where: Pick<Message, "channelId" | "threadId">,
  messageId: string | null,
  consulted: readonly MessageConsultation[] = NO_CONSULTED,
  reached: ReadonlySet<string> = NO_REACHED,
): ConsultPairItem[] {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const list = useConsultations(orgId, where.channelId, Boolean(runId));
  const group = useMemo(
    () => (runId ? groupsByRun(asExchanges(list.data ?? [])).get(runId) : undefined),
    [list.data, runId],
  );
  const listed = useMemo(() => new Set((list.data ?? []).map((c) => c.id)), [list.data]);
  const loaded =
    group && runId
      ? [
          ...(qc.getQueryData<Message[]>(keys.messages(orgId, where.channelId)) ?? []),
          ...((where.threadId && qc.getQueryData<Message[]>(keys.thread(orgId, where.channelId, where.threadId))) ||
            []),
        ]
      : [];
  const first = group && runId ? firstOfRun(loaded, runId) : null;
  const draws = group !== undefined && (messageId === null ? first === null : !first || first === messageId);
  return useMemo(() => {
    const run = group ?? NO_ITEMS;
    const extra = consulted.filter((c) => !listed.has(c.consultationId)).map(pairItemOf);
    const mine = !draws ? NO_ITEMS : reached.size === 0 ? run : run.filter((c) => !reached.has(c.id));
    return extra.length === 0 ? mine : [...mine, ...extra];
  }, [group, listed, consulted, draws, reached]);
}

/**
 * The conversation's question with this id (a hand-off a reach line shows): from its list, or, older than the list
 * goes back, on its own.
 */
export function useConsultById(channelId: string, id: string | undefined): RunConsultation | null {
  const orgId = useOrgId();
  const list = useConsultations(orgId, channelId, Boolean(id));
  const listed = useMemo(() => (id && list.data?.find((c) => c.id === id)) || null, [list.data, id]);
  const alone = useConsultationConversation(orgId, channelId, id && list.isSuccess && !listed ? id : null);
  return listed ?? alone.data?.consultation ?? null;
}

/**
 * When one agent talked to another (`ask_agent`, `tell_agent`): a small round pill under the message it belongs to,
 * on the bubble's left edge. The asker's face and name, ⇄, the other agent's (several fold into stacked faces, "Atlas
 * e mais 2"), then how long it took, or while it runs "perguntando 42 s", or "não respondeu". Never what they said: a
 * tap opens the two agents' conversation on a screen of its own, read only (`ConsultationScreen`). The web draws the
 * same facts as a line across its conversation, before the reply (`ConsultGroup.tsx`); on the phone the pill hangs
 * under the reply whose run asked. `place`: in a message's body (`part`, a card's room above it), on its reach
 * lines (`list`, the list spaces it), or alone where an answer's notice arrived (`line`, `gap` above it, on the rows'
 * bodies).
 */
export function ConsultPairRow({
  askerId,
  channelId,
  items,
  place = "part",
  gap,
}: {
  askerId: string;
  /** The conversation that asked: the screen opens from it. */
  channelId: string;
  items: readonly ConsultPairItem[];
  place?: "part" | "list" | "line";
  /** `line`: its room above (a turn's, or a part's under another quiet line). */
  gap?: number;
}) {
  const { t, i18n } = useTranslation();
  const look = useRowLook();
  const inset = rowBodyInset(look);
  const cardTop = useCardTop();
  const dir = useDirectory();
  const c = useColors();
  // As the web's line (`.consult-pair`, its container under 420): on a phone's width the subject would be a letter and
  // its "…", so the pill keeps the names, the word and the time.
  const roomy = useWindowDimensions().width >= SUBJECT_ROOM;
  const live = items.some((x) => x.status === "open");
  const now = useTick(live);
  // The hand-off's run waits on me (its agent's work for me, ADR 0084 addendum): the pill says so in amber, as the
  // web's row does.
  const presence = usePresenceOf();
  const only = items.length === 1 && items[0]?.status === "open" ? items[0] : undefined;
  const mine = only ? handoffAsk(presence.agent(only.consultedAgentId)?.work, only.consultedRunId) : null;
  const pair = consultPair(items, now, askerId, mine);
  if (!pair) return null;
  // Blue at work, amber when it waits on me, the warning for what went unanswered, quiet otherwise. Never `faint` on
  // the pill's fill: it is under 4.5:1 there.
  const tone =
    pair.tone === "live" ? c.agent : pair.tone === "bad" ? c.warn : pair.tone === "you" ? c.amberInk : c.muted;
  const nameOf = (id: string) => dir.agentById.get(id)?.name ?? t("mobile.chat.someone");
  const from = nameOf(askerId);
  const names = pair.faces.map((f) => nameOf(f.agentId));
  const to = names.length === 1 ? (names[0] ?? "") : namesText(t, names, 1);
  // What the question a tap opens is about, between the names and how it went, where there is room for it.
  const opened = items.find((x) => x.id === pair.opens) ?? items[0];
  const subject = roomy ? consultSubject(opened?.question) : null;
  // The whole question, which the pill leaves out: for screen readers here, on the screen a tap opens.
  const question = withoutRelayLine(opened?.question ?? "").trim();
  // An old reply's question with no id of its own has no conversation to open.
  const opens = openableConsultation(pair.opens);
  // A pill of several opens on all of them: the screen offers each agent's exchange.
  const ids = items.map((x) => x.id);
  const how = [
    pair.word ? t(pair.word.key, pair.word.values) : null,
    pair.seconds !== null ? consultTimeText(t, i18n.language, live, pair.seconds) : null,
  ]
    .filter(Boolean)
    .join(" ");
  const label = [
    names.length === 1
      ? t("chat.consultPanel.label", { from, to })
      : t("chat.consultPair.labelMany", { from, to: joinNames(names, t) }),
    how,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <View
      style={[
        styles.room,
        place === "line"
          ? { marginTop: gap ?? 0, paddingLeft: inset.left, paddingRight: inset.right }
          : place === "part"
            ? cardTop
            : undefined,
      ]}
    >
      <Pressable
        onPress={() => {
          if (opens) router.push(consultationHref(opens, channelId, ids));
        }}
        disabled={!opens}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={question || undefined}
        // A 30-point pill: 7 above and below gives it the 44-point target.
        hitSlop={{ top: 7, bottom: 7 }}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: c.bubbleTheirs, borderColor: c.bubbleTheirsEdge },
          pressed && styles.pressed,
        ]}
      >
        <AgentFace agentId={askerId} size={FACE} live={false} />
        <Text variant="footnote" tone="ink2" numberOfLines={1} style={styles.from}>
          {from}
        </Text>
        {pair.tone === "you" ? (
          <View style={styles.mark}>
            <WaitMark size={8} />
          </View>
        ) : (
          // In a view that keeps its size: the names give way, never the arrows.
          <View style={styles.keep}>
            <Icon name="swap" size={13} color={pair.tone === "live" ? c.agent : c.muted} />
          </View>
        )}
        <View style={styles.faces}>
          {pair.faces.slice(0, 3).map((f, i) => (
            <View
              key={f.agentId}
              style={[i > 0 && [styles.stacked, { borderColor: c.bubbleTheirs }], f.off && styles.off]}
            >
              <AgentFace
                agentId={f.agentId}
                size={FACE}
                live={false}
                mode={pair.tone === "live" && !f.off ? "think" : "idle"}
              />
            </View>
          ))}
        </View>
        <Text variant="footnote" tone="ink2" numberOfLines={1} style={styles.name}>
          {to}
        </Text>
        {/* The subject carries its own ·: when it has no room left, the dot goes with it. */}
        {subject ? (
          <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.subject}>
            {`· ${subject}`}
          </Text>
        ) : null}
        {pair.word || pair.seconds !== null ? (
          <Text variant="footnote" tone="muted" style={styles.keep}>
            ·
          </Text>
        ) : null}
        {pair.word ? (
          <Text variant="footnote" numberOfLines={1} style={[styles.word, { color: tone }]}>
            {t(pair.word.key, pair.word.values)}
          </Text>
        ) : null}
        {pair.seconds !== null ? (
          <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.time}>
            {consultTimeText(t, i18n.language, live, pair.seconds)}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

/** The width from which the question's subject shows between the names and how it went (the web's 420). */
const SUBJECT_ROOM = 420;
/** The pair's faces. */
const FACE = 18;

const styles = StyleSheet.create({
  // A round pill as wide as what it says, on the bubble's left edge: 6 above and below, 10 at its ends, a hairline
  // rim (a border, never a shadow: one on every row is an offscreen layer per frame on iOS).
  pill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
    minHeight: 30,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: "continuous",
  },
  pressed: { opacity: 0.7 },
  // The whole width it is in, so the pill's `maxWidth` holds there (a reach line's column hugs its content).
  room: { alignSelf: "stretch" },
  // Always one line: the subject gives way first ("…"), then the asker's name, then the other's; how it went and its
  // time never. The other's share of a shrink is next to nothing while the asker's name has room to give: a short name
  // ("SONY") stays whole, not cut by a fraction of a point.
  from: { fontWeight: "600", flexShrink: 1 },
  name: { fontWeight: "600", flexShrink: 0.0001 },
  subject: { flexShrink: 100000 },
  faces: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  stacked: { marginLeft: -6, borderLeftWidth: 1.5, borderRadius: 6 },
  off: { opacity: 0.45 },
  keep: { flexShrink: 0 },
  word: { fontWeight: "600", flexShrink: 0 },
  // The wait mark in the arrows' 13-point place, so the names don't move.
  mark: { width: 13, height: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  time: { fontVariant: ["tabular-nums"], flexShrink: 0 },
});
