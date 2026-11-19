import type { Artifact, ArtifactContent } from "@dougbot/client";
import { documentPreview, parsePatch } from "@dougbot/client/lib/artifacts";
import { fileIcon, previewKind } from "@dougbot/client/lib/files";
import { daysBetween } from "@dougbot/client/lib/format";

/**
 * The Drive on the phone: the type chips, the sections by day
 * (Hoje, Esta semana, then by month) and what each card's real preview shows. Pure: the screen draws it.
 */

export type DriveType = "all" | "documents" | "images" | "tables" | "diffs";
export const DRIVE_TYPES: DriveType[] = ["all", "documents", "images", "tables", "diffs"];

/** What a card shows before (or without) its content: by kind, uploaded files by their name. */
export type CardShape = "document" | "table" | "diff" | "image" | "file";

export function cardShape(a: Pick<Artifact, "kind" | "title">): CardShape {
  switch (a.kind) {
    case "document":
      return "document";
    case "table":
      return "table";
    case "diff":
      return "diff";
    case "file":
      return fileIcon(a.title) === "image" ? "image" : "file";
    default:
      // Diagrams and HTML pages: a file tile.
      return "file";
  }
}

export function matchesType(a: Pick<Artifact, "kind" | "title">, type: DriveType): boolean {
  if (type === "all") return true;
  const icon = a.kind === "file" ? fileIcon(a.title) : null;
  switch (type) {
    case "documents":
      return a.kind === "document" || icon === "document";
    case "images":
      return icon === "image";
    case "tables":
      return a.kind === "table" || icon === "table";
    case "diffs":
      return a.kind === "diff";
  }
}

export type DriveSectionKey = { kind: "today" } | { kind: "week" } | { kind: "month"; year: number; month: number };

export interface DriveDaySection {
  /** Stable key: "today", "week", "2026-09". */
  key: string;
  label: DriveSectionKey;
  items: Artifact[];
}

/**
 * By the last update, newest first: "Hoje", "Esta semana" (the last 7 days), then one section per month.
 */
export function driveSections(list: Artifact[], now = new Date()): DriveDaySection[] {
  const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const out: DriveDaySection[] = [];
  for (const a of sorted) {
    const days = daysBetween(a.updatedAt, now);
    let key: string;
    let label: DriveSectionKey;
    if (days <= 0) {
      key = "today";
      label = { kind: "today" };
    } else if (days < 7) {
      key = "week";
      label = { kind: "week" };
    } else {
      const d = new Date(a.updatedAt);
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = { kind: "month", year: d.getFullYear(), month: d.getMonth() };
    }
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(a);
    else out.push({ key, label, items: [a] });
  }
  return out;
}

/** The 2-column grid's rows. */
export function gridRows<T>(items: T[], columns = 2): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

export const DOC_LINES = 4;
export const TABLE_ROWS = 4;
export const TABLE_COLS = 3;
export const DIFF_LINES = 6;

export type CardPreview =
  | { kind: "document"; head: string; lines: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "diff"; lines: { kind: "add" | "del" | "same"; text: string }[] }
  | { kind: "image" }
  | { kind: "file"; ext: string };

const extOf = (name: string) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? "").slice(0, 4).toUpperCase();

/** What a card draws from the item's content (at its version). `title` is the fallback heading. */
export function cardPreview(title: string, content: ArtifactContent): CardPreview {
  switch (content.kind) {
    case "document": {
      const [head, ...lines] = documentPreview(content.markdown, DOC_LINES + 1);
      return { kind: "document", head: head ?? title, lines };
    }
    case "table": {
      const columns = content.columns.slice(0, TABLE_COLS);
      return {
        kind: "table",
        columns,
        rows: content.rows.slice(0, TABLE_ROWS).map((r) => columns.map((_, j) => r[j] ?? "")),
      };
    }
    case "diff": {
      const lines: { kind: "add" | "del" | "same"; text: string }[] = [];
      for (const f of content.files) {
        for (const l of parsePatch(f.patch)) {
          if (l.kind === "hunk") continue;
          // The changed lines tell the story; context only between them.
          if (l.kind === "same" && lines.length === 0) continue;
          lines.push({ kind: l.kind, text: l.text });
          if (lines.length === DIFF_LINES) return { kind: "diff", lines };
        }
      }
      return { kind: "diff", lines };
    }
    case "file":
      return previewKind(content.contentType) === "image"
        ? { kind: "image" }
        : { kind: "file", ext: extOf(content.name) || extOf(title) || "FILE" };
    case "diagram":
      return { kind: "file", ext: "MMD" };
    case "html":
    case "block":
      return { kind: "file", ext: "HTML" };
    case "poll":
    case "choices":
      return { kind: "file", ext: "POLL" };
  }
}

