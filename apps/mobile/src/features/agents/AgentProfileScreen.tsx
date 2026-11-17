import {
  useAgentAccess,
  useAgentDetail,
  useAgentForYou,
  useAiStatus,
  useApi,
  useLiveVoice,
  useTeam,
  useUsage,
} from "@agenteschat/client";
import { listsAgent, seesDetails } from "@agenteschat/client/lib/audience";
import { formatPercent, lowerFirst } from "@agenteschat/client/lib/format";
import { agentGrammar } from "@agenteschat/client/lib/grammar";
import { agentPlan, aiStateOf } from "@agenteschat/client/lib/no-ai";
import { planMeterText, usageShown } from "@agenteschat/client/lib/plan-usage";
import { isRightHand, rightHandOf } from "@agenteschat/client/lib/right-hand";
import { supervisorOf } from "@agenteschat/client/lib/team-views";
import { planLine } from "@agenteschat/ui/plan-state";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg } from "@/providers/org";
import { Button, EmptyState, IconButton, Text } from "@/ui";
import { router } from "@/ui/navigation";
import { openConnectAi } from "../ai/NoAiCard";
import { usePlanHold } from "../ai/parts";
import { useCalls } from "../call/CallProvider";
import { LetMeTalkButton } from "../chat/ReachLines";
import { useOpenDm } from "../new/useOpenDm";
import { openRightHandSettings } from "../right-hand/SettingsScreen";
import { useColors, useDirectory, useErrorToast, useNow, useOrgId, useWhen } from "../shared/hooks";
import { agentLook, genderOf } from "../shared/logic";
import { showActionSheet } from "../shared/PickerSheet";
import { PushedHeader } from "../shared/parts";
import { useWorkingNow } from "../shared/queries";
import { useAgentProfileStatus } from "../status/hooks";
import { agentTasksHref } from "../task-manager/logic";
import { openAgentUsage } from "../usage/UsageScreen";
import { openAgentSettings, useAskDoug, useOpenAgentSite } from "./elsewhere";
import { monthShare, todayRows } from "./lite";
import { canUse, didLines, plainRole, spendOf } from "./logic";
import { type ProfileToday, ProfileView } from "./ProfileView";
import { workTitle } from "./work";

/**
 * An agent's profile on the phone, kept light (the full setup is the website's, or the right hand's in words): its
 * face, name, what it does and what it is on now, Ligar / Tarefas / Ajustes, what it can use, its month and who it
 * answers to (read only), its day, and Conversar. Someone it doesn't answer sees what it is on and can ask for access.
 */
export function AgentProfileScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const agent = useDirectory().anyAgent(id);
  // No longer in the team (archived or deleted): its messages name it, it has no profile.
  if (agent?.former) {
    return (
      <View style={[styles.screen, { backgroundColor: c.bg }]}>
        <PushedHeader title={agent.name} solid={false} />
        <EmptyState icon="agent" title={t("profile.former")} />
      </View>
    );
  }
  return <Profile id={id} />;
}

