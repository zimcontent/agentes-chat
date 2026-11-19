import { afterEach, describe, expect, test } from "bun:test";
import { createFakeApprovalPortal } from "@dougbot/adapters";
import {
  approvedOnCard,
  createFileArtifact,
  createPortalToolSource,
  decideVideoReview,
  reviewGate,
  SEND_FOR_APPROVAL_TOOL,
  sendForReview,
  type ToolContext,
  type VideoReviewDeps,
} from "../src";
import { type Fixture, setup } from "./fixtures";

// Nothing an agent made goes up for the client's approval before the team approves it in Review (doug-0019), and the
// approved version lands on its post's card.

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const video = (name: string) =>
  createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
    title: name,
    name,
    bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    contentType: "video/mp4",
    channelId: f.general.id,
  });

const ctx = () => ({
  orgId: f.org.id,
  agentId: f.agent.id,
  runId: crypto.randomUUID(),
  channelId: f.general.id,
  threadRootId: "",
  triggerMessageId: "",
});

describe("the review gate", () => {
  test("send_for_approval refuses a file still in review, and sends it once approved", async () => {
    f = await setup();
    const portal = createFakeApprovalPortal({ items: [] });
    const deps: VideoReviewDeps = {
      db: f.db,
      pubsub: f.pubsub,
      artifacts: f.artifactDeps,
      engines: () => [],
      publicUrl: "https://doug.example",
      portal,
    };
    const v1 = await video("reel.mp4");
    const loose = await video("never-reviewed.mp4");
    const sent = await sendForReview(deps, ctx(), { artifactId: v1.id, title: "Reel" });

    const tools = await createPortalToolSource({ portal, artifacts: f.artifactDeps, here: async () => true }).tools({
      ...ctx(),
      db: f.db,
    } as unknown as ToolContext);
    const send = tools.find((t) => t.name === SEND_FOR_APPROVAL_TOOL);
    if (!send) throw new Error("no send tool");
    const call = (ids: string[]) =>
      send.execute({ client: "acme", type: "reel", artifact_ids: ids }, {
        ...ctx(),
        db: f.db,
        toolUseId: crypto.randomUUID(),
      } as unknown as ToolContext);

    const waiting = await call([v1.id]);
    expect(waiting.isError).toBe(true);
    expect(waiting.content).toContain("before the team approves it in Review");
    expect(waiting.content).toContain(sent.review.id);
    expect((await call([loose.id])).isError).toBe(true);
    expect(portal.uploads.size).toBe(0);

    await decideVideoReview(deps, f.owner.id, f.org.id, sent.review.id, { decision: "approve" });
    expect((await reviewGate(f.db, f.org.id, { artifactIds: [v1.id] })).unapproved).toEqual([]);
    const ok = await call([v1.id]);
    expect(ok.isError).toBeFalsy();
    expect(portal.uploads.size).toBe(1);

    // A newer version in review: the old approved file no longer goes, and neither does the new one.
    const v2 = await video("reel-v2.mp4");
    await sendForReview(deps, ctx(), { artifactId: v2.id, reviewId: sent.review.id });
    expect((await reviewGate(f.db, f.org.id, { artifactIds: [v1.id] })).unapproved).toEqual([v1.id]);
    expect((await reviewGate(f.db, f.org.id, { artifactIds: [v2.id] })).unapproved).toEqual([v2.id]);
  });

  test("the approved video goes on its post's card, once", async () => {
    f = await setup();
    const portal = createFakeApprovalPortal({ items: [] });
    const deps: VideoReviewDeps = {
      db: f.db,
      pubsub: f.pubsub,
      artifacts: f.artifactDeps,
      engines: () => [],
      publicUrl: "https://doug.example",
      portal,
    };
    const card = await portal.createCard("acme", { title: "Cole Rd → Asbury", type: "reel" });
    const v1 = await video("reel.mp4");
    const sent = await sendForReview(deps, ctx(), { artifactId: v1.id, title: "Reel" });
    const { schema, eq } = await import("@dougbot/db");
    await f.db
      .update(schema.videoReviews)
      .set({ portalClient: "acme", portalCard: card.id })
      .where(eq(schema.videoReviews.id, sent.review.id));

    await decideVideoReview(deps, f.owner.id, f.org.id, sent.review.id, { decision: "approve" });
    const files = async () => (await portal.cards("acme")).find((c) => c.id === card.id)?.files ?? [];
    expect(await files()).toEqual([{ id: v1.id, name: "reel.mp4" }]);
    expect(await approvedOnCard(f.db, portal, f.org.id, sent.review.id, f.owner.id)).toEqual({
      card: card.id,
      added: 0,
    });
    expect(await files()).toHaveLength(1);
  });
});
