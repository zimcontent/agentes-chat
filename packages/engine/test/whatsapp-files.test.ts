import { afterEach, describe, expect, test } from "bun:test";
import { createFakeWhatsAppGateway, durationOf, glanceTimes } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import type { ModelRequest } from "@agenteschat/providers";
import {
  answerWhatsAppChat,
  createFileArtifact,
  createWhatsAppAccount,
  createWhatsAppToolSource,
  fileForModel,
  handleWhatsAppEvent,
  mirrorAgentReply,
  openPersonAgentDm,
  postPersonMessage,
  setWhatsAppContact,
  type ToolContext,
  updateWhatsAppAccount,
  WHATSAPP_AGENT_JOB,
  type WhatsAppAgentDeps,
  whatsappLine,
} from "../src";
import { type Fixture, setup } from "./fixtures";

/**
 * Files on a WhatsApp number, both ways (docs/adr/doug-0034-whatsapp-files.md): what the contact sends is understood
 * before the agent answers (a picture looked at, a video's frames and sound, a document's text), a member's goes to
 * their conversation with the agent as Drive files, and the agent's files go back as WhatsApp shows their type.
 */

let f = undefined as unknown as Fixture;
afterEach(async () => {
  const open = f;
  f = undefined as unknown as Fixture;
  await open?.close();
});

const ANA = "5511999990000@s.whatsapp.net";
/** A 1×1 PNG: a picture any model that sees takes. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const looks = (request: ModelRequest) => request.tools?.some((t) => t.name === "open_file") ?? false;
/** The look says what the picture shows; the answer is the agent's JSON. */
const reply = (request: ModelRequest) =>
  looks(request)
    ? { chunks: ["Uma camiseta azul com a etiqueta R$ 49,90."] }
    : { chunks: [JSON.stringify({ action: "reply", messages: ["Temos sim!"], note: "" })] };

const engine = (text: string) => ({
  id: "local" as const,
  model: "fake",
  nanoUsdPerHour: 0,
  minBilledSeconds: 0,
  file: async () => ({ text }),
});

async function number(extra: Partial<WhatsAppAgentDeps> = {}) {
  const gateway = createFakeWhatsAppGateway();
  // What WhatsApp hands back for each kind of file.
  gateway.downloadMedia = async (_token, { message }) => {
    const [field, part] = Object.entries(message)[0] as [string, { mimetype?: string }];
    const mimeType = part.mimetype ?? "application/octet-stream";
    if (field === "imageMessage" || field === "stickerMessage") return { mimeType, bytes: PNG };
    if (field === "documentMessage") return { mimeType, bytes: new TextEncoder().encode("Pedido 4471\n3 camisetas M") };
    return { mimeType, bytes: new TextEncoder().encode("video-bytes") };
  };
  const deps: WhatsAppAgentDeps = {
    db: f.db,
    gateway,
    keyWrappers: [f.keyWrapper],
    pubsub: f.pubsub,
    hookBase: "http://agentes:3000",
    models: f.gateway,
    machines: null,
    sleep: async () => {},
    artifacts: f.artifactDeps,
    ...extra,
  };
  const account = await createWhatsAppAccount(deps, f.owner.id, f.org.id, { label: "Comercial" });
  const secret = gateway.last("connect")?.webhookUrl.split("/").at(-1) as string;
  const post = (payload: unknown) => handleWhatsAppEvent(deps, secret, payload);
  await post({
    event: "Connected",
    data: { status: "open", jid: "5511911112222:3@s.whatsapp.net", pushName: "Zim" },
    instanceId: "instance-1",
  });
  await updateWhatsAppAccount(deps, f.owner.id, f.org.id, account.id, { agentId: f.agent.id, agentOn: true });
  let seq = 0;
  /** The contact sends `message` (WhatsApp's own shape); the agent's job for it. */
  const sends = async (message: Record<string, unknown>) => {
    const id = `IN${++seq}`;
    await post({
      event: "Message",
      data: {
        Info: {
          Chat: ANA,
          Sender: ANA,
          IsFromMe: false,
          ID: id,
          PushName: "Ana",
          Timestamp: new Date(Date.now() + seq).toISOString(),
        },
        Message: message,
      },
      instanceId: "instance-1",
    });
    const [stored] = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.waId, id));
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, WHATSAPP_AGENT_JOB));
    const job = jobs.find((j) => j.payload.messageId === stored?.id);
    if (!stored || !job) throw new Error("no job queued");
    return { chatId: String(job.payload.chatId), messageId: stored.id };
  };
  return { gateway, deps, account, sends };
}

const picture = { imageMessage: { mimetype: "image/jpeg", caption: "tem dessa no M?", mediaKey: "a2V5" } };
const answerPrompt = () =>
  String(f.provider.calls.filter((c) => !looks(c.request)).at(-1)?.request.messages[0]?.content ?? "");

