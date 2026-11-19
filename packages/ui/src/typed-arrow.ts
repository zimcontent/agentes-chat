/**
 * Doug: "->" typed in the composer becomes "→" as the ">" lands, the way a writing app does it.
 * Only for a keystroke at the caret (never a paste or a whole new value), and never inside code:
 * an inline `code span` or a ``` fence keeps its "->" as typed.
 */
import type { TextEdit } from "./format";

/** Is `index` inside an open ``` fence or an open `code span` of `text` (up to that point)? */
function insideCode(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const fences = before.match(/```/g)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart).replaceAll("```", "");
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}

/**
 * The arrow edit for a keystroke, or null: `prev` is the text before the change, `next` after it, `caret` where the
 * caret is now. Fires only when exactly one ">" was typed right after a "-" (not "-->", not "<->").
 */
export function typedArrow(prev: string, next: string, caret: number): TextEdit | null {
  if (next.length !== prev.length + 1) return null;
  if (caret < 2 || next[caret - 1] !== ">" || next[caret - 2] !== "-") return null;
  // The one character typed is that ">": the rest of the text is unchanged around it.
  if (next.slice(0, caret - 1) + next.slice(caret) !== prev) return null;
  const before = next[caret - 3];
  if (before === "-" || before === "<") return null;
  if (insideCode(next, caret - 2)) return null;
  const value = `${next.slice(0, caret - 2)}→${next.slice(caret)}`;
  return { value, start: caret - 1, end: caret - 1 };
}
