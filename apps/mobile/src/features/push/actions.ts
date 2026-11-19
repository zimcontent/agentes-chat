import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { createApi } from "@/lib/api";
import { readPushData } from "@/lib/push-payload";
import { placeAccounts, placeKey, signedInServers } from "@/lib/server";
import { pushPlace } from "@/lib/server-choice";
import {
  BLOCK_ACTION_PREFIX,
  blockPressOf,
  categoryActions,
  isBlockCategory,
  type PushAction,
  pressClientId,
  readPushActions,
  sameButtons,
} from "./block-actions";

/**
 * A live block's buttons on the lock screen (docs/adr/doug-0021-lock-screen.md), the phone's side: a press runs on the
 * server with this phone's session, without opening the app where the system lets it (an iPhone asks to be unlocked
 * first); a failed one leaves the notification where it was. Android registers a push's buttons in a background task
 * (the iPhone's notification service extension does it there).
 */

const PUSH_TASK = "doug.push.buttons";

/** Presses already sent, by notification and button: one handed over twice runs once. */
const pressed = new Set<string>();

/** Whether this response is a press of a block's button (it never opens a screen). */
export const isBlockPress = (actionId: string) => actionId.startsWith(BLOCK_ACTION_PREFIX);

/** Runs a block button pressed on a notification; true when it was one (sent, or sent before). */
export async function runBlockPress(response: Notifications.NotificationResponse): Promise<boolean> {
  const request = response.notification.request;
  const data = readPushData(request.content.data);
  const press = blockPressOf(data, response.actionIdentifier);
  if (!press) return false;
  const notificationId = data.notificationId ?? request.identifier;
  const once = `${notificationId}|${response.actionIdentifier}`;
  if (pressed.has(once)) return true;
  pressed.add(once);
  const place = pushPlace(data.server, placeKey(), signedInServers(), { user: data.user, accounts: placeAccounts() });
  if (place.kind === "gone") return true;
  const api = createApi(place.kind === "here" ? placeKey() : place.server);
  try {
    await api.artifacts.pressBlock(press.orgId, press.blockId, {
      version: press.version,
      key: press.key,
      clientId: pressClientId(notificationId, press.key),
    });
    await Notifications.dismissNotificationAsync(request.identifier).catch(() => {});
  } catch {
    // Not sent (offline, signed out, the block changed): the notification stays, to open or press again.
    pressed.delete(once);
  }
  return true;
}

/** Registers a push's buttons as its category; true when they weren't there yet. */
export async function ensureButtons(category: string, actions: readonly PushAction[]): Promise<boolean> {
  if (!isBlockCategory(category) || actions.length === 0) return false;
  const known = await Notifications.getNotificationCategoriesAsync().catch(() => []);
  const same = known.find((c) => c.identifier === category);
  if (same && sameButtons(same.actions, actions)) return false;
  await Notifications.setNotificationCategoryAsync(category, categoryActions(actions)).catch(() => null);
  return true;
}

/**
 * Android: a push came with buttons not registered yet. Registered now; the notification the system already showed
 * without them is shown again with them (only when it is found, so it never shows twice).
 */
async function showWithButtons(raw: Record<string, unknown>) {
  const category = raw.categoryId;
  const actions = readPushActions(raw.actions);
  if (!isBlockCategory(category) || !(await ensureButtons(category, actions))) return;
  let body: Record<string, unknown> = {};
  try {
    body = typeof raw.body === "string" ? (JSON.parse(raw.body) as Record<string, unknown>) : {};
  } catch {
    return;
  }
  const id = body.notificationId;
  if (typeof id !== "string") return;
  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  const old = shown.find((n) => readPushData(n.request.content.data).notificationId === id);
  if (!old) return;
  await Notifications.dismissNotificationAsync(old.request.identifier).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    content: {
      title: old.request.content.title ?? (typeof raw.title === "string" ? raw.title : ""),
      body: old.request.content.body ?? (typeof raw.message === "string" ? raw.message : ""),
      data: body,
      categoryIdentifier: category,
      sound: "default",
    },
    trigger: { channelId: "default" },
  }).catch(() => {});
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data }) => {
  if (!data) return Notifications.BackgroundNotificationTaskResult.NoData;
  if ("actionIdentifier" in data) {
    await runBlockPress(data);
    return Notifications.BackgroundNotificationTaskResult.NewData;
  }
  if (Platform.OS === "android" && data.data && typeof data.data === "object") await showWithButtons(data.data);
  return Notifications.BackgroundNotificationTaskResult.NoData;
});

let started = false;

/**
 * At launch, before any screen: Android's background task, and presses handed to the app while it runs or as it
 * starts in the background for one (an iPhone's press that doesn't open the app).
 */
export function startPushButtons() {
  if (started || Platform.OS === "web") return;
  started = true;
  if (Platform.OS === "android") void Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});
  Notifications.addNotificationResponseReceivedListener((response) => {
    if (isBlockPress(response.actionIdentifier)) void runBlockPress(response);
  });
  try {
    const last = Notifications.getLastNotificationResponse();
    if (last && isBlockPress(last.actionIdentifier)) void runBlockPress(last);
  } catch {
    // None.
  }
}
