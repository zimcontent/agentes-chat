import {
  filterReviews,
  firstTab,
  mixedIn,
  type ReviewWho,
  reviewTabsByWho,
  teamPeople,
  useAddReviewNote,
  useAddVoiceReviewNote,
  useDecideVideoReview,
  useDeleteReviewNote,
  useVideoReview,
  useVideoReviews,
  VIDEO_REVIEW_NOTE_KINDS,
  type VideoReview,
  type VideoReviewNote,
  type VideoReviewNoteKind,
  type VideoReviewSummary,
} from "@dougbot/client";
import { relativeTime } from "@dougbot/client/lib/format";
import {
  Button,
  Chip,
  type ChipTone,
  EmptyState,
  Icon,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  Tabs,
  Textarea,
  Toolbar,
} from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { AgentAvatar, PersonAvatar } from "@/components/AgentAvatar";
import { DesignReviewBody } from "@/components/design-review/DesignReview";
import { ErrorState } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import {
  AttachEditor,
  carries,
  dropped,
  linksIn,
  NoteAttachments,
  useAttachments,
} from "@/components/video-review/Attachments";
import { ReviewLog, roundLine, useWhen, WhatsAppNotice } from "@/components/video-review/ReviewRounds";
import { useNoteRecorder } from "@/components/video-review/recorder";
import { SendNextVersion, SendWorkDialog } from "@/components/video-review/SendWork";
import { frameCode, type ReviewWords, timecode, useReviewWords } from "@/components/video-review/words";
import { useToast } from "@/lib/toast";
import "./video-review.css";

/*
 * Video review (docs/adr/doug-0007-video-review.md): the videos agents sent for review, and one video's player with
 * notes pinned to a point or a stretch, typed or said, then "Aprovar" or "Pedir ajustes". The player works like an
 * editor's: space plays, J/K/L change the speed, the arrows step a frame (with Shift a second), a click on the picture
 * opens a note right there. On a phone the same tap opens the note; the buttons under the picture do the rest. A photo,
 * a clip or a link dropped on the picture opens a note at that point carrying it, for the editor to put in.
 */

const TONE: Record<VideoReviewSummary["status"], ChipTone> = {
  in_review: "waiting",
  changes: "neutral",
  approved: "done",
};
const ICON = { in_review: "eye", changes: "edit", approved: "check" } as const;
const RATES = [0.5, 1, 1.5, 2] as const;
/** Until the video says otherwise (`useFrameRate`): what the agents render shorts at. */
const DEFAULT_FPS = 25;

function StatusChip({ status, w }: { status: VideoReviewSummary["status"]; w: ReviewWords }) {
  return (
    <Chip tone={TONE[status]} icon={ICON[status]}>
      {w.status[status]}
    </Chip>
  );
}

