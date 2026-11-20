/**
 * Proof on delivery (docs/adr/doug-0040-proof-on-delivery.md): what an agent's run really delivered, as its reply
 * carries it (`meta.proof`), read by the server from its steps: files, screenshots, tasks, pages and outside actions.
 * The apps draw it as one quiet line of chips under the reply.
 */

export type ProofKind = "file" | "image" | "task" | "link" | "action";

export interface ProofItem {
  kind: ProofKind;
  /** A file's title, a task's `#N`, a page's address without the scheme, an action's target; "" for a screenshot. */
  label: string;
  /** What it opens: a file's id, a task's number, a page's https address; null for an action. */
  ref: string | null;
}

const KINDS: readonly ProofKind[] = ["file", "image", "task", "link", "action"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * The proof on a message, checked: a page only over https, a task only by a number. What the message already shows
 * above the line is left out: the line never says it twice.
 */
export function proofOf(meta: unknown): ProofItem[] {
  const list = isObject(meta) && Array.isArray(meta.proof) ? meta.proof : [];
  const listed = (key: string, field: string) =>
    new Set(
      isObject(meta) && Array.isArray(meta[key])
        ? (meta[key] as unknown[]).flatMap((a) =>
            isObject(a) && (typeof a[field] === "string" || typeof a[field] === "number") ? [String(a[field])] : [],
          )
        : [],
    );
  // Files shown as cards (`meta.artifacts`) and tasks shown as chips (`meta.tasks`) are right above the line.
  const carded = listed("artifacts", "id");
  const chipped = listed("tasks", "number");
  return list.flatMap((raw): ProofItem[] => {
    if (!isObject(raw) || !KINDS.includes(raw.kind as ProofKind)) return [];
    const kind = raw.kind as ProofKind;
    const label = typeof raw.label === "string" ? raw.label : "";
    const ref = typeof raw.ref === "string" && raw.ref ? raw.ref : null;
    if (kind === "file" || kind === "image") return ref && !carded.has(ref) ? [{ kind, label, ref }] : [];
    if (kind === "task")
      return ref && /^\d+$/.test(ref) && !chipped.has(ref) ? [{ kind, label: label || `#${ref}`, ref }] : [];
    if (kind === "link") return ref?.startsWith("https://") ? [{ kind, label: label || ref.slice(8), ref }] : [];
    return label ? [{ kind, label, ref: null }] : [];
  });
}

/** How many chips the line shows before "+N" (one line at a phone's width). */
export const PROOF_SHOWN = 3;

/** The chips shown and how many wait behind "+N" (all of them once opened). */
export function proofLine(items: ProofItem[], open = false): { shown: ProofItem[]; more: number } {
  if (open || items.length <= PROOF_SHOWN) return { shown: items, more: 0 };
  return { shown: items.slice(0, PROOF_SHOWN), more: items.length - PROOF_SHOWN };
}
