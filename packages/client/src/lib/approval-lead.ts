import type { Approval } from "../api/types";
import { approvalWords } from "./approval-origin";

/** A lead longer than this is a paragraph, not a title. */
const LEAD_MAX = 90;
const LEAD_MIN = 12;

/**
 * What the action will do, in the agent's own words, as a title: the first sentence of its `why` (the gateway asks
 * for one that says it plainly, `WHY_PROPERTY`), and the rest as the reason. Null when the why doesn't open with a
 * short sentence (an older request, a long first line) or carries code: the screen keeps the tool's title then.
 */
export function approvalLead(a: Pick<Approval, "why">): { title: string; rest: string | null } | null {
  const words = approvalWords(a);
  if (!words) return null;
  const first = /^(.+?[.!?])(?:\s+|$)/.exec(words)?.[1] ?? words;
  const title = first.replace(/[.!?]+$/, "").trim();
  if (title.length < LEAD_MIN || title.length > LEAD_MAX || /[`{}<>]|https?:/.test(title)) return null;
  const rest = words.slice(first.length).trim();
  return { title, rest: rest || null };
}
