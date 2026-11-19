import {
  MEDIA_REF_ACCEPT,
  type MediaFileSet,
  type MediaFileTarget,
  type MediaGenKind,
  type MediaInputMode,
  type MediaModeSpec,
  type MediaRefFile,
  type MediaRefKind,
} from "@dougbot/client";
import { Field, Icon, Menu, MenuItem, MenuSeparator, Select } from "@dougbot/ui";
import { type DragEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The input block of the Mídia page (ADR doug-0011), the Zim Studio's "Input" card in our kit: the mode on top
 * (one choice that decides what the block asks for), then the layout of that mode. The prompt alone shows nothing;
 * "Primeiro quadro" one frame; "Primeiro e último quadro" two frames side by side in the video's own shape with ⇄ on
 * the seam; "Multi referências" a large field that turns into a grid of thumbnails with a "+"; the video modes one
 * large clip (with optional references beside an edit). Every slot takes a dropped file for itself and opens the file
 * picker on a tap; the whole form takes a drop or a paste and puts each file where its kind goes.
 */

/** A file on its way to the service, shown where it will land. */
export interface PendingFile {
  id: string;
  target: MediaFileTarget;
  kind: MediaRefKind;
  name: string;
}

export interface MediaInputProps {
  kind: MediaGenKind;
  modes: MediaInputMode[];
  mode: MediaInputMode;
  spec: MediaModeSpec;
  /** What "Multi referências" takes: its line in the mode list says so while another mode is chosen. */
  refsSpec: MediaModeSpec;
  files: MediaFileSet;
  pending: PendingFile[];
  /** The chosen aspect ("16:9"): the frames take the video's shape. */
  aspect: string | undefined;
  /** A file is being dragged over the form. */
  over: boolean;
  onMode: (mode: MediaInputMode) => void;
  /** Files from the picker or a drop; `target` when a slot took them for itself. */
  onFiles: (files: File[], target?: MediaFileTarget) => void;
  onRemove: (target: MediaFileTarget, token: string) => void;
  onSwap: () => void;
  onReorder: (target: "images" | "videos" | "audios", from: string, to: string) => void;
  /** Opens the library for a slot, or for the references (`refs`). */
  onLibrary: (target: MediaFileTarget | "refs") => void;
}

const RATIOS: Record<string, number> = {};
const ratioOf = (aspect: string | undefined) => {
  if (!aspect) return 16 / 9;
  if (!RATIOS[aspect]) {
    const [w, h] = aspect.split(":").map(Number);
    RATIOS[aspect] = w && h ? w / h : 16 / 9;
  }
  return RATIOS[aspect] ?? 16 / 9;
};
/** Two shapes are the same within this (the Studio's tolerance). */
const RATIO_TOLERANCE = 0.04;

/** Whether a drag carries files from the computer (not a thumbnail being reordered). */
export const dragHasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** One hidden file input for the whole block: each slot opens it with its own types. */
function usePicker() {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef<(files: File[]) => void>(() => {});
  const open = (accept: string, multiple: boolean, then: (files: File[]) => void) => {
    const el = ref.current;
    if (!el) return;
    el.accept = accept;
    el.multiple = multiple;
    done.current = then;
    el.click();
  };
  const input = (
    <input
      ref={ref}
      type="file"
      hidden
      onChange={(e) => {
        const list = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (list.length) done.current(list);
      }}
    />
  );
  return { open, input };
}

/** A slot's own drop: the file is its, so the form around it doesn't take it a second time. */
function useSlotDrop(onDrop: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      },
      onDrop: (e: DragEvent) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const list = Array.from(e.dataTransfer.files);
        if (list.length) onDrop(list);
      },
    },
  };
}

