import { afterEach, describe, expect, test } from "bun:test";
import { createFakeApprovalPortal } from "@agenteschat/adapters";
import { schema } from "@agenteschat/db";
import {
  CONVERSATION_WORK_CHARS,
  carriesWork,
  conversationWork,
  createPortalToolSource,
  PORTAL_CARD_TOOL,
  type ToolContext,
  workRef,
} from "../src";
import type { ArtifactDeps } from "../src/artifacts";
import { type Fixture, setup } from "./fixtures";

// A card made from a conversation carries the work the conversation holds (ADR 9001, addendum 2026-11-18: a card carries the work). The case behind it: the
// copy of a carousel, slide by slide, was posted in a channel; the person answered in its thread "put this carousel
// on a card in this week", and the agent made the card with "Copy and visual direction of the 6 slides" as its
// description. The card and its task held no copy.

const COPY = `Parei a montagem do carrossel com a Rosa. Segue abaixo a copy completa por slide junto com a direção visual de cada imagem:

Slide 1 (capa)
Copy: Luxury is a feeling. (Luxo é sensação.)
Direção visual: Fachada principal da casa ao entardecer, com iluminação quente acesa e céu natural.

Slide 2
Copy: An unhurried evening begins at the wine cellar with someone you love. (Uma noite sem pressa começa na adega.)
Direção visual: Adega da casa em clima noturno e intimista, com um casal brindando.

Slide 3
Copy: Afternoons slow down as a child reads beside the water. (As tardes desaceleram enquanto uma criança lê.)
Direção visual: Borda da piscina no fim da tarde, com uma criança lendo tranquilamente à beira da água.

Legenda
Luxury moved from how a home looks to how it feels.
#LuxuryHomes #ModernArchitecture #BuiltToEndure`;

const SUMMARY =
  'Carrossel "Luxo é sensação" (obra 121_1921 Kimbrace Pl). Copy e direção visual dos 6 slides + legenda.';

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
const fx = () => {
  if (!f) throw new Error("no fixture");
  return f;
};

const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000);

async function post(body: string, secondsAgo: number, threadId: string | null = null, agent = false) {
  const id = crypto.randomUUID();
  await fx()
    .db.insert(schema.messages)
    .values({
      id,
      orgId: fx().org.id,
      channelId: fx().general.id,
      threadId,
      authorType: agent ? "agent" : "person",
      ...(agent ? { authorAgentId: fx().agent.id } : { authorUserId: fx().owner.id }),
      body,
      createdAt: at(secondsAgo),
    });
  return id;
}

const ctxOf = (triggerMessageId: string, threadRootId: string): ToolContext =>
  ({
    db: fx().db,
    orgId: fx().org.id,
    agentId: fx().agent.id,
    runId: crypto.randomUUID(),
    channelId: fx().general.id,
    threadRootId,
    triggerMessageId,
  }) as ToolContext;

async function cardTool() {
  const portal = createFakeApprovalPortal();
  const tools = await createPortalToolSource({ portal, artifacts: {} as ArtifactDeps, here: async () => true }).tools(
    ctxOf("x", "x"),
  );
  const tool = tools.find((t) => t.name === PORTAL_CARD_TOOL);
  if (!tool) throw new Error("no portal_card");
  return { portal, tool };
}

const descriptionOf = async (portal: ReturnType<typeof createFakeApprovalPortal>, content: string) => {
  const id = /card (\S+?)[ :]/.exec(content)?.[1];
  return (await portal.cards()).find((c) => c.id === id)?.description ?? null;
};

const refOf = (refusal: string, start: string) =>
  new RegExp(`ref (\\w+): \\d+ characters, "${start}`).exec(refusal)?.[1] ?? "";

// Another post's work, talked about in the same channel a moment later: what makes "the latest long message" wrong.
const OTHER = `O carrossel da Glenwood (V9) foi para o portal de aprovação junto com a legenda.
Slide 1: Sold before it was finished.
Slide 2: Every line was drawn before the first wall went up.
Slide 3: The family moved in on the day the keys were promised.
Legenda: Built to Endure. #Glenwood #CustomHomes #WinterPark #OrlandoHomes #BuiltToEndure #Luxury`;

