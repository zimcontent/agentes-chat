import {
  addLiveLines,
  askFromLiveRoom,
  channelLiveRoom,
  endLiveRoom,
  endLiveSession,
  inviteToLiveRoom,
  joinLiveRoom,
  LIVE_ROOM_MAX_AGENTS,
  LIVE_ROOM_MAX_INVITES,
  type LiveVoiceDeps,
  leaveLiveRoom,
  liveVoiceView,
  NotFoundError,
  type PhoneDeps,
  phoneLineView,
  pickLiveSpeaker,
  pingLiveRoom,
  relayLiveSignal,
  removeLiveVoiceKey,
  removePhoneLine,
  saveLiveCallNotes,
  saveLiveVoiceKey,
  savePhoneLine,
  setLiveFloor,
  setPhoneEngine,
  startLiveSession,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, errorResponse } from "../../http/errors";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const tags = ["Live voice"];

const KEY_WRITES = { limit: 10, windowMs: 60_000 };
const SESSIONS = { limit: 40, windowMs: 60_000 };
/** WebRTC's offers, answers and candidates while people connect, and every line said. */
const SIGNALS = { limit: 600, windowMs: 60_000 };

const RoomParams = OrgParams.extend({ roomId: z.uuid() });
const ChannelParams = OrgParams.extend({ channelId: z.uuid() });
const SessionParams = OrgParams.extend({ sessionId: z.uuid() });

const View = z
  .object({
    state: z.enum(["off", "ok"]).openapi({ description: "`ok`: calls and Ouvir work in this workspace." }),
    hint: z
      .string()
      .nullable()
      .openapi({ description: "The key's last 4 characters, for who configures. Never the key." }),
    editable: z.boolean(),
    callNotes: z.string().openapi({ description: "How the agents behave on calls here, on top of the base rules." }),
  })
  .openapi("LiveVoice");

const PhoneLine = z
  .object({
    state: z
      .enum(["off", "ok"])
      .openapi({ description: "`ok`: the Doug here may call, through one of its owners' lines." }),
    fromNumber: z.string().openapi({ description: "The number calls go out from here." }),
    mine: z
      .object({ url: z.string(), fromNumber: z.string(), hint: z.string() })
      .nullable()
      .openapi({ description: "The person's own line, only to them: its token's last 4 characters, never the token." }),
    editable: z.boolean().openapi({ description: "Only an owner connects a line, and only their own." }),
    engine: z.enum(["gpt-live", "qwen"]).openapi({ description: "The voice calls here go out with." }),
    engines: z.array(z.enum(["gpt-live", "qwen"])).openapi({ description: "The voices the line can use." }),
    canChoose: z.boolean().openapi({ description: "Whether this person may change the voice (`configure`)." }),
    credits: z
      .object({ perMinute: z.number(), balance: z.number() })
      .nullable()
      .openapi({ description: "The house voice's price per minute and the workspace's credits (Mídia)." }),
  })
  .openapi("PhoneLine");

const Line = z.object({
  at: z.string(),
  who: z.object({ type: z.enum(["person", "agent"]), id: z.string() }),
  text: z.string(),
});

const Room = z
  .object({
    id: z.uuid(),
    channelId: z.uuid(),
    hostUserId: z.string().nullable().openapi({ description: "Whose app runs the agents' voices." }),
    agentIds: z.array(z.uuid()),
    topic: z.string().nullable(),
    people: z.array(
      z.object({
        userId: z.string(),
        joinedAt: z.string(),
        phone: z.boolean().optional().openapi({ description: "In from the phone app." }),
      }),
    ),
    status: z.enum(["live", "ended"]),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    lines: z.array(Line),
    reportMessageId: z.uuid().nullable(),
  })
  .openapi("LiveRoom");

const Session = z
  .object({
    id: z.uuid(),
    sdp: z.string().openapi({ description: "OpenAI's WebRTC answer, for the app's `setRemoteDescription`." }),
    voice: z.string(),
    maxSeconds: z.number().int(),
    minSeconds: z.number().int(),
  })
  .openapi("LiveSession");

const Sdp = z.string().min(10).max(40_000);

/**
 * Live voice with GPT-Live (ADR doug-0006): the workspace's key, sessions the server opens with it (the app sends its
 * WebRTC offer, the key stays here), and voice rooms where people and agents talk, with their notes posted when the
 * call ends.
 */
