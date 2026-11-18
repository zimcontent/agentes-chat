import { expect, test } from "bun:test";
import type { OrgCall } from "../src/gateway";
import { createProgressLine, dropProgressLine, progressWords, stepGist } from "../src/progress-line";

const RUN = { id: "0193aaaa-0000-7000-8000-00000000p001", orgId: "org-1", agentId: "agent-1" };

/** A gateway that answers `reply` (or fails), recording each call. */
function fakeGateway(reply: string | Error) {
  const calls: OrgCall[] = [];
  return {
    calls,
    gateway: {
      complete: async (call: OrgCall) => {
        calls.push(call);
        if (reply instanceof Error) throw reply;
        return { text: reply } as Awaited<ReturnType<import("../src/gateway").ModelGateway["complete"]>>;
      },
    },
  };
}

test("a run quiet past the threshold with new steps gets one line, worded from the request and its steps", async () => {
  let now = 0;
  const { gateway, calls } = fakeGateway('"Revisando os quadros do vídeo antes de enviar."');
  const p = createProgressLine(
    { gateway, resolveModel: async () => "cheap-model", now: () => now, quietMs: 30_000, everyMs: 45_000 },
    RUN,
    "Sony",
    () => "Faça um vídeo pra Fontes Invest",
  );
  // No step yet, or not quiet long enough: nothing.
  now = 40_000;
  expect(await p.tick()).toBeNull();
  p.step({ name: "run_command", input: { CommandLine: "ffprobe render/promo.mp4", WaitMsBeforeAsync: 5000 } });
  p.step({ name: "read_file", input: { Path: "/work/qa/final_frames/00120.png" } });
  now = 20_000;
  expect(await p.tick()).toBeNull();
  now = 40_000;
  // Quotes and the full stop go; the line stands as the run's step words.
  expect(await p.tick()).toBe("Revisando os quadros do vídeo antes de enviar");
  expect(progressWords(RUN.id)).toBe("Revisando os quadros do vídeo antes de enviar");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    orgId: "org-1",
    agentId: "agent-1",
    runId: RUN.id,
    kind: "router",
    model: "cheap-model",
  });
  expect(String(calls[0]?.system)).toContain("Sony");
  const content = String(calls[0]?.messages[0]?.content);
  expect(content).toContain("Faça um vídeo pra Fontes Invest");
  expect(content).toContain("run_command: ffprobe render/promo.mp4");
  expect(content).toContain("read_file: /work/qa/final_frames/00120.png");
  expect(content).toContain("<external_data");

  // No new step since, or too soon: no second call.
  now = 200_000;
  expect(await p.tick()).toBeNull();
  p.step({ name: "run_command", input: { CommandLine: "ls" } });
  now = 60_000;
  expect(await p.tick()).toBeNull();
  // The agent wrote: its own words stand, the line goes, and quiet starts over.
  now = 210_000;
  p.wrote();
  expect(progressWords(RUN.id)).toBeUndefined();
  expect(await p.tick()).toBeNull();
  now = 241_000;
  expect(await p.tick()).toBe("Revisando os quadros do vídeo antes de enviar");
  expect(calls).toHaveLength(2);
  p.close();
  expect(progressWords(RUN.id)).toBeUndefined();
});

test("a failed or empty answer says nothing, and a key in a step never reaches the model", async () => {
  let now = 100_000;
  const failing = fakeGateway(new Error("no key"));
  const p = createProgressLine(
    { gateway: failing.gateway, resolveModel: async () => "m", now: () => now, quietMs: 0, everyMs: 0 },
    RUN,
    "Sony",
    () => "oi",
  );
  p.step({
    name: "run_command",
    input: { CommandLine: "curl -H 'Authorization: Bearer sk-ant-abcdefghijklmnopqrstuvwxyz0123' https://x" },
  });
  expect(await p.tick()).toBeNull();
  const empty = fakeGateway("   ");
  const q = createProgressLine(
    { gateway: empty.gateway, resolveModel: async () => "m", now: () => now, quietMs: 0, everyMs: 0 },
    RUN,
    "Sony",
    () => "oi",
  );
  q.step({ name: "run_command", input: {} });
  now += 1;
  expect(await q.tick()).toBeNull();
  dropProgressLine(RUN.id);
  expect(
    stepGist({
      name: "run_command",
      input: { CommandLine: "curl -H 'Authorization: Bearer sk-ant-abcdefghijklmnopqrstuvwxyz0123' https://x" },
    }),
  ).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz0123");
  expect(stepGist({ name: "search_web", input: { query: "hyperframes rendering" } })).toBe(
    "search_web: hyperframes rendering",
  );
  expect(stepGist({ name: "think", input: null })).toBe("think");
});
