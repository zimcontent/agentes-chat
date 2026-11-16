import type { PlanCard, PortalCardInput, PortalComment, PortalPlan } from "@agenteschat/client";
import {
  useMovePortalCardState,
  usePortalBoard,
  usePortalComments,
  usePortalJob,
  usePortalPlan,
  usePortalTasks,
  useSavePortalCard,
  useSendForApproval,
} from "@agenteschat/client";
import {
  PORTAL_SEND_FILES,
  portalArticle,
  portalChecks,
  portalClientName,
  portalLink,
  portalOrderAt,
  portalTaskNumbers,
  portalWhen,
  portalWriterName,
} from "@agenteschat/client/lib/portal";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { Button, Chip, GroupedHeader, GroupedList, GroupedRow, Text, useFieldText } from "@/ui";
import { router } from "@/ui/navigation";
import { Face } from "../shared/Face";
import { useColors, useDirectory, useMeId, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { PushedHeader, successHaptic } from "../shared/parts";
import { usePortalFailed, usePortalRights, usePortalWords } from "./hooks";
import {
  allPlanCards,
  commentsNewestFirst,
  findItem,
  listsFor,
  otherTeamColumn,
  sendInputOf,
  sendProblemOf,
} from "./model";
import { openLink, PostPanel } from "./PostPanel";
import { FileStrip, StageChip } from "./parts";
import type { PortalWords } from "./words";

/**
 * One card of a client's board (ADR 9001 §8) on the phone: its files (pictures and videos, each opening full screen),
 * where it is, its list, dates, task and members, the checklist, the caption and description, and what was said
 * about it. Whoever may give agents work moves it (between To do and In production, to another list), ticks its
 * checklist, marks it finished and sends it for approval with what it carries; once sent, the post's own panel takes
 * over (its state at the portal, scheduling, approving for the client). Anyone who may post comments. The rest of a
 * card's editing (dates, labels, members, files) is the web's.
 */
export function CardScreen({ client, cardId }: { client: string; cardId: string }) {
  const w = usePortalWords();
  const c = useColors();
  const orgId = useOrgId();
  const plan = usePortalPlan(orgId, client);
  const board = usePortalBoard(orgId, client);
  const pull = usePullRefresh(() => Promise.all([plan.refetch(), board.refetch()]));
  const card = allPlanCards(plan.data).find((x) => x.id === cardId) ?? null;
  if (!card || !plan.data) {
    return (
      <View style={[styles.fill, { backgroundColor: c.grouped }]}>
        <PushedHeader title="" solid={false} grouped />
        <View style={styles.center}>
          {plan.isLoading ? (
            <ActivityIndicator color={c.muted} />
          ) : (
            <Text tone="muted" style={styles.centerText}>
              {w.notFound}
            </Text>
          )}
        </View>
      </View>
    );
  }
  const post = card.item ? findItem(board.data, card.item) : null;
  return (
    <PushedLargeTitle
      title={card.title}
      grouped
      keyboard
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.page}>
        <Text variant="subhead" tone="muted" style={styles.pad}>
          {portalClientName(client)}
        </Text>
        <FileStrip files={card.files} />
        <View style={[styles.pad, styles.parts]}>
          <Facts w={w} card={card} plan={plan.data} />
          {post ? (
            <PostPanel client={client} item={post.item} column={post.column} caption={!card.caption} />
          ) : (
            <Actions w={w} card={card} />
          )}
          <Words w={w} card={card} />
          <Checklist w={w} card={card} />
          <Comments w={w} card={card} />
        </View>
      </View>
    </PushedLargeTitle>
  );
}

