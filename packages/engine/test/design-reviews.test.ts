import { afterEach, describe, expect, test } from "bun:test";
import { and, desc, eq, schema } from "@dougbot/db";
import {
  addReviewNote,
  createAgent,
  createDesignReviewToolSource,
  createFileArtifact,
  decideVideoReview,
  designPage,
  designSource,
  getVideoReview,
  listVideoReviews,
  openAgentDm,
  outsideReferences,
  saveDesignEdit,
  sendDesignForReview,
  sendForReview,
  type VideoReviewDeps,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/** Design review (docs/adr/doug-0010-design-review.md): slides, notes on a slide's point, edits by hand. */

let f: Fixture;
afterEach(async () => {
  await f?.close();
  f = undefined as unknown as Fixture;
});

const deps = (): VideoReviewDeps => ({
  db: f.db,
  pubsub: f.pubsub,
  artifacts: f.artifactDeps,
  engines: () => [],
  publicUrl: "https://doug.example",
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PAGE = `<!doctype html><html><body>
<section class="slide" style="width:1080px;height:1350px"><h1 data-layer="Título">Venda</h1>
<img data-layer="Foto" src="data:image/png;base64,iVBORw0KGgo="></section>
<section class="slide" style="width:1080px;height:1350px"><p data-layer="Texto">Segunda</p></section>
</body></html>`;

const file = (name: string, bytes: Uint8Array, contentType: string) =>
  createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
    title: name,
    name,
    bytes,
    contentType,
    channelId: f.general.id,
  });
const picture = (name: string) => file(name, PNG, "image/png");
const page = (html = PAGE, name = "peca.html") => file(name, new TextEncoder().encode(html), "text/html");

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

describe("design review", () => {
  test("only inlined pages: what would load from elsewhere is named", () => {
    expect(outsideReferences(PAGE)).toEqual([]);
    expect(
      outsideReferences(
        `<img src="assets/foto.jpg"><link rel="stylesheet" href="https://fonts.googleapis.com/x">` +
          `<div style="background:url('fundo.png')"></div><a href="https://site.com">ok</a><use href="#s"/>`,
      ),
    ).toEqual(["assets/foto.jpg", "https://fonts.googleapis.com/x", "fundo.png"]);
    // An SVG's own reference inside a data: URL, and a browser extension's leftover tag, are not outside files.
    expect(
      outsideReferences(
        `<div style="background:url('data:image/svg+xml;utf8,<svg><rect filter=&quot;url(%23n)&quot;/></svg>')"></div>` +
          `<script src="chrome-extension://abc/executor.js"></script>`,
      ),
    ).toEqual([]);
  });

  test("an agent sends slides and the page, notes sit on a slide, changes go back with the page", async () => {
    f = await setup();
    const s1 = await picture("01.png");
    const s2 = await picture("02.png");
    const html = await page();
    const sent = await sendDesignForReview(deps(), ctx(), {
      pages: [s1.id, s2.id],
      sourceArtifactId: html.id,
      title: "Carrossel Glenwood",
      client: "Lexeer",
    });
    expect(sent.review).toMatchObject({ medium: "design", version: 1, cover: s1.id, status: "in_review" });
    expect(sent.link).toBe(`https://doug.example/org/${f.org.id}/review/${sent.review.id}`);

    const view = await getVideoReview(deps(), f.owner.id, f.org.id, sent.review.id);
    expect(view.versions[0]).toMatchObject({ pages: [s1.id, s2.id], source: true, editedBy: null });
    expect((await designPage(deps(), f.owner.id, f.org.id, sent.review.id, 1, 2)).body).toEqual(PNG);
    expect(await designSource(deps(), f.owner.id, f.org.id, sent.review.id, 1)).toBe(PAGE);
    await expect(designPage(deps(), f.owner.id, f.org.id, sent.review.id, 1, 3)).rejects.toThrow("No such slide");

    const onSlide = await addReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, {
      version: 1,
      atMs: 999,
      page: 2,
      x: 0.8,
      y: 0.25,
      kind: "layout",
      body: "foto em tela cheia aqui",
    });
    // A piece has no time.
    expect(onSlide).toMatchObject({ page: 2, atMs: null, x: 0.8, y: 0.25 });
    await expect(
      addReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, { version: 1, atMs: null, page: 5, body: "x" }),
    ).rejects.toThrow("No such slide");
    await addReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, {
      version: 1,
      atMs: null,
      page: 1,
      body: "logo da LXR no fundo",
    });

    await decideVideoReview(deps(), f.owner.id, f.org.id, sent.review.id, { decision: "changes" });
    const asked = (await lastMessage())?.body ?? "";
    expect(asked).toContain("mande com send_design_for_review e esse review_id");
    expect(asked).toContain(`HTML desta versão: artifact_id ${html.id}`);
    expect(asked).toContain("[lâmina 2] Layout: foto em tela cheia aqui [na lâmina: 80% da largura, 25% da altura]");
    // By slide.
    expect(asked.indexOf("[lâmina 1]")).toBeLessThan(asked.indexOf("[lâmina 2]"));
    expect(asked).toContain("vale para as próximas peças");

    // The next version must be this piece's, through the design tool.
    const v2 = await picture("01-v2.png");
    await expect(sendForReview(deps(), ctx(), { artifactId: v2.id, reviewId: sent.review.id })).rejects.toThrow();
    const again = await sendDesignForReview(deps(), ctx(), {
      pages: [v2.id],
      sourceArtifactId: html.id,
      reviewId: sent.review.id,
    });
    expect(again.review).toMatchObject({ version: 2, status: "in_review", cover: v2.id });
  });

  test("a person saves an edit as the next version, with their open notes; the decision names the page", async () => {
    f = await setup();
    const html = await page();
    const sent = await sendDesignForReview(deps(), ctx(), {
      pages: [(await picture("01.png")).id],
      sourceArtifactId: html.id,
      title: "Post Sócio",
    });
    await addReviewNote(deps(), f.owner.id, f.org.id, sent.review.id, {
      version: 1,
      atMs: null,
      page: 1,
      body: "título menor",
    });
    const edited = PAGE.replace("Venda", "Vendida");
    const saved = await saveDesignEdit(deps(), f.owner.id, f.org.id, sent.review.id, { baseVersion: 1, html: edited });
    expect(saved).toMatchObject({ version: 2, status: "in_review", openNotes: 1, cover: sent.review.cover });
    const view = await getVideoReview(deps(), f.owner.id, f.org.id, sent.review.id);
    expect(view.versions[1]).toMatchObject({ version: 2, pages: [], source: true });
    expect(view.versions[1]?.editedBy?.id).toBe(f.owner.id);
    expect(await designSource(deps(), f.owner.id, f.org.id, sent.review.id, 2)).toBe(edited);
    expect(view.notes.map((n) => n.version)).toEqual([2]);

    // The editor opened V1, but V2 is the piece now.
    await expect(
      saveDesignEdit(deps(), f.owner.id, f.org.id, sent.review.id, { baseVersion: 1, html: edited }),
    ).rejects.toThrow("A newer version arrived");

    await decideVideoReview(deps(), f.owner.id, f.org.id, sent.review.id, { decision: "approve" });
    const body = (await lastMessage())?.body ?? "";
    const source = view.versions[1]?.artifactId;
    expect(body).toContain("Aprovado: «Post Sócio» V2");
    expect(body).toContain(`editou a V2 à mão no editor`);
    expect(body).toContain(`import_file artifact_id ${source}, exporte as lâminas dele`);

    // Decided: nothing more to edit.
    await expect(
      saveDesignEdit(deps(), f.owner.id, f.org.id, sent.review.id, { baseVersion: 2, html: edited }),
    ).rejects.toThrow("not in review");
    expect((await listVideoReviews(deps(), f.owner.id, f.org.id))[0]?.medium).toBe("design");
  });

  test("pictures only, a page that loads from elsewhere, and slides that are not pictures are told apart", async () => {
    f = await setup();
    const s1 = await picture("01.png");
    const only = await sendDesignForReview(deps(), ctx(), { pages: [s1.id], title: "Capa" });
    const view = await getVideoReview(deps(), f.owner.id, f.org.id, only.review.id);
    expect(view.versions[0]?.source).toBe(false);
    await expect(designSource(deps(), f.owner.id, f.org.id, only.review.id, 1)).rejects.toThrow("no editable page");

    const linked = await page('<img src="https://cdn.example/foto.jpg">', "linked.html");
    await expect(sendDesignForReview(deps(), ctx(), { pages: [s1.id], sourceArtifactId: linked.id })).rejects.toThrow(
      "https://cdn.example/foto.jpg",
    );
    const notPicture = await page(PAGE, "slide.html");
    await expect(sendDesignForReview(deps(), ctx(), { pages: [notPicture.id] })).rejects.toThrow("not a picture");
  });

  test("from a conversation between agents, the review goes to the group named, never where nobody sees it", async () => {
    f = await setup();
    const other = await createAgent(
      f.db,
      f.owner.id,
      f.org.id,
      { name: "Chess", handle: "chess", role: "Strategy", instructions: "." },
      { model: "claude-sonnet-5-5" },
    );
    const dm = await openAgentDm(f.db, f.org.id, f.agent.id, other.id);
    const dmId = typeof dm === "string" ? dm : (dm as { id: string }).id;
    const s1 = await picture("01.png");
    const inDm = { ...ctx(), channelId: dmId };
    await expect(sendDesignForReview(deps(), inDm, { pages: [s1.id], title: "Post" })).rejects.toThrow(
      "No person is in this conversation",
    );
    const sent = await sendDesignForReview(deps(), inDm, { pages: [s1.id], title: "Post", channel: "#General" });
    const [row] = await f.db.select().from(schema.videoReviews).where(eq(schema.videoReviews.id, sent.review.id));
    expect(row?.channelId).toBe(f.general.id);
    // The team sees it.
    expect((await listVideoReviews(deps(), f.owner.id, f.org.id)).map((r) => r.id)).toContain(sent.review.id);
    await expect(
      sendDesignForReview(deps(), inDm, { pages: [s1.id], title: "Post", channel: "nao-existe" }),
    ).rejects.toThrow("No group #nao-existe");
  });

  test("the tool is offered in a run, never to a background routine", async () => {
    f = await setup();
    const source = createDesignReviewToolSource(deps());
    const inRun = await source.tools({ ...ctx(), background: false } as never);
    expect(inRun.map((t) => t.name)).toEqual(["send_design_for_review"]);
    expect(await source.tools({ ...ctx(), background: true } as never)).toEqual([]);
  });
});
