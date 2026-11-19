// Local demo data for screenshots only (not committed).
import { and, createDatabase, eq, schema } from "@agenteschat/db";
import { bodyCode, insertMessage, openPersonAgentDm } from "@agenteschat/engine";
const url = process.argv[2]; const orgId = process.argv[3]; const doug = process.argv[4];
const { db } = createDatabase({ url, poolMax: 1 });
const [owner] = await db.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.orgId, orgId));
const userId = owner.userId;
const [general] = await db.select().from(schema.channels).where(and(eq(schema.channels.orgId, orgId), eq(schema.channels.name, "general")));
const t0 = Date.now() - 40 * 60_000;
const at = (m: number) => new Date(t0 + m * 60_000);
const agent = (channelId: string, body: string, m: number, meta: Record<string, unknown> = {}, threadId: string | null = null) =>
  insertMessage(db, { orgId, channelId, threadId, author: { type: "agent", agentId: doug, runId: null, hop: 1, stretchId: null }, body, meta, createdAt: at(m) });
const person = (channelId: string, body: string, m: number) =>
  insertMessage(db, { orgId, channelId, author: { type: "person", userId }, body, createdAt: at(m) });
async function approval(channelId: string, root: string, m: number, input: Record<string, unknown>, title: string, detail: string, status: "pending" | "approved") {
  const [a] = await db.insert(schema.approvals).values({
    orgId, agentId: doug, channelId, threadRootId: root, toolUseId: crypto.randomUUID(), tool: "phone_call", scope: "",
    params: input, actionHash: crypto.randomUUID(), title, detail, why: "Você pediu para eu ligar.", ownerUserId: userId,
    requestedByUserId: userId, expiresAt: new Date(Date.now() + 20 * 3600_000),
    ...(status === "approved" ? { status, decidedByUserId: userId, decidedAt: at(m + 1) } : {}),
  }).returning();
  const card = await agent(channelId, `Approval request: ${title}`, m, { ...bodyCode("approval_request", { title }), approvalId: a.id, why: "Você pediu para eu ligar." });
  await db.update(schema.approvals).set({ messageId: card.id }).where(eq(schema.approvals.id, a.id));
}

// 1) DM com o Doug: pedido, aprovado, ligação feita e o resumo.
const dm = await openPersonAgentDm(db, orgId, userId, doug);
const ask = await person(dm.id, "Doug, liga pro Diego (+1 432 312-5338) e explica como o DougBot vai funcionar pra ele. Ele é brasileiro.", 0);
await agent(dm.id, "Fechado! Antes de ligar, separei o que o Diego precisa saber: o que é o DougBot, o time de agentes e como ele pede as coisas pelo app. Só preciso do seu ok.", 1);
const brief = "Ligação para o Diego, brasileiro, que quer saber como o DougBot vai funcionar. Explicar: o app onde pessoas e agentes trabalham juntos; o Doug como gerente da operação; o time (Rosa, Sony, Chess, Mark, Social Media, Kiara, Junin); aprovações antes de chegar ao cliente; WhatsApp e chamadas de voz. Perguntar o que ele quer saber e escutar.";
await approval(dm.id, ask.id, 1, { to: "+14323125338", name: "Diego", brief }, "Call Diego (+14323125338)", brief, "approved");
await agent(dm.id, "Ligando para o Diego agora. 📞 Quando a ligação acabar, te conto como foi.", 3);
await agent(dm.id, [
  "Falei com o Diego por 4 minutos. Foi bem! Aqui vai o resumo:",
  "",
  "**Do que falamos**",
  "- Expliquei o DougBot: o app onde a equipe e os agentes trabalham juntos, e que eu coordeno o time.",
  "- Apresentei a Rosa, a Sony, o Chess, o Mark e o resto do time, cada um com um exemplo.",
  "",
  "**O que ficou combinado**",
  "- Ele quer testar o app esta semana. Eu prometi mandar o link de convite.",
  "- Ele perguntou se dá para usar pelo celular: confirmei que sim (iPhone e Android).",
  "",
  "**O que falta fazer**",
  "- [ ] **Eu**: mandar o convite do workspace para o Diego (já preparei, falta o seu ok).",
  "- [ ] **Você**: decidir em qual canal ele entra primeiro.",
  "",
  "**Insights**",
  "- Ele ficou mais animado com o QG de Tráfego do Mark: vale mostrar os relatórios de campanha logo no primeiro dia.",
  "- A dúvida dele foi preço: talvez valha uma conversa sua com ele sobre isso.",
].join("\n"), 9);

// 2) #general: um pedido esperando aprovação.
const ask2 = await person(general.id, "@Doug liga pro Messi e fala que o time da Unbuilt tá pronto pra servir ele: o Dick, a Dani e o Bill.", 30);
const brief2 = "Ligação para o Messi, sócio e dono da Unbuilt Creative. Dizer que o Doug está feliz de auxiliar a Unbuilt e que o time está pronto para servi-lo: Dick, Dani e Bill. Perguntar como ele quer começar e qual é a prioridade agora.";
await agent(general.id, "Bora! Preparei o que vou falar com o Messi. Aprova aqui que eu ligo:", 31, {}, null);
await approval(general.id, ask2.id, 31, { to: "+5551980221050", name: "Messi", brief: brief2 }, "Call Messi (+5551980221050)", brief2, "pending");
console.log("ok", dm.id, general.id);
process.exit(0);