/** Where the card is, its list (another one picked in place), its dates, task, members and whether it is finished. */
function Facts({ w, card, plan }: { w: PortalWords; card: PlanCard; plan: PortalPlan }) {
  const { i18n } = useTranslation();
  const orgId = useOrgId();
  const dir = useDirectory();
  const failed = usePortalFailed();
  const save = useSavePortalCard(orgId);
  const { changes } = usePortalRights();
  const [picking, setPicking] = useState(false);
  const task = portalTaskNumbers(usePortalTasks(orgId, card.task !== null).data).get(card.id);
  const lists = listsFor(plan, card);
  const listName = plan.lists.find((l) => l.id === card.list)?.name ?? w.noList;
  const names = card.members
    .map((id) => dir.memberById.get(id)?.name ?? dir.anyAgent(id)?.name ?? null)
    .filter((n): n is string => Boolean(n));
  const patch = (fields: PortalCardInput) => save.mutate({ cardId: card.id, ...fields }, { onError: failed });
  const moveTo = (list: string | null) => {
    setPicking(false);
    if (list === card.list) return;
    const others = (plan.lists.find((l) => l.id === list)?.cards ?? plan.unlisted).filter((x) => x.id !== card.id);
    patch({ list, order: portalOrderAt(others, others.length) });
  };
  const produce = portalWhen(i18n.language, card.produceOn);
  const postOn = portalWhen(i18n.language, card.postOn);
  return (
    <View>
      <GroupedList>
        {card.material ? null : <GroupedRow label={w.stage} below={<Stage stage={card.stage} />} />}
        <GroupedRow label={w.type} value={w.types[card.type]} />
        <GroupedRow
          label={w.list}
          value={listName}
          {...(changes && lists.length > 0 ? { menu: true, onPress: () => setPicking(!picking) } : {})}
        />
        {picking
          ? [
              ...lists.map((l) => ({ id: l.id as string | null, name: l.name })),
              ...(card.material ? [] : [{ id: null, name: w.noList }]),
            ].map((l) => (
              <GroupedRow
                key={l.id ?? "none"}
                label={l.name}
                checked={l.id === card.list}
                onPress={() => moveTo(l.id)}
              />
            ))
          : null}
        {card.material ? null : <GroupedRow label={w.postOn} value={postOn ?? w.noDate} />}
        {card.material ? null : <GroupedRow label={w.produceOn} value={produce ?? w.noDate} />}
        {task !== undefined ? (
          <GroupedRow label={w.task(task)} chevron onPress={() => router.push(`/issues/${task}`)} />
        ) : null}
        {names.length > 0 ? (
          <GroupedRow
            label={w.members}
            sub={names.map((n, i) => (i === 0 && names.length > 1 ? `${n} (${w.responsible})` : n)).join(", ")}
            subLines={3}
          />
        ) : null}
        {card.material ? null : (
          <GroupedRow
            label={w.done}
            toggle={card.done}
            disabled={!changes}
            {...(changes ? { onPress: () => patch({ done: !card.done }) } : {})}
          />
        )}
      </GroupedList>
    </View>
  );
}

function Stage({ stage }: { stage: PlanCard["stage"] }) {
  return (
    <View style={styles.chips}>
      <StageChip stage={stage} />
    </View>
  );
}

/**
 * What a card not sent yet can do: go up for approval with its files, title, caption and date (asked first; why it
 * can't, when its files don't make a post), and move between To do and In production. The send is followed to its
 * end on this screen: what the post still lacks, or the portal's own words when it refuses.
 */
