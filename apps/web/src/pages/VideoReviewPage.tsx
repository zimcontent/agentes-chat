import {
  useAddReviewNote,
  useAddVoiceReviewNote,
  useDecideVideoReview,
  useDeleteReviewNote,
  useVideoReview,
  useVideoReviews,
  type VideoReview,
  type VideoReviewNote,
  type VideoReviewSummary,
} from "@agenteschat/client";
import { relativeTime } from "@agenteschat/client/lib/format";
import {
  Button,
  Chip,
  type ChipTone,
  EmptyState,
  Icon,
  PageHeader,
  Segmented,
  Spinner,
  Textarea,
} from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ErrorState } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { type ReviewWords, timecode, useReviewWords } from "@/components/video-review/words";
import { useToast } from "@/lib/toast";
import "./video-review.css";

/*
 * Video review (docs/adr/doug-0007-video-review.md): the videos agents sent for review, and one video's player with
 * notes pinned to its seconds, typed or said, then "Aprovar" or "Pedir ajustes". Made for a phone first: the player on
 * top, the note box under it, the notes and the decision below.
 */

const TONE: Record<VideoReviewSummary["status"], ChipTone> = {
  in_review: "waiting",
  changes: "neutral",
  approved: "done",
};
const ICON = { in_review: "eye", changes: "edit", approved: "check" } as const;

function StatusChip({ status, w }: { status: VideoReviewSummary["status"]; w: ReviewWords }) {
  return (
    <Chip tone={TONE[status]} icon={ICON[status]}>
      {w.status[status]}
    </Chip>
  );
}

