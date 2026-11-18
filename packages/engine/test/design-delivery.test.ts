import { afterEach, describe, expect, test } from "bun:test";
import type { ApprovalPortal, PortalJob } from "@agenteschat/adapters";
import { and, desc, eq, schema } from "@agenteschat/db";
import {
  afterApproveOf,
  createFileArtifact,
  DESIGN_DELIVER_JOB,
  decideVideoReview,
  deliverDesign,
  getVideoReview,
  sendDesignForReview,
  setAfterApprove,
  type VideoReviewDeps,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/** After "Aprovar" on a design piece (docs/adr/doug-0010-design-review.md §8): the portal, by code, per client. */

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

/** A portal that answers at once and writes down what it was asked. */
function fakePortal(card: { id: string; date: string | null; caption?: string } | null) {
  const calls: string[] = [];
  const captions: (string | undefined)[] = [];
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
    upload: async (name: string) => {
      calls.push(`upload ${name}`);
      return `file-${name}`;
    },
    send: async (input: {
      client: string;
      type: string;
      files: string[];
      card?: string;
      key?: string;
      caption?: string;
    }) => {
      captions.push(input.caption);
      calls.push(`send ${input.client} ${input.type} ${input.files.length} card=${input.card ?? "-"} key=${input.key}`);
      return job;
    },
    job: async () => job,
    editItem: async (_c: string, item: string, edit: { status?: string }) => {
      calls.push(`edit ${item} ${edit.status}`);
    },
    scheduleItem: async (_c: string, item: string, when: string) => {
      calls.push(`schedule ${item} ${when}`);
    },
    cards: async () => (card ? [{ ...card, client: "lexeer" }] : []),
  } as unknown as ApprovalPortal;
  return { portal, calls, captions };
}

const deps = (portal: ApprovalPortal | null): VideoReviewDeps => ({
  db: f.db,
  pubsub: f.pubsub,
  artifacts: f.artifactDeps,
  engines: () => [],
  publicUrl: "https://doug.example",
  portal,
});

const ctx = () => ({
  orgId: f.org.id,
  agentId: f.agent.id,
  runId: crypto.randomUUID(),
  channelId: f.general.id,
  threadRootId: "",
  triggerMessageId: "",
});

async function approvedPiece(portal: ApprovalPortal | null, card: string | null, caption?: string) {
  const slides = [];
  for (const name of ["01.png", "02.png"]) {
    slides.push(
      await createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
        title: name,
        name,
        bytes: PNG,
        contentType: "image/png",
        channelId: f.general.id,
      }),
    );
  }
  const sent = await sendDesignForReview(deps(portal), ctx(), {
    pages: slides.map((s) => s.id),
    title: "Glenwood vendida",
    portalClient: "LEXEER",
  });
  if (card)
    await f.db.update(schema.videoReviews).set({ portalCard: card }).where(eq(schema.videoReviews.id, sent.review.id));
  await decideVideoReview(deps(portal), f.owner.id, f.org.id, sent.review.id, {
    decision: "approve",
    ...(caption !== undefined ? { caption } : {}),
  });
  return sent.review.id;
}

const lastBody = async () => {
  const [row] = await f.db
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.channelId, f.general.id)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return row?.body ?? "";
};

