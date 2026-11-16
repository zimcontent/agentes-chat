import type { ReviewWho } from "@agenteschat/client";

/*
 * Revisão by who made the work, on the phone (docs/adr/doug-0015-team-work-review.md): the row of filters under the
 * tabs, and the rules of "Mandar para revisão" (which files go, under what name, where). Pure rules: no React here.
 * The tabs themselves are the shared ones (`reviewTabsByWho`, `filterReviews` in `@agenteschat/client`).
 */

/** What the row of filters holds besides the tab: whose work (Equipe), which kind, and open or all. */
export interface RowState {
  /** Equipe: one person's work, or everyone's (null). */
  person: string | null;
  medium: "all" | "video" | "design";
  status: "open" | "all";
}

export interface RowWords {
  everyone: string;
  video: string;
  design: string;
  /** "Para revisar"; on Meus ajustes, the changes to make. */
  open: string;
  all: string;
}

export interface RowItem {
  key: string;
  label: string;
  count?: number;
  divider?: boolean;
}

/** A person's first name, as the row's pills say it. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The one sideways row under the tabs: on Equipe the people (Todos, then each by first name with what waits on
 * them), Vídeos and Peças where the tab holds both (a second tap goes back to both), then Para revisar or Todos.
 * `value` holds the chosen pill of each group.
 */
export function filterRow(
  input: {
    who: ReviewWho;
    people: readonly { id: string; name: string; waiting: number }[];
    mixed: boolean;
    /** How many the tab's "open" holds (with the person and kind chosen). */
    open: number;
  } & RowState,
  words: RowWords,
): { items: RowItem[]; value: string[] } {
  const items: RowItem[] = [];
  const value: string[] = [];
  const count = (n: number) => (n > 0 ? { count: n } : {});
  if (input.who === "team" && input.people.length > 0) {
    items.push({ key: "person:all", label: words.everyone });
    for (const p of input.people) items.push({ key: `person:${p.id}`, label: firstName(p.name), ...count(p.waiting) });
    value.push(`person:${input.people.some((p) => p.id === input.person) ? input.person : "all"}`);
  }
  if (input.mixed) {
    items.push({ key: "medium:video", label: words.video, divider: items.length > 0 });
    items.push({ key: "medium:design", label: words.design });
    if (input.medium !== "all") value.push(`medium:${input.medium}`);
  }
  items.push({ key: "status:open", label: words.open, ...count(input.open), divider: items.length > 0 });
  items.push({ key: "status:all", label: words.all });
  value.push(`status:${input.status}`);
  return { items, value };
}

/** The row's state after a pill is tapped. A kind tapped again goes back to both kinds. */
export function pickInRow(state: RowState, key: string): RowState {
  const [group, rest = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (group === "person") return { ...state, person: rest === "all" ? null : rest };
  if (group === "medium" && (rest === "video" || rest === "design"))
    return { ...state, medium: state.medium === rest ? "all" : rest };
  if (group === "status" && (rest === "open" || rest === "all")) return { ...state, status: rest };
  return state;
}

// ── Mandar para revisão ──

/** Up to 2 GB a file, as any upload (the server's limit). */
export const MAX_WORK_BYTES = 2 * 1024 * 1024 * 1024;
/** At most 60 slides a piece (the server's `DESIGN_PAGES`). */
export const MAX_SLIDES = 60;

/** The video files the server takes (its `VIDEO` rule) and the pictures the words name (PNG, JPG or WebP). */
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const PICTURE_EXT = /\.(png|jpe?g|webp)$/i;
const KNOWN_EXT = /\.(mp4|m4v|mov|webm|mkv|png|jpe?g|webp|heic|heif|gif|avif)$/i;

const EXT_OF_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const TYPE_OF_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mkv: "video/x-matroska",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** A file picked on the phone, as it will be sent. */
export interface PickedFile {
  uri: string;
  /** The name it is uploaded under: the server tells a video or a picture by it. */
  name: string;
  type: string;
  /** Bytes, when the picker said. */
  size: number | null;
}

const lastSegment = (path: string) => decodeURIComponent(path.split(/[?#]/)[0]?.split("/").pop() ?? "");
const extOf = (name: string) => (KNOWN_EXT.exec(name)?.[1] ?? "").toLowerCase();

/**
 * The file a picker gave, under a name whose ending is what the file is. The library names a photo after the
 * original (`IMG_1.HEIC`) while it hands over a JPEG copy (`…/ABC.jpg`): the copy's own ending wins, then its type,
 * then the original name's.
 */
export function pickedFile(
  asset: { uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number | null },
  fallback: string,
): PickedFile {
  const own = lastSegment(asset.uri);
  const ext = extOf(own) || EXT_OF_TYPE[asset.mimeType ?? ""] || extOf(asset.fileName ?? "");
  const base = (asset.fileName?.trim() || own).replace(/\.[^.]+$/, "") || fallback;
  const name = ext ? `${base}.${ext}` : base;
  const type = TYPE_OF_EXT[ext] ?? asset.mimeType ?? "application/octet-stream";
  return { uri: asset.uri, name, type, size: asset.fileSize ?? null };
}

export interface CheckWords {
  notVideo: string;
  notPicture: (name: string) => string;
  tooMany: string;
  tooBig: (name: string) => string;
}

/** Why these files can't go as this kind of work, before anything is uploaded; null when they can. */
export function checkWork(medium: "video" | "design", files: readonly PickedFile[], w: CheckWords): string | null {
  if (medium === "design" && files.length > MAX_SLIDES) return w.tooMany;
  for (const f of files) {
    if (medium === "video" && !VIDEO_EXT.test(f.name)) return w.notVideo;
    if (medium === "design" && !PICTURE_EXT.test(f.name)) return w.notPicture(f.name);
    if (f.size !== null && f.size > MAX_WORK_BYTES) return w.tooBig(f.name);
  }
  return null;
}

/** A share sent, as the words' whole percent. */
export const percent = (sent: number) => Math.max(0, Math.min(100, Math.round(sent * 100)));

/** The groups work can go to: the ones the person is in and may write in (not ones listed only to an admin). */
export const sendableGroups = <C extends { isMember: boolean; seenAsAdmin?: boolean; can?: { post: boolean } }>(
  channels: readonly C[],
) => channels.filter((c) => c.isMember && !c.seenAsAdmin && c.can?.post !== false);

/** The tasks work can be for: the open ones. */
export const sendableTasks = <T extends { status: string }>(tasks: readonly T[]) =>
  tasks.filter((t) => t.status !== "done" && t.status !== "canceled");

/** Whether the form can send: files, and a title unless it goes to a task (it takes the task's) or is a next version. */
export function workReady(input: {
  files: number;
  next: boolean;
  title: string;
  where: "group" | "task";
  place: string | null;
}): boolean {
  if (input.files === 0) return false;
  if (input.next) return true;
  if (!input.place) return false;
  return input.where === "task" || input.title.trim().length > 0;
}
