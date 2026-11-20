import { DEFAULT_VOICE_OUT, isVoiceOutId, WhatsAppGatewayError } from "@dougbot/adapters";
import {
  clearWhatsAppBrain,
  createWhatsAppAccount,
  draftWhatsAppInstructions,
  getWhatsAppBrain,
  listWhatsAppAccounts,
  listWhatsAppChats,
  listWhatsAppMessages,
  listWhatsAppStickers,
  readWhatsAppChat,
  reconnectWhatsAppAccount,
  removeWhatsAppAccount,
  requestWhatsAppHistory,
  requireActiveMembership,
  requirePermission,
  sendWhatsAppFile,
  sendWhatsAppSticker,
  sendWhatsAppText,
  setWhatsAppBrain,
  setWhatsAppChatAgent,
  setWhatsAppContact,
  typingInWhatsAppChat,
  updateWhatsAppAccount,
  WHATSAPP_AGENT_STYLE_BOUNDS,
  WHATSAPP_BRAIN_KINDS,
  WHATSAPP_DIRECTION_AUDIO_MAX_BYTES,
  WHATSAPP_DIRECTION_MAX,
  WHATSAPP_INSTRUCTIONS_MAX,
  WHATSAPP_LABEL_MAX,
  WHATSAPP_PAGE_MAX,
  WHATSAPP_SEND_FILE_MAX_BYTES,
  WHATSAPP_TEXT_MAX,
  WhatsAppAgentBusy,
  whatsappChatPhoto,
  whatsappMessageFile,
  whatsappPortalClients,
} from "@dougbot/engine";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { apiError, errorResponse } from "../../http/errors";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  OrgParams,
  requireSession,
  security,
  whatsappDeps,
} from "./context";
import { AgentBrain, BrainKind } from "./schemas";

const tags = ["WhatsApp"];

/** Messages one person may send through the gateway: a conversation's pace, not a broadcast's. */
export const WHATSAPP_SENDS_PER_PERSON = { limit: 30, windowMs: 60_000 };
/**
 * Conversations one number may start with phone numbers it never talked to, a day. Writing first to many strangers
 * is what WhatsApp bans numbers for, whoever types: past this the number only answers and continues conversations.
 */
export const WHATSAPP_NEW_CHATS_PER_NUMBER = { limit: 20, windowMs: 24 * 60 * 60_000 };
/** Drafts of a number's instructions one person may ask for: each one is a call to the number's AI. */
export const WHATSAPP_DRAFTS_PER_PERSON = { limit: 20, windowMs: 60 * 60_000 };
/** Times one person may ask the phone for older messages: each one wakes the phone. */
export const WHATSAPP_HISTORY_PER_PERSON = { limit: 20, windowMs: 60_000 };
/** Files one person may load: a conversation full of pictures, opened and scrolled. */
export const WHATSAPP_FILES_PER_PERSON = { limit: 120, windowMs: 60_000 };
/** A list of conversations loads a photo each; the browser keeps them, so this is a first look at a few pages. */
export const WHATSAPP_PHOTOS_PER_PERSON = { limit: 300, windowMs: 60_000 };
/**
 * The types a browser may draw from our address: pictures, sound and video it can't run. Anything else (a PDF, an
 * HTML page, an SVG someone sent) is only ever downloaded: opened here it would run as our own page.
 */
const INLINE_TYPES = /^(image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|video\/(mp4|webm|3gpp|quicktime))$/;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/** "Typing…" signals one person may send: the app tells it every few seconds while they write. */
export const WHATSAPP_TYPING_PER_PERSON = { limit: 60, windowMs: 60_000 };
/** Numbers one person may connect or reconnect: each try makes the gateway open a session with WhatsApp. */
export const WHATSAPP_CONNECTS_PER_PERSON = { limit: 10, windowMs: 60 * 60_000 };

const AccountParams = OrgParams.extend({
  accountId: z.uuid().openapi({ param: { name: "accountId", in: "path" } }),
});
const ChatParams = AccountParams.extend({
  chatId: z.uuid().openapi({ param: { name: "chatId", in: "path" } }),
});