describe("files they send, understood before the agent answers", () => {
  test("a picture is looked at once by a model that sees, and the agent reads what it shows", async () => {
    f = await setup({ reply });
    const { deps, sends } = await number();
    const job = await sends(picture);
    expect(await answerWhatsAppChat(deps, job)).toBe("reply");
    const look = f.provider.calls.find((c) => looks(c.request))?.request;
    // The picture goes as the opened file's result, the one way every adapter shows a picture.
    const shown = look?.messages.at(-1)?.content;
    expect(Array.isArray(shown) && shown[0]?.type === "tool_result" && shown[0].images?.[0]?.mediaType).toBe(
      "image/png",
    );
    expect(answerPrompt()).toContain(
      "Them: [image] tem dessa no M? (what it shows, looked at for you: Uma camiseta azul com a etiqueta R$ 49,90.)",
    );
    expect(String(f.provider.calls.at(-1)?.request.system)).toContain("never say you can't see pictures");
    const [row] = await f.db
      .select()
      .from(schema.whatsappMessages)
      .where(eq(schema.whatsappMessages.id, job.messageId));
    expect(row?.seen).toBe("Uma camiseta azul com a etiqueta R$ 49,90.");

    // A later message: the picture isn't looked at again.
    const looked = f.provider.calls.filter((c) => looks(c.request)).length;
    await answerWhatsAppChat(deps, await sends({ conversation: "e no G?" }));
    expect(f.provider.calls.filter((c) => looks(c.request)).length).toBe(looked);
  });

  test("a video is its frames looked at and its sound heard; a document its own text", async () => {
    f = await setup({ reply });
    const glance = async () => ({ frames: [PNG, PNG, PNG], audio: new Uint8Array([1, 2, 3]), seconds: 12 });
    const { deps, sends } = await number({ glance, speech: () => [engine("olha o defeito na manga")] });
    await sends({ videoMessage: { mimetype: "video/mp4", seconds: 12, mediaKey: "a2V5" } });
    const job = await sends({
      documentMessage: { mimetype: "text/plain", fileName: "pedido.txt", mediaKey: "a2V5" },
    });
    expect(await answerWhatsAppChat(deps, job)).toBe("reply");
    const prompt = answerPrompt();
    expect(prompt).toContain(
      "[video] (the video, watched for you: 12 s. Shows: Uma camiseta azul com a etiqueta R$ 49,90. Said in it: olha o defeito na manga)",
    );
    expect(prompt).toContain("[document] (the document, read for you: Its text: Pedido 4471\n3 camisetas M)");
    // The frames went in one look, in order.
    const frames = f.provider.calls.find((c) => looks(c.request))?.request.messages.at(-1)?.content;
    expect(Array.isArray(frames) && frames[0]?.type === "tool_result" && frames[0].images?.length).toBe(3);
  });

  test("a file nothing could be made of stays its kind alone, and isn't tried again", async () => {
    // No model here sees: the look fails, the answer still goes.
    f = await setup({ reply: (request) => (looks(request) ? new Error("no vision") : reply(request)) });
    const { deps, sends } = await number();
    const job = await sends(picture);
    expect(await answerWhatsAppChat(deps, job)).toBe("reply");
    expect(answerPrompt()).toContain("Them: [image] tem dessa no M?\n");
    const [row] = await f.db
      .select()
      .from(schema.whatsappMessages)
      .where(eq(schema.whatsappMessages.id, job.messageId));
    expect(row?.seen).toBe("");
    const looked = f.provider.calls.filter((c) => looks(c.request)).length;
    await answerWhatsAppChat(deps, await sends({ conversation: "e no G?" }));
    expect(f.provider.calls.filter((c) => looks(c.request)).length).toBe(looked);
    expect(whatsappLine({ fromMe: false, kind: "image", body: "", seen: "", at: new Date(0) })).toBe(
      "1970-01-01 00:00 Them: [image]",
    );
  });
});

