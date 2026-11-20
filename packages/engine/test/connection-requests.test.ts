import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@dougbot/db";
import type { ModelRequest } from "@dougbot/providers";
import {
  type ConnectorDeps,
  createApiKeyConnection,
  createConnectionRequestToolSource,
  drainOutbox,
  expireConnectionRequest,
  getMessage,
  HOW_YOU_WORK,
  holdsMessages,
  postPersonMessage,
  turnMeans,
} from "../src";
import { continuationVerdict } from "../src/continuation";
import { currentWaits, onMessageWhileWaiting } from "../src/waits";
import { addMember, type Fixture, setup } from "./fixtures";

// Connect and continue (docs/adr/doug-0039-connect-and-continue.md): an agent missing a service posts a Connect card
// and waits; once the service is connected it goes on with the same task by itself.

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const lastText = (req: ModelRequest) => JSON.stringify(req.messages.at(-1)?.content);

/** @dev asks for GitHub when the request needs it, and finishes the task once it reads that it is connected. */
const reply = (req: ModelRequest) => {
  const last = lastText(req);
  if (last.includes("is connected now")) return { chunks: ["Listed the open issues."] };
  if (last.includes("within a day")) return { chunks: ["Nobody connected GitHub: ask me again once it is."] };
  if (last.includes("tool_result")) return { chunks: ["ok"] };
  if (last.includes("issues"))
    return {
      chunks: [],
      toolUses: [
        {
          name: "request_connection",
          input: { service: "GitHub", why: "Para ler as issues abertas.", next: "list the open issues" },
        },
      ],
    };
  return { chunks: ["ok"] };
};

const deps = (): ConnectorDeps => ({ db: f.db, keyWrappers: [f.keyWrapper], publicUrl: "https://chat.example.com" });

async function world() {
  f = await setup({
    reply: reply as never,
    toolSources: [createConnectionRequestToolSource({ pubsub: undefined, catalog: { oauthApps: {} } })],
  });
}

async function runOf(body: string, as = f.owner.id) {
  const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, as, f.org.id, f.general.id, { body });
  await drainOutbox(f.db, f.handlers);
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, msg.id));
  if (!run) throw new Error("no run");
  return run;
}

const runNow = async (id: string) => {
  const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id));
  if (!run) throw new Error("no run");
  return run;
};

const cardOf = async () => {
  const rows = await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, f.general.id));
  const m = rows.find((r) => (r.meta.actionCard as { kind?: string } | undefined)?.kind === "connect_app");
  return m?.meta.actionCard as { kind: string; forUserId: string; params: Record<string, unknown> } | undefined;
};

const requestOf = async () => {
  const [row] = await f.db.select().from(schema.connectionRequests);
  if (!row) throw new Error("no request");
  return row;
};

const agentReplies = async () =>
  (await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, f.general.id)))
    .filter((m) => m.authorType === "agent" && !m.meta.notice && !m.meta.actionCard)
    .map((m) => m.body);

const connectGithub = (actor = f.owner.id) =>
  createApiKeyConnection(deps(), actor, f.org.id, { connector: "github", apiKey: "ghp_fake_fixture" });

