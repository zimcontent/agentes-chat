import { describe, expect, test } from "bun:test";
import { failedRunDetails } from "../src/chat/run-details";

const at = new Date("2026-11-13T10:00:00.000Z");

describe("failedRunDetails", () => {
  test("lists every part that is known", () => {
    expect(
      failedRunDetails({ agent: "Theo", line: "Theo failed", error: "boom", code: "run.x", runId: "r1", at }),
    ).toBe("Agent: Theo\nMessage: Theo failed\nError: boom\nCode: run.x\nRun: r1\nTime: 2026-11-13T10:00:00.000Z");
  });

  test("leaves out the error and the code when there are none", () => {
    expect(failedRunDetails({ agent: "Theo", line: "Theo failed", runId: "r1", at })).toBe(
      "Agent: Theo\nMessage: Theo failed\nRun: r1\nTime: 2026-11-13T10:00:00.000Z",
    );
  });
});
