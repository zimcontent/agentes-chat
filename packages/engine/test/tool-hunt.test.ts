import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq, schema } from "@dougbot/db";
import type { ModelRequest } from "@dougbot/providers";
import {
  drainOutbox,
  listedTools,
  noteToolHunt,
  postPersonMessage,
  STUCK_END_REPLY_NOTE,
  TOOL_HUNT_NOTE,
  type ToolHuntState,
  type ToolSource,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/**
 * An agent hunting for a tool it doesn't have (ADR 0015 addendum 2026-11-17): searches that lead to no tool used are
 * counted; at the 3rd it is told it doesn't have that tool, at the 6th the run ends saying where it stands. Seen in
 * production: a model brain asked for a connector nobody had searched the directory 11 times and spent the rest of
 * its 200 steps looking for the tool on the computer.
 */

setDefaultTimeout(60_000);

const find = (listed: string[]) => ({
  name: "find_tools",
  input: { query: "estado_conta" },
  content: `other tools for "estado_conta" (call one with use_tool):\n${listed.map((n) => `- ${n}: [Zim Studio] something`).join("\n")}`,
  isError: false,
});
const call = (name: string, input: unknown = {}, isError = false, content = "ok") => ({
  name,
  input,
  content,
  isError,
});

describe("what counts as a search in vain", () => {
  test("the names a search lists, approvals and all", () => {
    expect(
      listedTools(
        'other tools for "x" (call one with use_tool):\n- zim_studio_gerar_imagem (asks a person\'s approval; its input includes why): [Zim Studio] Gerar\n- crm_find: CRM',
      ),
    ).toEqual(["zim_studio_gerar_imagem", "crm_find"]);
  });

  test("a search followed by a tool it listed is not in vain, however many there are", () => {
    let state: ToolHuntState | undefined;
    for (let i = 0; i < 10; i++) {
      const r = noteToolHunt(state, [find(["crm_find"]), call("use_tool", { tool: "crm_find", arguments: {} })]);
      state = r.state;
      expect(r.action).toBeNull();
    }
    expect(state?.vain).toBe(0);
  });

  test("searching again without using what was listed counts; other tools in between don't help", () => {
    let r = noteToolHunt(undefined, [find(["zim_a"])]);
    r = noteToolHunt(r.state, [call("run_code", { code: "ls" })]);
    r = noteToolHunt(r.state, [find(["zim_b"])]);
    expect(r.state.vain).toBe(1);
    r = noteToolHunt(r.state, [
      call(
        "use_tool",
        { tool: "estado_conta" },
        true,
        'No other tool named "estado_conta". Find the exact name with find_tools.',
      ),
    ]);
    expect(r.state.vain).toBe(2);
    expect(r.action).toBeNull();
    r = noteToolHunt(r.state, [find(["zim_c"]), find(["zim_d"])]);
    expect(r.state.vain).toBe(3);
    expect(r.action).toBe("note");
    // Told once.
    r = noteToolHunt(r.state, [find(["zim_e"])]);
    expect(r.action).toBeNull();
    r = noteToolHunt(r.state, [find(["zim_f"])]);
    r = noteToolHunt(r.state, [find(["zim_g"])]);
    expect(r.state.vain).toBe(6);
    expect(r.action).toBe("end");
  });

  test("a tool it listed and then failed doesn't close the search", () => {
    let r = noteToolHunt(undefined, [find(["crm_find"]), call("crm_find", {}, true, "Unauthorized")]);
    r = noteToolHunt(r.state, [find(["crm_find"])]);
    expect(r.state.vain).toBe(1);
  });
});

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

/** A directory that never has the tool, and a computer to dig around on. */
function huntTools(): ToolSource {
  const input = (key: string) => ({ type: "object", properties: { [key]: { type: "string" } } });
  return {
    name: "hunt",
    tools: async () => [
      {
        name: "find_tools",
        description: "Search your tools",
        scope: "context:read",
        inputSchema: input("query"),
        execute: async (args) => ({
          content: `other tools for "${String(args.query)}" (call one with use_tool):\n- zim_studio_receber_imagem: [Zim Studio] Receber imagem\n- zim_studio_consultar_projeto: [Zim Studio] Consultar projeto`,
        }),
      },
      {
        name: "run_code",
        description: "Run code",
        scope: "context:read",
        inputSchema: input("code"),
        execute: async (args) => ({ content: `exit code 0\n${String(args.code)}: nothing about it here` }),
      },
    ],
  };
}

describe("a run hunting for a tool it doesn't have", () => {
  test("told at its 3rd search in vain, then it ends at the 6th, saying where it stands, long before the cap", async () => {
    f = await setup({
      toolSources: [huntTools()],
      // Never stuck by repetition: every call is new.
      judge: () => undefined,
      reply: (_req, n) =>
        n % 2
          ? { chunks: [], toolUses: [{ name: "find_tools", input: { query: `estado_conta ${n}` } }] }
          : { chunks: [], toolUses: [{ name: "run_code", input: { code: `grep -r estado_conta /srv/${n}` } }] },
    });
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev lê o estado_conta da conta de anúncios",
    });
    await drainOutbox(f.db, f.handlers);

    const requests = f.provider.calls.map((c) => c.request);
    const lastText = (r: ModelRequest) => JSON.stringify(r.messages.at(-1)?.content ?? "");
    // Searches at calls 1, 3, 5, 7…: the 4th search (call 7) makes the 3rd in vain, the 7th (call 13) the 6th.
    expect(requests.findIndex((r) => lastText(r).includes(TOOL_HUNT_NOTE))).toBe(7);
    expect(requests.findIndex((r) => lastText(r).includes(STUCK_END_REPLY_NOTE))).toBe(13);
    expect(requests).toHaveLength(15);
    const [run] = await f.db.select().from(schema.agentRuns);
    expect(run).toMatchObject({ status: "done", error: null, turns: 15 });
    const steps = await f.db
      .select()
      .from(schema.agentRunSteps)
      .where(eq(schema.agentRunSteps.runId, run?.id ?? ""))
      .orderBy(schema.agentRunSteps.seq);
    expect(steps.flatMap((s) => (s.data as { toolHunt?: unknown }).toolHunt ?? [])).toEqual([
      { vain: 3, action: "note" },
      { vain: 6, action: "end" },
    ]);
  });
});
