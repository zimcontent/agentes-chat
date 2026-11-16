/**
 * How the copies of one agent across workspaces keep one text of instructions (ADR doug-0013 §3): line by line, in code,
 * never by a model. Nothing a person or the agent wrote in one copy is lost in another: when two copies changed the
 * same text, the newer one is the base and the other's own changes are applied to it.
 */
import { similarity } from "./context/items";

export interface TextVersion {
  text: string;
  /** When that copy last changed (ms): the newer wins where two say the same thing differently. */
  at: number;
}

/** A line this close to one already there is the same rule reworded: on a first join the newer wording stays alone. */
export const REWORDED = 0.5;

const keyOf = (line: string) => line.trim();

/**
 * Puts `line` (the `index`th of `from`) into `out` right after the nearest line before it in `from` that `out` also
 * has, so a rule lands in its section; with none, where it was (the top) or at the end.
 */
function insertAnchored(out: string[], from: string[], index: number, line: string) {
  for (let i = index - 1; i >= 0; i--) {
    const anchor = keyOf(from[i] ?? "");
    if (!anchor) continue;
    const at = lastIndexOf(out, anchor);
    if (at >= 0) {
      out.splice(at + 1, 0, line);
      return;
    }
  }
  if (index === 0) out.unshift(line);
  else out.push(line);
}

function lastIndexOf(lines: string[], key: string) {
  for (let i = lines.length - 1; i >= 0; i--) if (keyOf(lines[i] ?? "") === key) return i;
  return -1;
}

const newestFirst = (versions: TextVersion[]) => [...versions].sort((a, b) => b.at - a.at);

/**
 * The first time copies are joined (nothing in common is known yet): the newest text, plus every line of the others
 * that says something it doesn't. A line close to one it has is the same rule in an older wording and stays out.
 */
export function joinInstructions(versions: TextVersion[]): string {
  const [newest, ...rest] = newestFirst(versions);
  if (!newest) return "";
  const out = newest.text.split("\n");
  for (const v of rest) {
    const lines = v.text.split("\n");
    lines.forEach((line, i) => {
      const key = keyOf(line);
      if (!key) return;
      if (out.some((l) => keyOf(l) === key)) return;
      if (out.some((l) => keyOf(l) !== "" && similarity(l, line) >= REWORDED)) return;
      insertAnchored(out, lines, i, line);
    });
  }
  return out.join("\n");
}

/**
 * Copies that held `base` at the last sync, some changed since: one change is everyone's; several are applied
 * together (the newest as it is, each other one's added and removed lines on top of it). Two copies that changed the
 * same line keep both wordings rather than lose one.
 */
export function mergeInstructions(base: string, versions: TextVersion[]): string {
  const changed = versions.filter((v) => v.text !== base);
  if (changed.length === 0) return base;
  const distinct = [...new Set(changed.map((v) => v.text))];
  if (distinct.length === 1) return distinct[0] as string;
  const [newest, ...rest] = newestFirst(changed);
  if (!newest) return base;
  const baseLines = base.split("\n");
  const inBase = new Set(baseLines.map(keyOf));
  const out = newest.text.split("\n");
  for (const v of rest) {
    const lines = v.text.split("\n");
    const own = new Set(lines.map(keyOf));
    for (const line of baseLines) {
      const key = keyOf(line);
      if (!key || own.has(key)) continue;
      const at = out.findIndex((l) => keyOf(l) === key);
      if (at >= 0) out.splice(at, 1);
    }
    lines.forEach((line, i) => {
      const key = keyOf(line);
      if (!key || inBase.has(key) || out.some((l) => keyOf(l) === key)) return;
      insertAnchored(out, lines, i, line);
    });
  }
  return out.join("\n");
}
