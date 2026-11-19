import {
  DESIGN_REVIEW_NOTE_KINDS,
  useAddReviewNote,
  useAddVoiceReviewNote,
  useDecideVideoReview,
  useDeleteReviewNote,
  useDesignSource,
  useSaveDesign,
  type VideoReview,
  type VideoReviewNote,
  type VideoReviewNoteKind,
} from "@dougbot/client";
import {
  editorPage,
  type FrameCommand,
  type FrameLayer,
  type FrameMessage,
  type LayerInfo,
  type LayerPatch,
} from "@dougbot/client/lib/design-bridge";
import { relativeTime } from "@dougbot/client/lib/format";
import { PAGE_SANDBOX } from "@dougbot/client/lib/isolated-page";
import { portalClientName } from "@dougbot/client/lib/portal";
import {
  Button,
  Chip,
  type ChipTone,
  Dialog,
  DialogFooter,
  Field,
  Icon,
  Segmented,
  Spinner,
  Textarea,
} from "@dougbot/ui";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { usePageUrl } from "@/components/artifacts/HtmlFrame";
import { useOrg } from "@/components/org-context";
import {
  AttachEditor,
  carries,
  dropped,
  linksIn,
  NoteAttachments,
  useAttachments,
} from "@/components/video-review/Attachments";
import { useNoteRecorder } from "@/components/video-review/recorder";
import { SendNextVersion } from "@/components/video-review/SendWork";
import type { ReviewWords } from "@/components/video-review/words";
import { useToast } from "@/lib/toast";
import { LayerPanel } from "./LayerPanel";
import "./design-review.css";

/*
 * A design piece in review (docs/adr/doug-0010-design-review.md): its slides on a dark stage, one at a time, with a
 * strip of them under it. "Comentar" pins a note to a point of a slide (typed or said, with photos or links); "Editar"
 * opens the piece itself in the editor (`bridge.ts`, the piece's own page in an isolated frame) and saves what was
 * changed by hand as the next version, the open notes moving along. The decision goes back to the designer agent like
 * a video's. The same page serves the web, the desktop apps (which load the site) and a phone's browser.
 */

const TONE: Record<VideoReview["status"], ChipTone> = { in_review: "waiting", changes: "neutral", approved: "done" };
const ICON = { in_review: "eye", changes: "edit", approved: "check" } as const;
/** Until the slide says otherwise: a portrait post, what most pieces are. */
const DEFAULT_SIZE = { w: 1080, h: 1350 };
const ZOOMS = [1, 1.5, 2, 3] as const;

interface Draft {
  page: number;
  x: number;
  y: number;
  kind: VideoReviewNoteKind | null;
}

/** `2026-11-18T10:00` → `18/11 às 10:00`, as the portal's time reads. */
const deliveryWhen = (when: string) => {
  const [date, time] = when.split("T");
  const [, m, d] = (date ?? "").split("-");
  return d && m ? `${d}/${m}${time ? ` ${time.slice(0, 5)}` : ""}` : when;
};

