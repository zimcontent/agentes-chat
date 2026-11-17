import { useChannels, useIssues, useSendWork, type VideoReviewSummary } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Locked,
  SearchSelect,
  Segmented,
  Select,
  Textarea,
} from "@agenteschat/ui";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { DropFile, Progress } from "./TaskVideoDelivery";
import { useReviewWords } from "./words";
import "./send-work.css";

/*
 * Work a person made, sent for review from Revisão itself (docs/adr/doug-0015-team-work-review.md): a video, or a design
 * piece as its slides. The files go first to the conversation the team talks about it in (a group, or a task's), then
 * the review opens there. The next version of one's own work is sent from its page.
 */

type Medium = "video" | "design";

/** What the server takes (doug-0015): the light copy is made from these. */
const VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;
const PICTURE = /\.(png|jpe?g|webp|avif|gif)$/i;
const MAX_BYTES = 2 * 1024 ** 3;
const MAX_SLIDES = 60;
const ACCEPT: Record<Medium, string> = {
  video: "video/*,.mp4,.mov,.m4v,.webm,.mkv",
  design: "image/png,image/jpeg,image/webp",
};

/** Why these files can't go, in the review's words; null when they can. */
export function filesRefusal(
  medium: Medium,
  files: readonly { name: string; size: number }[],
  w: ReturnType<typeof useReviewWords>["team"],
): string | null {
  if (medium === "video" && files.some((f) => !VIDEO.test(f.name))) return w.notVideo;
  const odd = medium === "design" ? files.find((f) => !PICTURE.test(f.name)) : undefined;
  if (odd) return w.notPicture(odd.name);
  if (medium === "design" && files.length > MAX_SLIDES) return w.tooMany;
  const big = files.find((f) => f.size > MAX_BYTES);
  return big ? w.tooBig(big.name) : null;
}

