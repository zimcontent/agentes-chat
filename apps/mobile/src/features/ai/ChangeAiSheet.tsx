import type { Agent, AgentBrain, AiAccounts } from "@dougbot/client";
import { keys, useAgentBrain, useAiAccounts, useApi, useCredentials, useModels, usePlatformKey } from "@dougbot/client";
import {
  accountCardTitle,
  agentModelChip,
  agentNow,
  autoOption,
  type Intent,
  type IntentOption,
  intentChoices,
  intentOptions,
  placesFor,
  pricesInReais,
  samePick,
  standInFor,
  standInOrderWith,
  standingOf,
} from "@dougbot/client/lib/ai-panel";
import { mayPickModel, modelPickerSave, modelPickerUndo, type PickerBefore } from "@dougbot/client/lib/brain-picker";
import { contextSize } from "@dougbot/client/lib/context-limits";
import { agentGrammar } from "@dougbot/client/lib/grammar";
import { can } from "@dougbot/client/lib/permissions";
import { modelChoices, providerLabel } from "@dougbot/client/lib/providers";
import { isRightHand } from "@dougbot/client/lib/right-hand";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { DB_FONTES } from "@/brand/tokens";
import { useOrg } from "@/providers/org";
import { Button, Icon, type IconName, PressScale, ProviderLogo, SheetScreen, Text, useTheme, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { openRightHandSettings } from "../right-hand/SettingsScreen";
import { chooseAction } from "../settings/parts";
import { AgentFace } from "../shared/Face";
import { useDirectory, useMeId } from "../shared/hooks";
import { errorHaptic, successHaptic } from "../shared/parts";
import { openAgentAdvanced } from "./AgentAdvancedScreen";
import { openAgentAi, openAgentModel } from "./AgentAiScreen";
import { openConnectAi } from "./NoAiCard";
import { Note } from "./parts";

/*
 * "Trocar a IA da ROSA", a native form sheet over the Painel de IA, the agent's page and the chat's "Trocar modelo".
 * First "Agora", how it thinks now, one row per fact (the account by its plan and login, the model, the effort, the
 * context; `agentNow`), each opening the screen that changes it. Then the choices: Automático (the model and effort
 * picked per task, on the same account or key, `autoOption`) and three by intent (the rule is `intentChoices`,
 * packages/client/src/lib/ai-panel.ts), each with its model, what changes, what it costs and, when it moves the agent,
 * the account it moves to; the account it runs on, which follows the choice and can be changed; the account that takes
 * over when the quota runs out (the person's stand-in order, ADR doug-0003); then "Trocar para …". Nothing changes
 * before that tap, and the toast after it undoes it.
 */

/** Opens the sheet for an agent. */
export const openChangeAi = (agentId: string) => router.push(`/agent-switch/${agentId}` as never);

/** A chosen card's padding inside its 2 pt edge: the content stays where an unchosen card's is. */
const CHOSEN_PAD = { paddingVertical: 10, paddingHorizontal: 12 } as const;

/** A choice of the sheet: Automático, or one of the three intents. */
type Choice = Intent | "auto";

const CHOICE_ICON: Record<Choice, IconName> = { auto: "sparkle", smart: "brain", balanced: "swap", fast: "bolt" };

type Account = AiAccounts["accounts"][number];

/** What a choice puts the agent on: an intent's option, or Automático (no size, no price of its own). */
type Shown = Pick<IntentOption, "tile" | "account" | "model" | "label" | "prices" | "current">;

export function ChangeAiSheet({
  agentId,
  onClose,
  initialIntent,
}: {
  agentId: string;
  onClose: () => void;
  /** The board shows a choice made: the prototype's state. */
  initialIntent?: Intent;
}) {
  const { t } = useTranslation();
  const { orgId, org } = useOrg();
  const dir = useDirectory();
  const meId = useMeId();
  const agent = dir.agentById.get(agentId);
  const may = mayPickModel(agent, meId, can(org, "manage_agents"));
  const brain = useAgentBrain(orgId, agentId, may);
  const g = agentGrammar(agent?.name ?? "");

  let body: React.ReactNode;
  if (!agent) body = dir.loading ? <ActivityIndicator /> : <Note icon="x">{t("common.loadFailed")}</Note>;
  else if (isRightHand(agent))
    body = (
      <>
        <Text variant="body" tone="muted">
          {t("mobile.aiPanel.sheet.rightHand", g)}
        </Text>
        <Button
          variant="secondary"
          wide
          label={t("mobile.aiPanel.sheet.openSettings")}
          onPress={() => {
            onClose();
            openRightHandSettings();
          }}
        />
      </>
    );
  else if (!may) body = <Note icon="lock">{t("brain.picker.readOnly")}</Note>;
  else if (brain.isPending) body = <ActivityIndicator style={styles.loading} />;
  else if (!brain.data) body = <Note icon="x">{t("common.loadFailed")}</Note>;
  else
    body = <Choices agent={agent} view={brain.data} onClose={onClose} {...(initialIntent ? { initialIntent } : {})} />;

  return (
    <SheetScreen>
      <View style={styles.sides}>
        <View style={styles.head}>
          <AgentFace agentId={agentId} size={40} live={false} />
          <View style={styles.grow}>
            <Text variant="title" tone="ink" style={styles.title}>
              {t("mobile.aiPanel.sheet.title", g)}
            </Text>
            {agent?.role ? (
              <Text variant="footnote" tone="muted" numberOfLines={1}>
                {agent.role}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.body}>{body}</View>
      </View>
    </SheetScreen>
  );
}

function Choices({
  agent,
  view,
  onClose,
  initialIntent,
}: {
  agent: Agent;
  view: AgentBrain;
  onClose: () => void;
  initialIntent?: Intent;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { orgId, org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const models = useModels().data?.models ?? [];
  const credentials = useCredentials(orgId, can(org, "manage_credentials"));
  const platform = usePlatformKey(orgId);
  const mine = useAiAccounts(orgId, view.canUsePlans).data?.accounts ?? [];
  const api_ = modelChoices(models, credentials.data ?? view.keys ?? [], platform.data ?? false);
  const options = intentOptions(t, i18n.language, view, agent.ownerUserId, api_, agent.model, models);
  const picks = intentChoices(view, options);
  const auto = autoOption(t, i18n.language, view, agent.ownerUserId, api_, agent.model, models);
  const now = agentNow(view, agent.model, models);
  const currentChoice: Choice | undefined = auto?.current ? "auto" : picks.find((p) => p.option.current)?.intent;
  // The current choice comes marked; on a model none of them is, the balanced one, ready to switch to.
  const [choice, setChoice] = useState<Choice | undefined>(
    initialIntent ?? currentChoice ?? picks.find((p) => p.intent === "balanced")?.intent ?? picks[0]?.intent,
  );
  // A place chosen by hand for an intent ("Roda na conta"); else the rule's.
  const [moved, setMoved] = useState<Partial<Record<Intent, IntentOption>>>({});
  const [busy, setBusy] = useState(false);
  const g = agentGrammar(agent.name);

  /** Leaves the sheet for the screen that changes one fact. */
  const go = (open: () => void) => () => {
    onClose();
    open();
  };

  if (picks.length === 0 && !auto)
    return (
      <>
        <Text variant="body" tone="muted">
          {t("mobile.aiPanel.sheet.none")}
        </Text>
        <Button
          variant="secondary"
          wide
          label={t("brain.picker.connect")}
          onPress={go(() => openConnectAi({ agentId: agent.id }))}
        />
      </>
    );

  const autoShown: Shown | undefined = auto ? { ...auto, label: t("brain.auto.label"), prices: null } : undefined;
  const intentOf = (c: Choice | undefined): Intent | undefined => (c && c !== "auto" ? c : undefined);
  const shownOf = (c: Choice): Shown | undefined =>
    c === "auto" ? autoShown : (moved[c] ?? picks.find((p) => p.intent === c)?.option);
  const chosen = choice ? shownOf(choice) : undefined;
  const chosenIntent = intentOf(choice);
  const chosenOption = chosenIntent
    ? (moved[chosenIntent] ?? picks.find((p) => p.intent === chosenIntent)?.option)
    : undefined;
  const changes = chosen !== undefined && !chosen.current;
  const accountOf = (o: Shown) => view.accounts.find((a) => a.id === o.account?.id);
  const choices: Choice[] = [...(auto ? (["auto"] as const) : []), ...picks.map((p) => p.intent)];

  // Where a choice runs, in the words of the account's card ("Claude Max", "Claude Max de Ana"), and its login.
  const placeName = (o: Shown) => {
    if (o.tile.kind === "model") return o.tile.name;
    const a = accountOf(o);
    if (!a) return t("brain.picker.ownSignIn");
    const owner = a.mine ? undefined : a.ownerName?.split(" ")[0];
    return owner ? t("mobile.aiPanel.sheet.accountOf", { account: accountCardTitle(a), owner }) : accountCardTitle(a);
  };
  const loginOf = (o: Shown) => accountOf(o)?.email ?? null;
  const placeMark = (o: Shown) => o.account?.provider ?? o.tile.mark;
  // A choice that moves the agent to another account or key says where.
  const samePlace = (o: Shown) =>
    o.tile.kind === "model"
      ? view.brain === "model" && (o === autoShown || o.tile.provider === now.keyProvider)
      : view.brain === o.tile.kind && (o.account?.id ?? null) === view.account;
  const pickPlace = () => {
    if (!chosenIntent || !chosenOption) return;
    const others = placesFor(options, chosenOption, chosenIntent).filter((o) => !samePick(o, chosenOption));
    if (others.length === 0) return;
    chooseAction(
      t("mobile.aiPanel.sheet.runsOn"),
      others.map((o) => {
        const login = loginOf(o);
        return {
          label: `${placeName(o)}${login ? ` (${login})` : ""} · ${o.label}`,
          onPress: () => setMoved((m) => ({ ...m, [chosenIntent]: o })),
        };
      }),
      t("common.cancel"),
    );
  };

  // "Se a cota acabar, usar": the person's own order, on the agent's computer, for a plan they own the agent of.
  const machineId = view.computer?.machineId;
  const here = mine.filter((a) => a.machineId === machineId);
  const onPlan = chosen !== undefined && chosen.tile.kind !== "model" && view.canUsePlans;
  const standIn = onPlan ? standInFor(here, chosen.account?.id ?? null) : null;
  const standInState = standIn?.usage ? standingOf(standIn) : "ok";
  const pickStandIn = () => {
    const others = here.filter((a) => a.status === "active" && a.id !== chosen?.account?.id && a.id !== standIn?.id);
    if (others.length === 0) return;
    chooseAction(
      `${t("mobile.aiPanel.sheet.standIn")}. ${t("mobile.aiPanel.sheet.standInAll")}`,
      others.map((a: Account) => ({
        label: a.email ? `${accountCardTitle(a)} (${a.email})` : accountCardTitle(a),
        onPress: () =>
          void api.machines.setStandInOrder(orgId, standInOrderWith(mine, a.id)).then(
            () => {
              successHaptic();
              toast({ title: t("usageViews.standIn.saved"), icon: "check" });
              void qc.invalidateQueries({ queryKey: keys.aiAccounts(orgId) });
            },
            () => {
              errorHaptic();
              toast({ title: t("agentPage.work.failed"), icon: "x" });
            },
          ),
      })),
      t("common.cancel"),
    );
  };

  const refresh = () => {
    for (const key of [
      keys.agentBrain(orgId, agent.id),
      keys.agents(orgId),
      keys.aiStatus(orgId),
      keys.aiAccounts(orgId),
    ])
      void qc.invalidateQueries({ queryKey: key });
  };
  const apply = async (input: ReturnType<typeof modelPickerSave>) => {
    if (input.brain) await api.agents.setBrain(orgId, agent.id, input.brain);
    if (input.model !== undefined) await api.agents.update(orgId, agent.id, { model: input.model });
  };
  const save = async () => {
    if (!chosen || !changes || busy) return;
    const before: PickerBefore = {
      brain: view.brain,
      account: view.account,
      model: view.model,
      effort: view.effort,
      apiModel: agent.model,
    };
    const saving = modelPickerSave(view, chosen.tile, chosen.account, chosen.model.value);
    setBusy(true);
    try {
      await apply(saving);
      successHaptic();
      onClose();
      toast({
        title: t("brain.picker.saved", { agent: agent.name, model: chosen.label }),
        icon: "check",
        action: {
          label: t("brain.picker.undo"),
          onPress: () => void apply(modelPickerUndo(before, saving)).finally(refresh),
        },
      });
    } catch {
      errorHaptic();
      toast({ title: t("agentPage.work.failed"), icon: "x" });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const costLine = (o: Shown) =>
    o.prices
      ? t("mobile.aiPanel.sheet.price", pricesInReais(o.prices, i18n.language))
      : o.tile.kind === "model"
        ? null
        : t("mobile.aiPanel.sheet.inPlan");
  const lineOf = (c: Choice, o: Shown) =>
    c === "auto"
      ? t("mobile.aiPanel.sheet.autoLine")
      : c === "smart"
        ? t(o.prices ? "mobile.aiPanel.sheet.smartKey" : "mobile.aiPanel.sheet.smartPlan")
        : t(`mobile.aiPanel.sheet.${c}Line`);
  const choiceName = (c: Choice) => (c === "auto" ? t("brain.auto.label") : t(`mobile.aiPanel.sheet.${c}`));

  // "Agora": the account (its plan, its login), the model, the effort and the context, each opening its screen.
  const plan = view.brain !== "model";
  const accountValue = now.account
    ? now.account.title
    : now.ownSignIn
      ? t("brain.picker.ownSignIn")
      : now.keyProvider
        ? t("brain.picker.apiKey", { provider: providerLabel(now.keyProvider) })
        : t("agentPage.work.brain.model");
  const accountSub = now.account
    ? (now.account.login ??
      (now.account.mine || !now.account.owner ? null : t("mobile.aiPanel.of", { name: now.account.owner })))
    : null;
  const modelValue = now.auto ? t("brain.auto.label") : agentModelChip(agent, models, t("brain.auto.label"));
  const effortValue = t(`agentPage.work.brain.efforts.${now.effort ?? "none"}`);
  const contextValue = now.contextTokens ? contextSize(now.contextTokens) : t("mobile.aiPanel.sheet.contextFull");

  return (
    <>
      <Text variant="caption" tone="muted" style={styles.section}>
        {t("mobile.aiPanel.sheet.nowTitle")}
      </Text>
      <View style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.line }]}>
        <Line
          label={t("mobile.aiPanel.sheet.account")}
          value={accountValue}
          sub={accountSub}
          mark={now.account?.mark ?? now.keyProvider ?? (plan ? view.brain : undefined)}
          onPress={go(() => openAgentAi(agent.id))}
        />
        <Line
          label={t("mobile.aiPanel.sheet.model")}
          value={modelValue}
          sub={now.auto ? t("mobile.aiPanel.sheet.autoPerTask") : null}
          onPress={go(() => (plan ? openAgentModel(agent.id) : openAgentAi(agent.id)))}
          divided
        />
        <Line
          label={t("mobile.aiPanel.sheet.effort")}
          value={effortValue}
          onPress={go(() => openAgentAdvanced(agent.id))}
          divided
        />
        <Line
          label={t("mobile.aiPanel.sheet.context")}
          value={contextValue}
          onPress={go(() => openAgentAdvanced(agent.id))}
          divided
        />
      </View>
      <Text variant="caption" tone="muted" style={styles.section}>
        {t("mobile.aiPanel.sheet.switchTitle")}
      </Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {choices.map((c) => {
          const o = shownOf(c);
          if (!o) return null;
          const on = c === choice;
          const cost = costLine(o);
          const where = c === "auto" || !samePlace(o) ? placeName(o) : null;
          const login = where ? loginOf(o) : null;
          return (
            <PressScale
              key={c}
              onPress={() => setChoice(c)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${choiceName(c)}, ${c === "auto" ? (where ?? "") : o.label}`}
            >
              <View
                style={[
                  styles.choice,
                  { backgroundColor: colors.raised },
                  // The edge is inside the card's 12 × 14, as the prototype's inset ring: thicker chosen, the padding less.
                  on ? { borderColor: colors.ink, borderWidth: 2, ...CHOSEN_PAD } : { borderColor: colors.line },
                ]}
              >
                <View style={styles.choiceHead}>
                  <View style={[styles.intentIcon, { backgroundColor: colors.plate }]}>
                    <Icon name={CHOICE_ICON[c]} size={16} color={colors.ink} />
                  </View>
                  <Text variant="subhead" tone="ink" style={[styles.semibold, styles.grow]}>
                    {choiceName(c)}
                  </Text>
                  {o.current ? (
                    <View style={[styles.currentPill, { backgroundColor: colors.plate, borderColor: colors.line2 }]}>
                      <Text variant="caption" tone="muted" style={styles.medium}>
                        {t("mobile.aiPanel.sheet.current")}
                      </Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.radio,
                      on
                        ? { borderWidth: 7, borderColor: colors.ink }
                        : { borderWidth: 1.5, borderColor: colors.lineStrong },
                    ]}
                  />
                </View>
                <View style={styles.modelLine}>
                  <ProviderLogo id={placeMark(o)} size="xs" />
                  <Text variant="footnote" tone="ink" style={[styles.medium, styles.grow]} numberOfLines={2}>
                    {c === "auto" ? where : o.label}
                    {c !== "auto" && where ? (
                      <Text
                        variant="footnote"
                        tone="ink"
                      >{` · ${t("mobile.aiPanel.sheet.on", { place: where })}`}</Text>
                    ) : null}
                    {login ? <Text variant="footnote" tone="muted">{` (${login})`}</Text> : null}
                    {cost ? <Text variant="footnote" tone="muted">{` · ${cost}`}</Text> : null}
                  </Text>
                </View>
                <Text variant="footnote" tone="muted" style={styles.desc}>
                  {lineOf(c, o)}
                </Text>
              </View>
            </PressScale>
          );
        })}
      </View>
      {chosen ? (
        <View style={styles.lines}>
          <Line
            label={t("mobile.aiPanel.sheet.runsOn")}
            value={placeName(chosen)}
            sub={loginOf(chosen)}
            mark={placeMark(chosen)}
            onPress={
              chosenIntent && chosenOption && placesFor(options, chosenOption, chosenIntent).length > 1
                ? pickPlace
                : undefined
            }
          />
          {onPlan ? (
            <Line
              label={t("mobile.aiPanel.sheet.standIn")}
              value={standIn ? accountCardTitle(standIn) : t("mobile.aiPanel.sheet.standInNone")}
              sub={standIn?.email ?? null}
              mark={standIn ? (standIn.provider ?? standIn.kind) : undefined}
              onPress={pickStandIn}
              divided
            />
          ) : null}
          {standIn && (standInState === "almost" || standInState === "limited") ? (
            <Text variant="footnote" style={[styles.warn, { color: colors.amberInk }]}>
              {t(
                standInState === "limited"
                  ? "mobile.aiPanel.sheet.standInLimited"
                  : "mobile.aiPanel.sheet.standInAlmost",
              )}
            </Text>
          ) : null}
          <Line label={t("brain.picker.more")} onPress={go(() => openAgentAi(agent.id))} divided />
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          variant="primary"
          wide
          label={t("mobile.aiPanel.sheet.switchTo", { intent: choice ? choiceName(choice) : "" })}
          disabled={!changes}
          loading={busy}
          onPress={() => void save()}
          hint={t("mobile.aiPanel.sheet.title", g)}
        />
        <Button variant="ghost" wide label={t("common.cancel")} onPress={onClose} />
      </View>
    </>
  );
}

/**
 * A fact: its name on the left, its value with a mark on the right (and under it a second line, a login), a chevron
 * when it opens a choice.
 */
function Line({
  label,
  value,
  sub,
  mark,
  onPress,
  divided = false,
}: {
  label: string;
  value?: string;
  sub?: string | null;
  mark?: string | undefined;
  onPress?: (() => void) | undefined;
  divided?: boolean;
}) {
  const { colors } = useTheme();
  const row = (
    <View
      style={[styles.line, divided ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line } : null]}
    >
      <Text variant="footnote" tone="muted" style={styles.lineLabel} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <View style={styles.lineValue}>
          <View style={styles.lineTop}>
            {mark ? <ProviderLogo id={mark} size="xs" /> : null}
            <Text variant="footnote" tone="ink" style={[styles.medium, styles.shrink, styles.end]} numberOfLines={2}>
              {value}
            </Text>
          </View>
          {sub ? (
            <Text variant="caption" tone="muted" style={styles.end} numberOfLines={1} ellipsizeMode="middle">
              {sub}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.grow} />
      )}
      {onPress ? <Icon name="right" size={15} color={colors.muted} /> : null}
    </View>
  );
  return onPress ? (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}${sub ? `, ${sub}` : ""}` : label}
    >
      {row}
    </PressScale>
  ) : (
    row
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  // The prototype's 16 on each side, inside the sheet's 18.
  sides: { marginHorizontal: -2 },
  shrink: { flexShrink: 1 },
  end: { textAlign: "right" },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  loading: { marginVertical: 24 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4 },
  title: { fontFamily: DB_FONTES.titulo700, fontWeight: "700", fontSize: 20, lineHeight: 25, letterSpacing: -0.4 },
  body: { marginTop: 14, gap: 12 },
  section: { paddingHorizontal: 6, marginBottom: -6, textTransform: "uppercase", letterSpacing: 0.4 },
  card: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8 },
  choices: { gap: 8 },
  choice: { borderRadius: 20, paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1 },
  choiceHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  intentIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  currentPill: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  radio: { width: 22, height: 22, borderRadius: 11 },
  modelLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, marginLeft: 39 },
  desc: { marginTop: 3, marginLeft: 39 },
  lines: { marginTop: -4 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 6, paddingVertical: 4 },
  lineLabel: { flexShrink: 0 },
  lineValue: { flex: 1, minWidth: 0, alignItems: "flex-end", gap: 1 },
  lineTop: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, maxWidth: "100%" },
  warn: { paddingHorizontal: 6, paddingBottom: 8, marginTop: -4 },
  actions: { gap: 2, marginTop: -4 },
});
