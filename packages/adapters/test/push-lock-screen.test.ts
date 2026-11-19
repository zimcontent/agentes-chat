import { describe, expect, test } from "bun:test";
import type { PushMessage } from "../src/push";
import {
  APNS_SANDBOX_ORIGIN,
  apnsLiveActivityRequest,
  apnsRequest,
  createApnsPushSender,
  type Http2Client,
} from "../src/push-apns";
import { fcmMessage } from "../src/push-fcm";

/** The lock screen (docs/adr/doug-0021-lock-screen.md): a live block's buttons, and Live Activities. */

const APP = "app.dougbot";
const TOKEN = "ab".repeat(32);
const BUTTONS = [
  { id: "block:2.0", title: "Confirmar", background: true },
  { id: "open", title: "Abrir" },
];

const msg = (extra: Partial<PushMessage> = {}): PushMessage => ({
  to: TOKEN,
  platform: "ios",
  title: "Doug",
  body: "Seu dia",
  data: { orgId: "o", kind: "agent_reply", blockId: "b", blockVersion: "1" },
  ...extra,
});

describe("a push with buttons whose words come with it", () => {
  test("APNs: the category, mutable content for the extension, and the buttons beside the data", () => {
    const { body } = apnsRequest(msg({ category: "doug.block.0a1b2c3d", actions: BUTTONS }), APP, 0);
    expect(body.aps).toMatchObject({ category: "doug.block.0a1b2c3d", "mutable-content": 1 });
    expect((body as { actions?: unknown }).actions).toEqual(BUTTONS);
    // Without buttons, nothing changes.
    const plain = apnsRequest(msg(), APP, 0).body;
    expect(plain.aps).not.toHaveProperty("mutable-content");
    expect(plain).not.toHaveProperty("actions");
  });

  test("FCM: the category expo-notifications reads, and the buttons for the app to register", () => {
    const { data } = fcmMessage(msg({ platform: "android", to: "tok", category: "doug.block.1", actions: BUTTONS }))
      .message as { data: Record<string, string> };
    expect(data.categoryId).toBe("doug.block.1");
    expect(JSON.parse(data.actions ?? "[]")).toEqual(BUTTONS);
  });
});

describe("Live Activity pushes", () => {
  test("its own push type and topic; an update at 5 with a stale date, an end at 10 with its dismissal", () => {
    const now = 1_800_000_000_000;
    const update = apnsLiveActivityRequest(
      { to: TOKEN, event: "update", state: { progress: 0.5 }, staleAt: new Date(now + 60_000) },
      APP,
      now,
    );
    expect(update.headers).toMatchObject({
      "apns-topic": "app.dougbot.push-type.liveactivity",
      "apns-push-type": "liveactivity",
      "apns-priority": "5",
    });
    expect(update.body.aps).toEqual({
      timestamp: now / 1000,
      event: "update",
      "content-state": { progress: 0.5 },
      "stale-date": now / 1000 + 60,
    });
    const end = apnsLiveActivityRequest({ to: TOKEN, event: "end", state: { progress: 1 } }, APP, now);
    expect(end.headers["apns-priority"]).toBe("10");
    expect(end.body.aps).toMatchObject({ event: "end", "dismissal-date": now / 1000 });
  });

  test("sent on the iPhone sender's connection, to the activity's environment", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
    const calls: { origin: string; path: string; headers: Record<string, string> }[] = [];
    const http2: Http2Client = {
      async request(origin, request) {
        calls.push({ origin, path: request.path, headers: request.headers });
        return { status: request.path.includes("0000") ? 410 : 200, body: "" };
      },
      close() {},
    };
    const sender = createApnsPushSender({ key: { key: pem, keyId: "K", teamId: "T" }, appIds: [APP], http2 });
    const results = await sender.liveActivities.send([
      { to: TOKEN, event: "update", state: {}, apns: { sandbox: true } },
      { to: "0000".repeat(16), event: "end", state: {} },
    ]);
    expect(results.map((r) => [r.ok, r.unregistered])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(calls[0]).toMatchObject({ origin: APNS_SANDBOX_ORIGIN, path: `/3/device/${TOKEN}` });
    expect(calls[0]?.headers.authorization).toStartWith("bearer ");
    expect(calls[0]?.headers["apns-push-type"]).toBe("liveactivity");
  });
});
