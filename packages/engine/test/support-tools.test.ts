import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  type AgentRun,
  addChannelMember,
  CONTACT_SUPPORT_TOOL,
  createSupportToolSource,
  postPersonMessage,
  renderEmail,
  type ToolContext,
  toolPolicy,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/**
 * `contact_support`: a summary of a problem with the installation itself goes to whoever runs it (`SUPPORT_EMAIL`),
 * in the name of the person who asked the agent. Listed only where the server has a support address, and never for a
 * run nobody is behind.
 */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const TO = "help@example.com";

const source = (over: Partial<Parameters<typeof createSupportToolSource>[0]> = {}) =>
  createSupportToolSource({ to: TO, publicUrl: "https://acme.test", version: "1.2.3", ...over });

const toolOf = async (from = source()) => {
  const [tool] = await from.tools({} as ToolContext);
  if (!tool) throw new Error("no tool");
  return tool;
};

const runOf = async (triggerMessageId: string): Promise<AgentRun> => {
  const [run] = await f.db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.triggerMessageId, triggerMessageId), eq(schema.agentRuns.agentId, f.agent.id)));
  if (!run) throw new Error("no run");
  return run;
};

const ctxOf = (run: AgentRun, toolUseId = "call-1") =>
  ({
    db: f.db,
    orgId: f.org.id,
    agentId: run.agentId,
    runId: run.id,
    channelId: run.channelId,
    threadRootId: run.threadRootId,
    triggerMessageId: run.triggerMessageId,
    toolUseId,
  }) as ToolContext;

/** The `email.send` jobs queued so far, with their support template and its recipient. */
const queued = async () =>
  (await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send")))
    .filter((job) => (job.payload.template as { kind?: string } | undefined)?.kind === "support_request")
    .map((job) => ({ to: (job.payload.to as string[])[0], template: job.payload.template }));

/** Bia, a member, asks the agent in the channel; the run her message started. */
async function askedByBia() {
  const bia = await addMember(f.db, f.org.id, "member", "bia");
  await addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { userId: bia.id });
  const message = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, bia.id, f.org.id, f.general.id, {
    body: "@dev chama o suporte: a página de rotinas não abre",
  });
  return { bia, run: await runOf(message.id) };
}

test("listed only where the server has a support address", async () => {
  expect(await source({ to: undefined }).tools({} as ToolContext)).toEqual([]);
  expect((await source().tools({} as ToolContext)).map((t) => t.name)).toEqual([CONTACT_SUPPORT_TOOL]);
});

test("it asks a person first: the person behind the run, in their own name", async () => {
  f = await setup();
  const { bia, run } = await askedByBia();
  const tool = await toolOf();
  expect(tool.sensitive).toBe(true);
  const asked = await tool.approvers?.({ text: "It doesn't open." }, ctxOf(run), bia.id);
  expect(asked).toMatchObject({ ok: true, approvers: { userIds: [bia.id], required: true, requestedBy: null } });
  // A call nobody is behind has nobody to ask.
  const nobody = { ...ctxOf(run), runId: "", triggerMessageId: "" } as ToolContext;
  expect((await tool.approvers?.({ text: "By itself." }, nobody, null))?.ok).toBe(false);
});

test("a person asks: one email queued in their name, saying which agent wrote it and which installation", async () => {
  f = await setup();
  const { bia, run } = await askedByBia();
  const tool = await toolOf(source({ clientCode: "064" }));
  const out = await tool.execute({ text: "  The routines page doesn't open.  " }, ctxOf(run));
  expect(out.isError).toBeUndefined();
  // The same call run again goes once (a retry).
  await tool.execute({ text: "The routines page doesn't open." }, ctxOf(run));
  const [sent, ...more] = await queued();
  expect(more).toEqual([]);
  expect(sent?.to).toBe(TO);
  expect(sent?.template).toMatchObject({
    kind: "support_request",
    name: "bia",
    email: bia.email,
    orgName: "Acme",
    text: "The routines page doesn't open.",
    agent: { name: "Dev", handle: "dev" },
    clientCode: "064",
    version: "1.2.3",
  });
  const mail = renderEmail(sent?.template as never);
  expect(mail.text).toContain("Written by: Dev (@dev), an agent");
  expect(mail.text).toContain("Workspace: Acme");
  expect(mail.text).toContain("Client: 064");
  expect(mail.text).toContain("Server: 1.2.3");
});

test("an installation with no client code says none", async () => {
  f = await setup();
  const { run } = await askedByBia();
  await (await toolOf()).execute({ text: "No code here." }, ctxOf(run));
  const [sent] = await queued();
  expect((sent as { template: { clientCode: string | null } }).template.clientCode).toBeNull();
});

test("a routine's run never sends it: it speaks for no person (run policy)", async () => {
  f = await setup();
  const tool = await toolOf();
  expect(toolPolicy({ kind: "routine", personId: null, brief: null }, tool).action).toBe("refuse");
});

test("nobody behind the call, or a person who left: nothing sent", async () => {
  f = await setup();
  const { bia, run } = await askedByBia();
  const tool = await toolOf();
  const nobody = { ...ctxOf(run), runId: "", triggerMessageId: "" } as ToolContext;
  expect((await tool.execute({ text: "By itself." }, nobody)).isError).toBe(true);
  await f.db
    .delete(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.orgId, f.org.id), eq(schema.organizationMembers.userId, bia.id)));
  expect((await tool.execute({ text: "After leaving." }, ctxOf(run))).isError).toBe(true);
  expect(await queued()).toEqual([]);
});

test("an empty text sends nothing", async () => {
  f = await setup();
  const { run } = await askedByBia();
  expect((await (await toolOf()).execute({ text: "   " }, ctxOf(run))).isError).toBe(true);
  expect(await queued()).toEqual([]);
});
