import type { PlanCard, PortalCardInput, PortalComment, PortalPlan, PortalType } from "@dougbot/client";
import { usePortalComments, usePortalPlan, usePortalTasks, useSavePortalCard } from "@dougbot/client";
import { daysBetween, formatFullDate, formatShortDate, relativeTime } from "@dougbot/client/lib/format";
import { linkPill } from "@dougbot/client/lib/link-pills";
import { can } from "@dougbot/client/lib/permissions";
import {
  PORTAL_NO_LIST,
  PORTAL_TYPES,
  planCards,
  portalArticle,
  portalArticleIsLong,
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
  portalWriterName,
} from "@dougbot/client/lib/portal";
import { rightHandOf } from "@dougbot/client/lib/right-hand";
import { prefixLines, wrapSelection } from "@dougbot/client/lib/wiki";
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
  useAutoGrow,
} from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkPill } from "@/chat/LinkPill";
import { AgentAvatar, PersonAvatar } from "@/components/AgentAvatar";
import { AskAgentButton } from "@/components/AskAgentButton";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useNow } from "@/hooks/useNow";
import { Markdown } from "@/lib/markdown";
import { useToast } from "@/lib/toast";
import { useCopyCardLink } from "./card-link";
import { usePortalPeople, WhoFace } from "./members";
import { DeleteCardDialog } from "./PortalBoard";
import { PortalFiles } from "./PortalFiles";
import { LabelChip, StageChip } from "./stage";

/** The hour a post date starts with when it had none. */
const DEFAULT_TIME = "09:00";

/**
 * A card opened (ADR 9001 §8). On the left what the post is: its title with the mark that says it is finished, then
 * its stage, list and type on one line, then the description, which is the page's main thing and so comes first, as on
 * Trello: it reads as an article (formatted, its links as links, a long one folded under "Show more"); a press on it,
 * on "Edit", or on the empty box that invites one turns it into a field with a formatting bar, kept on "Save". Then
 * its labels and members. Under it the checklist, the attachments with their pictures, and the
 * caption. On the right the two days (the one the team makes it and, apart, the one it goes out) over what was said
 * about it, newest first. Every other change is kept as it is made (a text when its field is left). Whoever may give
 * agents work changes it; anyone who may post can still comment. Its stage is automatic. Once it was sent, "Send for
 * approval" gives way to "Open at the portal".
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
  // A description being written is kept from a stray press outside or Esc.
  const [writing, setWriting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const copyLink = useCopyCardLink();
  const changes = can(org, "assign_work");
  return (
    <Dialog
      open={cardId !== null && card !== null}
      onOpenChange={(o) => !o && onClose()}
      title={card?.title ?? ""}
      closeLabel={t("common.close")}
      width={960}
      className="portal-detail"
      unsaved={writing}
      // The head is the card's name itself, to press and rewrite, after the mark that says it is finished. The
      // dialog's own title stays for whoever hears the page.
      leading={card ? <TitleHead key={card.id} card={card} /> : undefined}
      // Its link, to share (it opens this very card), and "Delete" for whoever may change the board.
      actions={
        card && (
          <>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="link"
              aria-label={t("portal.card.copyLink")}
              title={t("portal.card.copyLink")}
              onClick={() => copyLink(card)}
            />
            {changes && (
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="trash"
                aria-label={t("portal.card.deleteOf", { title: card.title })}
                title={t("portal.delete")}
                onClick={() => setDeleting(true)}
              />
            )}
          </>
        )
      }
    >
      <DeleteCardDialog card={deleting ? card : null} onClose={() => setDeleting(false)} onDeleted={onClose} />
      {card && plan.data && (
        <Detail key={card.id} card={card} plan={plan.data} onSend={() => onSend(card)} onWriting={setWriting} />
      )}
    </Dialog>
  );
}

function Detail({
  card,
  plan,
  onSend,
  onWriting,
}: {
  card: PlanCard;
  plan: PortalPlan;
  onSend: () => void;
  onWriting: (writing: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const toast = useToast();
  const save = useSavePortalCard(org.id);
  const changes = can(org, "assign_work");
  const [caption, setCaption] = useState(card.caption);
  const [check, setCheck] = useState("");
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
        <div className="portal-detail__top">
          <Locked when={!changes}>
            <div className="portal-detail__stack">
              <div className="portal-detail__props">
                <Group label={t("portal.detail.stage")}>
                  <span className="portal-detail__chips" title={t("portal.detail.stageHint")}>
                    <StageChip stage={card.stage} review={card.review} />
                    {card.review && (
                      <Link
                        className="ac-link small"
                        to="/org/$orgId/review/$reviewId"
                        params={{ orgId: org.id, reviewId: card.review.reviewId }}
                      >
                        {t("portal.teamReview.open")}
                      </Link>
                    )}
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
                <Field label={t("portal.detail.list")}>
                  <Select
                    size="sm"
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
                    size="sm"
                    value={card.type}
                    onValueChange={(type) => patch({ type })}
                    options={PORTAL_TYPES.map((value) => ({ value, label: t(`portal.types.${value}`) }))}
                  />
                </Field>
              </div>
            </div>
          </Locked>
        </div>
        {/* Right under the title, as on Trello: the card's main thing, found before its dates and people. */}
        <div className="portal-detail__desc">
          <Locked when={!changes}>
            <Description
              text={card.description}
              changes={changes}
              onSave={(description) => patch({ description })}
              onWriting={onWriting}
            />
          </Locked>
        </div>
        <div className="portal-detail__when">
          <Locked when={!changes}>
            {/* Two dates, never one beside the other in one field: the day it is made, and the day it goes out. */}
            <div className="portal-detail__dates">
              <Field
                label={t("portal.detail.produceOn")}
                hint={{
                  name: t("common.about", { label: t("portal.detail.produceOn") }),
                  text: t("portal.detail.produceHint"),
                }}
              >
                <DatePicker
                  size="sm"
                  value={card.produceOn}
                  short
                  onChange={(produceOn) => patch({ produceOn })}
                  onClear={() => patch({ produceOn: null })}
                  locale={i18n.language}
                  placeholder={t("portal.empty.noDate")}
                  labels={dateLabels}
                />
              </Field>
              <Field
                label={t("portal.detail.postOn")}
                hint={{
                  name: t("common.about", { label: t("portal.detail.postOn") }),
                  text: t("portal.detail.postHint"),
                }}
              >
                <DatePicker
                  size="sm"
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
          </Locked>
        </div>
        <div className="portal-detail__main">
          <Locked when={!changes}>
            <div className="portal-detail__stack">
              <div className="portal-detail__pair">
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
              </div>
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
              <PortalFiles
                label={t("portal.detail.attachments")}
                files={card.files}
                onChange={(files) => patch({ files })}
                preview
              />
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

