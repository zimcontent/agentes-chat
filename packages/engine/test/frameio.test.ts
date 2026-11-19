import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { asc, eq, schema } from "@dougbot/db";
import {
  createRoutine,
  createWebhookEndpoint,
  ForbiddenSignatureError,
  frameioEvent,
  frameioSignatureValid,
  handleWebhook,
  type McpSession,
  setWebhookSecret,
  type WebhookDeps,
} from "../src";
import { type Fixture, setup } from "./fixtures";
import { routineDeps } from "./routine-fixtures";

/** ADR 0130, addendum 2026-11-14: Frame.io's comments and uploads start routines, read through its connection. */

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const PUBLIC = "https://agentes.test";
const ACCOUNT = "acc-1";
const COMMENT = "0193aaaa-0000-4000-8000-000000000001";
const FILE = "0193aaaa-0000-4000-8000-000000000002";

const sign = (secret: string, body: string, at: number, trailing = "") =>
  `v0=${createHmac("sha256", secret).update(`v0:${at}:${body}${trailing}`, "utf8").digest("hex")}`;
const signed = (secret: string, body: string, at = Math.floor(Date.now() / 1000)) =>
  new Headers({ "x-frameio-signature": sign(secret, body, at), "x-frameio-request-timestamp": String(at) });

const call = (type: string, resource: string) =>
  JSON.stringify({
    type,
    account: { id: ACCOUNT },
    workspace: { id: "ws-1" },
    project: { id: "proj-1" },
    user: { id: "user-1" },
    resource: { id: resource, type: type.startsWith("comment") ? "comment" : "file" },
  });

describe("Frame.io's signature", () => {
  const body = call("comment.created", COMMENT);
  const now = 1_800_000_000_000;
  const at = now / 1000;
  const headers = (signature: string, stamp = at) =>
    new Headers({ "x-frameio-signature": signature, "x-frameio-request-timestamp": String(stamp) });

  test("v0= HMAC-SHA256 of v0:<timestamp>:<body>, with or without the guide's trailing period", () => {
    expect(frameioSignatureValid("s3cret-key", body, headers(sign("s3cret-key", body, at)), now)).toBe(true);
    expect(frameioSignatureValid("s3cret-key", body, headers(sign("s3cret-key", body, at, ".")), now)).toBe(true);
  });

  test("another secret, another body, no timestamp or one past five minutes: refused", () => {
    expect(frameioSignatureValid("other-key", body, headers(sign("s3cret-key", body, at)), now)).toBe(false);
    expect(frameioSignatureValid("s3cret-key", `${body} `, headers(sign("s3cret-key", body, at)), now)).toBe(false);
    expect(
      frameioSignatureValid(
        "s3cret-key",
        body,
        new Headers({ "x-frameio-signature": sign("s3cret-key", body, at) }),
        now,
      ),
    ).toBe(false);
    const old = at - 301;
    expect(frameioSignatureValid("s3cret-key", body, headers(sign("s3cret-key", body, old), old), now)).toBe(false);
    const ahead = at + 301;
    expect(frameioSignatureValid("s3cret-key", body, headers(sign("s3cret-key", body, ahead), ahead), now)).toBe(false);
  });
});

describe("Frame.io's events", () => {
  test("a comment and a finished upload, each with its identity; anything else is nothing routines wait on", () => {
    expect(frameioEvent(JSON.parse(call("comment.created", COMMENT)))).toMatchObject({
      event: "frameio.comment_created",
      dedupeKey: `frameio:comment:${COMMENT}`,
      data: { accountId: ACCOUNT, projectId: "proj-1", resourceId: COMMENT },
    });
    expect(frameioEvent(JSON.parse(call("file.upload.completed", FILE)))).toMatchObject({
      event: "frameio.file_uploaded",
      dedupeKey: `frameio:file:${FILE}`,
    });
    expect(frameioEvent(JSON.parse(call("file.created", FILE)))).toBeNull();
    expect(frameioEvent({ type: "comment.created", resource: { id: "a b" } })).toBeNull();
  });
});

/** A Frame.io connection, the agent allowed to read it (or not), and a fake server answering its reads. */
async function frameio(read = true) {
  const [connection] = await f.db
    .insert(schema.connectorConnections)
    .values({
      orgId: f.org.id,
      connector: "mcp_frameio",
      label: "Frame.io",
      serverUrl: "https://mcp.frame.io/v1/mcp",
      authType: "none",
      toolPrefix: "frameio",
    })
    .returning();
  if (!connection) throw new Error("no connection");
  if (read) {
    await f.db.insert(schema.agentScopes).values({
      orgId: f.org.id,
      agentId: f.agent.id,
      connectionId: connection.id,
      scope: `custom:${connection.id}:read`,
    });
  }
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const session: McpSession = {
    listTools: async () => [],
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "read_comments") {
        const comment = {
          id: COMMENT,
          text: "Tira a música no 0:12 e aumenta a legenda",
          owner: { name: "Melissa Vazquez" },
          timecode: "00:00:12:00",
          file_id: FILE,
        };
        return { content: JSON.stringify({ items: [comment] }), isError: false };
      }
      if (name === "read_assets") {
        const file = { id: FILE, name: "Short 03 v2.mp4", view_url: "https://next.frame.io/view/abc" };
        return { content: JSON.stringify(file), isError: false };
      }
      return { content: "ok", isError: false };
    },
    close: async () => {},
  };
  const deps: WebhookDeps = {
    db: f.db,
    keyWrappers: [f.keyWrapper],
    connectors: { db: f.db, keyWrappers: [f.keyWrapper], publicUrl: PUBLIC, connect: async () => session },
  };
  return { connection, calls, deps };
}

