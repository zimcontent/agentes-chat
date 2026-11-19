import {
  type Memory,
  useApprovalRules,
  useMemory,
  useMemoryAboutMe,
  useMemoryAction,
  useModelLabel,
  useRemoveApprovalRule,
} from "@dougbot/client";
import { approvalRuleServer, approvalRuleWords } from "@dougbot/client/lib/approval-words";
import { seesDetails } from "@dougbot/client/lib/audience";
import { brainLine } from "@dougbot/client/lib/brain";
import { agentGrammar } from "@dougbot/client/lib/grammar";
import { can } from "@dougbot/client/lib/permissions";
import { memoryLine } from "@dougbot/client/lib/proposals";
import { isRightHand, rightHandOf } from "@dougbot/client/lib/right-hand";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg } from "@/providers/org";
import {
  GROUPED_ROW,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  Icon,
  IconButton,
  type IconName,
  ProviderLogo,
  SwipeRow,
  Text,
  useToast,
} from "@/ui";
import { router } from "@/ui/navigation";
import { openChangeAi } from "../ai/ChangeAiSheet";
import { ConnectorIcon } from "../connectors/ConnectorIcon";
import { useConnectedById } from "../settings/hooks";
import { useColors, useDirectory, useErrorToast, useMeId, useOrgId, useWhen } from "../shared/hooks";
import { genderOf } from "../shared/logic";
import { PushedHeader } from "../shared/parts";
import { useAskDoug, useOpenAgentSite } from "./elsewhere";
import { byPlaybook, canEditMemories, knownAboutMe } from "./logic";
import { useMemoryOriginText } from "./useMemoryOriginText";

/**
 * An agent's "Ajustes" on the phone, kept light: what it thinks with (its AI page), what it remembers (tap to correct,
 * swipe to forget), what runs without asking ("Aprovado sempre"), and, for everything else (instructions, budget,
 * brakes, removing it), its page on the website or the right hand asked in words.
 */
export function AgentSettingsScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const meId = useMeId();
  const org = useOrg().org;
  const dir = useDirectory();
  const modelLabel = useModelLabel();
  const openSite = useOpenAgentSite();
  const askDoug = useAskDoug();
  const agent = dir.agentById.get(id);
  const name = agent?.name ?? "";
  // The right hand by its own name ("Pedir ao Doug").
  const dougName = rightHandOf(dir.agents)?.name ?? "Doug";
  const mine = Boolean(meId && agent?.ownerUserId === meId);
  const decides = mine || can(org, "manage_agents");
  const details = seesDetails(agent);
  const thinks =
    agent?.brain && agent.brain.kind !== "model" ? brainLine(t, agent.brain, "", { agents: dir.agents }) : null;
  const aiLabel =
    thinks?.text ?? (agent?.model ? (modelLabel(agent.model) ?? agent.model) : t("mobile.agentLite.aiNone"));
  const aiMark = thinks?.mark ?? agent?.brain?.maker;
  return (
    <View style={[styles.screen, { backgroundColor: c.grouped }]}>
      <PushedHeader title={t("mobile.agentLite.settingsTitle", { name })} solid={false} grouped />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 32 }]}
      >
        {details ? (
          <>
            <GroupedHeader>{t("mobile.agentLite.ai")}</GroupedHeader>
            <GroupedList>
              <GroupedRow
                {...(aiMark ? { leading: <ProviderLogo id={aiMark} size="sm" /> } : { icon: "brain" as const })}
                label={aiLabel}
                {...(decides && agent ? { chevron: true, onPress: () => openChangeAi(agent.id) } : {})}
              />
            </GroupedList>
          </>
        ) : null}
        <Memories agentId={id} name={name} />
        {agent ? <GivenRules agentId={id} name={name} rightHand={isRightHand(agent)} /> : null}
        <AlwaysApproved agentId={id} name={name} mayRemove={mine || can(org, "approve_actions")} />
        <GroupedHeader>{t("mobile.agentLite.more")}</GroupedHeader>
        <GroupedList>
          <GroupedRow icon="globe" label={t("mobile.agentLite.onSite")} chevron onPress={() => openSite(id)} />
          <GroupedRow
            icon="chat"
            label={t("mobile.agentLite.askDoug", { name: dougName })}
            chevron
            onPress={() => askDoug(t("mobile.agentLite.askDougAbout", { name }))}
          />
        </GroupedList>
        <GroupedFooter>{t("mobile.agentLite.moreHelp", { name: dougName })}</GroupedFooter>
      </ScrollView>
    </View>
  );
}

