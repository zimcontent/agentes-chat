import {
  type CanceledReturn,
  type ComputerSummary,
  type EndedTask,
  type ManagedTask,
  type PendingReturn,
  useCancelFollowUp,
} from "@dougbot/client";
import { returnClock, returnWhen } from "@dougbot/client/lib/agent-work";
import { errorText } from "@dougbot/client/lib/errors";
import { formatLineTime } from "@dougbot/client/lib/format";
import {
  agentSummary,
  causeWords,
  computerRoomText,
  computersBesides,
  endedState,
  endedText,
  hiddenCount,
  returnCanceledText,
  returnPlace,
  shownCauses,
  taskPlace,
  taskTime,
  taskTitle,
  type WaitCause,
} from "@dougbot/client/lib/task-manager";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from "react-native-reanimated";
import { ComputerIcon, useComputerKind } from "@/computer/ComputerPortrait";
import {
  Button,
  Card,
  Count,
  EmptyState,
  Icon,
  PixelDone,
  PixelFail,
  PixelOrbit,
  PixelStopped,
  ProviderLogo,
  SCREEN_X,
  SectionHeader,
  SkeletonList,
  Text,
  type TextVariant,
  useReducedMotion,
  useToast,
  weights,
} from "@/ui";
import { router } from "@/ui/navigation";
import { CollapsibleSection } from "../chats/HomeSection";
import { chatHref } from "../links/logic";
import { useOpenQueue } from "../queue/QueueSheet";
import { AgentFace, OpensAgent } from "../shared/Face";
import { useEmptyLook } from "../shared/FirstUse";
import { useColors, useDirectory, useMeId, useNow, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { SheetTitle } from "../shared/PromptForm";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { type ActionItem, ActionList, Tile } from "../shared/parts";
import { SheetHostProvider, useSheet } from "../shared/SheetHost";
import { useStopper, useTasksToday } from "./hooks";
import { endedLatestFirst, isHeld, type RowState, rowState, taskStateWords, taskSubline } from "./logic";
import { TaskMark, useAgentColor, WaitLines } from "./parts";

/** Rows whose agent moves (a long list stays light). */
const LIVE_ROWS = 8;

/** A task's own screen. */
const taskHref = (runId: string) => `/task-manager/${runId}` as const;

/**
 * Rows that come and go while the person watches (a task stopped, one that ended, a group folded) fade, and what
 * stays slides into place; nothing moves with reduced motion.
 */
function useRowMotion() {
  const reduced = useReducedMotion();
  return reduced
    ? { fade: {}, layout: undefined }
    : {
        fade: { entering: FadeIn.duration(160), exiting: FadeOut.duration(120) },
        layout: LinearTransition.duration(220),
      };
}

/**
 * The task manager (ADR 0128), pushed from Agentes, read from the top as three questions: how things stand (three
 * tiles: working, waiting on you, done today), what needs you (a card per task that waits on your ok or answer, its
 * title whole and one button), and what runs (a card per agent, its tasks under its face). Then what is paused and
 * why, the returns agents set in time order, the computers with work, and what ended today, folded. A task's own
 * screen is where it is stopped, never a button in the list.
 */
export function TaskManagerScreen() {
  return (
    <SheetHostProvider>
      <TaskManager />
    </SheetHostProvider>
  );
}

function TaskManager() {
  const { t } = useTranslation();
  const look = useEmptyLook();
  const meId = useMeId();
  const tasks = useTasksToday({ doneToday: true });
  const pull = usePullRefresh(tasks.refetch);
  const now = useNow(1000);
  // Tasks being stopped from their screens read "Parando…" here too.
  const { stopping } = useStopper();
  const { fade, layout } = useRowMotion();
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [endedOpen, setEndedOpen] = useState(false);
  const view = tasks.data;
  const all = view?.tasks ?? [];
  const ended = useMemo(() => endedLatestFirst(view?.ended ?? []), [view?.ended]);
  const { needsYou, byAgent, paused } = useMemo(() => splitTasks(all, stopping), [all, stopping]);
  // The returns agents set ("Retornos", ADR 0037), the soonest first, and those canceled today among what ended.
  const followUps = useMemo(
    () => [...(view?.followUps ?? [])].sort((a, b) => a.at.localeCompare(b.at)),
    [view?.followUps],
  );
  const endedRows = useMemo(
    () =>
      [
        ...ended.map((e) => ({ at: e.finishedAt, key: e.runId, task: e, canceled: null })),
        ...(view?.canceledFollowUps ?? []).map((r) => ({
          at: r.canceledAt,
          key: r.messageId,
          task: null,
          canceled: r,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
    [ended, view?.canceledFollowUps],
  );
  const sum = agentSummary(all);
  // Everyone's work counts here, as on the computers' rows; what the viewer may not see only counts.
  const working = sum.working + (view?.hidden?.working ?? 0);
  const hidden = hiddenCount(view?.hidden, null);
  const toggle = (key: string) =>
    setOpened((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const computers = view?.computers ?? [];
  const causes = shownCauses(all).filter((cause) => cause.kind !== "person");
  const listed = computersBesides(computers, causes);
  const done = view?.doneToday ?? ended.filter((e) => e.status === "done").length;
  return (
    <PushedLargeTitle
      title={t("mobile.taskManager.shortTitle")}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      {tasks.isLoading ? (
        // Loading: the rows' own shape, never a spinner.
        <SkeletonList rows={4} />
      ) : tasks.isError && !view ? (
        <View style={styles.center}>
          <Text tone="muted" style={styles.centerText}>
            {t("mobile.taskManager.loadFailed")}
          </Text>
          <Button variant="secondary" size="sm" label={t("mobile.common.retry")} onPress={() => void tasks.refetch()} />
        </View>
      ) : (
        // Loaded, the list fades in over the spinner; the rows it starts with don't each fade again.
        <Animated.View {...fade}>
          <LayoutAnimationConfig skipEntering>
            <Overview working={working} waiting={needsYou.length} done={done} onDone={() => setEndedOpen(true)} />
            {sum.tasks + hidden > 0 ? null : (
              <EmptyState
                size="panel"
                agent={look}
                mood="deal"
                title={t("taskManager.empty.title")}
                subtitle={t("taskManager.empty.body")}
              />
            )}
            {hidden > 0 ? (
              <Text variant="footnote" tone="faint" style={styles.none}>
                {t("taskManager.hiddenLine", { count: hidden })}
              </Text>
            ) : null}
            {needsYou.length > 0 ? (
              <Animated.View {...fade} layout={layout}>
                <SectionHeader title={t("mobile.taskManager.needsYou")} count={needsYou.length} />
                <View style={styles.cards}>
                  {needsYou.map((task) => (
                    <Animated.View key={task.runId} {...fade} layout={layout}>
                      <NeedsYouCard task={task} now={now} meId={meId} />
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            ) : null}
            {byAgent.length > 0 ? (
              <Animated.View {...fade} layout={layout}>
                <SectionHeader
                  title={t("mobile.taskManager.inProgress")}
                  count={byAgent.reduce((n, g) => n + g.tasks.length, 0)}
                />
                <View style={styles.cards}>
                  {byAgent.map((g, i) => (
                    <Animated.View key={g.agentId} {...fade} layout={layout}>
                      <AgentCard
                        agentId={g.agentId}
                        tasks={g.tasks}
                        open={opened.has(g.agentId)}
                        onToggle={() => toggle(g.agentId)}
                        live={i < LIVE_ROWS}
                        stopping={stopping}
                        now={now}
                        meId={meId}
                      />
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            ) : null}
            {causes.length > 0 ? (
              <Animated.View {...fade} layout={layout}>
                <SectionHeader title={t("mobile.taskManager.paused")} count={paused.length} />
                <View style={styles.cards}>
                  <Card>
                    {causes.map((cause, i) => (
                      <CauseRow key={cause.key} cause={cause} computers={computers} divider={i > 0} />
                    ))}
                  </Card>
                </View>
                <WaitLines tasks={paused} now={now} />
              </Animated.View>
            ) : null}
            {followUps.length > 0 ? (
              <Animated.View {...fade} layout={layout}>
                <SectionHeader title={t("mobile.taskManager.comingBack")} count={followUps.length} />
                <View style={styles.cards}>
                  <Card>
                    {followUps.map((r, i) => (
                      <Animated.View key={r.messageId} {...fade} layout={layout}>
                        <ReturnRow item={r} divider={i > 0} now={now} />
                      </Animated.View>
                    ))}
                  </Card>
                </View>
              </Animated.View>
            ) : null}
            {listed.length > 0 ? (
              <Animated.View {...fade} layout={layout}>
                <SectionHeader title={t("taskManager.queue.computers")} count={listed.length} />
                <View style={styles.cards}>
                  <Card>
                    {listed.map((m, i) => (
                      <ComputerRow key={m.id} computer={m} divider={i > 0} />
                    ))}
                  </Card>
                </View>
              </Animated.View>
            ) : null}
            {/* The same folding header as the other lists' sections (title, count, the chevron at the right). */}
            <Animated.View layout={layout}>
              <CollapsibleSection
                title={t("taskManager.ended.title")}
                count={endedRows.length}
                collapsed={!endedOpen}
                onToggle={() => setEndedOpen((o) => !o)}
              >
                {endedRows.length > 0 ? (
                  endedRows.map((e, i) => (
                    <Animated.View key={e.key} {...fade} layout={layout}>
                      {e.task ? (
                        <EndedRow task={e.task} divider={i > 0} meId={meId} />
                      ) : e.canceled ? (
                        <CanceledReturnRow item={e.canceled} divider={i > 0} meId={meId} />
                      ) : null}
                    </Animated.View>
                  ))
                ) : (
                  <Animated.View {...fade}>
                    <Text variant="footnote" tone="faint" style={styles.none}>
                      {t("taskManager.ended.none")}
                    </Text>
                  </Animated.View>
                )}
              </CollapsibleSection>
            </Animated.View>
          </LayoutAnimationConfig>
        </Animated.View>
      )}
    </PushedLargeTitle>
  );
}

/**
 * The screen's three groups: what waits on the person's ok or answer (oldest wait first), what runs or waits its turn
 * by agent (whoever asked: a person, another agent or a routine; the agent working most first), and what a computer,
 * a plan or a budget holds.
 */
function splitTasks(all: readonly ManagedTask[], stopping: ReadonlySet<string>) {
  const needsYou: ManagedTask[] = [];
  const paused: ManagedTask[] = [];
  const agents = new Map<string, ManagedTask[]>();
  for (const task of all) {
    const state = rowState(task, stopping);
    if (state === "ok" || state === "answer") needsYou.push(task);
    else {
      if (isHeld(state)) paused.push(task);
      const list = agents.get(task.agentId) ?? [];
      list.push(task);
      agents.set(task.agentId, list);
    }
  }
  const since = (task: ManagedTask) => Date.parse(task.wait?.since ?? task.startedAt ?? task.createdAt);
  needsYou.sort((a, b) => since(a) - since(b));
  const byAgent = [...agents.entries()]
    .map(([agentId, tasks]) => ({
      agentId,
      tasks: [...tasks].sort((a, b) => rank(a, stopping) - rank(b, stopping) || since(a) - since(b)),
      working: tasks.filter((task) => rowState(task, stopping) === "working").length,
    }))
    .sort((a, b) => b.working - a.working || b.tasks.length - a.tasks.length);
  return { needsYou, byAgent, paused };
}

/** Within an agent's card: what runs first, then what waits its turn, then what something holds. */
const rank = (task: ManagedTask, stopping: ReadonlySet<string>) => {
  const state = rowState(task, stopping);
  return state === "working" || state === "stopping" ? 0 : state === "queued" ? 1 : 2;
};

/**
 * How things stand, at a glance: three tiles, each a big number over its word. Working shows the orbit, waiting on you
 * is amber while there is any, done today has the check and opens what ended.
 */
function Overview({
  working,
  waiting,
  done,
  onDone,
}: {
  working: number;
  waiting: number;
  done: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const calls = waiting > 0;
  return (
    <View style={styles.tiles}>
      <StatTile
        mark={<PixelOrbit color="#9CFA05" size={14} />}
        value={working}
        label={t("mobile.taskManager.stat.working")}
        dim={working === 0}
      />
      <StatTile
        mark={<Icon name="wait" size={15} color={calls ? c.amber : c.faint} />}
        value={waiting}
        label={t("mobile.taskManager.stat.waiting")}
        tone={calls ? { fill: c.attentionSoft, ink: c.amberInk } : undefined}
        dim={!calls}
      />
      <StatTile
        mark={<PixelDone size={13} />}
        value={done}
        label={t("mobile.taskManager.stat.done")}
        onPress={onDone}
        dim={done === 0}
      />
    </View>
  );
}

function StatTile({
  mark,
  value,
  label,
  tone,
  dim,
  onPress,
}: {
  mark: ReactNode;
  value: number;
  label: string;
  tone?: { fill: string; ink: string };
  dim: boolean;
  onPress?: () => void;
}) {
  const c = useColors();
  const body = (
    <>
      <View style={styles.tileMark}>{mark}</View>
      <Count value={value} size={34} hero color={tone?.ink ?? (dim ? c.faint : c.ink)} />
      <Text variant="footnote" numberOfLines={2} style={{ color: tone?.ink ?? c.muted }}>
        {label}
      </Text>
    </>
  );
  const box = [
    styles.tile,
    { backgroundColor: tone?.fill ?? c.raised, borderColor: tone ? "transparent" : c.glassEdge },
  ];
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => [...box, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={`${value} ${label}`} style={box}>
      {body}
    </View>
  );
}

/**
 * A task that waits on you, as a card: who and since when on top, its title whole (two lines at most), what it waits
 * for in amber, and one button that opens it, where the ok or the answer is given.
 */
function NeedsYouCard({ task, now, meId }: { task: ManagedTask; now: number; meId: string | null }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const title = taskTitle(t, task);
  const sub = taskSubline(t, task, meId, title, (id) => dir.anyAgent(id)?.name);
  const state = rowState(task, new Set());
  const words = taskStateWords(t, i18n.language, task, state, now);
  const agent = dir.nameOf({ type: "agent", id: task.agentId }) || t("channel.unknownAgent");
  const open = () => router.push(taskHref(task.runId));
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={[agent, title, words.state, sub].filter(Boolean).join(", ")}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.raised, borderColor: c.amber },
        pressed && { backgroundColor: c.sunken },
      ]}
    >
      <View style={styles.cardHead}>
        <OpensAgent agentId={task.agentId}>
          <AgentFace agentId={task.agentId} size={24} live={false} />
        </OpensAgent>
        <Text variant="subhead" numberOfLines={1} style={[styles.grow, styles.semibold]}>
          {agent}
        </Text>
        <Text variant="caption" tone="faint" style={styles.num}>
          {taskTime(t, task, now)}
        </Text>
      </View>
      <Text variant="body" numberOfLines={2} style={styles.semibold}>
        {title}
      </Text>
      {sub ? (
        <Text variant="footnote" tone="muted" numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
      <View style={styles.cardState}>
        <Icon name="wait" size={14} color={c.amber} />
        <Text variant="footnote" style={[styles.grow, { color: c.amberInk }]}>
          {words.state}
        </Text>
      </View>
      <Button variant="secondary" size="sm" wide label={t("mobile.taskManager.review")} onPress={open} />
    </Pressable>
  );
}

/**
 * An agent at work, as a card: its face (running while it works), its name and how its tasks stand, then each task on
 * a line of its own (its mark, its title, its time), three at most until "+N" opens the rest. A task opens its screen.
 */
function AgentCard({
  agentId,
  tasks,
  open,
  onToggle,
  live,
  stopping,
  now,
  meId,
}: {
  agentId: string;
  tasks: ManagedTask[];
  open: boolean;
  onToggle: () => void;
  live: boolean;
  stopping: ReadonlySet<string>;
  now: number;
  meId: string | null;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const name = dir.nameOf({ type: "agent", id: agentId }) || t("channel.unknownAgent");
  const working = tasks.filter((task) => rowState(task, stopping) === "working").length;
  const line =
    working > 0
      ? t("taskManager.working", { count: working })
      : tasks.some((task) => isHeld(rowState(task, stopping)))
        ? t("mobile.taskManager.pausedLine")
        : t("taskManager.state.queued");
  const shown = open ? tasks : tasks.slice(0, CARD_ROWS);
  const more = tasks.length - shown.length;
  return (
    <Card>
      <View style={styles.agentHead}>
        <OpensAgent agentId={agentId}>
          <AgentFace agentId={agentId} size={36} mode={working > 0 ? "run" : "idle"} live={live} />
        </OpensAgent>
        <View style={styles.grow}>
          <Text variant="title" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="footnote" tone="muted" numberOfLines={1}>
            {line}
          </Text>
        </View>
      </View>
      {shown.map((task) => (
        <TaskLine key={task.runId} task={task} state={rowState(task, stopping)} now={now} meId={meId} />
      ))}
      {more > 0 || (open && tasks.length > CARD_ROWS) ? (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [styles.more, pressed && { backgroundColor: c.sunken }]}
        >
          <Text variant="footnote" tone="muted">
            {open ? t("mobile.taskManager.fewer") : t("mobile.taskManager.more", { count: more })}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** A task in its agent's card: its mark, its title with who asked under it, its time, a chevron to its screen. */
function TaskLine({
  task,
  state,
  now,
  meId,
}: {
  task: ManagedTask;
  state: RowState;
  now: number;
  meId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const color = useAgentColor(task.agentId);
  const title = taskTitle(t, task);
  const sub = taskSubline(t, task, meId, title, (id) => dir.anyAgent(id)?.name);
  const words = taskStateWords(t, i18n.language, task, state, now);
  const quiet = state !== "working";
  return (
    <Pressable
      onPress={() => router.push(taskHref(task.runId))}
      accessibilityRole="button"
      accessibilityLabel={[title, sub, words.state].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.taskLine, pressed && { backgroundColor: c.sunken }]}
    >
      <View style={[styles.divider, styles.lineDivider, { backgroundColor: c.line2 }]} />
      <View style={styles.lineMark}>
        <TaskMark state={state} color={color} />
      </View>
      <View style={styles.grow}>
        <Text variant="body" numberOfLines={1} style={quiet ? { color: c.muted } : undefined}>
          {title}
        </Text>
        <Text variant="caption" tone="faint" numberOfLines={1}>
          {quiet ? [words.state, sub].filter(Boolean).join(" · ") : sub || words.state}
        </Text>
      </View>
      {state === "stopping" ? null : (
        <Text variant="caption" tone="faint" style={styles.num}>
          {taskTime(t, task, now)}
        </Text>
      )}
      <Icon name="right" size={15} color={c.faint} />
    </Pressable>
  );
}

/** A row's words on one line: the title, then what it is about in quiet type, cut at the end ("…"). */
function OneLine({ title, line, variant = "body" }: { title: string; line?: string | null; variant?: TextVariant }) {
  return (
    <Text variant={variant} numberOfLines={1} style={styles.grow}>
      {title}
      {line ? <Text variant="footnote" tone="muted">{`${GAP}${line}`}</Text> : null}
    </Text>
  );
}

/**
 * What holds waiting work (`waitCauses`), one line with its count, as the web's strip: a plan at its limit opens IA e
 * uso, a full computer its line, one away the computers, people's oks and answers the first such task's screen.
 */
function CauseRow({ cause, computers, divider }: { cause: WaitCause; computers: ComputerSummary[]; divider: boolean }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const openQueue = useOpenQueue();
  const first = cause.tasks[0] as ManagedTask;
  const { name: title, fact: line } = causeWords(t, i18n.language, cause, computers);
  const brain = first.brain && first.brain !== "model" ? first.brain : null;
  const kind = useComputerKind(useOrgId(), cause.kind === "computer" ? cause.machineId : null);
  const row =
    cause.kind === "limit"
      ? {
          lead: brain ? <ProviderLogo id={brain} size="xs" /> : <Icon name="clock" size={16} color={c.muted} />,
          onPress: () => router.push("/usage"),
        }
      : cause.kind === "computer"
        ? {
            lead: <ComputerIcon kind={kind} size={16} color={c.muted} />,
            onPress: cause.busy ? () => openQueue(cause.machineId) : () => router.push("/settings/devices"),
          }
        : {
            lead: <Icon name="clock" size={16} color={c.muted} />,
            onPress: () => router.push(taskHref(first.runId)),
          };
  return (
    <Pressable
      onPress={row.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}`}
      style={({ pressed }) => [styles.task, pressed && { backgroundColor: c.sunken }]}
    >
      {divider ? <View style={[styles.divider, styles.textDivider, { backgroundColor: c.line2 }]} /> : null}
      <Tile size={LEAD}>{row.lead}</Tile>
      <OneLine title={title} line={line} variant="subhead" />
      <Icon name="right" size={15} color={c.faint} />
    </Pressable>
  );
}

/**
 * A computer with work (ADR 0128): its name, whether it has room or how many wait for it, how many run there now. It
 * opens its line (`QueueSheet`).
 */
function ComputerRow({ computer, divider }: { computer: ComputerSummary; divider: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const kind = useComputerKind(useOrgId(), computer.id);
  const openQueue = useOpenQueue();
  const line = computerRoomText(t, computer);
  return (
    <Pressable
      onPress={() => openQueue(computer.id)}
      accessibilityRole="button"
      accessibilityLabel={`${computer.name}, ${line}`}
      style={({ pressed }) => [styles.task, pressed && { backgroundColor: c.sunken }]}
    >
      {divider ? <View style={[styles.divider, styles.textDivider, { backgroundColor: c.line2 }]} /> : null}
      <Tile size={LEAD}>
        <ComputerIcon kind={kind} size={16} color={c.muted} />
      </Tile>
      <OneLine title={computer.name} line={line} variant="subhead" />
      <Icon name="right" size={15} color={c.faint} />
    </Pressable>
  );
}

/**
 * One that ended today, one line: its agent's face, its title and where, how it ended as a mark (in words on its
 * screen) and when. It opens its screen too.
 */
function EndedRow({ task, divider, meId }: { task: EndedTask; divider: boolean; meId: string | null }) {
  const { t } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const when = useWhen();
  const title = taskTitle(t, task);
  const agentName = dir.nameOf({ type: "agent", id: task.agentId });
  const line = [agentName, taskPlace(t, task)].filter(Boolean).join(" · ");
  const how = endedText(t, task, meId, (id) => dir.nameOf({ type: "agent", id }) || undefined);
  const state = endedState(task);
  return (
    <Pressable
      onPress={() => router.push(taskHref(task.runId))}
      accessibilityRole="button"
      accessibilityLabel={[title, line, how, when.time(task.finishedAt)].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.task, pressed && { backgroundColor: c.sunken }]}
    >
      {divider ? <View style={[styles.divider, styles.textDivider, { backgroundColor: c.line2 }]} /> : null}
      <OpensAgent agentId={task.agentId}>
        <AgentFace agentId={task.agentId} size={LEAD} live={false} />
      </OpensAgent>
      <OneLine title={title} line={line} />
      {state === "done" ? (
        <PixelDone size={12} />
      ) : state === "failed" ? (
        <PixelFail size={12} />
      ) : (
        <PixelStopped size={10} />
      )}
      <Text variant="caption" tone="faint" style={styles.num}>
        {when.time(task.finishedAt)}
      </Text>
    </Pressable>
  );
}

/**
 * A return an agent set (ADR 0037), one line: the clock, her words and where (the agent, the conversation), when it
 * comes. A tap or a long press opens its sheet (`ReturnSheet`): the row's words cut at the end, and a return has no
 * screen of its own.
 */
function ReturnRow({ item, divider, now }: { item: PendingReturn; divider: boolean; now: number }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const sheet = useSheet();
  const agent = dir.nameOf({ type: "agent", id: item.agentId });
  const line = [agent, returnPlace(t, item)].filter(Boolean).join(" · ");
  const when = item.held ? t("threads.status.input") : returnWhen(t, i18n.language, item.at, now, true);
  const soon = item.held
    ? null
    : t("followUps.inTime", { time: formatLineTime(i18n.language, Math.max(1000, Date.parse(item.at) - now)) });
  const open = () =>
    sheet.open(
      <ReturnSheet
        item={item}
        line={line}
        when={[when, soon].filter(Boolean).join(" · ")}
        onOpen={() => router.push(chatHref(item.channelId, item.threadId, item.replyMessageId))}
      />,
    );
  return (
    <Pressable
      onPress={open}
      onLongPress={open}
      accessibilityRole="button"
      accessibilityLabel={[item.about, line, when, soon].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.task, pressed && { backgroundColor: c.sunken }]}
    >
      {divider ? <View style={[styles.divider, styles.lineDivider, { backgroundColor: c.line2 }]} /> : null}
      {/* The time leads: the card reads as a timeline, the soonest on top. */}
      <Text variant="subhead" numberOfLines={1} style={[styles.when, styles.semibold, styles.num]}>
        {item.held ? "…" : returnClock(t, i18n.language, item.at, now)}
      </Text>
      <View style={styles.grow}>
        <Text variant="body" numberOfLines={1}>
          {item.about}
        </Text>
        <Text variant="caption" tone="faint" numberOfLines={1}>
          {item.held ? [when, line].filter(Boolean).join(" · ") : line}
        </Text>
      </View>
      <Icon name="right" size={15} color={c.faint} />
    </Pressable>
  );
}

/** A return that won't come, among what ended today: who canceled it (nobody: its time found it couldn't). */
function CanceledReturnRow({ item, divider, meId }: { item: CanceledReturn; divider: boolean; meId: string | null }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const dir = useDirectory();
  const sheet = useSheet();
  const agent = dir.nameOf({ type: "agent", id: item.agentId });
  const how = returnCanceledText(t, item, meId, agent);
  const at = returnClock(t, i18n.language, item.at, Date.parse(item.canceledAt));
  // How it ended in words, after whose it was: no screen of its own says it.
  const line = [agent, how].filter(Boolean).join(" · ");
  const open = () =>
    sheet.open(
      <ReturnSheet
        item={item}
        line={[agent, returnPlace(t, item)].filter(Boolean).join(" · ")}
        when={`${how} · ${at}`}
        onOpen={() => router.push(chatHref(item.channelId, item.threadId))}
      />,
    );
  return (
    <Pressable
      onPress={open}
      onLongPress={open}
      accessibilityRole="button"
      accessibilityLabel={[item.about, line, returnPlace(t, item), at].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.task, pressed && { backgroundColor: c.sunken }]}
    >
      {divider ? <View style={[styles.divider, styles.textDivider, { backgroundColor: c.line2 }]} /> : null}
      <OpensAgent agentId={item.agentId}>
        <AgentFace agentId={item.agentId} size={LEAD} live={false} />
      </OpensAgent>
      <OneLine title={item.about} line={line} />
      <Icon name="clock" size={14} color={c.faint} />
      <Text variant="caption" tone="faint" style={styles.num}>
        {at}
      </Text>
    </Pressable>
  );
}

/**
 * A return's sheet, where its row's words are whole (note A: rows are one line): her words, whose and where, when it
 * comes or how it ended, then "Abrir na conversa" and, for who may, "Cancelar retorno". While that goes its spinner
 * shows and the rest waits. Done, the sheet closes.
 */
function ReturnSheet({
  item,
  line,
  when,
  onOpen,
}: {
  item: PendingReturn | CanceledReturn;
  /** "Ada · #vendas". */
  line: string;
  /** "Às 00:32 · em 33 min", "Esperando uma resposta", "Retorno cancelado por Ana · 00:32". */
  when: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const toast = useToast();
  const sheet = useSheet();
  const cancel = useCancelFollowUp(useOrgId());
  const going = cancel.isPending;
  const items: ActionItem[] = [
    {
      key: "open",
      icon: "chat",
      label: t("taskManager.actions.open"),
      disabled: going,
      onPress: () => {
        sheet.close();
        onOpen();
      },
    },
    ...("canCancel" in item && item.canCancel
      ? [
          {
            key: "cancel",
            icon: "x" as const,
            label: t("followUps.cancel"),
            danger: true,
            ...(going
              ? { trailing: <ActivityIndicator size="small" color={c.muted} /> }
              : {
                  onPress: () =>
                    cancel.mutate(
                      { channelId: item.channelId, messageId: item.messageId },
                      {
                        onSuccess: () => sheet.close(),
                        onError: (error) => toast({ title: errorText(t, error), icon: "x" }),
                      },
                    ),
                }),
          },
        ]
      : []),
  ];
  return (
    <>
      {/* No leading face: her words take the sheet's width (her name is under them). */}
      <SheetTitle title={item.about} subtitle={`${line}\n${when}`} />
      <ActionList items={items} />
    </>
  );
}

/** Tasks an agent's card shows before "+N". */
const CARD_ROWS = 3;
/**
 * What leads a row: an agent's face, a computer's tile, or a task's mark centred in as wide a box, so a task's mark
 * sits under its agent's face and every row's words start on one column (16 + 28 + 12).
 */
const LEAD = 28;
/** Between a row's title and what it is about, on its one line. */
const GAP = "  ";

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: 12, paddingVertical: 48, paddingHorizontal: 24 },
  centerText: { textAlign: "center" },
  // The three tiles, under the large title, one row at the screen's margins.
  tiles: { flexDirection: "row", gap: 8, paddingHorizontal: SCREEN_X, paddingTop: 4, paddingBottom: 8 },
  tile: { flex: 1, minWidth: 0, borderRadius: 16, borderWidth: 1, padding: 12, gap: 4 },
  tileMark: { height: 16, justifyContent: "center", marginBottom: 4 },
  // Cards stand 12 apart at the screen's margins.
  cards: { paddingHorizontal: SCREEN_X, gap: 12 },
  card: { borderRadius: 22, borderWidth: 1, padding: 16, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardState: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 4 },
  agentHead: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  taskLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  // The task's mark under the agent's face (36 wide), so the words start on the name's column.
  lineMark: { width: 36, alignItems: "center" },
  lineDivider: { left: 16 },
  more: { paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  task: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  when: { width: 52 },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: weights.semibold },
  num: { fontVariant: ["tabular-nums"] },
  divider: { position: "absolute", top: 0, right: 0, height: StyleSheet.hairlineWidth },
  // Under the words, past the lead.
  textDivider: { left: 16 + LEAD + 12 },
  none: { paddingHorizontal: SCREEN_X, paddingBottom: 12 },
});