describe("a member's files go to their conversation with the agent, and the agent's come back", () => {
  test("a picture becomes a Drive file attached to their message; the agent's file goes back with its caption", async () => {
    f = await setup({ reply });
    const relayed: { body: string; attachments?: string[] }[] = [];
    const { gateway, deps, account, sends } = await number();
    const relayDeps: WhatsAppAgentDeps = {
      ...deps,
      relay: (userId, orgId, channelId, input) => {
        relayed.push(input);
        return postPersonMessage({ db: f.db, pubsub: f.pubsub }, userId, orgId, channelId, input);
      },
    };
    const first = await sends({ conversation: "oi" });
    await setWhatsAppContact(deps, f.owner.id, f.org.id, account.id, first.chatId, { member: f.owner.id });
    const job = await sends(picture);
    expect(await answerWhatsAppChat(relayDeps, job)).toBe("relayed");
    expect(relayed.at(-1)?.body).toBe("oi\n(foto) tem dessa no M?");
    const dm = await openPersonAgentDm(f.db, f.org.id, f.owner.id, f.agent.id);
    const [asked] = await f.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.channelId, dm.id), eq(schema.messages.authorType, "person")));
    const files = asked?.meta.artifacts as { id: string; title: string }[];
    expect(files).toHaveLength(1);
    expect(files[0]?.title).toMatch(/^whatsapp-foto-.+\.jpg$/);
    // The agent opens it as any file in the app: the picture itself.
    const opened = await fileForModel(
      f.artifactDeps,
      { type: "person", userId: f.owner.id },
      f.org.id,
      files[0]?.id ?? "",
    );
    expect(opened.images?.[0]?.mediaType).toBe("image/png");
    // Kept on the message: relayed again, the same file.
    const [row] = await f.db
      .select()
      .from(schema.whatsappMessages)
      .where(eq(schema.whatsappMessages.id, job.messageId));
    expect(row?.artifactId).toBe(files[0]?.id ?? "");

    // The agent answers with a file attached and a line: it goes as a picture with that line as its caption.
    const made = await createFileArtifact(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "tabela.png",
      name: "tabela.png",
      contentType: "image/png",
      channelId: dm.id,
      bytes: PNG,
    });
    const [m] = await f.db
      .insert(schema.messages)
      .values({
        orgId: f.org.id,
        channelId: dm.id,
        authorType: "agent",
        authorAgentId: f.agent.id,
        body: "Aqui a **tabela** de medidas",
        meta: { artifacts: [{ id: made.id, title: "tabela.png" }] },
        createdAt: new Date(Date.now() + 1000),
      })
      .returning();
    expect(await mirrorAgentReply(deps, m as NonNullable<typeof m>)).toBe(1);
    const sent = gateway.last("file");
    expect([sent?.kind, sent?.caption, sent?.fileName]).toEqual(["image", "Aqui a *tabela* de medidas", "tabela.png"]);
    const [kept] = await f.db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.waId, "SENT1"));
    expect([kept?.kind, kept?.sentByAgentId]).toEqual(["image", f.agent.id]);
  });
});

describe("the workspace's agent sends and opens files on a number", () => {
  const ctxFor = (runId: string): ToolContext =>
    ({
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId,
      channelId: f.general.id,
      background: false,
    }) as unknown as ToolContext;

  test("whatsapp_open_file shows a received picture; whatsapp_send sends a Drive file", async () => {
    f = await setup({ reply });
    const { gateway, deps, sends } = await number();
    const job = await sends(picture);
    // A run of its own (the tools list only for a run).
    const ctx = ctxFor(Bun.randomUUIDv7());
    const tools = await createWhatsAppToolSource(deps).tools(ctx);
    const byName = new Map(tools.map((t) => [t.name, t]));

    const read = await byName.get("whatsapp_read")?.execute({ conversation: job.chatId }, ctx);
    expect(read?.content).toContain(`[file: message ${job.messageId}]`);
    const open = await byName.get("whatsapp_open_file")?.execute({ message: job.messageId }, ctx);
    expect(open?.isError).toBeUndefined();
    expect(open?.images?.[0]?.mediaType).toBe("image/png");
    const artifactId = String(open?.data?.artifactId);

    const sent = await byName
      .get("whatsapp_send")
      ?.execute({ conversation: job.chatId, file: artifactId, text: "essa aqui?" }, ctx);
    expect(sent?.isError).toBeUndefined();
    expect([gateway.last("file")?.kind, gateway.last("file")?.caption]).toEqual(["image", "essa aqui?"]);
  });
});

describe("a video as an AI takes it in", () => {
  test("ffmpeg's length and where the frames are taken", () => {
    expect(durationOf("  Duration: 00:01:02.50, start: 0.000000, bitrate: 1205 kb/s")).toBe(62.5);
    expect(durationOf("no such thing")).toBeNull();
    expect(glanceTimes(8, 4)).toEqual([1, 3, 5, 7]);
    expect(glanceTimes(null, 4)).toEqual([0]);
    expect(glanceTimes(10, 50)).toHaveLength(8);
  });

  test("an agent that opens a video gets its frames and its sound in words", async () => {
    f = await setup({ reply });
    const artifacts = {
      ...f.artifactDeps,
      glance: async () => ({ frames: [PNG, PNG], audio: new Uint8Array([1]), seconds: 30 }),
      speech: () => [engine("bem-vindos à loja")],
    };
    const made = await createFileArtifact(artifacts, { type: "person", userId: f.owner.id }, f.org.id, {
      title: "clipe.mp4",
      name: "clipe.mp4",
      contentType: "video/mp4",
      channelId: f.general.id,
      // An MP4's first bytes: binary, never read as text.
      bytes: Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0, 0xff, 0xfe]),
    });
    const opened = await fileForModel(artifacts, { type: "person", userId: f.owner.id }, f.org.id, made.id);
    expect(opened.images).toHaveLength(2);
    expect(opened.text).toBe("bem-vindos à loja");
    expect(opened.note).toContain("It is a video of 30 s: 2 frames");
    // Without ffmpeg, the note as before.
    const plain = await fileForModel(f.artifactDeps, { type: "person", userId: f.owner.id }, f.org.id, made.id);
    expect(plain.images).toBeUndefined();
    expect(plain.note).toContain("no AI here watches videos");
  });
});
