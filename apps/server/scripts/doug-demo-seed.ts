// Demo data for a local UI pilot: one workspace with channels, agents and messages. Fictional data only.
// Run with the server stopped (PGlite is one process): bun --env-file=../../.env scripts/doug-demo-seed.ts <email>
// Run again on a seeded database, it only (re)sets the photos: each group's logo and shown name, and the person's photo,
// through the same engine calls as the photo endpoints (`PUT …/channels/{id}/icon`, `PUT …/me/avatar`).
// Logos: DOUG_LOGOS, by default the `logos` folder beside the clone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPostgresBlobStore } from "@agenteschat/adapters";
import { and, createDatabase, eq, schema } from "@agenteschat/db";
import {
  createAgent,
  createChannel,
  createOrganization,
  insertMessage,
  openPersonAgentDm,
  setAvatar,
  setChannelIcon,
} from "@agenteschat/engine";

/**
 * The DougBot team (identidade/dougbot-identidade, §7) and a few free bots, with the trades that pick their forms, and
 * the states the shots show: run again, it adds who is missing and sets the roles. Without an AI in this pilot an
 * agent with nothing going on reads offline (asleep); background work (`agent_works` live, no run) reads at work, and
 * a run waiting on an approval reads as asking.
 */
const TEAM = [
  { name: "Doug BOSS", handle: "doug", role: "Chefe de operações", color: "green" },
  { name: "SONY", handle: "sony", role: "Edição de vídeo", color: "indigo" },
  { name: "ROSA", handle: "rosa", role: "Design e capas", color: "rose" },
  { name: "KIARA", handle: "kiara", role: "Financeiro e cobrança", color: "violet" },
  { name: "JUNIN", handle: "junin", role: "Código e automações", color: "amber" },
  { name: "MARK", handle: "mark", role: "Marketing e tráfego", color: "amber" },
  { name: "CHESS", handle: "chess", role: "Estratégia e planejamento", color: "violet" },
  { name: "Copywriter", handle: "copywriter", role: "Redação de anúncios", color: "sky" },
  { name: "Editorzim", handle: "editorzim", role: "Cortes para Reels", color: "sky" },
  { name: "Pesquisador Growth", handle: "pesquisador-growth", role: "Pesquisa de mercado", color: "sky" },
  { name: "Suporte Zim Studio", handle: "suporte-zimstudio", role: "Suporte técnico", color: "sky" },
  { name: "Humanizador", handle: "humanizador", role: "Revisão de textos", color: "sky" },
];

const email = process.argv[2] ?? "gabriel@timezim.test";
const handle = createDatabase({ url: process.env.DATABASE_URL ?? "", poolMax: 1 });
const db = handle.db;
await handle.ping();

const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
if (!user) throw new Error(`no user ${email}`);
const userId = user.id;

const [existing] = await db.select().from(schema.organizations).where(eq(schema.organizations.name, "Time Zim"));
const orgId =
  existing?.id ??
  (
    await createOrganization(db, userId, {
      name: "Time Zim",
      context: "Produtora de vídeo e conteúdo. Clientes: LEXEER, ELMX Capital, Fontes Invest.",
    })
  ).organization.id;

const [seeded] = await db
  .select({ id: schema.channels.id })
  .from(schema.channels)
  .where(and(eq(schema.channels.orgId, orgId), eq(schema.channels.name, "lexeer")));
if (!seeded) await seedContent();
await seedTeam();
await seedPhotos();
await handle.close();
process.exit(0);

