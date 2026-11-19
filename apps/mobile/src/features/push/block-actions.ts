import type { PushData } from "@/lib/push-payload";

/**
 * A live block's buttons on a notification (docs/adr/doug-0021-lock-screen.md), the pure part: the server sends the
 * block's first buttons (ids `block:<key>`) and "Abrir" (`open`) under a category named for their words
 * (`doug.block.<hash>`); the iPhone's notification service extension registers it as the push arrives, Android's
 * background task here. A press of a block button runs it on the server (`POST …/blocks/{id}/press`).
 */
export const BLOCK_ACTION_PREFIX = "block:";
export const OPEN_ACTION = "open";
export const BLOCK_CATEGORY_PREFIX = "doug.block.";

/** One button as the push brings it. */
export interface PushAction {
  id: string;
  title: string;
  /** Runs without opening the app; otherwise the press opens it. */
  background?: boolean;
}

const ID = /^[A-Za-z0-9._:-]{1,80}$/;

/** The buttons a push brings (a JSON string on Android, a list on iOS), checked: anything else is none. */
export function readPushActions(raw: unknown): PushAction[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 4).flatMap((a): PushAction[] => {
    if (!a || typeof a !== "object") return [];
    const { id, title, background } = a as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id) || typeof title !== "string" || !title.trim()) return [];
    return [{ id, title: title.trim().slice(0, 40), ...(background === true ? { background: true } : {}) }];
  });
}

/** Whether a category is one of a block's (only those are registered from a push). */
export const isBlockCategory = (category: unknown): category is string =>
  typeof category === "string" && category.startsWith(BLOCK_CATEGORY_PREFIX) && category.length <= 64;

/** The buttons as expo-notifications registers them: one that answers alone asks for the phone unlocked first. */
export function categoryActions(actions: readonly PushAction[]) {
  return actions.map((a) => ({
    identifier: a.id,
    buttonTitle: a.title,
    options: { opensAppToForeground: !a.background, isAuthenticationRequired: a.background === true },
  }));
}

/** Whether these buttons are already registered as they are. */
export function sameButtons(
  registered: readonly { identifier: string; buttonTitle: string }[] | undefined,
  actions: readonly PushAction[],
): boolean {
  return (
    registered !== undefined &&
    registered.length === actions.length &&
    registered.every((r, i) => r.identifier === actions[i]?.id && r.buttonTitle === actions[i]?.title)
  );
}

/** What a press of a block's button names: the workspace, the block, its version and the button. Null: not one. */
export function blockPressOf(data: PushData, actionId: string) {
  if (!actionId.startsWith(BLOCK_ACTION_PREFIX)) return null;
  const key = actionId.slice(BLOCK_ACTION_PREFIX.length);
  const version = Number(data.blockVersion);
  if (!key || !data.orgId || !data.blockId || !Number.isInteger(version) || version < 1) return null;
  return { orgId: data.orgId, blockId: data.blockId, version, key };
}

/** The press's own id, so one handed over twice (the listener and a later launch) sends once. */
export const pressClientId = (notificationId: string, key: string) => `p:${notificationId}:${key}`.slice(0, 64);
