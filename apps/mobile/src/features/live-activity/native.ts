import type { LiveActivityState } from "@agenteschat/client";
import { type EventSubscription, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/**
 * The app's Live Activity module (apps/mobile/modules/live-activity, ActivityKit; docs/adr/doug-0021-lock-screen.md).
 * Absent off iOS and in a build made before it: every call then does nothing.
 */
interface LiveActivityModule {
  available(): boolean;
  start(input: {
    agentName: string;
    agentColor: string;
    face: string | null;
    orgId: string;
    runId: string;
    state: LiveActivityState;
  }): Promise<string | null>;
  end(id: string, state: LiveActivityState, now: boolean): Promise<void>;
  list(): { id: string; runId: string; orgId: string; state: string }[];
  addListener(
    event: "onPushToken",
    listener: (e: { id: string; token: string; runId: string; orgId: string }) => void,
  ): EventSubscription;
  addListener(event: "onEnd", listener: (e: { id: string; token: string; runId: string }) => void): EventSubscription;
}

const native = Platform.OS === "ios" ? requireOptionalNativeModule<LiveActivityModule>("LiveActivity") : null;

export const liveActivities = {
  /** Whether this phone shows them now (the person may turn them off in Ajustes). */
  available(): boolean {
    try {
      return native?.available() ?? false;
    } catch {
      return false;
    }
  },
  start: (input: Parameters<LiveActivityModule["start"]>[0]) => native?.start(input) ?? Promise.resolve(null),
  end: (id: string, state: LiveActivityState, now: boolean) => native?.end(id, state, now) ?? Promise.resolve(),
  list: () => {
    try {
      return native?.list() ?? [];
    } catch {
      return [];
    }
  },
  onPushToken(listener: (e: { id: string; token: string; runId: string; orgId: string }) => void) {
    return native?.addListener("onPushToken", listener) ?? null;
  },
  onEnd(listener: (e: { id: string; token: string; runId: string }) => void) {
    return native?.addListener("onEnd", listener) ?? null;
  },
};
