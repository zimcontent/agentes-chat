import type { ReviewRound } from "@dougbot/client";
import { useReviewWhatsApp, useSetReviewWhatsApp, useWhatsApp, useWhatsAppChats } from "@dougbot/client";
import { can } from "@dougbot/client/lib/permissions";
import { Button, Dialog, DialogBody, DialogFooter, Field, FormStack, Icon, Select } from "@dougbot/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useReviewWords } from "./words";
import "./review-rounds.css";

/*
 * The rounds of changes asked of the person who sent the work, and where they are told (docs/adr/doug-0012-editor-
 * delivery.md §10–§11): the log the team reads, and the WhatsApp group each person gets the notice in.
 */

/** `2026-11-15T14:02` → "15/11 14:02", in the reader's own clock. */
export function useWhen() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
}

/** "2 h 43 min", "12 min", "3 d". */
export function took(fromIso: string, toIso: string) {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `${Math.round(hours / 24)} d`;
}

/** The review's rounds, newest first, each as its four moments. */
export function ReviewLog({ rounds }: { rounds: ReviewRound[] }) {
  const w = useReviewWords().editor;
  const when = useWhen();
  if (rounds.length === 0) return null;
  return (
    <section className="rr-log" aria-label={w.log}>
      <h2 className="vr-notes__title">{w.log}</h2>
      <ol className="rr-rounds">
        {[...rounds].reverse().map((r) => (
          <li key={r.id} className="rr-round">
            <span className="rr-round__title">
              V{r.version}
              {r.fromClient && <span className="rr-tag">{w.fromClient}</span>}
            </span>
            <ul className="rr-steps">
              <li data-done="">
                <Icon name="edit" size={14} />
                {w.asked(r.askedBy, when(r.askedAt))}
              </li>
              <li data-done={r.notified?.whatsapp ? "" : undefined} data-bad={r.notified?.error ? "" : undefined}>
                <Icon name="send" size={14} />
                {r.notified?.whatsapp
                  ? w.told(r.notified.whatsapp.chat, when(r.notified.whatsapp.at))
                  : r.notified?.error
                    ? w.toldFailed(r.notified.error)
                    : w.notTold}
              </li>
              <li data-done={r.seenAt ? "" : undefined}>
                <Icon name="eye" size={14} />
                {r.seenAt ? w.seen(when(r.seenAt)) : w.notSeen}
              </li>
              <li data-done={r.answeredAt ? "" : undefined}>
                <Icon name="upload" size={14} />
                {r.answeredAt && r.answeredVersion
                  ? w.answered(r.answeredVersion, when(r.answeredAt), took(r.askedAt, r.answeredAt))
                  : w.waiting}
              </li>
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** One line for a list row: where the newest round stands. */
export function roundLine(
  round: ReviewRound | null | undefined,
  w: ReturnType<typeof useReviewWords>["editor"],
  when: (iso: string) => string,
) {
  if (!round) return "";
  return [
    w.rowAsked(when(round.askedAt)),
    round.seenAt ? w.rowSeen(when(round.seenAt)) : w.rowNotSeen,
    round.answeredAt && round.answeredVersion ? w.rowAnswered(round.answeredVersion, when(round.answeredAt)) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Where a person is told of the changes asked of them: the group, and a way to choose it for who may give work. */
export function WhatsAppNotice({ person }: { person: { id: string; name: string } }) {
  const { org } = useOrg();
  const w = useReviewWords().editor;
  const targets = useReviewWhatsApp(org.id);
  const [open, setOpen] = useState(false);
  const target = targets.data?.find((t) => t.userId === person.id) ?? null;
  const manage = can(org, "assign_work");
  if (!targets.isSuccess || (!manage && !target)) return null;
  return (
    <div className="rr-notice ac-actline">
      <span className="small">
        <Icon name="send" size={14} /> <b>{w.notify}:</b>{" "}
        {target ? `${target.chatName} (${target.accountLabel})` : <span className="muted">{w.notifyNone}</span>}
      </span>
      {manage && (
        <Button variant="link" onClick={() => setOpen(true)}>
          {target ? w.coverChange : w.notifyPick}
        </Button>
      )}
      {open && <NoticeDialog person={person} current={target} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NoticeDialog({
  person,
  current,
  onClose,
}: {
  person: { id: string; name: string };
  current: { accountId: string; chatId: string } | null;
  onClose: () => void;
}) {
  const { org } = useOrg();
  const { t } = useTranslation();
  const w = useReviewWords().editor;
  const numbers = useWhatsApp(org.id);
  const [accountId, setAccountId] = useState(current?.accountId ?? "");
  const [chatId, setChatId] = useState(current?.chatId ?? "");
  const chats = useWhatsAppChats(org.id, accountId || null);
  const save = useSetReviewWhatsApp(org.id);
  const accounts = (numbers.data?.accounts ?? []).filter((a) => a.status === "connected");
  // Groups first: a person's demands usually have one.
  const list = (chats.data?.pages ?? []).flatMap((p) => p.chats);
  const options = [...list.filter((c) => c.group), ...list.filter((c) => !c.group)].map((c) => ({
    value: c.id,
    label: c.name || c.phone || c.id,
  }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${w.notify}: ${person.name}`}
      closeLabel={t("common.close")}
    >
      <DialogBody>
        <FormStack>
          <p className="small muted">{w.notifyHint(person.name.split(" ")[0] || person.name)}</p>
          <Field label={w.notifyNumber}>
            <Select
              value={accountId}
              onValueChange={(v) => {
                setAccountId(v);
                setChatId("");
              }}
              options={accounts.map((a) => ({ value: a.id, label: a.label }))}
              placeholder={w.notifyNumber}
            />
          </Field>
          <Field label={w.notifyChat}>
            <Select
              value={chatId}
              onValueChange={setChatId}
              options={options}
              disabled={!accountId}
              placeholder={w.notifyChat}
            />
          </Field>
        </FormStack>
      </DialogBody>
      <DialogFooter>
        {current && (
          <Button
            variant="danger"
            loading={save.isPending && save.variables?.target === null}
            onClick={() => save.mutateAsync({ userId: person.id, target: null }).then(onClose)}
          >
            {w.notifyRemove}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!accountId || !chatId}
          loading={save.isPending && save.variables?.target !== null}
          onClick={() => save.mutateAsync({ userId: person.id, target: { accountId, chatId } }).then(onClose)}
        >
          {w.notifySave}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
