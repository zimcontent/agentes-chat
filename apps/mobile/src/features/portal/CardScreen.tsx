import type { PlanCard, PortalComment, PortalPlan, PortalType } from "@dougbot/client";
import {
  useDeletePortalCard,
  useMovePortalCardState,
  usePortalBoard,
  usePortalComments,
  usePortalJob,
  usePortalOverview,
  usePortalPlan,
  usePortalTasks,
  useSavePortalCard,
} from "@dougbot/client";
import { linkPill } from "@dougbot/client/lib/link-pills";
import {
  PORTAL_SEND_FILES,
  PORTAL_TYPES,
  portalArticle,
  portalCardAddress,
  portalChecks,
  portalClientColors,
  portalClientLogos,
  portalClientName,
  portalDayOf,
  portalLink,
  portalOrderAt,
  portalSendDate,
  portalTaskNumbers,
  portalTextParts,
  portalTimeOf,
  portalWhen,
  portalWriterName,
} from "@dougbot/client/lib/portal";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { serverUrl } from "@/lib/server";
import {
  Button,
  Chip,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  IconButton,
  Text,
  useFieldText,
  useToast,
} from "@/ui";
import { router } from "@/ui/navigation";
import { LinkPillText } from "../chat/LinkPillText";
import { Face } from "../shared/Face";
import { useColors, useDirectory, useMeId, useOrgId, usePullRefresh, useWhen } from "../shared/hooks";
import { pickOne, showActionSheet } from "../shared/PickerSheet";
import { PromptForm } from "../shared/PromptForm";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { PushedHeader, successHaptic } from "../shared/parts";
import { SheetHostProvider, useSheet } from "../shared/SheetHost";
import { DateSheet, LabelsSheet, MembersSheet, useAddCardFiles, useCardPatch } from "./CardEdit";
import { usePortalFailed, usePortalRights, usePortalWords, useSendCard } from "./hooks";
import {
  allPlanCards,
  cardLabels,
  commentsNewestFirst,
  fileKind,
  findItem,
  LABEL_COLOR,
  listsFor,
  otherTeamColumn,
  sendProblemOf,
} from "./model";
import { openLink, PostPanel } from "./PostPanel";
import { ClientMark, FileStrip, StagePill } from "./parts";
import type { PortalWords } from "./words";

/**
 * One card of a client's board (ADR 9001 §8) on the phone, doing everything the web's card dialog does: its files
 * (pictures and videos, each opening full screen; added from the phone, put in order, taken off), the description,
 * where it is and its list, its title, stage, type, both dates with the post's time, labels, task and members, whether
 * it is finished, the checklist (ticked, added to, taken from), the caption, and what was said about it. Whoever may
 * give agents work changes it and sends it for approval; once sent, the post's own panel takes over (its state at the
 * portal, scheduling, approving for the client). Anyone who may post comments. "…" copies its link or deletes it.
 */
export function CardScreen({ client, cardId }: { client: string; cardId: string }) {
  return (
    <SheetHostProvider>
      <CardPage client={client} cardId={cardId} />
    </SheetHostProvider>
  );
}

function CardPage({ client, cardId }: { client: string; cardId: string }) {
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
      right={<CardMenu w={w} card={card} />}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.page}>
        <CardHead w={w} client={client} card={card} />
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
          <Files w={w} card={card} />
          <Comments w={w} card={card} />
        </View>
      </View>
    </PushedLargeTitle>
  );
}

/**
 * The card's facts, each changed in place as on the web's card: its title, stage (A produzir or Em produção while the
 * team has it; the portal's once it was sent), list, type, the post's day and time, the production day, labels, task,
 * members and whether it is finished. Whoever can't change the board reads them.
 */
