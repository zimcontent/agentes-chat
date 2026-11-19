import { afterEach, describe, expect, test } from "bun:test";
import { type ApprovalPortal, createFakeFileBackup, type PortalJob } from "@dougbot/adapters";
import { and, desc, eq, schema } from "@dougbot/db";
import {
  createFileArtifact,
  createIssue,
  decideVideoReview,
  EDITOR_FINAL_JOB,
  EDITOR_SEND_JOB,
  getVideoReview,
  listVideoReviews,
  openTaskConversation,
  queueEditorFinals,
  runEditorFinal,
  runEditorSend,
  sendPostToClient,
  setAfterApprove,
  setReviewPost,
  submitEditorVideo,
  syncEditorStages,
  taskDelivery,
  type VideoReviewDeps,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

/** An editor's video from a task to the client and the backup (docs/adr/doug-0012-editor-delivery.md). */

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

function fakePortal(card: { id: string; date: string | null; type?: string } | null) {
  const calls: string[] = [];
  const made: { id: string; title: string; type: string; date?: string; task?: string }[] = [];
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
  const portal = {
    upload: async (name: string, bytes: Uint8Array) => {
      calls.push(`upload ${name} ${bytes.byteLength}`);
      return `file-${name}`;
    },
    send: async (input: {
      client: string;
      type: string;
      files: string[];
      cover?: string;
      caption?: string;
      key?: string;
    }) => {
      calls.push(
        `send ${input.client} ${input.type} files=${input.files.join(",")} cover=${input.cover ?? "-"} caption=${input.caption ?? "-"} key=${input.key}`,
      );
      return job;
    },
    newVersion: async (_c: string, item: string, input: { files: string[] }) => {
      calls.push(`version ${item} ${input.files.join(",")}`);
      return job;
    },
    job: async () => job,
    editItem: async (_c: string, item: string, edit: { status?: string }) => {
      calls.push(`edit ${item} ${edit.status}`);
    },
    scheduleItem: async (_c: string, item: string, when: string) => {
      calls.push(`schedule ${item} ${when}`);
    },
    cards: async () => [
      ...(card ? [{ type: "reel", ...card, client: "lexeer" }] : []),
      ...made.map((c) => ({ ...c, client: "lexeer" })),
    ],
    createCard: async (_c: string, input: { title: string; type: string; date?: string; task?: string }) => {
      const made_ = { id: `card-new-${made.length + 1}`, item: null, ...input };
      made.push(made_);
      calls.push(
        `card ${input.title} ${input.type} date=${input.date ?? "-"} task=${input.task === undefined ? "-" : "yes"}`,
      );
      return made_;
    },
  } as unknown as ApprovalPortal;
  return { portal, calls, made };
}

function deps(portal: ApprovalPortal | null, backup = createFakeFileBackup()) {
  const d: VideoReviewDeps = {
    db: f.db,
    pubsub: f.pubsub,
    artifacts: f.artifactDeps,
    engines: () => [],
    publicUrl: "https://doug.example",
    portal,
    backup,
  };
  return { d, backup };
}

/** A portal task (ADR 9001 §11) whose card is in `stage`, and the editor who has it. */
async function portalTask(stage = "doing") {
  const editor = await addMember(f.db, f.org.id, "member", "ronny");
  await f.db
    .update(schema.organizationMembers)
    .set({ handle: "ronny" })
    .where(eq(schema.organizationMembers.userId, editor.id));
  const task = await createIssue({ db: f.db, pubsub: f.pubsub }, { type: "person", userId: f.owner.id }, f.org.id, {
    title: "Reel Glenwood",
  });
  await f.db
    .update(schema.issues)
    .set({
      source: {
        type: "portal",
        client: "lexeer",
        cardId: "card-7",
        synced: { card: { stage } },
      },
    })
    .where(eq(schema.issues.id, task.id));
  return { editor, taskId: task.id };
}

async function setStage(taskId: string, stage: string) {
  await f.db
    .update(schema.issues)
    .set({ source: { type: "portal", client: "lexeer", cardId: "card-7", synced: { card: { stage } } } })
    .where(eq(schema.issues.id, taskId));
}

/** A file the editor uploaded to the task's conversation. */
async function upload(userId: string, taskId: string, name: string, bytes = MP4) {
  const at = await openTaskConversation(f.db, { type: "person", userId }, f.org.id, taskId);
  return createFileArtifact(f.artifactDeps, { type: "person", userId }, f.org.id, {
    title: name,
    name,
    bytes,
    contentType: name.endsWith(".jpg") ? "image/jpeg" : "video/mp4",
    channelId: at.channelId,
    threadId: at.rootId,
  });
}

async function lastBody(channelId: string) {
  const [row] = await f.db
    .select({ body: schema.messages.body, mentioned: schema.messages.mentionedUserIds })
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.channelId, channelId)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return row ?? { body: "", mentioned: [] as string[] };
}