/**
 * The dialog's head: the mark that the card is finished (pressed to say so, or to take it back) and its title, a field
 * that reads as the card's name and is kept when it is left. Whoever can't change the board reads both.
 */
function TitleHead({ card }: { card: PlanCard }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const save = useSavePortalCard(org.id);
  const changes = can(org, "assign_work");
  const [title, setTitle] = useState(card.title);
  const patch = (fields: PortalCardInput) =>
    save.mutate(
      { cardId: card.id, ...fields },
      { onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error") },
    );
  return (
    <span className="portal-detail__head">
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon={card.done ? "stageDone" : "stageTodo"}
        className="portal-detail__done"
        aria-pressed={card.done}
        aria-label={t("portal.detail.done")}
        title={card.done ? t("portal.detail.markOpen") : t("portal.detail.markDone")}
        disabled={!changes}
        onClick={() => patch({ done: !card.done })}
      />
      <Input
        className="portal-detail__title"
        aria-label={t("portal.form.title")}
        value={title}
        maxLength={120}
        readOnly={!changes}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={() => {
          const next = title.trim();
          if (next && next !== card.title) patch({ title: next });
          else setTitle(card.title);
        }}
      />
    </span>
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

/** A description longer than this many lines is folded: the rest is behind "Show more". */
const ROWS_WRITING = 10;

/**
 * The card's description. Read, it is an article: the app's own formatting (headings, bold, lists, rules, line
 * breaks as written), every address a link, a long one folded with "Show more" under it. "Edit" makes it a field
 * with a formatting bar that writes the marks for the person; "Save" keeps it, "Cancel" and Esc leave it as it was.
 */
function Description({
  text,
  changes,
  onSave,
  onWriting,
}: {
  text: string;
  changes: boolean;
  onSave: (text: string) => void;
  onWriting: (writing: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const select = useRef<[number, number] | null>(null);
  const article = portalArticle(text);
  const long = portalArticleIsLong(article);
  useAutoGrow(field, draft ?? "", draft !== null);
  useLayoutEffect(() => {
    const el = field.current;
    const range = select.current;
    if (!el || !range) return;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
    select.current = null;
  });
  const edit = (next: string | null) => {
    setDraft(next);
    onWriting(next !== null);
  };
  const start = () => {
    select.current = [text.length, text.length];
    edit(text);
  };
  const save = () => {
    if (draft === null) return;
    if (draft.trim() !== text.trim()) onSave(draft.trim());
    edit(null);
  };
  const apply = (made: { text: string; start: number; end: number }) => {
    select.current = [made.start, made.end];
    setDraft(made.text);
  };
  const at = () => {
    const el = field.current;
    const value = draft ?? "";
    return { value, start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  };
  const tools = [
    {
      icon: "bold" as const,
      label: t("wiki.editor.bold"),
      run: () => {
        const s = at();
        apply(wrapSelection(s.value, s.start, s.end, "**", "**", t("wiki.editor.boldText")));
      },
    },
    {
      icon: "italic" as const,
      label: t("wiki.editor.italic"),
      run: () => {
        const s = at();
        apply(wrapSelection(s.value, s.start, s.end, "_", "_", t("wiki.editor.italicText")));
      },
    },
    {
      icon: "list" as const,
      label: t("wiki.editor.list"),
      run: () => {
        const s = at();
        apply(prefixLines(s.value, s.start, s.end, "- "));
      },
    },
    {
      icon: "link" as const,
      label: t("wiki.editor.link"),
      run: () => {
        const s = at();
        apply(wrapSelection(s.value, s.start, s.end, "[", "](https://)", t("portal.detail.linkText")));
      },
    },
  ];
  const name = t("portal.detail.description");
  return (
    <section className="portal-detail__group portal-article" aria-label={name}>
      <span className="ac-field__label-row">
        <h3 className="ac-field__label">{name}</h3>
        {changes && draft === null && article && (
          <Button size="sm" onClick={start} aria-label={t("portal.detail.editDescription")}>
            {t("portal.detail.edit")}
          </Button>
        )}
      </span>
      {draft !== null ? (
        <div className="portal-article__editor">
          <div className="portal-article__tools" role="toolbar" aria-label={t("wiki.editor.toolbar")}>
            {tools.map((tool) => (
              <Button
                key={tool.icon}
                size="sm"
                variant="ghost"
                iconOnly
                icon={tool.icon}
                aria-label={tool.label}
                title={tool.label}
                // The text keeps its selection: the press never takes the focus.
                onMouseDown={(e) => e.preventDefault()}
                onClick={tool.run}
              />
            ))}
          </div>
          <Textarea
            ref={field}
            aria-label={name}
            value={draft}
            rows={ROWS_WRITING}
            maxLength={20000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const mod = e.metaKey || e.ctrlKey;
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                edit(null);
              } else if (mod && e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (mod && e.key.toLowerCase() === "b") {
                e.preventDefault();
                tools[0]?.run();
              } else if (mod && e.key.toLowerCase() === "i") {
                e.preventDefault();
                tools[1]?.run();
              }
            }}
          />
          <span className="portal-article__acts">
            <Button size="sm" variant="primary" onClick={save}>
              {t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => edit(null)}>
              {t("common.cancel")}
            </Button>
          </span>
        </div>
      ) : article ? (
        <>
          {/* A press on the words (not on a link in them) opens them to write, as on Trello. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: "Edit" above is the keyboard's way */}
          <div
            className="portal-article__text"
            data-folded={(long && !open) || undefined}
            data-editable={changes || undefined}
            onClick={(e) => {
              if (changes && !(e.target as Element).closest("a, button")) start();
            }}
          >
            <Markdown source={article} variant="message" />
          </div>
          {long && (
            <Button
              size="sm"
              className="portal-article__more"
              icon={open ? "chevronUp" : "chevronDown"}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? t("portal.detail.showLess") : t("portal.detail.showMore")}
            </Button>
          )}
        </>
      ) : changes ? (
        <button type="button" className="portal-article__add" onClick={start}>
          {t("portal.detail.addDescription")}
        </button>
      ) : (
        <p className="small muted portal-article__none">{t("portal.detail.noDescription")}</p>
      )}
    </section>
  );
}

/** A comment's day: how long ago while it is fresh, the date itself after a week (with the year once it is another). */
function commentWhen(t: ReturnType<typeof useTranslation>["t"], locale: string, at: number, now: number) {
  const iso = new Date(at).toISOString();
  if (Math.abs(daysBetween(iso, new Date(now))) < 7) return relativeTime(t, locale, iso, new Date(now));
  return formatShortDate(locale, iso, new Date(at).getFullYear() !== new Date(now).getFullYear());
}

/**
 * What was said about the card, newest first, under a field to say more. Whoever wrote it is found among the
 * workspace's people, or its agents for `agent:<id>`; a comment brought from another board says its writer's name as
 * it was there. A comment is plain words: its web addresses become links (a known service's as its pill), nothing
 * else is ever read as markup. One's own can be deleted, and any by who may change the board.
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
    const name = dir.memberById.get(c.by)?.name ?? portalWriterName(c.by) ?? t("portal.detail.someone");
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
                    <time
                      className="small muted"
                      dateTime={new Date(c.at).toISOString()}
                      title={formatFullDate(i18n.language, new Date(c.at).toISOString())}
                    >
                      {commentWhen(t, i18n.language, c.at, now)}
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
                    {portalTextParts(c.text).map((part, i) => {
                      const pill = part.href ? linkPill(part.href) : null;
                      return part.href && pill ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in its order
                        <LinkPill key={i} href={part.href} pill={pill} />
                      ) : part.href ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in its order
                        <a key={i} className="ac-link" href={part.href} target="_blank" rel="noopener noreferrer">
                          {part.text}
                          <Icon name="external" size={14} />
                        </a>
                      ) : (
                        part.text
                      );
                    })}
                  </p>
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