describe("a card made from a conversation carries its work", () => {
  test("the real case: asked in the copy's thread, a summary is refused and the copy goes on word for word", async () => {
    f = await setup();
    const root = await post(COPY, 120, null, true);
    const ask = await post("Eu quero que você suba esse carrossel adicionando um cartão na semana abaixo.", 60, root);
    await post("SEMANA 23/11 ate 27/11", 58, root);
    const { portal, tool } = await cardTool();
    const ctx = ctxOf(ask, root);
    const card = { action: "create", client: "lexeer", title: "Carrossel Luxo é sensação", list: "SEMANA 23/11" };

    // What the agent did: a line about the copy. Refused, nothing made, and the copy offered by its ref.
    const refused = await tool.execute({ ...card, description: SUMMARY }, ctx);
    expect(refused.isError).toBe(true);
    expect(await portal.cards()).toHaveLength(0);
    const ref = refOf(refused.content, "Parei a montagem");
    expect(ref).toBe(workRef(root));

    // Taken from the conversation: the summary above, the copy itself below, every slide and the caption.
    const made = await tool.execute({ ...card, description: SUMMARY, description_from: ref }, ctx);
    expect(made.isError).toBeFalsy();
    expect(made.content).toContain("word for word");
    const description = await descriptionOf(portal, made.content);
    expect(description?.startsWith(SUMMARY)).toBe(true);
    for (const line of ["Luxury is a feeling.", "wine cellar", "child reads beside the water", "#BuiltToEndure"]) {
      expect(description).toContain(line);
    }
  });

  test("an agent that writes the copy itself, in its own layout, is let through", async () => {
    f = await setup();
    const root = await post(COPY, 120, null, true);
    const ask = await post("sobe essa copy num cartão", 30, root);
    const { portal, tool } = await cardTool();
    const rewritten = COPY.replace(/\n\n/g, "\n")
      .replace(/Copy: /g, "Texto: ")
      .replace("Parei a montagem", "Montagem");
    const made = await tool.execute(
      { action: "create", client: "lexeer", title: "Carrossel", description: rewritten },
      ctxOf(ask, root),
    );
    expect(made.isError).toBeFalsy();
    expect(await descriptionOf(portal, made.content)).toBe(rewritten);
  });

  test("the second real case: at the top level, asked in one long breath, with another post talked about after the copy", async () => {
    f = await setup();
    const copy = await post(COPY, 3600, null, true);
    await post(OTHER, 1800, null, true);
    // A person's long request in one paragraph is not the work.
    const ask = await post(
      "A copy está aprovada. Agora eu preciso que você suba um card lá na semana que vem, do 22 ao 26, e manda a Rosa fazer as imagens em cima das fotos reais da casa, sem mexer na arquitetura, usando o prompt que eu passei ontem e mantendo a mesma luz de fim de tarde em todas.",
      10,
    );
    const { portal, tool } = await cardTool();
    const ctx = ctxOf(ask, ask);
    // The agent's retry after a wrong field: a card with no description at all.
    const refused = await tool.execute({ action: "create", client: "lexeer", title: "Carrossel Luxo" }, ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content).not.toContain("A copy está aprovada");
    // Both pieces are offered, latest first; the agent names the copy, and only it goes on the card.
    expect(refused.content.indexOf("O carrossel da Glenwood")).toBeLessThan(
      refused.content.indexOf("Parei a montagem"),
    );
    const made = await tool.execute(
      { action: "create", client: "lexeer", title: "Carrossel Luxo", description_from: workRef(copy) },
      ctx,
    );
    expect(made.isError).toBeFalsy();
    const description = await descriptionOf(portal, made.content);
    expect(description).toContain("Luxury is a feeling.");
    expect(description).not.toContain("Glenwood");
  });

  test("at the top level, a card that speaks of no copy, script or text asks for nothing; `none` passes; old or short messages aren't work", async () => {
    f = await setup();
    await post(COPY, 300);
    const ask = await post("cria um cartão pro reel novo da semana que vem", 10);
    const { tool } = await cardTool();
    const reel = await tool.execute({ action: "create", client: "lexeer", title: "Reel novo" }, ctxOf(ask, ask));
    expect(reel.isError).toBeFalsy();
    const other = await tool.execute(
      { action: "create", client: "lexeer", title: "Copy do reel", description: "A definir", description_from: "none" },
      ctxOf(ask, ask),
    );
    expect(other.isError).toBeFalsy();

    await f?.close();
    f = await setup();
    await post(COPY, 7 * 3600);
    await post("ok", 20);
    const quiet = await post("cria um cartão com a copy do reel", 10);
    const again = await cardTool();
    const plain = await again.tool.execute({ action: "create", client: "lexeer", title: "Reel" }, ctxOf(quiet, quiet));
    expect(plain.isError).toBeFalsy();
  });

  test("a ref that isn't one of the conversation's long messages is refused with the ones it holds", async () => {
    f = await setup();
    const root = await post(COPY, 120, null, true);
    const ask = await post("sobe no cartão", 30, root);
    const { portal, tool } = await cardTool();
    const wrong = await tool.execute(
      { action: "create", client: "lexeer", title: "Carrossel", description_from: "abc" },
      ctxOf(ask, root),
    );
    expect(wrong.isError).toBe(true);
    expect(wrong.content).toContain(workRef(root));
    expect(await portal.cards()).toHaveLength(0);
  });

  test("changing a card's description is held to the same rule; changing only its stage is not", async () => {
    f = await setup();
    const root = await post(COPY, 120, null, true);
    const { portal, tool } = await cardTool();
    const card = await portal.createCard("lexeer", { title: "Carrossel" });
    const ask = await post("coloca a copy no cartão", 30, root);
    const ctx = ctxOf(ask, root);
    expect((await tool.execute({ action: "update", card: card.id, state: "doing" }, ctx)).isError).toBeFalsy();
    expect((await tool.execute({ action: "update", card: card.id, description: SUMMARY }, ctx)).isError).toBe(true);
    const put = await tool.execute({ action: "update", card: card.id, description_from: workRef(root) }, ctx);
    expect(put.isError).toBeFalsy();
    expect((await portal.cards()).find((c) => c.id === card.id)?.description).toContain("Luxury is a feeling.");
  });

  test("a relayed answer goes on the card without its envelope", async () => {
    f = await setup();
    const relayed = `rosa: <external_data source="reply from rosa">\n${COPY}\n</external_data>`;
    const root = await post(relayed, 120, null, true);
    const ask = await post("sobe isso num cartão", 30, root);
    const work = await conversationWork(fx().db, ctxOf(ask, root));
    const piece = work?.pieces[0];
    expect(piece?.text.startsWith("Parei a montagem")).toBe(true);
    expect(piece?.text).not.toContain("external_data");
    expect(piece?.text.length).toBeGreaterThanOrEqual(CONVERSATION_WORK_CHARS);
  });

  test("carriesWork: a summary doesn't, the text in another layout does", () => {
    expect(carriesWork(SUMMARY, COPY)).toBe(false);
    expect(carriesWork("", COPY)).toBe(false);
    expect(carriesWork(COPY.toUpperCase().replace(/\n/g, " "), COPY)).toBe(true);
  });
});