const STYLE = WHATSAPP_AGENT_STYLE_BOUNDS;
const AgentStyle = z
  .object({
    waitSeconds: z.number().int().min(STYLE.waitSeconds.min).max(STYLE.waitSeconds.max).openapi({
      description: "Seconds the agent waits after a message before it reads the conversation.",
    }),
    pace: z.enum(STYLE.paces).openapi({ description: "How fast it types: `fast`, `natural` or `slow`." }),
    messages: z.number().int().min(STYLE.messages.min).max(STYLE.messages.max).openapi({
      description: "The most messages one answer is split in. 1: always a single message.",
    }),
    quietMinutes: z.number().int().min(STYLE.quietMinutes.min).max(STYLE.quietMinutes.max).openapi({
      description: "Minutes it stays quiet in a conversation after a person wrote there.",
    }),
    voiceNotes: z.boolean().openapi({
      description:
        "It sends voice notes: always to a voice message, now and then on its own (needs a voice on the server).",
    }),
    voice: z.string().max(40).nullable().openapi({
      description: "The voice it speaks in (`…/whatsapp/voices`); null: the default one.",
    }),
  })
  .openapi("WhatsAppAgentStyle");

const Account = z
  .object({
    id: z.string(),
    label: z.string(),
    status: z.enum(["pending", "qr", "connected", "disconnected", "logged_out"]).openapi({
      description:
        "`pending`: made, its QR code is on its way. `qr`: a code is waiting to be read. `disconnected`: the session dropped and comes back by itself. `logged_out`: the phone removed it; reconnect for a new code.",
    }),
    phone: z.string().nullable().openapi({ description: "The number's digits once connected." }),
    pushName: z.string().openapi({ description: "The name the phone shows for itself (outside text)." }),
    qr: z.string().nullable().openapi({
      description:
        "A `data:image/png` address to show now, only to someone who may connect numbers; null when there is none or it is over a minute old (a new one follows, told by `whatsapp.changed`).",
    }),
    people: z.array(z.string()).openapi({ description: "User ids who read and answer its conversations." }),
    agentId: z.string().nullable().openapi({ description: "The agent that answers it; null: only people." }),
    instructions: z.string().nullable().openapi({
      description:
        "How the agent carries itself on this number (Markdown), on top of its own instructions; null for someone who can't change the number.",
    }),
    agentOn: z.boolean().openapi({
      description:
        "The agent answers this number's conversations now: only someone who wrote, never a group, and never a conversation where a person wrote in the last hour.",
    }),
    agentStyle: AgentStyle,
    ownAi: z.boolean().openapi({
      description:
        "The number answers with an AI of its own (`GET …/brain`), its agent's untouched; false: with its agent's own.",
    }),
    mine: z.boolean().openapi({ description: "The asker is on its list." }),
    manage: z.boolean().openapi({ description: "The asker may change or remove it." }),
    createdAt: z.string(),
  })
  .openapi("WhatsAppAccount");

const Chat = z
  .object({
    id: z.string(),
    phone: z.string().nullable().openapi({ description: "The other person's digits; null for a group." }),
    name: z.string().openapi({ description: "As WhatsApp tells it (outside text); empty until it does." }),
    group: z.boolean(),
    lastAt: z.string().nullable(),
    lastText: z.string().openapi({ description: "The latest message's words (outside text); empty for a file." }),
    lastKind: z.string(),
    lastFromMe: z.boolean(),
    lastStatus: z.enum(["received", "sent", "delivered", "read"]).nullable().openapi({
      description: "While the latest message is ours: how far it got (the list's ticks). null for theirs.",
    }),
    unread: z.number().int(),
    agent: z.enum(["on", "quiet", "off", "person"]).nullable().openapi({
      description:
        "Where the number's agent stands here. `on`: it answers. `quiet`: a person wrote here less than an hour ago, it answers again at `agentQuietUntil`. `off`: someone turned it off here. `person`: it left the conversation to a person (`agentNote`). null: no agent answers this conversation (the number has none on, or it is a group).",
    }),
    agentQuietUntil: z.string().nullable(),
    agentNote: z.string().openapi({
      description:
        "While `agent` is `person`: why, in the agent's own words (written by a model: show it as text), or `limit` (it answered as much as it may in a day) or `failed` (its AI account didn't answer).",
    }),
    photo: z.boolean().openapi({
      description:
        "Its profile photo may be loaded (`…/chats/{chatId}/photo`); false: it has none we know of, so draw its initials.",
    }),
    member: z.string().nullable().openapi({
      description:
        "The contact is this member of the workspace: their messages go to their conversation with the number's agent, and its answers come back here.",
    }),
    client: z.string().nullable().openapi({
      description: "The contact is this client of the approval portal: the agent's answers read their own work.",
    }),
  })
  .openapi("WhatsAppChat");

