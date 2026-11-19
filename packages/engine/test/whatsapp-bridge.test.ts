import { afterEach, describe, expect, test } from "bun:test";
import { createFakeWhatsAppGateway } from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import {
  answerWhatsAppChat,
  clearWhatsAppBrain,
  clientWorkFor,
  createWhatsAppAccount,
  createWhatsAppToolSource,
  draftWhatsAppInstructions,
  fitWhatsAppPrompt,
  getWhatsAppBrain,
  handleWhatsAppEvent,
  mirrorAgentReply,
  openPersonAgentDm,
  parseInstructionsDraft,
  postPersonMessage,
  setWhatsAppBrain,
  setWhatsAppContact,
  skillsForChat,
  type ToolContext,
  updateWhatsAppAccount,
  WHATSAPP_AGENT_JOB,
  type WhatsAppAgentDeps,
  whatsappAgentPrompt,
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
  return { gateway, deps, account, hears, post };
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
      "whatsapp_open_file",
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

describe("a prompt within a plan's route", () => {
  const base = {
    workspace: "Zim",
    agent: { name: "Doug", role: "Atendente", instructions: "Seja breve." },
    account: { label: "DOUG", instructions: "Nunca prometa prazo." },
    chat: { name: "Ana" },
    lines: ["Ana: oi, vocês editam vídeo?"],
    now: new Date("2026-11-15T12:00:00Z"),
  };

  test("names alone give way first, then skills' text (largest first), memory, team memory and context; never the conversation", () => {
    const big = (c: string) => c.repeat(9000);
    const names = Array.from({ length: 300 }, (_, i) => ({
      name: `Habilidade ${i}`,
      description: "faz algo",
      body: null,
    }));
    const input = {
      ...base,
      orgContext: big("o"),
      teamMemory: big("t"),
      memory: big("m"),
      skills: [
        { name: "Orçamento", description: "como orçar", body: big("a") },
        { name: "Edição", description: "como editar", body: "passos curtos" },
        ...names,
      ],
    };
    const full = whatsappAgentPrompt(input);
    expect(fitWhatsAppPrompt(input, full.length)).toBe(full);
    const fit = fitWhatsAppPrompt(input, full.length - 100);
    expect(fit.length).toBeLessThanOrEqual(full.length - 100);
    expect(fit).toContain("Habilidade 0:");
    expect(fit).not.toContain("Habilidade 299:");
    expect(fit).toContain("aaaa");
    const route = fitWhatsAppPrompt(input, 32_000);
    expect(route.length).toBeLessThanOrEqual(32_000);
    expect(route).toContain("passos curtos");
    const tight = fitWhatsAppPrompt(input, 4000);
    expect(tight.length).toBeLessThanOrEqual(4000);
    for (const gone of ["aaaa", "mmmm", "tttt", "oooo"]) expect(tight).not.toContain(gone);
    expect(tight).toContain("# The business");
    expect(tight).toContain("vocês editam vídeo");
    expect(tight).toContain("Nunca prometa prazo.");
  });
});

describe("who the contact is", () => {
  test("a member's WhatsApp goes to their conversation with the agent, and the agent's words there come back", async () => {
    f = await setup({ reply });
    const { gateway, deps, account, hears } = await number();
    const relayDeps = {
      ...deps,
      relay: (
        userId: string,
        orgId: string,
        channelId: string,
        input: { body: string; meta: Record<string, unknown> },
      ) => postPersonMessage({ db: f.db, pubsub: f.pubsub }, userId, orgId, channelId, input),
    };
    const first = await hears("oi");
    await setWhatsAppContact(deps, f.owner.id, f.org.id, account.id, first.chatId, { member: f.owner.id });
    const job = await hears("o que a Rosa está fazendo agora?");
    expect(await answerWhatsAppChat(relayDeps, job)).toBe("relayed");
    // No answer from WhatsApp's own: the agent in the workspace answers.
    expect(f.provider.calls).toHaveLength(0);
    const dm = await openPersonAgentDm(f.db, f.org.id, f.owner.id, f.agent.id);
    const [asked] = await f.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, dm.id), eq(schema.messages.authorType, "person")));
    expect(asked?.body).toBe("oi\no que a Rosa está fazendo agora?");
    expect(asked?.meta.whatsapp).toEqual({ accountId: account.id, chatId: first.chatId });

    const agentSays = async (body: string) => {
      const [m] = await f.db
        .insert(schema.messages)
        .values({
          orgId: f.org.id,
          channelId: dm.id,
          authorType: "agent",
          authorAgentId: f.agent.id,
          body,
          createdAt: new Date(Date.now() + 1000),
        })
        .returning();
      if (!m) throw new Error("no message");
      return mirrorAgentReply(deps, m);
    };
    expect(await agentSays("Deixa eu ver com a Rosa. **Ela está no reel da Lexeer.**")).toBe(1);
    expect(gateway.last("send")?.text).toBe("Deixa eu ver com a Rosa. *Ela está no reel da Lexeer.*");
    // Written in the app afterwards: the answers stay in the app.
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, dm.id, { body: "valeu" });
    await new Promise((r) => setTimeout(r, 5));
    expect(await agentSays("De nada!")).toBe(0);
  });

  test("only that member or whoever manages members says a contact is someone; a client must be the portal's", async () => {
    f = await setup({ reply });
    const { deps, account, hears } = await number();
    const { chatId } = await hears("oi");
    const leticia = await addMember(f.db, f.org.id, "member", "leticia");
    await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, { people: [f.owner.id, leticia.id] });
    await expect(
      setWhatsAppContact(deps, leticia.id, f.org.id, account.id, chatId, { member: f.owner.id }),
    ).rejects.toThrow("manages members");
    expect(await setWhatsAppContact(deps, leticia.id, f.org.id, account.id, chatId, { member: leticia.id })).toEqual({
      member: leticia.id,
      client: null,
    });
    await expect(
      setWhatsAppContact(deps, f.owner.id, f.org.id, account.id, chatId, { client: "lexeer" }),
    ).rejects.toThrow("portal's clients");
  });

  test("a client's answers read their own work, and nobody else's", async () => {
    f = await setup({ reply });
    const { deps, account, hears } = await number();
    const card = (n: number, client: string, title: string, stage: string, kind: string) => ({
      orgId: f.org.id,
      number: n,
      title,
      createdByType: "person",
      createdById: f.owner.id,
      dueDate: "2026-11-20",
      source: { type: "portal", client, cardId: `c-${n}`, synced: { card: { stage, kind } } },
    });
    await f.db
      .insert(schema.issues)
      .values([
        card(1, "lexeer", "Reel casa nova", "doing", "reel"),
        card(2, "fontes", "Carrossel do parque", "approval", "carousel"),
      ]);
    const { chatId } = await hears("oi");
    await setWhatsAppContact(deps, f.owner.id, f.org.id, account.id, chatId, { client: "lexeer" });
    expect(await clientWorkFor(deps, f.org.id, "lexeer")).toBe(
      "- Reel casa nova (reel): em produção, produção prevista para 2026-11-20",
    );
    await answerWhatsAppChat(deps, await hears("como está minha demanda? vai demorar?"));
    const prompt = String(lastRequest()?.messages[0]?.content);
    expect(prompt).toContain('This contact is the client "lexeer"');
    expect(prompt).toContain("Reel casa nova");
    expect(prompt).not.toContain("Carrossel do parque");
  });
});

