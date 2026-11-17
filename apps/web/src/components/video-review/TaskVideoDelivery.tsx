import type { Issue, VideoReview } from "@agenteschat/client";
import {
  useRetryFinal,
  useSendTaskVideo,
  useSendToClient,
  useSetReviewPost,
  useTaskVideo,
  useVideoReview,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { can } from "@agenteschat/client/lib/permissions";
import { Button, Chip, cx, DetailsSection, Icon, Input, Spinner, Textarea } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useOrg } from "@/components/org-context";
import { useReviewWords } from "./words";
import "./task-video.css";

/*
 * A post's video delivered from its task (docs/adr/doug-0012-editor-delivery.md): the editor sends the file here, the
 * team reviews it in Review, then the cover and the caption are approved here and one button sends the post to the
 * client. Each step says what is next, in order, so nobody has to know the flow to follow it. A task may ask for
 * several videos (§13): each file dropped on the task is a video of its own, listed here with its own steps.
 */

const VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** The steps' marks: a number while it waits, a check once done. */
function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: "done" | "now" | "later";
  children: ReactNode;
}) {
  return (
    <li className="tvd-step" data-state={state}>
      <span className="tvd-step__mark" aria-hidden="true">
        {state === "done" ? <Icon name="check" size={14} /> : n}
      </span>
      <div className="tvd-step__body">
        <span className="tvd-step__title">{title}</span>
        {children}
      </div>
    </li>
  );
}

/** Uploads a file to the task's conversation with its progress; the caller turns it into what it is for. */
function useTaskUpload(issueId: string) {
  const api = useApi();
  const { org } = useOrg();
  const [progress, setProgress] = useState<number | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const upload = async (file: File) => {
    const place = await api.issues.conversation(org.id, issueId);
    stopper.current = new AbortController();
    setProgress(0);
    try {
      return await api.artifacts.upload(org.id, file, {
        channelId: place.channelId,
        threadId: place.rootId,
        signal: stopper.current.signal,
        onProgress: setProgress,
      });
    } finally {
      setProgress(null);
      stopper.current = null;
    }
  };
  return { upload, progress, cancel: () => stopper.current?.abort() };
}

/** Where the editor drops the file: one big target, the click opens the picker. */
export function DropFile({
  label,
  hint,
  accept,
  onFiles,
  busy,
  multiple,
}: {
  label: string;
  hint?: string;
  accept: string;
  onFiles: (files: File[]) => void;
  busy?: boolean;
  multiple?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      className={cx("tvd-drop", over && "tvd-drop--over")}
      disabled={busy}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <Icon name="upload" size={20} />
      <span className="tvd-drop__label">{label}</span>
      {hint && <span className="tvd-drop__hint small muted">{hint}</span>}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </button>
  );
}