export function MediaInput(props: MediaInputProps) {
  const { t, i18n } = useTranslation();
  const { kind, modes, mode, spec, refsSpec, pending, aspect, over, onMode } = props;
  const picker = usePicker();
  const counts = (s: MediaModeSpec) =>
    [
      s.images ? t("mediaGen.nImages", { count: s.images }) : null,
      s.videos ? t("mediaGen.nVideos", { count: s.videos }) : null,
      s.audios ? t("mediaGen.nAudios", { count: s.audios }) : null,
    ].filter((x): x is string => x !== null);
  const list = (items: string[]) => new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(items);
  const hint = (m: MediaInputMode) =>
    m === "references"
      ? t("mediaGen.modes.references.hint", { list: list(counts(refsSpec)) })
      : t(`mediaGen.modes.${m}.hint`);

  let body: ReactNode = null;
  if (mode === "first" || mode === "frames") {
    body = <FrameSlots {...props} pair={mode === "frames"} picker={picker} ratio={ratioOf(aspect)} />;
  } else if (spec.video) {
    body = (
      <div className="media-input__stack">
        <ClipSlot {...props} picker={picker} />
        {spec.images + spec.audios > 0 && (
          <RefGrid {...props} picker={picker} label={t("mediaGen.refsOptional")} list={list} />
        )}
      </div>
    );
  } else if (spec.images + spec.videos + spec.audios > 0) {
    body = (
      <RefGrid
        {...props}
        picker={picker}
        label={kind === "image" ? t("mediaGen.refsOptional") : t("mediaGen.refsLabel")}
        list={list}
      />
    );
  } else if (over) {
    // The prompt alone takes no file: a drop here picks the mode that does, and the block says so while it's held.
    body = (
      <div className="media-drop" data-over="">
        <Icon name="upload" size={20} />
        <span className="media-drop__title">{t("mediaGen.dropHere")}</span>
      </div>
    );
  }

  return (
    <div className="media-input" data-over={over ? "" : undefined}>
      {picker.input}
      {kind === "video" && modes.length > 1 && (
        <Field label={t("mediaGen.input")}>
          <Select
            value={mode}
            onValueChange={(v) => onMode(v as MediaInputMode)}
            options={modes.map((m) => ({ value: m, label: t(`mediaGen.modes.${m}.label`), description: hint(m) }))}
          />
        </Field>
      )}
      {body}
      {pending.length > 0 && (
        <span className="ac-visually-hidden" role="status">
          {t("mediaGen.uploading")}
        </span>
      )}
    </div>
  );
}

type Picker = ReturnType<typeof usePicker>;

// ---------- the frames ----------

function FrameSlots({
  files,
  pending,
  pair,
  ratio,
  picker,
  onFiles,
  onRemove,
  onSwap,
  onLibrary,
}: MediaInputProps & { pair: boolean; ratio: number; picker: Picker }) {
  const { t } = useTranslation();
  // Measured from the files: two frames of different shapes make the video jump at the cut.
  const [shapes, setShapes] = useState<{ first?: number; last?: number }>({});
  const firstUrl = files.firstFrame?.url;
  const lastUrl = files.lastFrame?.url;
  useEffect(() => {
    setShapes((s) => ({ first: firstUrl ? s.first : undefined, last: lastUrl ? s.last : undefined }));
  }, [firstUrl, lastUrl]);
  const mismatch =
    pair &&
    shapes.first !== undefined &&
    shapes.last !== undefined &&
    Math.abs(shapes.first - shapes.last) / Math.max(shapes.first, shapes.last) > RATIO_TOLERANCE;
  const slot = (target: "firstFrame" | "lastFrame") => (
    <FrameSlot
      title={target === "firstFrame" ? t("mediaGen.firstFrameSlot") : t("mediaGen.lastFrameSlot")}
      file={files[target]}
      busy={pending.some((p) => p.target === target)}
      onPick={() => picker.open(MEDIA_REF_ACCEPT.image, false, (list) => onFiles(list, target))}
      onDrop={(list) => onFiles(list, target)}
      onLibrary={() => onLibrary(target)}
      onRemove={(token) => onRemove(target, token)}
      onMeasure={(r) => setShapes((s) => ({ ...s, [target === "firstFrame" ? "first" : "last"]: r }))}
    />
  );
  return (
    <div className="media-frames" style={{ "--frame-ratio": ratio } as React.CSSProperties}>
      <div className="media-frames__row" data-pair={pair ? "" : undefined}>
        {slot("firstFrame")}
        {pair && (
          <>
            <button
              type="button"
              className="media-frames__swap"
              onClick={onSwap}
              disabled={!files.firstFrame && !files.lastFrame}
              aria-label={t("mediaGen.swapFrames")}
            >
              <Icon name="swap" size={16} />
            </button>
            {slot("lastFrame")}
          </>
        )}
      </div>
      {mismatch && <p className="media-input__note">{t("mediaGen.ratioMismatch")}</p>}
    </div>
  );
}

