import { dueLabel, dueTone } from "@dougbot/client/lib/format";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { CARD_PAD, Filters, Icon, SCREEN_X, Text, useReducedMotion, weights } from "@/ui";
import { Face } from "../shared/Face";
import { useColors, useDirectory } from "../shared/hooks";
import { projectTone } from "./parts";
import {
  type Lane,
  type LaneRange,
  type LaneTask,
  type LaneWho,
  laneLate,
  laneTotals,
  queuePreview,
} from "./team-board";

/** Faces that move: the first few lanes at work (a long team stays light). */
const LIVE_LANES = 4;

/**
 * "Hoje / Semana", then (for the team) "Todos / Pessoas / Agentes", in one row of filters: two groups, a rule
 * between them.
 */
export function LaneFilters({
  range,
  who,
  onRange,
  onWho,
}: {
  range: LaneRange;
  who?: LaneWho;
  onRange: (r: LaneRange) => void;
  onWho?: (w: LaneWho) => void;
}) {
  const { t } = useTranslation();
  const team = who !== undefined && onWho !== undefined;
  return (
    <Filters
      items={[
        { key: "today", label: t("mobile.issues.team.today") },
        { key: "week", label: t("mobile.issues.team.week") },
        ...(team
          ? [
              { key: "all", label: t("mobile.issues.team.everyone"), divider: true },
              { key: "people", label: t("mobile.issues.team.people") },
              { key: "agents", label: t("mobile.issues.team.agents") },
            ]
          : []),
      ]}
      value={team ? [range, who] : range}
      onChange={(k) => {
        if (k === "today" || k === "week") onRange(k);
        else if (onWho && (k === "all" || k === "people" || k === "agents")) onWho(k);
      }}
    />
  );
}

/**
 * The lanes: a card per person or agent with what they are doing now and the next ones in their queue, a tap on the
 * person opening the whole queue. `mine`: the person's own lane, always open, with no header (the screen's title says
 * whose it is). Each task opens its screen.
 */
