import type { PlanCard, PortalCardInput, PortalComment, PortalPlan } from "@agenteschat/client";
import {
  useMovePortalCardState,
  usePortalBoard,
  usePortalComments,
  usePortalJob,
  usePortalPlan,
  usePortalTasks,
  useSavePortalCard,
} from "@agenteschat/client";
import { linkPill } from "@agenteschat/client/lib/link-pills";
import {
  PORTAL_SEND_FILES,
  portalArticle,
  portalChecks,
  portalClientName,
  portalLink,
  portalOrderAt,
  portalTaskNumbers,
  portalTextParts,
  portalWhen,
  portalWriterName,
} from "@agenteschat/client/lib/portal";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { Button, Chip, GroupedHeader, GroupedList, GroupedRow, Text, useFieldText } from "@/ui";
import { router } from "@/ui/navigation";
import { LinkPillText } from "../chat/LinkPillText";
import { Face } from "../shared/Face";
import { useColors, useDirectory, useMeId, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { PushedHeader, successHaptic } from "../shared/parts";
import { usePortalFailed, usePortalRights, usePortalWords, useSendCard } from "./hooks";
import { allPlanCards, commentsNewestFirst, findItem, listsFor, otherTeamColumn, sendProblemOf } from "./model";
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
          <Description w={w} card={card} />
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
 * What a card not sent yet can do: go up for approval with its files, title and caption, never a date (asked first; why it
 * can't, when its files don't make a post), and move between To do and In production. The send is followed to its
 * end on this screen: what the post still lacks, or the portal's own words when it refuses.
 */
function Actions({ w, card }: { w: PortalWords; card: PlanCard }) {
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const { changes } = usePortalRights();
  const move = useMovePortalCardState(orgId, card.client);
  const [jobId, setJobId] = useState<string | null>(null);
  const send = useSendCard(card, setJobId);
  const job = usePortalJob(orgId, jobId).data;
  const link = portalLink(card.link);
  if (!changes || card.material) {
    return link ? <Button variant="secondary" wide label={w.openAtPortal} onPress={() => openLink(link)} /> : null;
  }
  const problem = sendProblemOf(card);
  const problemText =
    problem === "tooMany" ? w.sendProblem.tooMany(PORTAL_SEND_FILES) : problem ? w.sendProblem[problem] : null;
  const team = card.stage === "todo" || card.stage === "doing";
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
            onPress={send.confirm}
            disabled={problem !== null}
            loading={send.pending}
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

/** The caption the post goes with. */
function Words({ w, card }: { w: PortalWords; card: PlanCard }) {
  if (!card.caption) return null;
  return (
    <View>
      <GroupedList>
        <GroupedRow label={w.caption} sub={card.caption} subLines={60} />
      </GroupedList>
    </View>
  );
}

/**
 * The card's description, right under its files, as Trello's card has it: what it says (its formatting's marks shown
 * as written), and a press to edit it in place, Salvar or Cancelar under the field. Empty, whoever may change the
 * board sees "Adicione uma descrição mais detalhada…", which opens the field. Comments are their own part below.
 */
function Description({ w, card }: { w: PortalWords; card: PlanCard }) {
  const c = useColors();
  const orgId = useOrgId();
  const failed = usePortalFailed();
  const field = useFieldText("body");
  const save = useSavePortalCard(orgId);
  const { changes } = usePortalRights();
  const [draft, setDraft] = useState<string | null>(null);
  const text = portalArticle(card.description);
  if (!text && !changes) return null;
  const done = () =>
    save.mutate(
      { cardId: card.id, description: draft ?? "" },
      {
        onSuccess: () => {
          successHaptic();
          setDraft(null);
        },
        onError: failed,
      },
    );
  return (
    <View style={styles.say}>
      <GroupedHeader>{w.description}</GroupedHeader>
      {draft !== null ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={w.addDescription}
            placeholderTextColor={c.faint}
            accessibilityLabel={w.description}
            autoFocus
            multiline
            maxLength={20000}
            style={[styles.field, styles.described, field, { color: c.ink, backgroundColor: c.raised }]}
          />
          <View style={styles.formActs}>
            <View style={styles.grow}>
              <Button variant="primary" wide label={w.save} onPress={done} loading={save.isPending} />
            </View>
            <View style={styles.grow}>
              <Button variant="secondary" wide label={w.cancel} onPress={() => setDraft(null)} />
            </View>
          </View>
        </>
      ) : (
        <Pressable
          onPress={changes ? () => setDraft(card.description) : undefined}
          disabled={!changes}
          accessibilityRole={changes ? "button" : "text"}
          accessibilityLabel={text || w.addDescription}
          {...(changes ? { accessibilityHint: w.editDescription } : {})}
          style={({ pressed }) => [styles.descBox, { backgroundColor: c.raised }, pressed ? styles.pressed : null]}
        >
          <Text variant="body" tone={text ? "ink" : "muted"}>
            {text ? <Linked text={text} variant="body" /> : w.addDescription}
          </Text>
        </Pressable>
      )}
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
 * and agents; a comment brought from another board says its writer's name as it was there. A comment is plain words,
 * its web addresses pressable (opened in the in-app browser), nothing else read as markup. One's own is deleted with its ×, and any by who may change the board.
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
                    <Linked text={x.text} />
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

/**
 * Plain words with their web addresses pressable, inside the caller's `Text` (`portalTextParts`, as the web's): a known
 * service's address as its pill, any other in the house link style (the ink, semibold, a quiet underline).
 */
function Linked({ text, variant = "subhead" }: { text: string; variant?: "subhead" | "body" }) {
  const c = useColors();
  return portalTextParts(text).map((part, i) => {
    if (!part.href) return part.text;
    const href = part.href;
    const pill = linkPill(href);
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in its order
    if (pill) return <LinkPillText key={i} href={href} pill={pill} />;
    return (
      <Text
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in its order
        key={i}
        variant={variant}
        tone="ink"
        accessibilityRole="link"
        style={[styles.link, { textDecorationColor: c.line2 }]}
        onPress={() => openLink(href)}
      >
        {part.text}
      </Text>
    );
  });
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
  described: { minHeight: 120, maxHeight: 320, textAlignVertical: "top" },
  descBox: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 },
  formActs: { flexDirection: "row", gap: 8 },
  pressed: { opacity: 0.7 },
  count: { paddingTop: 20, paddingBottom: 8, paddingRight: 0 },
  commentText: { marginTop: 2 },
  link: { fontWeight: "600", textDecorationLine: "underline" },
});