const Message = z
  .object({
    id: z.string(),
    chatId: z.string(),
    fromMe: z.boolean(),
    senderName: z.string().openapi({ description: "Outside text." }),
    senderPhone: z.string().nullable(),
    kind: z.string().openapi({
      description:
        "`text`, `image`, `video`, `audio`, `document`, `sticker`, `location`, `contact`, `poll`, `other`, or `deleted` (taken back for everyone: no words, no file).",
    }),
    body: z.string().openapi({ description: "A text, or a file's caption (outside text)." }),
    replyToId: z.string().nullable(),
    media: z
      .object({ mimeType: z.string(), fileName: z.string().nullable(), seconds: z.number().nullable() })
      .nullable(),
    wave: z.array(z.number()).nullable().openapi({
      description: "A voice message's bars as WhatsApp draws them (about 64, each 0 to 100); null for anything else.",
    }),
    file: z.boolean().openapi({
      description: "Its file can be loaded with `GET …/accounts/{accountId}/messages/{messageId}/file`.",
    }),
    status: z.enum(["received", "sent", "delivered", "read"]),
    sentByUserId: z.string().nullable().openapi({ description: "Who wrote it here; null: from the phone." }),
    sentByAgentId: z
      .string()
      .nullable()
      .openapi({ description: "The agent that wrote it, when the number's agent answered." }),
    at: z.string(),
  })
  .openapi("WhatsAppMessage");

const Page = z.object({
  before: z.iso.datetime().optional().openapi({ description: "The `next` of the page before." }),
  limit: z.coerce.number().int().min(1).max(WHATSAPP_PAGE_MAX).optional().openapi({ description: "Default 50." }),
});

const gatewayDown = { 502: errorResponse("The WhatsApp gateway refused or didn't answer (`whatsapp.unavailable`)") };
const tooMany = { 429: errorResponse("Too many tries (`rate_limited`)") };
const off =
  "404 while the server has no WhatsApp gateway (`WHATSAPP_GATEWAY_URL`), and for a number the asker isn't listed on.";

/**
 * WhatsApp numbers and their conversations. The gateway is reached only from here, with keys that never leave the
 * server. Connecting and changing a number: `manage_connectors`; its conversations: the people on its list.
 */