export function Progress({ share, label, onCancel }: { share: number; label: string; onCancel: () => void }) {
  const w = useReviewWords().editor;
  return (
    <div className="tvd-progress">
      <div className="tvd-progress__line ac-actline">
        <span className="small tabular">{label}</span>
        <Button variant="link" onClick={onCancel}>
          {w.cancel}
        </Button>
      </div>
      <div
        className="tvd-progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

/** The task's video delivery: shown on a post's task (one of the Portal), and on any task a video was sent from. */
export function TaskVideoDelivery({ issue }: { issue: Issue }) {
  const { org } = useOrg();
  const task = useTaskVideo(org.id, issue.id);
  const ids = task.data?.reviewIds ?? [];
  const w = useReviewWords().editor;
  const isPost = issue.source.type === "portal";
  if (task.isPending || (!isPost && ids.length === 0)) return null;
  return (
    <DetailsSection title={ids.length > 1 ? w.titleMany(ids.length) : w.title}>
      {ids.length === 0 && <Steps issue={issue} review={null} isPost={isPost} />}
      {ids.length === 1 && <OneVideo issue={issue} reviewId={ids[0] as string} isPost={isPost} />}
      {ids.length > 1 && (
        <ul className="tvd-videos">
          {ids.map((id, i) => (
            <li key={id}>
              <OneVideo issue={issue} reviewId={id} isPost={isPost} part={i + 1} many={ids.length} />
            </li>
          ))}
        </ul>
      )}
      {ids.length > 0 && <NewVideos issue={issue} more />}
    </DetailsSection>
  );
}

/** Where one video stands, in a few words, for its row among the task's videos (its steps say the rest). */
function standing(review: VideoReview, words: ReturnType<typeof useReviewWords>) {
  const w = words.editor;
  const final = review.final?.state;
  if (final === "kept" || final === "backed_up")
    return { tone: "done" as const, icon: "check" as const, text: w.finalShort };
  const delivery = review.delivery ?? null;
  if (delivery && delivery.state !== "failed") {
    if (review.task?.stage === "adjusting")
      return { tone: "waiting" as const, icon: "edit" as const, text: w.clientAskedShort };
    return { tone: "done" as const, icon: "send" as const, text: w.withClient };
  }
  const v = `V${review.version}`;
  if (review.status === "approved")
    return { tone: "done" as const, icon: "check" as const, text: `${words.status.approved} · ${v}` };
  if (review.status === "changes")
    return { tone: "waiting" as const, icon: "edit" as const, text: `${words.status.changes} · ${v}` };
  return { tone: "waiting" as const, icon: "eye" as const, text: `${words.status.in_review} · ${v}` };
}

/**
 * One video of the task. Alone, its steps show as they are; among several, it is a row that opens to its steps,
 * open at first while it waits on someone here (changes to make, or approved and not sent yet).
 */
function OneVideo({
  issue,
  reviewId,
  isPost,
  part,
  many,
}: {
  issue: Issue;
  reviewId: string;
  isPost: boolean;
  part?: number;
  many?: number;
}) {
  const { org } = useOrg();
  const words = useReviewWords();
  const w = words.editor;
  const review = useVideoReview(org.id, reviewId);
  // Open or closed as the person left it; until they touch it, open while it waits on someone here.
  const [opened, setOpened] = useState<boolean | null>(null);
  if (review.isPending) return null;
  const data = review.data ?? null;
  if (!part || !data) return <Steps issue={issue} review={data} isPost={isPost} />;
  const now = standing(data, words);
  const waiting = data.status === "changes" || (data.status === "approved" && !data.delivery && !data.final && isPost);
  return (
    <details
      className="tvd-video"
      open={opened ?? ((many ?? 0) <= 2 || waiting)}
      onToggle={(e) => setOpened(e.currentTarget.open)}
    >
      <summary className="tvd-video__head">
        <Icon name="chevronRight" size={16} className="tvd-video__arrow" />
        <span className="tvd-video__name">{w.part(data.taskPart ?? part)}</span>
        <Chip tone={now.tone} icon={now.icon}>
          {now.text}
        </Chip>
      </summary>
      <div className="tvd-video__body">
        <Steps issue={issue} review={data} isPost={isPost} />
      </div>
    </details>
  );
}

/**
 * New videos for the task: one file or many at once, sent one after another, each its own video with its own review.
 * `more`: the task has videos already, so it is a smaller target under them.
 */
function NewVideos({ issue, more }: { issue: Issue; more?: boolean }) {
  const { org } = useOrg();
  const { t, i18n } = useTranslation();
  const w = useReviewWords().editor;
  const send = useSendTaskVideo(org.id, issue.id);
  const files = useTaskUpload(issue.id);
  const [at, setAt] = useState<{ i: number; n: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const stopped = useRef(false);

  const pick = async (list: File[]) => {
    const refused: string[] = [];
    const ok = list.filter((file) => {
      if (!VIDEO.test(file.name)) refused.push(w.refused(file.name, w.notVideo));
      else if (file.size > MAX_BYTES) refused.push(w.refused(file.name, w.tooBig));
      else return true;
      return false;
    });
    setErrors(refused);
    stopped.current = false;
    for (const [i, file] of ok.entries()) {
      if (stopped.current) break;
      setAt({ i: i + 1, n: ok.length });
      try {
        const uploaded = await files.upload(file);
        await send.mutateAsync({ artifactId: uploaded.id });
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") {
          stopped.current = true;
          break;
        }
        refused.push(w.refused(file.name, errorText(t, e, i18n.language)));
        setErrors([...refused]);
      }
    }
    setAt(null);
  };

  const busy = at !== null;
  return (
    <div className={cx("tvd-new", more && "tvd-new--more")}>
      {busy ? (
        files.progress !== null ? (
          <Progress
            share={files.progress}
            label={
              at.n > 1
                ? w.uploadingOf(at.i, at.n, Math.round(files.progress * 100))
                : w.uploading(Math.round(files.progress * 100))
            }
            onCancel={() => {
              stopped.current = true;
              files.cancel();
            }}
          />
        ) : (
          <span className="tvd-line small muted">
            <Spinner size={14} /> {w.registering}
          </span>
        )
      ) : more ? (
        <div className="tvd-line">
          <DropFile label={w.addMore} accept="video/*,.mov,.mkv" onFiles={(l) => void pick(l)} multiple />
        </div>
      ) : (
        <DropFile
          label={w.dropMany}
          hint={w.dropManyHint}
          accept="video/*,.mov,.mkv"
          onFiles={(l) => void pick(l)}
          multiple
        />
      )}
      {errors.map((error) => (
        <p key={error} className="small tvd-error">
          {error}
        </p>
      ))}
    </div>
  );
}

function Steps({ issue, review, isPost }: { issue: Issue; review: VideoReview | null; isPost: boolean }) {
  const w = useReviewWords().editor;
  const post = review?.post ?? {};
  const approved = review?.status === "approved";
  const delivery = review?.delivery ?? null;
  const out = Boolean(delivery && delivery.state !== "failed");
  const coverDone = Boolean(post.coverOk);
  const captionDone = Boolean(post.captionOk);
  const clientDone = out && delivery?.state !== "sending";
  const final = review?.final ?? null;
  return (
    <ol className="tvd">
      <Step n={1} title={w.steps.video} state={approved ? "done" : "now"}>
        <VideoStep issue={issue} review={review} />
      </Step>
      {isPost && review && (
        <>
          <Step n={2} title={w.steps.cover} state={coverDone ? "done" : "now"}>
            <CoverStep issue={issue} review={review} locked={out} />
          </Step>
          <Step n={3} title={w.steps.caption} state={captionDone ? "done" : "now"}>
            <CaptionStep review={review} locked={out} />
          </Step>
          <Step
            n={4}
            title={w.steps.client}
            state={clientDone ? "done" : approved && coverDone && captionDone ? "now" : "later"}
          >
            <ClientStep review={review} ready={approved && coverDone && captionDone} />
          </Step>
          <Step
            n={5}
            title={w.steps.final}
            state={final?.state === "kept" || final?.state === "backed_up" ? "done" : "later"}
          >
            <FinalStep review={review} />
          </Step>
        </>
      )}
      {!isPost && approved && <p className="small muted">{w.noPortal}</p>}
    </ol>
  );
}

function VideoStep({ issue, review }: { issue: Issue; review: VideoReview | null }) {
  const { org } = useOrg();
  const { t, i18n } = useTranslation();
  const w = useReviewWords().editor;
  const send = useSendTaskVideo(org.id, issue.id);
  const files = useTaskUpload(issue.id);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stage = review?.task?.stage ?? null;
  const out = Boolean(review?.delivery && review.delivery.state !== "failed");
  const adjust = out && stage === "adjusting";

  const pick = async (file: File) => {
    setError(null);
    if (!VIDEO.test(file.name)) return setError(w.notVideo);
    if (file.size > MAX_BYTES) return setError(w.tooBig);
    try {
      const uploaded = await files.upload(file);
      await send.mutateAsync({
        artifactId: uploaded.id,
        ...(review ? { reviewId: review.id } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote("");
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError(errorText(t, e, i18n.language));
    }
  };

  const busy = files.progress !== null || send.isPending;
  const sender = busy ? (
    files.progress !== null ? (
      <Progress share={files.progress} label={w.uploading(Math.round(files.progress * 100))} onCancel={files.cancel} />
    ) : (
      <span className="tvd-line small muted">
        <Spinner size={14} /> {w.registering}
      </span>
    )
  ) : null;
  const drop = (label: string) => (
    <>
      {review && (
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={w.noteLabel}
          aria-label={w.noteLabel}
          maxLength={4000}
        />
      )}
      {sender ?? (
        <DropFile
          label={label}
          hint={w.dropHint}
          accept="video/*,.mov,.mkv"
          onFiles={([file]) => file && void pick(file)}
        />
      )}
    </>
  );
  const open = review && (
    <Link to="/org/$orgId/review/$reviewId" params={{ orgId: org.id, reviewId: review.id }} className="ac-link small">
      {review.status === "changes" ? w.seeNotes : w.openReview}
    </Link>
  );

  return (
    <div className="tvd-step__content">
      {!review && <NewVideos issue={issue} />}
      {review?.status === "in_review" && (
        <div className="tvd-line">
          <Chip tone="waiting" icon="eye">
            {w.inReview(review.version)}
          </Chip>
          {open}
        </div>
      )}
      {review?.status === "changes" && (
        <>
          <div className="tvd-line">
            <Chip tone="waiting" icon="edit">
              {w.changesAsked(review.version)}
            </Chip>
            {open}
          </div>
          {drop(w.sendNext(review.version + 1))}
        </>
      )}
      {review?.status === "approved" && (
        <>
          <div className="tvd-line">
            <Chip tone="done" icon="check">
              {w.approved(review.version)}
            </Chip>
            {open}
          </div>
          {adjust && (
            <>
              <p className="small">{w.clientAsked}</p>
              {drop(w.sendAdjust)}
            </>
          )}
        </>
      )}
      {error && <p className="small tvd-error">{error}</p>}
    </div>
  );
}

function CoverStep({ issue, review, locked }: { issue: Issue; review: VideoReview; locked: boolean }) {
  const { org } = useOrg();
  const api = useApi();
  const { t, i18n } = useTranslation();
  const w = useReviewWords().editor;
  const set = useSetReviewPost(org.id, review.id);
  const files = useTaskUpload(issue.id);
  const [error, setError] = useState<string | null>(null);
  const post = review.post ?? {};
  const run = (p: Promise<unknown>) =>
    p.catch((e) => {
      if ((e as { name?: string }).name !== "AbortError") setError(errorText(t, e, i18n.language));
    });
  const pick = (file: File) => {
    setError(null);
    void run(files.upload(file).then((uploaded) => set.mutateAsync({ cover: uploaded.id })));
  };
  const chosen = Boolean(post.cover || post.noCover);
  return (
    <div className="tvd-step__content">
      {files.progress !== null && (
        <Progress
          share={files.progress}
          label={w.uploading(Math.round(files.progress * 100))}
          onCancel={files.cancel}
        />
      )}
      {files.progress === null && !chosen && (
        <div className="tvd-line">
          <DropFile
            label={w.coverChoose}
            accept="image/jpeg,image/png,image/webp"
            onFiles={([file]) => file && pick(file)}
            busy={set.isPending}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={set.isPending}
            onClick={() => void run(set.mutateAsync({ noCover: true }))}
          >
            {w.coverNone}
          </Button>
        </div>
      )}
      {chosen && (
        <div className="tvd-line">
          {post.cover ? (
            <img className="tvd-cover" src={api.artifacts.fileUrl(org.id, post.cover)} alt="" />
          ) : (
            <span className="small muted">{w.coverNoneOn}</span>
          )}
          {post.coverOk ? (
            <>
              <Chip tone="done" icon="check">
                {w.ok}
              </Chip>
              {!locked && (
                <Button variant="link" onClick={() => void run(set.mutateAsync({ coverOk: false }))}>
                  {w.undo}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="primary"
                loading={set.isPending}
                onClick={() => void run(set.mutateAsync({ coverOk: true }))}
              >
                {w.coverApprove}
              </Button>
              <Button
                variant="link"
                onClick={() => void run(set.mutateAsync(post.cover ? { cover: null } : { noCover: false }))}
              >
                {w.coverChange}
              </Button>
            </>
          )}
        </div>
      )}
      {error && <p className="small tvd-error">{error}</p>}
    </div>
  );
}

function CaptionStep({ review, locked }: { review: VideoReview; locked: boolean }) {
  const { org } = useOrg();
  const { t, i18n } = useTranslation();
  const w = useReviewWords().editor;
  const set = useSetReviewPost(org.id, review.id);
  const saved = review.post?.caption ?? "";
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // Another person's save shows up here while this one hasn't typed anything else.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setText(saved);
  }, [saved]);
  const dirty = text.trim() !== saved;
  const run = (p: Promise<unknown>) =>
    p
      .then(() => {
        typed.current = false;
      })
      .catch((e) => setError(errorText(t, e, i18n.language)));
  return (
    <div className="tvd-step__content">
      <Textarea
        value={text}
        rows={3}
        autoGrow
        maxLength={2200}
        disabled={locked}
        placeholder={w.captionPlaceholder}
        aria-label={w.steps.caption}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
      />
      {!locked && (
        <div className="tvd-line">
          {dirty ? (
            <Button size="sm" loading={set.isPending} onClick={() => void run(set.mutateAsync({ caption: text }))}>
              {w.captionSave}
            </Button>
          ) : review.post?.captionOk ? (
            <>
              <Chip tone="done" icon="check">
                {w.ok}
              </Chip>
              <Button variant="link" onClick={() => void run(set.mutateAsync({ captionOk: false }))}>
                {w.undo}
              </Button>
            </>
          ) : (
            saved && (
              <Button
                size="sm"
                variant="primary"
                loading={set.isPending}
                onClick={() => void run(set.mutateAsync({ captionOk: true }))}
              >
                {w.captionApprove}
              </Button>
            )
          )}
        </div>
      )}
      {error && <p className="small tvd-error">{error}</p>}
    </div>
  );
}

function ClientStep({ review, ready }: { review: VideoReview; ready: boolean }) {
  const { org } = useOrg();
  const { t, i18n } = useTranslation();
  const words = useReviewWords();
  const w = words.editor;
  const send = useSendToClient(org.id, review.id);
  const [error, setError] = useState<string | null>(null);
  const delivery = review.delivery ?? null;
  const direct = review.portal?.afterApprove === "direct";
  const stage = review.task?.stage ?? null;
  const link = delivery?.link ? (
    <a className="ac-link small" href={delivery.link} target="_blank" rel="noreferrer">
      {words.design.delivery.open}
    </a>
  ) : null;
  if (delivery?.state === "sending") {
    return (
      <span className="tvd-line small muted">
        <Spinner size={14} /> {words.design.delivery.sending}
      </span>
    );
  }
  if (delivery && delivery.state !== "failed") {
    const said =
      delivery.state === "scheduled"
        ? words.design.delivery.scheduled(delivery.when ?? "")
        : delivery.state === "approved"
          ? words.design.delivery.approved
          : stage === "adjusting"
            ? w.clientAsked
            : stage === "approved" || stage === "scheduled" || stage === "posted"
              ? w.clientApproved
              : w.withClient;
    return (
      <div className="tvd-line">
        <Chip tone={stage === "adjusting" ? "waiting" : "done"} icon={stage === "adjusting" ? "edit" : "check"}>
          {said}
        </Chip>
        {link}
      </div>
    );
  }
  const allowed = can(org, "assign_work");
  return (
    <div className="tvd-step__content">
      {delivery?.state === "failed" && (
        <p className="small tvd-error">{words.design.delivery.failed(delivery.error ?? "")}</p>
      )}
      <p className="small muted">
        {review.status !== "approved" ? w.waitVideo : !ready ? w.missing : direct ? w.sendDirectHint : w.sendPortalHint}
      </p>
      {allowed && (
        <div className="tvd-line">
          <Button
            variant="primary"
            icon="send"
            disabled={!ready}
            loading={send.isPending}
            onClick={() => {
              setError(null);
              send.mutateAsync().catch((e) => setError(errorText(t, e, i18n.language)));
            }}
          >
            {direct ? w.sendDirect : w.sendClient}
          </Button>
        </div>
      )}
      {error && <p className="small tvd-error">{error}</p>}
    </div>
  );
}

function FinalStep({ review }: { review: VideoReview }) {
  const { org } = useOrg();
  const w = useReviewWords().editor;
  const retry = useRetryFinal(org.id, review.id);
  const final = review.final ?? null;
  if (!final) return null;
  if (final.state === "queued") {
    return (
      <span className="tvd-line small muted">
        <Spinner size={14} /> {w.finalQueued}
      </span>
    );
  }
  if (final.state === "failed") {
    return (
      <div className="tvd-line">
        <span className="small tvd-error">{w.finalFailed}</span>
        <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>
          {w.retry}
        </Button>
      </div>
    );
  }
  const backup = final.backup ?? null;
  return (
    <div className="tvd-line">
      <Chip tone="done" icon="check">
        {backup ? w.finalBacked(backup.name) : w.finalKept}
      </Chip>
      {backup?.link && (
        <a className="ac-link small" href={backup.link} target="_blank" rel="noreferrer">
          {w.openBackup(backup.name)}
        </a>
      )}
    </div>
  );
}
