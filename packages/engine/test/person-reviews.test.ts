import { afterEach, describe, expect, test } from "bun:test";
import { and, desc, eq, schema } from "@dougbot/db";
import {
  addReviewNote,
  createFileArtifact,
  createIssue,
  decideVideoReview,
  listVideoReviews,
  openTaskConversation,
  sendPersonWork,
  type VideoReviewDeps,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** A person's work sent for review from Revisão (docs/adr/doug-0015-team-work-review.md). */

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

const deps = (): VideoReviewDeps => ({
  db: f.db,
  pubsub: f.pubsub,
  artifacts: f.artifactDeps,
  engines: () => [],
  publicUrl: "https://doug.example",
  portal: null,
});

async function upload(userId: string, channelId: string, name: string, threadId: string | null = null) {
  return createFileArtifact(f.artifactDeps, { type: "person", userId }, f.org.id, {
    title: name,
    name,
    bytes: name.endsWith(".png") ? PNG : MP4,
    contentType: name.endsWith(".png") ? "image/png" : "video/mp4",
    channelId,
    threadId,
  });
}

async function lastBody(channelId: string) {
  const [row] = await f.db
    .select({ body: schema.messages.body, authorUserId: schema.messages.authorUserId })
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.channelId, channelId)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return row ?? { body: "", authorUserId: null };
}

