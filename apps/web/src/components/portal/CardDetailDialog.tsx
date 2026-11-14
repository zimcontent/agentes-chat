import type { PlanCard, PortalCardInput, PortalComment, PortalPlan, PortalType } from "@agenteschat/client";
import {
  useDeletePortalCard,
  usePortalComments,
  usePortalPlan,
  usePortalTasks,
  useSavePortalCard,
} from "@agenteschat/client";
import { relativeTime } from "@agenteschat/client/lib/format";
import { can } from "@agenteschat/client/lib/permissions";
import {
  PORTAL_NO_LIST,
  PORTAL_TYPES,
  planCards,
  portalChecks,
  portalClientName,
  portalDayOf,
  portalErrorText,
  portalLink,
  portalOrderAt,
  portalSendDate,
  portalTaskNumbers,
  portalTextParts,
  portalTimeOf,
  portalWithResponsible,
} from "@agenteschat/client/lib/portal";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Icon,
  Input,
  Locked,
  Meter,
  Popover,
  Select,
  Textarea,
  TimeSelect,
} from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar, PersonAvatar } from "@/components/AgentAvatar";
import { AskAgentButton } from "@/components/AskAgentButton";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useNow } from "@/hooks/useNow";
import { useToast } from "@/lib/toast";
import { usePortalPeople, WhoFace } from "./members";
import { PortalFiles } from "./PortalFiles";
import { LabelChip, StageChip } from "./stage";

/** The hour a post date starts with when it had none. */
const DEFAULT_TIME = "09:00";

/**
 * A card opened (ADR 9001 §8): on the left what the post is (its title, list, stage, labels, members, the day the
 * team makes it and, apart, the day and time it goes out, its type, description, checklist, Drive files and caption);
 * on the right what was said about it, newest first. Every change is kept as it is made (a text when its field is
 * left), so there is no Save. Whoever may give agents work changes it; anyone who may post can still comment. Its
 * stage is automatic. Once it was sent, "Send for approval" gives way to "Open at the portal".
 *
 * The card is also a task of the workspace (ADR 9001): beside its stage, "Task #12" opens it. Its members are people
 * and agents alike, and the first is the one responsible, who has the task: the mark says who, any other member can
 * be made the one, and an agent put there starts on it at once.
 */