/** Slides in the order their names say (`2.png` before `10.png`), as an export names them. */
export const inSlideOrder = <F extends { name: string }>(files: F[]) =>
  [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

/** Uploads files to one conversation, one after the other, with the share of the current one sent. */
function useUploads() {
  const api = useApi();
  const { org } = useOrg();
  const [at, setAt] = useState<{ i: number; n: number; share: number } | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const upload = async (files: File[], place: { channelId?: string; threadId?: string | null; reviewId?: string }) => {
    const ids: string[] = [];
    stopper.current = new AbortController();
    try {
      for (const [i, file] of files.entries()) {
        setAt({ i: i + 1, n: files.length, share: 0 });
        const done = await api.artifacts.upload(org.id, file, {
          ...place,
          signal: stopper.current.signal,
          onProgress: (share) => setAt({ i: i + 1, n: files.length, share }),
        });
        ids.push(done.id);
      }
      return ids;
    } finally {
      setAt(null);
      stopper.current = null;
    }
  };
  return { upload, at, cancel: () => stopper.current?.abort() };
}

/** The files chosen: a drop target, then what was picked with a way to change it. */
function PickFiles({
  medium,
  files,
  onFiles,
  busy,
}: {
  medium: Medium;
  files: File[];
  onFiles: (files: File[]) => void;
  busy: boolean;
}) {
  const w = useReviewWords().team;
  if (files.length === 0) {
    return (
      <DropFile
        label={medium === "video" ? w.pickVideo : w.pickSlides}
        hint={medium === "video" ? w.videoHint : w.slidesHint}
        accept={ACCEPT[medium]}
        multiple={medium === "design"}
        busy={busy}
        onFiles={(picked) => onFiles(medium === "design" ? inSlideOrder(picked) : picked.slice(0, 1))}
      />
    );
  }
  return (
    <div className="sw-picked ac-actline">
      <span className="sw-picked__name">{medium === "video" ? (files[0]?.name ?? "") : w.slides(files.length)}</span>
      <Button variant="link" disabled={busy} onClick={() => onFiles([])}>
        {w.change}
      </Button>
    </div>
  );
}

/** "Mandar para revisão": what it is, the files, a title, where the team talks about it, and a word. */
export function SendWorkDialog({ onClose }: { onClose: () => void }) {
  const { org } = useOrg();
  const w = useReviewWords();
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const navigate = useNavigate();
  const send = useSendWork(org.id);
  const uploads = useUploads();
  const channels = useChannels(org.id);
  const issues = useIssues(org.id);
  const [medium, setMedium] = useState<Medium>("video");
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [where, setWhere] = useState<"group" | "task">("group");
  const groups = (channels.data ?? []).filter((c) => c.isMember && c.can?.post !== false);
  const [groupId, setGroupId] = useState<string | undefined>(undefined);
  const shownGroup = groupId ?? groups.find((c) => c.name === "general")?.id ?? groups[0]?.id;
  const [taskId, setTaskId] = useState<string | undefined>(undefined);
  const tasks = (issues.data ?? []).filter((i) => i.status !== "done" && i.status !== "canceled");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = uploads.at !== null || send.isPending;
  const refusal = files.length > 0 ? filesRefusal(medium, files, w.team) : null;
  const ready =
    files.length > 0 &&
    !refusal &&
    (where === "task" ? Boolean(taskId) : Boolean(shownGroup) && title.trim().length > 0) &&
    !busy;

  const submit = async () => {
    if (!ready) return;
    setError(null);
    try {
      const place =
        where === "task" && taskId
          ? await api.issues.conversation(org.id, taskId).then((c) => ({ channelId: c.channelId, threadId: c.rootId }))
          : { channelId: shownGroup as string, threadId: null };
      const ids = await uploads.upload(files, place);
      const sent = await send.mutateAsync({
        medium,
        files: ids,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(where === "task" ? { taskId } : { channelId: shownGroup }),
      });
      toast.show(w.team.sent, "success");
      onClose();
      void navigate({ to: "/org/$orgId/review/$reviewId", params: { orgId: org.id, reviewId: sent.review.id } });
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError(errorText(t, e));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={w.team.send}
      closeLabel={t("common.close")}
      width={480}
      unsaved={files.length > 0 || title.trim().length > 0}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Locked when={busy}>
          <DialogBody className="sw-form">
            <Field label={w.team.kindLabel} group>
              <Segmented
                label={w.team.kindLabel}
                value={medium}
                onValueChange={(m) => {
                  setMedium(m);
                  setFiles([]);
                }}
                options={[
                  { value: "video", label: w.team.kinds.video },
                  { value: "design", label: w.team.kinds.design },
                ]}
              />
            </Field>
            <Field label={medium === "video" ? w.team.pickVideo : w.team.pickSlides} group error={refusal ?? undefined}>
              <PickFiles medium={medium} files={files} onFiles={setFiles} busy={busy} />
            </Field>
            <Field label={w.team.whereLabel} group>
              <Segmented
                label={w.team.whereLabel}
                value={where}
                onValueChange={setWhere}
                options={[
                  { value: "group", label: w.team.where.group },
                  { value: "task", label: w.team.where.task },
                ]}
              />
            </Field>
            {where === "group" ? (
              <Field label={w.team.group}>
                <Select
                  value={shownGroup}
                  onValueChange={setGroupId}
                  placeholder={w.team.pickGroup}
                  options={groups.map((c) => ({ value: c.id, label: `#${c.displayName || c.name}` }))}
                />
              </Field>
            ) : (
              <Field label={w.team.task}>
                <SearchSelect
                  value={taskId}
                  onValueChange={setTaskId}
                  placeholder={w.team.pickTask}
                  labels={{
                    search: w.team.pickTask,
                    searchPlaceholder: w.team.pickTask,
                    noResults: w.empty,
                    list: w.team.task,
                  }}
                  options={tasks.map((i) => ({ value: i.id, label: `#${i.number} ${i.title}` }))}
                />
              </Field>
            )}
            <Field label={w.team.name} example={where === "task" ? undefined : w.team.namePlaceholder}>
              <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={w.team.noteLabel} error={error ?? undefined}>
              <Textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {uploads.at && (
              <Progress
                share={uploads.at.share}
                label={w.team.uploading(uploads.at.i, uploads.at.n, Math.round(uploads.at.share * 100))}
                onCancel={uploads.cancel}
              />
            )}
            {send.isPending && <p className="small muted">{w.team.registering}</p>}
          </DialogBody>
        </Locked>
        <DialogFooter>
          <Button type="button" onClick={onClose} disabled={busy}>
            {w.team.cancel}
          </Button>
          <Button type="submit" variant="primary" icon="upload" disabled={!ready} loading={busy}>
            {w.team.submit}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * On the page of work a person sent, for that person while it isn't approved: "Mandar a V3", the next version, into
 * the review's own conversation. A task's video goes the task's way on the server (doug-0012).
 */
export function SendNextVersion({ review }: { review: VideoReviewSummary }) {
  const { org } = useOrg();
  const w = useReviewWords();
  const { t } = useTranslation();
  const toast = useToast();
  const send = useSendWork(org.id);
  const uploads = useUploads();
  const medium = review.medium as Medium;
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = uploads.at !== null || send.isPending;
  const refusal = files.length > 0 ? filesRefusal(medium, files, w.team) : null;

  const submit = async () => {
    if (files.length === 0 || refusal || busy) return;
    setError(null);
    try {
      const ids = await uploads.upload(files, { reviewId: review.id });
      await send.mutateAsync({
        medium,
        files: ids,
        reviewId: review.id,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setFiles([]);
      setNote("");
      toast.show(w.team.sent, "success");
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError(errorText(t, e));
    }
  };

  return (
    <section className="sw-next" aria-label={w.team.sendNext(review.version + 1)}>
      <h2 className="vr-notes__title">{w.team.sendNext(review.version + 1)}</h2>
      <p className="small muted">{w.team.sendNextHint}</p>
      <Field label={medium === "video" ? w.team.pickVideo : w.team.pickSlides} group error={refusal ?? undefined}>
        <PickFiles medium={medium} files={files} onFiles={setFiles} busy={busy} />
      </Field>
      {files.length > 0 && !refusal && (
        <>
          <Field label={w.team.nextNoteLabel} error={error ?? undefined}>
            <Textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {uploads.at && (
            <Progress
              share={uploads.at.share}
              label={w.team.uploading(uploads.at.i, uploads.at.n, Math.round(uploads.at.share * 100))}
              onCancel={uploads.cancel}
            />
          )}
          <Button variant="primary" icon="upload" block loading={busy} disabled={busy} onClick={() => void submit()}>
            {w.team.sendNext(review.version + 1)}
          </Button>
        </>
      )}
    </section>
  );
}
