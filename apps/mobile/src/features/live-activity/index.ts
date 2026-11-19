import type { ApiClient } from "@dougbot/client";
import type { AgenteParaBot } from "@/brand/bots";
import { appPushTarget } from "@/lib/push";
import { liveFace } from "./face";
import { liveActivities } from "./native";

export { startsLiveActivity } from "./logic";

/**
 * A message the person just sent to an agent: when this server follows Live Activities (straight to Apple) and the
 * message started a run, its activity goes on the lock screen with the agent's face; its push token reaches the
 * server through `watchLiveActivities`. Best effort: nothing here ever fails a send.
 */
export async function startLiveActivity(input: {
  api: ApiClient;
  orgId: string;
  messageId: string;
  locale: string;
  agentOf: (agentId: string) => AgenteParaBot | null;
}): Promise<void> {
  if (!liveActivities.available()) return;
  try {
    const { available, start } = await input.api.push.liveActivityStart(input.orgId, input.messageId, input.locale);
    if (!available || !start) return;
    const agent = input.agentOf(start.agentId) ?? {
      name: start.agentName,
      handle: start.agentHandle,
      id: start.agentId,
    };
    const { face, color } = liveFace(agent);
    await liveActivities.start({
      agentName: start.agentName,
      agentColor: color,
      face,
      orgId: input.orgId,
      runId: start.runId,
      state: start.state,
    });
  } catch {
    // No activity: the conversation still shows the work.
  }
}

/**
 * Hands each activity's push token to the server (and a new one when Apple rolls it), and tells it when one ended on
 * the phone. `apiFor` is the API of the workspace's server the activity belongs to. Returns the unsubscribe.
 */
export function watchLiveActivities(apiFor: () => ApiClient, locale: () => string): () => void {
  const tokens = liveActivities.onPushToken((e) => {
    void (async () => {
      const target = await appPushTarget();
      await apiFor()
        .push.registerLiveActivity(e.orgId, {
          runId: e.runId,
          token: e.token,
          locale: locale(),
          ...(target.appId ? { appId: target.appId } : {}),
          ...(target.sandbox ? { sandbox: true } : {}),
        })
        .catch(() => {});
    })();
  });
  const ends = liveActivities.onEnd((e) => {
    if (e.token)
      void apiFor()
        .push.endLiveActivity(e.token)
        .catch(() => {});
  });
  return () => {
    tokens?.remove();
    ends?.remove();
  };
}