describe("voice messages", () => {
  const engine = (text: string) => ({
    id: "local" as const,
    model: "fake",
    nanoUsdPerHour: 0,
    minBilledSeconds: 0,
    file: async () => ({ text }),
  });
  const voice = (id: string) => ({
    event: "Message",
    data: {
      Info: { Chat: ANA, Sender: ANA, IsFromMe: false, ID: id, PushName: "Ana", Timestamp: new Date().toISOString() },
      Message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 4, PTT: true, mediaKey: "a2V5" } },
    },
    instanceId: "instance-1",
  });

  test("heard before the agent reads them: a member's goes to their conversation as words, kept on the message", async () => {
    f = await setup({ reply });
    const { gateway, deps, account, hears, post } = await number();
    const first = await hears("oi");
    await setWhatsAppContact(deps, f.owner.id, f.org.id, account.id, first.chatId, { member: f.owner.id });
    await post(voice("V1"));
    const [stored] = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.waId, "V1"));
    const heard = {
      ...deps,
      speech: () => [engine("  o que a Rosa está   fazendo agora? ")],
      relay: (
        userId: string,
        orgId: string,
        channelId: string,
        input: { body: string; meta: Record<string, unknown> },
      ) => postPersonMessage({ db: f.db, pubsub: f.pubsub }, userId, orgId, channelId, input),
    };
    expect(await answerWhatsAppChat(heard, { chatId: first.chatId, messageId: stored?.id as string })).toBe("relayed");
    expect(gateway.last("download")).toBeDefined();
    const [after] = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.waId, "V1"));
    expect(after?.body).toBe("o que a Rosa está fazendo agora?");
    const dm = await openPersonAgentDm(f.db, f.org.id, f.owner.id, f.agent.id);
    const [asked] = await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, dm.id));
    expect(asked?.body).toBe("oi\n(áudio) o que a Rosa está fazendo agora?");
  });

  test("anyone else's are read by the agent as what was said; with no engine they stay a file it can't open", async () => {
    f = await setup({ reply });
    const { deps, post } = await number();
    await post(voice("V2"));
    const [stored] = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.waId, "V2"));
    const job = { chatId: stored?.chatId as string, messageId: stored?.id as string };
    await answerWhatsAppChat({ ...deps, speech: () => [engine("vocês fazem reels?")] }, job);
    expect(String(lastRequest()?.messages[0]?.content)).toContain("Them: [audio] vocês fazem reels?");
    // Another recording, no engine on the server: a file the agent can't open, as before.
    await post(voice("V3"));
    const [next] = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.waId, "V3"));
    await answerWhatsAppChat(deps, { chatId: job.chatId, messageId: next?.id as string });
    expect(String(lastRequest()?.messages[0]?.content)).toMatch(/Them: \[audio\]\n/);
  });
});