describe("request_connection", () => {
  test("posts a Connect card and parks the run; connecting it resumes the same run, which finishes the task", async () => {
    await world();
    const run = await runOf("@dev list the open github issues");
    expect(run.status).toBe("waiting_input");
    const card = await cardOf();
    expect(card).toMatchObject({
      kind: "connect_app",
      forUserId: f.owner.id,
      params: {
        connector: "github",
        why: "Para ler as issues abertas.",
        request: { runId: run.id, state: "waiting", askedUserIds: [] },
      },
    });
    const request = await requestOf();
    expect(request).toMatchObject({ service: "github", label: "GitHub", nextStep: "list the open issues" });
    expect(request.expiresAt.getTime() - request.createdAt.getTime()).toBeGreaterThan(23 * 3600_000);
    // The give-up job is queued for its end.
    const [job] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "connection.request_expired"));
    expect(job?.payload).toEqual({ requestId: request.id });
    // A person's message still reaches the run: the wait doesn't hold it.
    const held = await runNow(run.id);
    expect(await holdsMessages(f.db, held, f.owner.id)).toBe(false);
    expect((await currentWaits(f.db, held)).map((w) => w.kind)).toEqual(["connection"]);

    await connectGithub();
    await drainOutbox(f.db, f.handlers);
    expect((await runNow(run.id)).status).toBe("done");
    expect(await agentReplies()).toContain("Listed the open issues.");
    expect((await requestOf()).state).toBe("connected");
    expect((await cardOf())?.params.request).toMatchObject({ state: "connected", resumed: true });
    // It ended: the day's end finds nothing to end.
    expect(await expireConnectionRequest({ db: f.db }, request.id)).toBe(false);
  });

  test("a service already connected and given needs no card", async () => {
    await world();
    await connectGithub();
    const run = await runOf("@dev list the open github issues");
    expect(run.status).toBe("done");
    expect(await cardOf()).toBeUndefined();
    const steps = await f.db
      .select()
      .from(schema.agentRunSteps)
      .where(and(eq(schema.agentRunSteps.runId, run.id), eq(schema.agentRunSteps.kind, "tool_result")));
    expect(JSON.stringify(steps.map((s) => s.data))).toContain("is connected and yours already");
  });

  test("nobody connecting it within a day ends the wait, and the agent says so", async () => {
    await world();
    const run = await runOf("@dev list the open github issues");
    const request = await requestOf();
    expect(await expireConnectionRequest({ db: f.db }, request.id)).toBe(true);
    await drainOutbox(f.db, f.handlers);
    expect((await runNow(run.id)).status).toBe("done");
    expect(await agentReplies()).toContain("Nobody connected GitHub: ask me again once it is.");
    expect((await cardOf())?.params.request).toMatchObject({ state: "expired" });
    // Connected later: nothing waits on it any more.
    await connectGithub();
    await drainOutbox(f.db, f.handlers);
    expect((await requestOf()).state).toBe("expired");
  });

  test("a person who can't connect apps: the card names who can, they're asked, and their connecting resumes the run", async () => {
    await world();
    const rui = await addMember(f.db, f.org.id, "member", "Rui Tanaka");
    await f.db.insert(schema.channelMembers).values({ orgId: f.org.id, channelId: f.general.id, userId: rui.id });
    const run = await runOf("@dev list the open github issues", rui.id);
    expect(run.status).toBe("waiting_input");
    const card = await cardOf();
    expect(card?.forUserId).toBe(rui.id);
    expect(card?.params.request).toMatchObject({ askedUserIds: [f.owner.id] });
    const [ask] = await f.db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, f.owner.id), eq(schema.notifications.kind, "admin_ask")));
    expect(ask?.latest).toMatchObject({ reason: "connector", title: "GitHub" });
    expect(ask?.waiting).toBe(true);
    // The tool told the agent who was asked.
    const [result] = await f.db
      .select()
      .from(schema.agentRunSteps)
      .where(and(eq(schema.agentRunSteps.runId, run.id), eq(schema.agentRunSteps.kind, "tool_result")));
    expect(JSON.stringify(result?.data ?? {})).toContain("can't connect apps");

    await connectGithub(f.owner.id);
    await drainOutbox(f.db, f.handlers);
    expect((await runNow(run.id)).status).toBe("done");
    expect(await agentReplies()).toContain("Listed the open issues.");
    const [done] = await f.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, ask?.id ?? ""));
    expect(done?.doneAt).not.toBeNull();
  });

  test("a person who wrote meanwhile moved the run on; the connection later starts a run in the same conversation", async () => {
    await world();
    const run = await runOf("@dev list the open github issues");
    const posted = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "meanwhile, say hi",
    });
    const message = await getMessage(f.db, f.org.id, posted.id);
    if (!message) throw new Error("no message");
    expect(await onMessageWhileWaiting({ db: f.db, pubsub: f.pubsub }, await runNow(run.id), message)).toEqual({
      waitKind: "connection",
      outcome: "woke",
    });
    await drainOutbox(f.db, f.handlers);
    expect((await runNow(run.id)).status).toBe("done");
    // The card still waits for the connection.
    expect((await requestOf()).state).toBe("waiting");

    await connectGithub();
    await drainOutbox(f.db, f.handlers);
    expect((await requestOf()).state).toBe("connected");
    const notices = (await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, f.general.id)))
      .map((m) => m.meta.notice as { kind?: string; text?: string } | undefined)
      .filter((n) => n?.kind === "wait_result");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toContain("You were waiting on it to: list the open issues");
    expect(notices[0]?.text).toContain("«@dev list the open github issues»");
    expect(await agentReplies()).toContain("Listed the open issues.");
    expect((await cardOf())?.params.request).toMatchObject({ state: "connected", resumed: true });
  });

  test("a routine can't ask: only a person's own request", async () => {
    await world();
    const ctxRun = await runOf("@dev say hi");
    const tools = await createConnectionRequestToolSource({ catalog: { oauthApps: {} } }).tools({
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: "",
      channelId: f.general.id,
      threadRootId: "",
      triggerMessageId: "",
    });
    const out = await tools[0]?.execute(
      { service: "GitHub", why: "x", next: "y" },
      {
        db: f.db,
        orgId: f.org.id,
        agentId: f.agent.id,
        runId: "",
        channelId: f.general.id,
        threadRootId: "",
        triggerMessageId: ctxRun.id,
      },
    );
    expect(out?.isError).toBe(true);
    expect(out?.content).toContain("Only a person's own request");
  });
});

describe("the prompt and the turn-end judge", () => {
  test("means and How you work name request_connection instead of 'no access'", () => {
    expect(turnMeans(new Set(["request_connection"])).join("\n")).toContain("`request_connection`");
    expect(HOW_YOU_WORK).toContain("never stop at 'I don't have access to it': call `request_connection`");
  });

  test("'no access' to a connectable app without request_connection reads as untried; with it, done", async () => {
    const asked: Record<string, unknown>[] = [];
    const judge = {
      ask: async (q: {
        state: Record<string, unknown>;
        questions: Record<string, { criteria?: Record<string, string> }>;
      }) => {
        asked.push(q.state);
        const untried = q.questions.verdict?.criteria?.untried ?? "";
        // The rubric as the criteria read: request_connection in `means`, none in `tried`.
        const means = JSON.stringify(q.state.means);
        const tried = JSON.stringify(q.state.tried);
        const choice =
          untried.includes("request_connection") &&
          means.includes("request_connection") &&
          !tried.includes("request_connection")
            ? "untried"
            : "done";
        return { verdict: { choice, probabilities: { [choice]: 0.9 } } };
      },
    };
    const base = {
      orgId: "o",
      agentId: "a",
      runId: "r",
      request: "pull last month's Google Ads spend",
      reply: "I don't have access to Google Ads.",
      means: turnMeans(new Set(["request_connection", "web_search"])),
      runKind: "conversation" as const,
    };
    expect(await continuationVerdict(judge as never, { ...base, tried: [] })).toBe("untried");
    expect(
      await continuationVerdict(judge as never, {
        ...base,
        tried: ['request_connection({"service":"Google Ads"}) → waiting'],
      }),
    ).toBe("done");
    expect(asked).toHaveLength(2);
  });
});
