import { describe, expect, test } from "bun:test";
import { approvalLead } from "../src/lib/approval-lead";
import { failureCause } from "../src/lib/failure-cause";
import { simpleScreens } from "../src/lib/simple-mode";

describe("simple screens", () => {
  test("simple unless the person picked technical, an older server's missing choice included", () => {
    expect(simpleScreens({ agentStyle: "simple" })).toBe(true);
    expect(simpleScreens({ agentStyle: null })).toBe(true);
    expect(simpleScreens({})).toBe(true);
    expect(simpleScreens({ agentStyle: "technical" })).toBe(false);
  });

  test("a why that opens with a short sentence gives the title and leaves the rest as the reason", () => {
    expect(
      approvalLead({ why: "Somar os pagamentos de ontem no Mercado Pago. O relatório da manhã precisa do total." }),
    ).toEqual({
      title: "Somar os pagamentos de ontem no Mercado Pago",
      rest: "O relatório da manhã precisa do total.",
    });
    // One sentence alone is the title, with no reason left.
    expect(approvalLead({ why: "Publicar o post de hoje no Instagram." })).toEqual({
      title: "Publicar o post de hoje no Instagram",
      rest: null,
    });
  });

  test("no title from a long opening, code, an address or nothing", () => {
    const long = `${"Preciso consultar todos os pagamentos aprovados e recusados do mês inteiro ".repeat(2)}agora. Depois somo.`;
    expect(approvalLead({ why: long })).toBeNull();
    expect(approvalLead({ why: "Rodar `bun test` antes do merge. Falta aprovar." })).toBeNull();
    expect(approvalLead({ why: "Abrir https://example.com/x agora. Preciso do total." })).toBeNull();
    expect(approvalLead({ why: "Ok. Vai." })).toBeNull();
    expect(approvalLead({ why: null })).toBeNull();
  });

  test("what a tool said names why it failed, or nothing", () => {
    expect(failureCause("HTTP 401 unauthorized")).toBe("reconnect");
    expect(failureCause('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}')).toBe(
      "reconnect",
    );
    expect(failureCause("403 Forbidden: insufficient scope")).toBe("permission");
    expect(failureCause("429 Too Many Requests")).toBe("limit");
    expect(failureCause("fetch failed: ETIMEDOUT, request timed out")).toBe("unavailable");
    expect(failureCause("Exit code 1: KeyError 'results'")).toBeNull();
    expect(failureCause(null)).toBeNull();
  });
});
