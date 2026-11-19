import { describe, expect, test } from "bun:test";
import { decidedBody, reviewDecisionOf } from "../src/lib/review-decision";
import { reviewWords } from "../src/video-reviews/words";

const OLD = [
  "@rosa Aprovado: «Fontes · Capa do reel» V1 (review_id 0bea4648-368d-4a61-843a-b6c8483b5f23).",
  "",
  "HTML desta versão: artifact_id a1.",
  "",
  "Ficou ótimo.",
  "",
  "Antes de entregar: rode a skill self-improve-skill (se você tiver) e grave na sua skill e na sua memória o que funcionou nesta peça.",
  "",
  "Notas:",
  "- [lâmina 2] Texto/legenda: maior [na lâmina: 62% da largura, 30% da altura] (Leticia)",
  "  - Anexo (imagem): ref.png — traga com import_file artifact_id a2 e use neste ponto como a nota pede",
].join("\n");

describe("reviewDecisionOf", () => {
  test("reads a new decision from meta, the body untouched", () => {
    const d = reviewDecisionOf("anything for the agent", {
      videoReview: { id: "r1", decision: "approve", version: 2, title: "Capa", handle: "rosa", said: "Boa" },
    });
    expect(d).toEqual({ id: "r1", decision: "approve", title: "Capa", version: 2, handle: "rosa", said: "Boa" });
  });

  test("an older body keeps the decision and the person's words, never the agent's instructions", () => {
    const d = reviewDecisionOf(OLD, { videoReview: { id: "r1", decision: "approve", version: 1 } });
    expect(d?.title).toBe("Fontes · Capa do reel");
    expect(d?.handle).toBe("rosa");
    expect(d?.said).toBe("Ficou ótimo.\n\n- [lâmina 2] Texto/legenda: maior (Leticia)\n  - Anexo (imagem): ref.png");
  });

  test("an older request for changes drops the line to the agent", () => {
    const body = "@rosa Ajustes em «Capa» V3 (review_id r1). Faça a V4 e mande com send_for_review e esse review_id.";
    const d = reviewDecisionOf(body, { videoReview: { id: "r1", decision: "changes", version: 3 } });
    expect(d).toMatchObject({ decision: "changes", title: "Capa", version: 3, said: "" });
  });

  test("a delivery or a plain message is no decision", () => {
    expect(reviewDecisionOf("x", { videoReview: { id: "r1", decision: "delivered" } })).toBeNull();
    expect(reviewDecisionOf("x", {})).toBeNull();
  });

  test("the phone's text", () => {
    const d = reviewDecisionOf("", {
      videoReview: { id: "r1", decision: "approve", version: 1, title: "A*B", handle: "rosa", said: "" },
    });
    expect(d && decidedBody(d, reviewWords("pt-BR"))).toBe("@rosa Aprovado: **A\\*B** V1");
  });
});