/** What it knows about the viewer and how it works: a tap corrects, a swipe forgets (for its owner and admins). */
function Memories({ agentId, name }: { agentId: string; name: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const orgId = useOrgId();
  const meId = useMeId();
  const org = useOrg().org;
  const toast = useToast();
  const failed = useErrorToast();
  const dir = useDirectory();
  const agent = dir.agentById.get(agentId);
  const knows = useMemoryAboutMe(orgId, agentId);
  const memoryAct = useMemoryAction(orgId, agentId);
  const originText = useMemoryOriginText();
  const g = genderOf(name);
  const owner = agent?.ownerUserId ? dir.memberById.get(agent.ownerUserId)?.name : undefined;
  const editable = canEditMemories(agent, { id: meId, org });
  if (!knows.data) return null;
  const learned = byPlaybook(knownAboutMe(knows.data));
  const forgetAsk = (m: Memory) =>
    Alert.alert(
      t("mobile.intentAgents.knows.forgetTitle"),
      t("mobile.intentAgents.knows.forgetBody", agentGrammar(name)),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("mobile.intentAgents.knows.forget"),
          style: "destructive",
          onPress: () =>
            memoryAct.mutate(
              { type: "archive", id: m.id, archived: true },
              {
                onSuccess: () => toast({ title: t("mobile.intentAgents.fix.forgotten"), agentId }),
                onError: failed,
              },
            ),
        },
      ],
    );
  const memoryRow = (m: Memory) => {
    const row = (
      <GroupedRow
        icon="brain"
        label={m.summary ?? memoryLine(t, m)}
        labelLines={2}
        sub={originText(m)}
        // The same screen Memória opens for it (one place to read, fix or forget a memory).
        chevron
        onPress={() => router.push(`/memory/${m.id}`)}
      />
    );
    if (!editable) return <Fragment key={m.id}>{row}</Fragment>;
    return (
      <SwipeRow
        key={m.id}
        right={{
          label: t("mobile.intentAgents.knows.forget"),
          icon: "trash",
          color: c.danger,
          ink: c.bg,
          onAction: () => forgetAsk(m),
        }}
      >
        {/* The swipe's pane shows under the row, so the row is opaque, in the list's own white. */}
        <View style={{ backgroundColor: c.raised }}>{row}</View>
      </SwipeRow>
    );
  };
  // Who may correct what it knows, said once under the memories (a tap corrects, a swipe forgets).
  const editFoot = editable
    ? t("mobile.intentAgents.knows.footSwipe")
    : owner
      ? t("mobile.intentAgents.knows.footOwner", { name: owner })
      : t("mobile.intentAgents.knows.footAdmins");
  return (
    <>
      <GroupedHeader>{t("mobile.intentAgents.knows.title", agentGrammar(name))}</GroupedHeader>
      <GroupedList>{learned.people.map(memoryRow)}</GroupedList>
      <GroupedFooter>
        {learned.people.length > 0 ? editFoot : t(`mobile.intentAgents.knows.empty${g}`, { name })}
      </GroupedFooter>
      {learned.playbook.length > 0 ? (
        <>
          <GroupedHeader
            hint={{
              name: t("common.about", { label: t("agentPage.memory.playbook", agentGrammar(name)) }),
              text: t("agentPage.memory.playbookNote"),
            }}
          >
            {t("agentPage.memory.playbook", agentGrammar(name))}
          </GroupedHeader>
          <GroupedList>{learned.playbook.map(memoryRow)}</GroupedList>
          {learned.people.length === 0 ? <GroupedFooter>{editFoot}</GroupedFooter> : null}
        </>
      ) : null}
    </>
  );
}

/**
 * "Aprovado sempre", as on the web's Ferramentas e acesso: what the agent runs without asking, approved for good
 * from a request, by whom and when. Its owner and whoever decides approvals take one back with its ×, at once.
 * Shown only when there is something.
 */
export function AlwaysApproved({ agentId, name, mayRemove }: { agentId: string; name: string; mayRemove: boolean }) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const toast = useToast();
  const failed = useErrorToast();
  const when = useWhen();
  const dir = useDirectory();
  const connected = useConnectedById();
  const rules = useApprovalRules(orgId, agentId);
  const remove = useRemoveApprovalRule(orgId, agentId);
  const list = rules.data ?? [];
  if (list.length === 0) return null;
  return (
    <>
      <GroupedHeader>{t("agentPage.access.always.title")}</GroupedHeader>
      <GroupedList>
        {list.map((rule) => {
          const what = approvalRuleWords(t, rule);
          const who = rule.createdByUserId ? dir.memberById.get(rule.createdByUserId)?.name : undefined;
          const at = when.short(rule.createdAt);
          return (
            <ButtonRow
              key={rule.id}
              leading={
                <ConnectorIcon
                  def={(rule.connectionId && connected.get(rule.connectionId)?.def) || null}
                  image={rule.connectionId ? connected.get(rule.connectionId)?.image : null}
                  label={approvalRuleServer(t, rule)}
                  size={30}
                />
              }
              label={what}
              labelLines={2}
              sub={
                who
                  ? t("agentPage.access.always.by", { name: who, when: at })
                  : t("agentPage.access.always.byNobody", { when: at })
              }
              trailing={
                mayRemove ? (
                  <IconButton
                    icon="x"
                    label={t("agentPage.access.always.remove", { what })}
                    disabled={remove.isPending}
                    onPress={() =>
                      remove.mutate(rule.id, {
                        onSuccess: () => toast({ title: t("agentPage.access.always.removed", { name }), agentId }),
                        onError: failed,
                      })
                    }
                  />
                ) : undefined
              }
            />
          );
        })}
      </GroupedList>
      <GroupedFooter>{t("agentPage.access.always.help")}</GroupedFooter>
    </>
  );
}