export function TeamLanes({
  lanes,
  today,
  range,
  mine = false,
  initialOpen,
  onOpen,
}: {
  lanes: readonly Lane[];
  today: string;
  range: LaneRange;
  mine?: boolean;
  /** Lanes open from the start (the board shows one open, as a tap would). */
  initialOpen?: readonly string[];
  onOpen: (task: LaneTask) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialOpen ?? []));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (lanes.length === 0) {
    return (
      <View style={styles.empty}>
        <Icon name="checkc" size={28} />
        <Text variant="callout" tone="ink" style={styles.emptyText}>
          {mine ? t("mobile.issues.team.mineClear") : t("mobile.issues.team.clear")}
        </Text>
        <Text variant="subhead" tone="muted" style={styles.emptyText}>
          {t(range === "today" ? "mobile.issues.team.clearToday" : "mobile.issues.team.clearWeek")}
        </Text>
      </View>
    );
  }
  const totals = laneTotals(lanes);
  const summary = [
    mine ? null : t("mobile.issues.team.working", { count: totals.working }),
    totals.late > 0 ? t("mobile.issues.team.lateCount", { count: totals.late }) : null,
    totals.blocked > 0 ? t("mobile.issues.team.blockedCount", { count: totals.blocked }) : null,
  ].filter(Boolean);
  return (
    <View style={styles.lanes}>
      {summary.length > 0 ? (
        <Text variant="subhead" tone="muted">
          {summary.join(" · ")}
        </Text>
      ) : null}
      {lanes.map((lane, n) => (
        <LaneCard
          key={lane.key}
          lane={lane}
          today={today}
          open={mine || open.has(lane.key)}
          mine={mine}
          live={n < LIVE_LANES}
          onToggle={() => toggle(lane.key)}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

function LaneCard({
  lane,
  today,
  open,
  mine,
  live,
  onToggle,
  onOpen,
}: {
  lane: Lane;
  today: string;
  open: boolean;
  mine: boolean;
  live: boolean;
  onToggle: () => void;
  onOpen: (task: LaneTask) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const reduced = useReducedMotion();
  const name = dir.nameOf(lane.assignee) || t("mobile.issues.nobody");
  const working = lane.doing.length > 0;
  const queue = open ? { items: lane.next, more: 0 } : queuePreview(lane.next);
  const line = working
    ? t("mobile.issues.team.doingCount", { count: lane.doing.length })
    : lane.next.length > 0
      ? t("mobile.issues.team.notStarted")
      : t("mobile.issues.team.free");
  const queued = lane.next.length > 0 ? t("mobile.issues.team.queued", { count: lane.next.length }) : null;
  return (
    <Animated.View
      layout={reduced ? undefined : LinearTransition.duration(200)}
      style={[styles.card, { backgroundColor: c.raised, borderColor: c.line }]}
    >
      {mine ? null : (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={[name, line, queued].filter(Boolean).join(", ")}
          accessibilityHint={t(open ? "mobile.issues.team.collapse" : "mobile.issues.team.expand")}
          style={({ pressed }) => [styles.head, pressed && styles.pressed]}
        >
          <Face who={lane.assignee} size={36} live={live && working} mode={working ? "run" : "idle"} />
          <View style={styles.headText}>
            <Text variant="callout" tone="ink" style={styles.name}>
              {name}
            </Text>
            {/* Each phrase whole: on a narrow screen "2 na fila" goes under, never "fila" alone. */}
            <View style={styles.sub}>
              <Text variant="subhead" tone="muted">
                {line}
              </Text>
              {queued ? (
                <Text variant="subhead" tone="muted">
                  {`· ${queued}`}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={open ? styles.flip : null}>
            <Icon name="chev" size={18} color={c.faint} />
          </View>
        </Pressable>
      )}
      {lane.late > 0 || lane.blocked > 0 ? (
        <View style={styles.marks}>
          {lane.late > 0 ? <Mark tone="late" label={t("mobile.issues.team.lateCount", { count: lane.late })} /> : null}
          {lane.blocked > 0 ? (
            <Mark tone="blocked" label={t("mobile.issues.team.blockedCount", { count: lane.blocked })} />
          ) : null}
        </View>
      ) : null}
      {working ? (
        <View style={styles.block}>
          <Text variant="caption" tone="faint" style={styles.label}>
            {t("mobile.issues.team.now")}
          </Text>
          {lane.doing.map((task) => (
            <NowTask key={task.id} task={task} today={today} onOpen={onOpen} />
          ))}
        </View>
      ) : null}
      {queue.items.length > 0 ? (
        <View style={styles.block}>
          <Text variant="caption" tone="faint" style={styles.label}>
            {t("mobile.issues.team.next")}
          </Text>
          {queue.items.map((task, n) => (
            <NextTask key={task.id} task={task} today={today} divider={n > 0} onOpen={onOpen} />
          ))}
          {queue.more > 0 ? (
            <Pressable
              onPress={onToggle}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <Text variant="subhead" tone="muted">
                {t("mobile.issues.team.more", { count: queue.more })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** A task under way: a sunken plate with the project's bar on its edge, the title whole, then its project and date. */
function NowTask({ task, today, onOpen }: { task: LaneTask; today: string; onOpen: (task: LaneTask) => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const review = task.status === "in_review";
  return (
    <Pressable
      onPress={() => onOpen(task)}
      accessibilityRole="button"
      accessibilityLabel={[task.title, task.project?.name, review ? t("mobile.issues.state.review") : null]
        .filter(Boolean)
        .join(", ")}
      style={({ pressed }) => [styles.now, { backgroundColor: c.sunken }, pressed && styles.pressed]}
    >
      <ProjectBar color={task.project?.color} tall />
      <View style={styles.nowText}>
        <Text variant="subhead" tone="ink" style={styles.strong}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          {task.project ? (
            <Text variant="caption" tone="muted">
              {task.project.name}
            </Text>
          ) : null}
          {review ? <Mark tone="quiet" on={c.raised} label={t("mobile.issues.state.review")} /> : null}
          {task.blocked ? <Mark tone="blocked" label={t("mobile.issues.team.blocked")} /> : null}
          <Due task={task} today={today} on={c.raised} />
        </View>
      </View>
    </Pressable>
  );
}

/** A task in the queue: the project's bar, the title whole, then its project and date (late in red). */
function NextTask({
  task,
  today,
  divider,
  onOpen,
}: {
  task: LaneTask;
  today: string;
  divider: boolean;
  onOpen: (task: LaneTask) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      onPress={() => onOpen(task)}
      accessibilityRole="button"
      accessibilityLabel={[task.title, task.project?.name].filter(Boolean).join(", ")}
      style={({ pressed }) => [
        styles.next,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
        pressed && styles.pressed,
      ]}
    >
      <ProjectBar color={task.project?.color} />
      <View style={styles.nextText}>
        <Text variant="subhead" tone="ink">
          {task.title}
        </Text>
        {task.project || task.blocked || task.dueDate ? (
          <View style={styles.meta}>
            {task.project ? (
              <Text variant="caption" tone="muted">
                {task.project.name}
              </Text>
            ) : null}
            {task.blocked ? <Mark tone="blocked" label={t("mobile.issues.team.blocked")} /> : null}
            <Due task={task} today={today} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The project's color as a short bar (a hollow one with no project), beside the title. */
function ProjectBar({ color, tall = false }: { color: string | null | undefined; tall?: boolean }) {
  const c = useColors();
  return (
    <View
      style={[
        tall ? styles.barTall : styles.bar,
        color ? { backgroundColor: projectTone(color) } : { borderWidth: 1, borderColor: c.lineStrong },
      ]}
    />
  );
}

/** The due date as a small tag: "Atrasada · 12 nov" in red, today and tomorrow in ink, later days quiet. */
function Due({ task, today, on }: { task: LaneTask; today: string; on?: string }) {
  const { t, i18n } = useTranslation();
  if (!task.dueDate) return null;
  const label = dueLabel(t, i18n.language, task.dueDate);
  if (laneLate(task, today)) return <Mark tone="late" label={t("mobile.issues.team.lateOn", { date: label })} />;
  // A tag starts with a capital ("Hoje", "Amanhã"), the date words come lowercase from the formatter.
  const words = label.charAt(0).toLocaleUpperCase(i18n.language) + label.slice(1);
  return <Mark tone={dueTone(task.dueDate) === "soon" ? "soon" : "quiet"} label={words} {...(on ? { on } : {})} />;
}

/** A small flat tag you don't press: red for late, amber for blocked, ink for soon, gray otherwise. */
function Mark({
  tone,
  label,
  on,
}: {
  tone: "late" | "blocked" | "soon" | "quiet";
  label: string;
  /** A gray tag's fill where the chip's gray would vanish (inside the sunken plate). */
  on?: string;
}) {
  const c = useColors();
  const ink = tone === "late" ? c.danger : tone === "blocked" ? c.amberInk : tone === "soon" ? c.ink : c.muted;
  const fill = tone === "late" ? `${c.danger}1F` : tone === "blocked" ? `${c.amber}22` : (on ?? c.chip);
  return (
    <View style={[styles.mark, { backgroundColor: fill }]}>
      {tone === "late" || tone === "blocked" ? (
        <Icon name={tone === "late" ? "clock" : "stop"} size={12} color={ink} />
      ) : null}
      <Text variant="caption" style={[styles.markText, { color: ink }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lanes: { paddingHorizontal: SCREEN_X, paddingTop: 8, gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: CARD_PAD, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  sub: { flexDirection: "row", flexWrap: "wrap", columnGap: 4 },
  name: { fontWeight: weights.semibold },
  pressed: { opacity: 0.6 },
  marks: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  block: { gap: 8 },
  label: { textTransform: "uppercase", letterSpacing: 0.6, fontWeight: weights.semibold },
  now: { flexDirection: "row", gap: 12, borderRadius: 10, padding: 12 },
  nowText: { flex: 1, minWidth: 0, gap: 4 },
  strong: { fontWeight: weights.semibold },
  next: { flexDirection: "row", gap: 12, paddingVertical: 8 },
  nextText: { flex: 1, minWidth: 0, gap: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4 },
  bar: { width: 4, alignSelf: "stretch", minHeight: 16, borderRadius: 2 },
  barTall: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  mark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    minHeight: 22,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  markText: { fontWeight: weights.semibold },
  flip: { transform: [{ rotate: "180deg" }] },
  more: { paddingVertical: 4, alignSelf: "flex-start" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 48, paddingHorizontal: 24 },
  emptyText: { textAlign: "center" },
});
