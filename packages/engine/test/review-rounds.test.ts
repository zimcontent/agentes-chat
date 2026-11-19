import { afterEach, describe, expect, test } from "bun:test";
import { type ApprovalPortal, createFakeWhatsAppGateway, type PortalItem, type PortalJob } from "@dougbot/adapters";
import { and, eq, schema } from "@dougbot/db";
import {
  bringClientNotes,
  createFileArtifact,
  createIssue,
  createWhatsAppAccount,
  decideVideoReview,
  EDITOR_SEND_JOB,
  getVideoReview,
  handleWhatsAppEvent,
  notifyRound,
  openTaskConversation,
  ROUND_NOTIFY_JOB,
  reviewWhatsAppTargets,
  roundMessage,
  runEditorSend,
  sendPostToClient,
  setReviewPost,
  setReviewWhatsApp,
  submitEditorVideo,
  type VideoReviewDeps,
  type WhatsAppDeps,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** Rounds of changes asked of an editor, their log, the WhatsApp notice and the client's notes (doug-0012 §10–§12). */

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3, 4]);
const GROUP = "120363000000000001@g.us";

function fakePortal() {
  const job: PortalJob = {
    id: "job-1",
    state: "done",
    client: "lexeer",
    item: "item-9",
    title: "Post",
    missing: [],
    link: "https://portal.example/p/item-9",
    error: null,
  };
  return {
    upload: async (name: string) => `file-${name}`,
    send: async () => job,
    newVersion: async () => job,
    job: async () => job,
    editItem: async () => {},
    scheduleItem: async () => {},
    cards: async () => [],
  } as unknown as ApprovalPortal;
}

async function world() {
  const gateway = createFakeWhatsAppGateway();
  const whatsapp: WhatsAppDeps = {
    db: f.db,
    gateway,
    keyWrappers: [f.keyWrapper],
    pubsub: f.pubsub,
    hookBase: "http://agentes:3000",
  };
  const d: VideoReviewDeps = {
    db: f.db,
    pubsub: f.pubsub,
    artifacts: f.artifactDeps,
    engines: () => [],
    publicUrl: "https://doug.example",
    portal: fakePortal(),
    whatsapp,
  };
  const editor = await addMember(f.db, f.org.id, "member", "Ronny Silva");
  await f.db
    .update(schema.organizationMembers)
    .set({ handle: "ronny" })
    .where(eq(schema.organizationMembers.userId, editor.id));
  const task = await createIssue({ db: f.db, pubsub: f.pubsub }, { type: "person", userId: f.owner.id }, f.org.id, {
    title: "Reel Glenwood",
  });
  const stage = async (s: string) =>
    f.db
      .update(schema.issues)
      .set({ source: { type: "portal", client: "lexeer", cardId: "card-7", synced: { card: { stage: s } } } })
      .where(eq(schema.issues.id, task.id));
  await stage("doing");
  const upload = async (name: string) => {
    const at = await openTaskConversation(f.db, { type: "person", userId: editor.id }, f.org.id, task.id);
    return createFileArtifact(f.artifactDeps, { type: "person", userId: editor.id }, f.org.id, {
      title: name,
      name,
      bytes: MP4,
      contentType: "video/mp4",
      channelId: at.channelId,
      threadId: at.rootId,
    });
  };
  // Doug's number, connected, with the editor's group among its conversations.
  const account = await createWhatsAppAccount(whatsapp, f.owner.id, f.org.id, { label: "Doug" });
  const secret = gateway.last("connect")?.webhookUrl.split("/").at(-1) as string;
  await handleWhatsAppEvent(whatsapp, secret, {
    event: "Connected",
    data: { status: "open", jid: "5511911112222:3@s.whatsapp.net", pushName: "Doug" },
    instanceId: "instance-1",
  });
  const [chat] = await f.db
    .insert(schema.whatsappChats)
    .values({ orgId: f.org.id, accountId: account.id, jid: GROUP, name: "Rony Demandas", group: true })
    .returning();
  return { d, gateway, editor, task, stage, upload, account, chat: chat as NonNullable<typeof chat> };
}

