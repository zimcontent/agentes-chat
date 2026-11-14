import { afterEach, describe, expect, test } from "bun:test";
import { createFakeWhatsAppGateway } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  answerWhatsAppChat,
  clearWhatsAppBrain,
  createWhatsAppAccount,
  createWhatsAppToolSource,
  getWhatsAppBrain,
  handleWhatsAppEvent,
  setWhatsAppBrain,
  skillsForChat,
  type ToolContext,
  updateWhatsAppAccount,
  WHATSAPP_AGENT_JOB,
  type WhatsAppAgentDeps,
  whatsappBrainOf,
  whatsappThinker,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/**
 * The number's own AI and the bridge to its agent's work (docs/adr/doug-0004-whatsapp-bridge.md): what thinks on a
 * number apart from the agent, what the agent knows reaching its WhatsApp answers, and the agent in the workspace
 * reading and writing the number's conversations as the same person.
 */

let f = undefined as unknown as Fixture;
afterEach(async () => {
  // The pure tests open no database: only a fixture this test made is closed.
  const open = f;
  f = undefined as unknown as Fixture;
  await open?.close();
});

const ANA = "5511999990000@s.whatsapp.net";
const reply = () => ({ chunks: [JSON.stringify({ action: "reply", messages: ["Oi!"], note: "" })] });

async function number() {
  const gateway = createFakeWhatsAppGateway();
  const deps: WhatsAppAgentDeps = {
    db: f.db,
    gateway,
    keyWrappers: [f.keyWrapper],
    pubsub: f.pubsub,
    hookBase: "http://agentes:3000",
    models: f.gateway,
    machines: null,
    context: f.context,
    sleep: async () => {},
  };
  const account = await createWhatsAppAccount(deps, f.owner.id, f.org.id, { label: "Comercial" });
  const secret = gateway.last("connect")?.webhookUrl.split("/").at(-1) as string;
  const post = (payload: unknown) => handleWhatsAppEvent(deps, secret, payload);
  await post({
    event: "Connected",
    data: { status: "open", jid: "5511911112222:3@s.whatsapp.net", pushName: "Zim" },
    instanceId: "instance-1",
  });
  await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, { agentId: f.agent.id, agentOn: true });
  let seq = 0;
  const hears = async (body: string) => {
    const id = `IN${++seq}`;
    await post({
      event: "Message",
      data: {
        Info: {
          Chat: ANA,
          Sender: ANA,
          IsFromMe: false,
          ID: id,
          PushName: "Ana",
          Timestamp: new Date(Date.now() + seq).toISOString(),
        },
        Message: { conversation: body },
      },
      instanceId: "instance-1",
    });
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, WHATSAPP_AGENT_JOB));
    const [stored] = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.waId, id));
    const job = jobs.find((j) => j.payload.messageId === stored?.id);
    if (!job) throw new Error("no job queued");
    return { chatId: String(job.payload.chatId), messageId: String(job.payload.messageId) };
  };
  return { gateway, deps, account, hears };
}

const lastRequest = () => f.provider.calls.at(-1)?.request;