export function VideoReviewsPage() {
  const { org, me } = useOrg();
  const when = useWhen();
  const w = useReviewWords();
  const { t, i18n } = useTranslation();
  const api = useApi();
  const reviews = useVideoReviews(org.id);
  const all = reviews.data ?? [];
  // By who made it (docs/adr/doug-0015-team-work-review.md): the agents' work, the team's, and what was asked of me.
  const tabs = useMemo(() => reviewTabsByWho(all, me.user.id), [all, me.user.id]);
  const [who, setWho] = useState<ReviewWho>("agents");
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !reviews.isSuccess) return;
    picked.current = true;
    setWho(firstTab(tabs));
  }, [reviews.isSuccess, tabs]);
  const [person, setPerson] = useState("all");
  const [medium, setMedium] = useState<"all" | "video" | "design">("all");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const people = useMemo(() => teamPeople(all, me.user.id), [all, me.user.id]);
  const shownPerson = who === "team" && people.some((p) => p.id === person) ? person : null;
  // Vídeos or Peças, only where this tab holds both.
  const mixed = mixedIn(all, who, me.user.id);
  const list = useMemo(
    () => filterReviews(all, { who, person: shownPerson, medium: mixed ? medium : "all", status: filter }, me.user.id),
    [all, who, shownPerson, mixed, medium, filter, me.user.id],
  );
  const open = filterReviews(all, { who, person: shownPerson, medium: "all", status: "open" }, me.user.id).length;
  const [sending, setSending] = useState(false);
  // A task that asked for several videos (doug-0012 §13) shows them together, under the task, in their order.
  const groups = useMemo(() => tasksTogether(list), [list]);
  const row = (r: VideoReviewSummary, inTask: boolean) => (
    <Link to="/org/$orgId/review/$reviewId" params={{ orgId: org.id, reviewId: r.id }} className="vr-row">
      {r.medium === "design" && r.cover ? (
        <img className="vr-row__cover" src={api.artifacts.fileUrl(org.id, r.cover)} alt="" loading="lazy" />
      ) : r.agent ? (
        <AgentAvatar agentId={r.agent.id} size="sm" name={r.agent.name} />
      ) : r.sender ? (
        <PersonAvatar id={r.sender.id} size="sm" name={r.sender.name} />
      ) : (
        <Icon name={r.medium === "design" ? "image" : "video"} />
      )}
      <span className="vr-row__words">
        <span className="vr-row__title">{inTask && r.taskPart ? w.editor.part(r.taskPart) : r.title}</span>
        <span className="vr-row__meta">
          {[
            inTask ? "" : r.client,
            w.version(r.version),
            inTask ? "" : r.agent ? w.by(r.agent.name) : r.sender ? w.editor.sentBy(r.sender.name) : "",
            r.openNotes > 0 ? w.notesOpen(r.openNotes) : "",
            roundLine(r.round, w.editor, when),
            relativeTime(t, i18n.language, r.updatedAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {r.sender?.id === me.user.id && r.status === "changes" ? (
        <Chip tone="waiting" icon="edit">
          {w.editor.toDo}
        </Chip>
      ) : (
        <StatusChip status={r.status} w={w} />
      )}
    </Link>
  );

  return (
    <div className="page page--full vr-page">
      <PageHeader
        title={w.title}
        meta={w.meta}
        actions={
          <Button variant="primary" size="sm" icon="upload" onClick={() => setSending(true)}>
            {w.team.send}
          </Button>
        }
      />
      <div className="tabs-bar">
        <Tabs
          value={who}
          onValueChange={setWho}
          label={w.title}
          items={tabs.map((tab) => ({ value: tab.key, label: w.team.tabs[tab.key], count: tab.waiting || undefined }))}
        >
          {null}
        </Tabs>
      </div>
      <Toolbar label={w.title}>
        {who === "team" && people.length > 0 && (
          <Select
            size="sm"
            aria-label={w.team.tabs.team}
            value={shownPerson ?? "all"}
            onValueChange={setPerson}
            options={[
              { value: "all", label: w.team.everyone },
              ...people.map((p) => ({
                value: p.id,
                label: p.waiting > 0 ? `${p.name} · ${p.waiting}` : p.name,
                leading: <PersonAvatar id={p.id} size="xs" name={p.name} />,
              })),
            ]}
          />
        )}
        {mixed && (
          <Segmented
            label={w.team.kindLabel}
            size="sm"
            value={medium}
            onValueChange={setMedium}
            options={[
              { value: "all", label: w.team.medium.all },
              { value: "video", label: w.team.medium.video },
              { value: "design", label: w.team.medium.design },
            ]}
          />
        )}
        <Segmented
          label={w.title}
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "open", label: who === "mine" ? w.editor.toDo : w.filters.open, count: open },
            { value: "all", label: w.filters.all },
          ]}
        />
      </Toolbar>
      {shownPerson && (
        <WhatsAppNotice person={people.find((p) => p.id === shownPerson) ?? { id: shownPerson, name: "" }} />
      )}
      {sending && <SendWorkDialog onClose={() => setSending(false)} />}
      {reviews.isError && <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />}
      {reviews.isPending && <Spinner />}
      {reviews.isSuccess && list.length === 0 && (
        <EmptyState
          size="page"
          agent
          mood="deal"
          title={who === "mine" ? w.team.emptyMine : who === "team" ? w.team.emptyTeam : w.team.emptyAgents}
          actions={
            who === "team" ? (
              <Button variant="primary" icon="upload" onClick={() => setSending(true)}>
                {w.team.send}
              </Button>
            ) : undefined
          }
        >
          {who === "mine" ? w.team.emptyMineText : who === "team" ? w.team.emptyTeamText : w.team.emptyAgentsText}
        </EmptyState>
      )}
      {list.length > 0 && (
        <ul className="vr-list">
          {groups.map((g) =>
            g.rows.length === 1 && g.rows[0] ? (
              <li key={g.rows[0].id}>{row(g.rows[0], false)}</li>
            ) : (
              <li key={g.key} className="vr-task">
                <TaskHead rows={g.rows} all={reviews.data ?? []} />
                <ul className="vr-list vr-task__videos">
                  {g.rows.map((r) => (
                    <li key={r.id}>{row(r, true)}</li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The list in groups: the videos of one task together (two or more of it in the list), where the first of them stands,
 * in the task's order; anything else alone.
 */
function tasksTogether(list: VideoReviewSummary[]) {
  const shown = new Map<string, number>();
  // Only a task's videos are its parts (doug-0012 §13); a design piece sent for a task stands alone.
  const part = (r: VideoReviewSummary) => (r.medium === "video" ? r.taskId : null);
  for (const r of list) {
    const task = part(r);
    if (task) shown.set(task, (shown.get(task) ?? 0) + 1);
  }
  const groups: { key: string; rows: VideoReviewSummary[] }[] = [];
  const at = new Map<string, { key: string; rows: VideoReviewSummary[] }>();
  for (const r of list) {
    const task = part(r);
    if (task && (shown.get(task) ?? 0) > 1) {
      const group = at.get(task);
      if (group) group.rows.push(r);
      else {
        const made = { key: `task:${task}`, rows: [r] };
        at.set(task, made);
        groups.push(made);
      }
    } else groups.push({ key: r.id, rows: [r] });
  }
  for (const g of groups) g.rows.sort((a, b) => (a.taskPart ?? 1) - (b.taskPart ?? 1));
  return groups;
}

/** A task's line over its videos: which task, whose, how many videos it has and how many are approved. */
function TaskHead({ rows, all }: { rows: VideoReviewSummary[]; all: VideoReviewSummary[] }) {
  const { org } = useOrg();
  const w = useReviewWords();
  const first = rows[0];
  if (!first) return null;
  const videos = all.filter((r) => r.medium === "video" && r.taskId === first.taskId);
  const approved = videos.filter((r) => r.status === "approved").length;
  const title = first.taskTitle ?? first.title;
  return (
    <div className="vr-task__head">
      <span className="vr-task__title">
        {first.taskNumber ? (
          <Link
            to="/org/$orgId/issues/$number"
            params={{ orgId: org.id, number: String(first.taskNumber) }}
            className="ac-link"
          >
            {w.editor.taskGroup(first.taskNumber, title)}
          </Link>
        ) : (
          title
        )}
      </span>
      <span className="vr-row__meta">
        {[
          first.client,
          first.sender ? w.editor.sentBy(first.sender.name) : "",
          w.editor.videos(videos.length),
          w.editor.partsApproved(approved, videos.length),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

/** On a video of a task with several: the task's other videos, one click away, each with where it stands. */
function TaskParts({ review }: { review: VideoReview }) {
  const { org } = useOrg();
  const w = useReviewWords();
  const reviews = useVideoReviews(org.id);
  const parts = (reviews.data ?? [])
    .filter((r) => review.taskId && r.taskId === review.taskId)
    .sort((a, b) => (a.taskPart ?? 1) - (b.taskPart ?? 1));
  if (parts.length < 2) return null;
  return (
    <nav className="vr-parts" aria-label={w.editor.videosOfTask}>
      <span className="small muted">{w.editor.videosOfTask}</span>
      {parts.map((r) => (
        <Link
          key={r.id}
          to="/org/$orgId/review/$reviewId"
          params={{ orgId: org.id, reviewId: r.id }}
          className="vr-parts__one"
          data-status={r.status}
          aria-current={r.id === review.id ? "page" : undefined}
          title={`${w.editor.part(r.taskPart ?? 1)} · ${w.status[r.status]}`}
        >
          {r.status === "approved" ? (
            <Icon name="check" size={14} />
          ) : r.status === "changes" ? (
            <Icon name="edit" size={14} />
          ) : null}
          {r.taskPart ?? 1}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The video's frame rate, read off the frames it shows while playing (`requestVideoFrameCallback`): the smallest step
 * between two frames' media times. Until then, and where the browser can't tell, `DEFAULT_FPS`.
 */
function useFrameRate(video: HTMLVideoElement | null) {
  const [fps, setFps] = useState(DEFAULT_FPS);
  useEffect(() => {
    if (!video || !("requestVideoFrameCallback" in video)) return;
    let last = -1;
    let best = Number.POSITIVE_INFINITY;
    let seen = 0;
    let handle = 0;
    const tick = (_now: number, meta: { mediaTime: number }) => {
      if (last >= 0) {
        const step = meta.mediaTime - last;
        if (step > 0.005 && step < best) best = step;
        seen += 1;
        if (seen >= 12 && Number.isFinite(best)) {
          setFps(Math.min(120, Math.max(12, Math.round(1 / best))));
          return;
        }
      }
      last = meta.mediaTime;
      handle = video.requestVideoFrameCallback(tick);
    };
    handle = video.requestVideoFrameCallback(tick);
    return () => video.cancelVideoFrameCallback(handle);
  }, [video]);
  return fps;
}

/** A note being written: where it is, what it's about, and where its box shows over the picture. */
interface Draft {
  atMs: number;
  endMs: number | null;
  kind: VideoReviewNoteKind | null;
  /** Where the click was, as fractions of the player's box; the note box opens beside it. */
  px: number;
  py: number;
  /** The spot on the video itself (fractions of the frame), marked with a ring; null: a click on the bars or a key. */
  x: number | null;
  y: number | null;
  /** Playing on to the stretch's end: the box steps aside until it is marked. */
  marking: boolean;
}

/** Where the frame sits inside the player's box (`object-fit: contain` leaves bars), in the box's pixels. */
interface FrameBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
function frameBoxOf(video: HTMLVideoElement | null): FrameBox | null {
  const box = video?.parentElement?.getBoundingClientRect();
  const own = video?.getBoundingClientRect();
  if (!video || !box || !own || !video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(own.width / video.videoWidth, own.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  return {
    left: own.left - box.left + (own.width - width) / 2,
    top: own.top - box.top + (own.height - height) / 2,
    width,
    height,
  };
}

const VOLUME_KEY = "vr-volume";
function savedVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? v : 1;
  } catch {
    return 1;
  }
}

function where(atMs: number | null, endMs: number | null, w: ReviewWords) {
  if (atMs === null) return w.whole;
  return endMs !== null ? `${timecode(atMs)}–${timecode(endMs)}` : timecode(atMs);
}

function NoteRow({
  note,
  w,
  sentTo,
  mine,
  active,
  onSeek,
  onRemove,
}: {
  note: VideoReviewNote;
  w: ReviewWords;
  /** "Enviada ao Ronny" for a person's review; absent: to the agent. */
  sentTo?: string;
  mine: boolean;
  active: boolean;
  onSeek: (ms: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="vr-note" data-sent={note.sent || undefined} data-active={active || undefined}>
      {note.atMs === null ? (
        <span className="vr-note__time vr-note__time--whole">{w.whole}</span>
      ) : (
        <button type="button" className="vr-note__time" onClick={() => onSeek(note.atMs ?? 0)}>
          {where(note.atMs, note.endMs, w)}
        </button>
      )}
      <span className="vr-note__words">
        {note.kind && <span className="vr-note__kind">{w.kinds[note.kind]}</span>}
        {note.body && <span className="vr-note__body">{note.body}</span>}
        <NoteAttachments items={note.attachments} w={w} />
        <span className="vr-note__meta">
          {[
            note.author?.name,
            note.voice ? w.voice : "",
            // The client's notes come from the portal; the others went to whoever makes the next version.
            note.fromClient ? w.editor.fromPortal : note.sent ? (sentTo ?? w.sent) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {mine && !note.sent && (
        <Button variant="ghost" size="sm" icon="trash" iconOnly aria-label={w.remove} onClick={onRemove} />
      )}
    </li>
  );
}

/** Under the picture: a bar to scrub, with each note as a tick (a point) or a band (a stretch). */
function Scrubber({
  nowMs,
  duration,
  notes,
  draft,
  onSeek,
  w,
}: {
  nowMs: number;
  duration: number;
  notes: VideoReviewNote[];
  draft: Draft | null;
  onSeek: (ms: number) => void;
  w: ReviewWords;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const pct = (ms: number) => `${duration > 0 ? Math.min(100, Math.max(0, (ms / duration) * 100)) : 0}%`;
  const msAt = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * duration);
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(msAt(e.clientX));
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(msAt(e.clientX));
  };
  return (
    <div
      ref={bar}
      className="vr-scrub"
      role="slider"
      tabIndex={-1}
      aria-label={w.scrub}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(nowMs)}
      onPointerDown={down}
      onPointerMove={move}
    >
      <div className="vr-scrub__track">
        <div className="vr-scrub__done" style={{ width: pct(nowMs) }} />
        {notes
          .filter((n) => n.atMs !== null)
          .map((n) =>
            n.endMs !== null ? (
              <span
                key={n.id}
                className="vr-scrub__band"
                data-sent={n.sent || undefined}
                style={{ insetInlineStart: pct(n.atMs ?? 0), width: `calc(${pct(n.endMs)} - ${pct(n.atMs ?? 0)})` }}
              />
            ) : (
              <span
                key={n.id}
                className="vr-scrub__tick"
                data-sent={n.sent || undefined}
                style={{ insetInlineStart: pct(n.atMs ?? 0) }}
              />
            ),
          )}
        {draft && (
          <span
            className="vr-scrub__band vr-scrub__band--draft"
            style={{
              insetInlineStart: pct(draft.atMs),
              width: `calc(${pct(draft.endMs ?? (draft.marking ? Math.max(draft.atMs, nowMs) : draft.atMs))} - ${pct(draft.atMs)})`,
            }}
          />
        )}
      </div>
      <div className="vr-scrub__head" style={{ insetInlineStart: pct(nowMs) }} />
    </div>
  );
}

function ReviewBody({ review, w }: { review: VideoReview; w: ReviewWords }) {
  const { org, me } = useOrg();
  const api = useApi();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const bindVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    setVideoEl(el);
  }, []);
  const [version, setVersion] = useState(review.version);
  const [nowMs, setNowMs] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [frame, setFrame] = useState<FrameBox | null>(null);
  const [volume, setVolumeState] = useState(savedVolume);
  const [muted, setMuted] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [wholeText, setWholeText] = useState("");
  const [message, setMessage] = useState("");
  const [dropping, setDropping] = useState(false);
  const draftFiles = useAttachments(review);
  const wholeFiles = useAttachments(review);
  const addNote = useAddReviewNote(org.id, review.id);
  const addVoice = useAddVoiceReviewNote(org.id, review.id);
  const removeNote = useDeleteReviewNote(org.id, review.id);
  // Who gets the decision: the agent that made it, or the person who sent it from a task (doug-0012).
  const maker = review.agent ?? review.sender ?? null;
  const decide = useDecideVideoReview(org.id, review.id);

  // A new version arrived while the page was open: show it.
  const latest = review.version;
  useEffect(() => setVersion(latest), [latest]);

  const shown = review.versions.find((v) => v.version === version) ?? review.versions.at(-1);
  // The light copy plays unless the person asks for the original (HD); switching keeps the place.
  const [hd, setHd] = useState(false);
  const resumeAt = useRef<number | null>(null);
  const videoSrc = (v: { version: number; artifactId: string }) =>
    api.videoReviews?.videoUrl(org.id, review.id, v.version, { original: hd }) ??
    api.artifacts.fileUrl(org.id, v.artifactId);
  const toggleHd = () => {
    resumeAt.current = video.current?.currentTime ?? null;
    setHd((on) => !on);
  };
  const fps = useFrameRate(videoEl);
  // An editor's large master doesn't play until its light copy is made (the server answers 409 till then).
  const [unplayable, setUnplayable] = useState<string | null>(null);
  const notes = review.notes.filter((n) => n.version === version);
  const isLatest = version === review.version;
  const open = isLatest && review.status === "in_review";
  const failed = () => toast.show(w.failed, "error");

  // Playing, a fast clock: `timeupdate` comes only four times a second, too coarse for a frame counter.
  useEffect(() => {
    if (!playing || !videoEl) return;
    let frame = 0;
    const tick = () => {
      setNowMs(Math.round(videoEl.currentTime * 1000));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, videoEl]);

  // Where the frame sits in the player, kept as the page resizes: the rings are drawn on it.
  useEffect(() => {
    const box = videoEl?.parentElement;
    if (!videoEl || !box) return;
    const measure = () => setFrame(frameBoxOf(videoEl));
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    videoEl.addEventListener("loadedmetadata", measure);
    measure();
    return () => {
      watch.disconnect();
      videoEl.removeEventListener("loadedmetadata", measure);
    };
  }, [videoEl]);

  useEffect(() => {
    if (!videoEl) return;
    videoEl.volume = volume;
    videoEl.muted = muted;
  }, [videoEl, volume, muted]);
  const setVolume = useCallback((next: number) => {
    const v = Math.min(1, Math.max(0, Math.round(next * 100) / 100));
    setVolumeState(v);
    setMuted(v === 0);
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      // A browser that keeps nothing: the volume lasts this page.
    }
  }, []);

  const seek = useCallback(
    (ms: number) => {
      const v = video.current;
      if (!v) return;
      const to = Math.min(Math.max(0, ms), duration || ms);
      v.currentTime = to / 1000;
      setNowMs(Math.round(to));
    },
    [duration],
  );
  const step = useCallback(
    (frames: number) => {
      const v = video.current;
      if (!v) return;
      v.pause();
      // Aim at a frame's middle, so the browser shows that frame and not the one before it.
      const frame = Math.floor(v.currentTime * fps + 1e-3) + frames;
      seek(((Math.max(0, frame) + 0.5) / fps) * 1000);
    },
    [fps, seek],
  );
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);
  const setSpeed = useCallback((next: number) => {
    const v = video.current;
    if (v) v.playbackRate = next;
    setRate(next);
  }, []);
  const faster = (dir: 1 | -1) => {
    const v = video.current;
    if (!v) return;
    const at = RATES.indexOf(rate as (typeof RATES)[number]);
    const next = RATES[Math.min(RATES.length - 1, Math.max(0, (at < 0 ? 1 : at) + dir))] ?? 1;
    setSpeed(next);
    if (v.paused) void v.play();
  };

  const openDraft = (
    px = 0.5,
    py = 0.5,
    x: number | null = null,
    y: number | null = null,
    kind: VideoReviewNoteKind | null = null,
  ) => {
    const v = video.current;
    if (!v || !open) return;
    v.pause();
    setDraft({ atMs: Math.round(v.currentTime * 1000), endMs: null, kind, px, py, x, y, marking: false });
  };
  const closeDraft = () => {
    setDraft(null);
    setDraftText("");
    draftFiles.clear();
  };
  const markEnd = () => {
    const v = video.current;
    if (!v || !draft) return;
    const end = Math.round(v.currentTime * 1000);
    v.pause();
    setDraft({ ...draft, marking: false, endMs: end > draft.atMs + 40 ? end : null });
  };
  const startMarking = () => {
    if (!draft) return;
    setDraft({ ...draft, marking: true, endMs: null });
    void video.current?.play();
  };
  const draftReady = !draftFiles.busy && (draftText.trim() !== "" || draftFiles.count > 0);
  const saveDraft = () => {
    const body = draftText.trim();
    if (!draft || !draftReady) return;
    addNote.mutate(
      {
        version,
        atMs: draft.atMs,
        endMs: draft.endMs,
        kind: draft.kind,
        x: draft.x,
        y: draft.y,
        attachments: draftFiles.inputs,
        body,
      },
      { onSuccess: closeDraft, onError: failed },
    );
  };
  const wholeReady = !wholeFiles.busy && (wholeText.trim() !== "" || wholeFiles.count > 0);
  const saveWhole = () => {
    const body = wholeText.trim();
    if (!wholeReady) return;
    addNote.mutate(
      { version, atMs: null, attachments: wholeFiles.inputs, body },
      {
        onSuccess: () => {
          setWholeText("");
          wholeFiles.clear();
        },
        onError: failed,
      },
    );
  };

  // Which note the voice goes to: the open box's point, the whole video from the side card, or "Pedir ajustes" said
  // aloud (a note about the whole video, then the changes go at once).
  const voiceFor = useRef<"draft" | "whole" | "changes">("draft");
  const recorder = useNoteRecorder(
    (blob, fileName) => {
      if (voiceFor.current === "changes") {
        addVoice.mutate(
          { file: blob, fileName, version: review.version, atMs: null, language: i18n.language?.slice(0, 2) },
          { onSuccess: () => decideAs("changes"), onError: failed },
        );
        return;
      }
      const d = voiceFor.current === "draft" ? draft : null;
      addVoice.mutate(
        {
          file: blob,
          fileName,
          version,
          atMs: d ? d.atMs : null,
          endMs: d?.endMs ?? null,
          kind: d?.kind ?? null,
          x: d?.x ?? null,
          y: d?.y ?? null,
          attachments: d ? draftFiles.inputs : wholeFiles.inputs,
          language: i18n.language?.slice(0, 2),
        },
        {
          onSuccess: () => {
            if (d) closeDraft();
            else wholeFiles.clear();
          },
          onError: failed,
        },
      );
    },
    () => toast.show(w.micBlocked, "error"),
  );
  const talk = (target: "draft" | "whole" | "changes") => {
    if (recorder.recording) recorder.stop();
    else {
      voiceFor.current = target;
      video.current?.pause();
      void recorder.start();
    }
  };

  // The editor's keys, anywhere on the page but in a field.
  const keys = useRef({ toggle, step, faster, openDraft, closeDraft, markEnd, draft, volume, setVolume, setMuted });
  keys.current = { toggle, step, faster, openDraft, closeDraft, markEnd, draft, volume, setVolume, setMuted };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) {
        if (e.key === "Escape") keys.current.closeDraft();
        return;
      }
      const k = keys.current;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const handled = (() => {
        switch (key) {
          case " ":
          case "k":
            if (k.draft?.marking) k.markEnd();
            else k.toggle();
            return true;
          case "j":
            k.faster(-1);
            return true;
          case "l":
            k.faster(1);
            return true;
          case "ArrowLeft":
            k.step(e.shiftKey ? -fps : -1);
            return true;
          case "ArrowRight":
            k.step(e.shiftKey ? fps : 1);
            return true;
          case "Enter":
          case "n":
            if (k.draft?.marking) k.markEnd();
            else if (!k.draft) k.openDraft();
            return true;
          case "Escape":
            k.closeDraft();
            return true;
          case "m":
            k.setMuted((m) => !m);
            return true;
          case "ArrowUp":
            k.setVolume(k.volume + 0.1);
            return true;
          case "ArrowDown":
            k.setVolume(k.volume - 0.1);
            return true;
          default:
            return false;
        }
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fps]);

  const onPicture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draft?.marking) {
      markEnd();
      return;
    }
    if (draft) return;
    if (!open) {
      toggle();
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    const f = frameBoxOf(video.current);
    const inside = f && px >= f.left && px <= f.left + f.width && py >= f.top && py <= f.top + f.height;
    openDraft(
      px / box.width,
      py / box.height,
      inside && f ? (px - f.left) / f.width : null,
      inside && f ? (py - f.top) / f.height : null,
    );
  };

  // A photo, a clip or a link dropped on the picture: a note at that point and frame, about B-roll unless said otherwise.
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setDropping(false);
    if (!open) return;
    e.preventDefault();
    const { files, links } = dropped(e.dataTransfer);
    if (files.length === 0 && links.length === 0) return;
    if (!draft) {
      const box = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      const f = frameBoxOf(video.current);
      const inside = f && px >= f.left && px <= f.left + f.width && py >= f.top && py <= f.top + f.height;
      openDraft(
        px / box.width,
        py / box.height,
        inside && f ? (px - f.left) / f.width : null,
        inside && f ? (py - f.top) / f.height : null,
        "broll",
      );
    } else if (draft.marking) {
      markEnd();
    }
    if (files.length > 0) draftFiles.addFiles(files);
    if (links.length > 0) draftFiles.addLinks(links);
  };
  const dragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!open || !carries(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dropping) setDropping(true);
  };
  // A pasted screenshot or link in a note's field goes in as an attachment; text pastes as text.
  const pasteInto = (at: typeof draftFiles) => (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length > 0) {
      e.preventDefault();
      at.addFiles(files);
      return;
    }
    const text = e.clipboardData.getData("text/plain").trim();
    const urls = linksIn(text);
    if (urls.length === 1 && urls[0] === text) {
      e.preventDefault();
      at.addLinks(urls);
    }
  };

  const decideAs = (decision: "approve" | "changes") =>
    decide.mutate(
      { decision, message: message.trim() || undefined },
      { onSuccess: () => setMessage(""), onError: failed },
    );

  const lastRound = review.rounds?.at(-1);
  const decidedLine =
    review.status === "changes" && lastRound?.fromClient && !lastRound.answeredAt
      ? `${w.changesBy(lastRound.askedBy)} · ${relativeTime(t, i18n.language, lastRound.askedAt)}`
      : review.decidedBy && review.status !== "in_review"
        ? `${review.status === "approved" ? w.approvedBy(review.decidedBy.name) : w.changesBy(review.decidedBy.name)}${
            review.decidedAt ? ` · ${relativeTime(t, i18n.language, review.decidedAt)}` : ""
          }`
        : null;

  const nearNote = (n: VideoReviewNote) =>
    n.atMs !== null && (n.endMs !== null ? nowMs >= n.atMs && nowMs <= n.endMs : Math.abs(nowMs - n.atMs) < 700);

  return (
    <div className="vr-detail">
      <div className="vr-stage">
        {shown && (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the page's own keys (Enter, N) open the same note box.
          // biome-ignore lint/a11y/noStaticElementInteractions: a click on the picture is where a note goes.
          <div
            className="vr-picture"
            data-noting={open || undefined}
            data-dropping={dropping || undefined}
            onClick={onPicture}
            onDragOver={dragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
            }}
            onDrop={onDrop}
          >
            {/* biome-ignore lint/a11y/useMediaCaption: an edit in review has no captions yet; the notes say what is in it. */}
            <video
              key={`${shown.artifactId}:${hd}:${shown.light}`}
              ref={bindVideo}
              className="vr-video"
              src={videoSrc(shown)}
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration * 1000);
                e.currentTarget.playbackRate = rate;
                if (resumeAt.current !== null) {
                  e.currentTarget.currentTime = resumeAt.current;
                  resumeAt.current = null;
                }
              }}
              onPlay={() => setPlaying(true)}
              onPause={(e) => {
                setPlaying(false);
                setNowMs(Math.round(e.currentTarget.currentTime * 1000));
              }}
              onEnded={() => setPlaying(false)}
              onError={() => setUnplayable(`${shown.artifactId}:${hd}:${shown.light}`)}
              onSeeked={(e) => setNowMs(Math.round(e.currentTarget.currentTime * 1000))}
              onTimeUpdate={(e) => {
                if (!playing) setNowMs(Math.round(e.currentTarget.currentTime * 1000));
              }}
            />
            {unplayable === `${shown.artifactId}:${hd}:${shown.light}` && !shown.light && (
              <p className="vr-preparing small">{w.editor.preparing}</p>
            )}
            {frame &&
              [
                ...(draft && draft.x !== null && draft.y !== null
                  ? [{ id: "draft", x: draft.x, y: draft.y, draft: true }]
                  : []),
                ...notes
                  .filter((n) => n.x !== null && n.y !== null && nearNote(n))
                  .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0, draft: false })),
              ].map((ring) => (
                <span
                  key={ring.id}
                  className="vr-ring"
                  data-draft={ring.draft || undefined}
                  aria-hidden="true"
                  style={{ left: frame.left + ring.x * frame.width, top: frame.top + ring.y * frame.height }}
                />
              ))}
            {dropping && (
              <div className="vr-dropzone" aria-hidden="true">
                <Icon name="attach" />
                {w.dropHere}
              </div>
            )}
            {draft?.marking && (
              <div className="vr-marking" role="status">
                <Icon name="flag" />
                {w.marking(timecode(draft.atMs))}
              </div>
            )}
            {draft && !draft.marking && (
              // biome-ignore lint/a11y/noStaticElementInteractions: stops the picture's click under the box.
              // biome-ignore lint/a11y/useKeyWithClickEvents: only keeps the click inside the box.
              <div
                className="vr-pop"
                // The box takes the half of the picture away from the click, so the ring stays in sight.
                data-edge={draft.py < 0.5 ? "bottom" : "top"}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="vr-pop__head">
                  <span className="vr-pop__time">{frameCode(draft.atMs, fps)}</span>
                  <span className="vr-muted">
                    {draft.endMs !== null ? w.stretch(where(draft.atMs, draft.endMs, w)) : w.point}
                  </span>
                </div>
                <fieldset className="vr-kinds" aria-label={w.kindLabel}>
                  {VIDEO_REVIEW_NOTE_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="vr-kind"
                      aria-pressed={draft.kind === kind}
                      onClick={() => setDraft({ ...draft, kind: draft.kind === kind ? null : kind })}
                    >
                      {w.kinds[kind]}
                    </button>
                  ))}
                </fieldset>
                <Textarea
                  autoFocus
                  value={draftText}
                  rows={3}
                  placeholder={draft.kind === "broll" ? w.brollPlaceholder : w.placeholder}
                  onChange={(e) => setDraftText(e.target.value)}
                  onPaste={pasteInto(draftFiles)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      saveDraft();
                    }
                  }}
                />
                <AttachEditor at={draftFiles} w={w} />
                <div className="vr-pop__acts">
                  <Button
                    size="sm"
                    variant={recorder.recording ? "danger" : "default"}
                    icon={recorder.recording ? "stop" : "mic"}
                    loading={addVoice.isPending}
                    onClick={() => talk("draft")}
                  >
                    {addVoice.isPending ? w.transcribing : recorder.recording ? w.stop : w.talk}
                  </Button>
                  <Button size="sm" icon="flag" onClick={startMarking}>
                    {draft.endMs !== null ? w.remark : w.markEnd}
                  </Button>
                </div>
                <div className="vr-pop__acts vr-pop__acts--end">
                  <Button size="sm" variant="ghost" onClick={closeDraft}>
                    {w.cancel}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!draftReady}
                    loading={addNote.isPending || draftFiles.busy}
                    onClick={saveDraft}
                  >
                    {w.save}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <Scrubber nowMs={nowMs} duration={duration} notes={notes} draft={draft} onSeek={seek} w={w} />

        <div className="vr-transport">
          <div className="vr-transport__group">
            <Button
              size="sm"
              icon={playing ? "pause" : "play"}
              iconOnly
              aria-label={playing ? w.pause : w.play}
              onClick={toggle}
            />
            <Button size="sm" variant="ghost" onClick={() => step(-fps)} aria-label={w.back1s}>
              −1s
            </Button>
            <Button size="sm" variant="ghost" onClick={() => step(-1)} aria-label={w.back1f}>
              −1f
            </Button>
            <Button size="sm" variant="ghost" onClick={() => step(1)} aria-label={w.fwd1f}>
              +1f
            </Button>
            <Button size="sm" variant="ghost" onClick={() => step(fps)} aria-label={w.fwd1s}>
              +1s
            </Button>
          </div>
          <div className="vr-transport__group">
            <Button
              size="sm"
              variant="ghost"
              icon={muted || volume === 0 ? "mute" : "volume"}
              iconOnly
              aria-label={muted ? w.unmute : w.mute}
              onClick={() => (muted && volume === 0 ? setVolume(0.8) : setMuted(!muted))}
            />
            <input
              type="range"
              className="vr-volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label={w.volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                if (Number(e.target.value) > 0) setMuted(false);
              }}
            />
          </div>
          <span className="vr-transport__clock">
            {frameCode(nowMs, fps)} <span className="vr-muted">/ {frameCode(duration, fps)}</span>
          </span>
          <Segmented
            label={w.speed}
            size="sm"
            value={String(rate)}
            onValueChange={(v) => setSpeed(Number(v))}
            options={RATES.map((r) => ({ value: String(r), label: `${r}×` }))}
          />
        </div>
        <p className="vr-muted vr-keys">{open ? w.keys : w.keysClosed}</p>

        {/* A person's video has no agent's brief: its task says what was asked. */}
        {!(review.sender && !review.brief && review.links.length === 0) && (
          <section className="vr-brief" aria-label={w.briefTitle}>
            <h2 className="vr-notes__title">{w.briefTitle}</h2>
            <p className={review.brief ? "vr-brief__text" : "vr-muted"}>{review.brief || w.noBrief}</p>
            {review.links.length > 0 && (
              <div className="vr-brief__links">
                {review.links.map((link) => (
                  <Button key={link.url} size="sm" icon="external" asChild>
                    <a href={link.url} target="_blank" rel="noreferrer noopener">
                      {link.label}
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </section>
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
                onValueChange={(v) => {
                  closeDraft();
                  setVersion(Number(v));
                }}
                options={review.versions.map((v) => ({ value: String(v.version), label: w.version(v.version) }))}
              />
            ) : (
              <span className="vr-muted">{w.version(review.version)}</span>
            )}
            {shown?.light && (
              <Button
                size="sm"
                variant={hd ? "default" : "ghost"}
                aria-pressed={hd}
                title={hd ? w.hdOn : w.hdOff}
                onClick={toggleHd}
              >
                {w.hd}
              </Button>
            )}
            {shown && (
              <Button size="sm" variant="ghost" icon="download" asChild>
                <a href={api.artifacts.fileUrl(org.id, shown.artifactId)} download>
                  {w.download}
                </a>
              </Button>
            )}
          </div>
          {shown?.note && (
            <p className="vr-muted">
              <b>{w.versionNote}:</b> {shown.note}
            </p>
          )}
          {decidedLine && <p className="vr-muted">{decidedLine}</p>}
          {review.status === "changes" && (
            <p className="vr-muted">
              {review.sender
                ? w.editor.waitingNext(review.sender.name, review.version + 1)
                : w.waitingNext(review.version + 1)}
            </p>
          )}
          {review.task && (
            <Link
              to="/org/$orgId/issues/$number"
              params={{ orgId: org.id, number: String(review.task.number) }}
              className="ac-link small"
            >
              {w.editor.openTask(review.task.number)}
            </Link>
          )}
        </div>

        <section className="vr-notes" aria-label={w.notesTitle}>
          <h2 className="vr-notes__title">
            {w.notesTitle} {notes.length > 0 && <span className="vr-muted">{notes.length}</span>}
          </h2>
          {notes.length === 0 ? (
            <p className="vr-muted">{open ? w.noNotes : w.noNotesClosed}</p>
          ) : (
            <ul className="vr-notes__list">
              {notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  w={w}
                  mine={note.author?.id === me.user.id}
                  sentTo={
                    review.sender ? w.editor.sentTo(review.sender.name.split(" ")[0] || review.sender.name) : undefined
                  }
                  active={nearNote(note)}
                  onSeek={(ms) => {
                    video.current?.pause();
                    seek(ms);
                  }}
                  onRemove={() => removeNote.mutate(note.id, { onError: failed })}
                />
              ))}
            </ul>
          )}
        </section>

        {open && (
          // biome-ignore lint/a11y/noStaticElementInteractions: a drop zone for files; the Attach button does the same.
          <div
            className="vr-compose"
            onDragOver={(e) => {
              if (!carries(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const { files, links } = dropped(e.dataTransfer);
              wholeFiles.addFiles(files);
              wholeFiles.addLinks(links);
            }}
          >
            <span className="vr-compose__label">{w.wholeTitle}</span>
            <Textarea
              value={wholeText}
              rows={2}
              placeholder={w.wholePlaceholder}
              onPaste={pasteInto(wholeFiles)}
              onChange={(e) => setWholeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveWhole();
              }}
            />
            <AttachEditor at={wholeFiles} w={w} />
            <div className="vr-compose__acts">
              <Button
                variant={recorder.recording && voiceFor.current === "whole" ? "danger" : "default"}
                size="sm"
                icon={recorder.recording && voiceFor.current === "whole" ? "stop" : "mic"}
                disabled={!!draft}
                onClick={() => talk("whole")}
              >
                {recorder.recording && voiceFor.current === "whole" ? w.stop : w.talk}
              </Button>
              <Button
                size="sm"
                icon="send"
                disabled={!wholeReady}
                loading={(addNote.isPending && !draft) || wholeFiles.busy}
                onClick={saveWhole}
              >
                {w.add}
              </Button>
            </div>
          </div>
        )}

        <ReviewLog rounds={review.rounds ?? []} />

        {review.sender && review.sender.id === me.user.id && review.status !== "approved" && (
          <SendNextVersion review={review} />
        )}

        {open && (
          <div className="vr-decide">
            {!maker && <p className="vr-muted">{w.agentGone}</p>}
            <Button
              variant={recorder.recording && voiceFor.current === "changes" ? "danger" : "default"}
              icon={recorder.recording && voiceFor.current === "changes" ? "stop" : "mic"}
              disabled={!maker || (recorder.recording && voiceFor.current !== "changes")}
              loading={addVoice.isPending && voiceFor.current === "changes"}
              title={w.sayChangesHint}
              onClick={() => talk("changes")}
            >
              {addVoice.isPending && voiceFor.current === "changes"
                ? w.sendingChanges
                : recorder.recording && voiceFor.current === "changes"
                  ? w.sayingChanges
                  : w.sayChanges}
            </Button>
            <Textarea
              value={message}
              rows={1}
              placeholder={review.sender ? w.editor.message(review.sender.name) : w.message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="vr-muted">
              {!review.sender
                ? w.changesHint
                : review.taskId && review.medium === "video"
                  ? w.editor.changesHint(review.sender.name)
                  : w.team.changesHint(review.sender.name)}
            </p>
            <div className="vr-decide__acts">
              <Button
                variant="default"
                icon="edit"
                disabled={!maker || (notes.every((n) => n.sent) && !message.trim())}
                loading={decide.isPending && decide.variables?.decision === "changes"}
                onClick={() => decideAs("changes")}
              >
                {w.changes}
              </Button>
              <Button
                variant="primary"
                icon="check"
                disabled={!maker}
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
          <TaskParts review={review.data} />
          {review.data.medium === "design" ? (
            <DesignReviewBody review={review.data} w={w} />
          ) : (
            <ReviewBody review={review.data} w={w} />
          )}
        </>
      )}
    </div>
  );
}
