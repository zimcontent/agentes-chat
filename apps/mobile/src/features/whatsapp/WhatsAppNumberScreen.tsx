import {
  useDraftWhatsAppInstructions,
  useModels,
  useUpdateWhatsApp,
  useWhatsApp,
  useWhatsAppBrain,
  type WhatsAppAccount,
} from "@agenteschat/client";
import { brainLine } from "@agenteschat/client/lib/brain";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, TextInput, View } from "react-native";
import {
  Button,
  GroupedFooter,
  GroupedHeader,
  GroupedList,
  GroupedRow,
  IconButton,
  Text,
  useFieldText,
  useToast,
} from "@/ui";
import { router } from "@/ui/navigation";
import { filePart } from "../review/media";
import { useColors, useDirectory, useOrgId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";
import { useWhatsAppSay } from "./logic";
import { useWhatsAppTake } from "./recorder";
import {
  changed,
  chooseAgent,
  draftOf,
  MESSAGES,
  type NumberDraft,
  PACES,
  patchOf,
  QUIETS,
  WAITS,
  withOwn,
} from "./settings-rules";
import { openWhatsAppNumberAi } from "./WhatsAppNumberAiScreen";
import { useWhatsAppWords } from "./words";

/** Opens a number's settings. */
export const openWhatsAppNumber = (accountId: string) =>
  router.push(`/whatsapp/settings?account=${encodeURIComponent(accountId)}` as never);

/** The most a person types for one direction (`WHATSAPP_DIRECTION_MAX`). */
const DIRECTION_MAX = 4000;
/** The most the instructions hold (`WHATSAPP_INSTRUCTIONS_MAX`). */
const INSTRUCTIONS_MAX = 20_000;

/**
 * One WhatsApp number's settings on the phone (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-17), for
 * whoever manages it: who answers (an agent or only people) and whether it answers now, the AI that thinks for it
 * (its own screen), how it answers, and its instructions. Under them a direction, typed or recorded, that the number's
 * AI works into the whole document: the draft lands in the field, to be read and saved like any other change. The
 * number's people and its connection stay on the web.
 */
export function WhatsAppNumberScreen({ accountId }: { accountId: string }) {
  const w = useWhatsAppWords();
  const overview = useWhatsApp(useOrgId());
  const account = overview.data?.accounts.find((a) => a.id === accountId);
  if (!account) {
    return (
      <PushedLargeTitle title={w.settings.title} grouped>
        <View style={styles.in}>
          {overview.isLoading ? <ActivityIndicator /> : <Text tone="muted">{w.empty.gone}</Text>}
        </View>
      </PushedLargeTitle>
    );
  }
  if (!account.manage) {
    return (
      <PushedLargeTitle title={account.label} grouped>
        <View style={styles.in}>
          <Text tone="muted">{w.settings.notManager}</Text>
        </View>
      </PushedLargeTitle>
    );
  }
  return <NumberForm key={account.id} account={account} />;
}

function NumberForm({ account }: { account: WhatsAppAccount }) {
  const w = useWhatsAppWords();
  const s = w.settings;
  const { t } = useTranslation();
  const orgId = useOrgId();
  const c = useColors();
  const words = useFieldText("body");
  const toast = useToast();
  const say = useWhatsAppSay();
  const dir = useDirectory();
  const update = useUpdateWhatsApp(orgId);
  const [draft, setDraft] = useState<NumberDraft>(() => draftOf(account));
  const set = (next: Partial<NumberDraft>) => setDraft((d) => ({ ...d, ...next }));
  const setStyle = (next: Partial<NumberDraft["style"]>) => setDraft((d) => ({ ...d, style: { ...d.style, ...next } }));
  const dirty = changed(account, draft);

  const agents = dir.agents;
  const agentName = draft.agentId ? dir.nameOf({ type: "agent", id: draft.agentId }) : "";
  // What thinks: read from the saved agent only (a new pick shows its AI once saved).
  const savedAgent = draft.agentId !== null && draft.agentId === account.agentId;
  const brain = useWhatsAppBrain(orgId, account.id, savedAgent);
  const models = useModels();
  const thinks = brain.data
    ? brainLine(
        t,
        brain.data.line,
        models.data?.models.find((m) => m.id === brain.data?.apiModel)?.label ?? brain.data.apiModel,
      ).text
    : "";

  const pick = async <T extends string | number>(
    title: string,
    options: readonly { key: T; label: string }[],
    value: T,
  ): Promise<T | null> => {
    const picked = await pickOne({
      title,
      value: String(value),
      options: options.map((o) => ({ key: String(o.key), label: o.label })),
    });
    return picked === null ? null : (options.find((o) => String(o.key) === picked)?.key ?? null);
  };

  const pickAgent = async () => {
    const picked = await pickOne({
      title: s.agent,
      value: draft.agentId ?? "none",
      options: [
        { key: "none", label: s.agentNone, leading: { kind: "icon" as const, name: "members" as const } },
        ...agents.map((a) => ({
          key: a.id,
          label: a.name,
          ...(a.role ? { sub: a.role } : {}),
          leading: { kind: "agent" as const, agentId: a.id },
        })),
      ],
    });
    if (picked !== null) setDraft((d) => chooseAgent(d, picked === "none" ? null : picked));
  };

  const save = () =>
    update.mutate(
      { accountId: account.id, ...patchOf(account, draft) },
      {
        onSuccess: () => toast({ title: s.saved, icon: "check" }),
        onError: (e) => toast({ title: say(e), icon: "x" }),
      },
    );

  return (
    <PushedLargeTitle title={account.label} grouped keyboard>
      <View style={styles.in}>
        <View>
          <GroupedHeader hint={{ name: t("common.about", { label: s.agent }), text: s.agentHint }}>
            {s.whoAnswers}
          </GroupedHeader>
          <GroupedList>
            <GroupedRow
              label={s.agent}
              value={draft.agentId ? agentName : s.agentNone}
              chevron
              onPress={() => void pickAgent()}
            />
            {draft.agentId ? (
              <GroupedRow
                label={s.agentOn}
                hint={{ name: t("common.about", { label: s.agentOn }), text: s.agentOnHint }}
                toggle={draft.agentOn}
                onPress={() => set({ agentOn: !draft.agentOn })}
              />
            ) : null}
            {draft.agentId ? (
              <GroupedRow
                label={s.ai}
                sub={savedAgent ? thinks || undefined : s.aiAfterSave}
                subLines={2}
                icon="brain"
                chevron={savedAgent}
                disabled={!savedAgent}
                onPress={() => openWhatsAppNumberAi(account.id)}
              />
            ) : null}
          </GroupedList>
        </View>

        {draft.agentId ? (
          <View>
            <GroupedHeader>{s.how}</GroupedHeader>
            <GroupedList>
              <GroupedRow
                label={w.style.wait}
                hint={{ name: t("common.about", { label: w.style.wait }), text: w.style.waitHint }}
                value={w.style.seconds(draft.style.waitSeconds)}
                menu
                onPress={async () => {
                  const n = await pick(
                    w.style.wait,
                    withOwn(WAITS, draft.style.waitSeconds).map((k) => ({ key: k, label: w.style.seconds(k) })),
                    draft.style.waitSeconds,
                  );
                  if (n !== null) setStyle({ waitSeconds: n });
                }}
              />
              <GroupedRow
                label={w.style.pace}
                hint={{ name: t("common.about", { label: w.style.pace }), text: w.style.paceHint }}
                value={w.style.paces[draft.style.pace]}
                menu
                onPress={async () => {
                  const p = await pick(
                    w.style.pace,
                    PACES.map((k) => ({ key: k, label: w.style.paces[k] })),
                    draft.style.pace,
                  );
                  if (p !== null) setStyle({ pace: p });
                }}
              />
              <GroupedRow
                label={w.style.messages}
                hint={{ name: t("common.about", { label: w.style.messages }), text: w.style.messagesHint }}
                value={w.style.upTo(draft.style.messages)}
                menu
                onPress={async () => {
                  const n = await pick(
                    w.style.messages,
                    MESSAGES.map((k) => ({ key: k, label: w.style.upTo(k) })),
                    draft.style.messages,
                  );
                  if (n !== null) setStyle({ messages: n });
                }}
              />
              <GroupedRow
                label={w.style.quiet}
                hint={{ name: t("common.about", { label: w.style.quiet }), text: w.style.quietHint }}
                value={w.style.minutes(draft.style.quietMinutes)}
                menu
                onPress={async () => {
                  const n = await pick(
                    w.style.quiet,
                    withOwn(QUIETS, draft.style.quietMinutes).map((k) => ({ key: k, label: w.style.minutes(k) })),
                    draft.style.quietMinutes,
                  );
                  if (n !== null) setStyle({ quietMinutes: n });
                }}
              />
              <GroupedRow
                label={w.style.voiceNotes}
                hint={{ name: t("common.about", { label: w.style.voiceNotes }), text: w.style.voiceNotesHint }}
                toggle={draft.style.voiceNotes ?? true}
                onPress={() => setStyle({ voiceNotes: !(draft.style.voiceNotes ?? true) })}
              />
            </GroupedList>
          </View>
        ) : null}

        <View>
          <GroupedHeader hint={{ name: t("common.about", { label: s.instructions }), text: s.instructionsHint }}>
            {s.instructions}
          </GroupedHeader>
          <GroupedList>
            <TextInput
              value={draft.instructions}
              onChangeText={(instructions) => set({ instructions })}
              multiline
              maxLength={INSTRUCTIONS_MAX}
              placeholder={s.instructionsPlaceholder}
              placeholderTextColor={c.faint}
              accessibilityLabel={s.instructions}
              style={[styles.instructions, words, { color: c.ink }]}
            />
          </GroupedList>
        </View>

        {draft.agentId && savedAgent ? (
          <Direction
            accountId={account.id}
            current={draft.instructions}
            onDraft={(instructions) => set({ instructions })}
          />
        ) : null}

        <Button
          variant="primary"
          wide
          label={s.save}
          disabled={!dirty || !draft.label.trim()}
          loading={update.isPending}
          onPress={save}
        />
      </View>
    </PushedLargeTitle>
  );
}

/**
 * A new direction for the instructions, under them: typed, or recorded with the mic. Sent, the number's AI rewrites
 * the whole document with it and the draft replaces the field's text, with a way back to what was there.
 */
function Direction({
  accountId,
  current,
  onDraft,
}: {
  accountId: string;
  current: string;
  onDraft: (instructions: string) => void;
}) {
  const w = useWhatsAppWords();
  const s = w.settings;
  const { t } = useTranslation();
  const orgId = useOrgId();
  const c = useColors();
  const words = useFieldText("body");
  const toast = useToast();
  const say = useWhatsAppSay();
  const draft = useDraftWhatsAppInstructions(orgId, accountId);
  const [text, setText] = useState("");
  const [heard, setHeard] = useState("");
  const [before, setBefore] = useState<string | null>(null);
  const take = useWhatsAppTake({
    onBlocked: () => toast({ title: w.chat.micBlocked, icon: "x" }),
    onFull: () => void sendTake(),
  });
  const [clock, setClock] = useState("0:00");
  useEffect(() => {
    const total = Math.floor(take.ms / 1000);
    setClock(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`);
  }, [take.ms]);

  const run = (input: Parameters<typeof draft.mutate>[0]) =>
    draft.mutate(input, {
      onSuccess: (made) => {
        setBefore(current);
        setHeard(made.heard);
        setText("");
        onDraft(made.instructions);
        toast({ title: s.drafted, icon: "check" });
      },
      onError: (e) => toast({ title: say(e), icon: "x" }),
    });
  const sendText = () => {
    const typed = text.trim();
    if (!typed || draft.isPending) return;
    run({ text: typed, current });
  };
  async function sendTake() {
    const done = await take.stop();
    if (!done) {
      toast({ title: w.chat.tooShort, icon: "x" });
      return;
    }
    run({
      ...(text.trim() ? { text: text.trim() } : {}),
      current,
      audio: { file: filePart(done.uri, "direcao.m4a", "audio/mp4"), fileName: "direcao.m4a", seconds: done.ms / 1000 },
    });
  }

  return (
    <View>
      <GroupedHeader hint={{ name: t("common.about", { label: s.direction }), text: s.directionHint }}>
        {s.direction}
      </GroupedHeader>
      <GroupedList>
        <View style={styles.direction}>
          {take.recording ? (
            <View style={styles.recording}>
              <View style={[styles.dot, { backgroundColor: c.danger }]} />
              <Text style={styles.grow}>{`${w.chat.recording} ${clock}`}</Text>
              <IconButton icon="trash" label={w.chat.deleteTake} small onPress={() => void take.cancel()} />
              <IconButton icon="send" label={s.directionSend} small onPress={() => void sendTake()} />
            </View>
          ) : draft.isPending ? (
            <View style={styles.recording}>
              <ActivityIndicator color={c.muted} />
              <Text tone="muted" style={styles.grow}>
                {s.drafting}
              </Text>
            </View>
          ) : (
            <View style={styles.recording}>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                maxLength={DIRECTION_MAX}
                placeholder={s.directionPlaceholder}
                placeholderTextColor={c.faint}
                accessibilityLabel={s.direction}
                style={[styles.grow, styles.directionInput, words, { color: c.ink }]}
              />
              {text.trim() ? (
                <IconButton icon="send" label={s.directionSend} small onPress={sendText} />
              ) : (
                <IconButton icon="mic" label={s.directionRecord} small onPress={() => void take.start()} />
              )}
            </View>
          )}
        </View>
      </GroupedList>
      {heard ? <GroupedFooter>{s.heard(heard)}</GroupedFooter> : null}
      {before !== null && !draft.isPending ? (
        <View style={styles.undo}>
          <Button
            variant="secondary"
            size="sm"
            label={s.undoDraft}
            onPress={() => {
              onDraft(before);
              setBefore(null);
              setHeard("");
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, gap: 24 },
  instructions: { minHeight: 180, paddingHorizontal: 16, paddingVertical: 12, textAlignVertical: "top" },
  direction: { paddingHorizontal: 16, paddingVertical: 8 },
  recording: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  directionInput: { paddingVertical: 8, maxHeight: 120 },
  grow: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  undo: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
});