async function seedContent() {
  const agentDefs = TEAM.slice(0, 5);
  const agents: Record<string, string> = {};
  for (const a of agentDefs) {
    const made = await createAgent(
      db,
      userId,
      orgId,
      { name: a.name, handle: a.handle, role: a.role, instructions: `Você é ${a.name}, ${a.role}.` },
      { model: "auto" },
    );
    await db
      .update(schema.agents)
      .set({ appearance: { color: a.color, eyes: "round", accessory: "none" } })
      .where(eq(schema.agents.id, made.id));
    agents[a.handle] = made.id;
  }

  const channelDefs = [
    { name: "lexeer", display: "LEXEER", topic: "Reels Built to Endure e renders 3D" },
    { name: "elmx-capital", display: "ELMX Capital", topic: "Reels com avatar e institucional" },
    { name: "fontes-invest", display: "Fontes Invest", topic: "Conteúdo semanal de investimentos" },
    { name: "zim-studio", display: "Zim Studio", topic: "Produto, lançamentos e promo" },
  ];
  const channels: Record<string, string> = {};
  for (const c of channelDefs) {
    const ch = await createChannel(db, userId, orgId, { name: c.name, topic: c.topic });
    await db.update(schema.channels).set({ displayName: c.display }).where(eq(schema.channels.id, ch.id));
    for (const id of Object.values(agents)) {
      await db.insert(schema.channelMembers).values({ orgId, channelId: ch.id, agentId: id });
    }
    channels[c.name] = ch.id;
  }

  const t0 = Date.now() - 3 * 3600_000;
  let step = 0;
  const at = () => new Date(t0 + step++ * 7 * 60_000);
  const person = (channelId: string, body: string) =>
    insertMessage(db, { orgId, channelId, author: { type: "person", userId: userId }, body, createdAt: at() });
  const agent = (channelId: string, h: string, body: string) =>
    insertMessage(db, {
      orgId,
      channelId,
      author: { type: "agent", agentId: agents[h] as string, runId: null, hop: 0, stretchId: null },
      body,
      createdAt: at(),
    });

  const lx = channels.lexeer as string;
  await person(lx, "Bom dia, time! Precisamos do reels do 724 Palm Dr. até sexta. Quem pega o quê?");
  await agent(
    lx,
    "doug",
    "Bom dia, Gabriel. Divido assim: **SONY** monta no ritmo da trilha, **ROSA** fecha o voice-over EN/PT e **KIARA** cuida da cartela LEXEER. Eu acompanho os prazos.",
  );
  await agent(
    lx,
    "rosa",
    'Voice-over pronto em rascunho: 6 beats, 52 s. Deixei o gancho na primeira frase: "Some homes are built. This one was built to endure."',
  );
  await agent(
    lx,
    "sony",
    "Takes do Kling chegaram. Já cortei a abertura em 3 planos de 1,8 s e alinhei o drop da trilha no segundo 14.",
  );
  await person(lx, "Perfeito. Kiara, a cartela pode usar a prata com extrusão de sempre.");
  await agent(lx, "kiara", "Fechado. Mando duas versões da cartela (prata fosca e prata polida) em 20 minutos.");

  const el = channels["elmx-capital"] as string;
  await person(el, "A ELMX pediu o Flórida x Texas V4 com dados atualizados de 2026.");
  await agent(
    el,
    "junin",
    "Atualizei a planilha: imposto estadual, custo médio do m² e valorização em 12 meses. Duas fontes por número, links na aba Fontes.",
  );
  await agent(
    el,
    "doug",
    "Com os dados do JUNIN, a ROSA ajusta o roteiro e o SONY reaproveita a edição da V3. Previsão de entrega: quinta, 18h.",
  );

  const fi = channels["fontes-invest"] as string;
  await person(fi, "Pauta da semana: renda fixa x dividendos.");
  await agent(
    fi,
    "rosa",
    "Três ganchos possíveis:\n1. Você está deixando dinheiro na mesa?\n2. O erro que todo iniciante comete\n3. Renda fixa não é chata, é estratégia",
  );

  const zs = channels["zim-studio"] as string;
  await person(zs, "Vamos preparar o promo do novo modelo de imagem.");
  await agent(zs, "kiara", "Já separei 12 imagens de referência e um storyboard de 8 cenas. Posso subir no Drive?");

  // A DM with Doug BOSS.
  const dm = await openPersonAgentDm(db, orgId, userId, agents.doug as string);
  await person(dm.id, "Doug, me passa um resumo do dia?");
  await agent(
    dm.id,
    "doug",
    "Claro. Hoje:\n- #lexeer: reels 724 Palm em montagem, voice-over pronto.\n- #elmx-capital: dados da V4 atualizados, roteiro em ajuste.\n- #fontes-invest: 3 ganchos aguardando sua escolha.\n- #zim-studio: storyboard do promo pronto para revisão.\n\nNada bloqueado. Quer que eu cobre a KIARA pela cartela?",
  );
  await person(dm.id, "Pode cobrar, valeu!");
  await agent(dm.id, "doug", "Feito. Te aviso assim que ela mandar.");

  console.log(JSON.stringify({ orgId, channels, agents, dm: dm.id }));
}

