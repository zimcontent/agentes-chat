import { describe, expect, test } from "bun:test";
import { PROOF_SHOWN, proofLine, proofOf } from "../src/lib/proof";

/** Proof on delivery (docs/adr/doug-0040-proof-on-delivery.md): the line under an agent's reply. */
describe("proofOf", () => {
  test("reads each kind, checked", () => {
    expect(
      proofOf({
        proof: [
          { kind: "file", label: "relatorio.pdf", ref: "a1" },
          { kind: "image", label: "", ref: "a2" },
          { kind: "task", label: "#42", ref: "42" },
          { kind: "link", label: "github.com/acme/app/issues/7", ref: "https://github.com/acme/app/issues/7" },
          { kind: "action", label: "ana@acme.com" },
        ],
      }),
    ).toEqual([
      { kind: "file", label: "relatorio.pdf", ref: "a1" },
      { kind: "image", label: "", ref: "a2" },
      { kind: "task", label: "#42", ref: "42" },
      { kind: "link", label: "github.com/acme/app/issues/7", ref: "https://github.com/acme/app/issues/7" },
      { kind: "action", label: "ana@acme.com", ref: null },
    ]);
  });

  test("drops what can't open safely and what the message already shows", () => {
    expect(
      proofOf({
        proof: [
          { kind: "link", label: "x", ref: "javascript:alert(1)" },
          { kind: "link", label: "x", ref: "http://acme.com" },
          { kind: "task", label: "#x", ref: "abc" },
          { kind: "file", label: "sem ref" },
          { kind: "action", label: "" },
          { kind: "spell", label: "?", ref: "1" },
          "texto",
          // Its card is right above the line, and so is the task's chip.
          { kind: "file", label: "Roteiro", ref: "a9" },
          { kind: "task", label: "#131", ref: "131" },
        ],
        artifacts: [{ id: "a9", version: 1, title: "Roteiro" }],
        tasks: [{ issueId: "i", number: 131 }],
      }),
    ).toEqual([]);
    expect(proofOf(undefined)).toEqual([]);
    expect(proofOf({ proof: "nada" })).toEqual([]);
  });
});

describe("proofLine", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ kind: "action" as const, label: `p${i}`, ref: null }));
  test("the first few, then +N; all once opened", () => {
    expect(proofLine(items.slice(0, PROOF_SHOWN))).toEqual({ shown: items.slice(0, PROOF_SHOWN), more: 0 });
    expect(proofLine(items)).toEqual({ shown: items.slice(0, PROOF_SHOWN), more: 5 - PROOF_SHOWN });
    expect(proofLine(items, true)).toEqual({ shown: items, more: 0 });
  });
});