/** The kind chip on the preview: `mobile.drive.kind.<key>`. */
export function kindKey(a: Pick<Artifact, "kind" | "title">): "document" | "table" | "diff" | "image" | "file" {
  const shape = cardShape(a);
  if (shape !== "file") return shape;
  return a.kind === "file" && fileIcon(a.title) === "document" ? "document" : "file";
}

// ── The list (the files screen as people know it from the phone's file apps) ──────────────────────────────────

/** A row's type mark: its tile's color and glyph (a text, a table, slides, a PDF, a picture…). */
export type FileMark = "doc" | "sheet" | "slide" | "pdf" | "image" | "video" | "code" | "zip" | "file";

/** What a row's tile shows, from the item's kind and, for an uploaded file, its name. */
export function fileMark(a: Pick<Artifact, "kind" | "title">): FileMark {
  switch (a.kind) {
    case "document":
      return "doc";
    case "table":
      return "sheet";
    case "diff":
      return "code";
    case "diagram":
    case "html":
      return "slide";
    case "file":
      break;
    default:
      return "file";
  }
  if (/\.pdf$/i.test(a.title)) return "pdf";
  if (/\.(ppt|pptx|key|odp)$/i.test(a.title)) return "slide";
  switch (fileIcon(a.title)) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "document":
      return "doc";
    case "table":
      return "sheet";
    case "code":
      return "code";
    case "page":
      return "slide";
    case "archive":
      return "zip";
    default:
      return "file";
  }
}

/** How long back "Modificado" reaches. */
export type DriveWhen = "any" | "today" | "week" | "month" | "year";
export const DRIVE_WHENS: DriveWhen[] = ["any", "today", "week", "month", "year"];

/** Whether an update falls in the "Modificado" range (the last 7 or 30 days; this year by the calendar). */
export function changedWithin(iso: string, when: DriveWhen, now = new Date()): boolean {
  if (when === "any") return true;
  const days = daysBetween(iso, now);
  if (when === "today") return days <= 0;
  if (when === "week") return days < 7;
  if (when === "month") return days < 30;
  return new Date(iso).getFullYear() === now.getFullYear();
}

/** A row's line: who made the last change and how ("editou", "enviou", "criou"), as an i18n key. */
export function changeKey(a: Pick<Artifact, "kind" | "version">): "edited" | "sent" | "made" {
  if (a.version > 1) return "edited";
  return a.kind === "file" ? "sent" : "made";
}

/** A conversation that holds files, as a folder: its name, the newest change and who made it. */
export interface DriveFolder {
  /** The conversation's id (the files' `channelId`). */
  id: string;
  /** A channel's name; a DM's other side, for the screen to name. */
  name: string | null;
  dmWith: Artifact["createdBy"] | null;
  count: number;
  updatedAt: string;
  updatedBy: Artifact["updatedBy"];
}

/**
 * The folders of the top level: one per conversation the files came from, newest change first. Files outside any
 * conversation, and those shared from one I can't open (`outside`, `between`), stay loose in the list.
 */
export function driveFolders(list: readonly Artifact[]): DriveFolder[] {
  const byId = new Map<string, DriveFolder>();
  for (const a of list) {
    if (!a.channelId) continue;
    const au = a.audience;
    if (au.kind === "workspace") continue;
    if (au.kind === "channel" && au.outside) continue;
    if (au.kind === "dm" && (au.between || au.gone)) continue;
    const had = byId.get(a.channelId);
    if (had) {
      had.count += 1;
      if (a.updatedAt > had.updatedAt) {
        had.updatedAt = a.updatedAt;
        had.updatedBy = a.updatedBy;
      }
      continue;
    }
    byId.set(a.channelId, {
      id: a.channelId,
      name: au.kind === "channel" ? au.name : null,
      dmWith: au.kind === "dm" ? au.with : null,
      count: 1,
      updatedAt: a.updatedAt,
      updatedBy: a.updatedBy,
    });
  }
  return [...byId.values()].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
}

/** "Nome ↑", "Nome ↓" or the newest first. */
export type DriveOrder = "recent" | "name" | "nameDesc";

/** The rows in the chosen order (names by the person's language, accents aside). */
export function orderFiles<T extends { title?: string; name?: string | null; updatedAt: string }>(
  list: readonly T[],
  order: DriveOrder,
  locale: string,
  nameOf: (x: T) => string = (x) => x.title ?? x.name ?? "",
): T[] {
  const out = [...list];
  if (order === "recent") return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const cmp = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  out.sort((a, b) => cmp.compare(nameOf(a), nameOf(b)));
  return order === "nameDesc" ? out.reverse() : out;
}

/** "Sugeridos": the two files changed last, with a picture to show. */
export function suggestedFiles(list: readonly Artifact[], count = 2): Artifact[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, count);
}