export function whatsappRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const wa = whatsappDeps(deps);
  const limited = async (key: string, limit: { limit: number; windowMs: number }) =>
    !(await deps.adapters.rateLimiter.consume(key, limit)).allowed;

  /** Runs a call that reaches the gateway: its refusal is a 502 of ours, never a 500. */
  const reaching = async <T>(c: Context, call: () => Promise<T>) => {
    try {
      return { value: await call() };
    } catch (error) {
      if (!(error instanceof WhatsAppGatewayError)) throw error;
      deps.log?.warn("WhatsApp gateway call failed", { status: error.status, error: error.message });
      return { refused: apiError(c, 502, "whatsapp.unavailable", "WhatsApp isn't answering right now") };
    }
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp",
      tags,
      security,
      summary: "The WhatsApp numbers the asker may use (members)",
      description:
        "`on`: the server has a gateway. Someone who manages connectors gets every number (`manage`), anyone else only the ones they are listed on. A change to a number or its conversations is told to its people as the user event `whatsapp.changed` (`accountId`, `chatId` when it is about one conversation).",
      request: { params: OrgParams },
      responses: {
        200: json(z.object({ on: z.boolean(), manage: z.boolean(), accounts: z.array(Account) })),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      return c.json(await listWhatsAppAccounts(wa, c.get("user").id, orgId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts",
      tags,
      security,
      summary: "Connect a WhatsApp number (manage_connectors)",
      description: `Makes the number and starts its session; its QR code arrives a moment later (\`whatsapp.changed\`, then \`qr\` on the number). The asker starts on its list. ${off}`,
      request: {
        params: OrgParams,
        body: body(z.object({ label: z.string().trim().min(1).max(WHATSAPP_LABEL_MAX) })),
      },
      responses: { 201: json(Account, "Created"), ...tooMany, ...gatewayDown, ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const user = c.get("user");
      if (await limited(`whatsapp-connect:${user.id}`, WHATSAPP_CONNECTS_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const made = await reaching(c, () => createWhatsAppAccount(wa, user.id, orgId, c.req.valid("json")));
      return made.refused ?? c.json(made.value, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}",
      tags,
      security,
      summary: "Rename a number, choose its people and the agent that answers it (manage_connectors)",
      description: "`people` replaces the list (members of the workspace). `agentId` null: only people answer it.",
      request: {
        params: AccountParams,
        body: body(
          z.object({
            label: z.string().trim().min(1).max(WHATSAPP_LABEL_MAX).optional(),
            people: z.array(z.string().min(1).max(64)).max(50).optional(),
            agentId: z.uuid().nullable().optional(),
            instructions: z.string().max(WHATSAPP_INSTRUCTIONS_MAX).optional(),
            agentOn: z.boolean().optional().openapi({ description: "400 to turn it on with no agent chosen." }),
            agentStyle: AgentStyle.partial().optional(),
          }),
        ),
      },
      responses: { 200: json(Account), ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      return c.json(await updateWhatsAppAccount(wa, c.get("user").id, orgId, accountId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/reconnect",
      tags,
      security,
      summary: "A new QR code for a number that is out (manage_connectors)",
      description: `400 while the number is connected. ${off}`,
      request: { params: AccountParams },
      responses: { 200: json(Account), ...tooMany, ...gatewayDown, ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      const user = c.get("user");
      if (await limited(`whatsapp-connect:${user.id}`, WHATSAPP_CONNECTS_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const again = await reaching(c, () => reconnectWhatsAppAccount(wa, user.id, orgId, accountId));
      return again.refused ?? c.json(again.value, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}",
      tags,
      security,
      summary: "Remove a number and its conversations here (manage_connectors)",
      description:
        "Its session ends on the phone too. `leftover`: why the gateway's side couldn't be cleaned (it didn't answer); the number is gone here all the same.",
      request: { params: AccountParams },
      responses: { 200: json(z.object({ removed: z.boolean(), leftover: z.string().nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      return c.json(await removeWhatsAppAccount(wa, c.get("user").id, orgId, accountId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/chats",
      tags,
      security,
      summary: "A number's conversations, the latest first (its people)",
      request: { params: AccountParams, query: Page },
      responses: { 200: json(z.object({ chats: z.array(Chat), next: z.string().nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      return c.json(await listWhatsAppChats(wa, c.get("user").id, orgId, accountId, c.req.valid("query")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/chats/{chatId}/messages",
      tags,
      security,
      summary: "A conversation's messages, the latest first (the number's people)",
      description: "Only what arrived or was sent since the number was connected here: WhatsApp's history isn't read.",
      request: { params: ChatParams, query: Page },
      responses: {
        200: json(z.object({ chat: Chat, messages: z.array(Message), next: z.string().nullable() })),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, accountId, chatId } = c.req.valid("param");
      return c.json(
        await listWhatsAppMessages(wa, c.get("user").id, orgId, accountId, chatId, c.req.valid("query")),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/messages",
      tags,
      security,
      summary: "Send a text from the number (its people)",
      description: `Into a conversation it has (\`chatId\`) or to a phone number with its country code (\`phone\`), which starts one. 400 while the number isn't connected; 429 past 30 messages a minute, and \`whatsapp.new_chats_limit\` past 20 conversations started by phone number in a day for this number. ${off}`,
      request: {
        params: AccountParams,
        body: body(
          z.object({
            chatId: z.uuid().optional(),
            phone: z.string().max(32).optional(),
            text: z.string().min(1).max(WHATSAPP_TEXT_MAX),
            replyToId: z.uuid().nullable().optional(),
          }),
        ),
      },
      responses: { 201: json(z.object({ chatId: z.string() }), "Sent"), ...tooMany, ...gatewayDown, ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      const user = c.get("user");
      if (await limited(`whatsapp-send:${user.id}`, WHATSAPP_SENDS_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      if (c.req.valid("json").phone && (await limited(`whatsapp-new:${accountId}`, WHATSAPP_NEW_CHATS_PER_NUMBER))) {
        return apiError(c, 429, "whatsapp.new_chats_limit", "This number started too many conversations today");
      }
      const sent = await reaching(c, () => sendWhatsAppText(wa, user.id, orgId, accountId, c.req.valid("json")));
      return sent.refused ?? c.json(sent.value, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/chats/{chatId}/read",
      tags,
      security,
      summary: "The asker opened the conversation: nothing in it is unread (the number's people)",
      description: "The other side sees its messages read, as opening the conversation on the phone does.",
      request: { params: ChatParams },
      responses: { 200: json(z.object({ read: z.number().int() })), ...errors },
    }),
    async (c) => {
      const { orgId, accountId, chatId } = c.req.valid("param");
      return c.json(await readWhatsAppChat(wa, c.get("user").id, orgId, accountId, chatId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/chats/{chatId}/typing",
      tags,
      security,
      summary: "The asker is writing in the conversation, or stopped (the number's people)",
      description:
        "The other side sees \"typing…\", as when someone writes in WhatsApp's own apps. Tell it every few seconds while the person writes and `typing: false` when they stop. `told` false: the gateway didn't take it, which stops nothing.",
      request: { params: ChatParams, body: body(z.object({ typing: z.boolean() })) },
      responses: { 200: json(z.object({ told: z.boolean() })), ...tooMany, ...errors },
    }),
    async (c) => {
      const { orgId, accountId, chatId } = c.req.valid("param");
      const user = c.get("user");
      if (await limited(`whatsapp-typing:${user.id}`, WHATSAPP_TYPING_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const { typing } = c.req.valid("json");
      return c.json(await typingInWhatsAppChat(wa, user.id, orgId, accountId, chatId, typing), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/files",
      tags,
      security,
      summary: "Send a file or a voice message from the number (its people)",
      description:
        "A form with the file in `file`. It goes as a picture (JPEG, PNG, WebP), a video (MP4), a voice message (any audio, or `voice: true` for a recording made in the app) or a document (anything else), by its type. `caption` goes with a picture, a video or a document. 413 past 32 MB; 400 while the number isn't connected; 429 past 30 sends a minute.",
      request: {
        params: AccountParams,
        body: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.any().openapi({ type: "string", format: "binary" }),
                chatId: z.uuid(),
                caption: z.string().max(WHATSAPP_TEXT_MAX).optional(),
                voice: z.enum(["true", "false"]).optional(),
              }),
            },
          },
        },
      },
      responses: {
        201: json(z.object({ chatId: z.string(), kind: z.enum(["image", "video", "audio", "document"]) }), "Sent"),
        413: errorResponse("The file is too large (`too_large`)"),
        ...tooMany,
        ...gatewayDown,
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      const user = c.get("user");
      if (await limited(`whatsapp-send:${user.id}`, WHATSAPP_SENDS_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const form = c.req.valid("form");
      const file: unknown = form.file;
      if (!(file instanceof File)) return apiError(c, 400, "invalid_request", "Send the file in the field file");
      if (file.size > WHATSAPP_SEND_FILE_MAX_BYTES) return apiError(c, 413, "too_large", "The file is too large");
      const sent = await reaching(c, async () =>
        sendWhatsAppFile(wa, user.id, orgId, accountId, {
          chatId: form.chatId,
          bytes: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type,
          fileName: file.name,
          caption: form.caption,
          voice: form.voice === "true",
        }),
      );
      return sent.refused ?? c.json(sent.value, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/stickers",
      tags,
      security,
      summary: "The stickers the number sent or received lately (its people)",
      description:
        "The latest first, each once, up to 60. Each is a message's id: its picture loads with `GET …/messages/{messageId}/file`, and `POST …/stickers` sends it again.",
      request: { params: AccountParams },
      responses: {
        200: json(z.object({ stickers: z.array(z.object({ messageId: z.string(), at: z.string() })) })),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      return c.json(await listWhatsAppStickers(wa, c.get("user").id, orgId, accountId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/stickers",
      tags,
      security,
      summary: "Send a sticker the number already has (its people)",
      description:
        "`messageId`: a message of this number that carried the sticker. It goes as a still sticker: one that moved arrives without its motion. 400 while the number isn't connected, or when the message isn't a sticker of this number; 429 past 30 sends a minute.",
      request: { params: AccountParams, body: body(z.object({ chatId: z.uuid(), messageId: z.uuid() })) },
      responses: { 201: json(z.object({ chatId: z.string() }), "Sent"), ...tooMany, ...gatewayDown, ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      const user = c.get("user");
      if (await limited(`whatsapp-send:${user.id}`, WHATSAPP_SENDS_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const sent = await reaching(c, () => sendWhatsAppSticker(wa, user.id, orgId, accountId, c.req.valid("json")));
      return sent.refused ?? c.json(sent.value, 201);
    },
  );

  // A conversation's profile photo, for the number's people: what the list's and the header's `<img>` load. This
  // server fetches it from WhatsApp's own (`whatsappChatPhoto`); the browser keeps it for six hours. 404: none.
  app.get("/organizations/:orgId/whatsapp/accounts/:accountId/chats/:chatId/photo", async (c) => {
    const params = z.object({ orgId: z.uuid(), accountId: z.uuid(), chatId: z.uuid() }).safeParse({
      orgId: c.req.param("orgId"),
      accountId: c.req.param("accountId"),
      chatId: c.req.param("chatId"),
    });
    if (!params.success) return apiError(c, 400, "invalid_request", "Not a conversation");
    const user = c.get("user");
    if (await limited(`whatsapp-photo:${user.id}`, WHATSAPP_PHOTOS_PER_PERSON)) {
      return apiError(c, 429, "rate_limited", "Slow down");
    }
    const { orgId, accountId, chatId } = params.data;
    const got = await reaching(c, () => whatsappChatPhoto(wa, user.id, orgId, accountId, chatId));
    if (got.refused) return got.refused;
    const photo = got.value;
    return new Response(photo.bytes, {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Length": String(photo.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=21600",
      },
    });
  });

  // A message's file, for the number's people: what an `<img>`, an `<audio>` or a download link loads. Fetched from
  // WhatsApp by the gateway on each ask and cached by the browser for a day. Never drawn as a page (`INLINE_TYPES`).
  app.get("/organizations/:orgId/whatsapp/accounts/:accountId/messages/:messageId/file", async (c) => {
    const params = z.object({ orgId: z.uuid(), accountId: z.uuid(), messageId: z.uuid() }).safeParse({
      orgId: c.req.param("orgId"),
      accountId: c.req.param("accountId"),
      messageId: c.req.param("messageId"),
    });
    if (!params.success) return apiError(c, 400, "invalid_request", "Not a message");
    const user = c.get("user");
    if (await limited(`whatsapp-file:${user.id}`, WHATSAPP_FILES_PER_PERSON)) {
      return apiError(c, 429, "rate_limited", "Slow down");
    }
    const { orgId, accountId, messageId } = params.data;
    const got = await reaching(c, () => whatsappMessageFile(wa, user.id, orgId, accountId, messageId));
    if (got.refused) return got.refused;
    const file = got.value;
    const type = file.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    const inline = INLINE_TYPES.test(type);
    const name = (file.fileName ?? `whatsapp-${messageId.slice(0, 8)}.${EXTENSIONS[type] ?? "bin"}`).replace(
      /[\r\n"\\/]/g,
      "_",
    );
    return new Response(file.bytes, {
      headers: {
        "Content-Type": inline ? type : "application/octet-stream",
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/chats/{chatId}/history",
      tags,
      security,
      summary: "Ask the phone for the conversation's older messages (the number's people)",
      description:
        "Up to 50 messages from before the oldest one kept here. They arrive a moment later (`whatsapp.changed`), only while the phone is on and still has them: an answer here says the phone was asked, not that anything came. 400 while the number isn't connected.",
      request: { params: ChatParams },
      responses: { 202: json(z.object({ asked: z.number().int() }), "Asked"), ...tooMany, ...gatewayDown, ...errors },
    }),
    async (c) => {
      const { orgId, accountId, chatId } = c.req.valid("param");
      const user = c.get("user");
      if (await limited(`whatsapp-history:${user.id}`, WHATSAPP_HISTORY_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const asked = await reaching(c, () => requestWhatsAppHistory(wa, user.id, orgId, accountId, chatId));
      return asked.refused ?? c.json(asked.value, 202);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/chats/{chatId}/agent",
      tags,
      security,
      summary: "Turn the number's agent on or off in one conversation (the number's people)",
      description:
        "`on: false`: it says nothing more here until someone turns it back on. `on: true` gives the conversation back to it: whatever kept it quiet (a person who wrote, its own handoff) is cleared, and a message still waiting gets its answer. 400 for a group.",
      request: { params: ChatParams, body: body(z.object({ on: z.boolean() })) },
      responses: { 200: json(z.object({ on: z.boolean() })), ...errors },
    }),
    async (c) => {
      const { orgId, accountId, chatId } = c.req.valid("param");
      const { on } = c.req.valid("json");
      return c.json(await setWhatsAppChatAgent(wa, c.get("user").id, orgId, accountId, chatId, on), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp/clients",
      tags,
      security,
      summary: "The approval portal's clients a contact may be (members of the workspace)",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ clients: z.array(z.string()) })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requireActiveMembership(wa.db, c.get("user").id, orgId);
      return c.json({ clients: await whatsappPortalClients(wa, orgId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp/voices",
      tags,
      security,
      summary: "The voices a number's agent may speak in (whoever manages connectors)",
      description:
        "`on`: the server has a voice (ElevenLabs). `default`: the one used until a number picks another. 502 when the provider doesn't answer.",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            on: z.boolean(),
            default: z.string(),
            voices: z.array(z.object({ id: z.string(), name: z.string(), labels: z.array(z.string()) })),
          }),
        ),
        ...gatewayDown,
        ...errors,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      await requirePermission(wa.db, c.get("user").id, orgId, "manage_connectors");
      if (!wa.voiceOut) return c.json({ on: false, default: DEFAULT_VOICE_OUT, voices: [] }, 200);
      try {
        return c.json({ on: true, default: DEFAULT_VOICE_OUT, voices: await wa.voiceOut.voices() }, 200);
      } catch (error) {
        deps.log?.warn("Voice list failed", { error: String(error) });
        return apiError(c, 502, "whatsapp.voice_unavailable", "The voice provider isn't answering right now");
      }
    },
  );

  // A voice's sample, for the number's settings: fetched by this server from the provider's own storage.
  app.get("/organizations/:orgId/whatsapp/voices/:voiceId/preview", async (c) => {
    const orgId = c.req.param("orgId");
    const voiceId = c.req.param("voiceId");
    if (!z.uuid().safeParse(orgId).success || !isVoiceOutId(voiceId)) {
      return apiError(c, 400, "invalid_request", "Not a voice");
    }
    await requirePermission(wa.db, c.get("user").id, orgId, "manage_connectors");
    const sample = await wa.voiceOut?.preview(voiceId).catch(() => null);
    if (!sample) return apiError(c, 404, "not_found", "This voice has no sample");
    return new Response(sample.bytes, {
      headers: {
        "Content-Type": sample.mimeType,
        "Content-Length": String(sample.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=86400",
      },
    });
  });

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/chats/{chatId}/contact",
      tags,
      security,
      summary: "Say who the contact is: a member of the workspace, a portal client, or neither (the number's people)",
      description:
        "`member`: a member's messages go to their own conversation with the number's agent, which answers with all it has, and its answers come back to WhatsApp. Only that member, or someone who manages members, sets it (403). `client`: the agent's answers read that client's own work on the portal's board. One or the other; both null: neither. Audited as `whatsapp.contact_set`. 400 for a group, a non-member or an unknown client.",
      request: {
        params: ChatParams,
        body: body(
          z.object({
            member: z.string().max(100).nullable().optional(),
            client: z.string().max(60).nullable().optional(),
          }),
        ),
      },
      responses: { 200: json(z.object({ member: z.string().nullable(), client: z.string().nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId, accountId, chatId } = c.req.valid("param");
      return c.json(await setWhatsAppContact(wa, c.get("user").id, orgId, accountId, chatId, c.req.valid("json")), 200);
    },
  );

  const NumberBrain = AgentBrain.extend({
    own: z.boolean().openapi({ description: "The number answers with an AI of its own; false: with its agent's." }),
    apiModel: z.string().openapi({ description: "The API model the picker marks: the number's, else the agent's." }),
    line: z
      .object({ kind: BrainKind, model: z.string().nullable() })
      .passthrough()
      .nullable()
      .openapi({ description: "What thinks here, as the agent list's `brain` (for the line beside the button)." }),
  }).openapi("WhatsAppBrain");
  const brainSummary =
    "Managers of the number (`manage_connectors`) who may also choose the agent's AI (an admin or its owner). 409 `whatsapp.no_agent` while the number has no agent.";

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/brain",
      tags,
      security,
      summary: "What thinks on the number: its own AI, or its agent's (docs/adr/doug-0004-whatsapp-bridge.md)",
      description: `The agent's brain view (\`GET …/agents/{agentId}/brain\`) with the number's choice in its place. ${brainSummary}`,
      request: { params: AccountParams },
      responses: { 200: json(NumberBrain), ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      return c.json(await getWhatsAppBrain(wa, c.get("user").id, orgId, accountId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/brain",
      tags,
      security,
      summary: "Give the number an AI of its own: an API model, or a Claude or ChatGPT plan on the agent's computer",
      description: `The agent stays who answers (its instructions, memory, skills, budget); only what thinks changes, on this number alone. \`brain\` carries the picker's choice for a plan (its account among the agent's, its model, its effort), \`model\` the API model. Audited as \`whatsapp.brain_changed\`. ${brainSummary}`,
      request: {
        params: AccountParams,
        body: body(
          z.object({
            brain: z
              .object({
                brain: z.enum(WHATSAPP_BRAIN_KINDS).optional(),
                model: z.string().max(80).nullable().optional(),
                account: z.uuid().nullable().optional(),
                effort: z.string().max(10).nullable().optional(),
              })
              .nullable()
              .optional(),
            model: z.string().max(200).optional().openapi({ description: "The API model, for the model brain." }),
          }),
        ),
      },
      responses: { 200: json(NumberBrain), ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      return c.json(await setWhatsAppBrain(wa, c.get("user").id, orgId, accountId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/brain",
      tags,
      security,
      summary: "The number answers with its agent's own AI again",
      description: brainSummary,
      request: { params: AccountParams },
      responses: { 200: json(NumberBrain), ...errors },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      return c.json(await clearWhatsAppBrain(wa, c.get("user").id, orgId, accountId), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/accounts/{accountId}/instructions/draft",
      tags,
      security,
      summary: "Rewrite the number's instructions with a new direction, typed or recorded",
      description:
        "A form with `text` (typed), `audio` (a recording, put into words by the server's speech engines) or both, and `current`, the instructions as the settings hold them (absent: the saved ones). The AI that answers on the number rewrites the whole Markdown with the direction; nothing is saved: the draft comes back for the person to read and save (`PATCH …/accounts/{id}`). `manage_connectors`. 409 `whatsapp.no_agent` while the number has no agent, `whatsapp.voice_off` for a recording on a server that hears none, `whatsapp.ai_busy` while the plan's account is taken; 400 `whatsapp.unheard` when nothing could be heard; 413 past 7 MB; 429 past 20 drafts an hour. Docs: docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-17.",
      request: {
        params: AccountParams,
        body: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: z.object({
                text: z.string().max(WHATSAPP_DIRECTION_MAX).optional(),
                audio: z.any().optional().openapi({ type: "string", format: "binary" }),
                seconds: z.string().max(10).optional().openapi({ description: "The recording's length, in seconds." }),
                current: z.string().max(WHATSAPP_INSTRUCTIONS_MAX).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: json(
          z.object({
            heard: z.string().openapi({ description: "The recording in words; empty when only text came." }),
            instructions: z.string().openapi({ description: "The whole instructions with the direction in them." }),
          }),
          "The draft",
        ),
        413: errorResponse("The recording is too large (`too_large`)"),
        ...tooMany,
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid("param");
      const user = c.get("user");
      const agentDeps = deps.extras?.whatsappAgent;
      if (!agentDeps) return apiError(c, 404, "not_found", "WhatsApp isn't set up on this server");
      if (await limited(`whatsapp-draft:${user.id}`, WHATSAPP_DRAFTS_PER_PERSON)) {
        return apiError(c, 429, "rate_limited", "Slow down");
      }
      const form = c.req.valid("form");
      const file: unknown = form.audio;
      let audio: { bytes: Uint8Array; contentType: string; durationMs?: number } | undefined;
      if (file instanceof File && file.size > 0) {
        if (file.size > WHATSAPP_DIRECTION_AUDIO_MAX_BYTES)
          return apiError(c, 413, "too_large", "The recording is too large");
        const seconds = Number(form.seconds);
        audio = {
          bytes: new Uint8Array(await file.arrayBuffer()),
          contentType: file.type || "audio/mp4",
          ...(Number.isFinite(seconds) && seconds > 0 ? { durationMs: Math.round(seconds * 1000) } : {}),
        };
      }
      try {
        const draft = await draftWhatsAppInstructions(agentDeps, user.id, orgId, accountId, {
          text: form.text,
          current: form.current,
          audio,
        });
        return c.json(draft, 200);
      } catch (error) {
        if (!(error instanceof WhatsAppAgentBusy)) throw error;
        return apiError(c, 409, "whatsapp.ai_busy", "The number's AI account is busy: try again in a moment");
      }
    },
  );

  return app;
}
