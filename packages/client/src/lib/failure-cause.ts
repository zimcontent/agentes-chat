/**
 * Why an action failed, read from what its tool said, for a screen that tells the person what to do next instead of
 * showing those words: the connection needs signing in again, the account may not do this, the service is out, or it
 * asked too much too fast. Null when the words name none of these.
 */
export type FailureCause = "reconnect" | "permission" | "unavailable" | "limit";

const CAUSES: [FailureCause, RegExp][] = [
  [
    "reconnect",
    /\b401\b|unauthori[sz]ed|unauthenticated|invalid[_ ]?(grant|token|credentials|api[_ ]?key)|expired[_ ]?token|token[^.]{0,20}expired|needs?[_ ]reconnect|re-?authenticat|sign in again|login required/i,
  ],
  [
    "permission",
    /\b403\b|forbidden|permission denied|not (allowed|permitted|authori[sz]ed)|insufficient (scope|permission)|access denied/i,
  ],
  ["limit", /\b429\b|rate[ -]?limit|too many requests|quota/i],
  [
    "unavailable",
    /\b50[0234]\b|timed? ?out|timeout|ECONNRE|ENOTFOUND|EAI_AGAIN|network error|service unavailable|bad gateway|temporarily unavailable|fetch failed/i,
  ],
];

export function failureCause(text: string | null | undefined): FailureCause | null {
  if (!text) return null;
  return CAUSES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