const runsOf = (routineId: string) =>
  f.db
    .select()
    .from(schema.routineRuns)
    .where(eq(schema.routineRuns.routineId, routineId))
    .orderBy(asc(schema.routineRuns.createdAt));

async function commentRoutine() {
  return createRoutine(routineDeps(f), f.owner.id, f.org.id, {
    agentId: f.agent.id,
    prompt: "Leia o comentário e organize o ajuste.",
    target: { type: "channel", channelId: f.general.id },
    trigger: { type: "event", event: "frameio.comment_created" },
  });
}

describe("Frame.io's webhook", () => {
  test("a comment fires its routine with the words, author, timecode, file and link read in code; a retry fires nothing", async () => {
    f = await setup();
    const { deps, calls } = await frameio();
    const routine = await commentRoutine();
    const hook = await createWebhookEndpoint(deps, f.owner.id, f.org.id, "frameio", PUBLIC);
    const body = call("comment.created", COMMENT);
    // No secret pasted yet: the address alone (Frame.io's page may show none).
    const first = await handleWebhook(deps, "frameio", hook.id, new Headers(), body);
    expect(first).toEqual({ fired: 1, event: "frameio.comment_created" });
    expect(calls.map((c) => c.name)).toEqual(["mandatory_init", "read_comments", "read_assets"]);
    expect(calls[1]?.args).toEqual({ account_id: ACCOUNT, target: { type: "comment", id: COMMENT } });
    const [run] = await runsOf(routine.id);
    expect(run?.event).toMatchObject({
      type: "frameio.comment_created",
      summary:
        "New Frame.io comment on Short 03 v2.mp4 at 00:00:12:00: Melissa Vazquez: Tira a música no 0:12 e aumenta a legenda",
      text: "Tira a música no 0:12 e aumenta a legenda",
      author: "Melissa Vazquez",
      file: "Short 03 v2.mp4",
      link: "https://next.frame.io/view/abc",
      resourceId: COMMENT,
    });
    expect(await handleWebhook(deps, "frameio", hook.id, new Headers(), body)).toEqual({
      fired: 0,
      event: "frameio.comment_created",
    });
    expect(await runsOf(routine.id)).toHaveLength(1);
  });

  test("once its signing secret is pasted, only calls signed with it pass", async () => {
    f = await setup();
    const { deps } = await frameio();
    await commentRoutine();
    const hook = await createWebhookEndpoint(deps, f.owner.id, f.org.id, "frameio", PUBLIC);
    await setWebhookSecret(deps, f.owner.id, f.org.id, "frameio", "frameio-signing-secret", PUBLIC);
    const body = call("comment.created", COMMENT);
    await expect(handleWebhook(deps, "frameio", hook.id, new Headers(), body)).rejects.toBeInstanceOf(
      ForbiddenSignatureError,
    );
    await expect(handleWebhook(deps, "frameio", hook.id, signed("another-secret", body), body)).rejects.toBeInstanceOf(
      ForbiddenSignatureError,
    );
    expect(await handleWebhook(deps, "frameio", hook.id, signed("frameio-signing-secret", body), body)).toEqual({
      fired: 1,
      event: "frameio.comment_created",
    });
  });

  test("an agent that may not read the Frame.io connection gets the ids alone", async () => {
    f = await setup();
    const { deps } = await frameio(false);
    const routine = await commentRoutine();
    const hook = await createWebhookEndpoint(deps, f.owner.id, f.org.id, "frameio", PUBLIC);
    await handleWebhook(deps, "frameio", hook.id, new Headers(), call("comment.created", COMMENT));
    const [run] = await runsOf(routine.id);
    expect(run?.event).toMatchObject({ summary: "New comment on Frame.io", resourceId: COMMENT });
    expect(run?.event).not.toHaveProperty("text");
  });

  test("a finished upload fires the upload routine with the file's name and link; no routine waiting reads nothing", async () => {
    f = await setup();
    const { deps, calls } = await frameio();
    const hook = await createWebhookEndpoint(deps, f.owner.id, f.org.id, "frameio", PUBLIC);
    const upload = call("file.upload.completed", FILE);
    expect(await handleWebhook(deps, "frameio", hook.id, new Headers(), upload)).toEqual({
      fired: 0,
      event: "frameio.file_uploaded",
    });
    expect(calls).toHaveLength(0);
    const routine = await createRoutine(routineDeps(f), f.owner.id, f.org.id, {
      agentId: f.agent.id,
      prompt: "Diga o que chegou.",
      target: { type: "channel", channelId: f.general.id },
      trigger: { type: "event", event: "frameio.file_uploaded" },
    });
    await handleWebhook(
      deps,
      "frameio",
      hook.id,
      new Headers({ "x-retry": "1" }),
      call("file.upload.completed", "f-2"),
    );
    const [run] = await runsOf(routine.id);
    expect(run?.event).toMatchObject({
      type: "frameio.file_uploaded",
      summary: "New file on Frame.io: Short 03 v2.mp4",
      file: "Short 03 v2.mp4",
      link: "https://next.frame.io/view/abc",
    });
  });
});