function FrameSlot({
  title,
  file,
  busy,
  onPick,
  onDrop,
  onLibrary,
  onRemove,
  onMeasure,
}: {
  title: string;
  file: MediaRefFile | undefined;
  busy: boolean;
  onPick: () => void;
  onDrop: (files: File[]) => void;
  onLibrary: () => void;
  onRemove: (token: string) => void;
  onMeasure: (ratio: number) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const drop = useSlotDrop(onDrop);
  if (file) {
    return (
      <div className="media-slot media-slot--full" data-over={drop.over ? "" : undefined} {...drop.handlers}>
        {/* The picture whole, in the video's shape: what's around it is the same picture blurred, so it fills
            without lying about the framing (the Studio's note). */}
        <img className="media-slot__blur" src={file.url} alt="" aria-hidden="true" />
        <img
          className="media-slot__img"
          src={file.url}
          alt={title}
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth && el.naturalHeight) onMeasure(el.naturalWidth / el.naturalHeight);
          }}
        />
        <span className="media-slot__tag">{drop.over ? t("mediaGen.dropHere") : title}</span>
        <RemoveButton name={file.name} onClick={() => onRemove(file.token)} />
      </div>
    );
  }
  return (
    <div className="media-slot" data-over={drop.over ? "" : undefined} aria-busy={busy || undefined} {...drop.handlers}>
      {/* Two sibling actions, never nested: the large button covers the slot, the library sits over it. */}
      <button type="button" className="media-slot__pick" aria-labelledby={titleId} onClick={onPick} disabled={busy} />
      <span className="media-slot__face">
        <Icon name={busy ? "spinner" : "image"} size={20} />
        <span className="media-slot__title" id={titleId}>
          {busy ? t("mediaGen.uploading") : drop.over ? t("mediaGen.dropHere") : title}
        </span>
        <span className="media-slot__sub">{t("mediaGen.required")}</span>
        {!busy && <LibraryLink onClick={onLibrary} />}
      </span>
    </div>
  );
}

function LibraryLink({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="media-slot__library" onClick={onClick}>
      <Icon name="grid" size={16} />
      {t("mediaGen.library")}
    </button>
  );
}

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="media-x" aria-label={t("mediaGen.removeRef", { name })} onClick={onClick}>
      <Icon name="close" size={16} />
    </button>
  );
}

// ---------- the clip (follow, edit, extend) ----------

function ClipSlot({
  mode,
  files,
  pending,
  picker,
  onFiles,
  onRemove,
  onLibrary,
}: MediaInputProps & { picker: Picker }) {
  const { t } = useTranslation();
  const titleId = useId();
  const drop = useSlotDrop((list) => onFiles(list, "video"));
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [shape, setShape] = useState(16 / 9);
  const file = files.video;
  const fileUrl = file?.url;
  useEffect(() => {
    void fileUrl;
    setShape(16 / 9);
  }, [fileUrl]);
  const title = t(`mediaGen.clip.${mode === "edit" ? "edit" : mode === "extend" ? "extend" : "follow"}`);
  const busy = pending.some((p) => p.target === "video");
  if (file) {
    return (
      <figure className="media-clip" {...drop.handlers}>
        <div
          className="media-clip__frame"
          data-over={drop.over ? "" : undefined}
          style={{ "--clip-ratio": shape } as React.CSSProperties}
        >
          <video
            ref={video}
            src={file.url}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (el.videoWidth && el.videoHeight) setShape(el.videoWidth / el.videoHeight);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          {/* A click anywhere on the clip plays or pauses it: checking the take before paying for it. */}
          <button
            type="button"
            className="media-clip__play"
            aria-label={t(playing ? "mediaGen.pause" : "mediaGen.play", { name: file.name })}
            onClick={() => {
              const el = video.current;
              if (!el) return;
              if (el.paused) void el.play();
              else el.pause();
            }}
          >
            <span className="media-clip__knob" data-playing={playing ? "" : undefined}>
              <Icon name={playing ? "pause" : "play"} size={16} />
            </span>
          </button>
          <RemoveButton name={file.name} onClick={() => onRemove("video", file.token)} />
        </div>
        <figcaption className="media-clip__caption">
          <Icon name="video" size={16} />
          <span className="media-clip__name">{file.name}</span>
          {file.seconds !== undefined && (
            <span className="media-clip__seconds">
              {t("mediaGen.secondsValue", { count: Math.round(file.seconds) })}
            </span>
          )}
        </figcaption>
      </figure>
    );
  }
  return (
    <div
      className="media-slot media-slot--clip"
      data-big={mode === "edit" ? "" : undefined}
      data-over={drop.over ? "" : undefined}
      aria-busy={busy || undefined}
      {...drop.handlers}
    >
      <button
        type="button"
        className="media-slot__pick"
        aria-labelledby={titleId}
        disabled={busy}
        onClick={() => picker.open(MEDIA_REF_ACCEPT.video, false, (list) => onFiles(list, "video"))}
      />
      <span className="media-slot__face">
        <Icon name={busy ? "spinner" : "video"} size={20} />
        <span className="media-slot__title" id={titleId}>
          {busy ? t("mediaGen.uploading") : drop.over ? t("mediaGen.dropHere") : title}
        </span>
        <span className="media-slot__sub">{t("mediaGen.clip.formats")}</span>
        {!busy && <LibraryLink onClick={() => onLibrary("video")} />}
      </span>
    </div>
  );
}