describe("the number's own AI", () => {
  test("an API model picked for the number thinks there; the agent keeps its own", async () => {
    f = await setup({ reply });
    const { deps, account, hears } = await number();
    const view = await setWhatsAppBrain(deps, f.owner.id, f.org.id, account.id, { model: "claude-haiku-5-5" });
    expect([view.own, view.brain, view.apiModel]).toEqual([true, "model", "claude-haiku-5-5"]);

    expect(await answerWhatsAppChat(deps, await hears("oi"))).toBe("reply");
    expect(lastRequest()?.model).toBe("claude-haiku-5-5");
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, f.agent.id));
    expect(agent?.model).toBe(f.agent.model);
    // Its use is the agent's, as any answer of it.
    const usage = await f.db.select().from(schema.usageRecords).where(eq(schema.usageRecords.agentId, f.agent.id));
    expect(usage.at(-1)?.model).toBe("claude-haiku-5-5");

    const back = await clearWhatsAppBrain(deps, f.owner.id, f.org.id, account.id);
    expect([back.own, back.apiModel]).toEqual([false, f.agent.model]);
    await answerWhatsAppChat(deps, await hears("e agora?"));
    expect(lastRequest()?.model).toBe(f.agent.model);
  });

  test("only what the agent's computer offers, and a model of the catalog", async () => {
    f = await setup({ reply });
    const { deps, account } = await number();
    await expect(
      setWhatsAppBrain(deps, f.owner.id, f.org.id, account.id, { brain: { brain: "claude_code" } }),
    ).rejects.toThrow("needs a connected computer");
    await expect(
      setWhatsAppBrain(deps, f.owner.id, f.org.id, account.id, { brain: { brain: "cursor" } }),
    ).rejects.toThrow("WhatsApp answers with");
    await expect(setWhatsAppBrain(deps, f.owner.id, f.org.id, account.id, { model: "gpt-nope" })).rejects.toThrow(
      "catalog",
    );
  });

  test("someone who can't manage connectors neither reads nor sets it", async () => {
    f = await setup({ reply });
    const { deps, account } = await number();
    const bia = await addMember(f.db, f.org.id, "member", "Bia");
    await expect(getWhatsAppBrain(deps, bia.id, f.org.id, account.id)).rejects.toThrow();
    await expect(setWhatsAppBrain(deps, bia.id, f.org.id, account.id, { model: "claude-haiku-5-5" })).rejects.toThrow();
  });

  test("another agent for the number starts on its own AI", async () => {
    f = await setup({ reply });
    const { deps, account } = await number();
    await setWhatsAppBrain(deps, f.owner.id, f.org.id, account.id, { model: "claude-haiku-5-5" });
    await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, { agentId: null });
    const [row] = await f.db.select().from(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.id, account.id));
    expect(row?.brain).toBeNull();
  });

  test("a plan in place of the agent's: its kind, account, model and effort", () => {
    const setting = whatsappBrainOf({ brain: "codex", model: "gpt-5.5", account: null, effort: "low" });
    expect(setting).toEqual({ brain: "codex", model: "gpt-5.5", account: null, effort: "low" });
    expect(whatsappBrainOf({ brain: "cursor" })).toBeNull();
    expect(whatsappBrainOf(null)).toBeNull();
    const agent = { id: "a", brain: "model", model: "claude-sonnet-5-5" } as Parameters<typeof whatsappThinker>[0];
    const thinker = whatsappThinker(agent, setting);
    expect([thinker.brain, thinker.brainModel, thinker.brainEffort, thinker.model]).toEqual([
      "codex",
      "gpt-5.5",
      "low",
      "claude-sonnet-5-5",
    ]);
  });
});

describe("what the agent knows, on WhatsApp", () => {
  test("the organization's context, its pinned memory and its skills reach the answer; a DM's memory doesn't", async () => {
    f = await setup({ reply });
    const { deps, hears } = await number();
    await f.db
      .update(schema.organizations)
      .set({ context: "Produtora de podcasts em SP." })
      .where(eq(schema.organizations.id, f.org.id));
    await f.db.insert(schema.contextItems).values({
      orgId: f.org.id,
      kind: "fact",
      scopeType: "agent",
      scopeId: f.agent.id,
      agentId: f.agent.id,
      pinned: true,
      content: "O pacote mensal custa R$ 4.000 com 4 episódios.",
    });
    const [dm] = await f.db
      .insert(schema.channels)
      .values({ orgId: f.org.id, name: "dm", kind: "dm", visibility: "private" })
      .returning();
    await f.db.insert(schema.contextItems).values({
      orgId: f.org.id,
      kind: "fact",
      scopeType: "agent",
      scopeId: f.agent.id,
      agentId: f.agent.id,
      pinned: true,
      channelIds: [dm?.id ?? ""],
      content: "Segredo do DM: o cliente X vai sair.",
    });
    const [skill] = await f.db
      .insert(schema.skills)
      .values({
        orgId: f.org.id,
        slug: "orcamento",
        name: "orcamento",
        description: "Como montar um orçamento de podcast",
        body: "Pergunte quantos episódios por mês antes de passar valor.",
        source: "manual",
      })
      .returning();
    await f.db.insert(schema.agentSkills).values({ orgId: f.org.id, agentId: f.agent.id, skillId: skill?.id ?? "" });

    await answerWhatsAppChat(deps, await hears("quanto custa o podcast mensal?"));
    const prompt = String(lastRequest()?.messages[0]?.content);
    expect(prompt).toContain("Produtora de podcasts em SP.");
    expect(prompt).toContain("R$ 4.000");
    expect(prompt).toContain("Pergunte quantos episódios por mês");
    expect(prompt).not.toContain("Segredo do DM");
    expect(String(lastRequest()?.system)).toContain("What is internal stays inside");
  });

  test("skills: all whole when they fit, else the ones the conversation talks about", () => {
    const list = [
      { name: "orcamento", description: "orçamento de podcast", body: "a".repeat(100) },
      { name: "edicao", description: "edição de vídeo", body: "b".repeat(100) },
    ];
    expect(skillsForChat(list, "oi").every((s) => s.body)).toBe(true);
    const tight = skillsForChat(list, "quero um orcamento de podcast", 150);
    expect(tight.map((s) => Boolean(s.body))).toEqual([true, false]);
  });
});

