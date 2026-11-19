import {
  useAgentBrain,
  useModels,
  useSetWhatsAppBrain,
  useWhatsApp,
  useWhatsAppBrain,
  type WhatsAppBrain,
  type WhatsAppBrainInput,
} from "@dougbot/client";
import { brainLine } from "@dougbot/client/lib/brain";
import { modelInput, modelRows } from "@dougbot/client/lib/brain-picker";
import { contextSize } from "@dougbot/client/lib/context-limits";
import { brainPlan } from "@dougbot/client/lib/plans";
import { isAuto } from "@dougbot/client/lib/providers";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GroupedFooter, GroupedHeader, GroupedList, GroupedRow, ProviderLogo, Segmented, Text, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { openAgentAdvanced } from "../ai/AgentAdvancedScreen";
import { openAgentAi } from "../ai/AgentAiScreen";
import { useColors, useDirectory, useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { useWhatsAppSay } from "./logic";
import { accountsOf, effortShown, kindsOffered, NUMBER_EFFORTS, type NumberKind } from "./settings-rules";
import { useWhatsAppWords } from "./words";

/** Opens what thinks on a number. */
export const openWhatsAppNumberAi = (accountId: string) =>
  router.push(`/whatsapp/ai?account=${encodeURIComponent(accountId)}` as never);

/**
 * What thinks on one WhatsApp number (docs/adr/doug-0004-whatsapp-bridge.md and its addendum 2026-11-17), from the
 * number's settings: its agent's own AI (changed on the agent's AI screens, where its effort and context window are),
 * or one just for this number: an API model, or a Claude, ChatGPT or Gemini plan on the agent's computer, with its
 * account, model and effort. The agent stays who answers. Each choice saves at once. The agent's admin or owner only.
 */
export function WhatsAppNumberAiScreen({ accountId }: { accountId: string }) {
  const w = useWhatsAppWords();
  const s = w.settings;
  const { t } = useTranslation();
  const orgId = useOrgId();
  const c = useColors();
  const toast = useToast();
  const say = useWhatsAppSay();
  const dir = useDirectory();
  const account = useWhatsApp(orgId).data?.accounts.find((a) => a.id === accountId);
  const agentId = account?.agentId ?? null;
  const brain = useWhatsAppBrain(orgId, accountId, Boolean(agentId));
  const agentBrain = useAgentBrain(orgId, agentId ?? "", Boolean(agentId));
  const setBrain = useSetWhatsAppBrain(orgId, accountId);
  const models = useModels();
  const view = brain.data;
  const agentName = agentId ? dir.nameOf({ type: "agent", id: agentId }) : "";

  const apply = (input: WhatsAppBrainInput | null, done?: string) =>
    setBrain.mutate(input, {
      onSuccess: (saved) => {
        void brain.refetch();
        toast({ title: done ?? s.aiSaved(lineOf(saved).text), icon: "check" });
      },
      onError: (e) => toast({ title: say(e), icon: "x" }),
    });
  const apiLabel = (id: string) => models.data?.models.find((m) => m.id === id)?.label ?? id;
  const lineOf = (v: WhatsAppBrain) => brainLine(t, v.line, apiLabel(v.apiModel));

  if (!agentId) {
    return (
      <PushedLargeTitle title={s.ai} grouped>
        <View style={styles.in}>
          <Text tone="muted">{s.aiNoAgent}</Text>
        </View>
      </PushedLargeTitle>
    );
  }
  if (brain.isPending) {
    return (
      <PushedLargeTitle title={s.ai} grouped>
        <ActivityIndicator color={c.muted} style={styles.loading} />
      </PushedLargeTitle>
    );
  }
  if (!view) {
    return (
      <PushedLargeTitle title={s.ai} grouped>
        <View style={styles.in}>
          <Text tone="muted">{brain.error ? say(brain.error) : w.empty.failed}</Text>
        </View>
      </PushedLargeTitle>
    );
  }

  const busy = setBrain.isPending || !view.canEdit;
  const kind = view.brain as NumberKind;
  const plan = kind === "model" ? undefined : brainPlan(view);
  const line = lineOf(view);
  const context = agentBrain.data?.contextTokens;

  const pickModel = async () => {
    if (kind === "model") {
      const list = (models.data?.models ?? []).filter((m) => m.available !== false && m.pick !== false);
      const picked = await pickOne({
        title: s.aiModel,
        search: true,
        value: view.apiModel,
        options: list.map((m) => ({
          key: m.id,
          label: m.label,
          leading: { kind: "node" as const, node: <ProviderLogo id={m.provider} size="sm" /> },
        })),
      });
      if (picked && picked !== view.apiModel) apply({ model: picked });
      return;
    }
    const rows = modelRows(t, view, plan);
    const picked = await pickOne({
      title: s.aiModel,
      value: rows.find((r) => r.checked)?.value ?? null,
      options: rows.map((r) => ({ key: r.value, label: r.label, ...(r.sub ? { sub: r.sub } : {}) })),
    });
    if (!picked || rows.find((r) => r.checked)?.value === picked) return;
    apply({ brain: { brain: kind, model: modelInput(picked, view).model ?? null } });
  };

  const modelLabel =
    kind === "model"
      ? apiLabel(view.apiModel)
      : (modelRows(t, view, plan).find((r) => r.checked)?.label ??
        (isAuto(view.effectiveModel) ? "" : (view.effectiveModel ?? "")));
  const accounts = kind === "model" ? [] : accountsOf(view, kind);

  return (
    <PushedLargeTitle title={s.ai} grouped>
      <View style={styles.in}>
        <Segmented
          wide
          items={[
            { key: "same", label: s.aiSame },
            { key: "own", label: s.aiOwn },
          ]}
          value={view.own ? "own" : "same"}
          onChange={(next) => {
            if (busy || (next === "own") === view.own) return;
            // An AI of its own starts as the agent's: what thinks doesn't change until another one is picked.
            apply(next === "own" ? {} : null, next === "own" ? s.aiOwnOn : s.aiSameOn(agentName));
          }}
        />
        <GroupedList>
          <GroupedRow
            label={s.aiThinks}
            sub={line.text}
            subLines={2}
            leading={<ProviderLogo id={line.mark ?? kind} size="sm" />}
          />
        </GroupedList>

        {!view.own ? (
          <View>
            <GroupedList>
              <GroupedRow label={s.aiAgent(agentName)} icon="brain" chevron onPress={() => openAgentAi(agentId)} />
            </GroupedList>
            <GroupedFooter>{s.aiSameNote}</GroupedFooter>
          </View>
        ) : (
          <>
            <View>
              <GroupedHeader>{s.aiKind}</GroupedHeader>
              <GroupedList>
                {kindsOffered(view).map((k) => (
                  <GroupedRow
                    key={k}
                    label={s.aiKinds[k]}
                    leading={k === "model" ? undefined : <ProviderLogo id={k} size="sm" />}
                    {...(k === "model" ? { icon: "key" as const } : {})}
                    checked={kind === k}
                    disabled={busy}
                    onPress={() => kind !== k && apply({ brain: { brain: k } })}
                  />
                ))}
              </GroupedList>
            </View>
            {accounts.length > 0 ? (
              <View>
                <GroupedHeader>{s.aiAccount}</GroupedHeader>
                <GroupedList>
                  {view.ownSignIn && kind !== "antigravity" ? (
                    <GroupedRow
                      label={s.aiOwnSignIn}
                      icon="laptop"
                      checked={view.account === null}
                      disabled={busy}
                      onPress={() => view.account !== null && apply({ brain: { brain: kind, account: null } })}
                    />
                  ) : null}
                  {accounts.map((a) => (
                    <GroupedRow
                      key={a.id}
                      label={a.label}
                      {...(a.email ? { sub: a.email } : {})}
                      leading={<ProviderLogo id={a.provider ?? kind} size="sm" />}
                      checked={view.account === a.id}
                      disabled={busy}
                      onPress={() => view.account !== a.id && apply({ brain: { brain: kind, account: a.id } })}
                    />
                  ))}
                </GroupedList>
              </View>
            ) : null}
            <View>
              <GroupedHeader>{s.aiModelAndEffort}</GroupedHeader>
              <GroupedList>
                <GroupedRow
                  label={s.aiModel}
                  value={modelLabel || s.aiAuto}
                  chevron
                  disabled={busy}
                  onPress={() => void pickModel()}
                />
              </GroupedList>
            </View>
            {kind !== "model" ? (
              <View style={styles.effort}>
                <Text variant="footnote" tone="muted">
                  {s.aiEffort}
                </Text>
                <Segmented
                  wide
                  items={[
                    { key: "auto", label: s.aiAuto },
                    ...NUMBER_EFFORTS.map((e) => ({ key: e, label: s.aiEfforts[e] })),
                  ]}
                  value={effortShown(view.effort)}
                  onChange={(next) => {
                    if (busy || next === effortShown(view.effort)) return;
                    apply({ brain: { brain: kind, effort: next === "auto" ? null : next } });
                  }}
                />
              </View>
            ) : null}
          </>
        )}

        <View>
          <GroupedList>
            <GroupedRow
              label={s.aiContext}
              value={context ? contextSize(context) : s.aiContextFull}
              chevron
              onPress={() => openAgentAdvanced(agentId)}
            />
          </GroupedList>
          <GroupedFooter>{s.aiContextNote(agentName)}</GroupedFooter>
        </View>
        {!view.canEdit ? <Text tone="muted">{s.aiReadOnly}</Text> : null}
      </View>
    </PushedLargeTitle>
  );
}

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, gap: 24 },
  loading: { marginTop: 24 },
  effort: { gap: 8 },
});
