import { afterEach, describe, expect, test } from "bun:test";
import type { SpeechEngine } from "@agenteschat/adapters";
import { and, desc, eq, schema } from "@agenteschat/db";
import {
  addReviewNote,
  addVoiceReviewNote,
  createFileArtifact,
  decideVideoReview,
  decisionMessage,
  deleteReviewNote,
  getVideoReview,
  listVideoReviews,
  sendForReview,
  timecode,
  type VideoReviewDeps,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

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
    expect(timecode(0)).toBe("0:00");
    expect(timecode(83_400)).toBe("1:23");
    expect(timecode(3_725_000)).toBe("1:02:05");
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
    expect(asked?.body.indexOf("[geral] cor mais quente")).toBeLessThan(asked?.body.indexOf("[0:04]") ?? 0);
    expect(asked?.body.indexOf("[0:04] tira esse corte")).toBeLessThan(asked?.body.indexOf("[0:12] logo maior") ?? 0);

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
    // bia isn't in `general`: the review isn't hers to see.
    await expect(listVideoReviews(deps(), bia.id, f.org.id)).resolves.toEqual([]);
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
      ],
    });
    expect(text).toBe(
      [
        "@editor-alliance Ajustes em «Depoimento Dwight» V3 (review_id r1). Faça a V4 e mande com send_for_review e esse review_id.",
        "",
        "no geral, tá ótimo",
        "",
        "Notas:",
        "- [geral] cor mais quente (Gabriel)",
        "- [1:05] corte comeu a palavra (Lê)",
      ].join("\n"),
    );
  });
});