function Actions({ w, card }: { w: PortalWords; card: PlanCard }) {
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const { changes } = usePortalRights();
  const send = useSendForApproval(orgId);
  const move = useMovePortalCardState(orgId, card.client);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = usePortalJob(orgId, jobId).data;
  const link = portalLink(card.link);
  if (!changes || card.material) {
    return link ? <Button variant="secondary" wide label={w.openAtPortal} onPress={() => openLink(link)} /> : null;
  }
  const problem = sendProblemOf(card);
  const problemText =
    problem === "tooMany" ? w.sendProblem.tooMany(PORTAL_SEND_FILES) : problem ? w.sendProblem[problem] : null;
  const team = card.stage === "todo" || card.stage === "doing";
  const confirmSend = () =>
    Alert.alert(w.sendTitle(portalClientName(card.client)), w.sendText(card.files.length), [
      { text: w.cancel, style: "cancel" },
      {
        text: w.send,
        onPress: () =>
          send.mutate(sendInputOf(card, `${card.id}-${Date.now().toString(36)}`), {
            onSuccess: (started) => setJobId(started.id),
            onError: failed,
          }),
      },
    ]);
  return (
    <View style={styles.actions}>
      {job ? <SendState w={w} job={job} client={card.client} /> : null}
      {job?.state === "sending" || job?.state === "done" ? null : (
        <>
          {problemText ? (
            <Text variant="footnote" tone="muted">
              {problemText}
            </Text>
          ) : null}
          <Button
            variant="primary"
            wide
            label={w.send}
            onPress={confirmSend}
            disabled={problem !== null}
            loading={send.isPending}
          />
        </>
      )}
      {team && !card.done && !card.item ? (
        <Button
          variant="secondary"
          wide
          label={w.moveTo(w.columns[otherTeamColumn(card.state)])}
          onPress={() => move.mutate({ cardId: card.id, state: otherTeamColumn(card.state) }, { onError: failed })}
          loading={move.isPending}
        />
      ) : null}
    </View>
  );
}

/** How the send is going: going up (a video takes minutes), done with what it still lacks, or why it failed. */
function SendState({
  w,
  job,
  client,
}: {
  w: PortalWords;
  job: NonNullable<ReturnType<typeof usePortalJob>["data"]>;
  client: string;
}) {
  const c = useColors();
  if (job.state === "sending") {
    return (
      <View style={styles.sending}>
        <ActivityIndicator color={c.muted} />
        <View style={styles.grow}>
          <Text variant="subhead">{w.sending(portalClientName(client))}</Text>
          <Text variant="footnote" tone="muted">
            {w.sendingVideo}
          </Text>
        </View>
      </View>
    );
  }
  if (job.state === "failed") {
    return (
      <Text variant="subhead" tone="danger">
        {job.error ?? w.sendFailed}
      </Text>
    );
  }
  return (
    <View style={styles.sentBox}>
      <Text variant="subhead">{w.sent}</Text>
      {job.missing.length > 0 ? (
        <View style={styles.chips}>
          <Text variant="footnote" tone="muted">
            {w.stillMissing}
          </Text>
          {job.missing.map((m) => (
            <Chip key={m} icon="flag" label={w.missing[m]} />
          ))}
        </View>
      ) : null}
      {portalLink(job.link) ? (
        <Button variant="secondary" wide label={w.openAtPortal} onPress={() => openLink(job.link ?? "")} />
      ) : null}
    </View>
  );
}

/** The caption the post goes with, and the card's description (its formatting's marks shown as written). */
function Words({ w, card }: { w: PortalWords; card: PlanCard }) {
  const description = portalArticle(card.description);
  if (!card.caption && !description) return null;
  return (
    <View>
      <GroupedList>
        {card.caption ? <GroupedRow label={w.caption} sub={card.caption} subLines={60} /> : null}
        {description ? <GroupedRow label={w.description} sub={description} subLines={80} /> : null}
      </GroupedList>
    </View>
  );
}

/** The checklist, ticked in place by whoever may change the board. */
function Checklist({ w, card }: { w: PortalWords; card: PlanCard }) {
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const save = useSavePortalCard(orgId);
  const { changes } = usePortalRights();
  const checks = portalChecks(card);
  if (!checks) return null;
  const tick = (id: string) =>
    save.mutate(
      { cardId: card.id, checklist: card.checklist.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) },
      { onError: failed },
    );
  return (
    <View>
      <GroupedHeader
        aside={
          <Text variant="footnote" tone="faint" style={styles.count}>
            {w.checks(checks.done, checks.total)}
          </Text>
        }
      >
        {w.checklist}
      </GroupedHeader>
      <GroupedList>
        {card.checklist.map((x) => (
          <GroupedRow
            key={x.id}
            label={x.text}
            labelLines={3}
            icon={x.done ? "checkc" : "circle"}
            faint={x.done}
            disabled={!changes}
            {...(changes ? { onPress: () => tick(x.id) } : {})}
          />
        ))}
      </GroupedList>
    </View>
  );
}