const jobsOf = async (kind: string) =>
  f.db
    .select()
    .from(schema.outbox)
    .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, kind)));

describe("editor delivery", () => {
  test("the editor sends from the task; the review lives in its conversation and the decision comes back to them", async () => {
    f = await setup({ rightHand: true });
    const { d } = deps(null);
    const { editor, taskId } = await portalTask();
    const file = await upload(editor.id, taskId, "glenwood-v1.mov");
    const sent = await submitEditorVideo(d, editor.id, f.org.id, taskId, { artifactId: file.id, note: "primeira" });
    expect(sent.toClient).toBe(false);
    expect(sent.review.sender?.id).toBe(editor.id);
    expect(sent.review.agent).toBeNull();
    expect(sent.review.taskId).toBe(taskId);
    expect((await taskDelivery(d, f.owner.id, f.org.id, taskId)).reviewId).toBe(sent.review.id);
    // Whoever sees the task reviews it.
    expect((await listVideoReviews(d, f.owner.id, f.org.id)).map((r) => r.id)).toContain(sent.review.id);
    const view = await getVideoReview(d, f.owner.id, f.org.id, sent.review.id);
    expect(view.task?.stage).toBe("doing");
    expect(view.portal?.client).toBe("lexeer");
    expect((await lastBody(view.channelId)).body).toContain("Enviei a V1 de «Reel Glenwood» para revisão.");

    // Changes: the notes go to the editor, named, and no agent starts.
    await f.db.insert(schema.videoReviewNotes).values({
      orgId: f.org.id,
      reviewId: sent.review.id,
      version: 1,
      atMs: 4200,
      body: "corte seco aqui",
      authorUserId: f.owner.id,
    });
    await decideVideoReview(d, f.owner.id, f.org.id, sent.review.id, { decision: "changes" });
    const asked = await lastBody(view.channelId);
    expect(asked.body).toContain("Ajustes em «Reel Glenwood» V1. Quando terminar, mande a V2 na tarefa");
    expect(asked.body).toContain("[0:04.2] corte seco aqui");
    expect(asked.mentioned).toContain(editor.id);
    expect(await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, f.org.id))).toHaveLength(0);

    // V2, approved: the cover and the caption are what's left.
    const v2 = await upload(editor.id, taskId, "glenwood-v2.mp4");
    const again = await submitEditorVideo(d, editor.id, f.org.id, taskId, {
      artifactId: v2.id,
      reviewId: sent.review.id,
    });
    expect(again.review.version).toBe(2);
    expect(again.review.status).toBe("in_review");
    await decideVideoReview(d, f.owner.id, f.org.id, sent.review.id, { decision: "approve" });
    expect((await lastBody(view.channelId)).body).toContain("Agora faltam a capa e a legenda, na tarefa.");
  });

  test("a file outside the task's conversation, or not a video, is refused", async () => {
    f = await setup();
    const { d } = deps(null);
    const { editor, taskId } = await portalTask();
    const elsewhere = await createFileArtifact(f.artifactDeps, { type: "person", userId: editor.id }, f.org.id, {
      title: "x.mp4",
      name: "x.mp4",
      bytes: MP4,
      contentType: "video/mp4",
      channelId: f.general.id,
    });
    await expect(submitEditorVideo(d, editor.id, f.org.id, taskId, { artifactId: elsewhere.id })).rejects.toThrow(
      /task's conversation/,
    );
    const picture = await upload(editor.id, taskId, "capa.jpg", JPG);
    await expect(submitEditorVideo(d, editor.id, f.org.id, taskId, { artifactId: picture.id })).rejects.toThrow(
      /not a video/,
    );
  });

  test("approved video, cover and caption: the post goes to the client, then the final is kept and backed up", async () => {
    f = await setup({ rightHand: true });
    const { portal, calls } = fakePortal({ id: "card-7", date: null });
    const { d, backup } = deps(portal);
    const { editor, taskId } = await portalTask();
    const file = await upload(editor.id, taskId, "glenwood.mp4");
    const { review } = await submitEditorVideo(d, editor.id, f.org.id, taskId, { artifactId: file.id });
    await decideVideoReview(d, f.owner.id, f.org.id, review.id, { decision: "approve" });

    // Not before the caption and the cover are approved.
    await expect(sendPostToClient(d, f.owner.id, f.org.id, review.id)).rejects.toThrow(/caption/);
    await expect(setReviewPost(d, f.owner.id, f.org.id, review.id, { captionOk: true })).rejects.toThrow(/caption/);
    await setReviewPost(d, f.owner.id, f.org.id, review.id, { caption: "Glenwood vendida 🏡" });
    await setReviewPost(d, f.owner.id, f.org.id, review.id, { captionOk: true });
    const cover = await upload(editor.id, taskId, "capa.jpg", JPG);
    await setReviewPost(d, f.owner.id, f.org.id, review.id, { cover: cover.id });
    const post = await setReviewPost(d, f.owner.id, f.org.id, review.id, { coverOk: true });
    expect(post).toMatchObject({ captionOk: true, coverOk: true, cover: cover.id });
    // Editing the caption takes its approval back.
    expect((await setReviewPost(d, f.owner.id, f.org.id, review.id, { caption: "outra" })).captionOk).toBe(false);
    await setReviewPost(d, f.owner.id, f.org.id, review.id, { caption: "Glenwood vendida 🏡", captionOk: true });

    const sending = await sendPostToClient(d, f.owner.id, f.org.id, review.id);
    expect(sending.afterApprove).toBe("portal");
    const [job] = await jobsOf(EDITOR_SEND_JOB);
    await runEditorSend(d, job?.payload as never);
    // Without ffmpeg here, the original goes (it fits the portal).
    expect(calls).toEqual([
      "upload Reel-Glenwood-capa.jpg 6",
      "upload Reel-Glenwood.mp4 12",
      "send lexeer reel files=file-Reel-Glenwood.mp4 cover=file-Reel-Glenwood-capa.jpg caption=Glenwood vendida 🏡 key=editor:" +
        `${review.id}:v1`,
    ]);
    const view = await getVideoReview(d, f.owner.id, f.org.id, review.id);
    expect(view.delivery).toMatchObject({ state: "sent", item: "item-9" });
    expect((await lastBody(view.channelId)).body).toContain("foi para a aprovação do cliente no portal");
    // Fixed from now on.
    await expect(setReviewPost(d, f.owner.id, f.org.id, review.id, { caption: "x" })).rejects.toThrow(/portal/);

    // The client hasn't approved yet: no final.
    expect(await queueEditorFinals(f.db, f.org.id)).toBe(0);
    await setStage(taskId, "approved");
    expect(await queueEditorFinals(f.db, f.org.id)).toBe(1);
    // Queued once.
    expect(await queueEditorFinals(f.db, f.org.id)).toBe(0);
    expect(await jobsOf(EDITOR_FINAL_JOB)).toHaveLength(1);
    await runEditorFinal(d, { reviewId: review.id }, { finalAttempt: false });
    const kept = await getVideoReview(d, f.owner.id, f.org.id, review.id);
    expect(kept.final).toMatchObject({ state: "backed_up", version: 1, artifactId: file.id });
    const [key] = [...backup.files.keys()];
    expect(key).toMatch(/^Acme\/lexeer\/\d{4}-\d{2}-\d{2} - Reel Glenwood\.mp4$/);
    expect(backup.files.get(key as string)?.byteLength).toBe(MP4.byteLength);
    expect((await lastBody(view.channelId)).body).toContain("com cópia no Google Drive");
  });

  test("a `direct` client: approved and kept as final at once, never scheduled on its card's day", async () => {
    f = await setup({ rightHand: true });
    const { portal, calls } = fakePortal({ id: "card-7", date: "2099-01-02T10:00" });
    const { d } = deps(portal);
    await setAfterApprove(f.db, f.org.id, "lexeer", "direct", f.owner.id);
    const { editor, taskId } = await portalTask();
    const file = await upload(editor.id, taskId, "glenwood.mp4");
    const { review } = await submitEditorVideo(d, editor.id, f.org.id, taskId, { artifactId: file.id });
    await decideVideoReview(d, f.owner.id, f.org.id, review.id, { decision: "approve" });
    await setReviewPost(d, f.owner.id, f.org.id, review.id, {
      caption: "ok",
      captionOk: true,
      noCover: true,
      coverOk: true,
    });
    await sendPostToClient(d, f.owner.id, f.org.id, review.id);
    const [job] = await jobsOf(EDITOR_SEND_JOB);
    await runEditorSend(d, job?.payload as never);
    // Scheduling is a person's, at the Portal (ADR 9001, addendum 2026-11-17).
    expect(calls.at(-1)).toBe("edit item-9 approved");
    expect(calls.some((c) => c.startsWith("schedule"))).toBe(false);
    expect(await jobsOf(EDITOR_FINAL_JOB)).toHaveLength(1);
  });

  test("the client asks for a change: the editor's next version goes straight to them", async () => {
    f = await setup({ rightHand: true });
    const { portal, calls } = fakePortal({ id: "card-7", date: null });
    const { d } = deps(portal);
    const { editor, taskId } = await portalTask();
    const file = await upload(editor.id, taskId, "glenwood.mp4");
    const { review } = await submitEditorVideo(d, editor.id, f.org.id, taskId, { artifactId: file.id });
    await decideVideoReview(d, f.owner.id, f.org.id, review.id, { decision: "approve" });
    await setReviewPost(d, f.owner.id, f.org.id, review.id, {
      caption: "ok",
      captionOk: true,
      noCover: true,
      coverOk: true,
    });
    await sendPostToClient(d, f.owner.id, f.org.id, review.id);
    await runEditorSend(d, (await jobsOf(EDITOR_SEND_JOB))[0]?.payload as never);
    await setStage(taskId, "approval");

    // With the client and nothing asked: a new version waits.
    const early = await upload(editor.id, taskId, "glenwood-v2.mp4");
    await expect(
      submitEditorVideo(d, editor.id, f.org.id, taskId, { artifactId: early.id, reviewId: review.id }),
    ).rejects.toThrow(/with the client/);
    await setStage(taskId, "adjusting");
    const sent = await submitEditorVideo(d, editor.id, f.org.id, taskId, {
      artifactId: early.id,
      reviewId: review.id,
    });
    expect(sent.toClient).toBe(true);
    expect(sent.review.status).toBe("approved");
    const jobs = await jobsOf(EDITOR_SEND_JOB);
    const version = jobs.find((j) => (j.payload as { kind?: string }).kind === "version");
    await runEditorSend(d, version?.payload as never);
    expect(calls.at(-1)).toBe("version item-9 file-Reel-Glenwood.mp4");
  });

  test("a task that asks for several videos: each is its own review and post, numbered in the task", async () => {
    f = await setup({ rightHand: true });
    const { portal, calls, made } = fakePortal({ id: "card-7", date: "2099-01-02T10:00" });
    const { d } = deps(portal);
    const { editor, taskId } = await portalTask();
    const first = await submitEditorVideo(d, editor.id, f.org.id, taskId, {
      artifactId: (await upload(editor.id, taskId, "a.mp4")).id,
    });
    // One video: the task's own title.
    expect(first.review).toMatchObject({ title: "Reel Glenwood", taskPart: 1, taskNumber: expect.any(Number) });
    const second = await submitEditorVideo(d, editor.id, f.org.id, taskId, {
      artifactId: (await upload(editor.id, taskId, "b.mp4")).id,
    });
    const third = await submitEditorVideo(d, editor.id, f.org.id, taskId, {
      artifactId: (await upload(editor.id, taskId, "c.mp4")).id,
    });
    // Each file sent to the task is a video of its own, at V1, and the first is renamed as one of them.
    expect([second.review.version, third.review.version]).toEqual([1, 1]);
    expect(third.review).toMatchObject({ title: "Reel Glenwood · Vídeo 3", taskPart: 3, taskTitle: "Reel Glenwood" });
    const task = await taskDelivery(d, f.owner.id, f.org.id, taskId);
    expect(task.reviewIds).toEqual([first.review.id, second.review.id, third.review.id]);
    const list = await listVideoReviews(d, f.owner.id, f.org.id);
    expect(list.find((r) => r.id === first.review.id)?.title).toBe("Reel Glenwood · Vídeo 1");

    // A new version goes to the video it names, and only to a video of this task.
    const changes = await submitEditorVideo(d, editor.id, f.org.id, taskId, {
      artifactId: (await upload(editor.id, taskId, "b2.mp4")).id,
      reviewId: second.review.id,
    });
    expect(changes.review).toMatchObject({ id: second.review.id, version: 2 });
    const other = await createIssue({ db: f.db, pubsub: f.pubsub }, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "Outra",
    });
    const foreign = await submitEditorVideo(d, editor.id, f.org.id, other.id, {
      artifactId: (await upload(editor.id, other.id, "x.mp4")).id,
    });
    await expect(
      submitEditorVideo(d, editor.id, f.org.id, taskId, {
        artifactId: (await upload(editor.id, taskId, "y.mp4")).id,
        reviewId: foreign.review.id,
      }),
    ).rejects.toThrow(/not one of this task's/);

    // Each approved video is its own post: the first finishes the task's card, the next gets a card of its own,
    // tied to the same task and on the same day.
    const ready = async (id: string) => {
      await decideVideoReview(d, f.owner.id, f.org.id, id, { decision: "approve" });
      await setReviewPost(d, f.owner.id, f.org.id, id, {
        caption: "ok",
        captionOk: true,
        noCover: true,
        coverOk: true,
      });
      await sendPostToClient(d, f.owner.id, f.org.id, id);
    };
    await ready(first.review.id);
    await ready(third.review.id);
    for (const job of await jobsOf(EDITOR_SEND_JOB)) await runEditorSend(d, job.payload as never);
    expect(made).toHaveLength(1);
    expect(calls).toContain("card Reel Glenwood · Vídeo 3 reel date=2099-01-02T10:00 task=yes");
    const thirdView = await getVideoReview(d, f.owner.id, f.org.id, third.review.id);
    expect(thirdView.delivery).toMatchObject({ state: "sent", item: "item-9" });
    const [row] = await f.db.select().from(schema.videoReviews).where(eq(schema.videoReviews.id, third.review.id));
    expect(row?.portalCard).toBe("card-new-1");

    // Where each post stands is its own: read from the post at the portal, not from the task's card.
    await f.db
      .update(schema.videoReviews)
      .set({ delivery: { state: "sent", item: "item-3", at: new Date().toISOString() } })
      .where(eq(schema.videoReviews.id, third.review.id));
    const item = (id: string, status: string) =>
      ({ id, client: "lexeer", status }) as unknown as Parameters<typeof syncEditorStages>[2][number];
    await syncEditorStages(f.db, f.org.id, [item("item-9", "sent"), item("item-3", "approved")]);
    expect((await getVideoReview(d, f.owner.id, f.org.id, third.review.id)).task?.stage).toBe("approved");
    expect((await getVideoReview(d, f.owner.id, f.org.id, first.review.id)).task?.stage).toBe("approval");
    // Only the one the client approved is kept as the final.
    expect(await queueEditorFinals(f.db, f.org.id)).toBe(1);
  });
});