function Facts({ w, card, plan }: { w: PortalWords; card: PlanCard; plan: PortalPlan }) {
  const { i18n } = useTranslation();
  const orgId = useOrgId();
  const dir = useDirectory();
  const toast = useToast();
  const failed = usePortalFailed();
  const sheet = useSheet();
  const { patch } = useCardPatch(card.id);
  const move = useMovePortalCardState(orgId, card.client);
  const { changes } = usePortalRights();
  const [picking, setPicking] = useState(false);
  const task = portalTaskNumbers(usePortalTasks(orgId, card.task !== null).data).get(card.id);
  const lists = listsFor(plan, card);
  const listName = plan.lists.find((l) => l.id === card.list)?.name ?? w.noList;
  const names = card.members
    .map((id) => dir.memberById.get(id)?.name ?? dir.anyAgent(id)?.name ?? null)
    .filter((n): n is string => Boolean(n));
  const labels = cardLabels(card, plan.labels);
  const moveTo = (list: string | null) => {
    setPicking(false);
    if (list === card.list) return;
    const others = (plan.lists.find((l) => l.id === list)?.cards ?? plan.unlisted).filter((x) => x.id !== card.id);
    patch({ list, order: portalOrderAt(others, others.length) });
  };
  const produce = portalWhen(i18n.language, card.produceOn);
  const postOn = portalWhen(i18n.language, card.postOn);
  // The team's own stage is the person's to change while the card is the team's; the portal moves it after.
  const teamStage = changes && !card.item && !card.material && (card.stage === "todo" || card.stage === "doing");
  const pickStage = async () => {
    const key = await pickOne({
      title: w.edit.stagePick,
      options: (["todo", "doing"] as const).map((s) => ({ key: s, label: w.columns[s] })),
      value: card.state,
    });
    if (key !== "todo" && key !== "doing") return;
    if (key === card.state && card.stage === key) return;
    move.mutate(
      { cardId: card.id, state: key },
      { onSuccess: () => toast({ title: w.edit.stageSet(w.columns[key]), icon: "check" }), onError: failed },
    );
  };
  const pickType = async () => {
    const key = await pickOne({
      title: w.type,
      options: PORTAL_TYPES.map((t) => ({ key: t, label: w.types[t] })),
      value: card.type,
    });
    const type = PORTAL_TYPES.find((t) => t === key);
    if (!type || type === card.type) return;
    patch({ type: type as PortalType }, () => toast({ title: w.edit.typeSet(w.types[type]), icon: "check" }));
  };
  const editTitle = () =>
    sheet.open(
      <PromptForm
        title={w.edit.renameTitle}
        placeholder={w.cardTitle}
        submitLabel={w.save}
        initial={card.title}
        limit={{ max: 120 }}
        onSubmit={(text) => {
          if (!text || text === card.title) {
            sheet.close();
            return;
          }
          patch({ title: text }, () => {
            sheet.close();
            successHaptic();
            toast({ title: w.edit.renamed, icon: "check" });
          });
        }}
      />,
    );
  const editPostDate = () =>
    sheet.open(
      <DateSheet
        title={w.postOn}
        day={portalDayOf(card.date)}
        time={portalTimeOf(card.date) ?? "09:00"}
        onSave={(day, time) => {
          const date = day ? portalSendDate(day, time) : null;
          if (date === card.date) return;
          patch({ date }, () =>
            toast({
              title: date ? w.dateSet(portalWhen(i18n.language, date) ?? date) : w.dateCleared,
              icon: "check",
            }),
          );
        }}
      />,
    );
  const editProduce = () =>
    sheet.open(
      <DateSheet
        title={w.produceOn}
        day={card.produceOn}
        onSave={(day) => {
          if (day === card.produceOn) return;
          patch({ produceOn: day }, () =>
            toast({
              title: day ? w.edit.produceSet(portalWhen(i18n.language, day) ?? day) : w.edit.produceCleared,
              icon: "check",
            }),
          );
        }}
      />,
    );
  const datesEditable = changes && !card.item;
  return (
    <View>
      <GroupedList>
        {changes ? <GroupedRow label={w.edit.title} sub={card.title} subLines={3} chevron onPress={editTitle} /> : null}
        {card.material ? null : (
          <GroupedRow
            label={w.stage}
            value={w.columns[card.stage]}
            {...(teamStage ? { menu: true, onPress: () => void pickStage() } : {})}
            {...(!teamStage && card.item ? { sub: w.edit.stageAuto, subLines: 2 } : {})}
          />
        )}
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
        {card.material ? null : (
          <GroupedRow
            label={w.type}
            value={w.types[card.type]}
            {...(changes ? { menu: true, onPress: () => void pickType() } : {})}
          />
        )}
        {card.material ? null : (
          <GroupedRow
            label={w.postOn}
            value={postOn ?? w.noDate}
            {...(datesEditable ? { chevron: true, onPress: editPostDate } : {})}
          />
        )}
        {card.material ? null : (
          <GroupedRow
            label={w.produceOn}
            value={produce ?? w.noDate}
            {...(changes ? { chevron: true, onPress: editProduce } : {})}
          />
        )}
        <GroupedRow
          label={w.labels}
          {...(labels.length === 0 ? { value: w.edit.labelsNone } : {})}
          below={
            labels.length > 0 ? (
              <View style={styles.labelChips}>
                {labels.map((l) => (
                  <View key={l.id} style={[styles.labelChip, { backgroundColor: LABEL_COLOR[l.color] }]}>
                    <Text variant="caption" style={styles.labelText} numberOfLines={1}>
                      {l.name || " "}
                    </Text>
                  </View>
                ))}
              </View>
            ) : undefined
          }
          {...(changes
            ? {
                chevron: true,
                onPress: () => sheet.open(<LabelsSheet client={card.client} cardId={card.id} />),
              }
            : {})}
        />
        <GroupedRow
          label={w.members}
          {...(names.length > 0
            ? {
                sub: names.map((n, i) => (i === 0 ? `${n} (${w.responsible})` : n)).join(", "),
                subLines: 3,
              }
            : { value: w.edit.membersNone })}
          {...(changes
            ? {
                chevron: true,
                onPress: () => sheet.open(<MembersSheet client={card.client} cardId={card.id} />),
              }
            : {})}
        />
        {task !== undefined ? (
          <GroupedRow label={w.task(task)} chevron onPress={() => router.push(`/issues/${task}`)} />
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

/** "…" in the bar: the card's link to share (it opens this very card on the web), and its deletion. */
function CardMenu({ w, card }: { w: PortalWords; card: PlanCard }) {
  const orgId = useOrgId();
  const toast = useToast();
  const failed = usePortalFailed();
  const remove = useDeletePortalCard(orgId);
  const { changes } = usePortalRights();
  const copy = () =>
    void Clipboard.setStringAsync(portalCardAddress(serverUrl(), orgId, card.client, card.id)).then(() =>
      toast({ title: w.edit.linkCopied, icon: "link" }),
    );
  const askDelete = () =>
    Alert.alert(w.edit.deleteTitle, w.edit.deleteText(card.title), [
      { text: w.cancel, style: "cancel" },
      {
        text: w.edit.delete,
        style: "destructive",
        onPress: () =>
          remove.mutate(card.id, {
            onSuccess: () => {
              toast({ title: w.edit.deleted(card.title), icon: "trash" });
              router.back();
            },
            onError: failed,
          }),
      },
    ]);
  return (
    <IconButton
      icon="more"
      label={w.edit.more}
      onPress={() =>
        showActionSheet(w.cardActions(card.title), [
          { label: w.edit.copyLink, onPress: copy },
          ...(changes ? [{ label: w.edit.deleteCard, destructive: true, onPress: askDelete }] : []),
        ])
      }
    />
  );
}

/**
 * Under the title, the board's own words for the card: the client's mark and name, the stage's pill (the Quadro's and
 * the Cronograma's), the type, finished.
 */
function CardHead({ w, client, card }: { w: PortalWords; client: string; card: PlanCard }) {
  const c = useColors();
  const orgId = useOrgId();
  const clients = usePortalOverview(orgId).data?.clients;
  return (
    <View style={[styles.pad, styles.head]}>
      <View style={styles.headClient}>
        <ClientMark
          client={client}
          logo={portalClientLogos(clients).get(client)}
          color={portalClientColors(clients).get(client)}
          size={20}
        />
        <Text variant="subhead" tone="muted" numberOfLines={1} style={styles.headName}>
          {portalClientName(client)}
        </Text>
      </View>
      <View style={styles.chips}>
        {card.material ? null : <StagePill stage={card.stage} />}
        <Chip label={w.types[card.type]} />
        {card.done && !card.material ? (
          <View style={styles.doneMark}>
            <Icon name="check" size={13} color={c.greenText} />
            <Text variant="caption" style={[styles.doneWord, { color: c.greenText }]}>
              {w.done}
            </Text>
          </View>
        ) : null}
      </View>
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

/**
 * The caption the post goes with, written here as on the web's card: a press opens it in a field, Salvar keeps it.
 * A material card (no post of its own) only shows a caption it already has; whoever can't change the board reads it.
 */
function Words({ w, card }: { w: PortalWords; card: PlanCard }) {
  const c = useColors();
  const toast = useToast();
  const field = useFieldText("body");
  const { patch, pending } = useCardPatch(card.id);
  const { changes } = usePortalRights();
  const [draft, setDraft] = useState<string | null>(null);
  const edits = changes && !card.material;
  if (!card.caption && !edits) return null;
  const done = () =>
    patch({ caption: (draft ?? "").trim() }, () => {
      successHaptic();
      setDraft(null);
      toast({ title: w.edit.captionSaved, icon: "check" });
    });
  return (
    <View style={styles.say}>
      <GroupedHeader>{w.caption}</GroupedHeader>
      {draft !== null ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={w.edit.captionPlaceholder}
            placeholderTextColor={c.faint}
            accessibilityLabel={w.caption}
            autoFocus
            multiline
            maxLength={5000}
            style={[styles.field, styles.described, field, { color: c.ink, backgroundColor: c.raised }]}
          />
          <View style={styles.formActs}>
            <View style={styles.grow}>
              <Button variant="primary" wide label={w.save} onPress={done} loading={pending} />
            </View>
            <View style={styles.grow}>
              <Button variant="secondary" wide label={w.cancel} onPress={() => setDraft(null)} />
            </View>
          </View>
        </>
      ) : (
        <Pressable
          onPress={edits ? () => setDraft(card.caption) : undefined}
          disabled={!edits}
          accessibilityRole={edits ? "button" : "text"}
          accessibilityLabel={card.caption || w.edit.captionPlaceholder}
          style={({ pressed }) => [styles.descBox, { backgroundColor: c.raised }, pressed ? styles.pressed : null]}
        >
          <Text variant="body" tone={card.caption ? "ink" : "muted"}>
            {card.caption || w.edit.captionPlaceholder}
          </Text>
        </Pressable>
      )}
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

/**
 * The checklist, as the web's: ticked in place, an item taken off with its ×, a new one added at its foot (return or
 * the button). Whoever can't change the board only reads it.
 */
function Checklist({ w, card }: { w: PortalWords; card: PlanCard }) {
  const c = useColors();
  const field = useFieldText("body");
  const { patch } = useCardPatch(card.id);
  const { changes } = usePortalRights();
  const [text, setText] = useState("");
  const checks = portalChecks(card);
  if (!checks && !changes) return null;
  const tick = (id: string) =>
    patch({ checklist: card.checklist.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) });
  const add = () => {
    const words = text.trim();
    if (!words) return;
    patch({ checklist: [...card.checklist, { id: newCheckId(), text: words, done: false }] });
    setText("");
  };
  return (
    <View style={styles.say}>
      <GroupedHeader
        aside={
          checks ? (
            <Text variant="footnote" tone="faint" style={styles.count}>
              {w.checks(checks.done, checks.total)}
            </Text>
          ) : undefined
        }
      >
        {w.checklist}
      </GroupedHeader>
      {card.checklist.length > 0 ? (
        <GroupedList>
          {card.checklist.map((x) => (
            <GroupedRow
              key={x.id}
              label={x.text}
              labelLines={3}
              icon={x.done ? "checkc" : "circle"}
              faint={x.done}
              disabled={!changes}
              {...(changes
                ? {
                    onPress: () => tick(x.id),
                    remove: {
                      label: w.edit.removeCheck(x.text),
                      onPress: () => patch({ checklist: card.checklist.filter((y) => y.id !== x.id) }),
                    },
                  }
                : {})}
            />
          ))}
        </GroupedList>
      ) : null}
      {changes ? (
        <View style={styles.addRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={w.edit.addCheck}
            placeholderTextColor={c.faint}
            accessibilityLabel={w.edit.addCheck}
            maxLength={300}
            returnKeyType="done"
            submitBehavior="submit"
            onSubmitEditing={add}
            style={[styles.addField, field, { color: c.ink, backgroundColor: c.raised }]}
          />
          <IconButton icon="plus" label={w.edit.addCheck} onPress={add} disabled={!text.trim()} />
        </View>
      ) : null}
    </View>
  );
}

/** A checklist item's id, as the web makes them (twelve characters). */
const newCheckId = () =>
  Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/**
 * The card's files, as the web's attachments: in their order (the first picture or video is the cover), each moved up
 * or down or taken off; new ones from the phone's photos or files, uploaded into the Drive with their progress.
 */
function Files({ w, card }: { w: PortalWords; card: PlanCard }) {
  const { patch } = useCardPatch(card.id);
  const { changes } = usePortalRights();
  const add = useAddCardFiles(card);
  if (!changes) return null;
  const move = (i: number, by: -1 | 1) => {
    const next = [...card.files];
    const [file] = next.splice(i, 1);
    if (!file) return;
    next.splice(i + by, 0, file);
    patch({ files: next });
  };
  const last = card.files.length - 1;
  return (
    <View style={styles.say}>
      <GroupedHeader>{w.files}</GroupedHeader>
      {card.files.length > 0 ? (
        <GroupedList>
          {card.files.map((f, i) => {
            const kind = fileKind(f);
            return (
              <GroupedRow
                key={f.id}
                label={f.name}
                icon={kind === "image" ? "image" : kind === "video" ? "play" : "file"}
                onPress={() => router.push(`/file/${f.id}`)}
                buttons={[
                  ...(i > 0 ? [{ icon: "up" as const, label: w.edit.moveUp, onPress: () => move(i, -1) }] : []),
                  ...(i < last ? [{ icon: "down" as const, label: w.edit.moveDown, onPress: () => move(i, 1) }] : []),
                ]}
                remove={{
                  label: w.edit.removeFile(f.name),
                  onPress: () => patch({ files: card.files.filter((x) => x.id !== f.id) }),
                }}
              />
            );
          })}
        </GroupedList>
      ) : null}
      {add.progress ? (
        <View style={styles.sending}>
          <ActivityIndicator />
          <Text variant="subhead" tone="muted">
            {w.edit.uploading(add.progress.at, add.progress.total, add.progress.pct)}
          </Text>
        </View>
      ) : (
        <View style={styles.formActs}>
          <View style={styles.grow}>
            <Button variant="secondary" wide icon="photos" label={w.edit.addPhotos} onPress={add.photos} />
          </View>
          <View style={styles.grow}>
            <Button variant="secondary" wide icon="file" label={w.edit.addFile} onPress={add.files} />
          </View>
        </View>
      )}
      <Text variant="footnote" tone="muted">
        {w.edit.filesHint}
      </Text>
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
  head: { gap: 10 },
  headClient: { flexDirection: "row", alignItems: "center", gap: 8 },
  headName: { flexShrink: 1 },
  doneMark: { flexDirection: "row", alignItems: "center", gap: 4, height: 24 },
  doneWord: { fontWeight: "600" },
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
  // The words stay where they were read (`descBox`'s insets) when the press opens them to edit.
  described: { minHeight: 120, maxHeight: 320, textAlignVertical: "top", paddingHorizontal: 16, paddingVertical: 12 },
  descBox: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 },
  formActs: { flexDirection: "row", gap: 8 },
  pressed: { opacity: 0.7 },
  count: { paddingTop: 20, paddingBottom: 8, paddingRight: 0 },
  commentText: { marginTop: 2 },
  link: { fontWeight: "600", textDecorationLine: "underline" },
  labelChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  labelChip: { borderRadius: 6, paddingHorizontal: 8, minHeight: 22, justifyContent: "center", maxWidth: 220 },
  labelText: { color: "#ffffff", fontWeight: "600" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addField: { flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});