function Profile({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const api = useApi();
  const dir = useDirectory();
  const org = useOrg().org;
  const now = useNow();
  const when = useWhen();
  const failed = useErrorToast();
  const openDm = useOpenDm();
  const openSite = useOpenAgentSite();
  const askDoug = useAskDoug();
  const calls = useCalls();
  const voice = useLiveVoice(orgId);
  const insets = useSafeAreaInsets();
  const agent = dir.agentById.get(id);
  // Someone it doesn't answer (not its owner, not an admin) sees only its public card: no tools or month.
  const details = seesDetails(agent);
  const rightHand = isRightHand(agent);
  const dougName = rightHandOf(dir.agents)?.name ?? "Doug";
  const detail = useAgentDetail(orgId, id);
  const access = useAgentAccess(orgId, id, details);
  const usage = useUsage(orgId);
  const forYou = useAgentForYou(orgId, id);
  const team = useTeam(orgId).data?.agents ?? [];
  const work = useWorkingNow().filter((w) => w.agentId === id);
  const status = useAgentProfileStatus(id, agent?.name ?? "");
  const held = usePlanHold(orgId, org) !== null;
  const aiStatus = useAiStatus(orgId).data;
  const noAi = !held && aiStateOf(aiStatus, id) === "no_ai";

  const look = agentLook(agent);
  const name = agent?.name ?? detail.data?.name ?? "";
  const ownerId = agent?.ownerUserId ?? null;
  const roleName = (agent?.role || detail.data?.role || "").trim();
  const plain = plainRole(agent?.instructions || detail.data?.instructions);
  // The right hand's one role name, as its row in Conversas and its conversation's header say it.
  const role = rightHand
    ? t("rightHand.labelCapitalized")
    : [roleName || null, plain ? (roleName ? lowerFirst(plain, i18n.language) : plain) : null]
        .filter(Boolean)
        .join(" · ") || null;

  // "Este mês": on a plan its busiest window, else the budget (ADR 0063 §5); the usage page has the rest.
  const shown = usageShown(agent?.brain, detail.data?.budgetUsedPercent ?? 0);
  const planNow = shown.plan ? planLine(shown.plan.usage, planMeterText(t, i18n.language), now) : null;
  const spend =
    detail.data && shown.budget
      ? spendOf({
          budgetUsedPercent: detail.data.budgetUsedPercent,
          monthlyBudgetUsd: detail.data.monthlyBudgetUsd ?? null,
          ...(detail.data.defaultBudgetUsd !== undefined ? { defaultBudgetUsd: detail.data.defaultBudgetUsd } : {}),
          usage: usage.data?.find((u) => u.agentId === id) ?? null,
        })
      : null;
  const share = monthShare({ planUsed: planNow?.top?.used ?? null, spend });

  const teamAgent = team.find((a) => a.id === id);
  const boss = teamAgent ? supervisorOf(teamAgent, team) : null;
  const bossAgent = boss ? dir.agentById.get(boss.id) : undefined;

  const did = didLines(forYou.data?.items);
  const openDid = (href: (typeof did)[number]["href"]) => {
    if (!href) return;
    if (href.kind === "issue") router.push(`/issues/${href.number}`);
    else if (href.kind === "chat")
      router.push({
        pathname: "/chat/[channelId]",
        params: { channelId: href.channelId, ...(href.threadId ? { thread: href.threadId } : {}) },
      });
    else if (href.kind === "file") router.push({ pathname: "/file/[id]", params: { id: href.id } });
    else router.push(`/approval/${href.id}`);
  };
  const today: ProfileToday[] = todayRows(work, did, now).map((r) =>
    r.kind === "work"
      ? {
          key: r.key,
          icon: "clock",
          title: workTitle(t, r.work),
          sub: t("mobile.agentLite.inProgress"),
          onPress: () =>
            r.work.missionId
              ? router.push(`/mission/${r.work.missionId}`)
              : router.push({
                  pathname: "/chat/[channelId]",
                  params: { channelId: r.work.channelId, ...(r.work.threadId ? { thread: r.work.threadId } : {}) },
                }),
        }
      : {
          key: r.key,
          icon: r.did.waiting ? "wait" : r.did.icon === "x" ? "x" : "checkc",
          title: t(`mobile.intentAgents.did.${r.did.title.key}`, r.did.title.values),
          sub: r.did.waiting
            ? t("mobile.agentLite.waitsYou")
            : t("mobile.agentLite.doneAt", { time: when.time(r.did.at) }),
          waiting: r.did.waiting,
          ...(r.did.href ? { onPress: () => openDid(r.did.href) } : {}),
        },
  );

  // Ligar: the call in its conversation (the conversation's own phone, `CallButton`), once live voice is on.
  const call = () => {
    if (!calls) return;
    if (voice.data?.state !== "ok") {
      Alert.alert(t("liveVoice.call.needsKeyTitle", { name }), t("liveVoice.call.keyWhere"));
      return;
    }
    void api.dms
      .open(orgId, { agentId: id })
      .then(({ channelId }) => calls.callAgent(id, channelId, name))
      .catch(failed);
  };

  const presence = status?.presence;
  // The face under the bar, where the cover's art sat: the bar's 44 and 12 more.
  const top = insets.top + 56;
  const talkable = details || !ownerId;
  return (
    <>
      <PushedHeader
        plate
        solid={false}
        {...(details && !rightHand
          ? {
              right: (
                <IconButton
                  icon="more"
                  label={t("mobile.agentLite.menu")}
                  onPress={() =>
                    showActionSheet(name, [
                      { label: t("mobile.agentLite.onSite"), onPress: () => openSite(id) },
                      {
                        label: t("mobile.agentLite.askDoug", { name: dougName }),
                        onPress: () => askDoug(t("mobile.agentLite.askDougAbout", { name })),
                      },
                    ])
                  }
                />
              ),
            }
          : {})}
      />
      <ProfileView
        face={{ look, mode: work.length > 0 ? "run" : "idle" }}
        top={top}
        name={name}
        what={role}
        state={
          status
            ? {
                text: status.line,
                tone: presence === "working" ? "working" : presence === "waiting" ? "waiting" : "idle",
              }
            : null
        }
        actions={[
          {
            key: "call",
            icon: "handset",
            label: t("mobile.agentLite.call"),
            onPress: call,
            disabled: !calls || !talkable || agent?.canTalk === false,
          },
          {
            key: "tasks",
            icon: "checkc",
            label: t("mobile.agentLite.tasks"),
            onPress: () => router.push(agentTasksHref(id, null)),
          },
          {
            key: "settings",
            icon: "sun",
            label: t("mobile.agentLite.settings"),
            onPress: () => (rightHand ? openRightHandSettings() : openAgentSettings(id)),
          },
        ]}
        uses={details && access.data ? canUse(access.data).map((u) => u.label) : null}
        month={
          details && share !== null
            ? { percent: share, text: formatPercent(i18n.language, share), onPress: () => openAgentUsage(id) }
            : null
        }
        reportsTo={
          rightHand || !teamAgent
            ? null
            : boss
              ? { look: bossAgent ? agentLook(bossAgent) : look, name: boss.name }
              : { none: t("team.reportsTo.none") }
        }
        today={today}
        todayEmpty={t(`mobile.agentLite.todayEmpty${genderOf(name)}`, { name })}
        talk={
          talkable
            ? {
                label: t("mobile.agentLite.talk"),
                disabled: !listsAgent(org, agent),
                onPress: () => void openDm({ agentId: id }),
              }
            : ownerId
              ? { label: t("profile.askAccess"), onPress: () => void openDm({ userId: ownerId }) }
              : null
        }
        note={
          <>
            {noAi ? (
              <View style={styles.note}>
                <Button
                  variant="secondary"
                  wide
                  label={t("noAi.agent", agentGrammar(name))}
                  onPress={() => openConnectAi({ agentId: id, plan: agentPlan(agent) ?? undefined })}
                />
              </View>
            ) : null}
            {agent?.canTalk === false ? (
              <Text variant="small" tone="muted" style={styles.noteText}>
                {details ? t("mobile.agent.cantTalk") : t("profile.detailsHidden", agentGrammar(name))}
              </Text>
            ) : null}
            {agent ? <LetMeTalkButton agent={agent} /> : null}
          </>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  note: { alignSelf: "stretch", marginTop: 12 },
  noteText: { textAlign: "center", marginTop: 12 },
});