async function seedTeam() {
  const rows = await db
    .select({ id: schema.agents.id, handle: schema.agents.handle })
    .from(schema.agents)
    .where(eq(schema.agents.orgId, orgId));
  const ids: Record<string, string> = Object.fromEntries(rows.map((r) => [r.handle, r.id]));
  const [lexeer] = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(eq(schema.channels.orgId, orgId), eq(schema.channels.name, "lexeer")));
  for (const a of TEAM) {
    if (!ids[a.handle]) {
      const made = await createAgent(
        db,
        userId,
        orgId,
        { name: a.name, handle: a.handle, role: a.role, instructions: `Você é ${a.name}, ${a.role}.` },
        { model: "auto" },
      );
      ids[a.handle] = made.id;
      if (lexeer) await db.insert(schema.channelMembers).values({ orgId, channelId: lexeer.id, agentId: made.id });
    }
    await db
      .update(schema.agents)
      .set({ role: a.role })
      .where(eq(schema.agents.id, ids[a.handle] as string));
  }
  if (!lexeer) return;
  // At work: a conversation run going in LEXEER for SONY, ROSA and Editorzim. This pilot has no worker for them, so
  // their heartbeat is set ahead (a run reads at work while its heartbeat is fresh): they stay at work until the next
  // seed. A long run reads busy.
  const [already] = await db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.orgId, orgId), eq(schema.agentRuns.status, "running")))
    .limit(1);
  if (!already) {
    const working = async (handle: string, body: string) => {
      const said = await insertMessage(db, {
        orgId,
        channelId: lexeer.id,
        author: { type: "person", userId },
        body,
        createdAt: new Date(Date.now() - 12 * 60_000),
      });
      await db.insert(schema.agentRuns).values({
        orgId,
        agentId: ids[handle] as string,
        channelId: lexeer.id,
        threadRootId: said.id,
        triggerMessageId: said.id,
        trigger: "mention",
        hop: 0,
        status: "running",
        startedAt: new Date(Date.now() - 10 * 60_000),
        heartbeatAt: new Date(Date.now() + 30 * 24 * 3600_000),
      });
    };
    await working("sony", "@sony monta o reels 724 Palm no ritmo da trilha.");
    await working("rosa", "@rosa fecha as três capas de quinta.");
    await working("editorzim", "@editorzim corta o podcast em três Reels.");
  }
  // Asking: MARK waits on your approval to publish (a run waiting, as the approval card leaves it).
  const [asking] = await db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.orgId, orgId), eq(schema.agentRuns.agentId, ids.mark as string)))
    .limit(1);
  if (!asking) {
    const ask = await insertMessage(db, {
      orgId,
      channelId: lexeer.id,
      author: { type: "agent", agentId: ids.mark as string, runId: null, hop: 0, stretchId: null },
      body: "Posso publicar a campanha de sexta? Preciso do seu ok.",
      createdAt: new Date(Date.now() - 5 * 60_000),
    });
    await db.insert(schema.agentRuns).values({
      orgId,
      agentId: ids.mark as string,
      channelId: lexeer.id,
      threadRootId: ask.id,
      triggerMessageId: ask.id,
      trigger: "mention",
      hop: 0,
      status: "waiting_approval",
      startedAt: new Date(Date.now() - 5 * 60_000),
    });
  }
  // A DM with ROSA.
  const rosa = await openPersonAgentDm(db, orgId, userId, ids.rosa as string);
  const [said] = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, orgId), eq(schema.messages.channelId, rosa.id)))
    .limit(1);
  if (!said) {
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    await insertMessage(db, {
      orgId,
      channelId: rosa.id,
      author: { type: "person", userId },
      body: "Rosa, preciso de três capas para o reels de quinta.",
      createdAt: at(40),
    });
    await insertMessage(db, {
      orgId,
      channelId: rosa.id,
      author: { type: "agent", agentId: ids.rosa as string, runId: null, hop: 0, stretchId: null },
      body: "Fechado. Faço em prata fosca, com o gancho em uma linha só. Te mando as três ainda hoje.",
      createdAt: at(38),
    });
    await insertMessage(db, {
      orgId,
      channelId: rosa.id,
      author: { type: "person", userId },
      body: "Perfeito, valeu!",
      createdAt: at(36),
    });
  }
  console.log("team", ids);
}

// The photos, as the app's photo endpoints store them (the platform files in Postgres when no S3 nor FILES_DIR is set,
// as in this pilot's .env): the groups' logos and shown names, and the person's photo (a provisional one).
async function seedPhotos() {
  const logos = process.env.DOUG_LOGOS ?? join(import.meta.dir, "../../../../logos");
  const blobs = process.env.FILES_DIR ? null : createPostgresBlobStore(db);
  if (!blobs) throw new Error("this seed writes the photos to Postgres: unset FILES_DIR");
  const png = (file: string) => ({
    imageBase64: readFileSync(join(logos, file)).toString("base64"),
    contentType: "image/png",
  });
  const photos = [
    { name: "lexeer", display: "LEXEER", logo: "lexeer.png" },
    { name: "elmx-capital", display: "ELMX Capital", logo: "elmx.png" },
    { name: "fontes-invest", display: "Fontes Invest", logo: "fontes.png" },
    { name: "zim-studio", display: "Zim Studio", logo: "zimstudio.png" },
    { name: "general", display: "ZIM Content", logo: "zimcontent.png" },
  ];
  for (const p of photos) {
    const [ch] = await db
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(and(eq(schema.channels.orgId, orgId), eq(schema.channels.name, p.name)));
    if (!ch) {
      console.log("no group", p.name);
      continue;
    }
    await db.update(schema.channels).set({ displayName: p.display }).where(eq(schema.channels.id, ch.id));
    const { icon } = await setChannelIcon({ db, blobs }, userId, orgId, ch.id, png(p.logo));
    console.log(p.display, icon);
  }
  const { avatarUrl } = await setAvatar({ db, blobs }, userId, png("gabrielzim.png"));
  console.log("photo", avatarUrl);
}
