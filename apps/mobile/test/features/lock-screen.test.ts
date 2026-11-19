import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveColor, startsLiveActivity } from "../../src/features/live-activity/logic";
import {
  blockPressOf,
  categoryActions,
  isBlockCategory,
  pressClientId,
  readPushActions,
  sameButtons,
} from "../../src/features/push/block-actions";

/** The lock screen (docs/adr/doug-0021-lock-screen.md): a live block's buttons, and the Live Activity. */

const APP = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(APP, path), "utf8");

describe("a live block's buttons on a notification", () => {
  const BUTTONS = [
    { id: "block:2.0", title: "Confirmar", background: true },
    { id: "open", title: "Abrir" },
  ];

  test("the buttons a push brings, as Android (JSON) or the iPhone (a list) hands them, checked", () => {
    expect(readPushActions(JSON.stringify(BUTTONS))).toEqual(BUTTONS);
    expect(readPushActions(BUTTONS)).toEqual(BUTTONS);
    expect(readPushActions("not json")).toEqual([]);
    expect(readPushActions([{ id: "bad id!", title: "x" }, { id: "open", title: " " }, null])).toEqual([]);
  });

  test("one that answers alone asks for the phone unlocked and leaves the app closed; Abrir opens it", () => {
    expect(categoryActions(BUTTONS)).toEqual([
      {
        identifier: "block:2.0",
        buttonTitle: "Confirmar",
        options: { opensAppToForeground: false, isAuthenticationRequired: true },
      },
      {
        identifier: "open",
        buttonTitle: "Abrir",
        options: { opensAppToForeground: true, isAuthenticationRequired: false },
      },
    ]);
    expect(sameButtons(categoryActions(BUTTONS), BUTTONS)).toBe(true);
    expect(sameButtons(undefined, BUTTONS)).toBe(false);
    expect(isBlockCategory("doug.block.0a1b2c3d")).toBe(true);
    expect(isBlockCategory("device.in_use")).toBe(false);
  });

  test("a press names the workspace, the block, its version and the button; anything else is no press", () => {
    const data = { orgId: "o", blockId: "b", blockVersion: "2", notificationId: "n" };
    expect(blockPressOf(data, "block:2.0")).toEqual({ orgId: "o", blockId: "b", version: 2, key: "2.0" });
    expect(blockPressOf(data, "open")).toBeNull();
    expect(blockPressOf({ ...data, blockVersion: "x" }, "block:2.0")).toBeNull();
    expect(blockPressOf({ orgId: "o" }, "block:2.0")).toBeNull();
    expect(pressClientId("0190f1c4-2a5b-7c3d-8e9f-0a1b2c3d4e5f", "2.0")).toBe(
      "p:0190f1c4-2a5b-7c3d-8e9f-0a1b2c3d4e5f:2.0",
    );
    expect(pressClientId("n".repeat(80), "k").length).toBe(64);
  });
});

describe("the Live Activity", () => {
  test("work sent to an agent on an iPhone starts one; a steered message or a GIF alone doesn't", () => {
    const sent = { os: "ios", toAgent: true, steered: false, mediaAlone: false };
    expect(startsLiveActivity(sent)).toBe(true);
    expect(startsLiveActivity({ ...sent, os: "android" })).toBe(false);
    expect(startsLiveActivity({ ...sent, toAgent: false })).toBe(false);
    expect(startsLiveActivity({ ...sent, steered: true })).toBe(false);
    expect(startsLiveActivity({ ...sent, mediaAlone: true })).toBe(false);
    expect(liveColor("#EC4899")).toBe("#ec4899");
    expect(liveColor("rgb(1,2,3)")).toBe("#9cfa05");
  });

  test("the widget's attributes are the module's, and its state is the server's, field for field", () => {
    const widget = read("targets/live-activity/DougActivityAttributes.swift");
    expect(read("modules/live-activity/ios/DougActivityAttributes.swift")).toBe(widget);
    const state = widget.slice(widget.indexOf("struct ContentState"), widget.indexOf("public init(title"));
    const fields = [...state.matchAll(/public var (\w+):/g)].map((m) => m[1]);
    const server = read("../../packages/engine/src/live-activities.ts");
    const live = server.slice(server.indexOf("export interface LiveState"), server.indexOf("const clip"));
    expect(fields).toEqual([...live.matchAll(/^ {2}(\w+): /gm)].map((m) => m[1]));
  });

  test("the extensions are signed apart from the app, and share the app's group", () => {
    const live = require(join(APP, "targets/live-activity/expo-target.config.js"))({
      ios: { bundleIdentifier: "app.dougbot" },
    });
    expect(live).toMatchObject({ type: "widget", name: "DougLive", bundleIdentifier: ".live" });
    expect(live.entitlements["com.apple.security.application-groups"]).toEqual(["group.app.dougbot"]);
    const notice = require(join(APP, "targets/notification-service/expo-target.config.js"))();
    expect(notice).toMatchObject({ type: "notification-service", name: "DougNotice" });
    // The extension registers only block categories, with the prefix the server names them by.
    expect(read("targets/notification-service/NotificationService.swift")).toContain('"doug.block."');
    expect(read("../../packages/engine/src/push-actions.ts")).toContain('"doug.block."');
  });
});