/**
 * A row of a grouped list that holds its own button (a rule's ×, a mailbox's Remove access), drawn as `GroupedRow`
 * draws its rows. A plain view, not a pressable one: a pressable row would fold the button into itself for
 * VoiceOver. `GroupedList` reads `icon` and `leading` for where its hairline starts.
 */
function ButtonRow({
  icon,
  leading,
  label,
  labelLines = 1,
  sub,
  value,
  trailing,
  below,
}: {
  icon?: IconName;
  leading?: ReactNode;
  label: string;
  labelLines?: number;
  sub?: string | null;
  value?: string;
  trailing?: ReactNode;
  below?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={styles.row}>
      {icon ? (
        <View style={styles.lead}>
          <View style={[styles.tile, { backgroundColor: c.sunken }]}>
            <Icon name={icon} size={16} color={c.ink2} />
          </View>
        </View>
      ) : null}
      {leading ? <View style={styles.lead}>{leading}</View> : null}
      <View style={styles.grow}>
        <View accessible accessibilityLabel={[label, sub].filter(Boolean).join(", ")}>
          <Text variant="body" numberOfLines={labelLines}>
            {label}
          </Text>
          {sub ? (
            <Text variant="footnote" tone="faint" numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
        </View>
        {below}
      </View>
      {value ? (
        <Text variant="callout" tone="faint" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
    </View>
  );
}

/**
 * "Regras que as pessoas deram", as on the web's Memória: what people told it to always do, by whom and when. Its
 * giver, the agent's owner and admins take one back with a swipe, confirmed by a system alert (never a bare × that
 * deletes on the tap). Shown only when there is something.
 */
function GivenRules({ agentId, name, rightHand }: { agentId: string; name: string; rightHand: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const orgId = useOrgId();
  const toast = useToast();
  const failed = useErrorToast();
  const when = useWhen();
  const memory = useMemory(orgId, agentId);
  const remove = useMemoryAction(orgId, agentId);
  const list = (memory.data ?? []).filter((m) => m.kind === "rule" && !m.archived);
  if (list.length === 0) return null;
  const ask = (m: Memory) =>
    Alert.alert(t("mobile.intentAgents.knows.ruleTitle"), t("mobile.intentAgents.knows.ruleBody", agentGrammar(name)), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.intentAgents.knows.ruleRemove"),
        style: "destructive",
        onPress: () =>
          remove.mutate(
            { type: "archive", id: m.id, archived: true },
            {
              onSuccess: () => toast({ title: t("agentPage.memory.ruleRemoved"), agentId }),
              onError: failed,
            },
          ),
      },
    ]);
  return (
    <>
      <GroupedHeader
        hint={{
          name: t("common.about", { label: t("agentPage.memory.rules") }),
          text: t(rightHand ? "agentPage.memory.rulesNoteRightHand" : "agentPage.memory.rulesNote"),
        }}
      >
        {t("agentPage.memory.rules")}
      </GroupedHeader>
      <GroupedList>
        {list.map((m) => {
          const row = (
            <GroupedRow
              icon="flag"
              label={m.text}
              labelLines={3}
              sub={t("agentPage.memory.ruleBy", {
                name: m.origin?.name ?? t("memory.origin.someone"),
                date: when.short(m.origin?.at ?? m.updatedAt),
              })}
            />
          );
          if (!m.removable) return <Fragment key={m.id}>{row}</Fragment>;
          return (
            <SwipeRow
              key={m.id}
              right={{
                label: t("mobile.intentAgents.knows.ruleRemove"),
                icon: "trash",
                color: c.danger,
                ink: c.bg,
                onAction: () => ask(m),
              }}
            >
              <View style={{ backgroundColor: c.raised }}>{row}</View>
            </SwipeRow>
          );
        })}
      </GroupedList>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingHorizontal: 16 },
  grow: { flex: 1, minWidth: 0 },
  // As `GroupedRow`'s own row, tile and value.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: GROUPED_ROW.minHeight,
    paddingHorizontal: GROUPED_ROW.padX,
    paddingVertical: GROUPED_ROW.padY,
  },
  // One leading column for a tile or a mark, as `GroupedRow`'s (36, a framed face's width): the text starts at 62 in
  // every row, these included.
  lead: { width: 36, alignItems: "center", justifyContent: "center" },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  value: { flexShrink: 1, maxWidth: "50%" },
});
