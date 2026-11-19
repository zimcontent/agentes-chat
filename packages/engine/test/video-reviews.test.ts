import { afterEach, describe, expect, test } from "bun:test";
import type { SpeechEngine } from "@dougbot/adapters";
import { and, desc, eq, schema } from "@dougbot/db";
import {
  addReviewNote,
  addVoiceReviewNote,
  createFileArtifact,
  decideVideoReview,
  decisionMessage,
  decisionShown,
  deleteReviewNote,
  getArtifact,
  getVideoReview,
  listVideoReviews,
  makeLightCopy,
  openDm,
  REVIEW_LIGHT_JOB,
  reviewVideo,
  sendForReview,
  setReviewBrief,
  timecode,
  type VideoReviewDeps,
} from "../src";
import { readableBody } from "../src/message-preview";
import { addMember, addUser, type Fixture, setup } from "./fixtures";

/** Video review (docs/adr/doug-0007-video-review.md): versions, notes on seconds, and the decision back to the agent. */

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const heard: { contentType: string }[] = [];
const engine: SpeechEngine = {
  id: "openai",
  model: "fake",
  nanoUsdPerHour: 0,
  minBilledSeconds: 0,
  async file(input) {
    heard.push({ contentType: input.contentType });
    return { text: "  tira esse corte, a fala some  " };
  },
};

const deps = (engines: SpeechEngine[] = [engine]): VideoReviewDeps => ({
  db: f.db,
  pubsub: f.pubsub,
  artifacts: f.artifactDeps,
  engines: () => engines,
  publicUrl: "https://doug.example/",
});

const video = (name: string) =>
  createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
    title: name,
    name,
    bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    contentType: name.endsWith(".mp4") ? "video/mp4" : "text/plain",
    channelId: f.general.id,
  });

/** The agent's tool call, as from a run in `general`. */
const ctx = () => ({
  orgId: f.org.id,
  agentId: f.agent.id,
  runId: crypto.randomUUID(),
  channelId: f.general.id,
  threadRootId: "",
  triggerMessageId: "",
});

const lastMessage = async () => {
  const [row] = await f.db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.channelId, f.general.id)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return row;
};