export function VideoReviewsPage() {
  const { org } = useOrg();
  const w = useReviewWords();
  const { t, i18n } = useTranslation();
  const reviews = useVideoReviews(org.id);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const list = useMemo(
    () => (reviews.data ?? []).filter((r) => filter === "all" || r.status === "in_review"),
    [reviews.data, filter],
  );
  const open = (reviews.data ?? []).filter((r) => r.status === "in_review").length;

  return (
    <div className="page page--full vr-page">
      <PageHeader title={w.title} meta={w.meta}>
        <Segmented
          label={w.title}
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "open", label: w.filters.open, count: open },
            { value: "all", label: w.filters.all },
          ]}
        />
      </PageHeader>
      {reviews.isError && <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />}
      {reviews.isPending && <Spinner />}
      {reviews.isSuccess && list.length === 0 && (
        <EmptyState size="page" agent mood="deal" title={w.empty}>
          {w.emptyText}
        </EmptyState>
      )}
      {list.length > 0 && (
        <ul className="vr-list">
          {list.map((r) => (
            <li key={r.id}>
              <Link to="/org/$orgId/review/$reviewId" params={{ orgId: org.id, reviewId: r.id }} className="vr-row">
                {r.agent ? <AgentAvatar agentId={r.agent.id} size="sm" name={r.agent.name} /> : <Icon name="video" />}
                <span className="vr-row__words">
                  <span className="vr-row__title">{r.title}</span>
                  <span className="vr-row__meta">
                    {[
                      r.client,
                      w.version(r.version),
                      r.agent ? w.by(r.agent.name) : "",
                      r.openNotes > 0 ? w.notesOpen(r.openNotes) : "",
                      relativeTime(t, i18n.language, r.updatedAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <StatusChip status={r.status} w={w} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The microphone for one note: tap to start, tap again to stop and send it to be transcribed. */
function useNoteRecorder(onTake: (blob: Blob, fileName: string) => void, onBlocked: () => void) {
  const [state, setState] = useState<"idle" | "rec">("idle");
  const rec = useRef<{ recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  useEffect(
    () => () => {
      for (const track of rec.current?.stream.getTracks() ?? []) track.stop();
    },
    [],
  );
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // An iPhone plays and sends mp4; the others record webm.
      const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
      rec.current = { recorder, chunks, stream };
      setState("rec");
    } catch {
      onBlocked();
    }
  };
  const stop = () => {
    const current = rec.current;
    if (!current) return;
    rec.current = null;
    current.recorder.onstop = () => {
      for (const track of current.stream.getTracks()) track.stop();
      const type = (current.recorder.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
      const blob = new Blob(current.chunks, { type });
      setState("idle");
      if (blob.size > 0) onTake(blob, type.includes("mp4") ? "nota.m4a" : "nota.webm");
    };
    current.recorder.stop();
  };
  return { recording: state === "rec", start, stop };
}

function NoteRow({
  note,
  w,
  mine,
  onSeek,
  onRemove,
}: {
  note: VideoReviewNote;
  w: ReviewWords;
  mine: boolean;
  onSeek: (ms: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="vr-note" data-sent={note.sent || undefined}>
      {note.atMs === null ? (
        <span className="vr-note__time vr-note__time--whole">{w.whole}</span>
      ) : (
        <button type="button" className="vr-note__time" onClick={() => onSeek(note.atMs ?? 0)}>
          {timecode(note.atMs)}
        </button>
      )}
      <span className="vr-note__words">
        <span className="vr-note__body">{note.body}</span>
        <span className="vr-note__meta">
          {[note.author?.name, note.voice ? w.voice : "", note.sent ? w.sent : ""].filter(Boolean).join(" · ")}
        </span>
      </span>
      {mine && !note.sent && (
        <Button variant="ghost" size="sm" icon="trash" iconOnly aria-label={w.remove} onClick={onRemove} />
      )}
    </li>
  );
}

function ReviewBody({ review, w }: { review: VideoReview; w: ReviewWords }) {
  const { org, me } = useOrg();
  const api = useApi();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [version, setVersion] = useState(review.version);
  const [atMs, setAtMs] = useState<number | null>(0);
  const [whole, setWhole] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [duration, setDuration] = useState(0);
  const addNote = useAddReviewNote(org.id, review.id);
  const addVoice = useAddVoiceReviewNote(org.id, review.id);
  const removeNote = useDeleteReviewNote(org.id, review.id);
  const decide = useDecideVideoReview(org.id, review.id);

  // A new version arrived while the page was open: show it.
  const latest = review.version;
  useEffect(() => setVersion(latest), [latest]);

  const shown = review.versions.find((v) => v.version === version) ?? review.versions.at(-1);
  const notes = review.notes.filter((n) => n.version === version);
  const isLatest = version === review.version;
  const failed = () => toast.show(w.failed, "error");
  const at = () => (whole ? null : Math.round((video.current?.currentTime ?? 0) * 1000));

  const recorder = useNoteRecorder(
    (blob, fileName) =>
      addVoice.mutate(
        { file: blob, fileName, version, atMs: at(), language: i18n.language?.slice(0, 2) },
        { onError: failed },
      ),
    () => toast.show(w.micBlocked, "error"),
  );

  const seek = (ms: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    v.pause();
    setAtMs(ms);
  };
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    addNote.mutate({ version, atMs: at(), body }, { onSuccess: () => setText(""), onError: failed });
  };
  const decideAs = (decision: "approve" | "changes") =>
    decide.mutate(
      { decision, message: message.trim() || undefined },
      { onSuccess: () => setMessage(""), onError: failed },
    );

  const decidedLine =
    review.decidedBy && review.status !== "in_review"
      ? `${review.status === "approved" ? w.approvedBy(review.decidedBy.name) : w.changesBy(review.decidedBy.name)}${
          review.decidedAt ? ` · ${relativeTime(t, i18n.language, review.decidedAt)}` : ""
        }`
      : null;

  return (
    <div className="vr-detail">
      <div className="vr-stage">
        {shown && (
          // biome-ignore lint/a11y/useMediaCaption: an edit in review has no captions yet; the notes say what is in it.
          <video
            key={shown.artifactId}
            ref={video}
            className="vr-video"
            src={api.artifacts.fileUrl(org.id, shown.artifactId)}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration * 1000)}
            onTimeUpdate={(e) => setAtMs(Math.round(e.currentTarget.currentTime * 1000))}
          />
        )}
        {duration > 0 && notes.some((n) => n.atMs !== null) && (
          <div className="vr-marks" aria-hidden="true">
            {notes
              .filter((n) => n.atMs !== null)
              .map((n) => (
                <button
                  key={n.id}
                  type="button"
                  tabIndex={-1}
                  className="vr-mark"
                  data-sent={n.sent || undefined}
                  style={{ insetInlineStart: `${Math.min(100, ((n.atMs ?? 0) / duration) * 100)}%` }}
                  onClick={() => seek(n.atMs ?? 0)}
                />
              ))}
          </div>
        )}
      </div>

      <div className="vr-side">
        <div className="vr-head">
          <div className="vr-head__line">
            <StatusChip status={review.status} w={w} />
            {review.versions.length > 1 ? (
              <Segmented
                label={w.versionsLabel}
                size="sm"
                value={String(version)}
                onValueChange={(v) => setVersion(Number(v))}
                options={review.versions.map((v) => ({ value: String(v.version), label: w.version(v.version) }))}
              />
            ) : (
              <span className="vr-muted">{w.version(review.version)}</span>
            )}
          </div>
          {shown?.note && (
            <p className="vr-muted">
              <b>{w.versionNote}:</b> {shown.note}
            </p>
          )}
          {decidedLine && <p className="vr-muted">{decidedLine}</p>}
          {review.status === "changes" && <p className="vr-muted">{w.waitingNext(review.version + 1)}</p>}
        </div>

        {isLatest && review.status === "in_review" && (
          <div className="vr-compose">
            <div className="vr-compose__where">
              <Segmented
                label={w.whereLabel}
                size="sm"
                value={whole ? "whole" : "time"}
                onValueChange={(v) => setWhole(v === "whole")}
                options={[
                  { value: "time", label: w.atTime(timecode(atMs ?? 0)) },
                  { value: "whole", label: w.whole },
                ]}
              />
            </div>
            <Textarea
              value={text}
              rows={2}
              placeholder={w.placeholder}
              onFocus={() => video.current?.pause()}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            <div className="vr-compose__acts">
              <Button
                variant={recorder.recording ? "danger" : "default"}
                size="sm"
                icon={recorder.recording ? "stop" : "mic"}
                loading={addVoice.isPending}
                onClick={() => {
                  if (recorder.recording) recorder.stop();
                  else {
                    video.current?.pause();
                    void recorder.start();
                  }
                }}
              >
                {addVoice.isPending ? w.transcribing : recorder.recording ? w.stop : w.record}
              </Button>
              <Button size="sm" icon="send" disabled={!text.trim()} loading={addNote.isPending} onClick={submit}>
                {w.add}
              </Button>
            </div>
          </div>
        )}

        <section className="vr-notes" aria-label={w.notesTitle}>
          <h2 className="vr-notes__title">
            {w.notesTitle} {notes.length > 0 && <span className="vr-muted">{notes.length}</span>}
          </h2>
          {notes.length === 0 ? (
            <p className="vr-muted">{w.noNotes}</p>
          ) : (
            <ul className="vr-notes__list">
              {notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  w={w}
                  mine={note.author?.id === me.user.id}
                  onSeek={seek}
                  onRemove={() => removeNote.mutate(note.id, { onError: failed })}
                />
              ))}
            </ul>
          )}
        </section>

        {isLatest && review.status === "in_review" && (
          <div className="vr-decide">
            {!review.agent && <p className="vr-muted">{w.agentGone}</p>}
            <Textarea value={message} rows={1} placeholder={w.message} onChange={(e) => setMessage(e.target.value)} />
            <p className="vr-muted">{w.changesHint}</p>
            <div className="vr-decide__acts">
              <Button
                variant="default"
                icon="edit"
                disabled={!review.agent || (notes.every((n) => n.sent) && !message.trim())}
                loading={decide.isPending && decide.variables?.decision === "changes"}
                onClick={() => decideAs("changes")}
              >
                {w.changes}
              </Button>
              <Button
                variant="primary"
                icon="check"
                disabled={!review.agent}
                loading={decide.isPending && decide.variables?.decision === "approve"}
                onClick={() => decideAs("approve")}
              >
                {w.approve}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function VideoReviewDetailPage({ reviewId }: { reviewId: string }) {
  const { org } = useOrg();
  const w = useReviewWords();
  const review = useVideoReview(org.id, reviewId);
  return (
    <div className="page page--full vr-page">
      <Link to="/org/$orgId/review" params={{ orgId: org.id }} className="ac-back">
        <Icon name="chevronLeft" />
        {w.back}
      </Link>
      {review.isError && <ErrorState error={review.error} onRetry={() => void review.refetch()} />}
      {review.isPending && <Spinner />}
      {review.data && (
        <>
          <PageHeader
            title={review.data.title}
            meta={[review.data.client, review.data.agent ? w.by(review.data.agent.name) : ""]
              .filter(Boolean)
              .join(" · ")}
          />
          <ReviewBody review={review.data} w={w} />
        </>
      )}
    </div>
  );
}