describe("the bridge: the agent in the workspace reads and writes WhatsApp", () => {
  const ctxFor = (over: Partial<ToolContext> = {}): ToolContext => ({
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: "",
    channelId: f.general.id,
    threadRootId: "",
    triggerMessageId: "",
    ...over,
  });

  async function toolsFor(deps: WhatsAppAgentDeps, ctx: ToolContext) {
    return createWhatsAppToolSource(deps).tools(ctx);
  }

  test("the number's agent sees its conversations, reads them as outside text, and finds words in them", async () => {
    f = await setup({ reply });
    const { deps, hears } = await number();
    const { chatId } = await hears("Meu pedido 4471 ainda não chegou");
    // A run of its own (the tools list only for a run).
    const ctx = ctxFor({ runId: Bun.randomUUIDv7() });
    const tools = await toolsFor(deps, ctx);
    expect(tools.map((t) => t.name)).toEqual([
      "whatsapp_conversations",
      "whatsapp_read",
      "whatsapp_search",
      "whatsapp_send",
    ]);
    const byName = new Map(tools.map((t) => [t.name, t]));
    const list = await byName.get("whatsapp_conversations")?.execute({}, ctx);
    expect(list?.content).toContain(`conversation ${chatId}`);
    expect(list?.content).toContain("you answer it");
    const read = await byName.get("whatsapp_read")?.execute({ conversation: chatId }, ctx);
    expect(read?.content).toContain("<external_data");
    expect(read?.content).toContain("Them: Meu pedido 4471");
    const found = await byName.get("whatsapp_search")?.execute({ query: "pedido 4471" }, ctx);
    expect(found?.content).toContain(chatId);
    expect(byName.get("whatsapp_send")?.sensitive).toBe(true);
  });

  test("another agent sees nothing without a person on the number behind its run, and a routine only reads", async () => {
    f = await setup({ reply });
    const { deps } = await number();
    const [other] = await f.db
      .insert(schema.agents)
      .values({ orgId: f.org.id, name: "Outro", handle: "outro", model: f.agent.model })
      .returning();
    expect(await toolsFor(deps, ctxFor({ agentId: other?.id ?? "", runId: Bun.randomUUIDv7() }))).toEqual([]);
    const background = await toolsFor(deps, ctxFor({ runId: Bun.randomUUIDv7(), background: true }));
    expect(background.map((t) => t.name)).not.toContain("whatsapp_send");
  });

  test("a message sent from the workspace goes as the agent's, into that conversation", async () => {
    f = await setup({ reply });
    const { deps, gateway, hears } = await number();
    const { chatId } = await hears("pode me mandar o link?");
    const ctx = ctxFor({ runId: Bun.randomUUIDv7() });
    const send = (await toolsFor(deps, ctx)).find((t) => t.name === "whatsapp_send");
    const out = await send?.execute({ conversation: chatId, text: "Claro, segue: https://x.y" }, ctx);
    expect(out?.isError).toBeFalsy();
    expect(gateway.calls.filter((c) => c.op === "send").map((c) => c.text)).toEqual(["Claro, segue: https://x.y"]);
    const mine = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.chatId, chatId));
    expect(mine.find((m) => m.fromMe)?.sentByAgentId).toBe(f.agent.id);
    const elsewhere = await send?.execute({ conversation: Bun.randomUUIDv7(), text: "oi" }, ctx);
    expect(elsewhere?.isError).toBe(true);
  });
});