describe("design delivery", () => {
  test("each client is `portal` until the team says `direct`", async () => {
    f = await setup();
    expect(await afterApproveOf(f.db, f.org.id, "elmx")).toBe("portal");
    await setAfterApprove(f.db, f.org.id, "elmx", "direct", f.owner.id);
    expect(await afterApproveOf(f.db, f.org.id, "elmx")).toBe("direct");
    await setAfterApprove(f.db, f.org.id, "elmx", "portal", f.owner.id);
    expect(await afterApproveOf(f.db, f.org.id, "elmx")).toBe("portal");
  });

  test("approved for a `portal` client: the slides go to the client's approval, said in the conversation", async () => {
    f = await setup({ rightHand: true });
    const { portal, calls } = fakePortal(null);
    const id = await approvedPiece(portal, "card-7");
    // The decision tells the agent the server delivers it.
    const decision = await lastBody();
    expect(decision).toContain("O DougBot já está subindo esta versão ao portal (lexeer), para a aprovação do cliente");
    const [job] = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, DESIGN_DELIVER_JOB)));
    expect(job?.payload).toMatchObject({ reviewId: id, version: 1 });

    await deliverDesign({ ...deps(portal), portal }, id, 1);
    expect(calls).toEqual(["upload 01.png", "upload 02.png", `send lexeer carousel 2 card=card-7 key=review:${id}:v1`]);
    expect(await lastBody()).toBe(
      "«Glenwood vendida» foi para a aprovação do cliente no portal. https://portal.example/p/item-9",
    );
    const view = await getVideoReview(deps(portal), f.owner.id, f.org.id, id);
    expect(view.portal).toEqual({ client: "lexeer", afterApprove: "portal" });
    expect(view.delivery).toMatchObject({ state: "sent", item: "item-9" });

    // Run again (a retried job): nothing is sent twice.
    await deliverDesign({ ...deps(portal), portal }, id, 1);
    expect(calls.filter((c) => c.startsWith("send")).length).toBe(1);
  });

  test("the caption goes up with the slides: the card's, or the one confirmed beside Aprovar", async () => {
    f = await setup({ rightHand: true });
    const card = { id: "card-7", date: null, caption: "Vendida! #glenwood" };
    const { portal, captions } = fakePortal(card);
    // Before the decision the page shows the card's caption, to confirm or change.
    const first = await approvedPiece(portal, "card-7");
    await deliverDesign({ ...deps(portal), portal }, first, 1);
    expect(captions).toEqual(["Vendida! #glenwood"]);

    const second = await approvedPiece(portal, "card-7", "  Outra legenda  ");
    await deliverDesign({ ...deps(portal), portal }, second, 1);
    expect(captions.at(-1)).toBe("Outra legenda");
  });

  test("before Aprovar, the review shows the card's caption", async () => {
    f = await setup({ rightHand: true });
    const { portal } = fakePortal({ id: "card-7", date: null, caption: "Do cartão" });
    const slide = await createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "01.png",
      name: "01.png",
      bytes: PNG,
      contentType: "image/png",
      channelId: f.general.id,
    });
    const sent = await sendDesignForReview(deps(portal), ctx(), {
      pages: [slide.id],
      title: "Peça",
      portalClient: "lexeer",
    });
    await f.db
      .update(schema.videoReviews)
      .set({ portalCard: "card-7" })
      .where(eq(schema.videoReviews.id, sent.review.id));
    const view = await getVideoReview(deps(portal), f.owner.id, f.org.id, sent.review.id);
    expect(view.portal?.caption).toBe("Do cartão");
  });

  test("approved for a `direct` client: approved at the portal, never scheduled, even with a day on the card", async () => {
    f = await setup({ rightHand: true });
    await setAfterApprove(f.db, f.org.id, "lexeer", "direct", f.owner.id);
    const { portal, calls } = fakePortal({ id: "card-7", date: "2099-11-18T10:00" });
    const id = await approvedPiece(portal, "card-7");
    expect(await lastBody()).toContain("aprovado direto (sem aprovação do cliente), sem data: quem agenda é a equipe");
    await deliverDesign({ ...deps(portal), portal }, id, 1);
    // Scheduling is a person's, at the Portal (ADR 9001, addendum 2026-11-17): the card's day schedules nothing.
    expect(calls).toContain("edit item-9 approved");
    expect(calls.some((c) => c.startsWith("schedule"))).toBe(false);
    expect(await lastBody()).toBe(
      "«Glenwood vendida» aprovado e pronto no portal. Quando sai é a equipe que decide: agende o post no Portal, com o dia e a hora. https://portal.example/p/item-9",
    );
  });

  test("no portal on the server, or no client known: the agent delivers as before", async () => {
    f = await setup();
    const id = await approvedPiece(null, null);
    const [job] = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, f.org.id), eq(schema.outbox.kind, DESIGN_DELIVER_JOB)));
    expect(job).toBeUndefined();
    expect(await lastBody()).not.toContain("portal");
    void id;
  });
});