// ---------- the references ----------

const LISTS = ["images", "videos", "audios"] as const;
type ListTarget = (typeof LISTS)[number];
const LIST_KIND: Record<ListTarget, MediaRefKind> = { images: "image", videos: "video", audios: "audio" };

function RefGrid({
  spec,
  files,
  pending,
  over,
  picker,
  label,
  list,
  onFiles,
  onRemove,
  onReorder,
  onLibrary,
}: MediaInputProps & { picker: Picker; label: string; list: (items: string[]) => string }) {
  const { t } = useTranslation();
  // The thumbnail in hand lives here, not in each thumbnail: the target is another one (the Studio's note).
  const [held, setHeld] = useState<{ target: ListTarget; token: string } | null>(null);
  const titleId = useId();
  const takes = LISTS.filter((l) => spec[l] > 0);
  const items = takes.flatMap((l) => files[l].map((f) => ({ target: l, file: f })));
  const waiting = pending.filter((p) => (LISTS as readonly string[]).includes(p.target));
  const room = takes.filter((l) => files[l].length + pending.filter((p) => p.target === l).length < spec[l]);
  const accept = room.map((l) => MEDIA_REF_ACCEPT[LIST_KIND[l]]).join(",");
  const pickAll = () => picker.open(accept, true, (list) => onFiles(list));
  const pickOne = (l: ListTarget) => picker.open(MEDIA_REF_ACCEPT[LIST_KIND[l]], true, (list) => onFiles(list, l));
  const upTo = list(
    takes.map((l) =>
      t(l === "images" ? "mediaGen.nImages" : l === "videos" ? "mediaGen.nVideos" : "mediaGen.nAudios", {
        count: spec[l],
      }),
    ),
  );
  // "2 de 9 imagens": the noun follows the most it takes.
  const tally = takes.map((l) => t(`mediaGen.tally.${l}`, { n: files[l].length, count: spec[l] })).join(" · ");

  if (!items.length && !waiting.length) {
    return (
      <Field label={label} group>
        <div className="media-drop media-drop--refs" data-over={over ? "" : undefined}>
          <button type="button" className="media-slot__pick" aria-labelledby={titleId} onClick={pickAll} />
          <span className="media-slot__face">
            <span className="media-drop__plus">
              <Icon name="plus" size={20} />
            </span>
            <span className="media-drop__title" id={titleId}>
              {over ? t("mediaGen.dropHere") : t("mediaGen.refsTitle")}
            </span>
            <span className="media-slot__sub">{t("mediaGen.refsUpTo", { list: upTo })}</span>
            <LibraryLink onClick={() => onLibrary("refs")} />
          </span>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} group>
      <ul className="media-refs" data-over={over ? "" : undefined}>
        {items.map(({ target, file }) => (
          <Thumb
            key={file.token}
            target={target}
            file={file}
            many={files[target].length > 1}
            held={held}
            onHold={setHeld}
            onRemove={() => onRemove(target, file.token)}
            onReorder={(from) => onReorder(target, from, file.token)}
          />
        ))}
        {waiting.map((p) => (
          <li key={p.id} className="media-thumb media-thumb--waiting" aria-label={p.name}>
            <Icon name="spinner" size={20} />
          </li>
        ))}
        {room.length > 0 && (
          <li className="media-thumb media-thumb--add">
            <Menu
              label={t("mediaGen.addRefMenu")}
              trigger={
                <button type="button" className="media-add" aria-label={t("mediaGen.addRefMenu")}>
                  <Icon name="plus" size={20} />
                </button>
              }
            >
              {takes.map((l) => (
                <MenuItem
                  key={l}
                  icon={l === "images" ? "image" : l === "videos" ? "video" : "sound"}
                  disabled={!room.includes(l)}
                  hint={t("mediaGen.ofMax", { n: files[l].length, max: spec[l] })}
                  onSelect={() => pickOne(l)}
                >
                  {t(l === "images" ? "mediaGen.image" : l === "videos" ? "mediaGen.video" : "mediaGen.audioKind")}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem icon="grid" onSelect={() => onLibrary("refs")}>
                {t("mediaGen.library")}
              </MenuItem>
            </Menu>
          </li>
        )}
      </ul>
      <p className="media-refs__tally">{over ? t("mediaGen.dropHere") : tally}</p>
    </Field>
  );
}

function Thumb({
  target,
  file,
  many,
  held,
  onHold,
  onRemove,
  onReorder,
}: {
  target: ListTarget;
  file: MediaRefFile;
  many: boolean;
  held: { target: ListTarget; token: string } | null;
  onHold: (h: { target: ListTarget; token: string } | null) => void;
  onRemove: () => void;
  onReorder: (from: string) => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [aim, setAim] = useState(false);
  // Only a piece of the same kind reorders: the order numbers each kind on its own.
  const takesHeld = held !== null && held.target === target && held.token !== file.token;
  return (
    <li
      className="media-thumb"
      data-aim={aim ? "" : undefined}
      data-held={held?.token === file.token ? "" : undefined}
      draggable={many}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", file.name);
        onHold({ target, token: file.token });
      }}
      onDragEnd={() => {
        onHold(null);
        setAim(false);
      }}
      onDragOver={(e) => {
        if (!takesHeld) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (!aim) setAim(true);
      }}
      onDragLeave={() => setAim(false)}
      onDrop={(e) => {
        if (!takesHeld || !held) return;
        e.preventDefault();
        e.stopPropagation();
        setAim(false);
        onReorder(held.token);
        onHold(null);
      }}
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const el = video.current;
        if (!el) return;
        el.pause();
        el.currentTime = 0;
      }}
    >
      {file.kind === "image" && <img src={file.url} alt={file.name} draggable={false} />}
      {file.kind === "video" && (
        <video ref={video} src={file.url} muted loop playsInline preload="metadata" aria-label={file.name} />
      )}
      {file.kind === "audio" && (
        <span className="media-thumb__audio">
          <button
            type="button"
            className="media-thumb__play"
            aria-label={t(playing ? "mediaGen.pause" : "mediaGen.play", { name: file.name })}
            onClick={() => {
              const el = audio.current;
              if (!el) return;
              if (el.paused) void el.play().catch(() => setPlaying(false));
              else el.pause();
            }}
          >
            <Icon name={playing ? "pause" : "play"} size={16} />
          </button>
          {/* biome-ignore lint/a11y/useMediaCaption: a reference sound the person sent, nothing to caption */}
          <audio
            ref={audio}
            src={file.url}
            preload="none"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </span>
      )}
      {file.kind !== "image" && file.seconds !== undefined && (
        <span className="media-thumb__seconds">
          {file.kind === "audio" && <Icon name="sound" size={14} />}
          {t("mediaGen.secondsValue", { count: Math.round(file.seconds) })}
        </span>
      )}
      {many && (
        <span className="media-thumb__grip" aria-hidden="true">
          <Icon name="grip" size={16} />
        </span>
      )}
      <RemoveButton name={file.name} onClick={onRemove} />
    </li>
  );
}