describe("a person's work in review", () => {
  test("a design piece sent to a group: its slides, the line there, the decision back to them and the next version", async () => {
    f = await setup({ rightHand: true });
    const d = deps();
    const designer = f.owner;
    const lead = await addMember(f.db, f.org.id, "member", "lia");
    const slides = [
      await upload(designer.id, f.general.id, "capa.png"),
      await upload(designer.id, f.general.id, "lamina-2.png"),
    ];
    const sent = await sendPersonWork(d, designer.id, f.org.id, {
      medium: "design",
      files: slides.map((s) => s.id),
      title: "Carrossel Glenwood",
      channelId: f.general.id,
    });
    expect(sent.review.medium).toBe("design");
    expect(sent.review.sender?.id).toBe(designer.id);
    expect(sent.review.agent).toBeNull();
    expect(sent.review.status).toBe("in_review");
    const said = await lastBody(f.general.id);
    expect(said.body).toBe("Enviei a V1 de «Carrossel Glenwood» (a peça) para revisão.");
    expect(said.authorUserId).toBe(designer.id);
    // Every member sees it (doug-0014).
    expect((await listVideoReviews(d, lead.id, f.org.id)).map((r) => r.id)).toEqual([sent.review.id]);

    await addReviewNote(d, lead.id, f.org.id, sent.review.id, {
      version: 1,
      atMs: null,
      page: 2,
      x: 0.5,
      y: 0.2,
      body: "Título menor",
    });
    const decided = await decideVideoReview(d, lead.id, f.org.id, sent.review.id, { decision: "changes" });
    expect(decided.status).toBe("changes");
    const back = await lastBody(f.general.id);
    expect(back.body).toContain("Ajustes em «Carrossel Glenwood» V1");
    expect(back.body).toContain("na Revisão, em Mandar nova versão");
    expect(back.body).toContain("- [lâmina 2] Título menor");

    // Only who sent it sends the next version, the same kind of work.
    const v2 = await upload(designer.id, f.general.id, "capa-v2.png");
    await expect(
      sendPersonWork(d, lead.id, f.org.id, { medium: "design", files: [v2.id], reviewId: sent.review.id }),
    ).rejects.toMatchObject({ code: "video_review.not_yours" });
    await expect(
      sendPersonWork(d, designer.id, f.org.id, { medium: "video", files: [v2.id], reviewId: sent.review.id }),
    ).rejects.toMatchObject({ code: "video_review.wrong_medium" });
    const next = await sendPersonWork(d, designer.id, f.org.id, {
      medium: "design",
      files: [v2.id],
      reviewId: sent.review.id,
    });
    expect(next.review.version).toBe(2);
    expect(next.review.status).toBe("in_review");

    const approved = await decideVideoReview(d, lead.id, f.org.id, sent.review.id, { decision: "approve" });
    expect(approved.status).toBe("approved");
    expect((await lastBody(f.general.id)).body).toContain("Peça aprovada: «Carrossel Glenwood» V2.");
  });

  test("a video sent to a group, with no task: the light copy's video, and the files must be of their kind", async () => {
    f = await setup();
    const d = deps();
    const video = await upload(f.owner.id, f.general.id, "corte.mp4");
    const picture = await upload(f.owner.id, f.general.id, "foto.png");
    await expect(
      sendPersonWork(d, f.owner.id, f.org.id, {
        medium: "video",
        files: [picture.id],
        title: "Corte",
        channelId: f.general.id,
      }),
    ).rejects.toMatchObject({ code: "video_review.not_video" });
    await expect(
      sendPersonWork(d, f.owner.id, f.org.id, {
        medium: "design",
        files: [video.id],
        title: "X",
        channelId: f.general.id,
      }),
    ).rejects.toMatchObject({ code: "video_review.not_picture" });
    await expect(
      sendPersonWork(d, f.owner.id, f.org.id, { medium: "video", files: [video.id], title: "Corte" }),
    ).rejects.toMatchObject({ code: "video_review.no_place" });
    await expect(
      sendPersonWork(d, f.owner.id, f.org.id, { medium: "video", files: [video.id], channelId: f.general.id }),
    ).rejects.toMatchObject({ code: "video_review.no_title" });
    const sent = await sendPersonWork(d, f.owner.id, f.org.id, {
      medium: "video",
      files: [video.id],
      title: "Corte",
      channelId: f.general.id,
    });
    expect(sent.review.medium).toBe("video");
    expect(sent.review.sender?.id).toBe(f.owner.id);
  });

  test("a file uploaded elsewhere is refused; a task's video follows the task's delivery", async () => {
    f = await setup();
    const d = deps();
    const editor = await addMember(f.db, f.org.id, "member", "ronny");
    const task = await createIssue({ db: f.db, pubsub: f.pubsub }, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "Reel do evento",
    });
    const at = await openTaskConversation(f.db, { type: "person", userId: editor.id }, f.org.id, task.id);
    const elsewhere = await upload(f.owner.id, f.general.id, "solto.mp4");
    await expect(
      sendPersonWork(d, editor.id, f.org.id, { medium: "video", files: [elsewhere.id], taskId: task.id }),
    ).rejects.toMatchObject({ code: "editor_delivery.bad_file" });
    const file = await upload(editor.id, at.channelId, "evento.mov", at.rootId);
    const sent = await sendPersonWork(d, editor.id, f.org.id, { medium: "video", files: [file.id], taskId: task.id });
    expect(sent.review.title).toBe("Reel do evento");
    const [row] = await f.db.select().from(schema.videoReviews).where(eq(schema.videoReviews.id, sent.review.id));
    expect(row?.taskId).toBe(task.id);
    expect(row?.channelId).toBe(at.channelId);
  });

  test("a design piece for a task lives in the task's conversation, titled by the task", async () => {
    f = await setup();
    const d = deps();
    const task = await createIssue({ db: f.db, pubsub: f.pubsub }, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "Post de lançamento",
    });
    const at = await openTaskConversation(f.db, { type: "person", userId: f.owner.id }, f.org.id, task.id);
    const slide = await upload(f.owner.id, at.channelId, "post.png", at.rootId);
    const sent = await sendPersonWork(d, f.owner.id, f.org.id, {
      medium: "design",
      files: [slide.id],
      taskId: task.id,
    });
    expect(sent.review.title).toBe("Post de lançamento");
    const [row] = await f.db.select().from(schema.videoReviews).where(eq(schema.videoReviews.id, sent.review.id));
    expect(row?.channelId).toBe(at.channelId);
    expect(row?.threadId).toBe(at.rootId);
  });
});