/**
 * What was said about the card, newest first, under a field to say more. Whoever wrote it is found among the people
 * and agents; a comment brought from another board says its writer's name as it was there. A comment is plain words.
 * One's own is deleted with its ×, and any by who may change the board.
 */
function Comments({ w, card }: { w: PortalWords; card: PlanCard }) {
  const c = useColors();
  const orgId = useOrgId();
  const when = useWhen();
  const dir = useDirectory();
  const failed = usePortalFailed();
  const field = useFieldText("body");
  const meId = useMeId();
  const { add, remove } = usePortalComments(orgId);
  const { changes, comments: mayPost } = usePortalRights();
  const [text, setText] = useState("");
  const author = (x: PortalComment) => {
    if (x.by.startsWith("agent:")) {
      const id = x.by.slice(6);
      return { who: { type: "agent", id }, name: dir.anyAgent(id)?.name ?? w.someone };
    }
    const member = dir.memberById.get(x.by);
    return {
      who: member ? { type: "user", id: x.by } : null,
      name: member?.name ?? portalWriterName(x.by) ?? w.someone,
    };
  };
  const say = () => {
    const words = text.trim();
    if (!words) return;
    add.mutate(
      { cardId: card.id, text: words },
      {
        onSuccess: () => {
          successHaptic();
          setText("");
        },
        onError: failed,
      },
    );
  };
  const list = commentsNewestFirst(card.comments);
  return (
    <View style={styles.comments}>
      <GroupedHeader>{w.comments}</GroupedHeader>
      {mayPost ? (
        <View style={styles.say}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={w.writeComment}
            placeholderTextColor={c.faint}
            accessibilityLabel={w.writeComment}
            multiline
            maxLength={5000}
            style={[styles.field, field, { color: c.ink, backgroundColor: c.raised }]}
          />
          <Button
            variant="secondary"
            wide
            label={w.comment}
            onPress={say}
            disabled={!text.trim()}
            loading={add.isPending}
          />
        </View>
      ) : null}
      {list.length === 0 ? (
        <Text variant="footnote" tone="muted" style={styles.pad}>
          {w.noComments}
        </Text>
      ) : (
        <GroupedList>
          {list.map((x) => {
            const a = author(x);
            const mine = x.by === meId;
            return (
              <GroupedRow
                key={x.id}
                label={a.name}
                value={when.short(new Date(x.at).toISOString())}
                below={
                  <Text variant="subhead" tone="ink2" style={styles.commentText}>
                    {x.text}
                  </Text>
                }
                leading={<Face who={a.who} size={32} live={false} />}
                {...(mine || changes
                  ? {
                      remove: {
                        label: w.deleteComment,
                        onPress: () => remove.mutate({ cardId: card.id, commentId: x.id }, { onError: failed }),
                      },
                    }
                  : {})}
              />
            );
          })}
        </GroupedList>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  centerText: { textAlign: "center" },
  page: { gap: 16 },
  pad: { paddingHorizontal: 16 },
  parts: { gap: 24 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  actions: { gap: 8 },
  sending: { flexDirection: "row", alignItems: "center", gap: 12 },
  sentBox: { gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  comments: { gap: 8 },
  say: { gap: 8 },
  field: { minHeight: 64, maxHeight: 160, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  count: { paddingTop: 20, paddingBottom: 8, paddingRight: 0 },
  commentText: { marginTop: 2 },
});