describe("video review", () => {
  test("timecodes read like a player's", () => {
    expect(timecode(null)).toBe("geral");
    expect(timecode(0)).toBe("0:00.0");
    expect(timecode(83_400)).toBe("1:23.4");
    expect(timecode(3_725_000)).toBe("1:02:05.0");
  });

  test("an agent sends a video, people pin notes, changes go back to it, V2 comes, then approval", async () => {
    f = await setup();
    const v1 = await video("short-01.mp4");
    const sent = await sendForReview(deps(), ctx(), {
      artifactId: v1.id,
      title: "Short 01 Keith",
      client: "Alliance",
      note: "primeiro corte",
    });
    expect(sent.created).toBe(true);
    expect(sent.link).toBe(`https://doug.example/org/${f.org.id}/review/${sent.review.id}`);
    expect(sent.review).toMatchObject({ status: "in_review", version: 1, artifactId: v1.id, client: "Alliance" });

    const listed = await listVideoReviews(deps(), f.owner.id, f.org.id);
    expect(listed.map((r) => r.id)).toEqual([sent.review.id]);

    const typed = await addReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, {
      version: 1,
      atMs: 12_400,
      body: "  logo maior aqui ",
    });
    expect(typed).toMatchObject({ body: "logo maior aqui", atMs: 12_400, voice: false, sent: false });
    const said = await addVoiceReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, {
      version: 1,
      atMs: 4_000,
      audio: new Uint8Array([1, 2, 3]),
      contentType: "video/mp4",
      language: "pt",
    });
    expect(said).toMatchObject({ body: "tira esse corte, a fala some", voice: true });
    expect(heard.at(-1)?.contentType).toBe("audio/mp4");

    await addReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, {
      version: 1,
      atMs: null,
      body: "cor mais quente",
    });

    const decided = await decideVideoReview(deps(), f.owner.id, f.org.id, sent.review.id, { decision: "changes" });
    expect(decided).toMatchObject({ status: "changes", openNotes: 0 });
    const asked = await lastMessage();
    expect(asked?.authorUserId).toBe(f.owner.id);
    expect(asked?.body).toContain(`@${f.agent.handle} Ajustes em «Short 01 Keith» V1`);
    // A note about the whole video first, then by time: the said note before the typed one.
    expect(asked?.body.indexOf("[geral] cor mais quente")).toBeLessThan(asked?.body.indexOf("[0:04.0]") ?? 0);
    expect(asked?.body.indexOf("[0:04.0] tira esse corte")).toBeLessThan(
      asked?.body.indexOf("[0:12.4] logo maior") ?? 0,
    );

    // Sent notes stay, read only.
    await expect(deleteReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, typed.id)).rejects.toThrow();

    const v2 = await video("short-01-v2.mp4");
    const again = await sendForReview(deps(), ctx(), {
      artifactId: v2.id,
      reviewId: sent.review.id,
      note: "logo maior",
    });
    expect(again.created).toBe(false);
    expect(again.review).toMatchObject({ status: "in_review", version: 2, artifactId: v2.id });

    const approved = await decideVideoReview(deps(), f.owner.id, f.org.id, sent.review.id, { decision: "approve" });
    expect(approved.status).toBe("approved");
    expect((await lastMessage())?.body).toStartWith(`@${f.agent.handle} Aprovado: «Short 01 Keith» V2`);
    // People read the decision from meta, without the agent's instructions (the skill, the ids).
    const posted = await lastMessage();
    expect(posted?.meta?.videoReview).toMatchObject({
      id: sent.review.id,
      decision: "approve",
      title: "Short 01 Keith",
      handle: f.agent.handle,
      said: "",
    });
    expect(readableBody(posted?.body ?? "", posted?.meta)).toBe("Aprovado: «Short 01 Keith» V2");

    const full = await getVideoReview(deps(), f.owner.id, f.org.id, sent.review.id);
    expect(full.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(full.notes).toHaveLength(3);
    expect(full.notes[0]?.atMs).toBeNull();
    expect(full.decidedBy?.id).toBe(f.owner.id);
  });

  test("refuses what isn't a video, changes with nothing said, and another person's note", async () => {
    f = await setup();
    const text = await video("roteiro.txt");
    await expect(sendForReview(deps(), ctx(), { artifactId: text.id })).rejects.toThrow("not a video");

    const v1 = await video("evento.mp4");
    const { review } = await sendForReview(deps(), ctx(), { artifactId: v1.id });
    expect(review.title).toBe("evento.mp4");
    await expect(decideVideoReview(deps(), f.owner.id, f.org.id, review.id, { decision: "changes" })).rejects.toThrow(
      "add a note first",
    );

    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const note = await addReviewNote(deps(), f.owner.id, f.org.id, review.id, { version: 1, atMs: null, body: "ok" });
    // bia isn't in `general` but sees the review (doug-0014); another person's note still isn't hers to remove.
    expect((await listVideoReviews(deps(), bia.id, f.org.id)).map((r) => r.id)).toEqual([review.id]);
    await expect(deleteReviewNote(deps(), bia.id, f.org.id, review.id, note.id)).rejects.toThrow();
    await deleteReviewNote(deps(), f.owner.id, f.org.id, review.id, note.id);
    expect((await getVideoReview(deps(), f.owner.id, f.org.id, review.id)).notes).toEqual([]);

    await expect(
      addVoiceReviewNote(deps([]), f.owner.id, f.org.id, review.id, {
        version: 1,
        atMs: 0,
        audio: new Uint8Array([1]),
        contentType: "audio/webm",
        language: null,
      }),
    ).rejects.toThrow("speech-to-text");
  });

  test("the agent's message lists every note with its time and author", () => {
    const text = decisionMessage({
      handle: "editor-alliance",
      title: "Depoimento Dwight",
      version: 3,
      reviewId: "r1",
      decision: "changes",
      message: "no geral, tá ótimo",
      notes: [
        { atMs: null, body: "cor mais quente", author: "Gabriel" },
        { atMs: 65_000, body: "corte\ncomeu a palavra", author: "Lê" },
        { atMs: 70_200, endMs: 73_900, kind: "text", body: "legenda some cedo", author: "Ronny" },
      ],
    });
    expect(text).toBe(
      [
        "@editor-alliance Ajustes em «Depoimento Dwight» V3 (review_id r1). Faça a V4 e mande com send_for_review e esse review_id.",
        "",
        "no geral, tá ótimo",
        "",
        "Antes da próxima versão: rode a skill self-improve-skill (se você tiver) e grave na sua skill e na sua memória o que destas notas vale para os próximos vídeos.",
        "",
        "Notas:",
        "- [geral] cor mais quente (Gabriel)",
        "- [1:05.0] corte comeu a palavra (Lê)",
        "- [1:10.2–1:13.9] Texto/legenda: legenda some cedo (Ronny)",
      ].join("\n"),
    );
  });

  test("people read the person's words and notes, without the agent's instructions", () => {
    const said = decisionShown({
      message: "no geral, tá ótimo",
      notes: [
        { atMs: 65_000, body: "corte\ncomeu a palavra", author: "Lê", x: 0.5, y: 0.5 },
        {
          atMs: null,
          body: "",
          author: "Gabriel",
          attachments: [{ type: "file", media: "image", name: "ref.png", artifactId: "a2" } as never],
        },
      ],
    });
    expect(said).toBe(
      [
        "no geral, tá ótimo",
        "",
        "- [1:05.0] corte comeu a palavra (Lê)",
        "- [geral] (sem texto: veja o anexo) (Gabriel)",
        "  - Anexo (imagem): ref.png",
      ].join("\n"),
    );
  });

  test("a note may cover a stretch and say what it is about", async () => {
    f = await setup();
    const v1 = await video("short-02.mp4");
    const sent = await sendForReview(deps(), ctx(), { artifactId: v1.id, title: "Short 02", client: "Alliance" });
    const id = sent.review.id;
    const note = await addReviewNote(deps(), f.owner.id, f.org.id, id, {
      version: 1,
      atMs: 6_400,
      endMs: 9_100,
      kind: "cut",
      body: "trecho arrastado",
    });
    expect(note).toMatchObject({ atMs: 6_400, endMs: 9_100, kind: "cut" });
    await expect(
      addReviewNote(deps(), f.owner.id, f.org.id, id, { version: 1, atMs: 9_000, endMs: 8_000, body: "x" }),
    ).rejects.toThrow();
    await expect(
      addReviewNote(deps(), f.owner.id, f.org.id, id, { version: 1, atMs: null, endMs: 8_000, body: "x" }),
    ).rejects.toThrow();
    const full = await getVideoReview(deps(), f.owner.id, f.org.id, id);
    expect(full.notes[0]).toMatchObject({ endMs: 9_100, kind: "cut" });
  });

  test("a review carries what was asked and its links; a note may point at a spot of the picture", async () => {
    f = await setup();
    const v1 = await video("short-03.mp4");
    const sent = await sendForReview(deps(), ctx(), {
      artifactId: v1.id,
      title: "Short 03",
      client: "Alliance",
      brief: "Travis: 1 reel per question.",
      links: [
        { label: "Asana task", url: "https://app.asana.com/0/1/2" },
        { label: "bad", url: "javascript:alert(1)" },
      ],
    });
    const id = sent.review.id;
    let full = await getVideoReview(deps(), f.owner.id, f.org.id, id);
    expect(full.brief).toBe("Travis: 1 reel per question.");
    expect(full.links).toEqual([{ label: "Asana task", url: "https://app.asana.com/0/1/2" }]);

    await setReviewBrief(deps(), ctx(), { reviewId: id, links: [{ label: "Footage", url: "https://f.io/abc" }] });
    full = await getVideoReview(deps(), f.owner.id, f.org.id, id);
    expect(full.brief).toBe("Travis: 1 reel per question.");
    expect(full.links).toEqual([{ label: "Footage", url: "https://f.io/abc" }]);

    const note = await addReviewNote(deps(), f.owner.id, f.org.id, id, {
      version: 1,
      atMs: 2_000,
      x: 0.62,
      y: 1.4,
      body: "logo aqui",
    });
    expect(note).toMatchObject({ x: 0.62, y: 1 });
    await decideVideoReview(deps(), f.owner.id, f.org.id, id, { decision: "changes" });
    const text = decisionMessage({
      handle: "a",
      title: "t",
      version: 1,
      reviewId: "r",
      decision: "changes",
      message: "",
      notes: [{ atMs: 2_000, x: 0.62, y: 0.3, body: "logo aqui", author: "" }],
    });
    expect(text).toContain("- [0:02.0] logo aqui [na tela: 62% da largura, 30% da altura]");
  });

  test("a note hands the editor a photo of the conversation and a B-roll link; the agent is told how to fetch them", async () => {
    f = await setup();
    const v1 = await video("short-04.mp4");
    const sent = await sendForReview(deps(), ctx(), { artifactId: v1.id, title: "Short 04", client: "Alliance" });
    const id = sent.review.id;
    const photo = await createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "familia.jpg",
      name: "familia.jpg",
      bytes: new Uint8Array([255, 216, 255]),
      contentType: "image/jpeg",
      channelId: f.general.id,
    });
    const elsewhere = await createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "drive.jpg",
      name: "drive.jpg",
      bytes: new Uint8Array([255, 216, 255]),
      contentType: "image/jpeg",
    });

    // A file that is not in the video's conversation is refused: the agent couldn't reach it.
    await expect(
      addReviewNote(deps(), f.owner.id, f.org.id, id, {
        version: 1,
        atMs: 1_000,
        attachments: [{ artifactId: elsewhere.id }],
        body: "x",
      }),
    ).rejects.toThrow();
    await expect(
      addReviewNote(deps(), f.owner.id, f.org.id, id, {
        version: 1,
        atMs: 1_000,
        attachments: [{ url: "javascript:alert(1)" }],
        body: "x",
      }),
    ).rejects.toThrow();

    // No words needed: the photo says it.
    const note = await addReviewNote(deps(), f.owner.id, f.org.id, id, {
      version: 1,
      atMs: 4_200,
      kind: "broll",
      attachments: [{ artifactId: photo.id, name: "familia.jpg" }, { url: "https://www.pexels.com/video/123/" }],
      body: "",
    });
    expect(note.attachments).toEqual([
      { type: "file", artifactId: photo.id, name: "familia.jpg", media: "image" },
      { type: "link", url: "https://www.pexels.com/video/123/", label: "www.pexels.com" },
    ]);
    const full = await getVideoReview(deps(), f.owner.id, f.org.id, id);
    expect(full.notes[0]?.attachments).toHaveLength(2);

    await decideVideoReview(deps(), f.owner.id, f.org.id, id, { decision: "changes" });
    const asked = await lastMessage();
    expect(asked?.body).toContain("- [0:04.2] Cards/B-roll: (sem texto: veja o anexo)");
    expect(asked?.body).toContain(`Anexo (imagem): familia.jpg — traga com import_file artifact_id ${photo.id}`);
    expect(asked?.body).toContain("Link: www.pexels.com — https://www.pexels.com/video/123/");
  });

  test("a piece made in a DM is every member's to see, note and decide (doug-0014)", async () => {
    f = await setup();
    const dm = await openDm(f.db, f.owner.id, f.org.id, { agentId: f.agent.id });
    const inDm = (name: string, bytes: number[], contentType: string, who = f.owner.id, placed = false) =>
      createFileArtifact(f.artifactDeps, { type: "person", userId: who }, f.org.id, {
        title: name,
        name,
        bytes: new Uint8Array(bytes),
        contentType,
        channelId: dm.id,
        ...(placed ? { placed: true } : {}),
      });
    const v1 = await inDm("carrossel.mp4", [0, 0, 0, 24, 102, 116, 121, 112], "video/mp4");
    const sent = await sendForReview(deps(), { ...ctx(), channelId: dm.id }, { artifactId: v1.id, title: "Carrossel" });
    const id = sent.review.id;
    const ownerPhoto = await inDm("ref.jpg", [255, 216, 255], "image/jpeg");
    const privateFile = await inDm("privado.jpg", [255, 216, 255], "image/jpeg");
    await addReviewNote(deps(), f.owner.id, f.org.id, id, {
      version: 1,
      atMs: 1_000,
      attachments: [{ artifactId: ownerPhoto.id }],
      body: "como esta",
    });

    // Another owner and a plain member, neither in the DM: both find it and open it.
    const leticia = await addMember(f.db, f.org.id, "owner", "leticia");
    const roni = await addMember(f.db, f.org.id, "member", "roni");
    for (const who of [leticia, roni]) {
      expect((await listVideoReviews(deps(), who.id, f.org.id)).map((r) => r.id)).toEqual([id]);
      expect((await getVideoReview(deps(), who.id, f.org.id, id)).notes).toHaveLength(1);
    }
    // A note's file opens for them; the DM's other files stay its own.
    const reader = { type: "person" as const, userId: roni.id };
    expect((await getArtifact(f.artifactDeps, reader, f.org.id, ownerPhoto.id)).id).toBe(ownerPhoto.id);
    await expect(getArtifact(f.artifactDeps, reader, f.org.id, privateFile.id)).rejects.toThrow();
    // Into the DM only as a review's file (the route's `reviewId`), never on their own.
    await expect(inDm("dela.jpg", [255, 216, 255], "image/jpeg", roni.id)).rejects.toThrow();
    const roniPhoto = await inDm("dela.jpg", [255, 216, 255], "image/jpeg", roni.id, true);
    const note = await addReviewNote(deps(), roni.id, f.org.id, id, {
      version: 1,
      atMs: 2_000,
      attachments: [{ artifactId: roniPhoto.id }],
      body: "troca essa foto",
    });
    expect(note.attachments).toHaveLength(1);

    // Their decision is said in the DM, as them, and starts the agent's work there.
    await decideVideoReview(deps(), leticia.id, f.org.id, id, { decision: "changes" });
    const [said] = await f.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.channelId, dm.id)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);
    expect(said?.authorUserId).toBe(leticia.id);
    expect(said?.body).toContain(`@${f.agent.handle} Ajustes em «Carrossel» V1`);
    expect(said?.body).toContain("troca essa foto (roni)");
    const runs = await f.db
      .select()
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.channelId, dm.id), eq(schema.agentRuns.triggerMessageId, said?.id ?? "")));
    expect(runs.map((r) => r.agentId)).toEqual([f.agent.id]);

    // Someone of no workspace here sees nothing.
    const stranger = await addUser(f.db, "stranger");
    expect(await listVideoReviews(deps(), stranger.id, f.org.id)).toEqual([]);
    await expect(getVideoReview(deps(), stranger.id, f.org.id, id)).rejects.toThrow();
  });

  test("every version gets a light copy for phones; the player gets it, or the original with HD or until it's made", async () => {
    f = await setup();
    const made: number[] = [];
    const light = (fn: (bytes: Uint8Array) => Uint8Array): VideoReviewDeps => ({
      ...deps(),
      lightCopy: async (bytes) => {
        made.push(bytes.byteLength);
        return fn(bytes);
      },
    });
    const small = light(() => new Uint8Array([1, 2, 3]));
    const v1 = await video("short-05.mp4");
    const sent = await sendForReview(small, ctx(), { artifactId: v1.id, title: "Short 05" });
    const id = sent.review.id;

    // Asked once, in the background.
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, REVIEW_LIGHT_JOB));
    expect(jobs).toHaveLength(1);
    const versionId = String((jobs[0]?.payload as { versionId?: string } | undefined)?.versionId);

    // Until it's made, the player gets the original.
    const before = await playedVideo(small, f.owner.id, f.org.id, id, 1);
    expect([before.light, before.body.byteLength]).toEqual([false, 8]);
    expect((await getVideoReview(small, f.owner.id, f.org.id, id)).versions[0]?.light).toBe(false);

    await makeLightCopy(small, versionId, { finalAttempt: false });
    expect(made).toEqual([8]);
    expect((await getVideoReview(small, f.owner.id, f.org.id, id)).versions[0]?.light).toBe(true);
    const after = await playedVideo(small, f.owner.id, f.org.id, id, 1);
    expect([after.light, after.body.byteLength, after.contentType]).toEqual([true, 3, "video/mp4"]);
    const hd = await playedVideo(small, f.owner.id, f.org.id, id, 1, { original: true });
    expect([hd.light, hd.body.byteLength]).toEqual([false, 8]);
    // Made once: running the job again does nothing.
    await makeLightCopy(small, versionId, { finalAttempt: false });
    expect(made).toEqual([8]);

    // Every member plays it, reading the conversation or not (doug-0014); someone of no workspace here doesn't.
    const teammate = await addMember(f.db, f.org.id, "member", "teammate");
    await f.db.update(schema.channels).set({ visibility: "private" }).where(eq(schema.channels.id, f.general.id));
    expect((await playedVideo(small, teammate.id, f.org.id, id, 1)).light).toBe(true);
    const stranger = await addUser(f.db, "stranger");
    await expect(reviewVideo(small, stranger.id, f.org.id, id, 1)).rejects.toThrow();

    // A copy no smaller than the original isn't kept: the original plays.
    const big = light((bytes) => new Uint8Array(bytes.byteLength + 10));
    const v2 = await video("short-05-v2.mp4");
    await sendForReview(big, ctx(), { artifactId: v2.id, reviewId: id, note: "V2" });
    const [second] = await f.db
      .select()
      .from(schema.videoReviewVersions)
      .where(and(eq(schema.videoReviewVersions.reviewId, id), eq(schema.videoReviewVersions.version, 2)));
    await makeLightCopy(big, String(second?.id), { finalAttempt: false });
    expect(
      second &&
        (await f.db.select().from(schema.videoReviewVersions).where(eq(schema.videoReviewVersions.id, second.id)))[0]
          ?.lightState,
    ).toBe("none");
    expect((await playedVideo(big, f.owner.id, f.org.id, id, 2)).light).toBe(false);

    // Without ffmpeg nothing is asked, and the originals play.
    const v3 = await video("short-06.mp4");
    const plain = await sendForReview(deps(), ctx(), { artifactId: v3.id, title: "Short 06" });
    const [third] = await f.db
      .select()
      .from(schema.videoReviewVersions)
      .where(eq(schema.videoReviewVersions.reviewId, plain.review.id));
    expect(third?.lightState).toBe("");
    // A server that can make them makes one for an old version the first time it's opened.
    await getVideoReview(small, f.owner.id, f.org.id, plain.review.id);
    const asked = await f.db
      .select()
      .from(schema.videoReviewVersions)
      .where(eq(schema.videoReviewVersions.id, String(third?.id)));
    expect(asked[0]?.lightState).toBe("pending");
  });
});

/** A version played here: its bytes, never the redirect a master too large to hold gets. */
async function playedVideo(...args: Parameters<typeof reviewVideo>) {
  const played = await reviewVideo(...args);
  if ("redirect" in played) throw new Error(`redirected to ${played.redirect}`);
  return played;
}