export function CardDetailDialog({
  client,
  cardId,
  onClose,
  onSend,
}: {
  client: string;
  /** The card open; null: none. */
  cardId: string | null;
  onClose: () => void;
  onSend: (card: PlanCard) => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const plan = usePortalPlan(org.id, cardId ? client : null);
  const card = cardId && plan.data ? (planCards(plan.data).find((c) => c.id === cardId) ?? null) : null;
  return (
    <Dialog
      open={cardId !== null && card !== null}
      onOpenChange={(o) => !o && onClose()}
      title={card?.title ?? ""}
      closeLabel={t("common.close")}
      width={920}
      className="portal-detail"
    >
      {card && plan.data && (
        <Detail key={card.id} card={card} plan={plan.data} onClose={onClose} onSend={() => onSend(card)} />
      )}
    </Dialog>
  );
}

function Detail({
  card,
  plan,
  onClose,
  onSend,
}: {
  card: PlanCard;
  plan: PortalPlan;
  onClose: () => void;
  onSend: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const toast = useToast();
  const save = useSavePortalCard(org.id);
  const remove = useDeletePortalCard(org.id);
  const changes = can(org, "assign_work");
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [caption, setCaption] = useState(card.caption);
  const [check, setCheck] = useState("");
  const [confirming, setConfirming] = useState(false);
  const failed = (error: unknown) => toast.show(portalErrorText(t, error, i18n.language), "error");
  const patch = (fields: PortalCardInput) => save.mutate({ cardId: card.id, ...fields }, { onError: failed });
  const day = portalDayOf(card.date);
  const time = portalTimeOf(card.date) ?? DEFAULT_TIME;
  const checks = portalChecks(card);
  const link = portalLink(card.link);
  const rightHand = rightHandOf(dir.agents);
  const dateLabels = {
    previousMonth: t("common.previousMonth"),
    nextMonth: t("common.nextMonth"),
    choose: t("common.chooseDate"),
    clear: t("portal.empty.noDate"),
  };
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  const people = usePortalPeople();
  const responsible = card.members[0];
  const taskNumber = portalTaskNumbers(usePortalTasks(org.id, card.task !== null).data).get(card.id);
  return (
    <>
      <DialogBody className="portal-detail__body">
        <div className="portal-detail__main">
          <Locked when={!changes}>
            <div className="ac-form">
              <Field label={t("portal.form.title")}>
                <Input
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    const next = title.trim();
                    if (next && next !== card.title) patch({ title: next });
                    else setTitle(card.title);
                  }}
                />
              </Field>
              <div className="portal-form__pair">
                <Field label={t("portal.detail.list")}>
                  <Select
                    value={card.list ?? PORTAL_NO_LIST}
                    onValueChange={(next) => {
                      const list = next === PORTAL_NO_LIST ? null : next;
                      const others = (plan.lists.find((l) => l.id === list)?.cards ?? plan.unlisted).filter(
                        (c) => c.id !== card.id,
                      );
                      patch({ list, order: portalOrderAt(others, others.length) });
                    }}
                    options={[
                      ...plan.lists.map((l) => ({ value: l.id, label: l.name })),
                      { value: PORTAL_NO_LIST, label: t("portal.plan.noList") },
                    ]}
                  />
                </Field>
                <Field label={t("portal.form.type")}>
                  <Select<PortalType>
                    value={card.type}
                    onValueChange={(type) => patch({ type })}
                    options={PORTAL_TYPES.map((value) => ({ value, label: t(`portal.types.${value}`) }))}
                  />
                </Field>
              </div>
              <Group label={t("portal.detail.stage")} hint={t("portal.detail.stageHint")}>
                <span className="portal-detail__chips">
                  <StageChip stage={card.stage} />
                  {taskNumber !== undefined && (
                    <Link
                      className="ac-link small tabular"
                      to="/org/$orgId/issues/$number"
                      params={{ orgId: org.id, number: String(taskNumber) }}
                    >
                      {t("portal.task", { number: taskNumber })}
                    </Link>
                  )}
                </span>
              </Group>
              <Group label={t("portal.plan.labels")}>
                <span className="portal-detail__chips">
                  {card.labels.flatMap((id) => {
                    const label = plan.labels.find((l) => l.id === id);
                    return label ? <LabelChip key={id} label={label} /> : [];
                  })}
                  {changes && plan.labels.length > 0 && (
                    <Popover
                      side="bottom"
                      label={t("portal.plan.labels")}
                      className="portal-detail__pick"
                      trigger={
                        <Button
                          size="sm"
                          iconOnly
                          icon="plus"
                          aria-label={t("portal.plan.labels")}
                          title={t("portal.plan.labels")}
                        />
                      }
                    >
                      <ul className="portal-detail__options">
                        {plan.labels.map((label) => {
                          const boxId = `label-${card.id}-${label.id}`;
                          return (
                            <li key={label.id}>
                              <Checkbox
                                id={boxId}
                                checked={card.labels.includes(label.id)}
                                onCheckedChange={(on) => patch({ labels: toggle(card.labels, label.id, on) })}
                              />
                              <label htmlFor={boxId}>
                                <LabelChip label={label} />
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </Popover>
                  )}
                </span>
              </Group>
              <Group
                label={t("portal.detail.members")}
                hint={responsible && dir.agentById.has(responsible) ? t("portal.detail.agentStarts") : undefined}
              >
                <span className="portal-detail__chips">
                  {people.known(card.members).map((w) => (
                    <span key={w.id} className="portal-detail__person">
                      <WhoFace who={w} size="xs" />
                      {w.name}
                      {w.id === responsible && (
                        <span className="portal-detail__lead">{t("portal.detail.responsible")}</span>
                      )}
                    </span>
                  ))}
                  {changes && (
                    <Popover
                      side="bottom"
                      label={t("portal.detail.members")}
                      className="portal-detail__pick"
                      trigger={
                        <Button
                          size="sm"
                          iconOnly
                          icon="personAdd"
                          aria-label={t("portal.detail.members")}
                          title={t("portal.detail.members")}
                        />
                      }
                    >
                      <ul className="portal-detail__options">
                        {people.choices(card.members).map((w) => {
                          const boxId = `member-${card.id}-${w.id}`;
                          const on = card.members.includes(w.id);
                          return (
                            <li key={w.id}>
                              <Checkbox
                                id={boxId}
                                checked={on}
                                onCheckedChange={(next) => patch({ members: toggle(card.members, w.id, next) })}
                              />
                              <label htmlFor={boxId} className="portal-detail__person">
                                <WhoFace who={w} size="xs" />
                                {w.name}
                              </label>
                              {/* The first member has the card's task: the mark on who it is, the way there on the others. */}
                              {w.id === responsible ? (
                                <span className="portal-detail__lead">{t("portal.detail.responsible")}</span>
                              ) : (
                                on && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={t("portal.detail.makeResponsibleName", { name: w.name })}
                                    onClick={() => patch({ members: portalWithResponsible(card.members, w.id) })}
                                  >
                                    {t("portal.detail.makeResponsible")}
                                  </Button>
                                )
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </Popover>
                  )}
                </span>
              </Group>
              {/* Two dates, never one beside the other in one field: the day it is made, and the day it goes out. */}
              <div className="portal-detail__dates">
                <Field label={t("portal.detail.produceOn")} example={t("portal.detail.produceHint")}>
                  <DatePicker
                    value={card.produceOn}
                    short
                    onChange={(produceOn) => patch({ produceOn })}
                    onClear={() => patch({ produceOn: null })}
                    locale={i18n.language}
                    placeholder={t("portal.empty.noDate")}
                    labels={dateLabels}
                  />
                </Field>
                <Field label={t("portal.detail.postOn")} example={t("portal.detail.postHint")}>
                  <DatePicker
                    value={day}
                    short
                    onChange={(next) => patch({ date: portalSendDate(next, time) })}
                    onClear={() => patch({ date: null })}
                    locale={i18n.language}
                    placeholder={t("portal.empty.noDate")}
                    labels={dateLabels}
                  />
                </Field>
                {day && (
                  <Field label={t("portal.form.time")}>
                    <TimeSelect value={time} onChange={(next) => patch({ date: portalSendDate(day, next) })} />
                  </Field>
                )}
              </div>
              <Field label={t("portal.detail.description")}>
                <Textarea
                  value={description}
                  rows={4}
                  maxLength={20000}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => description !== card.description && patch({ description })}
                />
              </Field>
              <Group label={t("portal.detail.checklist")} aside={checks ? `${checks.done}/${checks.total}` : undefined}>
                {checks && <Meter value={checks.done} max={checks.total} label={t("portal.plan.checks", checks)} />}
                <ul className="portal-detail__checks">
                  {card.checklist.map((c) => {
                    const boxId = `check-${card.id}-${c.id}`;
                    return (
                      <li key={c.id} data-done={c.done || undefined}>
                        <Checkbox
                          id={boxId}
                          checked={c.done}
                          onCheckedChange={(done) =>
                            patch({ checklist: card.checklist.map((x) => (x.id === c.id ? { ...x, done } : x)) })
                          }
                        />
                        <label htmlFor={boxId}>{c.text}</label>
                        {changes && (
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            icon="close"
                            aria-label={t("common.removeName", { name: c.text })}
                            onClick={() => patch({ checklist: card.checklist.filter((x) => x.id !== c.id) })}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {changes && (
                  <Input
                    aria-label={t("portal.detail.addCheck")}
                    placeholder={t("portal.detail.addCheck")}
                    value={check}
                    maxLength={300}
                    onChange={(e) => setCheck(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || !check.trim()) return;
                      e.preventDefault();
                      patch({
                        checklist: [
                          ...card.checklist,
                          { id: crypto.randomUUID().slice(0, 12), text: check.trim(), done: false },
                        ],
                      });
                      setCheck("");
                    }}
                  />
                )}
              </Group>
              <PortalFiles label={t("portal.form.files")} files={card.files} onChange={(files) => patch({ files })} />
              <Field label={t("portal.form.caption")}>
                <Textarea
                  value={caption}
                  rows={3}
                  maxLength={5000}
                  onChange={(e) => setCaption(e.target.value)}
                  onBlur={() => caption !== card.caption && patch({ caption })}
                />
              </Field>
            </div>
          </Locked>
        </div>
        <Comments card={card} />
      </DialogBody>
      <DialogFooter>
        {changes &&
          (confirming ? (
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(card.id, {
                  onSuccess: () => {
                    toast.show(t("portal.card.deleted"));
                    onClose();
                  },
                  onError: failed,
                })
              }
            >
              {t("portal.card.deleteTitle")}
            </Button>
          ) : (
            <Button variant="ghost" icon="trash" onClick={() => setConfirming(true)}>
              {t("portal.delete")}
            </Button>
          ))}
        <span className="portal-detail__grow" />
        {rightHand && (
          <AskAgentButton
            agent={rightHand}
            label={t("portal.detail.ask", { name: rightHand.name })}
            draft={t("portal.detail.askDraft", {
              title: card.title,
              client: portalClientName(card.client),
              id: card.id,
            })}
          />
        )}
        {card.item
          ? link && (
              <Button asChild icon="external">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  {t("portal.openAtPortal")}
                </a>
              </Button>
            )
          : changes && (
              <Button variant="primary" icon="send" onClick={onSend}>
                {t("portal.send")}
              </Button>
            )}
      </DialogFooter>
    </>
  );
}

/** A labelled part of the card that isn't one control (chips, a checklist): the field's label over it, naming it. */
function Group({
  label,
  hint,
  aside,
  children,
}: {
  label: string;
  hint?: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings the browser's own frame and legend placement
    <div className="portal-detail__group" role="group" aria-label={label}>
      <span className="ac-field__label-row">
        <span className="ac-field__label">{label}</span>
        {aside && <span className="small muted tabular">{aside}</span>}
      </span>
      {children}
      {hint && <span className="ac-field__example">{hint}</span>}
    </div>
  );
}

/**
 * What was said about the card, newest first, under a field to say more. Whoever wrote it is found among the
 * workspace's people, or its agents for `agent:<id>`. A comment is plain words: its web addresses become links,
 * nothing else is ever read as markup. One's own can be deleted, and any by who may change the board.
 */
function Comments({ card }: { card: PlanCard }) {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  const toast = useToast();
  const { add, remove } = usePortalComments(org.id);
  const now = useNow(60_000);
  const [text, setText] = useState("");
  const posts = can(org, "post");
  const failed = (error: unknown) => toast.show(portalErrorText(t, error, i18n.language), "error");
  const author = (c: PortalComment) => {
    if (c.by.startsWith("agent:")) {
      const id = c.by.slice(6);
      const name = dir.agentById.get(id)?.name ?? t("channel.unknownAgent");
      return { name, face: <AgentAvatar agentId={id} name={name} size="sm" /> };
    }
    const name = dir.memberById.get(c.by)?.name ?? t("portal.detail.someone");
    return { name, face: <PersonAvatar id={c.by} name={name} size="sm" /> };
  };
  const send = () => {
    if (!text.trim()) return;
    add.mutate({ cardId: card.id, text: text.trim() }, { onSuccess: () => setText(""), onError: failed });
  };
  return (
    <section className="portal-detail__side" aria-label={t("portal.detail.comments")}>
      <h3 className="ac-field__label">{t("portal.detail.comments")}</h3>
      {posts && (
        <form
          className="portal-detail__say"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            aria-label={t("portal.detail.writeComment")}
            placeholder={t("portal.detail.writeComment")}
            value={text}
            rows={2}
            maxLength={5000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          <Button type="submit" size="sm" disabled={!text.trim()} loading={add.isPending}>
            {t("portal.detail.comment")}
          </Button>
        </form>
      )}
      {card.comments.length === 0 && <p className="small muted">{t("portal.detail.noComments")}</p>}
      <ul className="portal-detail__comments">
        {[...card.comments]
          .sort((a, b) => b.at - a.at)
          .map((c) => {
            const who = author(c);
            return (
              <li key={c.id} className="portal-comment">
                {who.face}
                <div className="portal-comment__body">
                  <span className="portal-comment__head">
                    <b>{who.name}</b>
                    <time className="small muted">
                      {relativeTime(t, i18n.language, new Date(c.at).toISOString(), new Date(now))}
                    </time>
                    {(c.by === me.user.id || can(org, "assign_work")) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon="trash"
                        aria-label={t("portal.detail.deleteComment")}
                        title={t("portal.detail.deleteComment")}
                        onClick={() => remove.mutate({ cardId: card.id, commentId: c.id }, { onError: failed })}
                      />
                    )}
                  </span>
                  <p className="portal-comment__text">
                    {portalTextParts(c.text).map((part, i) =>
                      part.href ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in its order
                        <a key={i} className="ac-link" href={part.href} target="_blank" rel="noopener noreferrer">
                          {part.text}
                          <Icon name="external" size={14} />
                        </a>
                      ) : (
                        part.text
                      ),
                    )}
                  </p>
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