/** The slide fitted to the stage's box: what one pixel of the slide is on screen. */
function useFit(box: HTMLElement | null, size: { w: number; h: number }) {
  const [fit, setFit] = useState(0.4);
  useEffect(() => {
    if (!box) return;
    const measure = () => {
      const width = box.clientWidth - 2 * 16;
      const phone = window.innerWidth < 640;
      // On a phone the strip and the buttons stay in sight under the slide; beside the notes it may take the height.
      const height = phone ? window.innerHeight * 0.6 : Math.max(360, window.innerHeight - 360);
      setFit(Math.max(0.05, Math.min(width / size.w, height / size.h)));
    };
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [box, size.w, size.h]);
  return fit;
}

/** A photo picked to swap one on the slide, as a data URL no larger than the piece needs. */
async function photoData(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const most = 2400;
  const k = Math.min(1, most / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // A PNG keeps a cut-out's transparency; a photo goes as JPEG, a fraction of the size.
  return file.type === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9);
}

function NoteRow({
  note,
  n,
  w,
  mine,
  active,
  onOpen,
  onRemove,
}: {
  note: VideoReviewNote;
  n: number | null;
  w: ReviewWords;
  mine: boolean;
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="vr-note dr-note" data-sent={note.sent || undefined} data-active={active || undefined}>
      {n !== null ? (
        <button
          type="button"
          className="dr-pin dr-pin--row"
          onClick={onOpen}
          aria-label={w.design.slideShort(note.page ?? 1)}
        >
          {n}
        </button>
      ) : (
        <span className="vr-note__time vr-note__time--whole">{w.design.whole}</span>
      )}
      <span className="vr-note__words">
        {note.kind && <span className="vr-note__kind">{w.kinds[note.kind]}</span>}
        {note.body && <span className="vr-note__body">{note.body}</span>}
        <NoteAttachments items={note.attachments} w={w} />
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

export function DesignReviewBody({ review, w }: { review: VideoReview; w: ReviewWords }) {
  const { org, me } = useOrg();
  // Who made it: the agent, or the person of the team who sent it (doug-0015); the decision goes back to them.
  const maker = review.agent ?? review.sender ?? null;
  const api = useApi();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const d = w.design;

  const [version, setVersion] = useState(review.version);
  const latest = review.version;
  const [slide, setSlide] = useState(1);
  const [mode, setMode] = useState<"comment" | "edit">("comment");
  const [zoom, setZoom] = useState<number>(1);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [wholeText, setWholeText] = useState("");
  const [message, setMessage] = useState("");
  // The caption that goes up with the post on "Aprovar": the card's until the person changes it here.
  const [caption, setCaption] = useState<string | null>(null);
  const captionShown = caption ?? review.portal?.caption ?? "";
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const draftFiles = useAttachments(review);
  const wholeFiles = useAttachments(review);
  const addNote = useAddReviewNote(org.id, review.id);
  const addVoice = useAddVoiceReviewNote(org.id, review.id);
  const removeNote = useDeleteReviewNote(org.id, review.id);
  const decide = useDecideVideoReview(org.id, review.id);
  const save = useSaveDesign(org.id, review.id);
  const failed = () => toast.show(w.failed, "error");

  // The editor's state, as the piece reports it.
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [frameSlides, setFrameSlides] = useState(0);
  const [colors, setColors] = useState<string[]>([]);
  const [layers, setLayers] = useState<FrameLayer[]>([]);
  const [selected, setSelected] = useState<LayerInfo | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState({ changes: 0, undo: false, redo: false });
  const [saveNote, setSaveNote] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const pending = useRef<{ req: number; resolve: (html: string) => void } | null>(null);
  const dirty = history.changes > 0;

  const shown = review.versions.find((v) => v.version === version) ?? review.versions.at(-1);
  const pages = shown?.pages ?? [];
  const isLatest = version === latest;
  const open = isLatest && review.status === "in_review";
  const canEdit = Boolean(shown?.source) && open;
  // The live page shows while editing, for a version made by hand (no pictures), and while edits wait to be saved.
  const live = Boolean(shown?.source) && (mode === "edit" || pages.length === 0 || dirty);
  const source = useDesignSource(org.id, review.id, version, live);
  const page = useMemo(() => (source.data ? editorPage(source.data) : ""), [source.data]);
  const { url: frameUrl, failed: frameFailed } = usePageUrl(page, ready);
  const count = Math.max(1, pages.length || frameSlides);
  // Whole-piece notes first, then slide by slide (a stable sort keeps the order they were written in).
  const notes = review.notes.filter((n) => n.version === version).sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  const pinned = notes.filter((n) => n.page !== null);
  const numberOf = (n: VideoReviewNote) => {
    const i = pinned.indexOf(n);
    return i < 0 ? null : i + 1;
  };

  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const fit = useFit(box, size);
  const k = fit * zoom;

  // A new version arrived while the page was open: show it (unless edits wait to be saved on this one).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setVersion(latest);
  }, [latest]);
  // Another version, another page: the frame starts over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the version is what changes the piece
  useEffect(() => {
    setReady(false);
    setFrameSlides(0);
    setLayers([]);
    setSelected(null);
    setHistory({ changes: 0, undo: false, redo: false });
  }, [version, frameKey]);
  useEffect(() => {
    if (slide > count) setSlide(count);
  }, [count, slide]);

  const send = useCallback((cmd: FrameCommand) => {
    frame.current?.contentWindow?.postMessage(cmd, "*");
  }, []);

  // What the piece says.
  const stateRef = useRef({ mode, slide, k, d });
  stateRef.current = { mode, slide, k, d };
  const keysRef = useRef<(key: string, shift: boolean, mod: boolean) => void>(() => {});
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FrameMessage;
      if (!m || typeof m !== "object" || !("ed" in m)) return;
      const s = stateRef.current;
      switch (m.ed) {
        case "boot":
          send({
            ed: "words",
            words: { text: s.d.text, photo: s.d.photo, shape: s.d.shape, logo: "Logo" },
          });
          return;
        case "ready":
          setReady(true);
          setFrameSlides(m.slides);
          setColors(m.colors);
          setSize({ w: m.w, h: m.h });
          send({ ed: "slide", slide: s.slide });
          send({ ed: "mode", mode: s.mode === "edit" ? "edit" : "view" });
          send({ ed: "scale", k: s.k });
          return;
        case "slide":
          setSize({ w: m.w, h: m.h });
          return;
        case "layers":
          setLayers(m.layers);
          return;
        case "selected":
          setSelected(m.info);
          setSelectedCount(m.count);
          return;
        case "history":
          setHistory({ changes: m.changes, undo: m.undo, redo: m.redo });
          return;
        case "key":
          keysRef.current(m.key, m.shift, m.mod);
          return;
        case "page":
          if (pending.current?.req === m.req) {
            pending.current.resolve(m.html);
            pending.current = null;
          }
          return;
        default:
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send]);

  useEffect(() => {
    if (ready) send({ ed: "slide", slide });
  }, [ready, slide, send]);
  useEffect(() => {
    if (ready) send({ ed: "mode", mode: mode === "edit" ? "edit" : "view" });
  }, [ready, mode, send]);
  useEffect(() => {
    if (ready) send({ ed: "scale", k });
  }, [ready, k, send]);
  useEffect(() => {
    if (ready) send({ ed: "adding", on: adding && mode === "edit" });
  }, [ready, adding, mode, send]);

  // Leaving with edits not saved: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const go = (n: number) => {
    setDraft(null);
    setSlide(Math.max(1, Math.min(count, n)));
  };
  const setLayer = (patch: LayerPatch) => {
    if (selected) send({ ed: "set", id: selected.id, patch });
  };

  const pageHtml = () =>
    new Promise<string>((resolve, reject) => {
      const req = Date.now();
      pending.current = { req, resolve };
      send({ ed: "serialize", req });
      setTimeout(() => {
        if (pending.current?.req === req) {
          pending.current = null;
          reject(new Error("the piece did not answer"));
        }
      }, 15_000);
    });
  const saveEdit = async () => {
    try {
      const html = await pageHtml();
      save.mutate(
        { baseVersion: version, html, note: saveNote.trim() || undefined },
        {
          onSuccess: (r) => {
            toast.show(d.saved(r.version));
            setSaveNote("");
            setHistory({ changes: 0, undo: false, redo: false });
            setMode("comment");
            setVersion(r.version);
          },
          onError: (error) =>
            toast.show(
              (error as { code?: string }).code === "video_review.stale_version" ? d.stale : w.failed,
              "error",
            ),
        },
      );
    } catch {
      failed();
    }
  };
  const discard = () => {
    setDiscarding(false);
    setMode("comment");
    setFrameKey((n) => n + 1);
  };

  // ---------- notes ----------

  const closeDraft = () => {
    setDraft(null);
    setDraftText("");
    draftFiles.clear();
  };
  const draftReady = !draftFiles.busy && (draftText.trim() !== "" || draftFiles.count > 0);
  const saveDraft = () => {
    if (!draft || !draftReady) return;
    addNote.mutate(
      {
        version,
        atMs: null,
        page: draft.page,
        kind: draft.kind,
        x: draft.x,
        y: draft.y,
        attachments: draftFiles.inputs,
        body: draftText.trim(),
      },
      { onSuccess: closeDraft, onError: failed },
    );
  };
  const wholeReady = !wholeFiles.busy && (wholeText.trim() !== "" || wholeFiles.count > 0);
  const saveWhole = () => {
    if (!wholeReady) return;
    addNote.mutate(
      { version, atMs: null, page: null, attachments: wholeFiles.inputs, body: wholeText.trim() },
      {
        onSuccess: () => {
          setWholeText("");
          wholeFiles.clear();
        },
        onError: failed,
      },
    );
  };
  const decideAs = (decision: "approve" | "changes") =>
    decide.mutate(
      {
        decision,
        message: message.trim() || undefined,
        ...(decision === "approve" && review.portal ? { caption: captionShown } : {}),
      },
      { onSuccess: () => setMessage(""), onError: failed },
    );

  const voiceFor = useRef<"draft" | "whole" | "changes">("draft");
  const recorder = useNoteRecorder(
    (blob, fileName) => {
      const language = i18n.language?.slice(0, 2);
      if (voiceFor.current === "changes") {
        addVoice.mutate(
          { file: blob, fileName, version: review.version, atMs: null, page: null, language },
          { onSuccess: () => decideAs("changes"), onError: failed },
        );
        return;
      }
      const at = voiceFor.current === "draft" ? draft : null;
      addVoice.mutate(
        {
          file: blob,
          fileName,
          version,
          atMs: null,
          page: at?.page ?? null,
          kind: at?.kind ?? null,
          x: at?.x ?? null,
          y: at?.y ?? null,
          attachments: at ? draftFiles.inputs : wholeFiles.inputs,
          language,
        },
        {
          onSuccess: () => {
            if (at) closeDraft();
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
      void recorder.start();
    }
  };

  // A tap on the slide is where a note goes; a sideways swipe turns the slide.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pointAt = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const hitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const hitUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - from.y) * 1.5) {
      go(slide + (dx < 0 ? 1 : -1));
      return;
    }
    if (draft || !open) return;
    const p = pointAt(e);
    setActiveNote(null);
    setDraft({ page: slide, x: p.x, y: p.y, kind: null });
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setDropping(false);
    if (!open || mode !== "comment") return;
    e.preventDefault();
    const { files, links } = dropped(e.dataTransfer);
    if (files.length === 0 && links.length === 0) return;
    if (!draft) {
      const p = pointAt(e);
      setDraft({ page: slide, x: p.x, y: p.y, kind: "image" });
    }
    if (files.length > 0) draftFiles.addFiles(files);
    if (links.length > 0) draftFiles.addLinks(links);
  };
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

  // The page's keys, and the piece's when it has the focus.
  const keys = (key: string, shift: boolean, mod: boolean) => {
    if (mod && (key === "s" || key === "S") && mode === "edit" && dirty) {
      void saveEdit();
      return true;
    }
    if (mod && mode === "edit" && (key === "z" || key === "Z" || key === "y" || key === "Y")) {
      send({ ed: key === "y" || key === "Y" || shift ? "redo" : "undo" });
      return true;
    }
    if (mod) return false;
    if (key === "ArrowRight") go(slide + 1);
    else if (key === "ArrowLeft") go(slide - 1);
    else if ((key === "e" || key === "E") && canEdit && !shift) setMode("edit");
    else if ((key === "c" || key === "C") && !shift) setMode("comment");
    else if (key === "Escape") closeDraft();
    else return false;
    return true;
  };
  keysRef.current = (key, shift, mod) => {
    keys(key, shift, mod);
  };
  const keysLatest = useRef(keys);
  keysLatest.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (e.altKey) return;
      if (keysLatest.current(e.key, e.shiftKey, e.metaKey || e.ctrlKey)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const decidedLine =
    review.decidedBy && review.status !== "in_review"
      ? `${review.status === "approved" ? w.approvedBy(review.decidedBy.name) : w.changesBy(review.decidedBy.name)}${
          review.decidedAt ? ` · ${relativeTime(t, i18n.language, review.decidedAt)}` : ""
        }`
      : null;
  const pageUrl = (v: number, n: number) => api.videoReviews?.pageUrl?.(org.id, review.id, v, n) ?? "";
  const slideNotes = (n: number) => notes.filter((x) => x.page === n && !x.sent).length;
  const editTitle = !shown?.source ? d.noSource : !open ? d.editClosed : undefined;

  const pins = [
    ...notes
      .filter((n) => n.page === slide && n.x !== null && n.y !== null)
      .map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0, n: numberOf(n), sent: n.sent })),
    ...(draft && draft.page === slide ? [{ id: "draft", x: draft.x, y: draft.y, n: null, sent: false }] : []),
  ];

  const stage = (
    <div className="dr-stage">
      <div className="dr-bar">
        {/* A person's piece is its pictures: nothing to edit in place, so no Comentar/Editar (doug-0015). */}
        {!review.sender && (
          <Segmented
            label={d.edit}
            size="sm"
            value={mode}
            onValueChange={(v) => {
              closeDraft();
              if (v === "edit" && !canEdit) return;
              setMode(v);
            }}
            options={[
              { value: "comment", label: d.comment },
              { value: "edit", label: d.edit },
            ]}
          />
        )}
        <div className="dr-bar__group">
          <Button
            size="sm"
            variant="ghost"
            icon="chevronLeft"
            iconOnly
            aria-label={d.prev}
            disabled={slide <= 1}
            onClick={() => go(slide - 1)}
          />
          <span className="dr-bar__count">{d.slide(slide, count)}</span>
          <Button
            size="sm"
            variant="ghost"
            icon="chevronRight"
            iconOnly
            aria-label={d.next}
            disabled={slide >= count}
            onClick={() => go(slide + 1)}
          />
        </div>
        <Segmented
          label={d.zoom}
          size="sm"
          value={String(zoom)}
          onValueChange={(v) => setZoom(Number(v))}
          options={ZOOMS.map((z) => ({ value: String(z), label: z === 1 ? d.fit : `${z * 100}%` }))}
        />
      </div>
      {mode === "comment" && !canEdit && editTitle && shown && !review.sender && (
        <p className="vr-muted dr-hint">{editTitle}</p>
      )}

      <div className="dr-canvas" ref={setBox} data-zoomed={zoom > 1 || undefined}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop zone for photos; the note box's Attach does the same. */}
        <div
          className="dr-board"
          style={{ width: size.w * k, height: size.h * k }}
          data-mode={mode}
          onDragOver={(e) => {
            if (!open || mode !== "comment" || !carries(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!dropping) setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={onDrop}
        >
          {live ? (
            <>
              {frameUrl && (
                <iframe
                  key={`${version}:${frameKey}`}
                  ref={frame}
                  title={review.title}
                  src={frameUrl}
                  sandbox={PAGE_SANDBOX}
                  className="dr-frame"
                  style={{ width: size.w, height: size.h, transform: `scale(${k})` }}
                />
              )}
              {(!ready || source.isPending) && !frameFailed && !source.isError && (
                <div className="dr-loading" role="status">
                  <Spinner />
                  <span>{d.loading}</span>
                </div>
              )}
              {(frameFailed || source.isError) && (
                <div className="dr-loading" role="alert">
                  <span>{d.failedLoad}</span>
                  <Button
                    size="sm"
                    onClick={() => (source.isError ? void source.refetch() : setFrameKey((n) => n + 1))}
                  >
                    {w.failed}
                  </Button>
                </div>
              )}
            </>
          ) : (
            pages[slide - 1] && (
              <img
                key={`${version}:${slide}`}
                className="dr-picture"
                src={pageUrl(version, slide)}
                alt={d.slideShort(slide)}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && (img.naturalWidth !== size.w || img.naturalHeight !== size.h)) {
                    setSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
              />
            )
          )}
          {mode === "comment" && (
            <div
              className="dr-hit"
              data-noting={open || undefined}
              onPointerDown={hitDown}
              onPointerUp={hitUp}
              onPointerCancel={() => {
                swipe.current = null;
              }}
            >
              {pins.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="dr-pin"
                  data-draft={p.id === "draft" || undefined}
                  data-sent={p.sent || undefined}
                  data-active={activeNote === p.id || undefined}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  aria-label={p.n !== null ? `${w.notesTitle} ${p.n}` : w.noteHere}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    if (p.id !== "draft") setActiveNote(p.id);
                  }}
                >
                  {p.n ?? <Icon name="plus" size={14} />}
                </button>
              ))}
            </div>
          )}
          {dropping && (
            <div className="vr-dropzone" aria-hidden="true">
              <Icon name="attach" />
              {w.dropHere}
            </div>
          )}
          {draft && (
            // biome-ignore lint/a11y/noStaticElementInteractions: stops the slide's tap under the box.
            // biome-ignore lint/a11y/useKeyWithClickEvents: only keeps the tap inside the box.
            <div
              className="vr-pop dr-pop"
              data-edge={draft.y < 0.5 ? "bottom" : "top"}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="vr-pop__head">
                <span className="vr-pop__time">{d.slideShort(draft.page)}</span>
              </div>
              <fieldset className="vr-kinds" aria-label={w.kindLabel}>
                {DESIGN_REVIEW_NOTE_KINDS.map((kind) => (
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
                placeholder={w.placeholder}
                onChange={(e) => setDraftText(e.target.value)}
                onPaste={pasteInto(draftFiles)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    saveDraft();
                  }
                  if (e.key === "Escape") closeDraft();
                }}
              />
              <AttachEditor at={draftFiles} w={w} />
              <div className="vr-pop__acts vr-pop__acts--end">
                <Button
                  size="sm"
                  variant={recorder.recording ? "danger" : "default"}
                  icon={recorder.recording ? "stop" : "mic"}
                  loading={addVoice.isPending}
                  onClick={() => talk("draft")}
                >
                  {addVoice.isPending ? w.transcribing : recorder.recording ? w.stop : w.talk}
                </Button>
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
      </div>

      {count > 1 && (
        <ol className="dr-strip" aria-label={d.slides}>
          {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
            <li key={n}>
              <button
                type="button"
                className="dr-thumb"
                aria-current={n === slide || undefined}
                aria-label={d.slideShort(n)}
                onClick={() => go(n)}
                style={{ aspectRatio: `${size.w} / ${size.h}` }}
              >
                {pages[n - 1] ? (
                  <img src={pageUrl(version, n)} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="dr-thumb__n">{n}</span>
                )}
                {slideNotes(n) > 0 && <span className="dr-thumb__count">{slideNotes(n)}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="vr-muted vr-keys">{mode === "edit" ? d.editKeys : open ? d.keys : w.keysClosed}</p>
    </div>
  );

  const side =
    mode === "edit" ? (
      <LayerPanel
        w={w}
        version={version}
        layers={layers}
        selected={selected}
        count={selectedCount}
        adding={adding}
        onAdding={setAdding}
        colors={colors}
        history={history}
        saving={save.isPending}
        saveNote={saveNote}
        onSaveNote={setSaveNote}
        onSelect={(id) => send({ ed: "select", id })}
        onToggle={(id, hidden) => send({ ed: "set", id, patch: { hidden } })}
        onPatch={setLayer}
        onParent={() => send({ ed: "parent" })}
        onRewrite={() => send({ ed: "text" })}
        onPhoto={async (file) => {
          try {
            setLayer({ src: await photoData(file) });
          } catch {
            failed();
          }
        }}
        onUndo={() => send({ ed: "undo" })}
        onRedo={() => send({ ed: "redo" })}
        onSave={() => void saveEdit()}
        onDiscard={() => setDiscarding(true)}
        onDone={() => setMode("comment")}
      />
    ) : (
      <div className="vr-side">
        <div className="vr-head">
          <div className="vr-head__line">
            <Chip tone={TONE[review.status]} icon={ICON[review.status]}>
              {w.status[review.status]}
            </Chip>
            {review.versions.length > 1 ? (
              <Segmented
                label={w.versionsLabel}
                size="sm"
                value={String(version)}
                onValueChange={(v) => {
                  if (dirty) return;
                  closeDraft();
                  setVersion(Number(v));
                }}
                options={review.versions.map((v) => ({ value: String(v.version), label: w.version(v.version) }))}
              />
            ) : (
              <span className="vr-muted">{w.version(review.version)}</span>
            )}
            {pages[slide - 1] && (
              <Button size="sm" variant="ghost" icon="download" asChild>
                <a href={pageUrl(version, slide)} download={`${review.title} V${version} ${slide}.png`}>
                  {w.download}
                </a>
              </Button>
            )}
          </div>
          {shown?.editedBy && <p className="vr-muted">{d.editedBy(shown.editedBy.name)}</p>}
          {shown?.note && (
            <p className="vr-muted">
              <b>{w.versionNote}:</b> {shown.note}
            </p>
          )}
          {decidedLine && <p className="vr-muted">{decidedLine}</p>}
          {review.status === "changes" && <p className="vr-muted">{w.waitingNext(review.version + 1)}</p>}
          {review.delivery?.state && (
            <p className="vr-muted" role="status">
              {review.delivery.state === "scheduled"
                ? d.delivery.scheduled(deliveryWhen(review.delivery.when ?? ""))
                : review.delivery.state === "failed"
                  ? d.delivery.failed(review.delivery.error ?? "")
                  : d.delivery[review.delivery.state]}
              {review.delivery.link && (
                <>
                  {" · "}
                  <a href={review.delivery.link} target="_blank" rel="noreferrer noopener" className="ac-link">
                    {d.delivery.open}
                  </a>
                </>
              )}
            </p>
          )}
          {dirty && (
            <div className="dr-unsaved" role="status">
              <span>{d.unsaved(history.changes)}</span>
              <span className="dr-unsaved__acts">
                <Button size="sm" variant="ghost" onClick={() => setDiscarding(true)}>
                  {d.discard}
                </Button>
                <Button size="sm" variant="primary" loading={save.isPending} onClick={() => void saveEdit()}>
                  {d.saveAs(review.version + 1)}
                </Button>
              </span>
            </div>
          )}
        </div>

        <section className="vr-notes" aria-label={w.notesTitle}>
          <h2 className="vr-notes__title">
            {w.notesTitle} {notes.length > 0 && <span className="vr-muted">{notes.length}</span>}
          </h2>
          {notes.length === 0 ? (
            <p className="vr-muted">{open ? d.noNotes : w.noNotesClosed}</p>
          ) : (
            <ul className="vr-notes__list">
              {notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  n={numberOf(note)}
                  w={w}
                  mine={note.author?.id === me.user.id}
                  active={activeNote === note.id}
                  onOpen={() => {
                    if (note.page) go(note.page);
                    setActiveNote(note.id);
                  }}
                  onRemove={() => removeNote.mutate(note.id, { onError: failed })}
                />
              ))}
            </ul>
          )}
        </section>

        {open && (
          <div className="vr-compose">
            <span className="vr-compose__label">{d.wholeTitle}</span>
            <Textarea
              value={wholeText}
              rows={2}
              placeholder={d.wholePlaceholder}
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

        {open && (
          <div className="vr-decide">
            {!maker && <p className="vr-muted">{d.agentGone}</p>}
            <Button
              variant={recorder.recording && voiceFor.current === "changes" ? "danger" : "default"}
              icon={recorder.recording && voiceFor.current === "changes" ? "stop" : "mic"}
              disabled={!maker || dirty || (recorder.recording && voiceFor.current !== "changes")}
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
            <p className="vr-muted">{review.sender ? w.team.changesHint(review.sender.name) : w.changesHint}</p>
            {review.portal && (
              <p className="vr-muted">
                {d.afterApprove[review.portal.afterApprove](portalClientName(review.portal.client))}
              </p>
            )}
            {review.portal && (
              <Field label={d.caption}>
                <Textarea
                  value={captionShown}
                  rows={3}
                  maxLength={2200}
                  placeholder={d.captionPlaceholder}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </Field>
            )}
            <div className="vr-decide__acts">
              <Button
                variant="default"
                icon="edit"
                disabled={!maker || dirty || (notes.every((n) => n.sent) && !message.trim())}
                loading={decide.isPending && decide.variables?.decision === "changes"}
                onClick={() => decideAs("changes")}
              >
                {w.changes}
              </Button>
              <Button
                variant="primary"
                icon="check"
                disabled={!maker || dirty}
                loading={decide.isPending && decide.variables?.decision === "approve"}
                onClick={() => decideAs("approve")}
              >
                {review.portal && captionShown.trim() ? d.approveWithCaption : w.approve}
              </Button>
            </div>
          </div>
        )}

        {review.sender && review.sender.id === me.user.id && review.status !== "approved" && (
          <SendNextVersion review={review} />
        )}

        {/* A person's piece has no brief from an agent: the section shows only when there is one (as the video's). */}
        {!(review.sender && !review.brief && review.links.length === 0) && (
          <section className="vr-brief" aria-label={w.briefTitle}>
            <h2 className="vr-notes__title">{w.briefTitle}</h2>
            <p className={review.brief ? "vr-brief__text" : "vr-muted"}>{review.brief || d.briefNone}</p>
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
    );

  return (
    <div className="vr-detail dr-detail" data-mode={mode}>
      {stage}
      {side}
      <Dialog open={discarding} onOpenChange={setDiscarding} title={d.discardConfirm} closeLabel={w.cancel} width={420}>
        <DialogFooter>
          <Button onClick={() => setDiscarding(false)}>{w.cancel}</Button>
          <Button variant="danger" onClick={discard}>
            {d.discard}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