describe("a new direction for the number's instructions (addendum 2026-11-17)", () => {
  const hearing = (text: string) => ({
    id: "local" as const,
    model: "fake",
    nanoUsdPerHour: 0,
    minBilledSeconds: 0,
    file: async () => ({ text }),
  });
  const drafted = (instructions: string) => () => ({ chunks: [JSON.stringify({ instructions })] });

  test("a recording is heard and the number's AI rewrites the whole document with it, saving nothing", async () => {
    f = await setup({ reply: drafted("# Atendimento\n- Responda em até duas frases.\n- Nunca fale de preço.") });
    const { deps, account } = await number();
    await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, {
      instructions: "# Atendimento\n- Seja breve.",
    });
    await setWhatsAppBrain(deps, f.owner.id, f.org.id, account.id, { model: "claude-haiku-5-5" });
    const draft = await draftWhatsAppInstructions(
      { ...deps, speech: () => [hearing("  não fala de   preço com ninguém ")] },
      f.owner.id,
      f.org.id,
      account.id,
      { audio: { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/mp4", durationMs: 4000 } },
    );
    expect(draft).toEqual({
      heard: "não fala de preço com ninguém",
      instructions: "# Atendimento\n- Responda em até duas frases.\n- Nunca fale de preço.",
    });
    // The number's own AI wrote it, from the saved document and what was said.
    expect(lastRequest()?.model).toBe("claude-haiku-5-5");
    const prompt = String(lastRequest()?.messages[0]?.content);
    expect(prompt).toContain("- Seja breve.");
    expect(prompt).toContain("não fala de preço com ninguém");
    const [row] = await f.db.select().from(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.id, account.id));
    expect(row?.instructions).toBe("# Atendimento\n- Seja breve.");
  });

  test("typed words go on the document still in the settings, unsaved", async () => {
    f = await setup({ reply: drafted("Novo") });
    const { deps, account } = await number();
    await draftWhatsAppInstructions(deps, f.owner.id, f.org.id, account.id, {
      text: "Chame todo mundo pelo nome",
      current: "Rascunho que ainda não foi salvo",
    });
    const prompt = String(lastRequest()?.messages[0]?.content);
    expect(prompt).toContain("Rascunho que ainda não foi salvo");
    expect(prompt).toContain("Chame todo mundo pelo nome");
  });

  test("refused: no agent, no speech engine for a recording, nothing said, or someone who can't change the number", async () => {
    f = await setup({ reply: drafted("x") });
    const { deps, account } = await number();
    const audio = { bytes: new Uint8Array([1]), contentType: "audio/mp4" };
    await expect(draftWhatsAppInstructions(deps, f.owner.id, f.org.id, account.id, { audio })).rejects.toMatchObject({
      code: "whatsapp.voice_off",
    });
    await expect(
      draftWhatsAppInstructions({ ...deps, speech: () => [hearing("  ")] }, f.owner.id, f.org.id, account.id, {
        audio,
      }),
    ).rejects.toMatchObject({ code: "whatsapp.unheard" });
    await expect(draftWhatsAppInstructions(deps, f.owner.id, f.org.id, account.id, { text: "  " })).rejects.toThrow();
    const member = await addMember(f.db, f.org.id, "member");
    await expect(draftWhatsAppInstructions(deps, member.id, f.org.id, account.id, { text: "oi" })).rejects.toThrow();
    await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, { agentId: null });
    await expect(
      draftWhatsAppInstructions(deps, f.owner.id, f.org.id, account.id, { text: "oi" }),
    ).rejects.toMatchObject({ code: "whatsapp.no_agent" });
  });

  test("the answer read: the JSON's document, or bare Markdown from a model that forgot the JSON", () => {
    expect(parseInstructionsDraft('{"instructions": "  # Oi\\n- a "}')).toBe("# Oi\n- a");
    expect(parseInstructionsDraft({ instructions: "# Oi" })).toBe("# Oi");
    expect(parseInstructionsDraft("# Oi\n- sem JSON")).toBe("# Oi\n- sem JSON");
    expect(parseInstructionsDraft('{"instructions": ""}')).toBeNull();
    expect(parseInstructionsDraft("{quebrado")).toBeNull();
    expect(parseInstructionsDraft(null)).toBeNull();
  });
});
