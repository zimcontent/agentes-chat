/**
 * A person's decision on a piece in review (docs/adr/doug-0007-video-review.md), as people read it. The message's body
 * is written for the agent (the review's id, the tools to use, the skill to run before delivering); in the simple style
 * the apps show only the decision, the piece's title, and what the person wrote, with the id behind a small "i". The
 * technical style shows the body as it is.
 */
export interface ReviewDecisionView {
  id: string;
  decision: "approve" | "changes";
  title: string;
  version: number;
  /** The agent it was sent to (the head's @mention). */
  handle: string;
  /** What the person wrote and the notes, as Markdown; empty when there was nothing. */
  said: string;
}

type Meta = Record<string, unknown> | null | undefined;

/** The head the server wrote before `meta.videoReview` carried the title. */
const HEAD = /^@([\w.-]+) (?:Aprovado: «(.+)» V(\d+)|Ajustes em «(.+)» V(\d+)) \(review_id [^)]+\)\.?/;

/** Paragraphs of an older body that only the agent reads. */
const AGENT_ONLY = [
  /^HTML desta versão:/,
  /^Antes de entregar:/,
  /^Antes da próxima versão:/,
  /^O DougBot já está subindo/,
  /^Esta versão não tem as lâminas/,
  /import_file artifact_id/,
];

/** An older body's notes, without what tells the agent where to fetch each attachment or where it is on the picture. */
function cleanOlderNotes(paragraph: string): string {
  return paragraph
    .split("\n")
    .filter((line) => line.trim() !== "Notas:")
    .map((line) =>
      line
        .replace(/ \[na (?:tela|lâmina): \d+% da largura, \d+% da altura\]/g, "")
        .replace(/ — traga com import_file artifact_id \S+ e use neste ponto como a nota pede$/, "")
        .replace(/ — baixe e use neste ponto como a nota pede$/, ""),
    )
    .join("\n");
}

/** The decision a message carries, or null for any other message (and for a delivery, which has no head). */
export function reviewDecisionOf(body: string, meta: Meta): ReviewDecisionView | null {
  const review = meta?.videoReview as
    | { id?: unknown; decision?: unknown; version?: unknown; title?: unknown; handle?: unknown; said?: unknown }
    | undefined;
  if (!review || typeof review.id !== "string") return null;
  if (review.decision !== "approve" && review.decision !== "changes") return null;
  const decision = review.decision;
  if (typeof review.title === "string" && typeof review.handle === "string") {
    return {
      id: review.id,
      decision,
      title: review.title,
      version: typeof review.version === "number" ? review.version : 0,
      handle: review.handle,
      said: typeof review.said === "string" ? review.said : "",
    };
  }
  // Sent before the title was in `meta`: read from the body, dropping what only the agent reads.
  const head = HEAD.exec(body);
  if (!head) return null;
  const rest = body
    .slice(head[0].length)
    .replace(/^ Faça a V\d+ e mande com \S+ e esse review_id\./, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .map((p) => (p.startsWith("Notas:") ? cleanOlderNotes(p) : p))
    .filter((p) => p && !AGENT_ONLY.some((re) => re.test(p)));
  return {
    id: review.id,
    decision,
    title: head[2] ?? head[4] ?? "",
    version: Number(head[3] ?? head[5] ?? review.version ?? 0),
    handle: head[1] ?? "",
    said: rest.join("\n\n"),
  };
}

/** The decision as one Markdown text, where the head can't be drawn on its own (the phone's bubble). */
export function decidedBody(
  decision: ReviewDecisionView,
  w: { decided: { approve: string; changes: string }; version: (n: number) => string },
): string {
  const word = decision.decision === "approve" ? w.decided.approve : w.decided.changes;
  const who = decision.handle ? `@${decision.handle} ` : "";
  const head = `${who}${word} **${decision.title.replace(/([*_`[\]\\])/g, "\\$1")}** ${w.version(decision.version)}`;
  return decision.said ? `${head}\n\n${decision.said}` : head;
}