const roundJobs = async () =>
  f.db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, ROUND_NOTIFY_JOB)));

describe("review rounds", () => {
  test("changes asked: a round, the WhatsApp line in the editor's group, seen, then answered by V2", async () => {
    f = await setup({ rightHand: true });
    const w = await world();
    await setReviewWhatsApp(f.db, f.owner.id, f.org.id, w.editor.id, { accountId: w.account.id, chatId: w.chat.id });
    expect((await reviewWhatsAppTargets(f.db, f.org.id))[0]).toMatchObject({
      userId: w.editor.id,
      chatName: "Rony Demandas",
      accountLabel: "Doug",
    });
    const v1 = await w.upload("v1.mp4");
    const { review } = await submitEditorVideo(w.d, w.editor.id, f.org.id, w.task.id, { artifactId: v1.id });
    await f.db.insert(schema.videoReviewNotes).values({
      orgId: f.org.id,
      reviewId: review.id,
      version: 1,
      atMs: 6400,
      body: "trocar a trilha aqui",
      authorUserId: f.owner.id,
    });
    await decideVideoReview(w.d, f.owner.id, f.org.id, review.id, { decision: "changes" });

    const [job] = await roundJobs();
    expect(job).toBeDefined();
    await notifyRound(w.d, String(job?.payload.roundId), { finalAttempt: false });
    const sent = w.gateway.last("send");
    expect(sent?.to).toBe(GROUP);
    expect(sent?.text).toContain("Olá, Ronny! Chegou um novo ajuste para você em *Reel Glenwood* (V1)");
    expect(sent?.text).toContain("• [0:06.4] trocar a trilha aqui");
    expect(sent?.text).toContain(`https://doug.example/org/${f.org.id}/review/${review.id}`);
    expect(sent?.text).toContain("mande a V2 na tarefa");
    // Told once: a retried job sends nothing more.
    await notifyRound(w.d, String(job?.payload.roundId), { finalAttempt: false });
    expect(w.gateway.calls.filter((c) => c.op === "send")).toHaveLength(1);

    // The team opening it isn't the editor seeing it.
    let log = (await getVideoReview(w.d, f.owner.id, f.org.id, review.id)).rounds;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ askedBy: f.owner.name, fromClient: false, notes: 1, seenAt: null });
    expect(log[0]?.notified).toMatchObject({ whatsapp: { chat: "Rony Demandas" } });
    await getVideoReview(w.d, w.editor.id, f.org.id, review.id);
    log = (await getVideoReview(w.d, f.owner.id, f.org.id, review.id)).rounds;
    expect(log[0]?.seenAt).not.toBeNull();
    expect(log[0]?.answeredAt).toBeNull();

    const v2 = await w.upload("v2.mp4");
    await submitEditorVideo(w.d, w.editor.id, f.org.id, w.task.id, { artifactId: v2.id, reviewId: review.id });
    const after = await getVideoReview(w.d, f.owner.id, f.org.id, review.id);
    expect(after.rounds[0]).toMatchObject({ answeredVersion: 2 });
    expect(after.round?.answeredVersion).toBe(2);
  });

  test("no conversation set: the round is kept, nothing goes out", async () => {
    f = await setup({ rightHand: true });
    const w = await world();
    const v1 = await w.upload("v1.mp4");
    const { review } = await submitEditorVideo(w.d, w.editor.id, f.org.id, w.task.id, { artifactId: v1.id });
    await decideVideoReview(w.d, f.owner.id, f.org.id, review.id, { decision: "changes", message: "mais curto" });
    const [job] = await roundJobs();
    await notifyRound(w.d, String(job?.payload.roundId), { finalAttempt: false });
    expect(w.gateway.calls.filter((c) => c.op === "send")).toHaveLength(0);
    expect((await getVideoReview(w.d, f.owner.id, f.org.id, review.id)).rounds[0]?.notified).toEqual({ none: true });
  });

  test("the client's marks at the portal land on the player at their second and open a round for the editor", async () => {
    f = await setup({ rightHand: true });
    const w = await world();
    const v1 = await w.upload("v1.mp4");
    const { review } = await submitEditorVideo(w.d, w.editor.id, f.org.id, w.task.id, { artifactId: v1.id });
    await decideVideoReview(w.d, f.owner.id, f.org.id, review.id, { decision: "approve" });
    await setReviewPost(w.d, f.owner.id, f.org.id, review.id, {
      caption: "ok",
      captionOk: true,
      noCover: true,
      coverOk: true,
    });
    await sendPostToClient(w.d, f.owner.id, f.org.id, review.id);
    const [send] = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, EDITOR_SEND_JOB));
    await runEditorSend(w.d, send?.payload as never);

    const item = {
      client: "lexeer",
      id: "item-9",
      status: "adjust_requested",
      clientNotes: [
        {
          id: "mk-1",
          version: 1,
          atSeconds: 22.053,
          page: null,
          x: null,
          y: null,
          text: "Quando fala de adega, colocar uma adega",
          files: ["https://portal.example/uploads/adega.jpg"],
          by: "lexeer",
          at: "2026-11-15T10:00:00-03:00",
        },
        {
          id: "c-aj-1",
          version: 1,
          atSeconds: null,
          page: null,
          x: null,
          y: null,
          text: "Legenda mais curta",
          files: [],
          by: "Lexeer",
          at: "2026-11-15T10:01:00-03:00",
        },
      ],
    } as unknown as PortalItem;
    expect(await bringClientNotes(f.db, f.org.id, [item])).toBe(2);
    // Brought once.
    expect(await bringClientNotes(f.db, f.org.id, [item])).toBe(0);
    const seen = await getVideoReview(w.d, w.editor.id, f.org.id, review.id);
    expect(seen.status).toBe("changes");
    const client = seen.notes.filter((n) => n.fromClient);
    expect(client.map((n) => [n.atMs, n.body, n.author?.name])).toEqual([
      [null, "Legenda mais curta", "Cliente (lexeer) · Lexeer"],
      [22053, "Quando fala de adega, colocar uma adega", "Cliente (lexeer)"],
    ]);
    expect(client[1]?.attachments).toEqual([
      { type: "link", url: "https://portal.example/uploads/adega.jpg", label: "Anexo do cliente 1" },
    ]);
    expect(seen.rounds.at(-1)).toMatchObject({ fromClient: true, notes: 2, askedBy: "Cliente (lexeer)" });

    // The editor's next version goes straight to the client and answers the round.
    await w.stage("adjusting");
    const v2 = await w.upload("v2.mp4");
    const back = await submitEditorVideo(w.d, w.editor.id, f.org.id, w.task.id, {
      artifactId: v2.id,
      reviewId: review.id,
    });
    expect(back.toClient).toBe(true);
    expect((await getVideoReview(w.d, f.owner.id, f.org.id, review.id)).rounds.at(-1)?.answeredVersion).toBe(2);
  });

  test("the WhatsApp line for the client's change says it goes straight to them", () => {
    const text = roundMessage({
      name: "Ronny Silva",
      title: "Reel",
      version: 2,
      askedBy: "Cliente (fontes)",
      fromClient: true,
      client: "fontes",
      notes: [{ atMs: 22053, body: "adega" }],
      reviewLink: "https://x/r",
      taskLink: "https://x/t",
    });
    expect(text).toContain("O cliente fontes pediu um ajuste em *Reel* (V2)");
    expect(text).toContain("• [0:22.0] adega");
    expect(text).toContain("mande a V3 na tarefa (Enviar vídeo), ela vai direto para o cliente: https://x/t");
  });
});