export function liveVoiceRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const live = (): LiveVoiceDeps => {
    const d = deps.extras?.liveVoice;
    if (!d) throw new NotFoundError();
    return d;
  };
  const allowed = async (key: string, limit: { limit: number; windowMs: number }) =>
    (await deps.adapters.rateLimiter.consume(key, limit)).allowed;
  const tooMany = { 429: errorResponse("Too many tries (`rate_limited`)") };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/live-voice",
      tags,
      security,
      summary: "Whether calls and Ouvir work here, and the key's last 4 characters for who configures",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => c.json(await liveVoiceView(live(), c.get("user").id, c.req.valid("param").orgId), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/live-voice",
      tags,
      security,
      summary: "Add or replace the workspace's OpenAI key for GPT-Live",
      description:
        "Needs `configure`. Checked with OpenAI first (422 `live_voice.key_invalid`, `live_voice.no_access`, `live_voice.unchecked`); sealed like provider keys and never returned. Recorded in the audit log with its last 4 characters.",
      request: { params: OrgParams, body: body(z.object({ apiKey: z.string().trim().min(20).max(300) })) },
      responses: { 200: json(View), ...errors, ...tooMany },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`live-voice-key:${user.id}`, KEY_WRITES)))
        return apiError(c, 429, "rate_limited", "Too many tries. Wait a minute.");
      const { orgId } = c.req.valid("param");
      return c.json(await saveLiveVoiceKey(live(), user.id, orgId, c.req.valid("json").apiKey), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/live-voice",
      tags,
      security,
      summary: "Remove the workspace's GPT-Live key: calls with agents and Ouvir stop",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => c.json(await removeLiveVoiceKey(live(), c.get("user").id, c.req.valid("param").orgId), 200),
  );

  const phone = (): PhoneDeps => {
    const d = deps.extras?.phone;
    if (!d) throw new NotFoundError();
    return d;
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/phone-line",
      tags,
      security,
      summary: "Whether the Doug here may call phones, and the person's own line",
      request: { params: OrgParams },
      responses: { 200: json(PhoneLine), ...errors },
    }),
    async (c) => c.json(await phoneLineView(phone(), c.get("user").id, c.req.valid("param").orgId), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/phone-line",
      tags,
      security,
      summary: "Connect or replace the person's own phone line, for every workspace they own",
      description:
        "Only an owner of this workspace (403 `phone.not_owner`). The calling service's address (https) and token, checked with the service first (422 `phone.url_invalid`, `phone.token_invalid`, `phone.unreachable`); the token is sealed like provider keys and never returned (docs/adr/doug-0035-phone-calls.md).",
      request: {
        params: OrgParams,
        body: body(z.object({ url: z.string().trim().min(8).max(500), token: z.string().trim().min(16).max(300) })),
      },
      responses: { 200: json(PhoneLine), ...errors, ...tooMany },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`phone-line:${user.id}`, KEY_WRITES)))
        return apiError(c, 429, "rate_limited", "Too many tries. Wait a minute.");
      return c.json(await savePhoneLine(phone(), user.id, c.req.valid("param").orgId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/phone-line/engine",
      tags,
      security,
      summary: "Pick the voice of the Doug's phone calls here",
      description:
        "Needs `configure`. `gpt-live`: GPT-Live 1 on the calling service's key. `qwen`: Qwen Audio 3.1 Flash on the house key, paid by the second from the workspace's credits (422 `phone.no_credits` without a wallet on this server).",
      request: { params: OrgParams, body: body(z.object({ engine: z.enum(["gpt-live", "qwen"]) })) },
      responses: { 200: json(PhoneLine), ...errors },
    }),
    async (c) =>
      c.json(
        await setPhoneEngine(phone(), c.get("user").id, c.req.valid("param").orgId, c.req.valid("json").engine),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/phone-line",
      tags,
      security,
      summary: "Remove the person's own phone line: the Doug of the workspaces they own stops calling through it",
      request: { params: OrgParams },
      responses: { 200: json(PhoneLine), ...errors },
    }),
    async (c) => c.json(await removePhoneLine(phone(), c.get("user").id, c.req.valid("param").orgId), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-voice/sessions",
      tags,
      security,
      summary: "Open a GPT-Live session from the app's WebRTC offer",
      description:
        "`call`: an agent's voice in a voice room, opened by the room's host. `agent`: a call with one agent from its conversation (`channelId`), the agent working behind its voice. `listen`: a message told, in its agent's voice, as a colleague would tell it. `sample`: a voice saying hello. The agent's budget and the person's limit are checked first; the session is billed by the second when it ends.",
      request: {
        params: OrgParams,
        body: body(
          z.object({
            kind: z.enum(["call", "agent", "listen", "sample"]),
            sdp: Sdp,
            agentId: z.uuid().nullish(),
            roomId: z.uuid().nullish(),
            channelId: z.uuid().nullish(),
            messageId: z.uuid().nullish(),
            voice: z.string().max(40).nullish(),
            language: z.string().max(16).nullish(),
          }),
        ),
      },
      responses: { 200: json(Session), ...errors, ...tooMany },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`live-voice-session:${user.id}`, SESSIONS)))
        return apiError(c, 429, "rate_limited", "Too many tries. Wait a minute.");
      const { orgId } = c.req.valid("param");
      return c.json(await startLiveSession(live(), user.id, orgId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-voice/sessions/{sessionId}/end",
      tags,
      security,
      summary: "End a GPT-Live session the app opened",
      request: { params: SessionParams },
      responses: { 204: { description: "Ending" }, ...errors },
    }),
    async (c) => {
      const { orgId, sessionId } = c.req.valid("param");
      await endLiveSession(live(), c.get("user").id, orgId, sessionId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/channels/{channelId}/live-room",
      tags,
      security,
      summary: "The conversation's voice room while it is live (its Join banner), or null",
      request: { params: ChannelParams },
      responses: { 200: json(z.object({ room: Room.nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId, channelId } = c.req.valid("param");
      return c.json({ room: await channelLiveRoom(live(), c.get("user").id, orgId, channelId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/channels/{channelId}/live-room",
      tags,
      security,
      summary: "Start the conversation's voice room, or join it when one is live",
      description: `Agents only when starting it, up to ${LIVE_ROOM_MAX_AGENTS}, and only those this person may talk to here; joining keeps the room's.`,
      request: {
        params: ChannelParams,
        body: body(
          z.object({
            agentIds: z.array(z.uuid()).max(LIVE_ROOM_MAX_AGENTS).default([]),
            topic: z.string().max(500).nullable().optional(),
            language: z.string().max(12).optional().openapi({ description: "The app's language (`pt-BR`)." }),
            phone: z.boolean().optional().openapi({
              description:
                "From the phone app: a person on the web or the desktop app runs the agents' voices when one is in.",
            }),
          }),
        ),
      },
      responses: { 200: json(Room), ...errors },
    }),
    async (c) => {
      const { orgId, channelId } = c.req.valid("param");
      const user = c.get("user");
      const input = c.req.valid("json");
      return c.json(await joinLiveRoom(live(), user.id, orgId, channelId, input), 200);
    },
  );

  const roomAction = (path: string, summary: string) =>
    createRoute({
      method: "post",
      path: `/organizations/{orgId}/live-rooms/{roomId}/${path}`,
      tags,
      security,
      summary,
      request: { params: RoomParams },
      responses: { 200: json(Room), ...errors },
    });

  app.openapi(roomAction("ping", "Still in the call (every 20 s): who left without saying goes"), async (c) => {
    const { orgId, roomId } = c.req.valid("param");
    return c.json(await pingLiveRoom(live(), c.get("user").id, orgId, roomId), 200);
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/leave",
      tags,
      security,
      summary: "Leave the call; the host's place goes to the next person, the call ends when nobody is left",
      request: { params: RoomParams },
      responses: { 204: { description: "Left" }, ...errors },
    }),
    async (c) => {
      const { orgId, roomId } = c.req.valid("param");
      await leaveLiveRoom(live(), c.get("user").id, orgId, roomId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/end",
      tags,
      security,
      summary:
        "End the call for everyone; its notes go to the conversation, asking the team's right hand for the report",
      request: { params: RoomParams },
      responses: { 200: json(z.object({ room: Room.nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId, roomId } = c.req.valid("param");
      const room = await endLiveRoom(live(), c.get("user").id, orgId, roomId);
      deps.wakeWorkers?.();
      return c.json({ room }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/signal",
      tags,
      security,
      summary: "Pass a WebRTC offer, answer or candidate to another person in the call",
      request: {
        params: RoomParams,
        body: body(
          z.object({
            to: z.string().min(1).max(100),
            data: z.record(z.string(), z.unknown()).openapi({ description: "Passed on as it is (at most 40 kB)." }),
          }),
        ),
      },
      responses: { 204: { description: "Sent" }, ...errors, ...tooMany },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`live-signal:${user.id}`, SIGNALS)))
        return apiError(c, 429, "rate_limited", "Too many signals.");
      const { orgId, roomId } = c.req.valid("param");
      const { to, data } = c.req.valid("json");
      if (JSON.stringify(data).length > 40_000) return apiError(c, 413, "live_room.signal_too_large", "Too large");
      await relayLiveSignal(live(), user.id, orgId, roomId, to, data);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/lines",
      tags,
      security,
      summary: "What was said: one's own words, or (the host) the agents'",
      request: {
        params: RoomParams,
        body: body(
          z.object({
            lines: z
              .array(
                z.object({
                  who: z.object({ type: z.enum(["person", "agent"]), id: z.string().max(100) }),
                  text: z.string().max(4000),
                }),
              )
              .max(20),
          }),
        ),
      },
      responses: { 204: { description: "Kept" }, ...errors, ...tooMany },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`live-signal:${user.id}`, SIGNALS)))
        return apiError(c, 429, "rate_limited", "Too many lines.");
      const { orgId, roomId } = c.req.valid("param");
      await addLiveLines(live(), user.id, orgId, roomId, c.req.valid("json").lines);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/floor",
      tags,
      security,
      summary: "Give the word to an agent, or to the people (null); the host's app applies it",
      request: {
        params: RoomParams,
        body: body(z.object({ holder: z.uuid().nullable(), reason: z.string().max(40).default("manual") })),
      },
      responses: { 204: { description: "Sent" }, ...errors, ...tooMany },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`live-signal:${user.id}`, SIGNALS))) return apiError(c, 429, "rate_limited", "Too many.");
      const { orgId, roomId } = c.req.valid("param");
      const { holder, reason } = c.req.valid("json");
      await setLiveFloor(live(), user.id, orgId, roomId, holder, reason);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/next",
      tags,
      security,
      summary: "The host asks which agent speaks next, and when (the workspace's small model decides)",
      description:
        "`person` (default): after a person spoke to nobody by name. `after`: an agent just finished; does a colleague build on it? `during`: an agent is talking (`speaking.text`, its words so far); does a colleague cut in now (`when: now`) or speak right after? `skip`: agents the room's limits keep out.",
      request: {
        params: RoomParams,
        body: {
          required: false,
          content: {
            "application/json": {
              schema: z.object({
                moment: z.enum(["person", "after", "during"]).optional(),
                speaking: z
                  .object({ agentId: z.uuid(), text: z.string().max(4000).optional() })
                  .nullable()
                  .optional(),
                skip: z.array(z.uuid()).max(20).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: json(z.object({ agentId: z.uuid().nullable(), when: z.enum(["now", "after"]).nullable() })),
        ...errors,
        ...tooMany,
      },
    }),
    async (c) => {
      const user = c.get("user");
      // An agent's every sentence may ask while it talks: about one ask in four seconds, with room for the rest.
      if (!(await allowed(`live-next:${user.id}`, { limit: 40, windowMs: 60_000 })))
        return c.json({ agentId: null, when: null }, 200);
      const { orgId, roomId } = c.req.valid("param");
      const ask = c.req.valid("json") ?? {};
      return c.json(await pickLiveSpeaker(live(), user.id, orgId, roomId, ask), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/ask",
      tags,
      security,
      summary:
        "An agent on the call took on work: it goes to the conversation and the agent works on it during the call",
      description:
        "From the host's app when an agent delegates (GPT-Live's `session.delegation.created`). Posts what was asked as the host's message mentioning the agent (`meta.via: call`); everyone on the call gets `live.working`, and the host gets `live.answer` with the agent's answer, made speakable, once it comes (null after 4 minutes).",
      request: {
        params: RoomParams,
        body: body(
          z.object({
            agentId: z.uuid(),
            ask: z.string().trim().min(1).max(4000),
            delegationId: z.string().min(1).max(200),
          }),
        ),
      },
      responses: { 200: json(z.object({ askId: z.uuid() })), ...errors, ...tooMany },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`live-ask:${user.id}`, { limit: 20, windowMs: 60_000 })))
        return apiError(c, 429, "rate_limited", "Too many asks.");
      const { orgId, roomId } = c.req.valid("param");
      return c.json(await askFromLiveRoom(live(), user.id, orgId, roomId, c.req.valid("json")), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/live-voice/notes",
      tags,
      security,
      summary: "How the agents behave on calls in this workspace, on top of the base rules",
      description: "Needs `configure`. Up to 3,000 characters; empty clears them.",
      request: { params: OrgParams, body: body(z.object({ notes: z.string().max(3000) })) },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      return c.json(await saveLiveCallNotes(live(), c.get("user").id, orgId, c.req.valid("json").notes), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/live-rooms/{roomId}/invite",
      tags,
      security,
      summary: "Calls people into the call: added to the conversation when needed, mentioned there, and rung",
      request: {
        params: RoomParams,
        body: body(
          z.object({
            userIds: z.array(z.string().min(1).max(64)).min(1).max(LIVE_ROOM_MAX_INVITES),
            language: z.string().max(20).nullish(),
          }),
        ),
      },
      responses: {
        200: json(z.object({ invited: z.array(z.string()), refused: z.array(z.string()) }), "Who was called"),
        ...errors,
        ...tooMany,
      },
    }),
    async (c) => {
      const user = c.get("user");
      if (!(await allowed(`live-invite:${user.id}`, { limit: 30, windowMs: 60_000 })))
        return apiError(c, 429, "rate_limited", "Too many.");
      const { orgId, roomId } = c.req.valid("param");
      return c.json(await inviteToLiveRoom(live(), user.id, orgId, roomId, c.req.valid("json")), 200);
    },
  );

  return app;
}
